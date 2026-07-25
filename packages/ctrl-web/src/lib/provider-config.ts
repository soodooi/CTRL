// ADR-002 substrate § provider v71 — PWA bridge for explicit provider roles
// and orthogonal configuration/runtime/verification facts.
//
// - providerList() → all known manifests with managed_by status
// - providerSetActive(role, provider_id) → switch a role with trial verify
// - loadBrainState() / formatBrainStateBlock() live in irisy-prompts.ts
//   because they are also consumed by the system-prompt path.

import { invoke } from './bridge';
import type { ProviderManagedBy } from './irisy-prompts';

/**
 * Canonical identity used when comparing catalogue entries with persisted
 * provider manifests. The kernel-returned id remains authoritative for writes.
 * (ADR-002 substrate §3.10 v67)
 */
export function canonicalProviderId(raw: string): string {
  let canonical = '';
  let previousWasReplacementDash = true;
  for (const char of raw) {
    const lower = char.toLowerCase();
    if (/^[a-z0-9_-]$/.test(lower)) {
      canonical += lower;
      previousWasReplacementDash = lower === '-';
    } else if (!previousWasReplacementDash) {
      canonical += '-';
      previousWasReplacementDash = true;
    }
  }
  return canonical.replace(/-+$/, '');
}

/** Mirrors Rust `ProviderKind` (manifest.rs). `cli_claude_persistent`
 *  removed (ADR-002 substrate § provider v61, 2026-07-11): Claude
 *  subscription OAuth may not back an LLM provider per Anthropic's
 *  usage policy. */
export type ProviderKind =
  | 'cli_one_shot'
  | 'http_api'
  | 'rest_anthropic'
  | 'rest_openai'
  | 'rest_google'
  | 'rest_ollama';

/** Where the manifest came from. PWA Settings groups by source —
 *  `builtin` = system-shipped (Ollama and future CLI manifests),
 *  `user` = added via PWA AddModal (BYOK). bao 2026-06-06. */
export type ProviderSource = 'builtin' | 'user';

/** One row in the Providers picker. Mirrors Rust `ProviderListRow`. */
export interface ProviderListRow {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Persisted HTTP wire shape; preserves custom-provider edits.
   * (ADR-002 substrate § provider v67) */
  shape: 'openai_chat_completions' | 'anthropic_messages';
  /** bao 2026-06-06: endpoint URL exposed so AddModal Edit mode can
   *  prefill the Base URL field. */
  endpoint: string | null;
  models: string[];
  description: string;
  /** Saved configuration can construct the adapter; runtime availability and
   * verification remain separate facts. (ADR-002 substrate § provider v71) */
  configured: boolean;
  runtime_status: 'unknown' | 'available' | 'unavailable';
  runtime_detail: string | null;
  /** Current manifest and credential match persisted production-trial evidence;
   * role intent is reported independently in active_roles. */
  verified: boolean;
  active_roles: string[];
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
  /** Resolved model id from the provider manifest's first declared model. */
  model_id: string | null;
}

/**
 * Bind a provider to a role after a successful 1-token trial chat.
 * On verify failure the registry keeps the previous binding intact and
 * the promise rejects with the provider's error message.
 *
 * The SSOT mutation is the whole job — ADR-002 substrate §1 v19
 * (2026-06-09) retired the §3.9 Pi `setModel` in-place push along with
 * Pi itself; consumers of the provider router pick the new binding up
 * from the registry on their next request.
 */
export async function providerSetActive(
  args: ProviderSetActiveArgs,
): Promise<ProviderSetActiveReply> {
  return invoke<ProviderSetActiveReply>('provider_set_active', { args });
}

/** Remove one role binding while retaining the provider configuration. */
export async function providerClearActive(role: IrisyRole): Promise<boolean> {
  return invoke<boolean>('provider_clear_active', { args: { role } });
}
