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
import { irisyChatTransport, type LLMMessage } from '@/lib/llm-transport';
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
import { listKeycaps, type KeycapSummary } from '@/lib/kernel';
import styles from './IrisyChat.module.css';

const CHAT_STORAGE_KEY = 'irisy:chat:v1';

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

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming: boolean;
}

const SEED_PROMPTS: readonly string[] = [
  'What can you do here?',
  'List my keycaps.',
  'Help me make a clipboard keycap.',
];

// Pi emits tool invocations as XML-like markup inside assistant turns
// (see lib/irisy-prompts.ts IRISY_SYSTEM_DEFAULT). The PWA must parse
// these out of the chat stream so the user sees a compact card instead
// of raw `<call name="..."><...></call>` text. ADR-003 §7 chat surface
// expectations — Irisy is a polished assistant, not a console.
type ChatSegment =
  | { kind: 'text'; text: string }
  | { kind: 'call'; tool: string; args: string; closed: boolean }
  | { kind: 'result'; tool: string; body: string };

function parseChatSegments(content: string): ChatSegment[] {
  // Both regexes are local-scope to avoid module-level shared `lastIndex`
  // landmines (review P1: a module-level g-flag regex leaks state across
  // calls if any early-return forgets to reset it). Local instances reset
  // on every call by construction; allocation cost is sub-microsecond.
  const blockRe = /<(call-result|call)\s+(?:name|for)="([^"]+)"\s*>([\s\S]*?)<\/\1>/g;
  const partialOpenRe = /<(call-result|call)\s+(?:name|for)="([^"]+)"\s*>([\s\S]*)$/;
  const segments: ChatSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(content)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: 'text', text: content.slice(cursor, match.index) });
    }
    const tag = match[1] ?? '';
    const name = match[2] ?? '';
    const body = (match[3] ?? '').trim();
    if (tag === 'call') {
      segments.push({ kind: 'call', tool: name, args: body, closed: true });
    } else {
      segments.push({ kind: 'result', tool: name, body });
    }
    cursor = blockRe.lastIndex;
  }
  const tail = content.slice(cursor);
  const partial = partialOpenRe.exec(tail);
  if (partial) {
    const head = tail.slice(0, partial.index);
    if (head.length > 0) segments.push({ kind: 'text', text: head });
    const tag = partial[1] ?? '';
    const name = partial[2] ?? '';
    const body = partial[3] ?? '';
    if (tag === 'call') {
      segments.push({ kind: 'call', tool: name, args: body, closed: false });
    } else {
      segments.push({ kind: 'result', tool: name, body });
    }
  } else if (tail.length > 0) {
    segments.push({ kind: 'text', text: tail });
  }
  return segments;
}

interface ToolCardProps {
  tool: string;
  body: string;
  direction: 'call' | 'result';
  running: boolean;
}

// React.memo so streaming chunks on the parent assistant bubble don't
// re-render every ToolCard in the message — only the currently streaming
// card whose `running` prop flips. Without this, every delta on a long
// turn forces a full re-render of all prior tool cards (review P2).
const ToolCard = memo(function ToolCard({
  tool,
  body,
  direction,
  running,
}: ToolCardProps): ReactElement {
  const [open, setOpen] = useState(false);
  const arrow = direction === 'call' ? '→' : '←';
  const title = `${arrow} ${tool}`;
  const formatted = useMemo(() => {
    const trimmed = body.trim();
    if (!trimmed) return '';
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return trimmed;
    }
  }, [body]);
  const hasBody = formatted.length > 0;
  return (
    <div className={styles.toolCard}>
      <button
        type="button"
        className={styles.toolCardHeader}
        onClick={() => setOpen((v) => !v)}
        disabled={!hasBody}
        aria-expanded={open}
      >
        <span className={styles.toolCardChevron}>
          {hasBody ? (open ? '▾' : '▸') : '·'}
        </span>
        <span className={styles.toolCardTitle}>{title}</span>
        {running && (
          <span className={styles.toolCardRunning} aria-live="polite">
            running…
          </span>
        )}
      </button>
      {open && hasBody && <pre className={styles.toolCardBody}>{formatted}</pre>}
    </div>
  );
});

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
  message: DisplayMessage;
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
  const segments = useMemo(
    () => parseChatSegments(message.content),
    [message.content],
  );
  const hasRenderable =
    message.content.length > 0 &&
    segments.some((s) =>
      s.kind === 'text' ? s.text.trim().length > 0 : true,
    );
  return (
    <article
      className={`${styles.assistantBubble} ${styles.markdownBody}`}
      aria-live={isStreaming ? 'polite' : undefined}
    >
      <div className={styles.bubbleContent}>
        {hasRenderable ? (
          segments.map((seg, idx) => {
            if (seg.kind === 'text') {
              const text = seg.text;
              if (text.trim().length === 0) return null;
              return (
                <ReactMarkdown
                  key={`${message.id}-t-${idx}`}
                  remarkPlugins={[remarkGfm]}
                >
                  {text}
                </ReactMarkdown>
              );
            }
            if (seg.kind === 'call') {
              return (
                <ToolCard
                  key={`${message.id}-c-${idx}`}
                  tool={seg.tool}
                  body={seg.args}
                  direction="call"
                  running={!seg.closed}
                />
              );
            }
            return (
              <ToolCard
                key={`${message.id}-r-${idx}`}
                tool={seg.tool}
                body={seg.body}
                direction="result"
                running={false}
              />
            );
          })
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
          aria-label="Save reply to vault"
        >
          ✓
        </button>
      )}
    </article>
  );
});

