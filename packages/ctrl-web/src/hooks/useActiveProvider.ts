// useActiveProvider — single source of truth for the active LLM
// provider feeding Irisy.
//
// Replaces 5 scattered invoke('get_active_providers') call sites that
// each kept their own state + format string + refresh strategy:
//   - AmbientWorkbench (fed Sidebar + AmbientHome) — listen event
//   - ChatHeaderControls — 8s polling, no event
//   - ProviderPicker — mount-once, no event
//   - ProviderHub — mount-once, no event
// Each drift produced a different chip string for the same backend
// state. Decision 0007 §display (2026-06-19) collapses them into one
// hook so every surface reads identically.
//
// Schema mirror of backend ActiveRoleProvider (provider.rs:286):
//   id          — provider slug (keychain account, toml stem)
//   label       — display label from the manifest
//   model_id    — raw model id ("glm-5.2")
//   model_label — display name from the manifest (often same as
//                 model_id today; future: pretty-printed "GLM 5.2")

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface ActiveProvider {
  id: string;
  label: string;
  model_id: string | null;
  model_label: string | null;
}

interface ActiveProvidersView {
  roles: Record<string, ActiveProvider>;
}

export const PRIMARY_ROLE = 'irisy.primary';

/**
 * Read the active irisy.primary provider. Re-fetches on
 * `active-providers-changed` (emitted by provider_set_active,
 * config_set_provider_key, config_delete_provider) so every consumer
 * updates in lockstep without polling.
 *
 * Returns `null` while loading and when no provider is bound to the
 * role. Both states mean "the chip should show a configure affordance".
 */
export function useActiveProvider(role: string = PRIMARY_ROLE): {
  active: ActiveProvider | null;
  loading: boolean;
} {
  const [active, setActive] = useState<ActiveProvider | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const reload = (): void => {
      void invoke<ActiveProvidersView>('get_active_providers')
        .then((v) => {
          if (cancelled) return;
          setActive(v.roles[role] ?? null);
        })
        .catch(() => {
          if (cancelled) return;
          setActive(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    reload();
    const unlisten = listen('active-providers-changed', reload);
    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
    };
  }, [role]);

  return { active, loading };
}

/**
 * Format the active provider for chip / sidebar display. Single
 * format string for the whole app — change the contract here, not in
 * 5 scattered template literals.
 *
 *   null          → '' (caller shows "configure")
 *   model_label?  → `${label} · ${model_label}`
 *   else          → `${label} · ${model_id}` (legacy / no display name)
 *   no model      → `${label}`
 */
export function formatProviderLabel(active: ActiveProvider | null): string {
  if (!active) return '';
  const model = active.model_label ?? active.model_id;
  return model ? `${active.label} · ${model}` : active.label;
}
