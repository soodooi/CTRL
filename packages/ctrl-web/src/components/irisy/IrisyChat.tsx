// Irisy chat — minimal end-to-end chat surface for the `/irisy` route
// when mode !== 'create-keycap'.
//
// On mount: invoke('irisy_init') for kernel-llm / Pi / mcp-bridge status.
// Renders a status header, then a welcome + chat composer.
// Chat path: Pi is the sole brain (ADR-001 amendment 2026-05-25). When the
// Pi plugin is reachable the turn goes through irisyChatTransport()
// (kernel irisy_chat_stream → BrainRouter → @ctrl/pi-plugin MCP). When Pi
// isn't running, defaultTransport() (kernel chat_stream → llm_port → Volc)
// gives a direct, fast reply and drives the frontend ReAct tool loop.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { invoke } from '@/lib/bridge';
import { listKeycaps, type KeycapSummary } from '@/lib/kernel';
import {
  defaultTransport,
  irisyChatTransport,
  type LLMMessage,
} from '@/lib/llm-transport';
import {
  describeToolsForPrompt,
  executeToolCall,
  formatToolResultForDisplay,
  parseToolCalls,
} from '@/lib/irisy-tools';
import { ensureMemoryBootstrap, loadCoreMemory } from '@/lib/irisy-memory';
import {
  ensurePromptsBootstrap,
  loadIrisySystemPrompt,
} from '@/lib/irisy-prompts';
import styles from './IrisyChat.module.css';

const MAX_AGENT_ITERATIONS = 5;
const CHAT_STORAGE_KEY = 'irisy:chat:v1';

// Matches a complete <call name="...">…</call> block in assistant output.
const ASSISTANT_CALL_TAG_RE =
  /<call\s+name="([a-zA-Z_][a-zA-Z0-9_]*)"\s*>[\s\S]*?<\/call>/g;
// Matches an unfinished tag that streamed open but hasn't closed yet —
// without this, the user sees raw `<call name="..."` mid-stream.
const ASSISTANT_CALL_OPEN_PARTIAL_RE =
  /<call\s+name="[^"]*"\s*>(?:(?!<\/call>)[\s\S])*$/;

function renderAssistantContent(text: string): string {
  let out = text.replace(ASSISTANT_CALL_TAG_RE, (_match, name: string) => {
    return `[→ ${name}]`;
  });
  out = out.replace(ASSISTANT_CALL_OPEN_PARTIAL_RE, '[→ …]');
  return out;
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
  // ADR-001 amendment 2026-05-25 — Pi is the sole brain. Optional on the
  // wire because the kernel's irisy_init may be older than this PWA build.
  pi?: PiStatus;
  active_brain?: string;
}

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  streaming: boolean;
}

const SEED_PROMPTS: readonly string[] = [
  'What can you do here?',
  'List my keycaps.',
  'Help me make a clipboard keycap.',
];

const IRISY_SYSTEM_BASE = `You are Irisy, the AI companion built into CTRL — a desktop AI launcher.
CTRL has keycaps (single-action AI tools), a workspace pane, and you, the
ambient assistant. You accompany the user across the full keycap lifecycle:
discovery, creation, configuration, invocation, collaboration, debugging,
improvement, and retirement.

Keep replies concise. Reply in the user's language. When the user asks
about their keycaps, use the "Installed keycaps" list below. When they
ask you to invoke or build one, walk them through it step by step — but
never invent keycap ids that aren't listed.`;

