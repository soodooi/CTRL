// SmartTableRecordCard — the expanded record detail overlay, extracted from
// SmartTableView. Renders one row's fields (type-aware via Cell / LinkPicker,
// read-only relational + formula) with Duplicate / Delete actions. Closes on
// backdrop click or any action.

import { type ReactElement } from 'react';
import { evalFormula } from '@/lib/smart-table-formula';
import { relationalDisplay } from '@/lib/smart-table-relations';
import type { ColumnSpec, SmartTable } from '@/lib/smart-table';
import { Cell, LinkPicker } from './SmartTableCells';
import styles from './Viewer.module.css';

interface RecordCardProps {
  table: SmartTable;
  /** Canonical row index of the open record. */
  rowIndex: number;
  /** Fields to show (system columns already filtered out). */
  visibleSchema: ColumnSpec[];
  editable: boolean;
  relations: Record<string, SmartTable>;
  onCellChange: (rowIndex: number, key: string, value: string) => void;
  onClose: () => void;
  onDuplicateRow?: (rowIndex: number) => void;
  onDeleteRow?: (rowIndex: number) => void;
}

export const SmartTableRecordCard = ({
  table,
  rowIndex,
  visibleSchema,
  editable,
  relations,
  onCellChange,
  onClose,
  onDuplicateRow,
  onDeleteRow,
}: RecordCardProps): ReactElement => {
  const row = table.rows[rowIndex] ?? {};
  return (
    <div className={styles.recordOverlay} onClick={onClose} data-testid="record-card">
      <div className={styles.recordCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.recordHead}>
          <span className={styles.recordTitle}>Record</span>
          <button type="button" className={styles.tableRowAction} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {visibleSchema.map((c) => (
          <div key={c.key} className={styles.recordField}>
            <span className={styles.recordLabel}>{c.label}</span>
            <span className={styles.recordValue}>
              {c.type === 'link' ? (
                <span data-testid={`link-picker-${c.key}`}>
                  <LinkPicker
                    value={row[c.key] ?? ''}
                    target={c.foreignTable ? relations[c.foreignTable] : undefined}
                    editable={editable}
                    onChange={(ids) => onCellChange(rowIndex, c.key, ids)}
                  />
                </span>
              ) : c.type === 'lookup' || c.type === 'rollup' ? (
                <span className={styles.cellText}>
                  {relationalDisplay(row, c, table.schema, relations) || '—'}
                </span>
              ) : c.type === 'formula' ? (
                <span className={styles.cellText}>{evalFormula(c.expression ?? '', row) || '—'}</span>
              ) : (
                <Cell
                  col={c}
                  value={row[c.key] ?? ''}
                  editable={editable}
                  onChange={(v) => onCellChange(rowIndex, c.key, v)}
                />
              )}
            </span>
          </div>
        ))}
        {editable && (onDuplicateRow || onDeleteRow) && (
          <div className={styles.recordActions}>
            {onDuplicateRow && (
              <button
                type="button"
                className={styles.queryToggle}
                data-testid="record-duplicate"
                onClick={() => {
                  onDuplicateRow(rowIndex);
                  onClose();
                }}
              >
                ⧉ Duplicate
              </button>
            )}
            {onDeleteRow && (
              <button
                type="button"
                className={styles.batchDelete}
                data-testid="record-delete"
                onClick={() => {
                  onDeleteRow(rowIndex);
                  onClose();
                }}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
