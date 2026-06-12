// /pack-lab — DEV-ONLY demo of the feature-pack "using" scene
// (FeaturePackScene + ActionBar) rendered in isolation. The same scene also
// renders Irisy-alongside via AmbientHome (the real entry); this route keeps
// a standalone view for quick UX iteration.
//
// NOT a production entry (bao 2026-06-12: see the scene UX before wiring).

import { type ReactElement } from 'react';
import { FeaturePackScene } from '@/components/featurepack/FeaturePackScene';
import { DEMO_CF_WORKERS, runPackAction } from '@/lib/feature-pack-demo';

export function PackLabRoute(): ReactElement {
  return (
    <div style={{ height: '100vh' }}>
      <FeaturePackScene
        pack={DEMO_CF_WORKERS}
        onRunAction={(id) => runPackAction(DEMO_CF_WORKERS.id, id)}
      />
    </div>
  );
}
