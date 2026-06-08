// /pool — Cap catalog (smart-table view, bao 2026-06-04).
//
// Renamed conceptually from "Pool of installed mcps" to a unified
// catalog of caps. bao 2026-06-04: "the old mcp pool is too complex,
// switch to a smart table" -- the card grid is gone, replaced by a
// TanStack-Table v8 grid that surfaces source / name / description /
// actions per row.
//
// Skills (cap = the hat Pi wears, bao 2026-06-04 mapping) are first-
// class rows alongside builtin / mcp / oauth / local / stss. Selecting
// a skill row calls `wearCap(name)` on the session-state store and
// navigates back to Irisy -- the chat picks up the new system prompt
// on the next turn. Other sources keep the existing `openWorkspace`
// flow.
//
// memory `feedback_build_system_not_business`: the table is a system
// surface, the rows are user data. We do not synthesize "smart" columns
// the kernel did not ship -- formula / custom columns are v2.x scope.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { invoke } from '@/lib/bridge';
import { listMcps, openWorkspace, type McpSummary } from '@/lib/kernel';
import { useRail } from '@/components/PrimaryRail';
import { useSessionStateStore } from '@/lib/session-state';
import { StatusPill, type LedTone } from '@/components/primitives';
import styles from './pool.module.css';

type CapSource = 'builtin' | 'mcp' | 'oauth' | 'local' | 'stss' | 'skill';

interface CapRow {
  rowKey: string;
  id: string;
  name: string;
  source: CapSource;
  description: string;
}

interface LocalSkillItem {
  name: string;
  description?: string | null;
  path: string;
}

const SOURCE_LABEL: Record<CapSource, string> = {
  builtin: 'Built-in',
  mcp: 'MCP',
  oauth: 'OAuth',
  local: 'Local',
  stss: 'ST-SS',
  skill: 'Skill',
};

const SOURCE_TONE: Record<CapSource, LedTone> = {
  builtin: 'info',
  mcp: 'nominal',
  oauth: 'caution',
  local: 'warning',
  stss: 'info',
  skill: 'nominal',
};

const inferMcpSource = (k: McpSummary): CapSource => {
  if (k.id.startsWith('ctrl.builtin.')) return 'builtin';
  if (k.id.startsWith('mcp:')) return 'mcp';
  if (k.id.startsWith('oauth:')) return 'oauth';
  if (k.id.startsWith('local:')) return 'local';
  if (k.id.startsWith('stss:')) return 'stss';
  return 'builtin';
};

const toRowFromMcp = (k: McpSummary): CapRow => ({
  rowKey: `mcp:${k.id}`,
  id: k.id,
  name: k.name,
  source: inferMcpSource(k),
  description: k.id,
});

const toRowFromSkill = (s: LocalSkillItem): CapRow => ({
  rowKey: `skill:${s.name}`,
  id: s.name,
  name: s.name,
  source: 'skill',
  description: s.description ?? '',
});

const SearchIcon = (): ReactElement => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);

const columnHelper = createColumnHelper<CapRow>();

const SOURCES_FOR_FILTER: ReadonlyArray<{ id: CapSource | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'skill', label: 'Skill' },
  { id: 'builtin', label: 'Built-in' },
  { id: 'mcp', label: 'MCP' },
  { id: 'oauth', label: 'OAuth' },
  { id: 'local', label: 'Local' },
  { id: 'stss', label: 'ST-SS' },
];

