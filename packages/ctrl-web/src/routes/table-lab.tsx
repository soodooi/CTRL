// Table Lab — dev-only playground for the smart table + §14 query bar
// (SmartTableView). Renders the presentational view over sample data with
// local state so filter / sort / cell-edit all work without the kernel, for
// fast visual verification. Not wired into the real vault path.

import { useState, type ReactElement } from 'react';
import { SmartTableView } from '@/components/viewers/SmartTableView';
import {
  addColumn,
  deleteColumn,
  deleteRow,
  duplicateRow,
  moveRow,
  parseSmartTable,
  updateCell,
  updateColumn,
  type ColumnSpec,
  type SmartTable,
} from '@/lib/smart-table';

const SAMPLE = `---
title: Leads (table-lab)
schema:
  - { key: name, label: Name, type: text }
  - { key: amount, label: Amount, type: number, color_op: gt, color_value: 10000, color_bg: 140 }
  - { key: seats, label: Seats, type: integer }
  - { key: stage, label: Stage, type: select, options: [new, qualified, won, lost], color_op: eq, color_value: lost, color_bg: 8 }
  - { key: start, label: Start, type: date }
  - { key: meeting, label: Next meeting, type: datetime }
  - { key: notes, label: Notes, type: multiline }
  - { key: done, label: Done, type: checkbox }
  - { key: tags, label: Tags, type: tags }
---

| Name       | Amount | Seats | Stage     | Start      | Next meeting     | Notes                                                        | Done | Tags      |
|------------|--------|-------|-----------|------------|------------------|--------------------------------------------------------------|------|-----------|
| Acme Corp  | 12000  | 25    | qualified | 2026-06-01 | 2026-06-20T14:30 | Renewal call went well; they want a security review and SSO. | x    | crm, vip  |
| Beta LLC   | 4500   | 8     | new       | 2026-06-10 | 2026-07-01T09:00 | Inbound from the pricing page; needs a demo of the API.      |      | crm       |
| Cobalt Inc | 28000  | 120   | won       | 2026-06-05 | 2026-06-18T16:15 | Signed; onboarding kickoff scheduled with their ops team.    |      | lead, vip |
| Delta Co   | 800    | 3     | lost      | 2026-05-01 | 2026-05-15T11:00 | Budget cut for the quarter; revisit next fiscal year.        | x    | crm       |
| Echo Ltd   | 15500  | 40    | qualified | 2026-06-12 | 2026-06-21T10:45 | Evaluating us against two competitors; price-sensitive.      |      | lead      |
`;

export const TableLabRoute = (): ReactElement => {
  const [table, setTable] = useState<SmartTable>(() => parseSmartTable(SAMPLE));
  return (
    <div style={{ padding: 'var(--space-5, 24px)', maxWidth: 960 }}>
      <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 14, marginBottom: 12 }}>
        table-lab — §14 query bar over a smart table
      </h2>
      <div style={{ border: '1px solid var(--color-border, #2a2a2a)', borderRadius: 8, overflow: 'hidden' }}>
        <SmartTableView
          table={table}
          editable
          onCellChange={(i, k, v) => setTable((t) => updateCell(t, i, k, v))}
          onDeleteRow={(i) => setTable((t) => deleteRow(t, i))}
          onMoveRow={(from, to) => setTable((t) => moveRow(t, from, to))}
          onDuplicateRow={(i) => setTable((t) => duplicateRow(t, i))}
          onAddColumn={(col: ColumnSpec) => setTable((t) => addColumn(t, col))}
          onUpdateColumn={(key, patch) => setTable((t) => updateColumn(t, key, patch))}
          onDeleteColumn={(key) => setTable((t) => deleteColumn(t, key))}
        />
      </div>
    </div>
  );
};
