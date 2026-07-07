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

interface CardBlock {
  kind?: string;
  verdict?: string;
  tone?: Tone;
  read?: string;
  temp?: number;
  metrics?: Metric[];
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

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
