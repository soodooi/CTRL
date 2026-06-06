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
  capabilities: string[];
  managed_by: ProviderManagedBy;
}

/** Snapshot of all registered providers (builtin + user-installed). */
export async function providerList(): Promise<ProviderListRow[]> {
  return invoke<ProviderListRow[]>('provider_list');
}

/** Canonical role ids. Mirrors Rust `Consumer::id()`. */
export type IrisyRole = 'irisy.primary' | 'irisy.fallback';

export interface ProviderSetActiveArgs {
  role: IrisyRole | string;
  provider_id: string;
}

export interface ProviderSetActiveReply {
  /** First chunk of the 1-token trial chat (verification proof). */
  trial_reply: string;
}

/**
 * Bind a provider to a role after a successful 1-token trial chat.
 * On verify failure the registry keeps the previous binding intact and
 * the promise rejects with the provider's error message.
 */
export async function providerSetActive(
  args: ProviderSetActiveArgs,
): Promise<ProviderSetActiveReply> {
  return invoke<ProviderSetActiveReply>('provider_set_active', { args });
}
