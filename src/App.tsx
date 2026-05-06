import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { subscribeHotkey } from './lib/hotkey';
import { isAiTool, listTools, runAction, type Tool } from './lib/tools';
import { getLlmSettings } from './lib/settings';
import { pushHistory } from './lib/history';
import { playSound } from './lib/sound';
import { detectClipboardSuggestions } from './lib/suggest';
import { loadStats, recordUse, wearBandFor, type ToolStats } from './lib/telemetry';
import { PermissionGuide } from './components/PermissionGuide';
import { SettingsSheet } from './components/SettingsSheet';
import { HistorySheet } from './components/HistorySheet';
import { ToolIcon } from './components/ToolIcon';
import {
  EV_POOL_CLOSE,
  EV_POOL_PIN_TOGGLE,
  EV_POOL_RUN,
  EV_WORKSPACE_CLOSE,
  EV_WORKSPACE_RETRY,
  broadcastToolsState,
  broadcastWorkspaceState,
  type PoolPinTogglePayload,
  type PoolRunPayload,
  type WorkspaceResultPayload,
} from './lib/window-events';

const PINNED_KEY = 'ctrl.pinned-tools.v1';
const POOL_OPEN_KEY = 'ctrl.pool-open.v1';
const ONBOARDED_KEY = 'ctrl.onboarded.v1';
const PINNED_LIMIT = 15;
const NOTIFY_DURATION_MS = 4000;
const AUTOHIDE_GRACE_MS = 800;
const CHORD_TIMEOUT_MS = 1500;
/** Result text length above which we open the side workspace; shorter outputs use the inline toast. */
const WORKSPACE_TEXT_THRESHOLD = 120;
interface RunResult {
  text: string;
  kind: 'success' | 'error' | 'notify';
  toolName?: string;
  retryable?: boolean;
  /** When true, render as ChatWorkspace (multi-turn follow-up). Set on AI tool success. */
  isChat?: boolean;
}

interface RunningState {
  key: string;
  toolName: string;
}

type SheetKind = 'settings' | 'history' | 'terminal' | null;

interface HumanizedError {
  text: string;
  retryable: boolean;
  /** When true, the launcher should auto-open Settings instead of just showing an error. */
  needsSettings?: boolean;
}

function loadPoolOpen(): boolean {
  try {
    return localStorage.getItem(POOL_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function savePoolOpen(open: boolean): void {
  try {
    localStorage.setItem(POOL_OPEN_KEY, open ? '1' : '0');
  } catch {
    // best-effort
  }
}

function loadPinned(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string').slice(0, PINNED_LIMIT);
  } catch {
    return [];
  }
}

function savePinned(ids: string[]): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
  } catch {
    // best-effort: localStorage quota / disabled — pinning falls back to default
  }
}

function humanizeError(rawMessage: string): HumanizedError {
  const msg = rawMessage.toLowerCase();
  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid api key')) {
    return {
      text: 'API key 失效或缺失。',
      retryable: false,
      needsSettings: true,
    };
  }
  if (msg.includes('429') || msg.includes('rate limit')) {
    return { text: '请求太频繁,稍等几秒再试。', retryable: true };
  }
  if (msg.includes('no llm') || msg.includes('not configured') || msg.includes('未配置')) {
    return {
      text: 'AI 工具需要先配置 LLM。',
      retryable: false,
      needsSettings: true,
    };
  }
  if (msg.includes('clipboard') && (msg.includes('empty') || msg.includes('no text') || msg.includes('为空'))) {
    return { text: '剪贴板里没有文本。先复制一段内容,再按这个键。', retryable: true };
  }
  if (msg.includes('econnrefused') || msg.includes('network') || msg.includes('timeout') || msg.includes('dns')) {
    return { text: '网络无法连接。检查代理或重试。', retryable: true };
  }
  return { text: rawMessage, retryable: true };
}

