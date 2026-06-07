// ADR-002 substrate § provider v2 §3.6 — PWA bridge for the providers
// surface. Mirrors the Rust `commands::provider` Tauri commands.
//
// - providerList() → all known manifests with managed_by status
// - providerSetActive(role, provider_id) → switch a role with trial verify
// - loadBrainState() / formatBrainStateBlock() live in irisy-prompts.ts
//   because they are also consumed by the system-prompt path.

import { invoke } from './bridge';
import type { ProviderManagedBy } from './irisy-prompts';

/** Mirrors Rust `ProviderKind` (manifest.rs). */
export type ProviderKind = 'cli_one_shot' | 'cli_claude_persistent' | 'http_api';

/** Where the manifest came from. PWA Settings groups by source —
 *  `builtin` = system-shipped (Ollama and future CLI manifests),
 *  `user` = added via PWA AddModal (BYOK). bao 2026-06-06. */
export type ProviderSource = 'builtin' | 'user';

/** One row in the Providers picker. Mirrors Rust `ProviderListRow`. */
export interface ProviderListRow {
  id: string;
  label: string;
  kind: ProviderKind;
  /** bao 2026-06-06: endpoint URL exposed so AddModal Edit mode can
   *  prefill the Base URL field. */
  endpoint: string | null;
  models: string[];
  description: string;
  /** True iff credentials resolved + adapter constructed without error. */
  ready: boolean;
  load_error: string | null;
  source: ProviderSource;
  capabilities: string[];
  managed_by: ProviderManagedBy;
}

/** Snapshot of all registered providers (builtin + user-installed). */
export async function providerList(): Promise<ProviderListRow[]> {
  return invoke<ProviderListRow[]>('provider_list');
}

/** Canonical role ids. Mirrors Rust `Consumer::id()`. */
// ADR-002 substrate § brain v13 (2026-06-07, retracts v11 §3.11):
// coding.primary REMOVED. Pi reads ~/.pi/agent/models.json itself —
// no separate CTRL routing slot for the Coding L1 chip.
export type IrisyRole = 'irisy.primary' | 'irisy.fallback';

export interface ProviderSetActiveArgs {
  role: IrisyRole | string;
  provider_id: string;
}

export interface ProviderSetActiveReply {
  /** First chunk of the 1-token trial chat (verification proof). */
  trial_reply: string;
  /** ADR-002 substrate § provider v10 §3.9 (2026-06-07). Resolved model id
   *  from the provider manifest's first declared model — fed into Pi's
   *  in-place `setModel(provider_id, model_id)` for 0-ms swap. */
  model_id: string | null;
}

/**
 * Bind a provider to a role after a successful 1-token trial chat.
 * On verify failure the registry keeps the previous binding intact and
 * the promise rejects with the provider's error message.
 *
 * ADR-002 substrate § provider v10 §3.9 (2026-06-07). After the SSOT
 * mutation succeeds + trial chat passes, push the new (provider, model)
 * pair into the running Pi session via `setModel` RPC — swaps Pi's
 * active model in place (0 ms, NO daemon respawn, session preserved).
 *
 * Failure to call Pi setModel is non-fatal: SSOT is the source of truth
 * and the next Pi spawn will pick the new binding up. The promise still
 * resolves so Settings UX flows.
 */
export async function providerSetActive(
  args: ProviderSetActiveArgs,
): Promise<ProviderSetActiveReply> {
  const reply = await invoke<ProviderSetActiveReply>('provider_set_active', { args });
  if (args.role === 'irisy.primary' && reply.model_id) {
    try {
      const { setModel } = await import('./usePiRpc');
      await setModel(args.provider_id, reply.model_id);
    } catch (e) {
      // SSOT mutated; respawn path picks it up. Log + continue.
      console.warn('[provider-config] Pi setModel in-place swap skipped:', e);
    }
  }
  return reply;
}
