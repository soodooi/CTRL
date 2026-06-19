// Provider commands — ADR-002 substrate § provider v2 §3.7 introspection.
//
// `brain_status` is the first command in the v2 surface; it closes the
// "Irisy does not know its own stack" gap (bao 2026-05-31). Returns the
// engine (Pi) version + healthy flag plus, per Irisy role, the active
// provider's manifest snapshot (id / brand label / endpoint or binary /
// healthy / managed_by). The Irisy system prompt v5 (ADR-005 § persona)
// injects this block as `<brain_state>` so Irisy can answer "what model
// are you on" with a brand label, not an RPC codename.
//
// `last_failover` is `null` today — the failover event source lands in
// the http_endpoint follow-up commit; this command already accepts the
// shape so the PWA can render the field once events flow.

// ADR-002 substrate § provider v9 §3.7 (2026-06-06): retract v8 SSOT
// projection surface (get_active_providers + ActiveProvidersView +
// RoutingOverride overlay). Under v9 Pi spawns with the real BYOK
// provider+model directly, so Pi's getState is the truth for the chip
// — kernel no longer projects SSOT for the PWA chip. Settings page
// still calls provider_get_active to render the picker selection.
// ADR-002 substrate § provider v9 §3.7 (2026-06-06): only RoutingOverride
// import was retracted with the SSOT projection surface; ProviderManagedBy
// + BTreeMap stay — still used by provider_list / brain_status.
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::kernel::provider::detect::{detect_cli_providers, CliProviderEntry};
use crate::kernel::provider::registry::ProviderManagedBy;
use crate::kernel::provider::{Consumer, ProviderListEntry, RecordedFailover};
use crate::shell::KernelHandle;

const ENGINE_ID: &str = "Pi";

/// Display label for CTRL-managed providers. ADR-002 substrate §
/// provider v2 §3.7: brand label hides the codename (`volc`) so Irisy's
/// user-facing copy survives the future ctrl-brand provider swap.
const CTRL_MANAGED_BRAND_LABEL: &str = "CTRL Cloud";

#[derive(Debug, Serialize)]
pub struct BrainStatusView {
    pub engine: EngineStatus,
    /// Keyed by canonical role id ("irisy.primary" / "irisy.fallback").
    /// Empty value = role is unconfigured; the PWA should surface a
    /// "configure provider" affordance for that slot.
    pub providers: BTreeMap<String, RoleProvider>,
    pub last_failover: Option<FailoverEvent>,
}

