// CodingAgentPanel — OpenCode driven over ACP inside the one persistent
// conversation dialog. AmbientHome owns presentation and actor selection;
// this controller exclusively owns Coding workspace sessions, attachments,
// cancellation, and external launch.
//
// CTRL spawns the user's own `opencode acp` process (verified: it speaks
// real Agent Client Protocol — initialize -> session/new -> session/prompt,
// streaming agent_thought_chunk / agent_message_chunk / tool_call /
// tool_call_update) via the SAME AcpClient machinery already driving Irisy's
// engine, in a separate singleton rooted at the selected workspace. CTRL
// renders the structured events with native React (no PTY, no terminal
// emulation). Opening a separate OS terminal/editor remains available as a
// secondary, collapsed action.
// (ADR-001 spine §4 v21; ADR-003 frontend §8.5/§8.6 v39;
// ADR-005 irisy §8.7/§11 v38)

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { invoke, pickCodingAttachments, platform } from '@/lib/bridge';
import { isImeComposing } from '@/lib/ime';
import {
  codingLauncherStatus,
  launchCodingWorkspace,
  reconcileWorkspaceId,
  selectTerminalId,
  type CodingLaunchMode,
  type CodingLauncherStatus,
} from '@/lib/coding-launcher';
import { streamCodingChat, resetCodingEngine, type CodingToolStep, type CodingAttachment } from '@/lib/coding-chat';
import { useCodingFileDrop } from '@/lib/coding-drop';
import { loadCodingSessions, saveCodingSessions, type CodingMessage, type CodingToolStepView } from '@/lib/coding-sessions';
import { vaultWrite, listLocalSkills, type LocalSkill } from '@/lib/kernel';
import styles from './CodingScene.module.css';

// Drag-and-drop file attachments (ADR-002 substrate §1.8.6 v75; ADR-003
// frontend §8.5 v35) — a dropped file becomes authoring reference material
// for opencode (a competitor screenshot, an API doc), read server-side and
// resolved into an ACP ContentBlock only if the connected engine negotiated
// support for it; unsupported degrades to a text notice, never a silent
// drop. This is NOT a data-import path for an installed feature pack —
// that is Irisy's own, separately-scoped, unbuilt semantic.

