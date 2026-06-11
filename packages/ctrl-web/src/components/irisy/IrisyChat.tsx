// Irisy chat — thin streaming renderer.
//
// ADR-003 frontend amendment 2026-05-30 + ADR-002 substrate (Brain = Pi sole brain) collapse
// the historical PWA-side ReAct loop. Pi is the single brain, runs its own
// agent loop with full tool access via the kernel MCP server, and streams
// natural-language deltas back through `irisy_chat_stream`. The PWA's job is
// now: render the conversation, manage local UI state (history persistence,
// composer, save-reply), and react to status pings — nothing more.
//
// When Pi isn't reachable yet (brain supervisor + npm install still wiring
// in the zeus lane), Irisy renders a "being upgraded" stub instead of
// silently falling through to Volc or hanging on a spinner. bao 2026-05-30
// "don't block the PR on Pi bridge".

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { invoke } from '@/lib/bridge';
import {
  irisyChatTransport,
  type IrisyCustomMessage,
  type LLMMessage,
} from '@/lib/llm-transport';
import { IrisyCustomMessageView } from './IrisyCustomMessage';
import {
  ensurePromptsBootstrap,
  loadIrisySystemPrompt,
  loadIrisySystemPromptWithSoul,
  IRISY_SYSTEM_DEFAULT,
  loadBrainState,
  formatBrainStateBlock,
  type BrainState,
} from '@/lib/irisy-prompts';
import { ensureMemoryBootstrap, loadCoreMemory } from '@/lib/irisy-memory';
import { listMcps, type McpSummary } from '@/lib/kernel';
import { useSessionStateStore, sessionLabel } from '@/lib/session-state';
// bao 2026-06-05 Pi-first cleanup: PWA-side XML tool dispatch
// (`dispatchAllCalls` / `formatResultsAsUserTurn` /
// `isFrontierNativeProvider`) removed. Pi runs its own agent loop
// internally — it parses tool_use events from the LLM, dispatches
// them via `pi.registerTool` callbacks (wired in ctrl-pi-bridge),
// loops with tool_result back into the next LLM turn, and only
// surfaces a `done` event with the final assistant text. The PWA-
// side XML parse loop predated Pi-first and is now dead code that
// fires once-per-turn and always returns []. `irisy-tool-dispatch.ts`
// is deleted in this commit.
import {
  detectReflectTrigger,
  isCorrectionMessage,
  runReflection,
  type ReflectTurn,
} from '@/lib/irisy-reflection';
import { cleanReplyText } from '@/lib/irisy-render-filter';
// ADR-002 substrate §1 v19 (2026-06-09): Pi RPC rail controls (sessions /
// compact / refresh brain / abort) retired with Pi. The rail keeps only
// the local-state affordances (new chat, clear).
import { ChatHeaderControls } from './ChatHeaderControls';
import styles from './IrisyChat.module.css';

/** Base storage key. ADR-002 substrate § brain v15 (2026-06-07): Coding L1
 *  tab passes `mode="coding"` and its history persists under a separate
 *  suffix so Irisy + Coding chats never bleed into each other. */
const persistKey_BASE = 'irisy:chat:v1';
function chatStorageKey(mode: 'assistant' | 'coding'): string {
  return mode === 'coding'
    ? `${persistKey_BASE}:coding`
    : persistKey_BASE;
}

/** Synchronous snapshot of the store's current mode for the IrisyChat
 *  useState initializer (runs once before any subscription is wired).
 *  ADR-002 substrate § brain v15 (2026-06-07). */
function readInitialMode(): 'assistant' | 'coding' {
  if (typeof window === 'undefined') return 'assistant';
  try {
    return useSessionStateStore.getState().mode === 'coding'
      ? 'coding'
      : 'assistant';
  } catch {
    return 'assistant';
  }
}

interface KernelLlmStatus {
  adapter: string | null;
  ready: boolean;
}

interface McpBridgeStatus {
  handshake_written: boolean;
  handshake_path: string;
}

interface PiStatus {
  mcp_url: string;
  reachable: boolean;
  version: string | null;
}

interface IrisyStatus {
  app_version: string;
  kernel_llm: KernelLlmStatus;
  mcp_bridge: McpBridgeStatus;
  pi?: PiStatus;
  active_brain?: string;
}

interface TextDisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming: boolean;
}

/** Custom (Pi role=custom) message rendered as an inline chip/banner.
 *  Lives in chat history alongside text messages but is NOT sent back
 *  to Pi as context (filtered out in the history map below), since
 *  Pi already has its own session log entry for it. ADR-005 irisy v5 (custom-message relay; orig ADR-009 retired). */
