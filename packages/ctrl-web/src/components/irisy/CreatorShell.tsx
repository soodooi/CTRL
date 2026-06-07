// [H-2026-05-18-001] CreatorShell — 3-zone layout for mcp-creator mode.
//
//   ┌───────────────────────────────────────────────────────────┐
//   │ Topbar (route-level)                       Discard ╳      │
//   ├──────────────────────┬────────────────────────────────────┤
//   │                      │  ManifestPreview                   │
//   │ ChatPane             ├────────────────────────────────────┤
//   │                      │  CodePreview                       │
//   ├──────────────────────┴────────────────────────────────────┤
//   │ InstallBar                                                │
//   └───────────────────────────────────────────────────────────┘

import type { ReactNode } from 'react';
import styles from './CreatorShell.module.css';

interface CreatorShellProps {
  chat: ReactNode;
  manifest: ReactNode;
  code: ReactNode;
  bar: ReactNode;
  header: ReactNode;
}

export function CreatorShell({
  chat,
  manifest,
  code,
  bar,
  header,
}: CreatorShellProps): React.ReactElement {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>{header}</header>
      <main className={styles.main}>
        <div className={styles.left}>{chat}</div>
        <div className={styles.right}>
          <div className={styles.rightTop}>{manifest}</div>
          <div className={styles.rightBottom}>{code}</div>
        </div>
      </main>
      <div className={styles.bottom}>{bar}</div>
    </div>
  );
}
