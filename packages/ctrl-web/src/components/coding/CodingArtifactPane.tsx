// CodingArtifactPane — left half of the Coding L1 split layout
// (routes/coding.tsx), paired with <OpencodeChat /> on the right.
//
// ADR-002 substrate §1 v20 (2026-06-10): files come from opencode's
// `file.edited` bus events (verified against opencode 1.17 types) —
// the Pi getMessages projection died with Pi. The pane subscribes to
// the same /event SSE bus the chat uses, via the shared port slot, so
// it never triggers a second launch_agent.

import { useEffect, useState, type ReactElement } from 'react';
import {
  fileEditedPath,
  subscribeActiveOpencodePort,
  subscribeOpencodeEvents,
} from '@/lib/opencode-chat';
import styles from './CodingArtifactPane.module.css';

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

export function CodingArtifactPane(): ReactElement {
  const [files, setFiles] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

  useEffect(() => {
    let unsubBus: (() => void) | null = null;
    const unsubPort = subscribeActiveOpencodePort((port) => {
      unsubBus?.();
      unsubBus = null;
      if (port === null) return;
      unsubBus = subscribeOpencodeEvents(port, (evt) => {
        const path = fileEditedPath(evt);
        if (!path) return;
        setFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
        setActivePath(path);
      });
    });
    return () => {
      unsubBus?.();
      unsubPort();
    };
  }, []);

  return (
    <div className={styles.pane}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>artifacts</span>
        <span className={styles.headerCount}>{files.length}</span>
      </div>
      {files.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>no files yet</span>
          <span className={styles.emptyHint}>
            Files opencode writes or edits in this session will be listed
            here as it touches them.
          </span>
        </div>
      ) : (
        <>
          <div className={styles.tabs} role="tablist">
            {files.map((f) => (
              <button
                key={f}
                role="tab"
                type="button"
                aria-selected={f === activePath}
                className={`${styles.tab} ${f === activePath ? styles.tabActive : ''}`}
                title={f}
                onClick={() => setActivePath(f)}
              >
                {basename(f)}
              </button>
            ))}
          </div>
          <div className={styles.viewer}>
            {activePath
              ? `${activePath}\n\nEdited by opencode this session — open it on disk for the full body.`
              : ''}
          </div>
        </>
      )}
    </div>
  );
}
