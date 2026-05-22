// /home — dual iPhone panel layout (PC mirrors mobile).
//
// Per `decision_pc_mirrors_mobile_layout.md` (bao 2026-05-18): the PWA
// renders the keyboard (keycap pool) and workspace as two iPhone Pro Max
// shaped panels. Same React tree as standalone /pool and /workspace —
// only the framing chrome differs. This file is the seam.
//
// Single-source-of-truth principle: we do NOT re-implement Pool or Workspace
// here. We compose them inside <IPhoneFrame>. When the kernel adds a new
// keycap source, only Pool changes; this view inherits the fix.

import { lazy, Suspense, useEffect, useState } from 'react';
import { IPhoneFrame } from '@/components/IPhoneFrame';
import { PoolRoute } from './pool';
import styles from './home.module.css';

// Lazy-load Workspace so it shares the dynamic chunk with app.tsx's lazy
// import. A static import here would defeat that split and pull xterm /
// cbor-x into the critical path.
const WorkspaceRoute = lazy(() =>
  import('./workspace').then((m) => ({ default: m.WorkspaceRoute })),
);

const WorkspaceFallback = (): React.ReactElement => (
  <div
    style={{
      padding: 'var(--space-6)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      color: 'var(--color-text-muted)',
    }}
  >
    Loading…
  </div>
);

/** Wide breakpoint at which we have room for two iPhone frames side by side. */
const DUAL_PANEL_MIN_WIDTH = 880;

const readViewportWidth = (): number => {
  if (typeof window === 'undefined') return DUAL_PANEL_MIN_WIDTH;
  return window.innerWidth;
};

export const HomeRoute = (): React.ReactElement => {
  const [viewportWidth, setViewportWidth] = useState<number>(() => readViewportWidth());
  const [activeKeycapId, setActiveKeycapId] = useState<string | null>(null);

  useEffect(() => {
    const onResize = (): void => setViewportWidth(readViewportWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isCompact = viewportWidth < DUAL_PANEL_MIN_WIDTH;

  const handleActivate = (id: string): void => {
    setActiveKeycapId(id);
  };

  // On true mobile (compact viewport) we collapse to a single bare panel —
  // the real device IS the frame, no fake bezel. Above the breakpoint we
  // show two framed iPhones side by side. The same components render either way.
  if (isCompact) {
    return (
      <div className={styles.compact}>
        <IPhoneFrame
          bare
          title={activeKeycapId ? 'Workspace' : 'Keyboard'}
        >
          {activeKeycapId ? (
            <Suspense fallback={<WorkspaceFallback />}>
              <WorkspaceRoute keycapId={activeKeycapId} />
            </Suspense>
          ) : (
            <PoolRoute onActivate={handleActivate} />
          )}
        </IPhoneFrame>
        {activeKeycapId && (
          <button
            type="button"
            className={styles.compactBack}
            onClick={() => setActiveKeycapId(null)}
            aria-label="Back to keyboard"
          >
            ‹ Keyboard
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.stage} aria-label="CTRL dual-panel home">
      <IPhoneFrame title="Keyboard" subtitle="keycap pool">
        <PoolRoute onActivate={handleActivate} />
      </IPhoneFrame>
      <IPhoneFrame
        title="Workspace"
        subtitle={activeKeycapId ?? 'pick a keycap'}
      >
        <Suspense fallback={<WorkspaceFallback />}>
          <WorkspaceRoute keycapId={activeKeycapId} />
        </Suspense>
      </IPhoneFrame>
    </div>
  );
};
