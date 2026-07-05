// Demo feature-pack data + a stub action executor. Shared by the dev-only
// /pack-lab route and the Irisy-alongside scene wiring while the kernel
// run_action path is still being built (bao 2026-06-12: complete dev of the
// "using" face, see Irisy-alongside first; real execution lands next).
//
// runPackAction is swapped for invoke('run_action', ...) once the kernel
// command lands — the call site (FeaturePackScene.onRunAction) stays the same.

import type { FeaturePack } from '@/components/featurepack/FeaturePackScene';
import type { SourceData } from '@/components/featurepack/SourceDataView';

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

/** A §14 record_source pack (ADR-002 §14.12) — leads with its records (a
 *  product-grade data table) instead of an action bar. Ghostfolio holdings. */
export const DEMO_GHOSTFOLIO: FeaturePack = {
  id: 'ctrl-ghostfolio',
  name: 'Ghostfolio',
  icon: '📊',
  summary: 'Your self-hosted portfolio, made AI-native',
  hasRecords: true,
  // §7.5 v48: a dual-face pack — the connector's holdings (records) as the first
  // tab, plus the user's own vault tables under this prefix (watchlists etc.).
  workspace: { tablePrefix: 'tables/ctrl-ghostfolio-' },
  actions: [{ id: 'add', name: 'Record a trade', description: 'source_produce' }],
};

/** Stub records loader — stands in for describe+query through the gate (the live
 *  fetch needs the real kernel + a running Ghostfolio). Shape = what
 *  loadPackRecords returns, so /pack-lab shows the real product-grade table. */
export async function demoGhostfolioRecords(): Promise<SourceData> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return {
    matchCount: 4,
    fields: [
      { key: 'symbol', label: 'Symbol', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'value', label: 'Value', type: 'currency' },
      { key: 'allocation', label: 'Allocation %', type: 'percent' },
      { key: 'currency', label: 'Currency', type: 'text' },
    ],
    rows: [
      { symbol: 'AAPL', name: 'Apple Inc.', quantity: '40', value: '9021.6', allocation: '38.2', currency: 'USD' },
      { symbol: 'VEU', name: 'Vanguard FTSE All-World ex-US', quantity: '85', value: '5218', allocation: '22.1', currency: 'USD' },
      { symbol: 'BTC', name: 'Bitcoin', quantity: '0.35', value: '4655.75', allocation: '19.7', currency: 'USD' },
      { symbol: 'MSFT', name: 'Microsoft Corp.', quantity: '12', value: '4710.24', allocation: '20', currency: 'USD' },
    ],
  };
}

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
