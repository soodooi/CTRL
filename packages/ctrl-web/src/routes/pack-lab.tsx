// /pack-lab — DEV-ONLY demo of the feature-pack "using" scene
// (FeaturePackScene + ActionBar). Renders a stub CF Workers pack so the scene
// UX can be reviewed (Playwright) before the kernel run_action wiring lands.
//
// NOT a production entry — the real entry is an installed pack -> scene,
// landing next. This route just lets the scene render in isolation for UX
// iteration (bao 2026-06-12: 使用 UX is the priority, see it before wiring).

import { type ReactElement } from 'react';
import {
  FeaturePackScene,
  type FeaturePack,
} from '@/components/featurepack/FeaturePackScene';

const DEMO_PACK: FeaturePack = {
  id: 'pack.cf-workers',
  name: 'CF Workers Dev',
  icon: '⚡',
  summary: 'Deploy Cloudflare Workers — local to the edge',
  actions: [
    { id: 'deploy', name: 'Deploy', description: 'wrangler deploy' },
    { id: 'logs', name: 'Logs', description: 'wrangler tail' },
    { id: 'preview', name: 'Local preview', description: 'wrangler dev' },
  ],
};

// Stub executor — stands in for the kernel run_action path so the scene
// renders end to end. Output mirrors what a real wrangler action returns.
const runDemo = async (actionId: string): Promise<string> => {
  await new Promise((resolve) => setTimeout(resolve, 600));
  switch (actionId) {
    case 'deploy':
      return [
        '$ wrangler deploy',
        '✓ Uploaded my-worker (1.21 sec)',
        '✓ Published my-worker (0.43 sec)',
        '  https://my-worker.example.workers.dev',
      ].join('\n');
    case 'logs':
      return [
        '$ wrangler tail',
        '[GET]  200 /            (12ms)',
        '[POST] 201 /api/items   (34ms)',
        '[GET]  200 /healthz     (3ms)',
      ].join('\n');
    case 'preview':
      return ['$ wrangler dev', '⎔ Listening on http://localhost:8787'].join('\n');
    default:
      return `(no demo output for ${actionId})`;
  }
};

export function PackLabRoute(): ReactElement {
  return (
    <div style={{ height: '100vh' }}>
      <FeaturePackScene pack={DEMO_PACK} onRunAction={runDemo} />
    </div>
  );
}
