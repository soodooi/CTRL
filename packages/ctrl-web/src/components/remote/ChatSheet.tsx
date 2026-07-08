// ChatSheet — the Irisy conversation on the phone, as a slide-in sheet from the
// right (ADR-005 §2 — the desktop's right chat column mapped onto the phone).
// Reachable by swiping from the right edge or tapping the Irisy button. Talks to
// Irisy on the DESKTOP over the tunnel (streamed), so it's the same assistant.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ChatHandlers } from '@/lib/remote-connection';
import styles from './ChatSheet.module.css';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}

export function ChatSheet({
  open,
  onClose,
  onChat,
}: {
  open: boolean;
  onClose: () => void;
  /** Send a message to Irisy on the desktop; reply streams back via handlers. */
  onChat?: (text: string, handlers: ChatHandlers) => void;
}): ReactElement {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [msgs]);

  const send = (): void => {
    const text = input.trim();
    if (text === '' || busy || onChat == null) return;
    setInput('');
    setBusy(true);
    setMsgs((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '' }]);
    onChat(text, {
      onChunk: (delta) =>
        setMsgs((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last != null) copy[copy.length - 1] = { role: 'assistant', text: last.text + delta };
          return copy;
        }),
      onDone: (error) => {
        setBusy(false);
        if (error != null) {
          setMsgs((m) => {
            const copy = [...m];
            const last = copy[copy.length - 1];
            if (last != null && last.text === '') {
              copy[copy.length - 1] = { role: 'assistant', text: `(couldn't reach Irisy: ${error})` };
            }
            return copy;
          });
        }
      },
    });
  };

  return (
    <>
      {open && <div className={styles.scrim} onClick={onClose} />}
      <div className={styles.sheet} data-open={open || undefined}>
        <div className={styles.head}>
          <span className={styles.title}>
            <span className={styles.spark}>✦</span> Irisy
          </span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.body} ref={bodyRef}>
          {msgs.length === 0 ? (
            <div className={styles.hint}>
              Talk to Irisy on your desktop — same assistant, tunneled over the gate.
            </div>
          ) : (
            msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? styles.msgUser : styles.msgAsst}>
                {m.text || '…'}
              </div>
            ))
          )}
        </div>
        <div className={styles.composer}>
          <input
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Ask Irisy…"
          />
          <button type="button" className={styles.sendBtn} onClick={send} disabled={busy}>
            ↑
          </button>
        </div>
      </div>
    </>
  );
}