export function App(): JSX.Element {
  const [tools, setTools] = useState<Tool[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>(loadPinned);
  const [running, setRunning] = useState<RunningState | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [autohideArmed, setAutohideArmed] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [chordPrefix, setChordPrefix] = useState<string | null>(null);
  const [suggestedIds, setSuggestedIds] = useState<Set<string>>(() => new Set());
  const [suggestionLabel, setSuggestionLabel] = useState<string | null>(null);
  const [stats, setStats] = useState<ToolStats>(loadStats);
  /** Whether at least one LLM profile is configured. AI tools open settings instead of running when false. */
  const [aiReady, setAiReady] = useState<boolean>(false);
  const [poolOpen, setPoolOpen] = useState<boolean>(loadPoolOpen);
  const [welcomeOpen, setWelcomeOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ONBOARDED_KEY) !== '1';
    } catch {
      return false;
    }
  });

  const lastRunRef = useRef<{ tool: Tool; actionId: string } | null>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const chordTimerRef = useRef<number | null>(null);
  const lastSuggestAt = useRef<number>(0);

  // -------- Bootstrap effects --------
  useEffect(() => {
    listTools()
      .then(setTools)
      .catch((err) =>
        setResult({
          text: String(err),
          kind: 'error',
          toolName: 'manifest 加载',
          retryable: false,
        }),
      );
  }, []);

  // Refresh AI-readiness on mount and every time a sheet closes (settings may have been edited).
  // Heuristic: aiReady = profile count > 0. Even if the key is in Keychain (not in `api_key`),
  // a configured profile is enough — the runtime will still surface a 401 error path.
  useEffect(() => {
    if (sheet !== null) return; // refresh only on close
    let cancelled = false;
    void (async () => {
      try {
        const s = await getLlmSettings();
        if (!cancelled) setAiReady(s.profiles.length > 0);
      } catch {
        if (!cancelled) setAiReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sheet]);

  // Refresh contextual suggestions by peeking the clipboard.
  // Throttled at 500ms — multiple rapid wakeups don't spam the IPC bridge.
  const refreshSuggestions = useCallback(async () => {
    const now = Date.now();
    if (now - lastSuggestAt.current < 500) return;
    lastSuggestAt.current = now;
    try {
      const text = await invoke<string>('peek_clipboard');
      const { toolIds, label } = detectClipboardSuggestions(text);
      setSuggestedIds(toolIds);
      setSuggestionLabel(label);
    } catch {
      setSuggestedIds(new Set());
      setSuggestionLabel(null);
    }
  }, []);

  useEffect(() => {
    const unlistenPromise = subscribeHotkey(() => {
      // Hotkey wake — Rust shows the window. Play wake sound + refresh suggestions.
      // Reset pool to closed so the panel always appears at the canonical
      // compact size, centered under the cursor where Rust placed it.
      playSound('wake');
      setPoolOpen(false);
      void refreshSuggestions();
    });
    return () => {
      void unlistenPromise.then((u) => u());
    };
  }, [refreshSuggestions]);

  // Initial suggestion on mount + on every window focus
  useEffect(() => {
    void refreshSuggestions();
    function onFocus(): void {
      void refreshSuggestions();
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshSuggestions]);

  useEffect(() => {
    const unlistenPromise = listen<string>('notify', (e) => {
      setResult({ text: e.payload, kind: 'notify' });
    });
    return () => {
      void unlistenPromise.then((u) => u());
    };
  }, []);

  // Auto-hide: arm after grace period so first paint doesn't trigger blur-hide
  useEffect(() => {
    const t = window.setTimeout(() => setAutohideArmed(true), AUTOHIDE_GRACE_MS);
    return () => window.clearTimeout(t);
  }, []);

  // -------- Result auto-dismiss (notify only; success/error stay) --------
  useEffect(() => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (!result) return;
    if (result.kind !== 'notify') return;
    const id = window.setTimeout(() => setResult(null), NOTIFY_DURATION_MS);
    dismissTimerRef.current = id;
    return () => window.clearTimeout(id);
  }, [result]);

  // -------- Derived: keyboard (pinned, fallback first 9) + pool (rest) --------
  const { keyboardTools, poolTools } = useMemo(() => {
    if (tools.length === 0) {
      return { keyboardTools: [] as Tool[], poolTools: [] as Tool[] };
    }
    const idMap = new Map(tools.map((t) => [t.id, t]));
    const keyboard: Tool[] = [];
    if (pinnedIds.length > 0) {
      for (const id of pinnedIds) {
        const t = idMap.get(id);
        if (t) keyboard.push(t);
        if (keyboard.length >= PINNED_LIMIT) break;
      }
    }
    if (keyboard.length < PINNED_LIMIT) {
      const used = new Set(keyboard.map((t) => t.id));
      for (const t of tools) {
        if (keyboard.length >= PINNED_LIMIT) break;
        if (!used.has(t.id)) {
          keyboard.push(t);
          used.add(t.id);
        }
      }
    }
    const onKeyboard = new Set(keyboard.map((t) => t.id));
    const pool = tools.filter((t) => !onKeyboard.has(t.id));
    return { keyboardTools: keyboard, poolTools: pool };
  }, [tools, pinnedIds]);

  // -------- Chord index: full chord → tool, plus set of valid first letters --------
  const chordIndex = useMemo(() => {
    const map = new Map<string, Tool>();
    for (const t of tools) {
      if (t.chord && /^[a-z]{2}$/.test(t.chord)) {
        map.set(t.chord, t);
      }
    }
    return map;
  }, [tools]);

  const chordPrefixes = useMemo(() => {
    const set = new Set<string>();
    for (const c of chordIndex.keys()) set.add(c[0]!);
    return set;
  }, [chordIndex]);

  /** ids of tools whose chord starts with the current prefix (for visual highlight) */
  const chordCandidates = useMemo(() => {
    if (!chordPrefix) return null;
    const ids = new Set<string>();
    for (const [c, t] of chordIndex) {
      if (c.startsWith(chordPrefix)) ids.add(t.id);
    }
    return ids;
  }, [chordPrefix, chordIndex]);

  const clearChord = useCallback(() => {
    if (chordTimerRef.current !== null) {
      window.clearTimeout(chordTimerRef.current);
      chordTimerRef.current = null;
    }
    setChordPrefix(null);
  }, []);

  const dismissWelcome = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
    } catch {
      // best-effort: localStorage disabled — welcome will reappear next session, harmless
    }
    setWelcomeOpen(false);
  }, []);

  // -------- Actions --------
  const togglePin = useCallback((toolId: string) => {
    setPinnedIds((current) => {
      let next: string[];
      if (current.includes(toolId)) {
        next = current.filter((id) => id !== toolId);
      } else if (current.length < PINNED_LIMIT) {
        next = [...current, toolId];
      } else {
        // Keyboard full: replace last pinned with new one
        next = [...current.slice(0, PINNED_LIMIT - 1), toolId];
      }
      savePinned(next);
      return next;
    });
  }, []);

  const handleRun = useCallback(
    async (tool: Tool, actionId: string): Promise<void> => {
      const key = `${tool.id}:${actionId}`;
      if (running) {
        setResult({
          text: `「${running.toolName}」还在运行,先等它完成再触发下一个。`,
          kind: 'notify',
        });
        return;
      }
      // Pre-flight: AI tools without an LLM profile bypass execution and surface settings.
      // Without this the user gets a delayed runtime error path; we'd rather not pretend to run.
      if (isAiTool(tool) && !aiReady) {
        setResult({
          text: 'AI 工具需要先配置 LLM,正在打开设置…',
          kind: 'notify',
          toolName: tool.name,
        });
        setSheet('settings');
        return;
      }
      playSound('press');
      lastRunRef.current = { tool, actionId };
      setRunning({ key, toolName: tool.name });
      setResult(null);
      const isAi = isAiTool(tool);
      try {
        const text = await runAction(tool.id, actionId);
        if (text) {
          setResult({ text, kind: 'success', toolName: tool.name, isChat: isAi });
          if (isAi) playSound('success-ai');
          pushHistory({
            toolId: tool.id,
            toolName: tool.name,
            actionId,
            kind: 'success',
            text,
          });
        } else {
          pushHistory({
            toolId: tool.id,
            toolName: tool.name,
            actionId,
            kind: 'notify',
            text: '',
          });
        }
      } catch (err: unknown) {
        const raw = err instanceof Error ? err.message : String(err);
        const { text, retryable, needsSettings } = humanizeError(raw);
        setResult({ text, kind: 'error', toolName: tool.name, retryable });
        playSound('error');
        if (needsSettings) {
          window.setTimeout(() => setSheet('settings'), 400);
        }
        pushHistory({
          toolId: tool.id,
          toolName: tool.name,
          actionId,
          kind: 'error',
          text,
        });
      } finally {
        setRunning(null);
        setStats(recordUse(tool.id));
        // Clipboard may have changed (write-clipboard step) — re-detect suggestions.
        void refreshSuggestions();
      }
    },
    [running, refreshSuggestions, aiReady],
  );

  const handleRetry = useCallback(() => {
    const last = lastRunRef.current;
    if (!last) return;
    void handleRun(last.tool, last.actionId);
  }, [handleRun]);

  const handleRerunFromHistory = useCallback(
    (toolId: string, actionId: string) => {
      const tool = tools.find((t) => t.id === toolId);
      if (!tool) {
        setResult({
          text: `找不到工具「${toolId}」(可能已卸载)`,
          kind: 'error',
          retryable: false,
        });
        return;
      }
      const action = tool.actions.find((a) => a.id === actionId) ?? tool.actions[0];
      if (!action) return;
      void handleRun(tool, action.id);
    },
    [tools, handleRun],
  );

  const copyResult = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setResult({ text: '已复制到剪贴板', kind: 'notify' });
      playSound('copy');
    } catch {
      // ignore — Tauri webview has clipboard permission via capabilities
    }
  }, [result]);

  // -------- Keyboard wiring: 1-9 trigger keyboard slots --------
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (sheet || welcomeOpen) return;
      if (chordPrefix !== null) return; // chord pending takes precedence
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const n = Number(e.key);
      if (!Number.isFinite(n) || n < 1 || n > 9) return;
      const tool = keyboardTools[n - 1];
      if (!tool) return;
      const action = tool.actions[0];
      if (!action) return;
      e.preventDefault();
      const key = `${tool.id}:${action.id}`;
      setPressed(key);
      window.setTimeout(() => setPressed(null), 160);
      void handleRun(tool, action.id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardTools, handleRun, sheet, welcomeOpen, chordPrefix]);

  // -------- Chord (vim-style leader key): a-z double-stroke --------
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (sheet || welcomeOpen) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key.length !== 1) return;
      const ch = e.key.toLowerCase();
      if (!/^[a-z]$/.test(ch)) return;

      if (chordPrefix === null) {
        // First letter — start chord only if any tool's chord begins with it
        if (!chordPrefixes.has(ch)) return;
        e.preventDefault();
        setChordPrefix(ch);
        if (chordTimerRef.current !== null) {
          window.clearTimeout(chordTimerRef.current);
        }
        chordTimerRef.current = window.setTimeout(() => {
          setChordPrefix(null);
          chordTimerRef.current = null;
        }, CHORD_TIMEOUT_MS);
        return;
      }
      // Second letter — try to resolve full chord
      e.preventDefault();
      const full = chordPrefix + ch;
      const tool = chordIndex.get(full);
      clearChord();
      if (!tool) return; // miss — silent abort, vim-style
      const action = tool.actions[0];
      if (!action) return;
      const key = `${tool.id}:${action.id}`;
      setPressed(key);
      window.setTimeout(() => setPressed(null), 160);
      void handleRun(tool, action.id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, welcomeOpen, chordPrefix, chordPrefixes, chordIndex, handleRun, clearChord]);

  // -------- Esc + Cmd/Ctrl+K/,/H wiring --------
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const isMod = e.metaKey || e.ctrlKey;
      // Cmd/Ctrl+, → settings
      if (isMod && e.key === ',') {
        e.preventDefault();
        setSheet((cur) => (cur === 'settings' ? null : 'settings'));
        return;
      }
      // Cmd/Ctrl+H → history (mac-native window-hide is reserved for system; we override here for launcher)
      if (isMod && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setSheet((cur) => (cur === 'history' ? null : 'history'));
        return;
      }
      // Cmd/Ctrl+K → open pool window (its own search input takes over from there)
      if (isMod && e.key.toLowerCase() === 'k') {
        if (sheet) return;
        e.preventDefault();
        setPoolOpen(true);
        return;
      }
      if (e.key !== 'Escape') return;
      // -2) Esc on welcome: dismiss it
      if (welcomeOpen) {
        e.preventDefault();
        dismissWelcome();
        return;
      }
      // -1) Esc with a chord pending: cancel it
      if (chordPrefix !== null) {
        e.preventDefault();
        clearChord();
        return;
      }
      // 0) Esc with a sheet open: close the sheet
      if (sheet) {
        e.preventDefault();
        setSheet(null);
        return;
      }
      // 1) Esc with a result open: close the result (workspace window)
      if (result) {
        e.preventDefault();
        setResult(null);
        return;
      }
      // 2) Esc on bare launcher: hide all panels
      e.preventDefault();
      void invoke('hide_all_panels').catch(() => undefined);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, sheet, chordPrefix, clearChord, welcomeOpen, dismissWelcome]);

  // -------- Workspace open rule: long output / errors / chat get the side panel --------
  // Short notify and short success render inline as a toast. This keeps the launcher
  // visually quiet on simple tools (copy → "已复制") and only widens for content that
  // actually wants reading space.
  const workspaceOpen = useMemo<boolean>(() => {
    if (!result) return false;
    if (result.isChat) return true;
    if (result.kind === 'error') return true;
    if (result.kind === 'success' && result.text.length > WORKSPACE_TEXT_THRESHOLD) return true;
    return false; // notify, short success → toast
  }, [result]);

  // -------- Persist pool open state --------
  useEffect(() => {
    savePoolOpen(poolOpen);
  }, [poolOpen]);

  // -------- Sync independent panel windows to React state --------
  // Pool and workspace are real NSWindows alongside this keyboard window.
  // Toggling their state just shows/hides the corresponding window — no
  // resize, no jitter, no phantom click area.
  useEffect(() => {
    void invoke('set_panel_visible', { label: 'pool', visible: poolOpen }).catch(
      () => undefined,
    );
  }, [poolOpen]);

  useEffect(() => {
    void invoke('set_panel_visible', {
      label: 'workspace',
      visible: workspaceOpen,
    }).catch(() => undefined);
  }, [workspaceOpen]);

  // -------- Broadcast tools state to the pool window --------
  // Pool window subscribes to this and re-renders. We send only what it
  // needs: pool tools (the unpinned), suggestion+chord highlights, AI
  // readiness, and the suggestion label (echoed for parity even though
  // pool doesn't currently render it).
  useEffect(() => {
    void broadcastToolsState({
      poolTools,
      suggestedToolIds: Array.from(suggestedIds),
      chordCandidateIds: chordCandidates ? Array.from(chordCandidates) : null,
      aiReady,
      suggestionLabel,
    }).catch(() => undefined);
  }, [poolTools, suggestedIds, chordCandidates, aiReady, suggestionLabel]);

  // -------- Broadcast workspace state to the workspace window --------
  useEffect(() => {
    const payload: WorkspaceResultPayload | null = result
      ? {
          text: result.text,
          kind: result.kind,
          toolName: result.toolName,
          retryable: result.retryable,
          isChat: result.isChat,
        }
      : null;
    void broadcastWorkspaceState({
      result: payload,
      canRetry: Boolean(lastRunRef.current),
    }).catch(() => undefined);
  }, [result]);

  // -------- Listen for actions from pool window --------
  useEffect(() => {
    const unlistenRun = listen<PoolRunPayload>(EV_POOL_RUN, (e) => {
      const tool = tools.find((t) => t.id === e.payload.toolId);
      if (!tool) return;
      const action =
        (e.payload.actionId
          ? tool.actions.find((a) => a.id === e.payload.actionId)
          : tool.actions[0]) ?? tool.actions[0];
      if (!action) return;
      void handleRun(tool, action.id);
    });
    const unlistenPin = listen<PoolPinTogglePayload>(EV_POOL_PIN_TOGGLE, (e) => {
      togglePin(e.payload.toolId);
    });
    const unlistenClose = listen(EV_POOL_CLOSE, () => {
      setPoolOpen(false);
    });
    return () => {
      void unlistenRun.then((u) => u());
      void unlistenPin.then((u) => u());
      void unlistenClose.then((u) => u());
    };
  }, [tools, handleRun, togglePin]);

  // -------- Listen for actions from workspace window --------
  useEffect(() => {
    const unlistenClose = listen(EV_WORKSPACE_CLOSE, () => {
      setResult(null);
    });
    const unlistenRetry = listen(EV_WORKSPACE_RETRY, () => {
      handleRetry();
    });
    return () => {
      void unlistenClose.then((u) => u());
      void unlistenRetry.then((u) => u());
    };
  }, [handleRetry]);

  // -------- Auto-hide all panels when the whole app loses focus --------
  // With 3 sibling NSWindows, a click on the pool window blurs this
  // (keyboard) window. We delay 80ms then ask Rust whether ANY of our
  // windows still holds focus — if yes, the click was internal, no-op;
  // if not, the user has switched apps and we hide everything.
  useEffect(() => {
    if (!autohideArmed) return;
    let pending = 0;
    function onBlur(): void {
      if (running) return;
      if (result) return;
      if (welcomeOpen) return;
      if (sheet) return;
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        void invoke('hide_if_unfocused').catch(() => undefined);
      }, 80);
    }
    function onFocus(): void {
      window.clearTimeout(pending);
    }
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(pending);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [autohideArmed, running, result, welcomeOpen, sheet]);

  // -------- Render --------
  let statusLabel: string;
  let statusKind: 'is-busy' | 'is-ready' | 'is-chord';
  if (chordPrefix) {
    statusLabel = `等待第二键 · ${chordPrefix}_`;
    statusKind = 'is-chord';
  } else if (running) {
    statusLabel = `运行中 · ${running.toolName}`;
    statusKind = 'is-busy';
  } else {
    statusLabel = '按 1-9 触发 · 字母双键 chord';
    statusKind = 'is-ready';
  }

  return (
    <>
      <PermissionGuide />
      <div className="shell window-fill">
        <main className="panel panel-keyboard" data-stagger="1">
          <header className="panel-header panel-header-hero" data-tauri-drag-region>
            <button
              type="button"
              className="toolbar-btn pool-toggle"
              aria-label={poolOpen ? '收起仓库' : '展开仓库'}
              aria-pressed={poolOpen}
              title={poolOpen ? '收起仓库' : '展开仓库'}
              onClick={() => setPoolOpen((o) => !o)}
            >
              <span aria-hidden>{poolOpen ? '⟩' : '⟨'}</span>
            </button>
            <span className="panel-title-group">
              <BrandLogo />
              <span className="brand-title">CTRL</span>
            </span>
            <span className="panel-status mono" aria-live="polite">
              <span className={`status-dot ${statusKind}`} aria-hidden />
              <span className="status-text">{statusLabel}</span>
              {suggestionLabel && !chordPrefix && !running && (
                <span className="suggestion-pill" title="剪贴板内容触发的工具建议">
                  {suggestionLabel}
                </span>
              )}
            </span>
            <span className="toolbar">
              <button
                type="button"
                className="toolbar-btn"
                aria-label="历史 (⌘H)"
                title="历史 ⌘H"
                onClick={() => setSheet((c) => (c === 'history' ? null : 'history'))}
              >
                <span aria-hidden>↺</span>
              </button>
              <button
                type="button"
                className="toolbar-btn"
                aria-label="设置 (⌘,)"
                title="设置 ⌘,"
                onClick={() => setSheet((c) => (c === 'settings' ? null : 'settings'))}
              >
                <span aria-hidden>⚙</span>
              </button>
            </span>
          </header>
          {result && !workspaceOpen && (
            <Toast
              text={result.text}
              kind={result.kind}
              toolName={result.toolName}
              onClose={() => setResult(null)}
              onCopy={copyResult}
            />
          )}
          <ul className="keyboard-fnrow" aria-label="功能行">
            <li>
              <button
                type="button"
                className="fnkey"
                aria-label="终端 — 跟 AI 聊出新键帽"
                title="终端 · 锻造新键帽"
                onClick={() => setSheet((c) => (c === 'terminal' ? null : 'terminal'))}
              >
                <span className="fnkey-glyph" aria-hidden>⌨</span>
                <span className="fnkey-label">终端</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="fnkey"
                aria-label="历史 (⌘H)"
                title="历史 · ⌘H"
                onClick={() => setSheet((c) => (c === 'history' ? null : 'history'))}
              >
                <span className="fnkey-glyph" aria-hidden>↺</span>
                <span className="fnkey-label">历史</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="fnkey"
                aria-label="设置 (⌘,)"
                title="设置 · ⌘,"
                onClick={() => setSheet((c) => (c === 'settings' ? null : 'settings'))}
              >
                <span className="fnkey-glyph" aria-hidden>⚙</span>
                <span className="fnkey-label">设置</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="fnkey"
                aria-label={poolOpen ? '收起仓库' : '展开仓库'}
                aria-pressed={poolOpen}
                title={poolOpen ? '收起仓库' : '展开仓库'}
                onClick={() => setPoolOpen((o) => !o)}
              >
                <span className="fnkey-glyph" aria-hidden>{poolOpen ? '⟨' : '⟩'}</span>
                <span className="fnkey-label">仓库</span>
              </button>
            </li>
            <li className="fnrow-spacer" aria-hidden />
            <li>
              <span className="fnkey fnkey-readout" title="当前键盘容量">
                <span className="fnkey-glyph" aria-hidden>◧</span>
                <span className="fnkey-label mono">{keyboardTools.length}/{PINNED_LIMIT}</span>
              </span>
            </li>
          </ul>
          <ul className="keyboard-grid">
            {Array.from({ length: PINNED_LIMIT }).map((_, i) => {
              const tool = keyboardTools[i];
              const hotkey = `${i + 1}`;
              if (!tool) {
                return (
                  <li key={`empty-${i}`} className="keycap keycap-empty">
                    <span className="keycap-face">
                      <span className="keycap-number mono">{hotkey}</span>
                      <span className="keycap-empty-hint">空位</span>
                    </span>
                  </li>
                );
              }
              const action = tool.actions[0];
              if (!action) return null;
              const key = `${tool.id}:${action.id}`;
              const chordState: 'match' | 'dim' | 'idle' = chordCandidates
                ? chordCandidates.has(tool.id)
                  ? 'match'
                  : 'dim'
                : 'idle';
              // Suggestion only shows when chord is idle (chord visual takes priority)
              const isSuggested = chordCandidates === null && suggestedIds.has(tool.id);
              // Same priority rule for needs-config: hidden during chord pending so chord visual stays clean.
              const needsConfig = chordCandidates === null && isAiTool(tool) && !aiReady;
              const wearBand = wearBandFor(tool.id, stats);
              return (
                <Keycap
                  key={tool.id}
                  hotkey={hotkey}
                  icon={tool.icon || '🔧'}
                  name={tool.name}
                  description={tool.description.short}
                  category={tool.category}
                  chord={tool.chord}
                  chordState={chordState}
                  wearBand={wearBand}
                  isRunning={running?.key === key}
                  isPressed={pressed === key}
                  isSuggested={isSuggested}
                  needsConfig={needsConfig}
                  onActivate={() => handleRun(tool, action.id)}
                  onUnpin={() => togglePin(tool.id)}
                />
              );
            })}
          </ul>
          <div className="keyboard-actionbar" role="group" aria-label="主操作行">
            <button
              type="button"
              className="actionkey actionkey-primary"
              aria-label="召出终端 跟 AI 锻造一个新键帽"
              title="终端 · 跟 AI 锻造一个新键帽"
              onClick={() => setSheet((c) => (c === 'terminal' ? null : 'terminal'))}
            >
              <span className="actionkey-label">召出终端</span>
              <kbd className="actionkey-chord mono">⌘ ⏎</kbd>
            </button>
            <button
              type="button"
              className="actionkey actionkey-search"
              aria-label="搜索仓库 (⌘K)"
              title="搜索仓库 · ⌘K"
              onClick={() => setPoolOpen(true)}
            >
              <span className="actionkey-glyph" aria-hidden>⌕</span>
              <kbd className="actionkey-chord mono">⌘ K</kbd>
            </button>
          </div>
        </main>

      </div>
      {sheet === 'settings' && <SettingsSheet onClose={() => setSheet(null)} />}
      {sheet === 'history' && (
        <HistorySheet
          onClose={() => setSheet(null)}
          onRerun={handleRerunFromHistory}
        />
      )}
      {sheet === 'terminal' && <TerminalSheetStub onClose={() => setSheet(null)} />}
      {welcomeOpen && <WelcomeCard onDismiss={dismissWelcome} />}
    </>
  );
}

