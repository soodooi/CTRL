// StarToggle — single-button toggle for the `starred` frontmatter
// flag on a vault note.
//
// (ADR-002 substrate § vault v1 §8.6 v5, 2026-06-02 — kairo feature
// parity batch.)
//
// Calls the kernel `vault_set_starred` command (which read-modify-
// writes the frontmatter `starred:` scalar). UI state is sourced
// from the same `vault_read` query that the frontmatter panel uses,
// so the indicator stays in sync with manual edits.

import { useCallback, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { vaultRead, vaultSetStarred } from '@/lib/kernel';
import styles from './Notes.module.css';

interface StarToggleProps {
  path: string | null;
}

export const StarToggle = ({ path }: StarToggleProps): ReactElement | null => {
  const queryClient = useQueryClient();
  const { data: starred = false } = useQuery({
    queryKey: ['vault-starred', path],
    queryFn: async () => {
      if (!path) return false;
      const entry = await vaultRead(path);
      const fm = (entry.frontmatter ?? {}) as Record<string, unknown>;
      return fm.starred === true;
    },
    enabled: !!path,
    staleTime: 30_000,
  });

  const handleToggle = useCallback(async () => {
    if (!path) return;
    try {
      await vaultSetStarred(path, !starred);
      queryClient.invalidateQueries({ queryKey: ['vault-starred', path] });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('star toggle failed', err);
    }
  }, [path, starred, queryClient]);

  if (!path) return null;

  return (
    <button
      type="button"
      className={styles.starButton}
      data-on={starred || undefined}
      onClick={() => void handleToggle()}
      aria-label={starred ? 'Unstar note' : 'Star note'}
      title={starred ? 'Unstar' : 'Star this note'}
    >
      {starred ? '★' : '☆'}
    </button>
  );
};
