// BacklinksPanel — scan the vault for files that reference `path`.
//
// Client-side only: walks every markdown file via vault_read, looks for
// `[[path]]` wikilinks and `[label](path)` markdown links targeting our
// file. This is naive O(N) — fine for vaults up to a few hundred notes.
// When the kernel exposes a real backlink index (gap E, hephaestus
// lane), we swap the scan for a single backlink query.

import { useEffect, useState, type ReactElement } from 'react';
import { vaultList, vaultRead } from '@/lib/kernel';
import styles from './VaultBrowser.module.css';

interface BacklinkHit {
  path: string;
  /** Snippet around the link (~60 chars). */
  preview: string;
}

interface BacklinksPanelProps {
  path: string;
}

const baseName = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
};

const stem = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

const buildRegex = (target: string): RegExp => {
  // Match either a wikilink `[[stem]]` or a normal markdown link to
  // the relative path (or its basename). Escape regex metachars.
  const file = baseName(target);
  const fileStem = stem(file);
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(\\[\\[${esc(fileStem)}\\]\\]|\\]\\(${esc(target)}\\)|\\]\\(${esc(file)}\\))`,
    'g',
  );
};

export const BacklinksPanel = ({ path }: BacklinksPanelProps): ReactElement => {
  const [hits, setHits] = useState<BacklinkHit[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setScanning(true);
    setHits([]);
    void (async () => {
      try {
        const paths = await vaultList();
        const regex = buildRegex(path);
        const collected: BacklinkHit[] = [];
        for (const p of paths) {
          if (p === path || !p.endsWith('.md')) continue;
          try {
            const entry = await vaultRead(p);
            const match = regex.exec(entry.body);
            if (match) {
              const start = Math.max(0, match.index - 30);
              const end = Math.min(entry.body.length, match.index + 60);
              const preview = entry.body.slice(start, end).replace(/\s+/g, ' ');
              collected.push({ path: p, preview });
            }
            regex.lastIndex = 0;
            if (cancelled) return;
          } catch {
            // Skip unreadable files (binary / permission).
          }
        }
        if (!cancelled) {
          setHits(collected);
          setScanning(false);
        }
      } catch {
        if (!cancelled) setScanning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div className={styles.backlinks}>
      <h2 className={styles.sidebarTitle}>Backlinks</h2>
      {scanning ? (
        <p className={styles.muted}>Scanning…</p>
      ) : hits.length === 0 ? (
        <p className={styles.muted}>No notes link here yet.</p>
      ) : (
        <ul className={styles.backlinkList}>
          {hits.map((hit) => (
            <li key={hit.path} className={styles.backlinkItem}>
              <div className={styles.backlinkPath}>{hit.path}</div>
              <div className={styles.backlinkPreview}>…{hit.preview}…</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