interface CustomDisplayMessage {
  id: string;
  role: 'custom';
  custom: IrisyCustomMessage;
  // streaming kept for shape uniformity with TextDisplayMessage so the
  // restore-from-localStorage map (`{ ...m, streaming: false }`) stays
  // a one-liner.
  streaming: boolean;
}

type DisplayMessage = TextDisplayMessage | CustomDisplayMessage;

const SEED_PROMPTS: readonly string[] = [
  'What can you do here?',
  'List my mcps.',
  'Help me make a clipboard mcp.',
];

// ADR-002 substrate § provider v9 §3.6 (2026-06-06). RETIRED: PWA-side
// `<call name="X">{...}</call>` XML parser + ToolCard split-render.
// Under v9 Pi spawns with the real BYOK provider+model directly, so it
// uses each provider's NATIVE function-calling protocol (Anthropic
// tool_use blocks / OpenAI tool_calls) — no XML scaffolding in the
// assistant's text stream. Tool invocations surface to the PWA as
// separate `tool_use` / `tool_result` message entries from Pi's
// getMessages RPC, which the dispatch upstream routes to the
// CustomDisplayMessage render path, not into AssistantBubble.
// AssistantBubble now renders assistant text as straight markdown.

// Translate Pi RPC error strings into a friendlier first line. Pi's
// rpc-client throws raw strings like "Timeout waiting for response to
// prompt. Stderr: <maybe-empty>", which is accurate but unhelpful for
// the user — they need to know what to do, not which timer fired.
// Keep the original message in `detail` so the expandable panel
// still shows the full stderr tail for diagnostics.
function humanizePiError(
  raw: string,
  activeBrain?: string,
): { summary: string; detail: string } {
  const brain = activeBrain && activeBrain !== 'pi' ? activeBrain : 'the active provider';
  if (raw.startsWith('Timeout waiting for response to')) {
    return {
      summary: `${brain} did not respond. Check provider auth (e.g. run 'claude login') or pick a different provider in Settings.`,
      detail: raw,
    };
  }
  if (raw.startsWith('Agent process exited immediately')) {
    return {
      summary: `Brain subprocess crashed on startup. Check Pi install or provider config.`,
      detail: raw,
    };
  }
  if (raw.startsWith('Timeout waiting for agent to become idle')) {
    return {
      summary: `${brain} is still streaming a previous request. Try again in a moment.`,
      detail: raw,
    };
  }
  const firstLine = raw.split('\n')[0] ?? raw;
  return {
    summary: `Brain error: ${firstLine.slice(0, 120)}`,
    detail: raw,
  };
}

interface AssistantBubbleProps {
  // Only the text variant ever reaches AssistantBubble — the render
  // dispatch in the main map narrows by role before this is rendered.
  // Custom messages get their own renderer.
  message: TextDisplayMessage;
  /**
   * Elapsed ms since the assistant turn started. Zero when not streaming
   * (which lets the memo identity hold across unrelated chunk-driven
   * re-renders).
   */
  elapsedMs: number;
  onSave: (id: string, body: string) => void | Promise<void>;
}