// ============================================================
// Welcome card (first-run onboarding)
// ============================================================

interface WelcomeCardProps {
  onDismiss: () => void;
}

function WelcomeCard({ onDismiss }: WelcomeCardProps): JSX.Element {
  return (
    <div
      className="welcome-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="欢迎"
      onClick={onDismiss}
    >
      <div className="welcome-card" onClick={(e) => e.stopPropagation()}>
        <header className="welcome-header">
          <span className="brand-logo welcome-logo" aria-hidden>CTL</span>
          <div>
            <h2 className="welcome-title">欢迎使用 CTRL</h2>
            <p className="welcome-sub">中文 OPC 的桌面 AI 工具合集</p>
          </div>
        </header>
        <ul className="welcome-tips">
          <li>
            <span className="welcome-key mono">Ctrl</span>
            <span className="welcome-tip-text">按 Control 键唤起 / 隐藏窗口</span>
          </li>
          <li>
            <span className="welcome-key mono">1-9</span>
            <span className="welcome-tip-text">按数字键直接触发对应槽位的工具</span>
          </li>
          <li>
            <span className="welcome-key mono">a→s</span>
            <span className="welcome-tip-text">vim 风双键 chord(每个工具有 2 字母快捷)</span>
          </li>
          <li>
            <span className="welcome-key mono">⌘K</span>
            <span className="welcome-tip-text">搜索 · ⌘, 设置 · ⌘H 历史</span>
          </li>
          <li>
            <span className="welcome-key mono">Esc</span>
            <span className="welcome-tip-text">关闭面板 / 取消 chord / 隐藏窗口</span>
          </li>
        </ul>
        <footer className="welcome-footer">
          <p className="welcome-hint">AI 工具(如 AI 总结)需要先在设置里配置 LLM key,推荐 MiniMax。</p>
          <button type="button" className="action-btn primary" onClick={onDismiss} autoFocus>
            开始使用
          </button>
        </footer>
      </div>
    </div>
  );
}

