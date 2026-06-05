// VaultHealthFold — collapsible sidebar widget matching kairo v0.1.0
// "Vault Health" affordance. Default collapsed; expands to show a few
// at-a-glance vault metrics (file count + simple sanity hints).
//
// (ADR-002 substrate § vault v1 §8.6 v6, 2026-06-05 — bao kairo 1:1
// revert.) Backend is kernel/vault.rs `vault_list` (already-cached
// query). Heavier dashboards (orphans / broken-links) are intentionally
// NOT surfaced as buttons here — Irisy can ask via MCP if the user
// asks "what's broken in my vault".

import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vaultList } from '@/lib/kernel';
import styles from './Notes.module.css';

export const VaultHealthFold = (): ReactElement => {
  const [open, setOpen] = useState(false);

  const { data: entries } = useQuery({
    queryKey: ['vault-list'],
    queryFn: () => vaultList(),
    staleTime: 30_000,
  });

  const total = Array.isArray(entries) ? entries.length : 0;

  return (
    <div className={styles.healthFold}>
      <button
        type="button"
        className={styles.healthFoldHeader}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={styles.healthFoldChevron}
          data-open={open || undefined}
          aria-hidden
        >
          ▸
        </span>
        <span>Vault Health</span>
        <span className={styles.healthFoldCount}>{total}</span>
      </button>
      {open ? (
        <div className={styles.healthFoldBody}>
          <span className={styles.healthFoldRow}>
            <span>Notes</span>
            <span className={styles.healthFoldDim}>{total}</span>
          </span>
          <span className={styles.healthFoldHint}>
            Ask Irisy for orphans / broken links.
          </span>
        </div>
      ) : null}
    </div>
  );
};
