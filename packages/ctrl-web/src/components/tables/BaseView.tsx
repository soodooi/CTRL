// BaseView — a smart-table BASE opened: top sheet tabs (its data-tables) + the
// active sheet's grid/views. A Bitable IS a multi-sheet container (bao
// 2026-07-03: a smart-table must be multi-sheet), so opening one shows its
// data-tables as tabs — each a full SmartTableViewer with its own views.
// plan-tables-workspace-ux.md multi-sheet section.

import { useEffect, useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SmartTableViewer } from '@/components/viewers/SmartTableViewer';
import { resourceFromVaultPath } from '@/lib/viewer-resource';
import { createSheetInBase, type Base } from '@/lib/smart-tables';
import styles from './TablesPanel.module.css';

interface BaseViewProps {
  base: Base;
  /** Report the active sheet path up so the shell feeds it to Irisy. */
  onActiveSheet?: (path: string | null) => void;
}

export function BaseView({ base, onActiveSheet }: BaseViewProps): ReactElement {
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(base.sheets[0]?.path ?? null);
  const [adding, setAdding] = useState(false);

  // Keep the active sheet valid as the base's sheets change (add / switch base).
  useEffect(() => {
    setActive((cur) => (cur && base.sheets.some((s) => s.path === cur) ? cur : base.sheets[0]?.path ?? null));
  }, [base]);

  useEffect(() => {
    onActiveSheet?.(active);
    return () => onActiveSheet?.(null);
  }, [active, onActiveSheet]);

  const addSheet = async (): Promise<void> => {
    setAdding(true);
    try {
      const path = await createSheetInBase(base.id, `Table ${base.sheets.length + 1}`);
      await qc.invalidateQueries({ queryKey: ['bases'] });
      setActive(path);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className={styles.baseView}>
      <div className={styles.sheetTabs} role="tablist" aria-label={`${base.name} data tables`}>
        {base.sheets.map((s) => (
          <button
            key={s.path}
            type="button"
            role="tab"
            aria-selected={s.path === active}
            className={styles.sheetTab}
            data-active={s.path === active || undefined}
            onClick={() => setActive(s.path)}
          >
            {s.title}
          </button>
        ))}
        <button
          type="button"
          className={styles.sheetAdd}
          onClick={() => void addSheet()}
          disabled={adding}
          title="Add a data table to this base"
          data-testid="base-add-sheet"
        >
          +
        </button>
      </div>
      <div className={styles.sheetBody}>
        {active != null ? (
          <SmartTableViewer key={active} resource={resourceFromVaultPath(active)} />
        ) : (
          <div className={styles.detailEmpty}>This base has no tables yet.</div>
        )}
      </div>
    </div>
  );
}
