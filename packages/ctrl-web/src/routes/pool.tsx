// /pool — KeycapPool route: time strip + 8-col keycap grid (responsive).
//
// Replaces W3 win/CTRL/Pages/KeycapPoolPage.xaml. Same 8-col grid contract
// (sub-PR e migrates Win users to PWA, this route becomes the canonical UI).

import { useQuery } from '@tanstack/react-query';
import { ClockStrip } from '@/components/ClockStrip';
import { KeycapCard } from '@/components/KeycapCard';
import { listKeycaps, openWorkspace } from '@/lib/kernel';
import styles from './pool.module.css';

export const PoolRoute = (): React.ReactElement => {
  const { data: keycaps = [], isLoading } = useQuery({
    queryKey: ['keycaps'],
    queryFn: listKeycaps,
  });

  const handleActivate = (id: string): void => {
    // Open the dedicated workspace WINDOW (not a tab in this window)
    // per bao 2026-05-14: 工作区不应该在主窗口, 应该是独立窗口.
    void openWorkspace(id).catch((err) => {
      // Silent in shipped — surface via in-window toast in sub-PR f.
      // For now, swallow so a transient bridge failure doesn't crash the pool.
      void err;
    });
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