function buildSystemPrompt(
  systemBase: string,
  keycaps: ReadonlyArray<KeycapSummary>,
  longTermMemory: string,
  coreMemory: string,
  toolsInPrompt: boolean,
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
      '# Installed keycaps\n(none yet — the user can create one via the keycap-creator route)',
    );
  } else {
    const lines = keycaps.map(
      (k) => `- ${k.id} · ${k.name} · ${k.icon} (${k.keycap_color})`,
    );
    sections.push(
      `# Installed keycaps (${keycaps.length})\n${lines.join('\n')}`,
    );
  }
  // Frontend tool list is for the legacy ReAct loop (chat_stream raw LLM).
  // When Pi is the brain, Pi owns tools via its own MCP client config —
  // duplicating the schema in the system prompt would just confuse Pi.
  if (toolsInPrompt) {
    sections.push(describeToolsForPrompt());
  }
  return sections.join('\n\n');
}

export function IrisyChat(): React.ReactElement {
  const [status, setStatus] = useState<IrisyStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [keycaps, setKeycaps] = useState<KeycapSummary[]>([]);
  const [longTermMemory, setLongTermMemory] = useState<string>('');
  const [coreMemory, setCoreMemory] = useState<string>('');
  const [systemBase, setSystemBase] = useState<string>(IRISY_SYSTEM_BASE);
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
      // Strip in-flight `streaming` flags — a refresh during a streaming
      // turn would leave that message permanently spinning otherwise.
      return parsed.map((m) => ({
        ...(m as DisplayMessage),
        streaming: false,
      }));
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

  // Chat path (ADR-001 amendment 2026-05-25 — Pi is the sole brain):
  //   1. Pi reachable  → irisyChatTransport() (kernel irisy_chat_stream →
  //                      BrainRouter inline → @ctrl/pi-plugin MCP server).
  //                      Pi runs its own agent loop with its own provider.
  //   2. Pi not running → defaultTransport() (kernel chat_stream → llm_port
  //                      → Volc). Direct, fast reply; drives the frontend
  //                      ReAct tool loop below.
  const usePi = status?.pi?.reachable === true;
  const transport = useMemo(
    () => (usePi ? irisyChatTransport() : defaultTransport()),
    [usePi],
  );

  const clearConversation = useCallback((): void => {
    setMessages([]);
    setChatError(null);
  }, []);

  // Keyboard shortcuts scoped to this component (not global).
  // Cmd/Ctrl+K — clear conversation. Cmd/Ctrl+L — same (legacy terminal).
  // ↑ on empty input — recall the last user message for editing.
  // Cmd/Ctrl+Enter — send (textarea-style, even though composer is <input>).
  const lastUserMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === 'user') return m.content;
    }
    return '';
  }, [messages]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sendMessageRef = useRef<((text: string) => Promise<void>) | null>(null);

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
      // vault_read rejects when the file doesn't exist — that's fine,
      // Irisy starts with an empty long-term memory and the LLM can call
      // update_memory to seed it.
      if (memoryResult.status === 'fulfilled') {
        const body = memoryResult.value?.body;
        if (typeof body === 'string') {
          setLongTermMemory(body);
        }
      }
      // Bootstrap + load memory/prompt substrates (G10 + G12). Both
      // live in vault — `.irisy-memory/` and `.irisy-prompts/`. First
      // mount per vault writes starter files; subsequent mounts just
      // load.
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

      // Compose initial history. Tool transcripts feed back as `user`
      // turns wrapping a <call-result>; that's the same shape the agent
      // loop produces below, so existing tool turns must convert role
      // 'tool' → 'user' here for the LLM's view.
      let history: LLMMessage[] = [
        {
          role: 'system',
          content: buildSystemPrompt(
            systemBase,
            keycaps,
            longTermMemory,
            coreMemory,
            !usePi,
          ),
        },
        ...messages.map((m) => ({
          role: (m.role === 'tool' ? 'user' : m.role) as
            | 'system'
            | 'user'
            | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: trimmed },
      ];

      try {
        for (let iter = 0; iter < MAX_AGENT_ITERATIONS; iter++) {
          const assistantId = `a-${Date.now()}-${iter}`;
          let assistantText = '';
          setMessages((prev) => [
            ...prev,
            {
              id: assistantId,
              role: 'assistant',
              content: '',
              streaming: true,
            },
          ]);

          let streamErrored = false;
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
              streamErrored = true;
              break;
            }
            if (chunk.delta) {
              assistantText += chunk.delta;
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
          if (streamErrored) return;

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, streaming: false } : m,
            ),
          );

          const calls = parseToolCalls(assistantText);
          if (calls.length === 0) return;

          history = [
            ...history,
            { role: 'assistant', content: assistantText },
          ];

          for (const call of calls) {
            const toolMsgId = `t-${Date.now()}-${call.name}`;
            setMessages((prev) => [
              ...prev,
              {
                id: toolMsgId,
                role: 'tool',
                content: `${call.name} · running…`,
                streaming: true,
              },
            ]);
            const result = await executeToolCall(call);
            const display = formatToolResultForDisplay(result);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === toolMsgId
                  ? {
                      ...m,
                      content: `${call.name} →\n${display}`,
                      streaming: false,
                    }
                  : m,
              ),
            );
            history = [
              ...history,
              {
                role: 'user',
                content: `<call-result name="${call.name}">${JSON.stringify(result)}</call-result>`,
              },
            ];
          }
        }
      } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        const firstLine = detail.split('\n')[0] ?? detail;
        setChatError({
          summary: `Chat stream failed: ${firstLine.slice(0, 120)}`,
          detail,
        });
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
      usePi,
    ],
  );

  // Keep the keydown handler reading the latest sendMessage closure.
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // Homepage hand-off: `/?text=<encoded>` from default.tsx's ChatInput
  // navigates here with the user's first message. Pop it off the URL
  // and fire it once. The strip-on-consume guard prevents a refresh
  // from re-sending the same prompt.
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

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    void sendMessage(input);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // ↑ on an empty input recalls the last user message for quick edit.
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

  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const toggleToolExpand = useCallback((id: string): void => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // @-mention autocomplete state — populates from vault.list when '@'
  // appears in the input, replaces with the picked relative path on click.
  const [vaultFiles, setVaultFiles] = useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');

  useEffect(() => {
    // Single, cheap fetch — the vault list is small enough for in-memory
    // filter. Re-fetch on each mount; new files appear on next open.
    void (async () => {
      try {
        const files = await invoke<string[]>('vault_list', { args: {} });
        setVaultFiles(files);
      } catch {
        /* vault may be empty; @ picker stays empty */
      }
    })();
  }, []);

  useEffect(() => {
    const atIdx = input.lastIndexOf('@');
    if (atIdx === -1) {
      if (mentionOpen) setMentionOpen(false);
      return;
    }
    const after = input.slice(atIdx + 1);
    if (after.includes(' ')) {
      if (mentionOpen) setMentionOpen(false);
      return;
    }
    setMentionQuery(after.toLowerCase());
    setMentionOpen(true);
  }, [input, mentionOpen]);

  const mentionResults = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery;
    return vaultFiles
      .filter((p) => p.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionOpen, mentionQuery, vaultFiles]);

  const pickMention = useCallback(
    (path: string): void => {
      const atIdx = input.lastIndexOf('@');
      if (atIdx === -1) return;
      setInput(`${input.slice(0, atIdx)}@${path} `);
      setMentionOpen(false);
      inputRef.current?.focus();
    },
    [input],
  );

  const brainReady = status?.kernel_llm.ready ?? false;

  // Pi sole-brain status. When status.pi is absent the kernel hasn't
  // shipped the irisy_init Pi probe yet (older binary on user's machine),
  // so we render `—` rather than misleading "not running".
  const piProbed = status?.pi != null;
  const piReachable = status?.pi?.reachable === true;
  const piDetail = !piProbed
    ? '—'
    : piReachable
      ? `${status?.pi?.version ?? 'reachable'} · brain=${status?.active_brain ?? 'pi'}`
      : `not running — \`cd packages/ctrl-pi-plugin && npm start\``;

  return (
    <div className={styles.root}>
      <header className={styles.statusBar}>
        <StatusLine
          label="Brain"
          ok={brainReady}
          detail={status?.kernel_llm.adapter ?? '—'}
        />
        <StatusLine
          label="Pi"
          ok={piReachable}
          detail={piDetail}
        />
        {statusMessage != null && (
          <span className={styles.upgradeMessage}>{statusMessage}</span>
        )}
        <StatusLine
          label="MCP bridge"
          ok={status?.mcp_bridge.handshake_written ?? false}
          detail={
            status?.mcp_bridge.handshake_written ? 'handshake written' : '—'
          }
        />
        <span className={styles.versionBadge} title="Irisy ships in lockstep with CTRL — version mirrors the app's package version.">
          Irisy v{status?.app_version ?? '—'}
        </span>
        {messages.length > 0 && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={clearConversation}
            aria-label="Clear conversation"
          >
            Clear
          </button>
        )}
        {statusError != null && (
          <p className={styles.statusError}>irisy_init: {statusError}</p>
        )}
      </header>

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
                    disabled={!brainReady}
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m) => {
          if (m.role === 'tool') {
            const expanded = expandedTools.has(m.id);
            const lines = m.content.split('\n');
            const headLine = lines[0] ?? m.content;
            const hasMore = lines.length > 1 || m.content.length > 80;
            return (
              <div key={m.id} className={styles.toolCard}>
                <button
                  type="button"
                  className={styles.toolCardHeader}
                  onClick={() => toggleToolExpand(m.id)}
                  disabled={!hasMore}
                  aria-expanded={expanded}
                >
                  <span className={styles.toolCardChevron}>
                    {hasMore ? (expanded ? '▾' : '▸') : '·'}
                  </span>
                  <span className={styles.toolCardTitle}>{headLine}</span>
                  {m.streaming && (
                    <span className={styles.toolCardRunning}>running…</span>
                  )}
                </button>
                {expanded && hasMore && (
                  <pre className={styles.toolCardBody}>{m.content}</pre>
                )}
              </div>
            );
          }
          if (m.role === 'assistant') {
            const rendered = renderAssistantContent(m.content);
            const isThisStreaming = m.streaming;
            return (
              <article
                key={m.id}
                className={`${styles.assistantBubble} ${styles.markdownBody}`}
                aria-live={m.streaming ? 'polite' : undefined}
              >
                {rendered ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {rendered}
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
                {!isThisStreaming && rendered && (
                  <button
                    type="button"
                    className={styles.saveBtn}
                    title="Save this reply to vault/irisy/replies/"
                    onClick={() => void saveReplyToVault(m.id, m.content)}
                    aria-label="Save reply to vault"
                  >
                    💾
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

      <form className={styles.composer} onSubmit={onSubmit}>
        <div className={styles.composerInputWrap}>
          {mentionOpen && mentionResults.length > 0 && (
            <ul className={styles.mentionPopover} role="listbox" aria-label="Vault files">
              {mentionResults.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className={styles.mentionItem}
                    onClick={() => pickMention(path)}
                  >
                    {path}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={
              brainReady
                ? 'Talk to Irisy — @file · ↑ recall · ⌘K clear · ⌘↵ send'
                : 'Brain not ready — wire a provider in CTRL settings'
            }
            disabled={sending || !brainReady}
            aria-label="Message Irisy"
          />
        </div>
        <button
          type="submit"
          disabled={sending || !brainReady || !input.trim()}
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

interface StatusLineProps {
  label: string;
  ok: boolean;
  detail: string;
}

function StatusLine({
  label,
  ok,
  detail,
}: StatusLineProps): React.ReactElement {
  return (
    <span className={styles.statusLine}>
      <span className={ok ? styles.dotOk : styles.dotOff} aria-hidden />
      <span className={styles.statusLabel}>{label}</span>
      <span className={styles.statusDetail}>{detail}</span>
    </span>
  );
}
