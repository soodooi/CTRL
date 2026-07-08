// Mobile remote shell — the phone-side view when CTRL is opened remotely
// (ADR-005 §2 semantic co-view, option B). A full-height content area over a
// fixed bottom nav that switches between the desktop-allowlisted functions.
// Each function renders NATIVELY (the same PWA surfaces — stock cockpit, packs),
// NOT a pixel stream.
//
// Content is a render-prop so the shell stays decoupled from the heavy scenes;
// the desktop→phone data wiring (the connected session) lands in S3. This shell
// renders + visually verifies standalone with mock entries + content.
import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { ChatHandlers } from '@/lib/remote-connection';
import { ChatSheet } from './ChatSheet';
import styles from './MobileRemoteShell.module.css';

export interface RemoteNavEntry {
  key: string;
  label: string;
  /** Short glyph for the bottom-nav tab. */
  icon: string;
}

interface MobileRemoteShellProps {
  entries: RemoteNavEntry[];
  /** Render the active function's surface. */
  renderContent: (key: string) => ReactNode;
  /** Optional starting tab; defaults to the first entry. */
  initialKey?: string;
  /** Talk to Irisy on the desktop (enables the conversation sheet). */
  onChat?: (text: string, handlers: ChatHandlers) => void;
}

export function MobileRemoteShell({
  entries,
  renderContent,
  initialKey,
  onChat,
}: MobileRemoteShellProps): ReactElement {
  const [active, setActive] = useState<string>(initialKey ?? entries[0]?.key ?? '');
  const [chatOpen, setChatOpen] = useState(false);
  const touchX = useRef<number | null>(null);

  // Swipe-from-right-edge opens Irisy (the visible button is the discoverable
  // affordance so it isn't a hidden-only gesture).
  const onTouchStart = (e: React.TouchEvent): void => {
    touchX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent): void => {
    const start = touchX.current;
    const end = e.changedTouches[0]?.clientX ?? null;
    if (start != null && end != null && start - end > 60) setChatOpen(true);
    touchX.current = null;
  };

  if (entries.length === 0) {
    return (
      <div className={styles.shell}>
        <div className={styles.empty}>
          Nothing shared yet. On the desktop, open Remote Window and allow a function.
        </div>
        {onChat != null && (
          <>
            <button type="button" className={styles.irisyFab} onClick={() => setChatOpen(true)}>
              <span className={styles.spark}>✦</span>
            </button>
            <ChatSheet open={chatOpen} onClose={() => setChatOpen(false)} onChat={onChat} />
          </>
        )}
      </div>
    );
  }

  return (
    <div className={styles.shell} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className={styles.content} key={active}>
        {renderContent(active)}
      </div>
      {onChat != null && (
        <button
          type="button"
          className={styles.irisyFab}
          onClick={() => setChatOpen(true)}
          aria-label="Talk to Irisy"
        >
          <span className={styles.spark}>✦</span>
        </button>
      )}
      <nav className={styles.nav} aria-label="Remote functions">
        {entries.map((e) => (
          <button
            key={e.key}
            type="button"
            className={styles.tab}
            data-active={e.key === active || undefined}
            onClick={() => setActive(e.key)}
            aria-current={e.key === active ? 'page' : undefined}
          >
            <span className={styles.tabIcon}>{e.icon}</span>
            <span className={styles.tabLabel}>{e.label}</span>
          </button>
        ))}
      </nav>
      {onChat != null && (
        <ChatSheet open={chatOpen} onClose={() => setChatOpen(false)} onChat={onChat} />
      )}
    </div>
  );
}
