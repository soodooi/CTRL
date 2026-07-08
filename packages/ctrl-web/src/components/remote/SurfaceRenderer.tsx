// SurfaceRenderer — the generic, domain-agnostic renderer for a feature pack's
// mobile surface (ADR-005 §2, describe-driven SDUI). A pack `describe`s its
// surface as a flat list of typed PARTS; this renders any of them with ZERO
// per-pack code. No 'stock' kind — only reusable primitives (gauge / metrics /
// barlist / tiers / table / record / list / markdown), plus a json fallback so
// an unknown kind degrades instead of crashing. Stock is just one composition
// of these primitives; so is CRM, notes, tasks, ghostfolio, anything.
//
// bao 2026-07-08: no pack, and no part kind, is special — the platform is not
// "the stock app". The whole point is that any pack renders through one registry.
import type { ReactElement, ReactNode } from 'react';
import styles from './SurfaceRenderer.module.css';

export type Tone = 'up' | 'down' | 'warn' | 'neutral';

export interface Action {
  id: string;
  label: string;
  verb: 'query' | 'produce';
  source?: string;
  op?: string;
  args?: Record<string, unknown>;
}

export interface Part {
  kind: string;
  id?: string;
  title?: string;
  data?: unknown;
  actions?: Action[];
}

export interface Surface {
  v: number;
  pack: string;
  title?: string;
  parts: Part[];
}

export function SurfaceView({
  surface,
  onAction,
}: {
  surface: Surface;
  onAction?: (a: Action) => void;
}): ReactElement {
  return (
    <div className={styles.surface}>
      {surface.parts.map((p, i) => (
        <PartCard key={p.id ?? i} part={p} onAction={onAction} />
      ))}
    </div>
  );
}