// ============================================================
// Brand
// ============================================================

function BrandLogo(): JSX.Element {
  return (
    <span className="brand-logo" aria-label="CTRL">
      CTL
    </span>
  );
}

// ============================================================
// Toast (inline result for short outputs / notifications)
// ============================================================

interface ToastProps {
  text: string;
  kind: 'success' | 'error' | 'notify';
  toolName?: string;
  onClose: () => void;
  onCopy: () => void;
}

function Toast({ text, kind, toolName, onClose, onCopy }: ToastProps): JSX.Element {
  const mark = kind === 'error' ? '✗' : kind === 'notify' ? '·' : '✓';
  return (
    <div className={`toast toast-${kind}`} role="status">
      <span className={`toast-mark workspace-mark workspace-mark-${kind}`} aria-hidden>
        {mark}
      </span>
      {toolName && <span className="toast-tool">{toolName}</span>}
      <span className="toast-text">{text}</span>
      {kind === 'success' && (
        <button type="button" className="toast-action" onClick={onCopy} title="复制">
          复制
        </button>
      )}
      <button type="button" className="toast-close" onClick={onClose} aria-label="关闭">
        ✕
      </button>
    </div>
  );
}

// ============================================================
// Terminal — placeholder stub. Real implementation will be a chat
// surface where users forge new keycaps by talking to an AI; the
// chat output gets serialized into a keycap manifest. For now it's
// a friendly "coming soon" sheet so the F-row + spacebar entries
// have something to open.
// ============================================================