export const PoolRoute = (): ReactElement => {
  // ADR-002 substrate § brain v17 (2026-06-07): `wearCap` retired with the
  // cap mode. Skills are now invocable references Irisy reads on demand
  // (via list_skills / read_skill); skill rows render as docs only, no
  // "wear" button. The on-tab status banner stays as scaffolding for any
  // future action-row affordance.
  const { setIrisyState } = useRail();
  const [activeFilter, setActiveFilter] = useState<CapSource | 'all'>('all');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [wearStatus, setWearStatus] = useState<string | null>(null);

  const { data: mcps = [], isLoading: mcpsLoading } = useQuery({
    queryKey: ['mcps'],
    queryFn: listMcps,
  });

  const { data: skills = [], isLoading: skillsLoading } = useQuery({
    queryKey: ['local-skills'],
    queryFn: () => invoke<LocalSkillItem[]>('list_local_skills', { query: null }),
  });

  const isLoading = mcpsLoading || skillsLoading;

  const rows = useMemo<CapRow[]>(() => {
    const mcpRows = mcps.map(toRowFromMcp);
    const skillRows = (skills ?? []).map(toRowFromSkill);
    return [...mcpRows, ...skillRows];
  }, [mcps, skills]);

  const counts = useMemo(() => {
    const tally: Record<CapSource | 'all', number> = {
      all: rows.length,
      builtin: 0,
      mcp: 0,
      oauth: 0,
      local: 0,
      stss: 0,
      skill: 0,
    };
    for (const r of rows) tally[r.source] += 1;
    return tally;
  }, [rows]);

  // ADR-002 substrate § brain v17 (2026-06-07): wear-cap action retired
  // along with the cap mode. Skill rows render as documentation; users
  // invoke skills by naming them in chat so Irisy reads SKILL.md on
  // demand via her list_skills / read_skill tools.

  const handleRun = (mcpId: string): void => {
    void openWorkspace(mcpId).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Unexpected error';
      setActivationError(`Run failed for "${mcpId}": ${msg}`);
    });
  };

  const columns = useMemo(
    () => [
      columnHelper.accessor('source', {
        header: 'Source',
        cell: (info) => {
          const s = info.getValue() as CapSource;
          return <StatusPill tone={SOURCE_TONE[s]}>{SOURCE_LABEL[s]}</StatusPill>;
        },
        size: 110,
      }),
      columnHelper.accessor('name', {
        header: 'Name',
        cell: (info) => <span style={{ fontWeight: 500 }}>{info.getValue()}</span>,
      }),
      columnHelper.accessor('description', {
        header: 'Description',
        cell: (info) => (
          <span style={{ color: 'var(--text-muted, #6b7280)', fontSize: 13 }}>
            {info.getValue() || '—'}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => {
          const row = info.row.original;
          // ADR-002 substrate § brain v17 (2026-06-07): skill rows have no
          // action button — invocation is by name in chat, not by pinning
          // a session-state slot. Other source types keep the Run flow.
          if (row.source === 'skill') {
            return null;
          }
          return (
            <button
              type="button"
              onClick={() => handleRun(row.id)}
              style={{
                padding: '4px 12px',
                border: '1px solid var(--surface-border, #d1d5db)',
                background: 'transparent',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                whiteSpace: 'nowrap',
              }}
            >
              Run
            </button>
          );
        },
        size: 120,
      }),
    ],
    // handleWear / handleRun are stable enough for this short-lived
    // route -- re-creating the columns array on every render avoids
    // wiring memo deps through closure-captured store actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const filteredRows = useMemo(
    () =>
      activeFilter === 'all' ? rows : rows.filter((r) => r.source === activeFilter),
    [rows, activeFilter],
  );

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  useEffect(() => {
    setIrisyState('idle');
    return () => setIrisyState('idle');
  }, [setIrisyState]);

  useEffect(() => {
    if (!activationError) return;
    const t = window.setTimeout(() => setActivationError(null), 4000);
    return () => window.clearTimeout(t);
  }, [activationError]);

  const meta = isLoading
    ? 'loading…'
    : `${counts.all} caps · ${filteredRows.length} match${filteredRows.length === 1 ? '' : 'es'} · click "Wear cap" to put on a skill`;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Caps</h1>
          <span className={styles.meta}>{meta}</span>
        </div>
        <div className={styles.search}>
          <span className={styles.searchIcon}>
            <SearchIcon />
          </span>
          <input
            type="text"
            value={(table.getColumn('name')?.getFilterValue() as string) ?? ''}
            onChange={(e) =>
              table.getColumn('name')?.setFilterValue(e.target.value)
            }
            placeholder="Search caps…"
            aria-label="Search caps"
          />
        </div>
      </header>

      <nav className={styles.filters} aria-label="Source filter">
        {SOURCES_FOR_FILTER.map((src) => (
          <button
            key={src.id}
            type="button"
            className={`${styles.filter}${activeFilter === src.id ? ` ${styles.filterActive}` : ''}`}
            onClick={() => setActiveFilter(src.id)}
          >
            {src.label}
            <span className={styles.filterCount}>{counts[src.id]}</span>
          </button>
        ))}
      </nav>

      {activationError && (
        <div role="alert" className={styles.banner}>
          {activationError}
        </div>
      )}
      {wearStatus && (
        <div
          role="status"
          style={{
            padding: '8px 12px',
            background: 'var(--accent-soft, rgba(79,70,229,0.1))',
            color: 'var(--accent, #4f46e5)',
            borderBottom: '1px solid var(--surface-border, rgba(0,0,0,0.08))',
            fontSize: 13,
          }}
        >
          {wearStatus}
        </div>
      )}

      <div className={styles.body}>
        {filteredRows.length === 0 ? (
          <div className={styles.empty}>
            {isLoading ? (
              'Loading caps…'
            ) : counts.all === 0 ? (
              <>
                No caps installed yet.
                <div className={styles.emptyHint}>
                  Install a SKILL.md under <code>~/.claude/skills/</code> or
                  add a Claude Code plugin — the cap shows up here on the
                  next refresh.
                </div>
              </>
            ) : (
              <>
                No matches.
                <div className={styles.emptyHint}>
                  Try a different source filter or clear the search.
                </div>
              </>
            )}
          </div>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
            }}
          >
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr
                  key={hg.id}
                  style={{
                    borderBottom: '1px solid var(--surface-border, rgba(0,0,0,0.08))',
                  }}
                >
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      style={{
                        textAlign: 'left',
                        padding: '8px 12px',
                        color: 'var(--text-muted, #6b7280)',
                        fontWeight: 600,
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        cursor: header.column.getCanSort() ? 'pointer' : 'default',
                        userSelect: 'none',
                        width: header.column.columnDef.size,
                      }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted() as string] ?? ''}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  style={{
                    borderBottom: '1px solid var(--surface-border, rgba(0,0,0,0.06))',
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{
                        padding: '10px 12px',
                        verticalAlign: 'middle',
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
