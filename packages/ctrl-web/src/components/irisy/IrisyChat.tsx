// Irisy chat — minimal end-to-end chat surface for the `/irisy` route
// when mode !== 'create-keycap'.
//
// On mount: invoke('irisy_init') for kernel-llm / hermes / mcp-bridge
// status. Renders a 3-line status header, then a welcome + chat composer.
// Chat path: defaultTransport().stream() — kernel llm_port via
// ChatStreamTransport (Tauri `chat_stream` command). No hermes in the
// runtime path until the user wires a brain provider for hermes via
// `hermes auth add` / `hermes model`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@/lib/bridge';
import { listKeycaps, type KeycapSummary } from '@/lib/kernel';
import { defaultTransport, type LLMMessage } from '@/lib/llm-transport';
import {
  describeToolsForPrompt,
  executeToolCall,
  formatToolResultForDisplay,
  parseToolCalls,
} from '@/lib/irisy-tools';
import styles from './IrisyChat.module.css';

const MAX_AGENT_ITERATIONS = 5;
const CHAT_STORAGE_KEY = 'irisy:chat:v1';
const HERMES_SESSION_STORAGE_KEY = 'irisy:hermes-session:v1';

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

interface HermesStatus {
  binary_path: string | null;
  version: string | null;
  latest_version: string | null;
  update_available: boolean;
  plugin_enabled: boolean;
  brain_configured: boolean;
}

interface McpBridgeStatus {
  handshake_written: boolean;
  handshake_path: string;
}

interface IrisyStatus {
  app_version: string;
  kernel_llm: KernelLlmStatus;
  hermes: HermesStatus;
  mcp_bridge: McpBridgeStatus;
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
  keycaps: ReadonlyArray<KeycapSummary>,
  longTermMemory: string,
): string {
  const sections: string[] = [IRISY_SYSTEM_BASE];

  if (longTermMemory.trim().length > 0) {
    sections.push(
      `# Your long-term memory (vault: irisy/SOUL.md)\n${longTermMemory.trim()}`,
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
  sections.push(describeToolsForPrompt());
  return sections.join('\n\n');
}

export function IrisyChat(): React.ReactElement {
  const [status, setStatus] = useState<IrisyStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [keycaps, setKeycaps] = useState<KeycapSummary[]>([]);
  const [longTermMemory, setLongTermMemory] = useState<string>('');
  const [hermesSessionId, setHermesSessionId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(HERMES_SESSION_STORAGE_KEY) ?? '';
  });
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
  const transport = useMemo(() => defaultTransport(), []);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

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

  // Persist hermes session id so multi-turn chats survive reloads.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (hermesSessionId) {
      window.localStorage.setItem(HERMES_SESSION_STORAGE_KEY, hermesSessionId);
    } else {
      window.localStorage.removeItem(HERMES_SESSION_STORAGE_KEY);
    }
  }, [hermesSessionId]);

  // Auto-switch chat path: hermes subprocess once its brain is wired (Volc
  // through custom_providers in ~/.hermes/config.yaml); otherwise legacy
  // CTRL-kernel-Volc + frontend ReAct (kept as fallback when hermes isn't
  // installed or the brain wire-up hasn't completed yet).
  const useHermes =
    status?.hermes.brain_configured === true &&
    status?.hermes.binary_path != null &&
    status?.hermes.plugin_enabled === true;

  const clearConversation = useCallback((): void => {
    setMessages([]);
    setHermesSessionId('');
  }, []);

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
      const userId = `u-${Date.now()}`;
      const userMsg: DisplayMessage = {
        id: userId,
        role: 'user',
        content: trimmed,
        streaming: false,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');

      // Hermes-driven path: one-shot subprocess call. hermes runs its own
      // agent loop (tool calling through the ctrl plugin, skills, sessions,
      // cron, …) and returns a single final message. No frontend ReAct.
      if (useHermes) {
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
          const result = await invoke<{
            session_id: string;
            content: string;
            elapsed_ms: number;
          }>('irisy_chat_hermes', {
            args: {
              prompt: trimmed,
              session_id: hermesSessionId || undefined,
              max_turns: 10,
            },
          });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: result.content || '(empty response)',
                    streaming: false,
                  }
                : m,
            ),
          );
          if (result.session_id) setHermesSessionId(result.session_id);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'hermes chat failed';
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: `[hermes error] ${msg}`,
                    streaming: false,
                  }
                : m,
            ),
          );
        } finally {
          setSending(false);
        }
        return;
      }

      // Compose initial history. Tool transcripts feed back as `user`
      // turns wrapping a <call-result>; that's the same shape the agent
      // loop produces below, so existing tool turns must convert role
      // 'tool' → 'user' here for the LLM's view.
      let history: LLMMessage[] = [
        {
          role: 'system',
          content: buildSystemPrompt(keycaps, longTermMemory),
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
      } finally {
        setSending(false);
      }
    },
    [
      hermesSessionId,
      keycaps,
      longTermMemory,
      messages,
      sending,
      transport,
      useHermes,
    ],
  );

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    void sendMessage(input);
  };

  const brainReady = status?.kernel_llm.ready ?? false;
  const hermesDetected = status?.hermes.binary_path != null;
  const hermesUpdateAvailable =
    status?.hermes.update_available === true &&
    status?.hermes.latest_version != null;
  const hermesDetail = hermesDetected
    ? [
        status?.hermes.version ?? 'detected',
        status?.hermes.plugin_enabled ? 'plugin ✓' : 'plugin ✗',
        status?.hermes.brain_configured ? 'brain ✓' : 'no brain',
      ].join(' · ')
    : 'not installed';

  return (
    <div className={styles.root}>
      <header className={styles.statusBar}>
        <StatusLine
          label="Brain"
          ok={brainReady}
          detail={status?.kernel_llm.adapter ?? '—'}
        />
        <StatusLine
          label="hermes"
          ok={hermesDetected}
          detail={hermesDetail}
        />
        {hermesUpdateAvailable && (
          <button
            type="button"
            className={styles.updateBadge}
            title={`Run \`pipx upgrade hermes-agent\` in a terminal to upgrade from ${status?.hermes.version ?? '?'} to ${status?.hermes.latest_version ?? '?'}.`}
            onClick={() => {
              const cmd = 'pipx upgrade hermes-agent';
              if (navigator.clipboard != null) {
                void navigator.clipboard.writeText(cmd);
              }
            }}
          >
            ↑ v{status?.hermes.latest_version} available
          </button>
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
            return (
              <pre
                key={m.id}
                className={styles.toolBubble}
                aria-live={m.streaming ? 'polite' : undefined}
              >
                {m.content}
              </pre>
            );
          }
          const rendered =
            m.role === 'assistant'
              ? renderAssistantContent(m.content)
              : m.content;
          return (
            <article
              key={m.id}
              className={
                m.role === 'user' ? styles.userBubble : styles.assistantBubble
              }
              aria-live={m.streaming ? 'polite' : undefined}
            >
              {rendered || (m.streaming ? '…' : '')}
            </article>
          );
        })}
      </div>

      <form className={styles.composer} onSubmit={onSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            brainReady
              ? 'Talk to Irisy…'
              : 'Brain not ready — wire a provider in CTRL settings'
          }
          disabled={sending || !brainReady}
          aria-label="Message Irisy"
        />
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