interface TerminalSheetStubProps {
  onClose: () => void;
}

function TerminalSheetStub({ onClose }: TerminalSheetStubProps): JSX.Element {
  return (
    <div
      className="welcome-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="终端"
      onClick={onClose}
    >
      <div className="welcome-card" onClick={(e) => e.stopPropagation()}>
        <header className="welcome-header">
          <span className="brand-logo welcome-logo" aria-hidden>⌨</span>
          <div>
            <h2 className="welcome-title">终端 · 即将开放</h2>
            <p className="welcome-sub">跟 AI 聊一段，对话末尾一键封装成新键帽</p>
          </div>
        </header>
        <ul className="welcome-tips">
          <li><span className="welcome-tip-text">描述你想要的键帽（"把中文改成朋友圈口吻"）</span></li>
          <li><span className="welcome-tip-text">来回迭代到满意</span></li>
          <li><span className="welcome-tip-text">一键封装：自动抽 prompt + 标签 + 输入绑定 + chord</span></li>
          <li><span className="welcome-tip-text">写入 vault，立即出现在键盘上</span></li>
        </ul>
        <footer className="welcome-footer">
          <p className="welcome-hint">这是 Phase 1 的核心交付项之一。当前是占位符。</p>
          <button type="button" className="action-btn primary" onClick={onClose} autoFocus>
            知道了
          </button>
        </footer>
      </div>
    </div>
  );
}

