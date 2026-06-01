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
    let install = crate::shell::pi_install::current_status();
    let engine = EngineStatus {
        id: ENGINE_ID,
        version: install.installed_version,
        healthy: crate::shell::brain_supervisor::is_running(),
        last_token_ms: None,
    };

    let registry = &kernel.runtime.provider_registry;
    let mut providers: BTreeMap<String, RoleProvider> = BTreeMap::new();
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
}

#[tauri::command]
pub async fn provider_set_active(
    kernel: State<'_, KernelHandle>,
    args: ProviderSetActiveArgs,
) -> Result<ProviderSetActiveReply, String> {
    let consumer = Consumer::from_id(&args.role);
    let registry = &kernel.runtime.provider_registry;
    let trial_reply = registry
        .set_active(&args.provider_id, consumer)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ProviderSetActiveReply { trial_reply })
}
