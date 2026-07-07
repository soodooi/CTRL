// Stock feature-pack card renderers (ADR-003 frontend § viewers + § morphing
// conversation). Verdict-first cards for ctrl-stock-cn tool results, so Irisy
// shows a glanceable card in the workspace pane instead of raw JSON in chat;
// the raw payload stays one drill-down away in the chat tool step.
//
// ZERO-CHINESE rule (bao): this file carries only English fallback chrome. All
// human-facing text (verdict / read / labels) is DATA — it arrives in the
// tool's `card` display block, which the pack (user vault, Chinese allowed)
// provides. Same data-driven pattern as SmartTableViewer rendering vault labels.
import type { ReactElement } from 'react';
import styles from './StockCard.module.css';

// Tool names whose results route to a card (AmbientHome checks this set).
export const STOCK_CARD_TOOLS = new Set([
  'market_mood',
  'leaders',
  'limit_ladder',
  'sector_strength',
  'screen_strong',
  'stock_technical',
  'dragon_tiger',
]);

type Tone = 'up' | 'down' | 'warn' | 'neutral';

interface Metric {
  label?: string;
  value?: string | number | null;
  tone?: Tone;
}

interface LeaderRow {
  name?: string;
  code?: string;
  value?: string | null;
  ratio?: number;
  tone?: Tone;
  tag?: string | null;
}

interface TierStock {
  name?: string;
  code?: string;
}

interface Tier {
  board?: number;
  label?: string;
  stocks?: TierStock[];
  more?: number;
  theme?: string | null;
}

interface Indicator {
  name?: string;
  value?: string;
  tone?: Tone;
  tag?: string;
}

interface CardBlock {
  kind?: string;
  verdict?: string;
  tone?: Tone;
  read?: string;
  temp?: number;
  metrics?: Metric[];
  // leaders / dragon_tiger
  unit?: string;
  rows?: LeaderRow[];
  drill?: string;
  // ladder
  tiers?: Tier[];
  summary?: string;
  // technical
  symbol?: string;
  votes?: { buy?: number; neutral?: number; sell?: number };
  indicators?: Indicator[];
  gauge?: number;
  support?: number | string | null;
  resist?: number | string | null;
}

interface StockResult {
  card?: CardBlock;
  error?: string;
  [k: string]: unknown;
}

/** Entry point: parse a stock tool's JSON output and render its card. Returns
 *  null when the payload has no card block (caller falls back to raw view). */
export function renderStockCard(variant: string, rawJson: string): ReactElement | null {
  let data: StockResult;
  try {
    data = JSON.parse(rawJson) as StockResult;
  } catch {
    return null;
  }
  if (data.error) return <ErrorCard message={String(data.error)} />;
  const card = data.card;
  if (!card || typeof card !== 'object') return null;
  const kind = card.kind ?? variant;
  switch (kind) {
    case 'mood':
      return <MoodCard card={card} />;
    case 'leaders':
    case 'dragon_tiger':
      return <LeadersCard card={card} />;
    case 'ladder':
      return <LadderCard card={card} />;
    case 'technical':
      return <TechnicalCard card={card} />;
    default:
      return <GenericCard card={card} />;
  }
}

function ErrorCard({ message }: { message: string }): ReactElement {
  return (
    <div className={styles.card}>
      <div className={styles.errRow}>
        <span className={styles.errTag}>No data</span>
        <span className={styles.errMsg}>{message}</span>
      </div>
    </div>
  );
}

// ── market_mood → sentiment thermometer ───────────────────────────────
function MoodCard({ card }: { card: CardBlock }): ReactElement {
  const temp = clamp(card.temp ?? 50, 0, 100);
  return (
    <div className={styles.card}>
      <div className={styles.thermo}>
        <div className={styles.track}>
          <div className={styles.mark} style={{ bottom: `${temp}%` }} />
        </div>
        <div className={styles.read}>
          <div className={styles.tempRow}>
            <span className={styles.tempNum}>{Math.round(temp)}</span>
            <span className={styles.tempUnit}>°</span>
          </div>
          {card.verdict ? (
            <div className={styles.verdict} data-tone={card.tone ?? 'neutral'}>
              {card.verdict}
            </div>
          ) : null}
          {card.read ? <div className={styles.readNote}>{card.read}</div> : null}
        </div>
      </div>
      <MetricRow metrics={card.metrics} />
    </div>
  );
}

// Fallback card for kinds not yet given a bespoke layout: verdict + metrics.
function GenericCard({ card }: { card: CardBlock }): ReactElement {
  return (
    <div className={styles.card}>
      {card.verdict ? (
        <div className={styles.verdict} data-tone={card.tone ?? 'neutral'}>
          {card.verdict}
        </div>
      ) : null}
      {card.read ? <div className={styles.readNote}>{card.read}</div> : null}
      <MetricRow metrics={card.metrics} />
    </div>
  );
}

function MetricRow({ metrics }: { metrics?: Metric[] }): ReactElement | null {
  if (!metrics || metrics.length === 0) return null;
  return (
    <div className={styles.stats}>
      {metrics.map((m, i) => (
        <div key={i} className={styles.stat}>
          <div className={styles.statVal} data-tone={m.tone ?? 'neutral'}>
            {m.value ?? '-'}
          </div>
          <div className={styles.statKey}>{m.label ?? ''}</div>
        </div>
      ))}
    </div>
  );
}

