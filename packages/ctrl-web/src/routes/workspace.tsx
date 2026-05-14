// /workspace — ephemeral workspace route.
//
// Per bao 2026-05-14, this route loads in a DEDICATED window (label =
// "workspace" in tauri.conf.json), not as a tab in the main launcher.
// The Rust shell navigates this window's URL on each keycap activation,
// so the route reads `keycap_id` from the URL search params (or hash
// param when navigation uses location.hash + hashchange dispatch).

import { useEffect, useState } from 'react';
import styles from './workspace.module.css';

const readKeycapId = (): string | null => {
  if (typeof window === 'undefined') return null;
  const search = new URLSearchParams(window.location.search);
  if (search.has('keycap_id')) return search.get('keycap_id');
  const hash = window.location.hash;
  const hashQs = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const hashSearch = new URLSearchParams(hashQs);
  return hashSearch.get('keycap_id');
};

export const WorkspaceRoute = (): React.ReactElement => {
  const [keycapId, setKeycapId] = useState<string | null>(() => readKeycapId());

  useEffect(() => {
    const onHashChange = (): void => setKeycapId(readKeycapId());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <div className={styles.layout}>
      <main className={styles.main} role="main">
        <h1 className={styles.title}>Workspace</h1>
        {keycapId ? (
          <>
            <p className={styles.subtitle}>
              Running keycap: <code className={styles.code}>{keycapId}</code>
            </p>
            <p className={styles.hint}>
              Keycap actor execution + Cell stream renderer ship in sub-PR f
              (P5 + P6 wiring). This window currently confirms the keycap
              activation reached the dedicated workspace surface.
            </p>
          </>
        ) : (
          <p className={styles.subtitle}>Pick a keycap from the pool to start.</p>
        )}
      </main>
    </div>
  );
};
