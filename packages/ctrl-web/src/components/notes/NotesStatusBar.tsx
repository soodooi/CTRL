// NotesStatusBar — bottom strip of the Notes editor column.
//
// bao 2026-06-03 (kairo-parity batch): per-note metadata + save state at
// a glance. Reads selected note via vault_read so the panel stays
// passive — no event coupling to the editor instance. Word / char counts
// derive from the latest persisted body (Tiptap dirty content is
// invisible to this surface by design; the editor surface itself shows
// its own dirty hint).

import { type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vaultRead } from '@/lib/kernel';
import styles from './Notes.module.css';

interface NotesStatusBarProps {
  path: string | null;
}

const countWords = (text: string): number => {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  // Split on Unicode word boundary; CJK each char counts as a word so
  // a 50-char Chinese note doesn't read as "0 words".
  let n = 0;
  let lastWasSpace = true;
  for (const ch of trimmed) {
    const isSpace = /\s/.test(ch);
    if (/\p{Script=Han}/u.test(ch) || /\p{Script=Hiragana}|\p{Script=Katakana}/u.test(ch)) {
      n += 1;
      lastWasSpace = true;
      continue;
    }
    if (!isSpace && lastWasSpace) n += 1;
    lastWasSpace = isSpace;
  }
  return n;
};

export const NotesStatusBar = ({ path }: NotesStatusBarProps): ReactElement => {
  const { data } = useQuery({
    queryKey: ['vault-read', path],
    queryFn: () => (path ? vaultRead(path) : Promise.resolve(null)),
    enabled: !!path,
    staleTime: 1_000,
  });

  if (!path) {
    return (
      <footer className={styles.notesStatus} aria-label="Note status">
        <span className={styles.notesStatusDim}>No note open</span>
      </footer>
    );
  }

  const body = typeof data?.body === 'string' ? data.body : '';
  const words = countWords(body);
  const chars = body.length;

  return (
    <footer className={styles.notesStatus} aria-label="Note status">
      <span className={styles.notesStatusPath} title={path}>
        {path}
      </span>
      <span className={styles.notesStatusSpacer} aria-hidden />
      <span className={styles.notesStatusMetric}>{words} words</span>
      <span className={styles.notesStatusDivider}>·</span>
      <span className={styles.notesStatusMetric}>{chars} chars</span>
      <span className={styles.notesStatusDivider}>·</span>
      <span className={styles.notesStatusSaved} title="Persisted to vault">
        ✓ Saved
      </span>
    </footer>
  );
};
