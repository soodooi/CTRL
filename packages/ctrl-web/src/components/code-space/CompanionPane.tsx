// [H-2026-05-22-001] CompanionPane — Irisy code-companion chat alongside
// the Code Space xterm viewer.
//
// Reads recent terminal stdout via `getRecentStdout()` (host route owns
// the buffer), streams LLM replies through `defaultTransport()`, and
// surfaces a "Send to terminal" button for every fenced bash/sh code
// block the assistant emits. The host wires the button to cs_stdin.

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { defaultTransport, type LLMTransport } from '@/lib/llm-transport';
import { composeUserTurn } from '@/personas/irisy/code-companion';
import styles from './CompanionPane.module.css';

export interface CompanionPaneProps {
  envId: string;
  getRecentStdout: () => string;
  onSendToTerminal: (text: string) => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  error?: string | null;
}

interface RunnableBlock {
  code: string;
  lang: 'bash' | 'sh';
}

const MAX_RUNNABLE_BLOCK_BYTES = 1024;

function extractRunnableBlocks(content: string): RunnableBlock[] {
  // Multiline + non-greedy. JS regex has no /s flag in older targets, so
  // use `[\s\S]` to match across newlines. We reset lastIndex each call
  // because the regex literal is shared at module level.
  const re = /```(bash|sh)\n([\s\S]*?)```/g;
  const blocks: RunnableBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const lang = match[1] === 'sh' ? 'sh' : 'bash';
    const code = (match[2] ?? '').replace(/\n+$/, '');
    if (code.length === 0) continue;
    if (code.length > MAX_RUNNABLE_BLOCK_BYTES) continue;
    blocks.push({ code, lang });
  }
  return blocks;
}

const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function CompanionPane({
  envId,
  getRecentStdout,
  onSendToTerminal,
}: CompanionPaneProps): ReactElement {
  const transportRef = useRef<LLMTransport>(defaultTransport());
  const abortRef = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);

  const submit = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const userId = newId();
      const assistantId = newId();
      setMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', content: trimmed },
        { id: assistantId, role: 'assistant', content: '', pending: true, error: null },
      ]);
      setDraft('');
      setPending(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const turn = composeUserTurn({
        recentStdout: getRecentStdout(),
        envId,
        userMessage: trimmed,
      });

      try {
        const stream = transportRef.current.stream(turn, { signal: controller.signal });
        for await (const chunk of stream) {
          if (chunk.error) {
            const errMsg = chunk.error;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, pending: false, error: errMsg } : m,
              ),
            );
            return;
          }
          if (chunk.delta) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + chunk.delta } : m,
              ),
            );
          }
          if (chunk.done) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)),
            );
            return;
          }
        }
        // Stream ended without emitting done — treat as graceful close.
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)),
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, pending: false, error: message } : m,
          ),
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setPending(false);
      }
    },
    [envId, getRecentStdout],
  );

  const handleSubmit = useCallback((): void => {
    if (pending) return;
    if (!draft.trim()) return;
    void submit(draft);
  }, [draft, pending, submit]);

  const handleStop = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  const handleKey = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleRetry = useCallback(
    (userMessageContent: string): void => {
      // Drop the failed exchange (last user + assistant) and resubmit
      // the same prompt. Simpler than tracking message lineage by id.
      setMessages((prev) => prev.slice(0, -2));
      void submit(userMessageContent);
    },
    [submit],
  );

  const isEmpty = messages.length === 0;

  return (
    <div className={styles.pane} aria-label="Irisy companion">
      <div className={styles.messages} role="log" aria-live="polite">
        {isEmpty && (
          <div className={styles.empty}>Ask Irisy about this session…</div>
        )}
        {messages.map((m, idx) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className={`${styles.message} ${styles.message_user}`}>
                {m.content}
              </div>
            );
          }
          const blocks = extractRunnableBlocks(m.content);
          const prevUser = idx > 0 ? messages[idx - 1] : null;
          const pendingClass = m.pending ? ` ${styles.message_pending}` : '';
          return (
            <div
              key={m.id}
              className={`${styles.message} ${styles.message_assistant}${pendingClass}`}
            >
              {m.content || (m.pending ? '…' : '')}
              {blocks.map((b, bidx) => (
                <div key={`${m.id}-blk-${bidx}`} className={styles.runBlock}>
                  <pre className={styles.runBlockCode}>{b.code}</pre>
                  <button
                    type="button"
                    className={styles.runBlockSend}
                    onClick={() => onSendToTerminal(b.code)}
                  >
                    Send to terminal · {b.lang}
                  </button>
                </div>
              ))}
              {m.error && (
                <div className={styles.error} role="alert">
                  <span>{m.error}</span>
                  {prevUser && prevUser.role === 'user' && (
                    <button
                      type="button"
                      className={styles.retry}
                      onClick={() => handleRetry(prevUser.content)}
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className={styles.inputRow}>
        <textarea
          className={styles.textarea}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask about output, propose a command, debug an error…"
          rows={2}
          aria-label="Message Irisy"
        />
        <div className={styles.actions}>
          {pending ? (
            <button type="button" className={styles.stopBtn} onClick={handleStop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className={styles.submitBtn}
              onClick={handleSubmit}
              disabled={!draft.trim()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