#[derive(Debug, Serialize)]
pub struct EngineStatus {
    /// Always "Pi" today — the sole brain (ADR-002 § brain v1).
    pub id: &'static str,
    pub version: Option<String>,
    /// Whether the brain supervisor has a live Pi child right now.
    pub healthy: bool,
    /// Reserved for the streaming metrics follow-up; `None` until the
    /// supervisor wires per-turn token latency.
    pub last_token_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct RoleProvider {
    pub id: String,
    /// Brand-facing label. Equal to the manifest `label` for user-managed
    /// providers; rewritten to `CTRL_MANAGED_BRAND_LABEL` for CTRL-managed
    /// providers so the user-facing UI stays brand-stable even when the
    /// underlying manifest changes.
    pub label: String,
    pub endpoint: Option<String>,
    pub binary: Option<String>,
    /// Mirrors `ProviderSnapshot::ready` — credential resolved + adapter
    /// constructed without error.
    pub healthy: bool,
    pub managed_by: ProviderManagedBy,
}

#[derive(Debug, Serialize)]
pub struct FailoverEvent {
    pub from: String,
    pub to: String,
    pub reason: String,
}

#[tauri::command]
pub fn brain_status(
    kernel: State<'_, KernelHandle>,
) -> Result<BrainStatusView, String> {
    brain_status_inner(&kernel)
}

/// Tauri-State-free entry point so kernel::provider::http_endpoint
/// /tool/brain_status can reuse the same body (ADR-002 substrate § brain
/// v7 §1.1, 2026-06-04). Pi's brain_status tool gives Irisy self-
/// awareness of its own active provider — closes the "doesn't know its
/// stack" gap from the BYOK path too.
pub(crate) fn brain_status_inner(
    kernel: &KernelHandle,
) -> Result<BrainStatusView, String> {
    // ADR-002 substrate §1 v19 (2026-06-09): the EngineStatus shape was
    // designed around Pi-as-sole-brain. In the 3-agent aggregator era this
    // field reports a synthetic "aggregator" engine — the PWA's chip UI
    // moves to per-agent status (commands::agents::agent_status) in the
    // next release. Kept as a stable shape so the existing PWA build
    // doesn't break during the transition.
    let engine = EngineStatus {
        id: ENGINE_ID,
        version: None,
        healthy: true,
        last_token_ms: None,
    };

    let registry = &kernel.runtime.provider_registry;
    let mut providers: BTreeMap<String, RoleProvider> = BTreeMap::new();
    // ADR-002 substrate § provider v11 §3.11 (2026-06-07): include
    // coding.primary so PWA Settings + chip see all 3 roles.
    // ADR-002 substrate § brain v13 (2026-06-07): CodingPrimary retracted.
    for role in [Consumer::IrisyPrimary, Consumer::IrisyFallback] {
        let chain = registry.route_chain(&role);
        if let Some(active_id) = chain.primary.as_ref() {
            if let Some(snap) = registry.snapshot(active_id) {
                let label = match snap.managed_by {
                    ProviderManagedBy::Ctrl => CTRL_MANAGED_BRAND_LABEL.to_string(),
                    ProviderManagedBy::User => snap.label.clone(),
                };
                providers.insert(
                    role.id(),
                    RoleProvider {
                        id: snap.id,
                        label,
                        endpoint: snap.endpoint,
                        binary: snap.binary,
                        healthy: snap.ready,
                        managed_by: snap.managed_by,
                    },
                );
            }
        }
    }

    let last_failover = registry.last_failover_event().map(FailoverEvent::from_recorded);

    Ok(BrainStatusView {
        engine,
        providers,
        last_failover,
    })
}

impl FailoverEvent {
    /// Map the registry-side `RecordedFailover` (which carries
    /// `at_unix_ms`) into the wire shape brain_status exposes.
    fn from_recorded(rec: RecordedFailover) -> Self {
        Self {
            from: rec.from,
            to: rec.to,
            reason: rec.reason,
        }
    }
}

/// Scan PATH for the known CLI providers (claude / codex / gemini /
/// aider / ollama). Cached at the kernel level — repeated calls reuse
/// the first scan's result. ADR-002 substrate § provider v2 §3.6.
#[tauri::command]
pub fn provider_detect() -> Result<Vec<CliProviderEntry>, String> {
    Ok(detect_cli_providers())
}

/// One row in the /settings/providers page picker. Wraps `ProviderListEntry`
/// (from the registry) with the role-aware `managed_by` field the UI needs
/// to render the [CTRL-managed] vs user-owned badge. ADR-002 substrate §
/// provider v2 §3.6.
#[derive(Debug, Serialize)]
pub struct ProviderListRow {
    #[serde(flatten)]
    pub entry: ProviderListEntry,
    pub managed_by: ProviderManagedBy,
}

/// List every known provider manifest (builtin + user-installed) with
/// load + managed_by status. Powers the role section radio rows in
/// /settings/providers. ADR-002 substrate § provider v2 §3.6.
#[tauri::command]
pub fn provider_list(
    kernel: State<'_, KernelHandle>,
) -> Result<Vec<ProviderListRow>, String> {
    let registry = &kernel.runtime.provider_registry;
    // bao 2026-06-06: rescan ~/.ctrl/providers/*.toml so that user
    // providers added via config_set_provider_key are visible without
    // a CTRL restart. ~10 ms scan cost is acceptable for Settings UI.
    registry.reload_user_dir();
    let entries = registry.list();
    let rows = entries
        .into_iter()
        .map(|entry| {
            let managed_by = registry
                .snapshot(&entry.id)
                .map(|s| s.managed_by)
                .unwrap_or(ProviderManagedBy::User);
            ProviderListRow { entry, managed_by }
        })
        .collect();
    Ok(rows)
}

/// Tauri command body for `provider_set_active(role, id)`. Wraps the
/// registry's trial-verify + persist path. ADR-002 substrate § provider
/// v2 §3.6 lock #4: trial chat MUST pass before commit; failure keeps
/// the previous role binding intact.
#[derive(Debug, Deserialize)]
pub struct ProviderSetActiveArgs {
    /// Canonical role id, e.g. "irisy.primary" / "irisy.fallback". Unknown
    /// ids fall through to `Consumer::Custom(id)`.
    pub role: String,
    /// Manifest id from the picker (`provider_list` row id).
    pub provider_id: String,
}

#[derive(Debug, Serialize)]
pub struct ProviderSetActiveReply {
    /// First chunk of the 1-token "hi" trial chat (verification proof).
    pub trial_reply: String,
    /// ADR-002 substrate § provider v10 §3.9 (2026-06-07). Resolved model id
    /// from the provider manifest's first declared model. PWA uses this
    /// to call Pi RPC `setModel(provider_id, model_id)` immediately after
    /// SSOT mutation — swapping Pi's active model in place (0 ms, no
    /// daemon respawn, session preserved). `None` only when the provider
    /// manifest declares no models (degenerate config).
    pub model_id: Option<String>,
}

#[tauri::command]
pub async fn provider_set_active(
    app: tauri::AppHandle,
    kernel: State<'_, KernelHandle>,
    args: ProviderSetActiveArgs,
) -> Result<ProviderSetActiveReply, String> {
    // ADR-002 substrate § provider v10 §3.9 (2026-06-07): SSOT mutation +
    // resolve the manifest's first model so the PWA can immediately call
    // Pi `setModel(provider_id, model_id)` for in-place swap.
    let consumer = Consumer::from_id(&args.role);
    let registry = &kernel.runtime.provider_registry;
    let trial_reply = registry
        .set_active(&args.provider_id, consumer)
        .await
        .map_err(|e| e.to_string())?;
    let model_id = registry.first_model_for(&args.provider_id);
    // Decision 0007 §hermes-sync (2026-06-19): project the new active
    // provider into ~/.hermes/config.yaml so Hermes (Irisy's brain)
    // picks it up. Without this Irisy kept answering with the previous
    // model because Hermes reads its own config, not CTRL's SSOT. Only
    // HTTP providers carry endpoint+key; CLI providers (claude-oauth)
    // own their auth and skip this projection.
    if let Some(manifest) = registry.manifest_for(&args.provider_id) {
        if matches!(
            manifest.kind,
            crate::kernel::provider::manifest::ProviderKind::HttpApi
        ) {
            let api_key = match &manifest.auth {
                crate::kernel::provider::manifest::AuthSource::Keychain { account } => {
                    crate::shell::KeychainStore::get(account).ok().flatten()
                }
                crate::kernel::provider::manifest::AuthSource::ConfigKey { field } => {
                    manifest.config.get(field).cloned()
                }
                crate::kernel::provider::manifest::AuthSource::Env { var } => {
                    std::env::var(var).ok()
                }
                crate::kernel::provider::manifest::AuthSource::None => None,
            };
            if let Some(key) = api_key {
                if let Err(e) =
                    crate::commands::agents::write_hermes_config_yaml(&manifest, &key)
                {
                    tracing::warn!(error = %e, "hermes config.yaml projection failed");
                }
            } else {
                tracing::debug!(
                    provider = %args.provider_id,
                    "hermes config.yaml projection skipped: no api_key resolved"
                );
            }
        }
    }
    // ADR-002 substrate § provider v8 §3.5 (2026-06-06): SSOT
    // (~/.ctrl/state/active-providers.json) mutated; emit
    // `active-providers-changed` so chip + Irisy self-report + Settings
    // refresh. Renamed from `provider-changed` to anchor the event name
    // to the SSOT it mirrors, not a generic provider-side event.
    use tauri::Emitter;
    if let Err(e) = app.emit(
        "active-providers-changed",
        serde_json::json!({ "id": args.provider_id, "op": "set_active", "role": args.role }),
    ) {
        tracing::warn!(error = %e, "emit active-providers-changed (set_active) failed");
    }
    Ok(ProviderSetActiveReply {
        trial_reply,
        model_id,
    })
}

// ── ADR-002 substrate § provider v9 §3.7 (2026-06-06) — SSOT INTENT projection
//
// Per v9 retract: PWA *chip* now reads `pi_rpc('getState')` (Pi truth).
// `get_active_providers` is kept as the **Settings INTENT** projection —
// it reflects what the user *picked* in Settings (the SSOT in
// `~/.ctrl/state/active-providers.json`), independent of Pi's current
// runtime state. Settings UI consumes this to render "what did the user
// pick"; the chip does not.
//
// v9 difference vs v8: no `routing_override` field (failover-driven UI
// override events were retired with the fallback walking loop). The
// projection is now a pure SSOT mirror.

use crate::kernel::provider::registry::ProviderManagedBy as _ProviderManagedByForView;

const CTRL_MANAGED_BRAND_LABEL_VIEW: &str = "CTRL Cloud";

#[derive(Debug, Serialize)]
pub struct ActiveRoleProvider {
    pub id: String,
    pub label: String,
    pub model_id: Option<String>,
    pub model_label: Option<String>,
    pub managed_by: _ProviderManagedByForView,
}

#[derive(Debug, Serialize)]
pub struct ActiveProvidersView {
    pub roles: BTreeMap<String, ActiveRoleProvider>,
}

#[tauri::command]
pub fn get_active_providers(
    kernel: State<'_, KernelHandle>,
) -> Result<ActiveProvidersView, String> {
    let registry = &kernel.runtime.provider_registry;
    let mut roles: BTreeMap<String, ActiveRoleProvider> = BTreeMap::new();
    // ADR-002 substrate § provider v11 §3.11 (2026-06-07): include
    // coding.primary so PWA Settings + chip see all 3 roles.
    // ADR-002 substrate § brain v13 (2026-06-07): CodingPrimary retracted.
    for role in [Consumer::IrisyPrimary, Consumer::IrisyFallback] {
        let chain = registry.route_chain(&role);
        if let Some(active_id) = chain.primary.as_ref() {
            if let Some(snap) = registry.snapshot(active_id) {
                let label = match snap.managed_by {
                    _ProviderManagedByForView::Ctrl => CTRL_MANAGED_BRAND_LABEL_VIEW.to_string(),
                    _ProviderManagedByForView::User => snap.label.clone(),
                };
                let model_id = registry.first_model_for(active_id);
                let model_label = model_id.clone();
                roles.insert(
                    role.id(),
                    ActiveRoleProvider {
                        id: snap.id,
                        label,
                        model_id,
                        model_label,
                        managed_by: snap.managed_by,
                    },
                );
            }
        }
    }
    Ok(ActiveProvidersView { roles })
}

#[cfg(test)]
mod tests {
    // SC6 — brain_status failover wire shape. ADR-002 substrate § provider
    // v2 §3.7 (2026-05-31): brain_status exposes from/to/reason only; the
    // registry's RecordedFailover timestamp (§3.5) stays kernel-side and
    // must not leak into the <brain_state> block.
    use super::*;

    #[test]
    fn failover_event_from_recorded_keeps_transition_fields() {
        let rec = RecordedFailover {
            from: "claude-oauth".to_string(),
            to: "volc".to_string(),
            reason: "oauth expired".to_string(),
            at_unix_ms: 1_700_000_000_000,
        };
        let ev = FailoverEvent::from_recorded(rec);
        assert_eq!(ev.from, "claude-oauth");
        assert_eq!(ev.to, "volc");
        assert_eq!(ev.reason, "oauth expired");
    }
}
