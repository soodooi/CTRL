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
import { FeaturePackScene, RuntimeGuidanceCard } from '@/components/featurepack/FeaturePackScene';
import { PackEvals } from '@/components/ambient/PackEvals';
import {
  DEMO_CF_WORKERS,
  DEMO_GHOSTFOLIO,
  demoGhostfolioRecords,
  runPackAction,
} from '@/lib/feature-pack-demo';

export function PackLabRoute(): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '70vh' }}>
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
      {/* No-docker guided install card (§7.2 v52/v53) — the state a Docker-less
          user hits on Set up: platform guidance + the one-click auto-run button. */}
      <div style={{ maxWidth: 560, padding: 24, borderTop: '1px solid var(--border)' }}>
        <RuntimeGuidanceCard
          guidance={{
            platform: 'macos',
            headline:
              'This pack runs a self-hosted service, which needs a container runtime (Docker or Podman). None was found on this machine.',
            steps: [
              "Install Homebrew if you don't have it (https://brew.sh).",
              'Install a container runtime + the compose CLI.',
              'Start the runtime — it stays up in the background.',
              'Come back and press Set up again.',
            ],
            commands: ['brew install colima docker docker-compose', 'colima start'],
            docs_url: 'https://github.com/abiosoft/colima#installation',
            auto_installable: true,
          }}
          onDismiss={() => {}}
          onInstalled={() => {}}
        />
      </div>

      {/* Pack-authoring evals (mcp_pack_validate) — the three report states. */}
      <div style={{ display: 'flex', gap: 24, padding: 24, borderTop: '1px solid var(--border)' }}>
        <PackEvals report={{ ok: true, issues: [], record_source_fields: 6 }} />
        <PackEvals
          report={{
            ok: false,
            issues: [
              { field: 'id', severity: 'error', message: 'manifest has no id', fix: 'add a lowercase id' },
              {
                field: 'record_source.query.endpoint',
                severity: 'error',
                message: 'endpoint is empty — nothing to fetch',
                fix: 'set the read endpoint',
              },
            ],
          }}
        />
        <PackEvals
          report={{
            ok: true,
            issues: [
              {
                field: 'auth',
                severity: 'warn',
                message: 'record_source has no auth — a self-hosted connector usually needs one',
                fix: 'add auth.token_exchange',
              },
            ],
            record_source_fields: 3,
          }}
        />
      </div>
    </div>
  );
}
