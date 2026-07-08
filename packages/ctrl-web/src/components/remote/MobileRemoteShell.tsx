// Mobile remote shell — the phone-side view when CTRL is opened remotely
// (ADR-005 §2 semantic co-view, option B). A full-height content area over a
// fixed bottom nav that switches between the desktop-allowlisted functions.
// Each function renders NATIVELY (the same PWA surfaces — stock cockpit, packs),
// NOT a pixel stream.
//
// Content is a render-prop so the shell stays decoupled from the heavy scenes;
// the desktop→phone data wiring (the connected session) lands in S3. This shell
// renders + visually verifies standalone with mock entries + content.
import { useState, type ReactElement, type ReactNode } from 'react';
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
}

export function MobileRemoteShell({
  entries,
  renderContent,
  initialKey,
}: MobileRemoteShellProps): ReactElement {
  const [active, setActive] = useState<string>(initialKey ?? entries[0]?.key ?? '');

  if (entries.length === 0) {
    return (
      <div className={styles.shell}>
        <div className={styles.empty}>
          Nothing shared yet. On the desktop, open Remote Window and allow a function.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div className={styles.content} key={active}>
        {renderContent(active)}
      </div>
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
    </div>
  );
}
