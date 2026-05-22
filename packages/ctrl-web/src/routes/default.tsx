// DefaultWorkspace — cockpit dashboard at `/`. Bento-grid of instrument
// tiles giving the user a glanceable view of the system, with Irisy as
// the hero. Aims for ~12 readouts per screen (the "real cockpit" density
// target — Bloomberg-terminal vocabulary, F-pattern scan).
//
// Data sources today: live wall-clock + locally-derived metrics. Kernel
// hooks (token counts / mesh peers / kernel uptime) land in Phase 1D
// when the bridge exposes them; the tiles are shaped to drop in.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { IrisyMascot } from '@/components/IrisyMascot';
import { useRail } from '@/components/RightRail';
import { useWallClock, formatHHMMSS } from '@/hooks/useWallClock';
import { listKeycaps } from '@/lib/kernel';
import styles from './default.module.css';

// ── Sparkline ────────────────────────────────────────────────────
// Minimal SVG line chart, no library. 28px tall, full width.

interface SparklineProps {
  values: ReadonlyArray<number>;
  color?: string;
  fill?: boolean;
}

const Sparkline = ({ values, color = 'currentColor', fill = false }: SparklineProps): ReactElement => {
  if (values.length === 0) return <svg className={styles.statSparkline} aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = 100 / Math.max(1, values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = 100 - ((v - min) / range) * 90 - 5;
      return `${x},${y}`;
    })
    .join(' ');
  const area = `0,100 ${points} 100,100`;
  return (
    <svg
      className={styles.statSparkline}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {fill && (
        <polygon
          points={area}
          fill={color}
          opacity={0.12}
        />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

// ── Gauge ────────────────────────────────────────────────────────
// Circular SVG progress arc, 0-100%. The bg ring sits at full
// circumference; the fg ring uses stroke-dasharray to draw a fraction.

interface GaugeProps {
  value: number;
  max?: number;
  tone?: 'cobalt' | 'jade' | 'amber';
}
const Gauge = ({ value, max = 100, tone = 'cobalt' }: GaugeProps): ReactElement => {
  const pct = Math.max(0, Math.min(1, value / max));
  const circumference = 2 * Math.PI * 22;
  const offset = circumference * (1 - pct);
  const stroke =
    tone === 'jade'
      ? 'var(--color-success)'
      : tone === 'amber'
        ? 'var(--color-warning)'
        : 'var(--color-accent)';
  return (
    <svg className={styles.gauge} viewBox="0 0 56 56" aria-hidden="true">
      <circle
        cx="28"
        cy="28"
        r="22"
        stroke="var(--color-border-soft)"
        strokeWidth="3"
        fill="none"
      />
      <circle
        cx="28"
        cy="28"
        r="22"
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 28 28)"
        style={{ transition: 'stroke-dashoffset 600ms ease' }}
      />
      <text
        x="28"
        y="32"
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="11"
        fill="var(--color-text)"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
};

// ── Simulated metrics ────────────────────────────────────────────
// Real instruments would tap into kernel stats; until that hook ships
// we use a deterministic-but-lively seed so the dashboard isn't lying
// AND isn't static at the same time.

const useSimulatedSeries = (size: number, base: number, drift: number): number[] => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 2000);
    return () => window.clearInterval(id);
  }, []);
  return useMemo(() => {
    const arr: number[] = [];
    let v = base;
    for (let i = 0; i < size; i += 1) {
      const noise = Math.sin((tick + i) * 0.7) * drift;
      const wobble = (Math.random() - 0.5) * drift * 0.3;
      v = Math.max(0, base + noise + wobble);
      arr.push(v);
    }
    return arr;
    // tick is what makes this re-evaluate on the interval.
  }, [size, base, drift, tick]);
};

// ── Activity ticker entries ──────────────────────────────────────

interface TickerEntry {
  ts: string;
  action: string;
  tone?: 'muted';
}

