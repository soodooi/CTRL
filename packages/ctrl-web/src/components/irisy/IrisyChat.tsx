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
  defaultTransport,
  engineTransport,
  type IrisyCustomMessage,
  // Attachments module (ADR-002 substrate §1.8.6 v75; ADR-005 irisy §8.7 v32).
  type LLMAttachment,
  type LLMMessage,
} from '@/lib/llm-transport';
import { IrisyCustomMessageView } from './IrisyCustomMessage';
import {
  ensurePromptsBootstrap,
  loadIrisySystemPrompt,
  loadIrisySystemPromptWithSoul,
  IRISY_SYSTEM_DEFAULT,
  loadBrainState,
  // composeSystemPrompt owns the <brain_state> inject per ADR-005 irisy v5
  // §6.4 (assembly order); formatBrainStateBlock is no longer called here.
  composeSystemPrompt,
  type BrainState,
} from '@/lib/irisy-prompts';
import { ensureMemoryBootstrap, loadCoreMemory } from '@/lib/irisy-memory';
// gateInvoke routes capability calls through the :17873 gate, not a private
// Tauri command (ADR-002 substrate §14 v29 (2026-06-24) — platform API; gate is
// the single governed surface).
// ADR-002 substrate § vault v1 §8.3 (2026-06-01): saveReplyToVault writes via
// the vaultWrite wrapper (maps content→body for the gate's VaultWriteArgs).
import { gateInvoke, resetEngine, vaultWrite, listMcps, type McpSummary } from '@/lib/kernel';
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
// ADR-005 irisy §8.7 v40: humanizePiError shared with AmbientHome so both
// surfaces show the same friendly engine-error line. The selectable-persona
// section this line used to cite was retired in v40; §8.7 owns the one fixed
// identity that replaced it.
import { cleanReplyText, humanizePiError } from '@/lib/irisy-render-filter';
// ADR-002 substrate §1 v19 (2026-06-09): Pi RPC rail controls (sessions /
// compact / refresh brain / abort) retired with Pi. The rail keeps only
// the local-state affordances (new chat, clear).
import { ChatHeaderControls } from './ChatHeaderControls';
import { CapabilityFloor } from './CapabilityFloor';
// Kiro-style redesign — Session module (ADR-005 irisy §8.7 v32; ADR-003
// frontend §8.6 v36): multi-session store replaces the single localStorage
// conversation this component used to own directly.
import {
  deriveSessionLabel,
  ensureActiveIrisySession,
  migrateLegacySingleSession,
  useIrisySessionsStore,
  type IrisySessionMessage,
} from '@/lib/irisy-sessions';
// (ADR-005 irisy §8.7 v32; ADR-003 frontend §8.6 v36)
import { SessionTabs } from './SessionTabs';
// Kiro-style redesign — Attachments module (ADR-002 substrate §1.8.6 v75;
// ADR-005 irisy §8.7 v32): the same native-drop mechanism Coding uses,
// reading dropped files server-side rather than via browser File APIs.
import { useNativeFileDrop } from '@/lib/native-file-drop';
import styles from './IrisyChat.module.css';

const LEGACY_IRISY_TRANSCRIPT_KEY = 'irisy:chat:v1';

interface KernelLlmStatus {
  adapter: string | null;
  ready: boolean;
}

interface McpBridgeStatus {
  handshake_written: boolean;
  handshake_path: string;
}

interface IrisyStatus {
  app_version: string;
  kernel_llm: KernelLlmStatus;
  mcp_bridge: McpBridgeStatus;
  active_brain?: string;
}

// TextDisplayMessage / CustomDisplayMessage / DisplayMessage now live in
// `lib/irisy-sessions.ts` as `IrisyTextMessage` / `IrisyCustomDisplayMessage`
// / `IrisySessionMessage` — one shape shared by the store and this
// component instead of a locally-duplicated one (Kiro-style Session module,
// ADR-005 irisy §8.7 v32). Local aliases kept so the rest of this file's
// existing `TextDisplayMessage`/`DisplayMessage` references don't all need
// renaming in this change.
type TextDisplayMessage = Extract<IrisySessionMessage, { role: 'user' | 'assistant' }>;
type CustomDisplayMessage = Extract<IrisySessionMessage, { role: 'custom' }>;
type DisplayMessage = IrisySessionMessage;

