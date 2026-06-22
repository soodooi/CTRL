// useTableQuery — the §14 query orchestration for the smart-table viewer,
// extracted from SmartTableView so the view component stays presentational.
//
// It computes the queried result two ways and picks the right one:
//   - client engine (queryTable) — always in sync with the in-memory table;
//   - kernel gate (runQuery) — the shared §14 engine, used when the host wires
//     it and the result is still consistent with the current table.
// Each row keeps its canonical `__idx` so index-based edits target the right
// underlying row; quick search narrows the result on top.

import { useEffect, useMemo, useState } from 'react';
import type { SmartTableQueryRequest, SmartTableQueryResult } from '@/lib/kernel';
import { attachCanonicalIdx, buildGateRequest } from '@/lib/smart-table-gate-bridge';
import type { SmartTable } from '@/lib/smart-table';
import { queryTable, type Filter, type QueryResult, type SortKey } from '@/lib/smart-table-query';

export interface TableQueryState {
  filters: Filter[];
  conjunction: 'and' | 'or';
  /** Ordered sort keys (first wins, the rest break ties — Grist multi-sort). */
  sort: SortKey[];
  groupBy: string | null;
  groupBy2: string | null;
  search: string;
}

export const useTableQuery = (
  table: SmartTable,
  state: TableQueryState,
  runQuery?: (request: SmartTableQueryRequest) => Promise<SmartTableQueryResult>,
): QueryResult => {
  const { filters, conjunction, sort, groupBy, groupBy2, search } = state;

  // Stamp each row with its canonical index so edits on a filtered/sorted view
  // still target the right underlying row.
  const indexed = useMemo(
    () => ({ ...table, rows: table.rows.map((r, i) => ({ ...r, __idx: String(i) })) }),
    [table],
  );
  const clientQueried = useMemo(
    () =>
      queryTable(indexed, {
        filters,
        conjunction,
        sort,
        groupBy: [groupBy, groupBy2].filter((g): g is string => Boolean(g)),
      }),
    [indexed, filters, conjunction, sort, groupBy, groupBy2],
  );

  // Route the same structured query through the kernel gate when available. The
  // kernel keys on the stable record id, so we re-attach each row's canonical
  // __idx. The result is stamped with the `table` it was computed from and only
  // trusted while that ref is current — an in-flight response can never render
  // against a since-edited table (the client result, always in sync, covers the
  // gap). Any error / incomplete id coverage → client fallback (local-first).
  const [kernelResult, setKernelResult] = useState<{
    rows: Array<Record<string, string>>;
    matchCount: number;
    forTable: SmartTable;
  } | null>(null);
  useEffect(() => {
    if (!runQuery) {
      setKernelResult(null);
      return;
    }
    let live = true;
    const request = buildGateRequest(filters, conjunction, sort, [groupBy, groupBy2]);
    runQuery(request)
      .then((res) => {
        if (!live) return;
        const rows = attachCanonicalIdx(res.rows, table);
        if (rows.some((r) => r.__idx === '-1')) {
          setKernelResult(null);
          return;
        }
        setKernelResult({ rows, matchCount: res.match_count, forTable: table });
      })
      .catch(() => {
        if (live) setKernelResult(null);
      });
    return () => {
      live = false;
    };
  }, [runQuery, filters, conjunction, sort, groupBy, groupBy2, table]);

  const queried =
    runQuery && kernelResult && kernelResult.forTable === table
      ? { rows: kernelResult.rows, matchCount: kernelResult.matchCount }
      : clientQueried;

  // Quick search narrows the queried rows by a case-insensitive substring match
  // across every cell (composes on top of the structured filters).
  return useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return queried;
    return {
      ...queried,
      rows: queried.rows.filter((r) =>
        Object.values(r).some((v) => String(v).toLowerCase().includes(q)),
      ),
    };
  }, [queried, search]);
};