// The CTRL launcher window is an always-on-top, all-Spaces NSPanel (ADR-003
// §1.1) so a Ctrl tap can summon it over anything, including another app's
// full-screen Space. That means it keeps floating over an external
// Terminal/iTerm/editor window the secondary "Open externally" actions just
// opened, visually overlapping it. Hide CTRL right after one of those
// succeeds — same `hide_window` command the StatusBar (×) button and Ambient
// launcher already use. Never called for the primary opencode-over-ACP path
// (nothing external opens there — CTRL should stay visible).
const hideCtrlWindow = (): void => {
  if (platform() !== 'tauri') return;
  void invoke<void>('hide_window').catch(() => {
    // Best-effort: if this fails, CTRL simply stays visible.
  });
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function applyToolStep(prev: CodingToolStepView[] | undefined, step: CodingToolStep): CodingToolStepView[] {
  const list = prev ? [...prev] : [];
  const i = list.findIndex((s) => s.tool_call_id === step.tool_call_id);
  if (step.phase === 'call') {
    const view: CodingToolStepView = { id: step.tool_call_id, ...step };
    if (i >= 0) list[i] = { ...list[i], ...view };
    else list.push(view);
    return list;
  }
  if (i >= 0) {
    const cur = list[i]!;
    list[i] = { ...cur, status: step.status, output: step.output };
  } else {
    list.push({ id: step.tool_call_id, ...step });
  }
  return list;
}

function prettyToolTitle(t: string): string {
  return t.replace(/^mcp_ctrl_/, '').replace(/^mcp_/, '').replace(/_/g, ' ').trim();
}

const PACK_INTENT = /(?:feature\s*pack|capability\s*pack|mcp\s*pack|[\u529f\u80fd\u80fd\u529b\u5de5\u4f5c]\s*[\u5305])/i;

function packResearchSlug(intent: string): string {
  const slug = intent
    .replace(PACK_INTENT, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return slug || 'new-feature-pack';
}

async function savePackResearchNote(intent: string, paths: string[]): Promise<string> {
  const path = `Research/feature-packs/${packResearchSlug(intent)}.md`;
  const sources = paths.length > 0 ? paths.map((source) => `- ${source}`).join('\n') : '- No source path supplied';
  await vaultWrite({
    path,
    content: `# Feature pack research\n\n## Intent\n${intent}\n\n## User-provided sources\n${sources}\n\n## Authoring instruction\nRead every listed local source through CTRL before designing the pack. Use the governed create-feature-pack skill, then produce the corresponding manifest and evaluation plan.\n`,
    frontmatter: { title: `Feature pack research: ${packResearchSlug(intent)}`, tags: ['feature-pack', 'research'] },
  });
  return path;
}

interface Msg extends CodingMessage {
  tools?: CodingToolStepView[];
}

interface CodingAgentPanelProps {
  active: boolean;
  onAgentModeChange: (mode: 'irisy' | 'coding') => void;
}

function CodingIdentitySelect({
  onAgentModeChange,
}: Pick<CodingAgentPanelProps, 'onAgentModeChange'>): ReactElement {
  return (
    <select
      className={styles.compactSelect}
      aria-label="Irisy identity"
      value="coding"
      onChange={(event) => onAgentModeChange(event.target.value as 'irisy' | 'coding')}
    >
      <option value="irisy">Assistant</option>
      <option value="coding">Coding</option>
    </select>
  );
}

export function CodingAgentPanel({
  active,
  onAgentModeChange,
}: CodingAgentPanelProps): ReactElement {
  const [status, setStatus] = useState<CodingLauncherStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('ctrl:coding-active-workspace:v1') ?? '';
  });
  const [localSkills, setLocalSkills] = useState<LocalSkill[]>([]);
  const [codingSkillId, setCodingSkillId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('ctrl:irisy-coding-skill:v1') ?? '';
  });
  const [terminalId, setTerminalId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Pending workspace switch while a live opencode session exists — switching
  // needs a fresh ACP process rooted at the new cwd, so this is a deliberate
  // confirm step rather than a silent kill-and-restart.
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(null);
  // Workspace identity does not change until the old ACP owner has completed
  // reset. Composer dispatch is blocked during this handoff.
  // (ADR-005 irisy §11 v38)
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const requestIdRef = useRef(0);
  const workspaceIdRef = useRef(workspaceId);
  const codingSkillIdRef = useRef(codingSkillId);
  const workspaceTransitionRef = useRef<Promise<boolean>>(Promise.resolve(true));

  // Per-workspace conversation. Keyed by workspace path so switching back to
  // a workspace you already talked to restores that transcript instead of
  // losing it (each workspace's opencode session is independent).
  const [messagesByWorkspace, setMessagesByWorkspace] = useState<Record<string, Msg[]>>(() => loadCodingSessions());
  const [input, setInput] = useState('');
  const [referencePaths, setReferencePaths] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const chatAreaRef = useRef<HTMLDivElement | null>(null);

  // One serialized owner transition is shared by tabs and status refresh.
  // Workspace identity commits only after the old ACP singleton is reset.
  // (ADR-005 irisy §11 v38)
  const transitionWorkspace = useCallback((nextWorkspaceId: string): Promise<boolean> => {
    const transition = workspaceTransitionRef.current.then(async () => {
      if (!nextWorkspaceId || nextWorkspaceId === workspaceIdRef.current) return true;
      setSwitchingWorkspace(true);
      setFeedback(null);
      abortRef.current?.abort();
      setStreaming(false);
      try {
        await resetCodingEngine();
        workspaceIdRef.current = nextWorkspaceId;
        setWorkspaceId(nextWorkspaceId);
        setPendingWorkspaceId(null);
        return true;
      } catch (error: unknown) {
        setFeedback({ kind: 'error', text: `Could not switch project: ${errorMessage(error)}` });
        return false;
      } finally {
        setSwitchingWorkspace(false);
      }
    });
    workspaceTransitionRef.current = transition;
    return transition;
  }, []);

  const transitionSkill = useCallback((nextSkillId: string): Promise<boolean> => {
    const transition = workspaceTransitionRef.current.then(async () => {
      if (nextSkillId === codingSkillIdRef.current) return true;
      setSwitchingWorkspace(true);
      setFeedback(null);
      abortRef.current?.abort();
      setStreaming(false);
      try {
        await resetCodingEngine();
        codingSkillIdRef.current = nextSkillId;
        setCodingSkillId(nextSkillId);
        return true;
      } catch (error: unknown) {
        setFeedback({ kind: 'error', text: `Could not change skill: ${errorMessage(error)}` });
        return false;
      } finally {
        setSwitchingWorkspace(false);
      }
    });
    workspaceTransitionRef.current = transition;
    return transition;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listLocalSkills()
      .then((skills) => {
        if (cancelled) return;
        setLocalSkills(skills);
        if (
          codingSkillIdRef.current
          && !skills.some((skill) => skill.name === codingSkillIdRef.current)
        ) {
          void transitionSkill('');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFeedback({ kind: 'error', text: `Could not load skills: ${errorMessage(error)}` });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [transitionSkill]);

  useEffect(() => {
    codingSkillIdRef.current = codingSkillId;
    if (typeof window === 'undefined') return;
    if (codingSkillId) {
      window.localStorage.setItem('ctrl:irisy-coding-skill:v1', codingSkillId);
    } else {
      window.localStorage.removeItem('ctrl:irisy-coding-skill:v1');
    }
  }, [codingSkillId]);

  useEffect(() => {
    saveCodingSessions(messagesByWorkspace);
  }, [messagesByWorkspace]);

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
    if (typeof window === 'undefined' || !workspaceId) return;
    window.localStorage.setItem('ctrl:coding-active-workspace:v1', workspaceId);
  }, [workspaceId]);

  // Files dropped since the last send — authoring reference material for
  // opencode (a competitor screenshot, an API doc), not a data-import path
  // (ADR-002 substrate §1.8.6 v75; ADR-003 frontend §8.5 v39). Cleared once
  // sent; the backend reads each path itself, so this only tracks display
  // name + path, never file bytes.
  const [pendingAttachments, setPendingAttachments] = useState<CodingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const handleFileDrop = useCallback((paths: string[]): void => {
    if (switchingWorkspace) return;
    setPendingAttachments((prev) => {
      const existing = new Set(prev.map((a) => a.path));
      const added = paths
        .filter((p) => !existing.has(p))
        .map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p }));
      return added.length > 0 ? [...prev, ...added] : prev;
    });
    setDragOver(false);
  }, [switchingWorkspace]);
  const dropHandlers = useMemo(
    () => ({
      onDrop: handleFileDrop,
      onDragOver: () => setDragOver(true),
      onDragLeave: () => setDragOver(false),
    }),
    [handleFileDrop],
  );
  useCodingFileDrop(chatAreaRef, dropHandlers);

  const removeAttachment = useCallback((path: string): void => {
    if (switchingWorkspace) return;
    setPendingAttachments((prev) => prev.filter((a) => a.path !== path));
  }, [switchingWorkspace]);

  // Directories remain explicit paths because ACP attachments are regular
  // files only; OpenCode can inspect the selected directory with its own
  // filesystem tools. Files use the shared ACP attachment path below.
  // (ADR-002 substrate §1.8.6 v75; ADR-003 frontend §8.5 v39)
  const addDirectoryReferences = useCallback((paths: string[]): void => {
    if (switchingWorkspace) return;
    const additions = paths.filter((path) => !referencePaths.includes(path));
    if (additions.length === 0) return;
    setReferencePaths((prev) => [...prev, ...additions]);
    setInput((prev) => [prev.trim(), ...additions].filter(Boolean).join(' '));
  }, [referencePaths, switchingWorkspace]);

  const pickAttachments = useCallback(async (): Promise<void> => {
    if (switchingWorkspace) return;
    try {
      const selection = await pickCodingAttachments();
      handleFileDrop(selection.files);
      addDirectoryReferences(selection.directories);
    } catch (error: unknown) {
      setFeedback({ kind: 'error', text: errorMessage(error) });
    }
  }, [addDirectoryReferences, handleFileDrop, switchingWorkspace]);

  const refresh = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setRefreshing(true);
    setLoadError(null);
    try {
      const next = await codingLauncherStatus();
      if (requestId !== requestIdRef.current) return;
      const reconciliation = reconcileWorkspaceId(workspaceIdRef.current, next.workspaces);
      if (reconciliation.requiresReset) {
        const switched = await transitionWorkspace(reconciliation.nextId);
        if (!switched || requestId !== requestIdRef.current) return;
      } else if (reconciliation.nextId !== workspaceIdRef.current) {
        // First status load has no prior ACP owner, so it can select directly.
        workspaceIdRef.current = reconciliation.nextId;
        setWorkspaceId(reconciliation.nextId);
      }
      setStatus(next);
      setTerminalId((current) => selectTerminalId(current, next.terminals));
    } catch (error: unknown) {
      if (requestId === requestIdRef.current) setLoadError(errorMessage(error));
    } finally {
      if (requestId === requestIdRef.current) setRefreshing(false);
    }
  }, [transitionWorkspace]);

  useEffect(() => {
    void refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

  const workspace = useMemo(
    () => status?.workspaces.find((candidate) => candidate.id === workspaceId) ?? status?.workspaces[0] ?? null,
    [status, workspaceId],
  );
  const terminal = useMemo(
    () => status?.terminals.find((candidate) => candidate.id === terminalId) ?? null,
    [status, terminalId],
  );
  const messages = (workspace && messagesByWorkspace[workspace.path]) ?? [];

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }));
  }, [messages, streaming]);

  const launch = async (target: string, mode: CodingLaunchMode): Promise<void> => {
    if (!workspace || switchingWorkspace) return;
    const operation = `${mode}:${target}`;
    setBusy(operation);
    setFeedback(null);
    try {
      await launchCodingWorkspace({ target, workspace: workspace.path, mode });
      setFeedback({
        kind: 'success',
        text:
          mode === 'open_code'
            ? `Irisy Coding launched in ${workspace.label}.`
            : `Project opened (${workspace.label}).`,
      });
      hideCtrlWindow();
      await refresh();
    } catch (error: unknown) {
      setFeedback({ kind: 'error', text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const copyCommand = async (): Promise<void> => {
    if (!status?.launchCommand || switchingWorkspace) return;
    try {
      await navigator.clipboard.writeText(status.launchCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setFeedback({
        kind: 'error',
        text: 'Clipboard access was denied. Select the command and copy it manually.',
      });
    }
  };

  const send = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if ((!trimmed && pendingAttachments.length === 0) || !workspace || switchingWorkspace) return;
    abortRef.current?.abort();
    setInput('');
    const attachmentsForTurn = pendingAttachments;
    setPendingAttachments([]);
    const workspacePath = workspace.path;
    let prompt = trimmed;
    if (PACK_INTENT.test(trimmed)) {
      try {
        const researchPath = await savePackResearchNote(trimmed, referencePaths);
        prompt += `\n\nCTRL has prepared the durable research note at ${researchPath}. Read it and every listed source path before authoring the feature pack.`;
        setReferencePaths([]);
        setFeedback({ kind: 'success', text: `Saved pack research to ${researchPath}.` });
      } catch (error: unknown) {
        setFeedback({ kind: 'error', text: `Could not save pack research: ${errorMessage(error)}` });
      }
    }
    const attachmentSuffix = attachmentsForTurn.length > 0
      ? `\n\n[Attached: ${attachmentsForTurn.map((a) => a.name).join(', ')}]`
      : '';
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: `${prompt}${attachmentSuffix}` };
    const asstId = `a-${Date.now()}`;
    setMessagesByWorkspace((prev) => ({
      ...prev,
      [workspacePath]: [...(prev[workspacePath] ?? []), userMsg, { id: asstId, role: 'assistant', content: '' }],
    }));
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const update = (fn: (m: Msg) => Msg): void => {
      setMessagesByWorkspace((prev) => ({
        ...prev,
        [workspacePath]: (prev[workspacePath] ?? []).map((m) => (m.id === asstId ? fn(m) : m)),
      }));
    };

    try {
      const history = [...(messagesByWorkspace[workspacePath] ?? []), userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      for await (const chunk of streamCodingChat(
        workspacePath,
        history,
        ctrl.signal,
        attachmentsForTurn,
        codingSkillId || undefined,
      )) {
        if (chunk.error) {
          if (chunk.error === 'aborted') break;
          update((m) => ({ ...m, content: `Error: ${chunk.error}` }));
          break;
        }
        if (chunk.tool) {
          update((m) => ({ ...m, tools: applyToolStep(m.tools, chunk.tool!) }));
          continue;
        }
        if (chunk.thought) {
          update((m) => ({ ...m, reasoning: (m.reasoning ?? '') + chunk.thought }));
          continue;
        }
        if (chunk.delta) {
          update((m) => ({ ...m, content: m.content + chunk.delta }));
        }
      }
    } catch (err) {
      update((m) => ({ ...m, content: `Error: ${err instanceof Error ? err.message : String(err)}` }));
    } finally {
      if (abortRef.current === ctrl) {
        setStreaming(false);
        abortRef.current = null;
      }
    }
  }, [workspace, messagesByWorkspace, pendingAttachments, referencePaths, switchingWorkspace, codingSkillId]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  if (loadError && !status) {
    return (
      <div className={styles.root} hidden={!active}>
        <div className={styles.content}>
          <h1 className={styles.title}>Irisy Coding unavailable</h1>
          <p className={styles.error} role="alert">{loadError}</p>
          <button type="button" className={styles.secondary} onClick={() => void refresh()}>
            Try again
          </button>
        </div>
        <div className={styles.fallbackFooter}>
          <CodingIdentitySelect onAgentModeChange={onAgentModeChange} />
        </div>
      </div>
    );
  }

  if (!status || !workspace) {
    return (
      <div className={styles.root} hidden={!active}>
        <div className={styles.content}>
          <p className={styles.notice} role="status" aria-live="polite">
            Inspecting the configured Coding project…
          </p>
        </div>
        <div className={styles.fallbackFooter}>
          <CodingIdentitySelect onAgentModeChange={onAgentModeChange} />
        </div>
      </div>
    );
  }

  const opencodeReady = status.opencodeAvailable;
  const hasSession = messages.length > 0;
  const pendingWorkspace = pendingWorkspaceId
    ? status.workspaces.find((candidate) => candidate.id === pendingWorkspaceId) ?? null
    : null;

  // Every non-initial workspace change resets the ACP owner before committing
  // the new visible cwd, even when the durable transcript is empty: a prior
  // reset/cleared transcript does not prove no process exists.
  // (ADR-005 irisy §11 v38)
  const switchWorkspace = (nextWorkspaceId: string): void => {
    if (nextWorkspaceId === workspace.id || switchingWorkspace) return;
    requestIdRef.current += 1;
    setRefreshing(false);
    void transitionWorkspace(nextWorkspaceId);
  };

  const requestWorkspaceChange = (nextId: string): void => {
    if (nextId === workspace.id || switchingWorkspace) return;
    if (hasSession) {
      setPendingWorkspaceId(nextId);
      return;
    }
    void switchWorkspace(nextId);
  };
  const confirmWorkspaceChange = (): void => {
    if (pendingWorkspaceId) void switchWorkspace(pendingWorkspaceId);
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <div className={styles.root} hidden={!active} aria-label="Coding module">
      {/* One mounted dialog, isolated Coding controller. These controls move
          with Coding's composer but never transfer its ACP/session authority.
          (ADR-001 spine §4 v21; ADR-003 frontend §8.5/§8.6 v39;
          ADR-005 irisy §8.7/§11 v38) */}

      {pendingWorkspace && (
        <div className={styles.confirmBar} role="alert">
          <span>
            Switching to <strong>{pendingWorkspace.label}</strong> will end the active Irisy Coding
            session in {workspace.label}.
          </span>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={switchingWorkspace}
              onClick={() => setPendingWorkspaceId(null)}
            >
              Stay in {workspace.label}
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={switchingWorkspace}
              onClick={() => void confirmWorkspaceChange()}
            >
              {switchingWorkspace ? 'Switching…' : 'Switch anyway'}
            </button>
          </div>
        </div>
      )}

      {!opencodeReady && (
        <p className={styles.notice}>
          Irisy Coding is unavailable because its local coding runtime was not found. Install it in Settings, then Refresh.
        </p>
      )}
      {loadError && <p className={styles.error} role="alert">Refresh failed: {loadError}</p>}
      {feedback?.kind === 'error' && <p className={styles.error} role="alert">{feedback.text}</p>}
      {feedback?.kind === 'success' && <p className={styles.success} role="status">{feedback.text}</p>}

      <div className={styles.chatArea} ref={chatAreaRef} data-drag-over={dragOver ? 'true' : undefined}>
        {dragOver && (
          <div className={styles.dropOverlay} aria-hidden>
            Drop to attach as reference material
          </div>
        )}
        <div className={styles.scroller} ref={scrollerRef}>
          {messages.length === 0 ? (
            <div className={styles.chatEmpty}>
              <span className={styles.chatEmptyIcon} aria-hidden>{'</>'}</span>
              <p>
                {opencodeReady
                  ? `Ask Irisy to build, fix, or explain something in ${workspace.label}.`
                  : 'Set up Irisy Coding to start coding here.'}
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`${styles.msg} ${styles[m.role]}`}>
                {m.role === 'assistant' ? (
                  <>
                    {m.reasoning && m.reasoning.trim() && (
                      <details className={styles.reasoning}>
                        <summary>
                          {m.id === lastAssistantId && streaming ? 'Thinking…' : 'Thought process'}
                        </summary>
                        <div className={styles.reasoningBody}>{m.reasoning.trim()}</div>
                      </details>
                    )}
                    {m.tools && m.tools.length > 0 && (
                      <div className={styles.toolSteps}>
                        {m.tools.map((s) => (
                          <details key={s.id} className={styles.toolStep} data-status={s.status ?? 'running'}>
                            <summary>
                              <span aria-hidden>
                                {s.status === undefined ? '◐' : s.status === 'failed' ? '✗' : '✓'}
                              </span>
                              <span className={styles.toolTitle}>{prettyToolTitle(s.title)}</span>
                            </summary>
                            {s.input && <pre className={styles.toolIo}>{s.input}</pre>}
                            {s.output && <pre className={styles.toolIo}>{s.output}</pre>}
                          </details>
                        ))}
                      </div>
                    )}
                    {m.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    ) : m.id === lastAssistantId && streaming ? (
                      <div className={styles.thinking} aria-label="Irisy Coding is working">
                        <span>Irisy is thinking</span>
                      </div>
                    ) : null}
                  </>
                ) : (
                  m.content
                )}
              </div>
            ))
          )}
        </div>
        {pendingAttachments.length > 0 && (
          <div className={styles.attachmentChips} role="list" aria-label="Attached files">
            {pendingAttachments.map((a) => (
              <span key={a.path} className={styles.attachmentChip} role="listitem">
                <span className={styles.attachmentChipName}>{a.name}</span>
                <button
                  type="button"
                  className={styles.attachmentChipRemove}
                  disabled={switchingWorkspace}
                  onClick={() => removeAttachment(a.path)}
                  aria-label={`Remove ${a.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <form
          className={styles.composer}
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            className={styles.composerInput}
            value={input}
            rows={1}
            placeholder={opencodeReady ? `Ask Irisy in ${workspace.label}…` : 'Set up Irisy Coding first…'}
            disabled={!opencodeReady || switchingWorkspace}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // ADR-003 frontend §7.6 v33 — every Enter-handling input shares
              // this guard: an Enter that confirms a CJK IME candidate must
              // never fire submit.
              if (isImeComposing(e)) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <div className={styles.composerFooter}>
            <button
              type="button"
              className={styles.addPathButton}
              aria-label="Add files or folders"
              title="Add files or folders"
              disabled={switchingWorkspace}
              onClick={() => void pickAttachments()}
            >
              +
            </button>
            <CodingIdentitySelect onAgentModeChange={onAgentModeChange} />
            {status.workspaces.length > 1 && (
              <select
                className={styles.compactSelect}
                aria-label="Resource"
                value={workspace.id}
                disabled={switchingWorkspace}
                title={workspace.path}
                onChange={(event) => requestWorkspaceChange(event.target.value)}
              >
                {status.workspaces.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            )}
            <select
              className={styles.compactSelect}
              aria-label="Skill"
              value={codingSkillId}
              disabled={switchingWorkspace}
              title={
                codingSkillId
                  ? localSkills.find((skill) => skill.name === codingSkillId)?.description
                  : 'Let Irisy choose a skill for each request'
              }
              onChange={(event) => void transitionSkill(event.target.value)}
            >
              <option value="">Skill: Auto</option>
              {localSkills.map((skill) => (
                <option key={skill.name} value={skill.name}>
                  {skill.name}
                </option>
              ))}
            </select>
            <span className={styles.footerSpacer} />
            <button
              type="button"
              className={styles.footerAction}
              disabled={refreshing || switchingWorkspace}
              onClick={() => void refresh()}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            {streaming ? (
              <button
                type="button"
                className={styles.composerSend}
                onClick={stopGeneration}
                aria-label="Stop"
              >
                ■
              </button>
            ) : (
              <button
                type="submit"
                className={styles.composerSend}
                aria-label="Send"
                disabled={
                  (!input.trim() && pendingAttachments.length === 0)
                  || !opencodeReady
                  || switchingWorkspace
                }
              >
                ↑
              </button>
            )}
          </div>
        </form>
      </div>

      <details className={styles.externalDisclosure}>
        <summary>Open externally instead</summary>
        <div className={styles.externalBody}>
          <label className={styles.field}>
            <span className={styles.label}>Terminal / editor target</span>
            <select
              className={styles.select}
              value={terminalId}
              disabled={switchingWorkspace}
              onChange={(event) => setTerminalId(event.target.value)}
            >
              {status.terminals.map((target) => (
                <option key={target.id} value={target.id} disabled={!target.available}>
                  {target.label}{target.available ? '' : ' — Not installed'}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={!opencodeReady || !terminal?.available || busy != null || switchingWorkspace}
              onClick={() => void launch(terminalId, 'open_code')}
            >
              {busy === `open_code:${terminalId}` ? 'Launching…' : 'Launch Irisy Coding here'}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={!terminal?.available || busy != null || switchingWorkspace}
              onClick={() => void launch(terminalId, 'shell')}
            >
              Open shell
            </button>
            {status.editors.map((editor) => (
              <button
                key={editor.id}
                type="button"
                className={styles.ghost}
                disabled={!editor.available || busy != null || switchingWorkspace}
                onClick={() => void launch(editor.id, 'editor')}
              >
                {editor.label}{editor.available ? '' : ' — Not installed'}
              </button>
            ))}
          </div>
          {status.launchCommand && (
            <div className={styles.commandBox}>
              <code className={styles.command}>{status.launchCommand}</code>
              <button
                type="button"
                className={styles.ghost}
                disabled={switchingWorkspace}
                onClick={() => void copyCommand()}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