function buildSystemPrompt(
  systemBase: string,
  keycaps: ReadonlyArray<KeycapSummary>,
  longTermMemory: string,
  coreMemory: string,
  brainState: BrainState | null,
): string {
  const sections: string[] = [systemBase];

  // ADR-002 substrate § provider v2 §3.7: inject the live brain state so
  // Irisy answers "what model are you on" with the brand label, never the
  // codename. Goes near the top so it sits above memory / keycap context.
  if (brainState) {
    sections.push(formatBrainStateBlock(brainState));
  }

  if (coreMemory.trim().length > 0) {
    sections.push(`# Core memory (loaded from vault/.irisy-memory/)\n${coreMemory.trim()}`);
  }

  if (longTermMemory.trim().length > 0) {
    sections.push(
      `# Long-term memory (vault/irisy/SOUL.md)\n${longTermMemory.trim()}`,
    );
  }

  if (keycaps.length === 0) {
    sections.push(
      '# Installed keycaps\n(none yet — you can install one by dragging a card onto the Keyboard, or ask Irisy to make one)',
    );
  } else {
    const lines = keycaps.map(
      (k) => `- ${k.id} · ${k.name} · ${k.icon} (${k.keycap_color})`,
    );
    sections.push(
      `# Installed keycaps (${keycaps.length})\n${lines.join('\n')}`,
    );
  }
  return sections.join('\n\n');
}

export function IrisyChat(): React.ReactElement {
  const [status, setStatus] = useState<IrisyStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [keycaps, setKeycaps] = useState<KeycapSummary[]>([]);
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
        window.localStorage.removeItem(CHAT_STORAGE_KEY);
        return [];
      }
    } catch {
      // URL parsing failed — fall through to normal restore path
    }
    try {
      const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (m): m is DisplayMessage =>
            typeof m === 'object' &&
            m !== null &&
            'role' in (m as Record<string, unknown>) &&
            ((m as DisplayMessage).role === 'user' ||
              (m as DisplayMessage).role === 'assistant'),
        )
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
        window.localStorage.removeItem(CHAT_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          CHAT_STORAGE_KEY,
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
  const piReady = status?.pi?.reachable === true;
  const upgradeStub =
    statusError != null || (activeBrain === 'pi' && status != null && !piReady);

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
      const [statusResult, keycapsResult, memoryResult] =
        await Promise.allSettled([
          invoke<IrisyStatus>('irisy_init'),
          listKeycaps(),
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
      if (keycapsResult.status === 'fulfilled') {
        setKeycaps(keycapsResult.value);
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

      const history: LLMMessage[] = [
        {
          role: 'system',
          content: buildSystemPrompt(
            systemBase,
            keycaps,
            longTermMemory,
            coreMemory,
            brainState,
          ),
        },
        ...messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: trimmed },
      ];

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

      try {
        for await (const chunk of transport.stream(history)) {
          if (chunk.error) {
            // Pi RPC errors (timeout / Stderr / supervisor crash) used to
            // get appended into the assistant bubble as raw text. Route
            // them into the errorPanel surface instead so the bubble
            // stays clean and the error can be expanded for the stderr
            // tail. ADR-003 §7 chat polish.
            setChatError(humanizePiError(String(chunk.error), activeBrain));
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, streaming: false } : m,
              ),
            );
            return;
          }
          if (chunk.delta) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + chunk.delta }
                  : m,
              ),
            );
          }
          if (chunk.done) break;
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        );
      } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        setChatError(humanizePiError(detail, activeBrain));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        );
      } finally {
        setSending(false);
        setSendingStartedAt(null);
      }
    },
    [
      brainState,
      coreMemory,
      keycaps,
      longTermMemory,
      messages,
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
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
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
                Keycaps still work — drag one onto the Keyboard to install,
                click a cell to run.
              </p>
            </div>
          </div>
        </div>
        <div className={styles.composer}>
          <textarea
            className={styles.composerInput}
            placeholder="Pi is wiring up…"
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
      <div className={styles.scrollerWrap}>
        {messages.length > 0 && (
          <button
            type="button"
            className={styles.clearFloating}
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
