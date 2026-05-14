// /pool — KeycapPool route: time strip + 8-col keycap grid (responsive).
//
// Replaces W3 win/CTRL/Pages/KeycapPoolPage.xaml. Same 8-col grid contract
// (sub-PR e migrates Win users to PWA, this route becomes the canonical UI).

import { useQuery } from '@tanstack/react-query';
import { ClockStrip } from '@/components/ClockStrip';
import { KeycapCard } from '@/components/KeycapCard';
import { listKeycaps } from '@/lib/kernel';
import styles from './pool.module.css';

export const PoolRoute = (): React.ReactElement => {
  const { data: keycaps = [], isLoading } = useQuery({
    queryKey: ['keycaps'],
    queryFn: listKeycaps,
  });

  const handleActivate = (_id: string): void => {
    // sub-PR f wires this to runKeycap(id) + navigates to /workspace with the
    // keycap_id query param. Intentionally silent for now (no console noise
    // in shipped builds — pre-merge review M3).
  };

  return (
    <div className={styles.layout}>
      <ClockStrip />
      <main className={styles.grid} role="main" aria-label="Keycap pool">
        {isLoading && <p className={styles.empty}>Loading…</p>}
        {!isLoading && keycaps.length === 0 && (
          <div className={styles.empty}>
            <p>No keycaps installed yet.</p>
            <p className={styles.emptyHint}>
              Open <strong>Settings → Marketplace</strong> to install one from
              the 10,000+ MCP servers available on day 1.
            </p>
          </div>
        )}
        {keycaps.map((k) => (
          <KeycapCard key={k.id} keycap={k} onActivate={handleActivate} />
        ))}
      </main>
    </div>
  );
};
