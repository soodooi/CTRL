// /pool — keycap catalog ("back-office"). Per memory project_keyboard_vs_pool:
// the keyboard is the always-on rail of installed keys; the pool is the
// browse / install surface.
//
// Today the kernel only exposes installed keycaps via list_keycaps. The
// Marketplace fetch (10k+ MCP servers, OAuth platforms, etc.) ships as
// part of Phase 1F kernel wiring. Until then this route shows the
// installed set with a source filter so the contract is visible.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listKeycaps, openWorkspace, type KeycapSummary } from '@/lib/kernel';
import { StatusPill, type LedTone } from '@/components/primitives';
import { useRail, type RailItem } from '@/components/RightRail';
import styles from './pool.module.css';

type SourceId = 'all' | 'builtin' | 'mcp' | 'oauth' | 'local' | 'stss';

interface SourceDef {
  id: SourceId;
  label: string;
}

const SOURCES: ReadonlyArray<SourceDef> = [
  { id: 'all', label: 'All' },
  { id: 'builtin', label: 'Built-in' },
  { id: 'mcp', label: 'MCP' },
  { id: 'oauth', label: 'OAuth' },
  { id: 'local', label: 'Local' },
  { id: 'stss', label: 'ST-SS' },
];

// Until the kernel envelope ships source-of-truth, infer source from
// the keycap id prefix. Built-ins are namespaced `ctrl.builtin.*`;
// installed MCP-derived keycaps land under `mcp:*`; etc.
const inferSource = (k: KeycapSummary): SourceId => {
  if (k.id.startsWith('ctrl.builtin.')) return 'builtin';
  if (k.id.startsWith('mcp:')) return 'mcp';
  if (k.id.startsWith('oauth:')) return 'oauth';
  if (k.id.startsWith('local:')) return 'local';
  if (k.id.startsWith('stss:')) return 'stss';
  return 'builtin';
};

const SOURCE_TONE: Record<SourceId, LedTone> = {
  all: 'unknown',
  builtin: 'info',
  mcp: 'nominal',
  oauth: 'caution',
  local: 'warning',
  stss: 'info',
};

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

const fallbackGlyph = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const first = trimmed[0];
  if (first && /[一-鿿]/.test(first)) return first;
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
};

export const PoolRoute = (): ReactElement => {
  const { setItems: setRailItems, setIrisyState } = useRail();
  const [active, setActive] = useState<SourceId>('all');
  const [query, setQuery] = useState('');
  const [activationError, setActivationError] = useState<string | null>(null);

  const { data: keycaps = [], isLoading } = useQuery({
    queryKey: ['keycaps'],
    queryFn: listKeycaps,
  });

  // Tally sources for filter-chip counts. Recompute only when keycaps
  // change so the filter row doesn't churn on every keystroke.
  const counts = useMemo(() => {
    const tally: Record<SourceId, number> = {
      all: keycaps.length,
      builtin: 0,
      mcp: 0,
      oauth: 0,
      local: 0,
      stss: 0,
    };
    for (const k of keycaps) tally[inferSource(k)] += 1;
    return tally;
  }, [keycaps]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return keycaps.filter((k) => {
      if (active !== 'all' && inferSource(k) !== active) return false;
      if (!q) return true;
      return k.name.toLowerCase().includes(q) || k.id.toLowerCase().includes(q);
    });
  }, [keycaps, active, query]);

  // Right rail: jump-to-source items + future "recently installed".
  useEffect(() => {
    const items: RailItem[] = SOURCES.filter((s) => s.id !== 'all').map((s) => ({
      id: s.id,
      label: s.label,
      glyph: s.label.slice(0, 2).toUpperCase(),
      tone: SOURCE_TONE[s.id],
      active: active === s.id,
      onClick: () => setActive(s.id),
    }));
    setRailItems(items);
    return () => setRailItems([]);
  }, [active, setRailItems]);

  useEffect(() => {
    setIrisyState('idle');
    return () => setIrisyState('idle');
  }, [setIrisyState]);

  const handleActivate = (id: string): void => {
    void openWorkspace(id).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Unexpected error';
      setActivationError(msg);
    });
  };

  // Auto-dismiss banner.
  useEffect(() => {
    if (!activationError) return;
    const t = window.setTimeout(() => setActivationError(null), 4000);
    return () => window.clearTimeout(t);
  }, [activationError]);

  const meta = isLoading
    ? 'loading…'
    : `${counts.all} installed · ${filtered.length} match${filtered.length === 1 ? '' : 'es'}`;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Pool</h1>
          <span className={styles.meta}>{meta}</span>
        </div>
        <div className={styles.search}>
          <span className={styles.searchIcon}>
            <SearchIcon />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search keycaps…"
            aria-label="Search keycaps"
          />
        </div>
      </header>

      <nav className={styles.filters} aria-label="Source filter">
        {SOURCES.map((src) => (
          <button
            key={src.id}
            type="button"
            className={`${styles.filter}${active === src.id ? ` ${styles.filterActive}` : ''}`}
            onClick={() => setActive(src.id)}
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

      <div className={styles.body}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>
            {isLoading ? (
              'Loading keycaps…'
            ) : counts.all === 0 ? (
              <>
                No keycaps installed yet.
                <div className={styles.emptyHint}>
                  Run <code>npm install -g @anthropic-ai/claude-code</code> or pick
                  one from the marketplace once Phase 1F lands the catalog.
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
          <div className={styles.grid}>
            {filtered.map((k) => (
              <button
                key={k.id}
                type="button"
                className={styles.card}
                onClick={() => handleActivate(k.id)}
                title={k.id}
              >
                <span className={styles.cardGlyph}>{fallbackGlyph(k.name)}</span>
                <span className={styles.cardName}>{k.name}</span>
                <div className={styles.cardMeta}>
                  <StatusPill tone={SOURCE_TONE[inferSource(k)]}>
                    {SOURCES.find((s) => s.id === inferSource(k))?.label ?? '—'}
                  </StatusPill>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