// ADR-002 substrate §14 v45 + ADR-005 irisy §8.7 v32.
interface ImportedSource {
  path: string;
  name: string;
  content: string;
}

interface ImportSourcesReply {
  files: ImportedSource[];
  skipped: string[];
}

function importSlug(value: string): string {
  return value
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'source';
}

function importedMarkdown(source: ImportedSource): string {
  return `# ${source.name}\n\n> Imported from: \`${source.path}\`\n\n---\n\n${source.content.trim()}\n`;
}

// ADR-002 substrate §14 v45 + ADR-005 irisy §8.7 v32: selected local files
// become plain Markdown notes, not transient ACP attachments, so the result
// remains readable and searchable after the conversation ends.

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

// ADR-005 irisy §8.7 v40 (2026-06-09): humanizePiError moved to
// lib/irisy-render-filter.ts (shared with AmbientHome's homepage composer).

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
  // than 4 lines"). Brainstorm: `vault/ctrl/history/brainstorm/irisy-reply-specs-
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

// Thin wrapper over the shared composeSystemPrompt (lib/irisy-prompts) so the
// docked chat and the AmbientHome home composer assemble identical prompts.
// brain_state is now injected again — the 2026-06-05 Pi-first drop is obsolete
// (Pi retired, chat routes through CTRL's registry; see composeSystemPrompt).
function buildSystemPrompt(
  systemBase: string,
  mcps: ReadonlyArray<McpSummary>,
  longTermMemory: string,
  coreMemory: string,
  brainState: BrainState | null,
): string {
  return composeSystemPrompt({
    base: systemBase,
    brainState,
    coreMemory,
    longTermMemory,
    mcps,
  });
}

/** One mounted Irisy surface backed only by the canonical session store.
 *  (ADR-003 frontend §8.5 v40; ADR-005 irisy §11 v40) */
