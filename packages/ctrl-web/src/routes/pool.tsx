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
import { useRail } from '@/components/RightRail';
import styles from './pool.module.css';

type SourceId = 'all' | 'builtin' | 'mcp' | 'oauth' | 'local' | 'stss';

type TargetId = 'mcp-tool' | 'hermes-skill' | 'brain';
type AdjustmentId = 'config' | 'patch' | 'fork';

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

// ─── MOCK derivations (pre-D1 scaffolding) ─────────────────────────
// `list_keycaps` will ship `target / adjustment / upstream` per the
// 2026-05-25 architecture review (zeus blocker D1). Until then these
// derived helpers stand in so the new Pool badges + upgrade dot can be
// designed against real card layouts. ALL callers route through these;
// when zeus lands the real envelope, replace each helper with `k.<field>`
// in one place — no Pool component code changes.
const MOCK_TARGET_BY_SOURCE: Record<SourceId, TargetId> = {
  all: 'mcp-tool',
  builtin: 'mcp-tool',
  mcp: 'mcp-tool',
  oauth: 'mcp-tool',
  local: 'hermes-skill',
  stss: 'mcp-tool',
};
const inferTarget = (k: KeycapSummary): TargetId => {
  if (k.id === 'pi' || k.id === 'hermes') return 'brain';
  return MOCK_TARGET_BY_SOURCE[inferSource(k)];
};
const inferAdjustment = (k: KeycapSummary): AdjustmentId => {
  // Hash the id for a stable but distributed mock — every keycap
  // shows the same adjustment across reloads.
  let h = 0;
  for (const c of k.id) h = (h * 31 + c.charCodeAt(0)) | 0;
  const mod = Math.abs(h) % 10;
  if (mod < 7) return 'config'; // 70% config-tier per spec
  if (mod < 9) return 'patch'; // 20% patch
  return 'fork'; //               10% fork
};
const inferUpgradeAvailable = (k: KeycapSummary): boolean => {
  // Mock: ~1 in 5 has an upgrade.
  let h = 0;
  for (const c of k.id) h = (h * 17 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 5 === 0;
};

const SOURCE_TONE: Record<SourceId, LedTone> = {
  all: 'unknown',
  builtin: 'info',
  mcp: 'nominal',
  oauth: 'caution',
  local: 'warning',
  stss: 'info',
};

const TARGET_LABEL: Record<TargetId, string> = {
  'mcp-tool': 'MCP',
  'hermes-skill': 'SKILL',
  brain: 'BRAIN',
};

const ADJUSTMENT_LABEL: Record<AdjustmentId, string> = {
  config: 'Config',
  patch: 'Patch',
  fork: 'Fork',
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
  // Per memory `feedback_right_rail_is_fixed` (bao 2026-05-26): routes
  // do NOT push items into the right rail. Source filter chips live
  // inside the Pool page (below).
  const { setIrisyState } = useRail();
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
            {filtered.map((k) => {
              const source = inferSource(k);
              const target = inferTarget(k);
              const adjustment = inferAdjustment(k);
              const upgradeAvailable = inferUpgradeAvailable(k);
              return (
                <button
                  key={k.id}
                  type="button"
                  className={styles.card}
                  onClick={() => handleActivate(k.id)}
                  title={k.id}
                >
                  {upgradeAvailable && (
                    <span
                      className={styles.upgradeDot}
                      aria-label="Update available"
                      role="status"
                    />
                  )}
                  <span className={styles.cardGlyph}>{fallbackGlyph(k.name)}</span>
                  <span className={styles.cardName}>{k.name}</span>
                  <div className={styles.cardMeta}>
                    <StatusPill tone={SOURCE_TONE[source]}>
                      {SOURCES.find((s) => s.id === source)?.label ?? '—'}
                    </StatusPill>
                    <span
                      className={styles.targetBadge}
                      data-target={target}
                      title={`Target: ${target}`}
                    >
                      {TARGET_LABEL[target]}
                    </span>
                    <span
                      className={styles.adjustmentBadge}
                      data-tier={adjustment}
                      title={`Adjustment tier: ${adjustment}`}
                    >
                      {ADJUSTMENT_LABEL[adjustment]}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