function PartCard({ part, onAction }: { part: Part; onAction?: (a: Action) => void }): ReactElement {
  return (
    <div className={styles.card}>
      {part.title != null && <div className={styles.cardTitle}>{part.title}</div>}
      {renderKind(part)}
      {part.actions != null && part.actions.length > 0 && (
        <div className={styles.actions}>
          {part.actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className={a.verb === 'produce' ? styles.actProduce : styles.actQuery}
              onClick={() => onAction?.(a)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The registry: kind -> renderer. Add a primitive here once; every pack gets it.
function renderKind(part: Part): ReactNode {
  const d = part.data as Record<string, unknown> | undefined;
  switch (part.kind) {
    case 'gauge':
      return <Gauge data={d} />;
    case 'metrics':
      return <Metrics data={d} />;
    case 'barlist':
      return <BarList data={d} />;
    case 'tiers':
      return <Tiers data={d} />;
    case 'table':
      return <TableView data={d} />;
    case 'record':
      return <RecordView data={d} />;
    case 'list':
      return <ListView data={d} />;
    case 'markdown':
    case 'text':
      return <div className={styles.text}>{String((d?.text as string) ?? '')}</div>;
    default:
      // Unknown kind -> degrade to JSON, never crash (SDUI fallback rule).
      return <pre className={styles.json}>{safePretty(part.data)}</pre>;
  }
}

// ── primitives ────────────────────────────────────────────────────────
function toneClass(t?: string): string {
  const cls =
    t === 'up' ? styles.up : t === 'down' ? styles.down : t === 'warn' ? styles.warn : styles.neutral;
  return cls ?? '';
}

/** gauge: a 0-100 reading + verdict + optional read. Sentiment, health, risk. */
function Gauge({ data }: { data?: Record<string, unknown> }): ReactElement {
  const value = clamp(Number(data?.value ?? 50), 0, 100);
  const verdict = data?.verdict as string | undefined;
  const read = data?.read as string | undefined;
  const unit = (data?.unit as string) ?? '';
  return (
    <div className={styles.gauge}>
      <div className={styles.track}>
        <div className={styles.mark} style={{ bottom: `${value}%` }} />
      </div>
      <div>
        <div className={styles.gaugeVal}>
          <span className={styles.gaugeNum}>{Math.round(value)}</span>
          <span className={styles.gaugeUnit}>{unit || '°'}</span>
        </div>
        {verdict != null && (
          <div className={`${styles.verdict} ${toneClass(data?.tone as string)}`}>{verdict}</div>
        )}
        {read != null && <div className={styles.read}>{read}</div>}
      </div>
    </div>
  );
}

/** metrics: a row of labelled stat blocks. KPIs, overview numbers. */
function Metrics({ data }: { data?: Record<string, unknown> }): ReactElement {
  const items = (data?.items as Array<Record<string, unknown>>) ?? [];
  return (
    <div className={styles.metrics}>
      {items.map((m, i) => (
        <div key={i} className={styles.metric}>
          <div className={`${styles.metricVal} ${toneClass(m.tone as string)}`}>
            {String(m.value ?? '-')}
          </div>
          <div className={styles.metricKey}>{String(m.label ?? '')}</div>
        </div>
      ))}
    </div>
  );
}

/** barlist: ranked rows with an in-cell bar + optional tag. Any ranking. */
function BarList({ data }: { data?: Record<string, unknown> }): ReactElement {
  const rows = (data?.rows as Array<Record<string, unknown>>) ?? [];
  return (
    <div className={styles.rows}>
      {rows.map((r, i) => (
        <div key={i} className={styles.barRow}>
          <div className={styles.barName}>
            {String(r.name ?? '')}
            {r.sub != null && <span className={styles.barSub}>{String(r.sub)}</span>}
          </div>
          <div className={styles.cell}>
            <div
              className={`${styles.fill} ${toneClass(r.tone as string)}`}
              style={{ width: `${clamp(Number(r.ratio ?? 0) * 100, 4, 100)}%` }}
            />
            <span className={`${styles.cval} ${toneClass(r.tone as string)}`}>
              {String(r.value ?? '')}
            </span>
          </div>
          {r.tag != null ? <span className={styles.tag}>{String(r.tag)}</span> : <span />}
        </div>
      ))}
    </div>
  );
}

/** tiers: grouped rows by a leading badge. Streaks, kanban columns, priority. */
function Tiers({ data }: { data?: Record<string, unknown> }): ReactElement {
  const tiers = (data?.tiers as Array<Record<string, unknown>>) ?? [];
  return (
    <div className={styles.tiers}>
      {tiers.map((t, i) => (
        <div key={i} className={styles.tier}>
          <div className={styles.tierBadge}>{String(t.label ?? '')}</div>
          <div className={styles.tierItems}>
            {((t.items as Array<Record<string, unknown>>) ?? []).map((it, j) => (
              <span key={j} className={styles.tierItem}>
                {String(it.name ?? it)}
              </span>
            ))}
            {t.tag != null && <span className={styles.tag}>{String(t.tag)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function TableView({ data }: { data?: Record<string, unknown> }): ReactElement {
  const cols = (data?.columns as string[]) ?? [];
  const rows = (data?.rows as Array<Array<unknown>>) ?? [];
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j}>{String(cell ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordView({ data }: { data?: Record<string, unknown> }): ReactElement {
  const fields = (data?.fields as Array<Record<string, unknown>>) ?? [];
  return (
    <dl className={styles.record}>
      {fields.map((f, i) => (
        <div key={i} className={styles.recRow}>
          <dt>{String(f.label ?? '')}</dt>
          <dd className={toneClass(f.tone as string)}>{String(f.value ?? '')}</dd>
        </div>
      ))}
    </dl>
  );
}

function ListView({ data }: { data?: Record<string, unknown> }): ReactElement {
  const items = (data?.items as Array<Record<string, unknown>>) ?? [];
  return (
    <div className={styles.list}>
      {items.map((it, i) => (
        <div key={i} className={styles.listRow}>
          <span>{String(it.text ?? it)}</span>
          {it.meta != null && <span className={styles.listMeta}>{String(it.meta)}</span>}
        </div>
      ))}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}
function safePretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