// ============================================================
// Keycap (keyboard slot)
// ============================================================

interface KeycapProps {
  hotkey: string;
  icon: string;
  name: string;
  description: string;
  /** Tool category — drives left-edge accent color (see categoryToCssVar). */
  category: string;
  chord?: string;
  chordState: 'match' | 'dim' | 'idle';
  wearBand: 0 | 1 | 2 | 3;
  isRunning: boolean;
  isPressed: boolean;
  isSuggested: boolean;
  /** AI tool whose LLM profile isn't configured. Click opens settings instead of running. */
  needsConfig: boolean;
  onActivate: () => void;
  onUnpin: () => void;
}

/** Map a tool's manifest category to the CSS color token used as the left-edge accent.
 *  Categories without a specific match fall back to neutral tool gray.
 *  Keep in sync with --c-* tokens in styles.css :root. */
function categoryToCssVar(category: string): string {
  switch (category) {
    case 'ai-summary':
    case 'ai-persona':
      return 'var(--c-persona)';
    case 'ai-aggregate':
      return 'var(--c-aggregate)';
    case 'developer':
      return 'var(--c-vibe)';
    case 'social':
    case 'life':
      return 'var(--c-life)';
    case 'visual':
    case 'design':
      return 'var(--c-visual)';
    case 'agent':
      return 'var(--c-agent)';
    case 'web-browser':
      return 'var(--c-aggregate)';
    default:
      return 'var(--c-tool)';
  }
}

