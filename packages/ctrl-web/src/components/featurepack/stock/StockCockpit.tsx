// Today cockpit — the stock pack's first-screen glanceable panel (ADR-003
// frontend § morphing home + "push always-true state, don't make the user ask").
// Composes the same verdict-first cards A produces (mood / ladder / leaders) so
// opening the pack shows today's snapshot instead of a doc or an empty chat.
//
// Data-source is INJECTED (`load`) exactly like FeaturePackScene's loadRecords,
// so this renders + visually verifies with mock data; the real loader wires the
// stock tools through the :17873 gate (desktop-only — the standing honest gap).
import { useEffect, useState, type ReactElement } from 'react';
import { renderStockCardData, type StockResult } from './StockCard';
import styles from './StockCockpit.module.css';

export interface CockpitData {
  mood?: StockResult;
  ladder?: StockResult;
  leaders?: StockResult;
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; data: CockpitData }
  | { status: 'error'; message: string };

export function StockCockpit({ load }: { load: () => Promise<CockpitData> }): ReactElement {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    void load()
      .then((data) => {
        if (alive) setState({ status: 'ready', data });
      })
      .catch((e: unknown) => {
        if (alive) setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      alive = false;
    };
  }, [load]);

  if (state.status === 'loading') {
    return (
      <div className={styles.cockpit}>
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
      </div>
    );
  }
  if (state.status === 'error') {
    return <div className={styles.err}>Couldn&apos;t load today&apos;s snapshot — {state.message}</div>;
  }

  const { mood, ladder, leaders } = state.data;
  const cards: Array<[string, StockResult | undefined]> = [
    ['market_mood', mood],
    ['leaders', leaders],
    ['limit_ladder', ladder],
  ];
  const rendered = cards
    .map(([variant, data], i) => {
      if (!data) return null;
      const el = renderStockCardData(variant, data);
      return el ? <div key={i}>{el}</div> : null;
    })
    .filter(Boolean);

  if (rendered.length === 0) {
    return <div className={styles.err}>No snapshot yet — the market data sources returned nothing.</div>;
  }
  return <div className={styles.cockpit}>{rendered}</div>;
}