// Memoized so streaming chunks on OTHER messages don't force every prior
// assistant bubble to re-parse + re-render. The parser walks content
// length linearly; over a 10-message history with sub-second deltas, the
// unmemoized version produced visible jank (review P1).
const AssistantBubble = memo(function AssistantBubble({
  message,
  elapsedMs,
  onSave,
}: AssistantBubbleProps): ReactElement {
  const isStreaming = message.streaming;
  // ADR-002 substrate § provider v9 §3.6 (2026-06-06). Tool calls now
  // arrive as separate Pi messages routed to CustomDisplayMessage; the
  // text bubble only ever holds the assistant's prose. Cleanup pipeline:
  // strip qwen-style "Goal / Progress / Done / Next Steps" reasoning
  // scaffolds + <thinking> blocks + bare narration ("Calling …") +
  // internal codenames (Pi / Claude / Ollama / vault_* / install_mcp /
  // brain_status). 7B models can't suppress via prompt — render-side
  // filter is the backstop. See `lib/irisy-render-filter.ts` for rules
  // + SOTA verbatim quotes (Cursor "NEVER refer to tool names", Cline
  // "STRICTLY FORBIDDEN from starting with 'Great'", Claude Code "less
  // than 4 lines"). Brainstorm: `.olym/brainstorm/irisy-reply-specs-
  // 2026-06-04.md` §2.
  const cleaned = useMemo(
    () => cleanReplyText(message.content),
    [message.content],
  );
  const hasRenderable = cleaned.length > 0;
  return (
    <article
      className={`${styles.assistantBubble} ${styles.markdownBody}`}
      aria-live={isStreaming ? 'polite' : undefined}
    >
      <div className={styles.bubbleContent}>
        {hasRenderable ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
        ) : isStreaming ? (
          <div className={styles.thinking}>
            <span className={styles.thinkingDots}>
              <span></span>
              <span></span>
              <span></span>
            </span>
            <span className={styles.thinkingLabel}>
              Thinking · {(elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
        ) : (
          ''
        )}
      </div>
      {!isStreaming && message.content && (
        <button
          type="button"
          className={styles.saveBtn}
          title="Save this reply to vault/irisy/replies/"
          onClick={() => void onSave(message.id, message.content)}
          aria-label="Save reply to Notes"
        >
          ✓
        </button>
      )}
    </article>
  );
});

function buildSystemPrompt(
  systemBase: string,
  mcps: ReadonlyArray<McpSummary>,
  longTermMemory: string,
  coreMemory: string,
  brainState: BrainState | null,
): string {
  const sections: string[] = [systemBase];

  // bao 2026-06-05 Pi-first amendment to ADR-002 § provider v2 §3.7:
  // the brain_state inject is INTENTIONALLY dropped. After d71a65a +
  // 795d20a, Pi connects directly to its own LLM provider (Claude Pro
  // via pi-claude-auth, or whatever PI_PROVIDER/PI_MODEL is set to).
  // CTRL's provider_registry no longer routes the chat call, so the
  // brain_state snapshot here lags Pi's real-time state — when CTRL
  // still has `irisy.primary = ollama-local` in its registry but Pi
  // is actually calling Claude, the LLM dutifully quotes the stale
  // brand label and the user gets a wrong-model answer.
  //
  // Pi knows its own provider/model and the LLM can self-describe
  // accurately without a CTRL-side injection. brainState is still
  // loaded for the StatusBar / Settings → Providers chip (different
  // surface), just not pushed into the system prompt.
  void brainState;

  // bao 2026-06-05 Pi-first: the entire Frontier-native overlay
  // discussion (ADR-002 § brain v7 §1.1 + ADR-005 irisy v4 §7.6 hotfix
  // 2026-06-04) is now moot. Pi itself owns tool calling. There is no
  // PWA-side XML overlay vs native function-call branching to choose
  // between — Pi runs its agent loop natively, the PWA observes the
  // final answer. The `isFrontierNativeProvider` import + this whole
  // toggle were removed alongside irisy-tool-dispatch.ts.

  if (coreMemory.trim().length > 0) {
    sections.push(`# Core memory (loaded from vault/.irisy-memory/)\n${coreMemory.trim()}`);
  }

  if (longTermMemory.trim().length > 0) {
    sections.push(
      `# Long-term memory (vault/irisy/SOUL.md)\n${longTermMemory.trim()}`,
    );
  }

  if (mcps.length === 0) {
    sections.push(
      '# Installed mcps\n(none yet — you can install one by dragging a card onto the Keyboard, or ask Irisy to make one)',
    );
  } else {
    const lines = mcps.map(
      (k) => `- ${k.id} · ${k.name} · ${k.icon} (${k.mcp_color})`,
    );
    sections.push(
      `# Installed mcps (${mcps.length})\n${lines.join('\n')}`,
    );
  }
  return sections.join('\n\n');
}

/** ADR-002 substrate § brain v15 (2026-06-07) — `forceMode` lets the L1
 *  Coding tab mount this chat with `mode="coding"` independent of the
 *  global session-state store (which the Irisy tab also reads from). When
 *  unset, behaves exactly as before: reads `mode` from the store, so the
 *  homepage Irisy chat keeps tracking project-dir / cap toggles. */
interface IrisyChatProps {
  forceMode?: 'assistant' | 'coding';
}

export function IrisyChat({ forceMode }: IrisyChatProps = {}): React.ReactElement {
  // ADR-002 substrate § brain v15 (2026-06-07): resolve mode BEFORE the
  // useState initializer so it can pick the mode-specific storage key on
  // first render. `useSessionStateStore.getState()` reads the store
  // synchronously without subscribing — the subscribed read below keeps
  // the chat reactive to store changes for the no-forceMode case.
  const persistKey = chatStorageKey(forceMode ?? readInitialMode());

  const [status, setStatus] = useState<IrisyStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [mcps, setMcps] = useState<McpSummary[]>([]);
  const [longTermMemory, setLongTermMemory] = useState<string>('');
  const [coreMemory, setCoreMemory] = useState<string>('');
  const [systemBase, setSystemBase] = useState<string>(IRISY_SYSTEM_DEFAULT);
  const [brainState, setBrainState] = useState<BrainState | null>(null);

  // `?fresh=1` from the homepage's "New chat" hand-off clears the
  // persisted conversation before this component reads it. Folded into
  // the useState initializer so it runs exactly once (Strict Mode-safe);
  // a previous version ran the flush in the render body and would wipe
  // a valid chat on a double render (review P1).
  const [messages, setMessages] = useState<DisplayMessage[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('fresh') === '1') {
        window.localStorage.removeItem(persistKey);
        return [];
      }
    } catch {
      // URL parsing failed — fall through to normal restore path
    }
    try {
      const raw = window.localStorage.getItem(persistKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((m): m is DisplayMessage => {
          if (typeof m !== 'object' || m === null) return false;
          const role = (m as Record<string, unknown>).role;
          return role === 'user' || role === 'assistant' || role === 'custom';
        })
        .map((m) => ({ ...m, streaming: false }));
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendingStartedAt, setSendingStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [chatError, setChatError] = useState<{ summary: string; detail: string } | null>(null);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // bao 2026-06-04 (3-mode full): session state is global (persisted to
  // localStorage via zustand) so Coding mode can be entered from L1
  // PrimaryRail (file picker → enterCodingMode) while the chat picks up
  // the change live. The catalog `availableSkills` stays local — it's a
  // read-only directory listing pulled once on mount.
  // ADR-002 substrate § brain v17 (2026-06-07): SessionMode is now
  // `'personal' | 'coding'` — the legacy `cap` mode (Pi "wears" a SKILL.md
  // as a one-shot hat) was retired along with the keycap concept it was
  // derived from. Skills are invocable references Irisy reads on demand
  // via `list_skills` / `read_skill`; they are not a session mode. The
  // `wireMode` narrowing below maps the 2-mode store to the on-wire enum
  // the kernel + mcp-server + PiBridge agree on (`'assistant' | 'coding'`).
  const mode = useSessionStateStore((s) => s.mode);
  const wireMode: 'assistant' | 'coding' =
    forceMode ?? (mode === 'coding' ? 'coding' : 'assistant');
  // persistKey was bound at top of component via the synchronous
  // readInitialMode() snapshot so the useState initializer could pick the
  // right localStorage key on first render. We keep using that one to
  // avoid mid-session key churn. ADR-002 substrate § brain v15.
  const projectDir = useSessionStateStore((s) => s.projectDir);
  const [availableSkills, setAvailableSkills] = useState<
    ReadonlyArray<{ name: string; description?: string | null; path: string }>
  >([]);
  useEffect(() => {
    invoke<Array<{ name: string; description?: string | null; path: string }>>(
      'list_local_skills',
      { query: null },
    )
      .then((items) => setAvailableSkills(items ?? []))
      .catch(() => setAvailableSkills([]));
  }, []);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // bao 2026-06-01: IME composition flag. React's controlled `value` + the
  // onChange round-trip break Chinese / Japanese / Korean IME composition
  // (the popup closes mid-keystroke). Track compositionstart/end and skip
  // setInput while composing; commit the final string on compositionend.
  const isComposingRef = useRef(false);

  // Tick elapsed time while a send is in flight so the user sees that
  // something is happening on long calls.
  useEffect(() => {
    if (sendingStartedAt == null) {
      setElapsedMs(0);
      return;
    }
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - sendingStartedAt);
    }, 200);
    return () => window.clearInterval(interval);
  }, [sendingStartedAt]);

  // Persist message history on every change so a tab close / reload
  // doesn't lose the conversation.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (messages.length === 0) {
        window.localStorage.removeItem(persistKey);
      } else {
        window.localStorage.setItem(
          persistKey,
          JSON.stringify(messages),
        );
      }
    } catch {
      // Quota errors are silent — the chat works, persistence just lapses.
    }
  }, [messages]);

  // Pi is THE brain (ADR-002 substrate). irisyChatTransport routes through Pi.
  // When Pi isn't reachable, the chat surface flips to a "being upgraded"
  // stub rather than silently degrading — keeps the user from thinking
  // Irisy is broken or slow.
  const transport = useMemo(() => irisyChatTransport(), []);
  const activeBrain = status?.active_brain ?? 'pi';
  // Post-v19 the Pi probe is dead logic (always unreachable) — gating
  // the composer on it locked fresh installs behind a permanent
  // "being upgraded" stub. The provider router handles the no-provider
  // case with a real error message pointing at Settings instead.
  const upgradeStub = statusError != null;
  void activeBrain;

  const clearConversation = useCallback((): void => {
    setMessages([]);
    setChatError(null);
  }, []);

  const lastUserMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === 'user') return m.content;
    }
    return '';
  }, [messages]);

  const sendMessageRef = useRef<((text: string) => Promise<void>) | null>(null);

  // Cmd/Ctrl+K — clear conversation. Cmd/Ctrl+Enter — send.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'k' || e.key === 'K' || e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        clearConversation();
        return;
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        if (sendMessageRef.current) void sendMessageRef.current(input);
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearConversation, input]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [statusResult, mcpsResult, memoryResult] =
        await Promise.allSettled([
          invoke<IrisyStatus>('irisy_init'),
          listMcps(),
          invoke<{ body?: string; path?: string }>('vault_read', {
            args: { path: 'irisy/SOUL.md' },
          }),
        ]);
      if (cancelled) return;
      if (statusResult.status === 'fulfilled') {
        setStatus(statusResult.value);
      } else {
        const e = statusResult.reason;
        setStatusError(e instanceof Error ? e.message : 'irisy_init failed');
      }
      if (mcpsResult.status === 'fulfilled') {
        setMcps(mcpsResult.value);
      }
      if (memoryResult.status === 'fulfilled') {
        const body = memoryResult.value?.body;
        if (typeof body === 'string') {
          setLongTermMemory(body);
        }
      }
      await Promise.allSettled([
        ensureMemoryBootstrap(),
        ensurePromptsBootstrap(),
      ]);
      if (cancelled) return;
      // ADR-002 substrate § provider v2 §3.7: fetch brain state alongside
      // the base prompt + memory so the first turn already carries the
      // <brain_state> block. Failures yield null and skip injection.
      const [coreMem, sysPrompt, brain] = await Promise.all([
        loadCoreMemory(),
        // SOUL.md substrate injection (ADR-005 v2 § soul-md-compat §4.3) —
        // falls back to bare system prompt when SOUL.md is missing.
        loadIrisySystemPromptWithSoul(),
        loadBrainState(),
      ]);
      if (cancelled) return;
      setCoreMemory(coreMem);
      setSystemBase(sysPrompt);
      setBrainState(brain);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pi-reachability polling. The boot init useEffect above fires once on
  // mount; if Pi was still starting then, pi.reachable was false and the
  // composer stays in the upgrade-stub state forever. Poll irisy_init
  // every 5 s while the stub is showing so the textarea unlocks as soon
  // as the brain comes online — without forcing the user to Cmd+R.
  useEffect(() => {
    if (!upgradeStub) return undefined;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const next = await invoke<IrisyStatus>('irisy_init');
        if (cancelled) return;
        setStatus(next);
        setStatusError(null);
      } catch (e: unknown) {
        if (cancelled) return;
        setStatusError(e instanceof Error ? e.message : 'irisy_init failed');
      }
    };
    const id = window.setInterval(() => {
      void tick();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [upgradeStub]);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      if (upgradeStub) {
        // Refuse silently when the backend isn't wired — the stub view
        // already explains what's happening; bouncing here keeps the
        // composer responsive without a network call.
        return;
      }

      setSending(true);
      setSendingStartedAt(Date.now());
      setChatError(null);
      setErrorExpanded(false);
      const userId = `u-${Date.now()}`;
      const userMsg: DisplayMessage = {
        id: userId,
        role: 'user',
        content: trimmed,
        streaming: false,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');

      // ADR-002 substrate § provider v9 §3.6 (2026-06-06). Pi runs the
      // full agent loop (native function calling via Anthropic tool_use
      // / OpenAI tool_calls per the spawned provider, tool dispatch,
      // multi-hop tool_result feedback, safety cap) inside its own RPC
      // server. PWA sends one user turn, observes the assistant's final
      // text. No PWA-side iter guard, no XML scaffolding in the stream.
      const history: LLMMessage[] = [
        {
          role: 'system',
          content: buildSystemPrompt(
            systemBase,
            mcps,
            longTermMemory,
            coreMemory,
            brainState,
          ),
        },
        // Strip custom messages — Pi already has them in its own
        // session log (we send them, we don't replay them as context).
        // Casts are narrow because the filter eliminates role='custom'.
        ...messages
          .filter((m): m is TextDisplayMessage => m.role !== 'custom')
          .map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: trimmed },
      ];

      // bao 2026-06-05 Pi-first: removed the PWA `for(iter)` tool loop
      // — Pi internally runs the full LLM → tool_use → tool_result →
      // next-LLM-turn cycle and only surfaces the final assistant text
      // through `transport.stream`. PWA observes one stream, accepts
      // text + custom-message chunks, fires sleep-time reflection.
      try {
        const assistantId = `a-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            content: '',
            streaming: true,
          },
        ]);

        let assistantText = '';
        let aborted = false;
        for await (const chunk of transport.stream(history, {
          mode: wireMode,
          project_dir: projectDir ?? undefined,
        })) {
          if (chunk.error) {
            // Pi RPC errors (timeout / Stderr / supervisor crash) get
            // routed into the errorPanel surface so the bubble stays
            // clean and the stderr tail can be expanded.
            setChatError(humanizePiError(String(chunk.error), activeBrain));
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, streaming: false } : m,
              ),
            );
            aborted = true;
            break;
          }
          if (chunk.delta) {
            assistantText += chunk.delta;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId && m.role === 'assistant'
                  ? { ...m, content: m.content + chunk.delta }
                  : m,
              ),
            );
          }
          if (chunk.custom) {
            // ADR-005 irisy v5 (custom-message relay; orig ADR-009 retired) — Pi emitted a role=custom message via the
            // slash command path. Insert it BEFORE the assistant
            // placeholder so it reads as the user's intent, not as
            // the assistant's reply. Falls back to append if the
            // placeholder isn't in the list (shouldn't happen).
            const customMsg = chunk.custom;
            setMessages((prev) => {
              const next: DisplayMessage[] = [...prev];
              const idx = next.findIndex((m) => m.id === assistantId);
              const entry: CustomDisplayMessage = {
                id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                role: 'custom',
                custom: customMsg,
                streaming: false,
              };
              if (idx === -1) next.push(entry);
              else next.splice(idx, 0, entry);
              return next;
            });
          }
          if (chunk.done) break;
        }
        // Stop the streaming spinner; also drop the assistant
        // placeholder entirely when no text arrived (slash command
        // ran without an LLM turn — keeping an empty bubble would
        // confuse the user about whether anything happened).
        setMessages((prev) =>
          prev.flatMap((m) => {
            if (m.id !== assistantId || m.role !== 'assistant') return [m];
            if (assistantText.length === 0) return [];
            return [{ ...m, streaming: false }];
          }),
        );
        if (aborted) return;

        // ADR-005 irisy v4 §5 (2026-06-04): fire sleep-time reflection
        // after every turn. Best-effort, fire-and-forget so the user's
        // next turn is never blocked. Only triggers when the Detect
        // rules say it's worth writing an episode.
        const trigger = detectReflectTrigger({
          recentTurns: [],
          lastTurnHadToolError: false,
          lastUserTurnIsCorrection: isCorrectionMessage(trimmed),
        });
        if (trigger) {
          const recentTurns: ReflectTurn[] = [
            ...messages
              .slice(-6)
              .filter((m): m is TextDisplayMessage => m.role !== 'custom')
              .map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: trimmed },
            { role: 'assistant', content: assistantText },
          ];
          const activeProviderId =
            brainState?.providers?.['irisy.primary']?.id ?? null;
          void runReflection({
            trigger,
            recentTurns,
            activeProviderId,
            streamFn: async (systemPrompt, userPrompt) => {
              let acc = '';
              for await (const chunk of transport.stream(
                [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userPrompt },
                ],
                {},
              )) {
                if (chunk.error) break;
                if (chunk.delta) acc += chunk.delta;
                if (chunk.done) break;
              }
              return acc;
            },
          });
        }
      } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        setChatError(humanizePiError(detail, activeBrain));
        setMessages((prev) =>
          prev.map((m) =>
            m.role === 'assistant' && m.streaming ? { ...m, streaming: false } : m,
          ),
        );
      } finally {
        setSending(false);
        setSendingStartedAt(null);
      }
    },
    // ADR-002 substrate § brain v17 (2026-06-07): currentSkillId removed
    // from session-state along with the retired cap mode; deps shrink.
    [
      brainState,
      coreMemory,
      mcps,
      longTermMemory,
      messages,
      mode,
      projectDir,
      sending,
      systemBase,
      transport,
      upgradeStub,
    ],
  );

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // Homepage hand-off: `/?text=<encoded>` from default.tsx's ChatInput
  // navigates here with the user's first message.
  const prefillFiredRef = useRef(false);
  useEffect(() => {
    if (prefillFiredRef.current) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const text = params.get('text');
    if (!text) return;
    prefillFiredRef.current = true;
    params.delete('text');
    params.delete('fresh');
    const qs = params.toString();
    const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    window.history.replaceState({}, '', newUrl);
    void sendMessage(text);
  }, [sendMessage]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // bao 2026-06-05 b: CJK IME Enter-confirm was dropping into send()
    // because some IMEs (observed: Squirrel, macOS Pinyin) confirm a
    // candidate without firing compositionend before the keydown — so
    // `nativeEvent.isComposing` reads false. Fall back to the manual
    // compositionstart ref AND the legacy keyCode 229 sentinel that
    // every Chromium-based webview still emits during IME composition.
    const native = e.nativeEvent as KeyboardEvent;
    const composing =
      native.isComposing ||
      isComposingRef.current ||
      native.keyCode === 229;
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !composing &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      e.preventDefault();
      // bao 2026-05-31 b: the textarea is not inside a <form>, so
      // requestSubmit() does nothing. Send directly via the ref.
      const text = input.trim();
      if (text && sendMessageRef.current) {
        void sendMessageRef.current(text);
      }
      return;
    }
    if (e.key === 'ArrowUp' && input.length === 0 && lastUserMessage) {
      e.preventDefault();
      setInput(lastUserMessage);
    }
  };

  const saveReplyToVault = useCallback(
    async (assistantId: string, body: string): Promise<void> => {
      const ts = new Date();
      const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(
        ts.getDate(),
      ).padStart(2, '0')}-${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}`;
      const path = `irisy/replies/${stamp}-${assistantId.slice(-6)}.md`;
      try {
        await invoke('vault_write', {
          args: {
            path,
            content: body,
            frontmatter: {
              kind: 'irisy-reply',
              saved_at: ts.toISOString(),
              assistant_id: assistantId,
            },
          },
        });
        setStatusMessage(`Saved → vault/${path}`);
        window.setTimeout(() => setStatusMessage(null), 4000);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setChatError({ summary: `Save failed: ${msg.slice(0, 120)}`, detail: msg });
      }
    },
    [],
  );

  // Transient confirmation strip (e.g. "Saved -> vault/...") rendered
  // just above the composer. Auto-dismissed by saveReplyToVault's 4 s
  // setTimeout; click-to-dismiss as a fallback.

  if (upgradeStub) {
    return (
      <div className={styles.root}>
        <div className={styles.scrollerWrap}>
          <div className={`${styles.scroller} irisy-scroll`}>
            <div className={styles.welcome}>
              <h2>Irisy is being upgraded.</h2>
              <p>
                Pi (the brain) isn&rsquo;t connected yet. The kernel + brain
                supervisor are wiring up in a parallel lane. Chat returns
                automatically once Pi is reachable.
              </p>
              <p className={styles.upgradeHint}>
                Mcps still work — drag one onto the Keyboard to install,
                click a cell to run.
              </p>
            </div>
          </div>
        </div>
        <div className={styles.composer}>
          <textarea
            className={styles.composerInput}
            placeholder="Connecting…"
            rows={1}
            disabled
            aria-label="Message Irisy (disabled during upgrade)"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {/* Mode banner — ADR-002 substrate § brain v17 (2026-06-07).
          Cap mode + keycap concept retired; banner now only fires for
          coding mode with a project dir set. Personal mode hides
          entirely (cleanest default). */}
      {mode === 'coding' && projectDir && (
        <div
          style={{
            padding: '6px 12px',
            borderBottom: '1px solid var(--surface-border, rgba(0,0,0,0.08))',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            background: 'var(--surface-elevated, rgba(0,0,0,0.02))',
            color: 'var(--text-muted, #6b7280)',
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {`Coding · ${projectDir}`}
          </span>
        </div>
      )}
      <ChatHeaderControls />
      <div className={styles.scrollerWrap}>
        {/* Right-rail control stack — vertical, 22x22 each. ADR-002
            substrate §1 v19: the Pi RPC controls (history / compact /
            refresh brain / abort) retired with Pi; what remains operates
            on local PWA state only. */}
        <div className={styles.controlRail}>
          <button
            type="button"
            className={styles.railButton}
            onClick={() => {
              setMessages([]);
              setChatError(null);
              setStatusMessage('Started new chat.');
              window.setTimeout(() => setStatusMessage(null), 2500);
            }}
            aria-label="New conversation"
            title="New chat"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              className={styles.railButton}
              onClick={clearConversation}
              aria-label="Clear conversation"
              title="Clear chat"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          )}
        </div>
        {/* Legacy clearFloating retained for compatibility but visually
            replaced by railButton — kept hidden so the test selector
            (aria-label=Clear conversation) inside controlRail still
            matches without changing reviewer mental model. */}

        <div className={`${styles.scroller} irisy-scroll`} ref={scrollerRef}>
          {messages.length === 0 && (
            <div className={styles.welcome}>
              <h2>Hi, I&rsquo;m Irisy.</h2>
              <p>I live inside CTRL. Ask me anything — or try:</p>
              <ul>
                {SEED_PROMPTS.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      onClick={() => void sendMessage(p)}
                      disabled={sending}
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {messages.map((m, i) => {
            const prev = i > 0 ? messages[i - 1] : null;
            const showSep = prev != null && prev.role !== m.role;
            // ADR-005 irisy v5 (custom-message relay; orig ADR-009 retired) — custom messages are inline chips/banners,
            // rendered via dispatch before the text branches so the
            // assistant/user TS narrows below.
            if (m.role === 'custom') {
              return (
                <div key={m.id}>
                  {showSep && <div className={styles.turnSeparator} />}
                  <IrisyCustomMessageView
                    msg={m.custom}
                    onDismiss={() =>
                      setMessages((prev) => prev.filter((x) => x.id !== m.id))
                    }
                  />
                </div>
              );
            }
            if (m.role === 'assistant') {
              return (
                <div key={m.id}>
                  {showSep && <div className={styles.turnSeparator} />}
                  <AssistantBubble
                    message={m}
                    elapsedMs={m.streaming ? elapsedMs : 0}
                    onSave={saveReplyToVault}
                  />
                </div>
              );
            }
            return (
              <div key={m.id}>
                {showSep && <div className={styles.turnSeparator} />}
                <article
                  className={styles.userBubble}
                  aria-live={m.streaming ? 'polite' : undefined}
                >
                  <span className={styles.bubbleContent}>{m.content}</span>
                </article>
              </div>
            );
          })}
        </div>

        {chatError != null && (
          <div className={styles.errorPanel}>
            <button
              type="button"
              className={styles.errorSummary}
              onClick={() => setErrorExpanded((v) => !v)}
            >
              <span>{chatError.summary}</span>
              <span className={styles.errorToggle}>{errorExpanded ? '▾' : '▸'}</span>
            </button>
            {errorExpanded && (
              <pre className={styles.errorDetail}>{chatError.detail}</pre>
            )}
            <button
              type="button"
              className={styles.errorDismiss}
              onClick={() => setChatError(null)}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {statusMessage && (
        <button
          type="button"
          className={styles.statusStrip}
          onClick={() => setStatusMessage(null)}
          aria-label="Dismiss save confirmation"
        >
          {statusMessage}
        </button>
      )}

      {/* Composer — input + dialog merged into one column (bao 2026-05-31).
          The previous design hid this textarea off-screen and ran the
          actual input from a separate Tauri companion window. That window
          is now retired; the input lives at the bottom of the Irisy chat
          column and the message list flows above it. */}
      <div className={styles.composer}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            // Prefer the browser-native isComposing flag (carried on
            // the underlying InputEvent) over our manual ref — the ref
            // can get stuck true on macOS when an IME session ends
            // without firing compositionend (observed in v0.1.142 with
            // certain CJK input methods, then ASCII typing was
            // silently dropped). The manual ref stays as a safety net
            // for browsers that don't surface isComposing.
            const native = e.nativeEvent as InputEvent;
            if (native.isComposing || isComposingRef.current) {
              if (!native.isComposing) {
                // Composition ref says yes but native says no -> stuck
                // ref. Clear it and commit the value.
                isComposingRef.current = false;
              } else {
                return;
              }
            }
            setInput(e.target.value);
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            isComposingRef.current = false;
            setInput(e.currentTarget.value);
          }}
          onKeyDown={onInputKeyDown}
          className={styles.composerInput}
          placeholder="Message Irisy…"
          rows={1}
          aria-label="Message Irisy"
        />
      </div>
    </div>
  );
}