function Keycap(props: KeycapProps): JSX.Element {
  const {
    hotkey,
    icon,
    name,
    description,
    category,
    chord,
    chordState,
    wearBand,
    isRunning,
    isPressed,
    isSuggested,
    needsConfig,
    onActivate,
    onUnpin,
  } = props;

  function handleUnpinClick(e: ReactMouseEvent<HTMLButtonElement>): void {
    e.stopPropagation();
    onUnpin();
  }

  const classes = [
    'keycap',
    isRunning && 'is-running',
    isPressed && 'is-pressed',
    isSuggested && 'is-suggested',
    needsConfig && 'is-needs-config',
    chordState === 'match' && 'is-chord-match',
    chordState === 'dim' && 'is-chord-dim',
  ]
    .filter(Boolean)
    .join(' ');

  const titleSuffix = chord ? ` · 双键 ${chord}` : '';
  const suggestSuffix = isSuggested ? ' · 剪贴板内容相关' : '';
  const needsConfigSuffix = needsConfig ? ' · 需要先配置 LLM(点击打开设置)' : '';

  // Inline CSS variable — drives the left-edge accent color in .keycap-face::before.
  // React's typed style accepts custom properties via the `as` cast pattern.
  const styleWithCat = { '--cat': categoryToCssVar(category) } as CSSProperties;

  return (
    <li
      className={classes}
      data-wear={wearBand > 0 ? wearBand : undefined}
      role="button"
      tabIndex={0}
      title={`${name} · ${description} · 按 ${hotkey} 触发${titleSuffix}${suggestSuffix}${needsConfigSuffix}`}
      aria-keyshortcuts={hotkey}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      <span className="keycap-face" style={styleWithCat}>
        <span className="keycap-number mono" aria-hidden>{hotkey}</span>
        {needsConfig && (
          <span className="keycap-config-pip" aria-hidden title="需要先配置 LLM">⚙</span>
        )}
        <button
          type="button"
          className="keycap-unpin"
          onClick={handleUnpinClick}
          aria-label="移出键盘"
          title="移出键盘"
          tabIndex={-1}
        >
          −
        </button>
        <span className="keycap-icon">
          <ToolIcon name={icon} size={16} />
        </span>
        <span className="keycap-name">{name}</span>
        <span className="keycap-sub">{description}</span>
        {chord && (
          <span className="keycap-chord mono" aria-hidden>{chord}</span>
        )}
      </span>
    </li>
  );
}

