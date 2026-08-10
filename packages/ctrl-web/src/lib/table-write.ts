// table-write — a smart-table cell change through the canonical write verb.
//
// A cell edit used to rewrite the whole table file with no precondition, so a
// second editor's save silently discarded the first and the reply could not say
// whether anything landed. What this buys is a truthful answer, not a merge: the
// revision covers the whole table, so an edit to a DIFFERENT cell still fails the
// precondition — it is now rejected and reported instead of overwriting, and the
// caller re-reads and retries. Conflict granularity is the owner's, not this
// module's.
//
// `value` is a string because the operation is string-valued end to end: the grid
// already converts every cell kind to text, and the table's own schema types it
// again on read. This module adds no coercion of its own.
// (ADR-002 substrate §15.2 v87; ADR-005 irisy §12 v42 U6)

import { resourceRefFor, writeRecord, type RecordWriteResult } from './record-write';

export const tableResourceRef = (path: string): string => resourceRefFor('table', path);

export async function setTableCell(
  path: string,
  row: number,
  field: string,
  value: string,
): Promise<RecordWriteResult> {
  return writeRecord(tableResourceRef(path), (expected_revision) => ({
    kind: 'set_cell',
    expected_revision,
    row,
    field,
    value,
  }));
}
