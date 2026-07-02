// /pack-lab — DEV-ONLY demo of the feature-pack "using" scene
// (FeaturePackScene) rendered in isolation, both faces:
//  • a §14 record_source pack (Ghostfolio) leading with its product-grade
//    records table (ADR-002 §14.12), and
//  • an action-bar pack (CF Workers).
// The same scene also renders Irisy-alongside via AmbientHome (the real entry);
// this route keeps a standalone view for quick UX iteration.
//
// NOT a production entry (bao 2026-06-12: see the scene UX before wiring).

import { type ReactElement } from 'react';
import { FeaturePackScene } from '@/components/featurepack/FeaturePackScene';
import {
  DEMO_CF_WORKERS,
  DEMO_GHOSTFOLIO,
  demoGhostfolioRecords,
  runPackAction,
} from '@/lib/feature-pack-demo';

export function PackLabRoute(): ReactElement {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100vh' }}>
      <div style={{ borderRight: '1px solid var(--border)', minWidth: 0 }}>
        <FeaturePackScene
          pack={DEMO_GHOSTFOLIO}
          onRunAction={(id) => runPackAction(DEMO_GHOSTFOLIO.id, id)}
          loadRecords={demoGhostfolioRecords}
        />
      </div>
      <div style={{ minWidth: 0 }}>
        <FeaturePackScene
          pack={DEMO_CF_WORKERS}
          onRunAction={(id) => runPackAction(DEMO_CF_WORKERS.id, id)}
        />
      </div>
    </div>
  );
}
