// Demo feature-pack data + a stub action executor. Shared by the dev-only
// /pack-lab route and the Irisy-alongside scene wiring while the kernel
// run_action path is still being built (bao 2026-06-12: complete dev of the
// "using" face, see Irisy-alongside first; real execution lands next).
//
// runPackAction is swapped for invoke('run_action', ...) once the kernel
// command lands — the call site (FeaturePackScene.onRunAction) stays the same.

import type { FeaturePack } from '@/components/featurepack/FeaturePackScene';

export const DEMO_CF_WORKERS: FeaturePack = {
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

/** Stub executor — stands in for the kernel run_action path so the scene
 *  renders end to end. Output mirrors what a real wrangler action returns. */
export async function runPackAction(_packId: string, actionId: string): Promise<string> {
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
}