// ── leaders / dragon_tiger → bar-in-cell ranked rows ──────────────────
function LeadersCard({ card }: { card: CardBlock }): ReactElement {
  const rows = card.rows ?? [];
  const unit = card.unit ?? '';
  return (
    <div className={styles.card}>
      {card.verdict ? <div className={styles.cardTitle}>{card.verdict}</div> : null}
      <div className={styles.rows}>
        {rows.map((r, i) => (
          <div key={i} className={styles.leaderRow}>
            <div className={styles.leaderName}>
              {r.name}
              {r.code ? <span className={styles.leaderCode}>{r.code}</span> : null}
            </div>
            <div className={styles.cell}>
              <div
                className={styles.cellFill}
                data-tone={r.tone ?? 'up'}
                style={{ width: `${clamp((r.ratio ?? 0) * 100, 4, 100)}%` }}
              />
              <span className={styles.cellVal} data-tone={r.tone ?? 'up'}>
                {r.value ?? '-'}
                {r.value != null && unit ? unit : ''}
              </span>
            </div>
            {r.tag ? <span className={styles.tag}>{r.tag}</span> : <span className={styles.tagGap} />}
          </div>
        ))}
      </div>
      {card.drill ? <DrillNote text={card.drill} /> : null}
    </div>
  );
}

// ── limit_ladder → tiered vertical ladder (highest board pinned top) ───
function LadderCard({ card }: { card: CardBlock }): ReactElement {
  const tiers = card.tiers ?? [];
  return (
    <div className={styles.card}>
      {card.verdict ? <div className={styles.cardTitle}>{card.verdict}</div> : null}
      <div className={styles.ladder}>
        {tiers.map((t, i) => (
          <div key={i} className={styles.tier}>
            <div className={styles.tierBadge} style={{ background: tierColor(t.board ?? 1) }}>
              {t.label ?? `${t.board ?? ''}`}
            </div>
            <div className={styles.tierStocks}>
              {(t.stocks ?? []).map((s, j) => (
                <span key={j} className={styles.tierStock}>
                  {s.name}
                  {s.code ? <span className={styles.leaderCode}>{s.code}</span> : null}
                </span>
              ))}
              {t.more ? <span className={styles.tierMore}>+{t.more}</span> : null}
              {t.theme ? <span className={styles.tag}>{t.theme}</span> : null}
            </div>
          </div>
        ))}
      </div>
      {card.summary ? <DrillNote text={card.summary} /> : null}
    </div>
  );
}

// ── stock_technical → gauge + vote tally + indicator chips ─────────────
function TechnicalCard({ card }: { card: CardBlock }): ReactElement {
  const gauge = clamp(card.gauge ?? 50, 0, 100);
  const rad = (((gauge - 50) / 50) * 78 * Math.PI) / 180;
  const nx = 70 + 40 * Math.sin(rad);
  const ny = 78 - 40 * Math.cos(rad);
  const v = card.votes ?? {};
  return (
    <div className={styles.card}>
      {card.symbol ? <div className={styles.cardTitle}>{card.symbol}</div> : null}
      <div className={styles.gaugeWrap}>
        <svg width="140" height="82" viewBox="0 0 140 82" aria-hidden="true">
          <path d="M12 78 A58 58 0 0 1 26 37" fill="none" stroke="#2f7d57" strokeWidth="11" strokeLinecap="round" />
          <path d="M30 33 A58 58 0 0 1 55 15" fill="none" stroke="#9fbf9a" strokeWidth="11" />
          <path d="M60 13 A58 58 0 0 1 80 13" fill="none" stroke="#cfc7b2" strokeWidth="11" />
          <path d="M85 15 A58 58 0 0 1 110 33" fill="none" stroke="#dd9a8f" strokeWidth="11" />
          <path d="M114 37 A58 58 0 0 1 128 78" fill="none" stroke="#c0362c" strokeWidth="11" strokeLinecap="round" />
          <line x1="70" y1="78" x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke="#20221d" strokeWidth="3" strokeLinecap="round" />
          <circle cx="70" cy="78" r="5" fill="#20221d" />
        </svg>
        <div>
          {card.verdict ? (
            <div className={styles.verdict} data-tone={card.tone ?? 'neutral'}>
              {card.verdict}
            </div>
          ) : null}
          <div className={styles.votes}>
            <span className={styles.voteDot} data-tone="up" /> {v.buy ?? 0}
            <span className={styles.voteDot} data-tone="neutral" /> {v.neutral ?? 0}
            <span className={styles.voteDot} data-tone="down" /> {v.sell ?? 0}
          </div>
        </div>
      </div>
      <div className={styles.indGrid}>
        {(card.indicators ?? []).map((ind, i) => (
          <div key={i} className={styles.indRow}>
            <span className={styles.indName}>{ind.name}</span>
            <span className={styles.indVal}>{ind.value}</span>
            {ind.tag ? (
              <span className={styles.indChip} data-tone={ind.tone ?? 'neutral'}>
                {ind.tag}
              </span>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      {card.support != null || card.resist != null ? (
        <div className={styles.levels}>
          <span className={styles.levelDown}>{card.support ?? '-'}</span>
          <span className={styles.levelSep}>/</span>
          <span className={styles.levelUp}>{card.resist ?? '-'}</span>
        </div>
      ) : null}
    </div>
  );
}

function DrillNote({ text }: { text: string }): ReactElement {
  return (
    <div className={styles.drill}>
      <span className={styles.drillIcon}>⌵</span>
      {text}
    </div>
  );
}

// Deeper board = deeper red (strength = tier position; A-share red-up).
function tierColor(board: number): string {
  const shades = ['#d3897f', '#c65a4d', '#b8382c', '#9c2f22'];
  const idx = Math.max(0, Math.min(board - 2, shades.length - 1));
  return shades[idx] ?? '#c65a4d';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