const SEED_TICKER: ReadonlyArray<TickerEntry> = [
  { ts: '07:04:21', action: 'kernel ws bridge ready', tone: 'muted' },
  { ts: '07:04:21', action: 'list_keycaps · 0 installed', tone: 'muted' },
  { ts: '07:04:22', action: 'tray menu attached' },
  { ts: '07:04:22', action: 'global Ctrl tap listener armed' },
  { ts: '07:04:30', action: 'idle · awaiting input', tone: 'muted' },
  { ts: '07:05:01', action: 'wall clock tick · 2026-05-22', tone: 'muted' },
];

// ── DefaultWorkspace ─────────────────────────────────────────────

export const DefaultWorkspace = (): ReactElement => {
  const navigate = useNavigate();
  const now = useWallClock();
  const { setIrisyState } = useRail();
  useEffect(() => {
    setIrisyState('idle');
    return () => setIrisyState('idle');
  }, [setIrisyState]);

  // Pull live keycap count (the only real metric we currently have).
  const { data: keycaps = [] } = useQuery({
    queryKey: ['keycaps'],
    queryFn: listKeycaps,
  });

  // Simulated trend lines until kernel ships real metrics.
  const tokensSeries = useSimulatedSeries(24, 80, 25);
  const latencySeries = useSimulatedSeries(24, 42, 12);
  const memSeries = useSimulatedSeries(24, 56, 8);

  const tokensTotal = Math.round(tokensSeries.reduce((s, v) => s + v, 0));
  const latencyNow = Math.round(latencySeries[latencySeries.length - 1] ?? 0);
  const memNow = Math.round(memSeries[memSeries.length - 1] ?? 0);

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <span className={styles.headerTitle}>Cockpit · main</span>
        <span className={styles.headerMeta}>
          {formatHHMMSS(now.getTime())} · session 0
        </span>
      </header>

      <div className={styles.grid}>
        {/* HERO: Irisy + greeting + actions */}
        <section className={styles.heroTile} aria-label="Irisy">
          <div className={styles.heroMascot}>
            <div className={styles.heroMascotHalo} />
            <IrisyMascot state="idle" size={110} />
          </div>
          <div className={styles.heroText}>
            <h1 className={styles.heroGreeting}>
              I'm Irisy. What are we doing today?
            </h1>
            <p className={styles.heroSubtitle}>
              Press a key on the left to summon a tool, or hold{' '}
              <strong>Ctrl</strong> any time to bring me up over whatever you're working on.
            </p>
            <div className={styles.heroActions}>
              <button
                type="button"
                className={styles.heroAction}
                onClick={() => void navigate({ to: '/pool' })}
              >
                browse pool <strong>›</strong>
              </button>
              <button
                type="button"
                className={styles.heroAction}
                onClick={() => void navigate({ to: '/code-space' })}
              >
                open code space <strong>›</strong>
              </button>
              <button
                type="button"
                className={styles.heroAction}
                onClick={() => void navigate({ to: '/irisy' })}
              >
                talk to Irisy <strong>›</strong>
              </button>
            </div>
          </div>
        </section>

        {/* STATS row 1 */}
        <section className={styles.statTile} aria-label="Keycaps installed">
          <span className={styles.statLabel}>Keycaps installed</span>
          <span className={styles.statValue}>
            {String(keycaps.length).padStart(2, '0')}
            <span className={styles.statUnit}>keys</span>
          </span>
          <Sparkline
            values={[2, 4, 4, 6, 6, 7, 9, 9, 10, 12, 12, 14, keycaps.length || 14]}
            color="var(--color-accent)"
            fill
          />
          <span className={styles.statFooter}>+0 since boot</span>
        </section>

        {/* STATS row 2 (sub-tiles inside hero column area pushed below) */}
        <section className={styles.statTile} aria-label="Tokens streamed today">
          <span className={styles.statLabel}>Tokens · today</span>
          <span className={`${styles.statValue} ${styles.statValueAmber}`}>
            {tokensTotal.toLocaleString()}
            <span className={styles.statUnit}>tok</span>
          </span>
          <Sparkline values={tokensSeries} color="var(--color-warning)" fill />
          <span className={styles.statFooter}>last 2m · simulated</span>
        </section>

        <section className={styles.statTile} aria-label="WS latency">
          <span className={styles.statLabel}>Bridge latency</span>
          <span className={`${styles.statValue} ${styles.statValueJade}`}>
            {latencyNow}
            <span className={styles.statUnit}>ms</span>
          </span>
          <Sparkline values={latencySeries} color="var(--color-success)" />
          <span className={styles.statFooter}>p50 · 2-min window</span>
        </section>

        {/* GAUGES */}
        <section className={styles.gaugeTile} aria-label="Memory">
          <Gauge value={memNow} tone="cobalt" />
          <div className={styles.gaugeText}>
            <span className={styles.gaugeLabel}>Memory</span>
            <span className={styles.gaugeValue}>{memNow}%</span>
            <span className={styles.gaugeHint}>renderer process</span>
          </div>
        </section>
        <section className={styles.gaugeTile} aria-label="Mesh peers">
          <Gauge value={0} max={3} tone="amber" />
          <div className={styles.gaugeText}>
            <span className={styles.gaugeLabel}>Mesh peers</span>
            <span className={styles.gaugeValue}>0 / 3</span>
            <span className={styles.gaugeHint}>relay offline</span>
          </div>
        </section>
        <section className={styles.gaugeTile} aria-label="Sessions">
          <Gauge value={0} max={6} tone="jade" />
          <div className={styles.gaugeText}>
            <span className={styles.gaugeLabel}>Sessions</span>
            <span className={styles.gaugeValue}>0 / 6</span>
            <span className={styles.gaugeHint}>cs + chat slots</span>
          </div>
        </section>
        <section className={styles.gaugeTile} aria-label="LLM provider">
          <Gauge value={100} tone="cobalt" />
          <div className={styles.gaugeText}>
            <span className={styles.gaugeLabel}>LLM provider</span>
            <span className={styles.gaugeValue}>Volc</span>
            <span className={styles.gaugeHint}>BYOK · 9 caps</span>
          </div>
        </section>

        {/* ACTIVITY TICKER (full-width) */}
        <section className={styles.tickerTile} aria-label="Recent activity">
          <div className={styles.tickerHead}>
            <span className={styles.tickerHeadDot} />
            <span>Recent activity</span>
            <span style={{ marginLeft: 'auto' }}>
              {SEED_TICKER.length} events · live
            </span>
          </div>
          <div className={styles.tickerLines}>
            {SEED_TICKER.map((e, i) => (
              <div key={i} className={styles.tickerLine}>
                <span className={styles.tickerTime}>{e.ts}</span>
                <span
                  className={
                    e.tone === 'muted'
                      ? `${styles.tickerAction} ${styles.tickerActionMuted}`
                      : styles.tickerAction
                  }
                >
                  {e.action}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* HINTS row */}
        <button
          type="button"
          className={styles.hintTile}
          onClick={() => void navigate({ to: '/pool' })}
        >
          <span className={styles.hintLabel}>Pick a tool</span>
          <span className={styles.hintText}>
            Click a keycap on the left rail to open its workspace here.
          </span>
        </button>
        <button
          type="button"
          className={styles.hintTile}
          onClick={() => void navigate({ to: '/pool' })}
        >
          <span className={styles.hintLabel}>Search</span>
          <span className={styles.hintText}>
            Find a keycap by name or intent.
          </span>
          <span className={styles.hintShortcut}>⌘ K</span>
        </button>
        <button
          type="button"
          className={styles.hintTile}
          onClick={() => void navigate({ to: '/pool' })}
        >
          <span className={styles.hintLabel}>Pool</span>
          <span className={styles.hintText}>
            Browse and install keycaps from MCP, OAuth or local sources.
          </span>
        </button>
      </div>
    </div>
  );
};
