// /pool — KeycapPool route: time strip + 8-col keycap grid (responsive).
//
// Replaces W3 win/CTRL/Pages/KeycapPoolPage.xaml. Same 8-col grid contract
// (sub-PR e migrates Win users to PWA, this route becomes the canonical UI).

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClockStrip } from '@/components/ClockStrip';
import { KeycapCard } from '@/components/KeycapCard';
import { listKeycaps, openWorkspace } from '@/lib/kernel';
import styles from './pool.module.css';

const ACTIVATION_ERROR_TTL_MS = 4000;

const formatActivationError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
};

interface PoolRouteProps {
  /**
   * Override the default keycap activation behavior. When omitted the route
   * calls `openWorkspace(id)` to drive the dedicated workspace window
   * (per bao 2026-05-14). The dual-panel home view (decision_pc_mirrors_mobile_layout)
   * passes its own handler so the right-hand iPhone panel reflects the
   * activation immediately without spawning a second Tauri window.
   */
  onActivate?: (id: string) => void;
}

export const PoolRoute = ({ onActivate }: PoolRouteProps = {}): React.ReactElement => {
  const { data: keycaps = [], isLoading } = useQuery({
    queryKey: ['keycaps'],
    queryFn: listKeycaps,
  });
  const [activationError, setActivationError] = useState<string | null>(null);

  useEffect(() => {
    if (!activationError) return;
    const timer = window.setTimeout(() => setActivationError(null), ACTIVATION_ERROR_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [activationError]);

  const handleActivate = (id: string): void => {
    if (onActivate) {
      onActivate(id);
      return;
    }
    // Open the dedicated workspace WINDOW (not a tab in this window)
    // per bao 2026-05-14: 工作区不应该在主窗口, 应该是独立窗口.
    void openWorkspace(id).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[ctrl/web] openWorkspace failed', err);
      setActivationError(formatActivationError(err));
    });
  };

  return (
    <div className={styles.layout}>
      <ClockStrip />
      {activationError && (
        <div role="alert" className={styles.banner}>
          {activationError}
        </div>
      )}
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
