// Minimal feedback affordance: a small "Feedback" text button that opens a tiny
// popover (textarea + Send). Opt-in, no screenshot/telemetry — just the note.
import { useState, type ReactElement } from 'react';
import { submitFeedback, feedbackEnabled } from '@/lib/feedback';

export function FeedbackButton(): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);

  if (!feedbackEnabled) return null;

  async function send(): Promise<void> {
    if (text.trim() === '') return;
    const ok = await submitFeedback(text.trim());
    setSent(ok);
    if (ok) {
      setText('');
      window.setTimeout(() => {
        setOpen(false);
        setSent(false);
      }, 1200);
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          fontSize: 12,
          color: 'var(--text-muted, #6e6e73)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
        title="Send feedback"
      >
        Feedback
      </button>
      {open ? (
        <div
          style={{
            // fixed (not absolute) so the personaRow's overflow-x:auto can't clip it
            position: 'fixed',
            bottom: 72,
            right: 24,
            width: 260,
            background: 'var(--bg-elev, #fff)',
            border: '1px solid rgba(0,0,0,.12)',
            borderRadius: 10,
            padding: 10,
            boxShadow: '0 10px 30px -12px rgba(0,0,0,.35)',
            zIndex: 60,
          }}
        >
          {sent ? (
            <div style={{ fontSize: 13, color: '#0ca678', padding: 4 }}>Thanks — sent.</div>
          ) : (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What broke, or what do you want?"
                rows={3}
                style={{
                  width: '100%',
                  fontSize: 13,
                  border: '1px solid rgba(0,0,0,.12)',
                  borderRadius: 6,
                  padding: 6,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{ fontSize: 12, background: 'none', border: 'none', color: '#6e6e73', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void send()}
                  style={{
                    fontSize: 12,
                    background: '#3b5bda',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '4px 10px',
                    cursor: 'pointer',
                  }}
                >
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
