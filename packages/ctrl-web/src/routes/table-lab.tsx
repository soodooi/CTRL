// Table Lab — dev-only playground for the smart table + §14 query bar
// (SmartTableView). Renders the presentational view over sample data with
// local state so filter / sort / cell-edit all work without the kernel, for
// fast visual verification. Not wired into the real vault path.

import { useState, type ReactElement } from 'react';
import { SmartTableView } from '@/components/viewers/SmartTableView';
import { deleteRow, moveRow, parseSmartTable, updateCell, type SmartTable } from '@/lib/smart-table';

const SAMPLE = `---
title: Leads (table-lab)
schema:
  - { key: name, label: Name, type: text }
  - { key: amount, label: Amount, type: number, color_op: gt, color_value: 10000, color_bg: 140 }
  - { key: stage, label: Stage, type: select, options: [new, qualified, won, lost], color_op: eq, color_value: lost, color_bg: 8 }
  - { key: start, label: Start, type: date }
  - { key: due, label: Next follow-up, type: date }
  - { key: done, label: Done, type: checkbox }
  - { key: tags, label: Tags, type: tags }
---

| Name       | Amount | Stage     | Start      | Next follow-up | Done | Tags      |
|------------|--------|-----------|------------|----------------|------|-----------|
| Acme Corp  | 12000  | qualified | 2026-06-01 | 2026-06-20     | x    | crm, vip  |
| Beta LLC   | 4500   | new       | 2026-06-10 | 2026-07-01     |      | crm       |
| Cobalt Inc | 28000  | won       | 2026-06-05 | 2026-06-18     |      | lead, vip |
| Delta Co   | 800    | lost      | 2026-05-01 | 2026-05-15     | x    | crm       |
| Echo Ltd   | 15500  | qualified | 2026-06-12 | 2026-06-21     |      | lead      |
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
        />
      </div>
    </div>
  );
};