export function IrisyChat(): React.ReactElement {
  useEffect(() => {
    migrateLegacySingleSession(LEGACY_IRISY_TRANSCRIPT_KEY);
    ensureActiveIrisySession();
  }, []);
  const sessions = useIrisySessionsStore((state) => state.sessions);
  const activeSessionId = useIrisySessionsStore((state) => state.activeSessionId);
  const setSessionMessages = useIrisySessionsStore((state) => state.setMessages);
  const clearSessionMessages = useIrisySessionsStore((state) => state.clearSessionMessages);
  const renameSession = useIrisySessionsStore((state) => state.renameSession);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const messages: DisplayMessage[] = activeSession?.messages ?? [];
  const setMessages = useCallback(
    (updater: DisplayMessage[] | ((previous: DisplayMessage[]) => DisplayMessage[])): void => {
      if (!activeSessionId) return;
      setSessionMessages(activeSessionId, (previous) =>
        typeof updater === 'function' ? updater(previous) : updater,
      );
    },
    [activeSessionId, setSessionMessages],
  );

  const engineResetRef = useRef<Promise<void>>(Promise.resolve());
  const queueEngineReset = useCallback((): Promise<void> => {
    const next = engineResetRef.current
      .catch(() => undefined)
      .then(() => resetEngine());
    engineResetRef.current = next;
    return next;
  }, []);

  // The canonical store owns all mounted transcript state, and a visible
  // session moves with the sole managed ACP owner. (ADR-005 irisy §11 v40)
  useEffect(() => {
    if (!activeSessionId) return;
    void queueEngineReset().catch(() => undefined);
  }, [activeSessionId, queueEngineReset]);

  // Runtime status and composer state do not create another transcript owner.
  // (ADR-005 irisy §11 v40)
  const [status, setStatus] = useState<IrisyStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [mcps, setMcps] = useState<McpSummary[]>([]);
  const [longTermMemory, setLongTermMemory] = useState<string>('');
  const [coreMemory, setCoreMemory] = useState<string>('');
  const [systemBase, setSystemBase] = useState<string>(IRISY_SYSTEM_DEFAULT);
  const [brainState, setBrainState] = useState<BrainState | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendingStartedAt, setSendingStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [chatError, setChatError] = useState<{ summary: string; detail: string } | null>(null);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // Kiro-style redesign — Attachments module (ADR-002 substrate §1.8.6 v75;
  // ADR-005 irisy §8.7 v32). Same mechanism Coding's composer uses: files
  // dropped anywhere in the chat root are read server-side from their
  // absolute path, never via the browser File API. Cleared once a turn is
  // sent.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<LLMAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const handleFileDrop = useCallback((paths: string[]): void => {
    setPendingAttachments((prev) => {
      const existing = new Set(prev.map((a) => a.path));
      const added = paths
        .filter((p) => !existing.has(p))
        .map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p }));
      return added.length > 0 ? [...prev, ...added] : prev;
    });
    setDragOver(false);
  }, []);
  const dropHandlers = useMemo(
    () => ({
      onDrop: handleFileDrop,
      onDragOver: () => setDragOver(true),
      onDragLeave: () => setDragOver(false),
    }),
    [handleFileDrop],
  );
  useNativeFileDrop(rootRef, dropHandlers);
  const removeAttachment = useCallback((path: string): void => {
    setPendingAttachments((prev) => prev.filter((a) => a.path !== path));
  }, []);
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

  // (ADR-005 irisy §8.7 v32; ADR-003 frontend §8.6 v36)
  // Auto-title a fresh "New Session" tab from the first user message —
  // matches Kiro's own tab-titling-from-the-prompt behavior. Only fires
  // once per session (the label stays user-editable via double-click
  // afterward; this effect never overwrites a rename).
  const autoLabeledSessionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeSession) return;
    if (autoLabeledSessionsRef.current.has(activeSession.id)) return;
    if (activeSession.label !== 'New Session') {
      autoLabeledSessionsRef.current.add(activeSession.id);
      return;
    }
    const firstUser = activeSession.messages.find(
      (m): m is TextDisplayMessage => m.role === 'user',
    );
    if (!firstUser) return;
    autoLabeledSessionsRef.current.add(activeSession.id);
    renameSession(activeSession.id, deriveSessionLabel(firstUser.content));
  }, [activeSession, renameSession]);

  // Pi is THE brain (ADR-002 substrate). irisyChatTransport routes through Pi.
  // When Pi isn't reachable, the chat surface flips to a "being upgraded"
  // stub rather than silently degrading — keeps the user from thinking
  // Irisy is broken or slow.
  const transport = useMemo(() => engineTransport(), []);
  // Reflection is stateless provider work. It must never mutate Hermes's
  // persistent session behind the canonical transcript authority.
  // (ADR-005 irisy §11 v40)
  const reflectionTransport = useMemo(() => defaultTransport(), []);
  const activeBrain = status?.active_brain ?? 'pi';
  // Post-v19 the Pi probe is dead logic (always unreachable) — gating
  // the composer on it locked fresh installs behind a permanent
  // "being upgraded" stub. The provider router handles the no-provider
  // case with a real error message pointing at Settings instead.
  const upgradeStub = statusError != null;
  void activeBrain;

  const sendMessageRef = useRef<((text: string) => Promise<void>) | null>(null);
  // Per-turn abort handle — drives Stop, clear, and interrupt-and-redirect.
  // (ADR-005 irisy §11 v40)
  const abortRef = useRef<AbortController | null>(null);

  // Clear aborts visible delivery, clears the canonical transcript, and queues
  // replacement of the matching Hermes owner. The next send waits for reset.
  // (ADR-005 irisy §11 v40)
  const clearConversation = useCallback((): void => {
    abortRef.current?.abort();
    if (activeSessionId) {
      clearSessionMessages(activeSessionId);
      void queueEngineReset().catch((error: unknown) => {
        setChatError(humanizePiError(String(error), activeBrain));
      });
    }
    setChatError(null);
  }, [activeBrain, activeSessionId, clearSessionMessages, queueEngineReset]);

  // Stop cancels and drains the active ACP request before owner reuse.
  // (ADR-005 irisy §11 v40)
  const stopGeneration = useCallback((): void => {
    abortRef.current?.abort();
    void queueEngineReset().catch((error: unknown) => {
      setChatError(humanizePiError(String(error), activeBrain));
    });
  }, [activeBrain, queueEngineReset]);

  // The last user turn, so a retry re-sends what was actually asked rather than
  // whatever happens to be in the composer.
  // (ADR-005 irisy §8.7 v40)
  const lastUserMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === 'user') return m.content;
    }
    return '';
  }, [messages]);

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
      if (!trimmed || !activeSessionId || !activeSession) return;
      if (upgradeStub) {
        // Refuse silently when the backend isn't wired — the stub view
        // already explains what's happening; bouncing here keeps the
        // composer responsive without a network call.
        return;
      }

      // Session switches and clear operations replace the Hermes owner before
      // this canonical transcript can submit another turn.
      // (ADR-005 irisy §11 v40)
      try {
        await engineResetRef.current;
      } catch (error: unknown) {
        setChatError(humanizePiError(String(error), activeBrain));
        return;
      }

      // Interrupt-and-redirect cancels and drains the active ACP request through
      // the existing reset command before another turn can reuse the owner.
      // (ADR-005 irisy §11 v40)
      if (abortRef.current) {
        abortRef.current.abort();
        try {
          await queueEngineReset();
        } catch (error: unknown) {
          setChatError(humanizePiError(String(error), activeBrain));
          return;
        }
      }
      const ac = new AbortController();
      abortRef.current = ac;

      setSending(true);
      setSendingStartedAt(Date.now());
      setChatError(null);
      setErrorExpanded(false);
      // ADR-005 irisy §8.7 v40 (2026-06-09): random suffix so
      // same-millisecond sends (interrupt-redirect / ?text= prefill / double
      // Enter) don't collide into one id and misroute deltas / dup React keys.
      const turnSuffix = Math.random().toString(36).slice(2, 8);
      const userId = `u-${Date.now()}-${turnSuffix}`;
      // (ADR-002 substrate §1.8.6 v75; ADR-005 irisy §8.7 v32)
      const attachmentsForTurn = pendingAttachments;
      setPendingAttachments([]);
      const attachmentSuffix = attachmentsForTurn.length > 0
        ? `\n\n[Attached: ${attachmentsForTurn.map((a) => a.name).join(', ')}]`
        : '';
      const userMsg: DisplayMessage = {
        id: userId,
        role: 'user',
        content: `${trimmed}${attachmentSuffix}`,
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
        // ADR-005 irisy §8.7 v40 (2026-06-09): share the turn's
        // random suffix so the assistant id can't collide with the user id.
        const assistantId = `a-${Date.now()}-${turnSuffix}`;
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
        // (ADR-002 substrate §1.8.6 v75; ADR-005 irisy §8.7 v32)
        for await (const chunk of transport.stream(history, {
          signal: ac.signal,
          attachments: attachmentsForTurn,
          context: {
            session_id: activeSessionId,
            resources: activeSession.resources,
            capability_scope: ['describe', 'query', 'produce'],
            policy: 'review-gated-writes',
            task: trimmed,
          },
        })) {
          if (chunk.error === 'aborted') {
            // User pressed Stop or sent a new message — end quietly, no banner.
            aborted = true;
            break;
          }
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
          // Reflection is stateless and cannot become a second transcript owner.
          // (ADR-005 irisy §11 v40)
          void runReflection({
            trigger,
            recentTurns,
            activeProviderId,
            streamFn: async (systemPrompt, userPrompt) => {
              let acc = '';
              for await (const chunk of reflectionTransport.stream(
                [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userPrompt },
                ],
                { signal: ac.signal },
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
        // Only the currently-active turn clears `sending` — an interrupted
        // (superseded) turn must not flip it off under the new turn.
        if (abortRef.current === ac) {
          setSending(false);
          setSendingStartedAt(null);
          abortRef.current = null;
        }
      }
    },
    // ADR-002 substrate § brain v17 (2026-06-07): currentSkillId removed
    // from session-state along with the retired cap mode; deps shrink.
    [
      // ADR-005 irisy §8.7 v40 (2026-06-09): activeBrain feeds
      // humanizePiError, so it must be a dep or error copy names a stale
      // provider after a brain switch.
      activeBrain,
      activeSession,
      activeSessionId,
      brainState,
      coreMemory,
      mcps,
      longTermMemory,
      messages,
      pendingAttachments,
      queueEngineReset,
      setMessages,
      systemBase,
      transport,
      upgradeStub,
    ],
  );

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // Unmount aborts delivery and starts the same cancel-and-drain reset so no
  // orphaned prompt can remain reusable. (ADR-005 irisy §11 v40)
  useEffect(
    () => (): void => {
      abortRef.current?.abort();
      void queueEngineReset().catch(() => undefined);
    },
    [queueEngineReset],
  );

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

  // ADR-002 substrate §14 v45 + ADR-005 irisy §8.7 v32.
  // This is a local import flow, so it writes Markdown through the existing
  // governed vault capability instead of sending selected content to the chat engine.
  const importSelectedSources = useCallback(
    async (paths: string[] = [], folder: string | null = null): Promise<void> => {
      setImportMenuOpen(false);
      setImporting(true);
      try {
        const result = await invoke<ImportSourcesReply>('read_import_sources', { paths, folder });
        if (result.files.length === 0) {
          const detail = result.skipped[0] ?? 'No readable UTF-8 text files were found.';
          throw new Error(detail);
        }
        const now = new Date();
        const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
          now.getDate(),
        ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(
          now.getMinutes(),
        ).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        for (const [index, source] of result.files.entries()) {
          const suffix = result.files.length > 1 ? `-${String(index + 1).padStart(2, '0')}` : '';
          await vaultWrite({
            path: `irisy/imports/${stamp}-${importSlug(source.name)}${suffix}.md`,
            content: importedMarkdown(source),
            frontmatter: {
              kind: 'irisy-import',
              imported_at: now.toISOString(),
              source_name: source.name,
              source_path: source.path,
            },
          });
        }
        const skippedText = result.skipped.length > 0 ? `; skipped ${result.skipped.length}` : '';
        setStatusMessage(`Imported ${result.files.length} file${result.files.length === 1 ? '' : 's'} to vault/irisy/imports${skippedText}`);
        window.setTimeout(() => setStatusMessage(null), 5000);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setChatError({ summary: `Import failed: ${message.slice(0, 120)}`, detail: message });
      } finally {
        setImporting(false);
      }
    },
    [],
  );
  const chooseImportFiles = useCallback(async (): Promise<void> => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: false,
      multiple: true,
      title: 'Choose files to import as Markdown',
    });
    if (Array.isArray(selected)) await importSelectedSources(selected, null);
    else if (typeof selected === 'string') await importSelectedSources([selected], null);
  }, [importSelectedSources]);
  const chooseImportFolder = useCallback(async (): Promise<void> => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Choose a folder to import as Markdown',
    });
    if (typeof selected === 'string') await importSelectedSources([], selected);
  }, [importSelectedSources]);

  const saveReplyToVault = useCallback(
    async (assistantId: string, body: string): Promise<void> => {
      const ts = new Date();
      const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(
        ts.getDate(),
      ).padStart(2, '0')}-${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}`;
      const path = `irisy/replies/${stamp}-${assistantId.slice(-6)}.md`;
      try {
        // ADR-002 substrate §14 v45: vaultWrite maps content→body for the
        // gate's VaultWriteArgs (raw gate_invoke with a `content` field
        // serde-fails on the required `body`).
        await vaultWrite({
          path,
          content: body,
          frontmatter: {
            kind: 'irisy-reply',
            saved_at: ts.toISOString(),
            assistant_id: assistantId,
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
              <h2>Irisy is connecting.</h2>
              <p>
                The kernel is still wiring up. Chat returns automatically once
                the brain is reachable. If this persists, check your provider in
                Settings.
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
    <div className={styles.root} ref={rootRef} data-drag-over={dragOver ? 'true' : undefined}>
      {dragOver && (
        <div className={styles.dropOverlay} aria-hidden>
          Drop to attach
        </div>
      )}
      <ChatHeaderControls />
      <SessionTabs />
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
              useIrisySessionsStore.getState().createSession();
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
          {/* Stop — abort the in-flight turn (ADR-005 irisy §8.7 v40
              (2026-06-09); memory feedback-irisy-never-block-input). Only shown
              while streaming. */}
          {sending && (
            <button
              type="button"
              className={styles.railButton}
              onClick={stopGeneration}
              aria-label="Stop generating"
              title="Stop"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                <rect x="7" y="7" width="10" height="10" rx="1.5" />
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
            <CapabilityFloor
              disabled={sending}
              onPick={(cap) => {
                // Low-barrier: pre-fill the composer with a ready-to-
                // complete starter so the user sees what to do next
                // instead of a blank box (ADR-003 §8 v6). If the starter
                // is already a complete prompt, the user can just hit
                // Enter; otherwise they finish the sentence.
                setInput(cap.starter ?? `${cap.label}: `);
                inputRef.current?.focus();
              }}
            />
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

      {/* (ADR-002 substrate §1.8.6 v75; ADR-005 irisy §8.7 v32) */}
      {pendingAttachments.length > 0 && (
        <div className={styles.attachmentChips} role="list" aria-label="Attached files">
          {pendingAttachments.map((a) => (
            <span key={a.path} className={styles.attachmentChip} role="listitem">
              <span className={styles.attachmentChipName}>{a.name}</span>
              <button
                type="button"
                className={styles.attachmentChipRemove}
                onClick={() => removeAttachment(a.path)}
                aria-label={`Remove ${a.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
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

      <div className={styles.bottomToolbar}>
        <div className={styles.composerActions}>
          {/* Imports add explicit context to the fixed Irisy identity. */}
          {/* (ADR-005 irisy §11 v40) */}
          <div className={styles.importMenuWrap}>
            {importMenuOpen && (
              <div className={styles.importMenu} role="menu" aria-label="Add to Irisy">
                <button type="button" className={styles.importMenuItem} onClick={() => void chooseImportFiles()} disabled={importing}>
                  <span>Images and files</span>
                  <span className={styles.importShortcut}>⌘U</span>
                </button>
                <button type="button" className={styles.importMenuItem} onClick={() => void chooseImportFolder()} disabled={importing}>
                  <span>Folder</span>
                  <span className={styles.importShortcut}>⌘⇧U</span>
                </button>
                <div className={styles.importMenuDivider} />
                <div className={styles.importMenuDisabled}>Commands</div>
                <div className={styles.importMenuDisabled}>Context <span className={styles.importShortcut}>@</span></div>
                <div className={styles.importMenuDisabled}>Shell command <span className={styles.importShortcut}>!</span></div>
              </div>
            )}
            <button
              type="button"
              className={styles.addButton}
              onClick={() => setImportMenuOpen((open) => !open)}
              disabled={importing}
              aria-label={importing ? 'Importing files' : 'Add files or folder'}
              aria-expanded={importMenuOpen}
              title="Add files or folder"
            >
              {importing ? '…' : '+'}
            </button>
          </div>
          {importing && <span className={styles.importStatus}>Importing…</span>}
          {/* Imported material becomes canonical Irisy context only. */}
          {/* (ADR-005 irisy §11 v40) */}
        </div>
      </div>
    </div>
  );
}
