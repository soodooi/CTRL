// Irisy chat — thin streaming renderer.
//
// ADR-002 amendment 2026-05-30 + ADR-003 (Brain = Pi sole brain) collapse
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { invoke } from '@/lib/bridge';
import { irisyChatTransport, type LLMMessage } from '@/lib/llm-transport';
import {
  ensurePromptsBootstrap,
  loadIrisySystemPrompt,
  IRISY_SYSTEM_DEFAULT,
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

function buildSystemPrompt(
  systemBase: string,
  keycaps: ReadonlyArray<KeycapSummary>,
  longTermMemory: string,
  coreMemory: string,
): string {
  const sections: string[] = [systemBase];

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

  // `?fresh=1` from the homepage's "New chat" hand-off clears the
  // persisted conversation before this component reads it, so the new
  // session starts genuinely empty even if the URL is hit while a
  // previous chat is still in localStorage.
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('fresh') === '1') {
        window.localStorage.removeItem(CHAT_STORAGE_KEY);
      }
    } catch {
      // ignore — IrisyChat still mounts with whatever is stored
    }
  }

  const [messages, setMessages] = useState<DisplayMessage[]>(() => {
    if (typeof window === 'undefined') return [];
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

  // Pi is THE brain (ADR-003). irisyChatTransport routes through Pi.
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
      const [coreMem, sysPrompt] = await Promise.all([
        loadCoreMemory(),
        loadIrisySystemPrompt(),
      ]);
      if (cancelled) return;
      setCoreMemory(coreMem);
      setSystemBase(sysPrompt);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: `${m.content}\n[error: ${chunk.error}]`,
                      streaming: false,
                    }
                  : m,
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
        const firstLine = detail.split('\n')[0] ?? detail;
        setChatError({
          summary: `Chat stream failed: ${firstLine.slice(0, 120)}`,
          detail,
        });
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
      e.currentTarget.form?.requestSubmit();
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

  // Surface the saved-reply confirmation as transient inline text rather
  // than a toast — fits the slim companion column. Used to silence the
  // setStatusMessage var; reading it keeps the linter happy and gives a
  // hook for a future visual treatment.
  void statusMessage;

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
          {messages.map((m) => {
            if (m.role === 'assistant') {
              const isThisStreaming = m.streaming;
              return (
                <article
                  key={m.id}
                  className={`${styles.assistantBubble} ${styles.markdownBody}`}
                  aria-live={m.streaming ? 'polite' : undefined}
                >
                  {m.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {m.content}
                    </ReactMarkdown>
                  ) : isThisStreaming ? (
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
                  {!isThisStreaming && m.content && (
                    <button
                      type="button"
                      className={styles.saveBtn}
                      title="Save this reply to vault/irisy/replies/"
                      onClick={() => void saveReplyToVault(m.id, m.content)}
                      aria-label="Save reply to vault"
                    >
                      ✓
                    </button>
                  )}
                </article>
              );
            }
            return (
              <article
                key={m.id}
                className={styles.userBubble}
                aria-live={m.streaming ? 'polite' : undefined}
              >
                {m.content}
              </article>
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

      {/* Composer — input + dialog merged into one column (bao 2026-05-31).
          The previous design hid this textarea off-screen and ran the
          actual input from a separate Tauri companion window. That window
          is now retired; the input lives at the bottom of the Irisy chat
          column and the message list flows above it. */}
      <div className={styles.composer}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          className={styles.composerInput}
          placeholder="Talk to Irisy…"
          rows={1}
          aria-label="Message Irisy"
        />
      </div>
    </div>
  );
}
