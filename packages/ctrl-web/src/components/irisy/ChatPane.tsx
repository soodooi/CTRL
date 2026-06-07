// [H-2026-05-18-001] ChatPane — left zone of the mcp-creator shell.
//
// History scroller + input + patience pip. The input is auto-focused, and
// its placeholder is mode-aware: default vs. field-pending refinement.

import { useEffect, useRef, type FormEvent } from 'react';
import {
  selectInstallable,
  useMcpCreatorStore,
} from '@/lib/irisy-mcp-store';
import { PatiencePip } from './PatiencePip';
import styles from './ChatPane.module.css';

interface ChatPaneProps {
  onSubmit(text: string): void;
  busy: boolean;
}

export function ChatPane({ onSubmit, busy }: ChatPaneProps): React.ReactElement {
  const messages = useMcpCreatorStore((s) => s.messages);
  const fieldPending = useMcpCreatorStore((s) => s.fieldPending);
  const errors = useMcpCreatorStore((s) => s.errors);
  const installable = useMcpCreatorStore(selectInstallable);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lastAssistantStartRef = useRef<number | null>(null);

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Focus input when field-pending changes
  useEffect(() => {
    if (fieldPending !== null) {
      inputRef.current?.focus();
    }
  }, [fieldPending]);

  // Track when the latest streaming assistant turn started, for patience pip.
  // Effect (not render-body mutation) so React Strict Mode + concurrent
  // rendering can't double-fire the reset / overwrite (review P1).
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (lastMessage?.role === 'assistant' && !lastMessage.done) {
      if (lastAssistantStartRef.current === null) {
        lastAssistantStartRef.current = lastMessage.ts;
      }
    } else if (lastAssistantStartRef.current !== null) {
      lastAssistantStartRef.current = null;
    }
  }, [lastMessage?.role, lastMessage?.done, lastMessage?.ts]);

  const placeholder =
    fieldPending !== null
      ? `What should ${fieldPending} be?`
      : installable
        ? 'Anything to change before install?'
        : 'Tell Irisy what you want…';

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const text = inputRef.current?.value.trim() ?? '';
    if (text.length === 0 || busy) return;
    onSubmit(text);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
    }
  };

  return (
    <section className={styles.pane} aria-label="Chat with Irisy">
      <div ref={scrollerRef} className={styles.history}>
        {messages.length === 0 && (
          <div className={`${styles.bubble} ${styles.assistant}`}>
            Hi. Describe the mcp you want — what it does, when to trigger.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`${styles.bubble} ${
              m.role === 'user'
                ? styles.user
                : m.role === 'system'
                  ? styles.system
                  : styles.assistant
            }`}
          >
            {m.role === 'assistant' && !m.done && m.text.length === 0 ? (
              <PatiencePip startedAt={lastAssistantStartRef.current} />
            ) : (
              <pre className={styles.bubbleText}>{m.text || m.raw}</pre>
            )}
          </div>
        ))}
        {errors.some((e) => e.kind === 'semantic') && (
          <div className={`${styles.bubble} ${styles.error}`}>
            <pre className={styles.bubbleText}>
              {errors
                .filter((e) => e.kind === 'semantic')
                .map((e) => `· ${e.message}`)
                .join('\n')}
            </pre>
          </div>
        )}
      </div>

      <form className={styles.composer} onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className={styles.input}
          placeholder={placeholder}
          rows={2}
          disabled={busy}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button type="submit" className={styles.send} disabled={busy}>
          ⏎ Send
        </button>
      </form>
    </section>
  );
}
