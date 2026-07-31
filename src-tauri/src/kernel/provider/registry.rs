// ProviderRegistry — load provider manifests, instantiate configured adapters,
// probe adapter-owned runtime facts, and persist explicit role bindings.
//
// Catalogue, configuration, runtime availability, production verification, and
// binding are independent facts. Builtin manifests never create bindings;
// `provider_set_active` commits a role only after the production first-output
// trial. Active state persists as versioned v4 under
// `~/.ctrl/state/active-providers.json`, with role intent and verification
// fingerprints stored as independent maps. Legacy automatic Ollama fallback
// state is removed once while prior role intent remains bound but unverified.
// (ADR-002 substrate § provider v71)
//
// Builtin TOMLs are embedded via `include_str!` so a packaged release can show
// known integrations even when `~/.ctrl/providers/` is empty. User manifests
// win by id, allowing endpoint/model overrides without code changes.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::SystemTime;
use tokio::sync::{Mutex, MutexGuard};

/// Cooldown window after a provider's chat_stream / first-chunk peek fails.
/// While inside the window, `http_endpoint` skips this provider as the
/// primary candidate IF there is at least one fallback available, so we
/// don't re-pay the failed primary's spawn/connect cost on every Pi turn.
/// 5 minutes balances "react fast when user fixes auth" vs "don't waste
/// 300 ms / 401 on every turn during a provider auth outage". ADR-002
/// substrate § provider v2 §3.5 M2 amendment 2026-06-04.
const PROVIDER_COOLDOWN_SECS: u64 = 300;

use serde::{Deserialize, Serialize};
// Verification fingerprints bind evidence to current provider behavior.
// (ADR-002 substrate § provider v71)
use sha2::{Digest, Sha256};

use super::adapter::{
    HttpApiProvider, OneShotCliProvider, RestAnthropicProvider, RestGoogleProvider,
    RestOllamaProvider, RestOpenaiProvider,
};
use super::manifest::{
    default_active_state_path, default_user_providers_dir, legacy_config_path, parse_file,
    parse_str, AuthSource, HttpShape, ProviderKind, ProviderManifest,
};
use super::r#trait::{
    Capability, Consumer, Provider, ProviderRuntimeAvailability, ProviderRuntimeStatus, RouteChain,
};

/// Who pays for a provider's calls. Surfaced by `snapshot()` so the
/// Settings UI + brain_status response can mark CTRL-billed paths
/// distinctly from user-owned ones. ADR-002 substrate § provider v2 §3.7.
#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderManagedBy {
    /// CTRL pays — credential owned by CTRL secrets pipeline (today the
    /// `volc` builtin is the occupier).
    Ctrl,
    /// User pays — credential lives in the user keychain (BYOK) or the
    /// user drives their own local CLI.
    User,
}

/// Snapshot of a single provider's externally relevant configuration fact.
/// Runtime availability, verification, and role binding remain separate.
/// (ADR-002 substrate § provider v71)
#[derive(Debug, Clone, Serialize)]
pub struct ProviderSnapshot {
    pub id: String,
    pub label: String,
    pub kind: ProviderKind,
    pub endpoint: Option<String>,
    pub binary: Option<String>,
    /// True iff credentials/config resolved and the adapter was constructed.
    pub configured: bool,
    pub managed_by: ProviderManagedBy,
}
use super::types::ProviderError;
use super::verify::trial_chat;

const KEYCHAIN_SERVICE_PRIMARY: &str = "app.ctrl";
const KEYCHAIN_SERVICE_LEGACY: &str = "app.ctrl.spike";

/// Provider role bindings are never seeded from a builtin id. Catalogue
/// presence is not evidence that a runtime exists; only explicit activation
/// after the production trial may create a binding.
/// (ADR-002 substrate § provider v70; ADR-006 cross-cutting § BYOK v12)

/// Manifest ids whose credential pipeline is owned by CTRL (CTRL pays
/// the bill). Used by `snapshot()` to set `managed_by`. ADR-002
/// substrate § provider v2 lock #3 + v2 §3.7. Empty today: the only
/// builtin is local `ollama` (runs on the user's own machine, CTRL pays
/// nothing). A CF Workers AI / CTRL-brand cloud provider lands here once
/// the ctrl-cloud secrets pipeline ships (ADR-006 § byok-no-claude v2).
const CTRL_MANAGED_PROVIDER_IDS: &[&str] = &[];

/// Embedded builtin manifests are catalogue integrations only. Their presence
/// proves neither local installation nor role binding. Ollama runtime status is
/// adapter-probed before display/routing. (ADR-002 substrate § provider v71)
const BUILTIN_MANIFESTS: &[(&str, &str)] = &[
    ("ollama", include_str!("builtin/ollama.toml")),
];

pub type ProviderHandle = Arc<dyn Provider>;

/// Where the manifest came from. PWA Settings groups rows by source
/// (Available auto-detected vs. user-added BYOK). bao 2026-06-06.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderSource {
    /// Shipped with CTRL (BUILTIN_MANIFESTS).
    Builtin,
    /// User-added at `~/.ctrl/providers/<id>.toml` via PWA AddModal.
    User,
}

/// One loaded entry — instantiated adapter + the source manifest +
/// whether the credential resolution succeeded at boot.
struct LoadedProvider {
    manifest: Arc<ProviderManifest>,
    provider: Option<ProviderHandle>,
    load_error: Option<String>,
    source: ProviderSource,
}

/// Persisted proof that the exact provider configuration completed the
/// production first-output trial. Only the digest is stored.
/// (ADR-002 substrate § provider v71)
#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
struct VerificationEvidence {
    fingerprint: String,
}

pub struct ProviderRegistry {
    /// All known manifests by id. `provider` is Some when the
    /// credential resolution + adapter construction succeeded; None
    /// when the manifest loaded but credentials were absent — UI can
    /// still list the manifest and prompt the user to set a key.
    providers: RwLock<BTreeMap<String, LoadedProvider>>,
    /// Currently active provider id per consumer role (v2: was per
    /// `Capability` in v1). Mirrors `~/.ctrl/state/active-providers.json`
    /// `"roles"` map on every mutation.
    active: RwLock<BTreeMap<Consumer, String>>,
    /// Production-trial evidence keyed by provider id. Evidence is valid only
    /// while its digest matches the current behavior manifest and resolved
    /// credential; role binding never implies verification.
    /// (ADR-002 substrate § provider v71)
    verifications: RwLock<BTreeMap<String, VerificationEvidence>>,
    /// Serializes provider definition/credential mutation with production
    /// verification so compare-and-commit cannot observe mixed generations.
    /// (ADR-002 substrate § provider v71)
    mutation_lock: Mutex<()>,
    /// Path the active-state file is persisted to. None when HOME is
    /// unavailable (CI) — in-memory active map still works, just isn't
    /// saved across boots.
    active_state_path: Option<PathBuf>,
    /// Most recent failover transition observed by `http_endpoint`.
    /// `None` until the first auto-fallback fires. Surfaced via
    /// `brain_status()` so the PWA + Irisy prompt can acknowledge the
    /// transition without polling logs. ADR-002 substrate § provider
    /// v2 §3.5 + §3.7.
    last_failover: RwLock<Option<RecordedFailover>>,
    /// Transient routing override while the primary is in outage. Read by
    /// `commands::provider::get_active_providers` so the chip overlays the
    /// fallback label until primary recovers. Set/cleared from
    /// `http_endpoint` — kernel events surface to Tauri via
    /// `KernelHandle::app::emit`. ADR-002 substrate § provider v8 §3.5
    /// (2026-06-06).
    routing_override: RwLock<Option<RoutingOverride>>,
    /// Recent-failure cache, keyed by manifest id. Populated by
    /// `mark_failure` (called from the http_endpoint fallback loop) and
    /// consulted via `is_in_cooldown` so subsequent Pi turns skip a
    /// known-bad primary while the cooldown window holds. Cleared on
    /// observed success via `clear_failure`. ADR-002 substrate §
    /// provider v2 §3.5 M2 amendment 2026-06-04 (wording updated per
    /// ADR-002 substrate § provider v61, 2026-07-11) — avoids re-paying
    /// a failed REST 401 every turn during a provider auth outage.
    provider_health: RwLock<BTreeMap<String, HealthState>>,
}

/// One provider's last-known failure state. Reset entries also persist
/// the `reason` text so `brain_status` / logs can surface why the
/// cooldown was set without reading log scrollback.
#[derive(Debug, Clone)]
struct HealthState {
    last_failure_at: SystemTime,
    reason: String,
}

/// One failover transition: primary → fallback at a moment in time.
/// Reset to None never happens during a session — the latest event
/// wins. `at_unix_ms` is monotonic-ish (system time) and intentionally
/// not used for ordering elsewhere; the Settings UI just renders it
/// for the user to know how stale "Claude offline → switched" is.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordedFailover {
    pub from: String,
    pub to: String,
    pub reason: String,
    pub at_unix_ms: i64,
}

/// Transient routing override during a primary outage. ADR-002 substrate §
/// provider v8 §3.5 (2026-06-06): when the primary chat_stream fails the
/// router routes the same request to fallback + sets this state + emits
/// `provider:routing-override` Tauri event. SSOT file (active-providers.json)
/// is NOT mutated — user intent is not stolen by transient failure. On the
/// next successful primary call the state clears + emits
/// `provider:routing-restored`. PWA chip + ctrl-pi-bridge runtimeTruthBlock
/// overlay this on top of `get_active_providers()` for the duration.
#[derive(Debug, Clone, Serialize)]
pub struct RoutingOverride {
    /// Canonical role id of the fallback that is currently servicing the
    /// primary's traffic, e.g. "irisy.fallback". Chip uses this to look
    /// up the displayed label.
    pub active: String,
    pub reason: String,
    pub at_unix_ms: i64,
}

impl ProviderRegistry {
    /// Build a registry from builtin TOMLs + `~/.ctrl/providers/*.toml`
    /// + legacy `~/.ctrl/config.toml` providers. Failures inside
    /// individual manifests are logged but don't kill registration —
    /// one bad TOML must not break the others.
    pub fn load() -> Self {
        let registry = Self {
            providers: RwLock::new(BTreeMap::new()),
            active: RwLock::new(BTreeMap::new()),
            // Role intent and trial evidence are independent persisted facts.
            // (ADR-002 substrate § provider v71)
            verifications: RwLock::new(BTreeMap::new()),
            mutation_lock: Mutex::new(()),
            active_state_path: default_active_state_path(),
            last_failover: RwLock::new(None),
            routing_override: RwLock::new(None),
            provider_health: RwLock::new(BTreeMap::new()),
        };

        // 1. Builtin presets (always present).
        for (id, src) in BUILTIN_MANIFESTS {
            match parse_str(src, &format!("builtin/{id}.toml")) {
                Ok(manifest) => registry.install_manifest(manifest, ProviderSource::Builtin),
                Err(e) => tracing::warn!(provider = %id, error = %e, "provider: builtin manifest parse failed"),
            }
        }

        // 2. User-installed manifests at ~/.ctrl/providers/*.toml
        //    override builtins (same id wins; useful for endpoint /
        //    model overrides without forking the codebase).
        if let Some(dir) = default_user_providers_dir() {
            if dir.exists() {
                load_user_manifests(&dir, &registry);
            } else {
                tracing::debug!(?dir, "provider: no user manifests directory");
            }
        }

        // 3. Legacy ~/.ctrl/config.toml bridge — keep pre-PR users'
        //    credentials wired even without a new manifest file. Maps
        //    each known [providers.<name>] table to the matching
        //    builtin manifest id (volc → "volc" etc.) and seeds the
        //    auth_secret resolver fallback chain.
        if let Some(path) = legacy_config_path() {
            if path.exists() {
                if let Some(legacy) = load_legacy_config(&path) {
                    apply_legacy_config(&registry, &legacy);
                }
            }
        }

        // 4. Restore active selections (with v0/v1 -> v2 schema migration).
        registry.restore_active_state();

        // First launch intentionally leaves both roles unbound. Catalogue
        // entries become bindings only through the real production trial in
        // `set_active`; runtime presence is never inferred at boot.
        // (ADR-002 substrate § provider v71)

        registry
    }

    /// Record a failover transition observed by `route_text_chat` when
    /// the primary provider failed and the request was routed through
    /// a fallback. The last transition wins; reads via
    /// `last_failover_event()`. ADR-002 substrate § provider v2 §3.5.
    pub fn record_failover(&self, from: &str, to: &str, reason: &str) {
        let event = RecordedFailover {
            from: from.to_string(),
            to: to.to_string(),
            reason: reason.to_string(),
            at_unix_ms: now_unix_ms(),
        };
        tracing::info!(
            from = %from,
            to = %to,
            reason = %reason,
            "provider: failover recorded"
        );
        let mut slot = self.last_failover.write().unwrap();
        *slot = Some(event);
    }

    /// Set transient routing override. ADR-002 substrate § provider v8
    /// §3.5 (2026-06-06): called from `http_endpoint` when the primary
    /// chat_stream fails and a fallback is now servicing the role. The
    /// SSOT file is NOT mutated (user intent is not stolen). Idempotent —
    /// re-setting with the same value is a no-op for callers.
    pub fn set_routing_override(&self, active_role: &str, reason: &str) {
        let next = RoutingOverride {
            active: active_role.to_string(),
            reason: reason.to_string(),
            at_unix_ms: now_unix_ms(),
        };
        let mut slot = self.routing_override.write().unwrap();
        *slot = Some(next);
    }

    /// Clear the transient routing override. ADR-002 substrate § provider
    /// v8 §3.5 (2026-06-06): called from `http_endpoint` when the primary
    /// successfully services a request again. Idempotent on already-empty.
    pub fn clear_routing_override(&self) {
        let mut slot = self.routing_override.write().unwrap();
        *slot = None;
    }

    /// Read the current routing override (if any). ADR-002 substrate §
    /// provider v8 §3.7 (2026-06-06): consumed by
    /// `commands::provider::get_active_providers` so the chip can overlay
    /// the fallback label until primary recovers.
    pub fn current_routing_override(&self) -> Option<RoutingOverride> {
        self.routing_override.read().unwrap().clone()
    }

    /// Convenience: lookup the first model id declared by a provider
    /// manifest, used by `get_active_providers` to render the default
    /// model the router would pass to that provider. None when the
    /// manifest has zero declared models (manifest authoring bug, surfaced
    /// to the user as "(no model)" rather than silently falling back).
    /// ADR-002 substrate § provider v8 §3.7 (2026-06-06).
    pub fn first_model_for(&self, id: &str) -> Option<String> {
        let providers = self.providers.read().unwrap();
        providers
            .get(id)
            .and_then(|p| p.manifest.models.first().cloned())
    }

    /// Read the most recent failover transition, or None when no
    /// transition has fired this session. Consumed by
    /// `commands::provider::brain_status`.
    pub fn last_failover_event(&self) -> Option<RecordedFailover> {
        self.last_failover.read().unwrap().clone()
    }

    /// Record that `provider_id` failed (either chat_stream() returned
    /// Err, or the first stream chunk was Err). Resets the cooldown
    /// clock. ADR-002 substrate § provider v2 §3.5 M2 2026-06-04.
    pub fn mark_failure(&self, provider_id: &str, reason: &str) {
        let mut map = self.provider_health.write().unwrap();
        map.insert(
            provider_id.to_string(),
            HealthState {
                last_failure_at: SystemTime::now(),
                reason: reason.to_string(),
            },
        );
        tracing::debug!(
            provider = %provider_id,
            reason = %reason,
            "provider: marked unhealthy (cooldown active)"
        );
    }

    /// Drop any cooldown entry for `provider_id`. Called from the
    /// http_endpoint success branch so the slot reopens immediately
    /// when the underlying issue clears (user runs `claude login`,
    /// network restored, etc.). Idempotent — missing entry is a no-op.
    pub fn clear_failure(&self, provider_id: &str) {
        let mut map = self.provider_health.write().unwrap();
        if map.remove(provider_id).is_some() {
            tracing::debug!(
                provider = %provider_id,
                "provider: cooldown cleared after observed success"
            );
        }
    }

    /// Remove one explicit role binding without touching provider configuration.
    /// This is how Settings represents `No fallback`; routing intent remains
    /// independent from catalogue and runtime facts.
    /// (ADR-002 substrate § provider v71)
    pub async fn clear_role(&self, consumer: &Consumer) -> bool {
        let _mutation_guard = self.lock_mutation().await;
        let removed = self.active.write().unwrap().remove(consumer).is_some();
        if removed {
            self.persist_active_state();
        }
        removed
    }

    /// Remove `provider_id` from every active-role slot it occupies.
    /// Called by `config_delete_provider` so the SSOT doesn't keep
    /// pointing at a manifest the registry just dropped — without this
    /// the chip keeps showing a deleted provider until the user picks a
    /// replacement, and any /text-chat call routes into a missing-handle
    /// error path. Decision 0007 §lifecycle, 2026-06-19.
    ///
    /// Returns the list of role ids that were holding this provider so
    /// the caller can log / surface "Zhipu was primary, now unassigned".
    /// Idempotent — no-op when the id wasn't active anywhere.
    pub fn clear_active(&self, provider_id: &str) -> Vec<String> {
        let mut cleared: Vec<String> = Vec::new();
        let mut active = self.active.write().unwrap();
        let keys: Vec<Consumer> = active.keys().cloned().collect();
        for key in keys {
            if active.get(&key).map(|s| s.as_str()) == Some(provider_id) {
                active.remove(&key);
                cleared.push(key.id());
            }
        }
        drop(active);
        if !cleared.is_empty() {
            self.persist_active_state();
            tracing::info!(
                provider = %provider_id,
                roles = ?cleared,
                "provider: cleared from active SSOT after delete"
            );
        }
        cleared
    }

    /// True iff `provider_id` failed within the last
    /// `PROVIDER_COOLDOWN_SECS` window. http_endpoint uses this to
    /// short-circuit a primary candidate when at least one fallback
    /// remains, saving the spawn / connect cost during an outage.
    pub fn is_in_cooldown(&self, provider_id: &str) -> bool {
        let map = self.provider_health.read().unwrap();
        let Some(state) = map.get(provider_id) else {
            return false;
        };
        SystemTime::now()
            .duration_since(state.last_failure_at)
            .map(|d| d.as_secs() < PROVIDER_COOLDOWN_SECS)
            .unwrap_or(false)
    }

    /// Snapshot all manifests with typed configuration, runtime, verification,
    /// and binding facts. Runtime probes are adapter-owned and bounded; no UI
    /// state is inferred from adapter construction alone.
    /// (ADR-002 substrate § provider v71)
    pub async fn list(&self, probe_runtime: bool) -> Vec<ProviderListEntry> {
        let active = self.active.read().unwrap().clone();
        let snapshots: Vec<_> = {
            let providers = self.providers.read().unwrap();
            providers
                .values()
                .map(|loaded| {
                    let active_roles = active
                        .iter()
                        .filter_map(|(role, id)| {
                            (id == &loaded.manifest.id).then(|| role.id())
                        })
                        .collect::<Vec<_>>();
                    (
                        loaded.manifest.clone(),
                        loaded.provider.clone(),
                        loaded.load_error.clone(),
                        loaded.source,
                        active_roles,
                    )
                })
                .collect()
        };

        let mut out = Vec::with_capacity(snapshots.len());
        for (manifest, provider, load_error, source, active_roles) in snapshots {
            // Keep configuration, runtime availability, verification, and
            // binding independent in every row.
            // (ADR-002 substrate § provider v71)
            let configured = provider.is_some();
            let runtime = match (probe_runtime, provider) {
                (true, Some(provider)) => provider.runtime_availability().await,
                _ => ProviderRuntimeAvailability::unknown(),
            };
            // Serialize each independent provider fact without inferring a
            // composite readiness state. (ADR-002 substrate § provider v71)
            out.push(ProviderListEntry {
                id: manifest.id.clone(),
                label: manifest.label.clone(),
                kind: manifest.kind.clone(),
                shape: manifest.shape.clone(),
                endpoint: manifest.endpoint.clone(),
                models: manifest.models.clone(),
                description: manifest.description.clone(),
                configured,
                // Typed runtime and verification facts remain independent.
                // (ADR-002 substrate § provider v71)
                runtime_status: runtime.status,
                runtime_detail: runtime.detail,
                verified: self.is_verified(&manifest.id),
                active_roles,
                load_error,
                source,
                capabilities: manifest
                    .capabilities
                    .iter()
                    .map(|capability| capability.id().to_string())
                    .collect(),
            });
        }
        out.sort_by(|left, right| left.id.cmp(&right.id));
        out
    }

    /// Whether any persisted role currently resolves through this provider id.
    /// Configuration edits use this to verify a replacement before exposing it
    /// to the live registry. (ADR-002 substrate § provider v2 lock #4)
    pub fn is_active_provider(&self, provider_id: &str) -> bool {
        self.active
            .read()
            .unwrap()
            .values()
            .any(|active_id| active_id == provider_id)
    }

    /// Lookup by id regardless of active state.
    pub fn get(&self, id: &str) -> Option<ProviderHandle> {
        let providers = self.providers.read().unwrap();
        providers.get(id).and_then(|p| p.provider.clone())
    }

    /// Snapshot one provider's manifest + load-state for the brain_status
    /// response. `managed_by` derives from a hardcoded ids allowlist
    /// (`CTRL_MANAGED_PROVIDER_IDS`) — when CTRL adds a ctrl-brand
    /// manifest, its id goes in that const and snapshot() reports it as
    /// `Ctrl` without touching the manifest schema.
    /// Serialize provider definition and credential mutations with verification.
    /// Callers holding this guard must use `reload_user_dir_locked`.
    /// (ADR-002 substrate § provider v71)
    pub(crate) async fn lock_mutation(&self) -> MutexGuard<'_, ()> {
        self.mutation_lock.lock().await
    }

    /// Re-scan while the caller holds `lock_mutation`.
    pub(crate) fn reload_user_dir_locked(&self) {
        if let Some(dir) = default_user_providers_dir() {
            if dir.exists() {
                load_user_manifests(&dir, self);
            }
        }
    }

    /// Re-scan `~/.ctrl/providers` without racing a production trial commit.
    /// (ADR-002 substrate § provider v71)
    pub async fn reload_user_dir(&self) {
        let _guard = self.lock_mutation().await;
        self.reload_user_dir_locked();
    }

    /// Remove one user manifest from the live snapshot after its local file is
    /// deleted, restoring a same-id builtin override when present.
    /// (ADR-002 substrate § provider v67)
    pub fn remove_user_provider(&self, id: &str) {
        let removed = {
            let mut providers = self.providers.write().unwrap();
            if providers
                .get(id)
                .is_some_and(|loaded| loaded.source == ProviderSource::User)
            {
                providers.remove(id);
                true
            } else {
                false
            }
        };
        if !removed {
            return;
        }
        if let Some((_, src)) = BUILTIN_MANIFESTS.iter().find(|(builtin_id, _)| *builtin_id == id) {
            match parse_str(src, &format!("builtin/{id}.toml")) {
                Ok(manifest) => self.install_manifest(manifest, ProviderSource::Builtin),
                Err(e) => tracing::warn!(
                    provider = %id,
                    error = %e,
                    "provider: builtin restore failed after user removal"
                ),
            }
        }
    }

    /// Get the full parsed manifest for a provider id. Used by
    /// http_endpoint::run_get_active_provider_details to hand
    /// ctrl-pi-bridge the wire-shape + auth + models needed to
    /// `pi.registerProvider`. bao 2026-06-05 b.
    pub fn manifest_for(&self, id: &str) -> Option<Arc<super::manifest::ProviderManifest>> {
        let providers = self.providers.read().unwrap();
        providers.get(id).map(|lp| lp.manifest.clone())
    }

    pub fn snapshot(&self, id: &str) -> Option<ProviderSnapshot> {
        // Snapshot reports configuration only; runtime and verification live on
        // their authoritative surfaces. (ADR-002 substrate § provider v71)
        let providers = self.providers.read().unwrap();
        let loaded = providers.get(id)?;
        let m = &loaded.manifest;
        let managed_by = if CTRL_MANAGED_PROVIDER_IDS.contains(&m.id.as_str()) {
            ProviderManagedBy::Ctrl
        } else {
            ProviderManagedBy::User
        };
        Some(ProviderSnapshot {
            id: m.id.clone(),
            label: m.label.clone(),
            kind: m.kind.clone(),
            endpoint: m.endpoint.clone(),
            binary: m.binary.clone(),
            // Adapter construction is configuration, not readiness.
            // (ADR-002 substrate § provider v71)
            configured: loaded.provider.is_some(),
            managed_by,
        })
    }

    /// Per-role active map (for Settings UI badges + brain_status).
    /// Keys are canonical role ids ("irisy.primary" / "irisy.fallback").
    pub fn active_state(&self) -> BTreeMap<String, String> {
        let active = self.active.read().unwrap();
        active
            .iter()
            .map(|(c, id)| (c.id(), id.clone()))
            .collect()
    }

    /// Whether persisted trial evidence still matches the provider's current
    /// behavior manifest and resolved credential. No role inference is used.
    /// (ADR-002 substrate § provider v71)
    pub fn is_verified(&self, provider_id: &str) -> bool {
        let Some(current) = self.current_verification_fingerprint(provider_id) else {
            return false;
        };
        self.verifications
            .read()
            .unwrap()
            .get(provider_id)
            .is_some_and(|evidence| evidence.fingerprint == current)
    }

    /// Record evidence for the exact currently loaded provider after an
    /// independently completed production trial, then persist state v4.
    /// (ADR-002 substrate § provider v71)
    pub fn record_current_verification(&self, provider_id: &str) -> Result<(), ProviderError> {
        let fingerprint = self
            .current_verification_fingerprint(provider_id)
            .ok_or_else(|| ProviderError::ProviderError(format!(
                "provider {provider_id} is not configured"
            )))?;
        self.verifications.write().unwrap().insert(
            provider_id.to_string(),
            VerificationEvidence { fingerprint },
        );
        self.persist_active_state();
        Ok(())
    }

    /// Record evidence only when the currently loaded configuration still
    /// matches the fingerprint that completed the production trial.
    /// (ADR-002 substrate § provider v71)
    pub fn record_verification_if_current(
        &self,
        provider_id: &str,
        expected_fingerprint: &str,
    ) -> Result<(), ProviderError> {
        let current = self
            .current_verification_fingerprint(provider_id)
            .ok_or_else(|| ProviderError::ProviderError(format!(
                "provider {provider_id} is not configured"
            )))?;
        if current != expected_fingerprint {
            return Err(ProviderError::ProviderError(format!(
                "provider {provider_id} configuration changed during verification"
            )));
        }
        self.verifications.write().unwrap().insert(
            provider_id.to_string(),
            VerificationEvidence {
                fingerprint: current,
            },
        );
        self.persist_active_state();
        Ok(())
    }

    /// Remove stale evidence when a provider definition is deleted. Clearing a
    /// role deliberately does not call this method.
    /// (ADR-002 substrate § provider v71)
    pub fn clear_verification(&self, provider_id: &str) -> bool {
        let removed = self
            .verifications
            .write()
            .unwrap()
            .remove(provider_id)
            .is_some();
        if removed {
            self.persist_active_state();
        }
        removed
    }

    fn current_verification_fingerprint(&self, provider_id: &str) -> Option<String> {
        let manifest = self.manifest_for(provider_id)?;
        let credential = resolve_auth(&manifest).ok()?;
        Some(verification_fingerprint(&manifest, &credential))
    }

    /// Resolve only the active HTTP provider environment for a release probe.
    /// This reuses the production credential and provider-shape resolution, but
    /// deliberately skips Hermes config projection and optional web credentials:
    /// the values exist only in the exact probe subprocess environment.
    /// (ADR-002 substrate § provider v68)
    pub fn agent_probe_env(&self) -> BTreeMap<String, String> {
        self.active_http_agent_env(false)
    }

    /// Unified provider injection. Configure once in CTRL and every Irisy
    /// launch uses the same active BYOK provider.
    /// (ADR-002 substrate § provider v68)
    pub async fn agent_env_injection(&self) -> BTreeMap<String, String> {
        // Launch-time environment and durable Hermes projection must observe one
        // verified provider generation. (ADR-002 substrate § provider v71)
        let _mutation_guard = self.lock_mutation().await;
        let mut env = self.active_http_agent_env(true);

        // Hermes's built-in web tools use the independently configured Tavily
        // credential. Release probes intentionally exclude it because they only
        // prove the active LLM provider contract.
        if let Some(key) = read_credential("tavily") {
            if !key.is_empty() {
                env.insert("TAVILY_API_KEY".into(), key);
            }
        }

        let has_verified_http_primary = env.contains_key("HERMES_INFERENCE_PROVIDER");
        if !has_verified_http_primary {
            if let Err(error) = crate::commands::agents::clear_hermes_provider_projection() {
                tracing::warn!(%error, "failed to clear stale Hermes provider projection");
            }
        }
        if let Err(error) = crate::commands::agents::write_hermes_dotenv(&env) {
            tracing::warn!(%error, "failed to synchronize Hermes environment");
        }
        if let Err(error) = crate::commands::agents::write_hermes_web_belt() {
            tracing::warn!(%error, "failed to synchronize Hermes web backend");
        }
        env
    }

    fn active_http_agent_env(&self, project_hermes_config: bool) -> BTreeMap<String, String> {
        let mut env = BTreeMap::new();
        // Resolve the same active binding and encrypted-vault credential used by
        // production, without creating a second provider truth.
        // (ADR-002 substrate § provider v68)
        let id = {
            let active = self.active.read().unwrap();
            match active.get(&Consumer::IrisyPrimary) {
                Some(id) => id.clone(),
                None => return env,
            }
        };
        // Bundled Hermes may receive only the same explicitly verified primary
        // admitted by the shared production router. (ADR-002 substrate § provider v71)
        if !self.is_verified(&id) {
            return env;
        }
        let providers = self.providers.read().unwrap();
        let Some(loaded) = providers.get(&id) else {
            return env;
        };
        let m = &loaded.manifest;
        if m.kind != ProviderKind::HttpApi {
            return env;
        }
        let key = match resolve_auth(m) {
            Ok(k) if !k.is_empty() => k,
            _ => return env,
        };

        // Shape the exact provider wire contract for the Hermes subprocess.
        // (ADR-002 substrate § provider v68)
        match m.shape {
            HttpShape::AnthropicMessages => {
                env.insert("HERMES_INFERENCE_PROVIDER".into(), "anthropic".into());
                env.insert("ANTHROPIC_API_KEY".into(), key.clone());
                if let Some(ep) = &m.endpoint {
                    env.insert("ANTHROPIC_BASE_URL".into(), ep.clone());
                }
            }
            HttpShape::OpenaiChatCompletions => {
                let is_openrouter = m.id == "openrouter";
                env.insert(
                    "HERMES_INFERENCE_PROVIDER".into(),
                    if is_openrouter { "openrouter" } else { "custom" }.into(),
                );
                env.insert(
                    if is_openrouter {
                        "OPENROUTER_API_KEY"
                    } else {
                        "OPENAI_API_KEY"
                    }
                    .into(),
                    key.clone(),
                );
                if let Some(ep) = &m.endpoint {
                    if !ep.is_empty() {
                        if is_openrouter {
                            env.insert("OPENROUTER_BASE_URL".into(), ep.clone());
                        } else {
                            // Hermes 0.18 uses CUSTOM_BASE_URL for custom
                            // endpoints; OPENAI_BASE_URL remains compatible
                            // with production launchers and newer runtimes.
                            // (ADR-002 substrate § provider v68)
                            env.insert("OPENAI_BASE_URL".into(), ep.clone());
                            env.insert("CUSTOM_BASE_URL".into(), ep.clone());
                            if let Some(vendor_key_env) = hermes_custom_key_env(ep) {
                                env.insert(vendor_key_env, key.clone());
                            }
                        }
                    }
                }
            }
        }
        if let Some(model) = m.models.first().filter(|model| !model.is_empty()) {
            env.insert("HERMES_MODEL".into(), model.clone());
        }

        // Durable Hermes projection remains a production-launch behavior only;
        // the release probe passes false and keeps the key process-scoped.
        // (ADR-002 substrate § provider v68)
        if project_hermes_config {
            let _ = crate::commands::agents::write_hermes_config_yaml(m, &key);
        }
        env
    }

    /// Resolve the BYOK credential a right-region BYO engine should reuse, so
    /// installing Codex / Claude Code does NOT make the user sign in again
    /// (ADR-005 §8.8 — close the auth loop with the key CTRL already holds).
    ///
    /// Unlike `agent_env_injection` (which mirrors the ACTIVE Irisy provider),
    /// this is engine-specific and pins the CANONICAL provider so we never
    /// misroute a coding CLI onto an OpenAI-compatible-but-not-OpenAI endpoint
    /// (e.g. pointing Codex at doubao): codex → the `openai` provider's key;
    /// claude-code → the `anthropic` provider's key. Returns empty when that
    /// provider isn't configured — the engine then falls back to its own login,
    /// never a wrong key. The key rides into the adapter SUBPROCESS env only
    /// (acp_client spawn); it never reaches Irisy's prompt or the PWA
    /// (ADR-006 byok-no-claude — the user's own CLI, their own BYOK key).
    pub fn byo_engine_auth_env(&self, engine: &str) -> BTreeMap<String, String> {
        let mut env = BTreeMap::new();
        let canonical_id = match engine {
            "codex" => "openai",
            "claude-code" => "anthropic",
            _ => return env,
        };
        let providers = self.providers.read().unwrap();
        let Some(loaded) = providers.get(canonical_id) else {
            return env;
        };
        let m = &loaded.manifest;
        if m.kind != ProviderKind::HttpApi {
            return env;
        }
        let key = match resolve_auth(m) {
            Ok(k) if !k.is_empty() => k,
            _ => return env,
        };
        let (key_var, url_var) = match engine {
            "codex" => ("OPENAI_API_KEY", "OPENAI_BASE_URL"),
            _ => ("ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"),
        };
        env.insert(key_var.to_string(), key);
        if let Some(ep) = &m.endpoint {
            if !ep.is_empty() {
                env.insert(url_var.to_string(), ep.clone());
            }
        }
        env
    }

    /// Build the exact verified explicit resolution chain for one consumer. No
    /// provider id is synthesized: catalogue presence, configuration, runtime
    /// availability, and unverified legacy bindings never create candidates.
    /// Primary requests may use the separately bound verified fallback; the
    /// fallback role itself never recurses.
    /// (ADR-002 substrate § provider v71)
    pub fn route_chain(&self, consumer: &Consumer) -> RouteChain {
        let active = self.active.read().unwrap().clone();
        let primary = active
            .get(consumer)
            .filter(|provider_id| self.is_verified(provider_id))
            .cloned();
        let fallbacks = if matches!(consumer, Consumer::IrisyFallback) {
            Vec::new()
        } else {
            active
                .get(&Consumer::IrisyFallback)
                .filter(|fallback_id| primary.as_ref() != Some(*fallback_id))
                .filter(|fallback_id| self.is_verified(fallback_id))
                .cloned()
                .into_iter()
                .collect()
        };
        RouteChain { primary, fallbacks }
    }

    /// Set + persist the active provider for a consumer role, after a
    /// successful 1-token trial chat. Returns the trial chat reply
    /// text so the UI can display the verification proof. ADR-002
    /// substrate § provider v2 lock #4: trial verify is mandatory before
    /// commit; failure keeps the previous role binding intact.
    pub async fn set_active(
        &self,
        provider_id: &str,
        consumer: Consumer,
    ) -> Result<String, ProviderError> {
        // Keep manifest/credential mutation out of the entire trial-to-commit
        // transaction. (ADR-002 substrate § provider v71)
        let _mutation_guard = self.lock_mutation().await;
        let provider = self
            .get(provider_id)
            .ok_or_else(|| ProviderError::ProviderNotFound(provider_id.to_string()))?;
        // Evidence may only describe the exact configuration exercised by the
        // production trial. Capture it before awaiting and require it to remain
        // unchanged through commit. (ADR-002 substrate § provider v71)
        let fingerprint_before = self
            .current_verification_fingerprint(provider_id)
            .ok_or_else(|| ProviderError::ProviderError(format!(
                "provider {provider_id} is not configured"
            )))?;
        // Both Irisy roles serve text.chat; verification and binding use the
        // same provider contract. (ADR-002 substrate § provider v71)
        let needs_text_chat = matches!(
            consumer,
            Consumer::IrisyPrimary | Consumer::IrisyFallback
        );
        if needs_text_chat && !provider.capabilities().contains(&Capability::TextChat) {
            return Err(ProviderError::ProviderError(format!(
                "provider {provider_id} does not advertise text.chat for role {}",
                consumer.id()
            )));
        }
        // The production-adapter trial must produce visible output within one
        // absolute setup-to-stream budget before the binding can commit. A
        // compatible adapter may disable hidden reasoning for this trial only.
        // (ADR-002 substrate § provider v69)
        let reply = trial_chat(provider.as_ref()).await?;
        // Reject a successful reply if the loaded manifest or credential changed
        // while the trial was in flight. (ADR-002 substrate § provider v71)
        let fingerprint_after = self
            .current_verification_fingerprint(provider_id)
            .ok_or_else(|| ProviderError::ProviderError(format!(
                "provider {provider_id} configuration changed during verification"
            )))?;
        if fingerprint_after != fingerprint_before {
            return Err(ProviderError::ProviderError(format!(
                "provider {provider_id} configuration changed during verification"
            )));
        }
        // Record exact verification evidence separately from the selected role so
        // routing admits only the configuration that passed this production trial.
        // (ADR-002 substrate § provider v71)
        {
            self.verifications.write().unwrap().insert(
                provider_id.to_string(),
                VerificationEvidence {
                    fingerprint: fingerprint_before,
                },
            );
            let mut active = self.active.write().unwrap();
            active.insert(consumer.clone(), provider_id.to_string());
        }
        // bao 2026-06-04: trial success ⇒ provider is healthy NOW. If a
        // prior turn marked it failed (cooldown still active for up to
        // PROVIDER_COOLDOWN_SECS), the next /text-chat would still skip
        // it. Clearing here lets a manual re-pick from Settings →
        // Providers immediately reactivate a previously-cooled-down
        // provider without waiting out the 5 min window.
        self.clear_failure(provider_id);
        self.persist_active_state();
        tracing::info!(
            provider = %provider_id,
            role = %consumer.id(),
            "provider: set_active committed after trial chat"
        );
        Ok(reply)
    }

    /// Install (or replace) one manifest. Resolves credentials, builds
    /// the matching adapter, stores both the live provider and the
    /// manifest itself for the Settings UI. This does not bind or verify it.
    /// (ADR-002 substrate § provider v71)
    fn install_manifest(&self, manifest: ProviderManifest, source: ProviderSource) {
        let id = manifest.id.clone();
        let arc = Arc::new(manifest);
        let (provider, load_error) = match instantiate(arc.clone()) {
            Ok(p) => (Some(p), None),
            Err(e) => {
                tracing::debug!(provider = %id, error = %e, "provider: manifest loaded but adapter not ready (credentials?)");
                (None, Some(e.to_string()))
            }
        };
        let mut providers = self.providers.write().unwrap();
        providers.insert(
            id,
            LoadedProvider {
                manifest: arc,
                provider,
                load_error,
                source,
            },
        );
    }

    /// Persist explicit role intent and matching production-trial evidence in
    /// the version-4 active-provider envelope.
    /// (ADR-002 substrate § provider v71)
    fn persist_active_state(&self) {
        let Some(path) = self.active_state_path.as_ref() else {
            return;
        };
        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                tracing::warn!(?parent, error = %e, "provider: mkdir active-state failed");
                return;
            }
        }
        let roles = self.active_state();
        // Persist evidence beside, but never derive it from, role intent.
        // (ADR-002 substrate § provider v71)
        let verifications = self.verifications.read().unwrap().clone();
        let envelope = ActiveStateV4 {
            version: 4,
            roles,
            verifications,
        };
        match serde_json::to_vec_pretty(&envelope) {
            Ok(bytes) => {
                if let Err(e) = std::fs::write(path, bytes) {
                    tracing::warn!(?path, error = %e, "provider: write active-state failed");
                }
            }
            Err(e) => tracing::warn!(error = %e, "provider: serialize active-state failed"),
        }
    }

    /// Restore role intent and verification evidence across legacy schemas.
    /// v0/v2/v3 bindings migrate as unverified; pre-v3 automatic Ollama
    /// fallback is removed fail-closed. (ADR-002 substrate § provider v71)
    fn restore_active_state(&self) {
        let Some(path) = self.active_state_path.as_ref() else {
            return;
        };
        let raw = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => {
                if e.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!(?path, error = %e, "provider: read active-state failed");
                }
                return;
            }
        };

        // Legacy bindings remain user intent but gain no synthetic evidence.
        // (ADR-002 substrate § provider v71)
        let mut roles: BTreeMap<String, String> = BTreeMap::new();
        let mut verifications: BTreeMap<String, VerificationEvidence> = BTreeMap::new();
        let mut migrated_from: Option<&'static str> = None;
        // Try the legacy flat shape first because ActiveStateV4 deliberately
        // defaults missing fields and would otherwise accept it as an empty
        // envelope. (ADR-002 substrate § provider v71)
        if let Ok(flat) = serde_json::from_str::<BTreeMap<String, String>>(&raw) {
            if let Some(primary_id) = flat.get("text.chat") {
                roles.insert(Consumer::IrisyPrimary.id(), primary_id.clone());
                migrated_from = Some("v0 single text.chat bucket");
            } else {
                tracing::warn!(
                    ?path,
                    "provider: active-state file is flat map but lacks text.chat key — skipping"
                );
                return;
            }
        } else if let Ok(envelope) = serde_json::from_str::<ActiveStateV4>(&raw) {
            // Only a genuine versioned envelope may restore verification evidence.
            // (ADR-002 substrate § provider v71)
            let version = envelope.version;
            roles = envelope.roles;
            if version >= 4 {
                verifications = envelope.verifications;
            } else {
                migrated_from = Some("legacy role envelope");
            }
            if roles.remove("mcp.default").is_some() {
                migrated_from = Some("legacy role envelope");
            }
            // Pre-v3 Ollama fallback was automatic, not explicit user intent.
            // (ADR-002 substrate § provider v71)
            if version < 3
                && roles.get("irisy.fallback").map(String::as_str) == Some("ollama")
            {
                roles.remove("irisy.fallback");
                migrated_from = Some("legacy automatic Ollama fallback");
            }
        } else {
            tracing::warn!(?path, "provider: parse active-state failed — skipping");
            return;
        }

        {
            // Restore intent and evidence independently.
            // (ADR-002 substrate § provider v71)
            let mut active = self.active.write().unwrap();
            for (role_id, provider_id) in &roles {
                active.insert(Consumer::from_id(role_id), provider_id.clone());
            }
        }
        *self.verifications.write().unwrap() = verifications;
        if let Some(from) = migrated_from {
            tracing::info!(
                ?path,
                from = %from,
                "provider: active-state migrated to verification-evidence v4 schema"
            );
            self.persist_active_state();
        }
    }
}

/// Versioned on-disk role intent and verification evidence.
/// (ADR-002 substrate § provider v71)
#[derive(Debug, Serialize, Deserialize)]
struct ActiveStateV4 {
    #[serde(default)]
    version: u8,
    #[serde(default)]
    roles: BTreeMap<String, String>,
    #[serde(default)]
    verifications: BTreeMap<String, VerificationEvidence>,
}

/// Hash only behavior-relevant manifest fields plus the resolved credential.
/// Serialization is deterministic because all maps are BTreeMap. The raw
/// credential never leaves this function. (ADR-002 substrate § provider v71)
fn verification_fingerprint(manifest: &ProviderManifest, credential: &str) -> String {
    let behavior = serde_json::json!({
        "id": manifest.id,
        "kind": manifest.kind,
        "shape": manifest.shape,
        "auth": manifest.auth,
        "binary": manifest.binary,
        "args_template": manifest.args_template,
        "env_strip": manifest.env_strip,
        "env_inject": manifest.env_inject,
        "endpoint": manifest.endpoint,
        "headers": manifest.headers,
        "capabilities": manifest.capabilities,
        "models": manifest.models,
        "config": manifest.config,
        "credential": credential,
    });
    let bytes = serde_json::to_vec(&behavior).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Verify an edited active-provider candidate without replacing the live
/// registry entry. The secret exists only in this temporary in-memory manifest;
/// persistence happens after the locked real-roundtrip gate succeeds.
/// (ADR-002 substrate § provider v2 lock #4)
pub(crate) async fn trial_manifest_with_secret(
    mut manifest: ProviderManifest,
    secret: String,
) -> Result<(String, String), ProviderError> {
    // Fingerprint the persisted candidate shape before replacing its auth source
    // with the temporary in-memory trial secret. (ADR-002 substrate § provider v71)
    let expected_fingerprint = verification_fingerprint(&manifest, &secret);
    const TRIAL_SECRET_FIELD: &str = "trial_api_key";
    manifest
        .config
        .insert(TRIAL_SECRET_FIELD.to_string(), secret);
    manifest.auth = AuthSource::ConfigKey {
        field: TRIAL_SECRET_FIELD.to_string(),
    };
    let provider = instantiate(Arc::new(manifest))?;
    let reply = trial_chat(provider.as_ref()).await?;
    Ok((reply, expected_fingerprint))
}

/// Construct the adapter for a manifest. Looks up credentials per
/// `AuthSource`. Returns Err with a typed `ProviderError::NotConfigured`
/// when the manifest is well-formed but credentials are absent — the
/// registry keeps the manifest entry so the Settings UI can prompt the
/// user to fill in a key.
fn instantiate(manifest: Arc<ProviderManifest>) -> Result<ProviderHandle, ProviderError> {
    let auth_secret = resolve_auth(&manifest)?;
    match manifest.kind {
        ProviderKind::HttpApi => {
            let provider = HttpApiProvider::from_manifest(manifest, auth_secret)?;
            Ok(Arc::new(provider))
        }
        ProviderKind::CliOneShot => {
            let provider = OneShotCliProvider::from_manifest(manifest, auth_secret)?;
            Ok(Arc::new(provider))
        }
        // CliClaudePersistent arm removed — ADR-002 substrate § provider
        // v47 (2026-07-11): Claude subscription OAuth is not a provider.
        // ADR-002 substrate § provider v2 §3.2 — verbatim VMark REST kinds.
        ProviderKind::RestAnthropic => {
            let provider = RestAnthropicProvider::from_manifest(manifest, auth_secret)?;
            Ok(Arc::new(provider))
        }
        ProviderKind::RestOpenai => {
            let provider = RestOpenaiProvider::from_manifest(manifest, auth_secret)?;
            Ok(Arc::new(provider))
        }
        ProviderKind::RestGoogle => {
            let provider = RestGoogleProvider::from_manifest(manifest, auth_secret)?;
            Ok(Arc::new(provider))
        }
        ProviderKind::RestOllama => {
            // Ollama needs no credential; `resolve_auth` returns "" for
            // AuthSource::None, which we discard here.
            let _ = auth_secret;
            let provider = RestOllamaProvider::from_manifest(manifest)?;
            Ok(Arc::new(provider))
        }
    }
}

// Hermes 0.18 accepts custom endpoint secrets only through a host-derived
// `<VENDOR>_API_KEY`; mirror its resolver so the secret remains process-scoped
// instead of requiring a persisted Hermes config file.
// (ADR-002 substrate § provider v68)
fn hermes_custom_key_env(endpoint: &str) -> Option<String> {
    let host = reqwest::Url::parse(endpoint)
        .ok()?
        .host_str()?
        .to_ascii_lowercase();
    let mut labels: Vec<&str> = host.split('.').filter(|label| !label.is_empty()).collect();
    if host == "localhost"
        || host.contains(':')
        || labels.last()?.chars().any(|ch| ch.is_ascii_digit())
    {
        return None;
    }
    while matches!(labels.first(), Some(&"api" | &"www")) {
        labels.remove(0);
    }
    if labels.len() < 2 {
        return None;
    }
    let vendor = labels[labels.len() - 2];
    let sanitized: String = vendor
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect();
    if !sanitized.starts_with(|ch: char| ch.is_ascii_alphabetic())
        || matches!(sanitized.as_str(), "OPENAI" | "OPENROUTER" | "OLLAMA")
    {
        return None;
    }
    Some(format!("{sanitized}_API_KEY"))
}

fn resolve_auth(manifest: &ProviderManifest) -> Result<String, ProviderError> {
    match &manifest.auth {
        AuthSource::None => Ok(String::new()),
        AuthSource::Env { var } => std::env::var(var).map_err(|_| {
            ProviderError::NotConfigured(format!(
                "{}: env {var} not set",
                manifest.id
            ))
        }),
        AuthSource::ConfigKey { field } => manifest
            .config
            .get(field)
            .cloned()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| {
                ProviderError::NotConfigured(format!(
                    "{}: config.{field} not set",
                    manifest.id
                ))
            }),
        AuthSource::Keychain { account } => {
            keychain_read_with_aliases(account, &legacy_account_aliases(account)).ok_or_else(|| {
                ProviderError::NotConfigured(format!(
                    "{}: keychain account {account:?} not set",
                    manifest.id
                ))
            })
        }
    }
}

/// Backwards-compatible aliases for legacy keychain accounts the old
/// `setup_llm_key` binary used. Lets a user who set up "ark" / "doubao"
/// before the rename keep working without re-running setup.
fn legacy_account_aliases(account: &str) -> Vec<&'static str> {
    match account {
        "volc" => vec!["volc", "ark", "doubao"],
        "openai" => vec!["openai", "gpt"],
        "anthropic" => vec!["anthropic", "claude"],
        "gemini" => vec!["gemini", "google"],
        _ => Vec::new(),
    }
}

fn keychain_read_with_aliases(primary: &str, aliases: &[&str]) -> Option<String> {
    // bao 2026-06-06 e fix: shell out to `security` CLI here too. The
    // keyring crate apple-native path returns no entry from signed
    // CTRL.app even when the entry physically exists (verified via
    // standalone unsigned probe + via `security find-generic-password`).
    // Adapter construction silently failed for every user-added
    // provider because credential resolution always returned None.
    // bao 2026-06-06: read from encrypted file vault. Iterate the
    // primary slug + any aliases. The vault is account-keyed only
    // (no service namespace), so the two-loop over keychain services
    // collapses into a single account lookup.
    let candidates: Vec<&str> = std::iter::once(primary).chain(aliases.iter().copied()).collect();
    for account in &candidates {
        if let Ok(Some(secret)) = crate::shell::credential_vault::get(account) {
            if !secret.is_empty() {
                return Some(secret);
            }
        }
    }
    None
}

/// Single entry point for reading a provider credential by account slug.
/// ADR-002 substrate § provider v2 (2026-06-25 store-unification fix):
/// every credential read MUST go through the encrypted file vault
/// (`credential_vault`), never the OS keyring directly — the keyring
/// apple-native path returns no entry from the signed CTRL.app even when
/// the secret physically exists (bao 2026-06-06). Three call sites
/// (provider_models catalog / provider hermes-sync / detect first-boot)
/// read the keyring directly and silently saw no key; they now route
/// here so a user who stored a key actually gets it back.
pub(crate) fn read_credential(account: &str) -> Option<String> {
    keychain_read_with_aliases(account, &legacy_account_aliases(account))
}

/// Scan `~/.ctrl/providers/*.toml`. One bad file is logged + skipped;
/// good files override builtins with matching `id`.
fn load_user_manifests(dir: &Path, registry: &ProviderRegistry) {
    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) => {
            tracing::warn!(?dir, error = %e, "provider: read user manifests dir failed");
            return;
        }
    };
    let mut count = 0usize;
    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("toml") {
            continue;
        }
        match parse_file(&path) {
            Ok(manifest) => {
                registry.install_manifest(manifest, ProviderSource::User);
                count += 1;
            }
            Err(e) => tracing::warn!(?path, error = %e, "provider: user manifest parse failed"),
        }
    }
    if count > 0 {
        tracing::info!(count, ?dir, "provider: user manifests loaded");
    }
}

// ── Legacy ~/.ctrl/config.toml bridge ───────────────────────────────────

#[derive(Debug, Default, Deserialize)]
struct LegacyConfig {
    #[serde(default)]
    providers: LegacyProviders,
}

#[derive(Debug, Default, Deserialize)]
struct LegacyProviders {
    #[serde(default)]
    volc: Option<LegacyEntry>,
    #[serde(default)]
    openai: Option<LegacyEntry>,
    #[serde(default)]
    anthropic: Option<LegacyEntry>,
    #[serde(default)]
    deepseek: Option<LegacyEntry>,
    #[serde(default)]
    minimax: Option<LegacyEntry>,
    #[serde(default)]
    gemini: Option<LegacyEntry>,
    #[serde(default)]
    groq: Option<LegacyEntry>,
    // claude_cli / claude-code field removed per ADR-002 substrate § provider v61 (2026-07-11)
    // — a stale key in an old config.toml is silently ignored at parse time.
    #[serde(default)]
    ollama: Option<LegacyEntry>,
    #[serde(default, alias = "kimi-anthropic")]
    kimi: Option<LegacyEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct LegacyEntry {
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    default_model: String,
}

impl LegacyEntry {
    fn has_key(&self) -> bool {
        !self.api_key.trim().is_empty()
    }
}

fn load_legacy_config(path: &Path) -> Option<LegacyConfig> {
    let raw = std::fs::read_to_string(path).ok()?;
    match toml::from_str(&raw) {
        Ok(v) => Some(v),
        Err(e) => {
            tracing::warn!(?path, error = %e, "provider: legacy config.toml parse failed");
            None
        }
    }
}

/// Merge legacy `[providers.*]` credentials into the registry. We DON'T
/// build new manifests from the legacy file — the builtin presets cover
/// the same provider ids; instead we override endpoint/model on the
/// matching builtin manifest + re-instantiate so the adapter picks up
/// the user's api_key without them needing to author a new TOML.
fn apply_legacy_config(registry: &ProviderRegistry, legacy: &LegacyConfig) {
    let mappings: &[(&str, Option<&LegacyEntry>)] = &[
        ("volc", legacy.providers.volc.as_ref()),
        ("openai-api", legacy.providers.openai.as_ref()),
        ("anthropic-api", legacy.providers.anthropic.as_ref()),
        ("deepseek", legacy.providers.deepseek.as_ref()),
        ("kimi", legacy.providers.kimi.as_ref()),
        // ("claude-oauth", claude_cli) bridge removed — ADR-002
        // substrate § provider v61 (2026-07-11).
    ];
    for (manifest_id, legacy_entry) in mappings {
        let Some(entry) = legacy_entry else { continue };
        if !entry.has_key() {
            continue;
        }
        let mut providers = registry.providers.write().unwrap();
        let Some(loaded) = providers.get_mut(*manifest_id) else { continue };
        let mut next_manifest = (*loaded.manifest).clone();
        if !entry.base_url.trim().is_empty() {
            next_manifest.endpoint = Some(entry.base_url.trim_end_matches('/').to_string());
        }
        if !entry.default_model.trim().is_empty() {
            // Make this the front model so it becomes the default.
            next_manifest.models.retain(|m| m != &entry.default_model);
            next_manifest.models.insert(0, entry.default_model.clone());
        }
        // For HTTP providers, stash the api_key in config + flip auth to
        // ConfigKey — registry's `resolve_auth` will then surface it.
        if matches!(next_manifest.kind, ProviderKind::HttpApi) && entry.has_key() {
            next_manifest.config.insert("api_key".to_string(), entry.api_key.clone());
            next_manifest.auth = AuthSource::ConfigKey {
                field: "api_key".to_string(),
            };
        }
        let next_arc = Arc::new(next_manifest);
        let (provider, load_error) = match instantiate(next_arc.clone()) {
            Ok(p) => (Some(p), None),
            Err(e) => {
                tracing::debug!(provider = %manifest_id, error = %e, "provider: legacy bridge re-instantiate failed");
                (None, Some(e.to_string()))
            }
        };
        loaded.manifest = next_arc;
        loaded.provider = provider;
        loaded.load_error = load_error;
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderListEntry {
    pub id: String,
    pub label: String,
    pub kind: ProviderKind,
    /// Authoritative HTTP wire shape used when the PWA edits a manifest that
    /// is absent from the current catalogue. (ADR-002 substrate § provider v67)
    pub shape: HttpShape,
    /// HTTP endpoint URL (when `kind = HttpApi`). Surfaces the manifest
    /// `endpoint` so the PWA Edit modal can prefill the Base URL field
    /// — bao 2026-06-06: previously empty in Edit, forcing user to
    /// remember + retype, broken UX.
    pub endpoint: Option<String>,
    pub models: Vec<String>,
    pub description: String,
    /// Configuration can construct the adapter; it does not imply that a
    /// runtime or endpoint is currently reachable.
    pub configured: bool,
    pub runtime_status: ProviderRuntimeStatus,
    pub runtime_detail: Option<String>,
    /// True only when persisted production-trial evidence matches the current
    /// behavior manifest and resolved credential.
    pub verified: bool,
    pub active_roles: Vec<String>,
    pub load_error: Option<String>,
    /// Where the manifest came from — drives Settings UI grouping
    /// (Available [system] vs. Your providers [user-added]).
    /// bao 2026-06-06.
    pub source: ProviderSource,
    pub capabilities: Vec<String>,
}

// Re-export the inner ManifestError type for the rest of the kernel.

/// Current Unix millis. Used as `RecordedFailover::at_unix_ms`. Returns
/// 0 if the system clock is somehow before Unix epoch (won't happen on
/// any supported target but the unwrap-free path keeps the code total).
fn now_unix_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_account_aliases_covers_renamed_accounts() {
        assert!(legacy_account_aliases("volc").contains(&"ark"));
        assert!(legacy_account_aliases("openai").contains(&"gpt"));
        assert!(legacy_account_aliases("anthropic").contains(&"claude"));
        assert!(legacy_account_aliases("nope").is_empty());
    }

    #[test]
    fn builtin_manifests_all_parse() {
        for (id, src) in BUILTIN_MANIFESTS {
            let m = parse_str(src, &format!("builtin/{id}.toml"))
                .unwrap_or_else(|e| panic!("builtin {id} parse failed: {e}"));
            assert_eq!(&m.id, id);
        }
    }

    // SC6 — failover + cooldown state machine, exercised in isolation from
    // manifest loading / FS. ADR-002 substrate § provider v2 §3.5 (M2
    // amendment 2026-06-04): mark_failure opens a cooldown window so the
    // router skips a known-bad primary; record_failover keeps last-wins.
    fn empty_registry() -> ProviderRegistry {
        ProviderRegistry {
            providers: RwLock::new(BTreeMap::new()),
            active: RwLock::new(BTreeMap::new()),
            verifications: RwLock::new(BTreeMap::new()),
            mutation_lock: Mutex::new(()),
            active_state_path: None,
            last_failover: RwLock::new(None),
            routing_override: RwLock::new(None),
            provider_health: RwLock::new(BTreeMap::new()),
        }
    }

    // Role bindings remain the source of active-provider identity after
    // catalogue enrichment. (ADR-002 substrate § provider v67)
    #[test]
    fn active_provider_identity_tracks_role_bindings() {
        let reg = empty_registry();
        assert!(!reg.is_active_provider("openai"));
        reg.active
            .write()
            .unwrap()
            .insert(Consumer::IrisyPrimary, "openai".to_string());
        assert!(reg.is_active_provider("openai"));
        assert!(!reg.is_active_provider("anthropic"));
    }

    #[test]
    fn record_failover_keeps_fields_and_last_wins() {
        let reg = empty_registry();
        assert!(reg.last_failover_event().is_none());

        reg.record_failover("anthropic-api", "volc", "401 unauthorized");
        let ev = reg.last_failover_event().expect("event recorded");
        assert_eq!(ev.from, "anthropic-api");
        assert_eq!(ev.to, "volc");
        assert_eq!(ev.reason, "401 unauthorized");

        // Latest transition wins (no history kept).
        reg.record_failover("volc", "ollama", "rate limited");
        let ev2 = reg.last_failover_event().unwrap();
        assert_eq!(ev2.from, "volc");
        assert_eq!(ev2.to, "ollama");
    }

    #[test]
    fn route_chain_contains_only_verified_explicit_bindings() {
        // Catalogue presence and an unverified legacy binding both leave the
        // chain empty. (ADR-002 substrate § provider v71)
        let reg = empty_registry();
        let empty = reg.route_chain(&Consumer::IrisyPrimary);
        assert!(empty.primary.is_none());
        assert!(empty.fallbacks.is_empty());

        let primary = parse_str(BUILTIN_MANIFESTS[0].1, "primary.toml").unwrap();
        let mut fallback = primary.clone();
        fallback.id = "fallback".into();
        reg.install_manifest(primary, ProviderSource::Builtin);
        reg.install_manifest(fallback, ProviderSource::Builtin);
        {
            let mut active = reg.active.write().unwrap();
            active.insert(Consumer::IrisyPrimary, "ollama".into());
            active.insert(Consumer::IrisyFallback, "fallback".into());
        }
        assert!(reg.route_chain(&Consumer::IrisyPrimary).primary.is_none());

        reg.record_current_verification("ollama").unwrap();
        reg.record_current_verification("fallback").unwrap();
        let chain = reg.route_chain(&Consumer::IrisyPrimary);
        assert_eq!(chain.primary.as_deref(), Some("ollama"));
        assert_eq!(chain.fallbacks, vec!["fallback"]);
        assert!(reg.route_chain(&Consumer::IrisyFallback).fallbacks.is_empty());
    }

    #[test]
    fn v4_active_state_keeps_roles_and_evidence_independent() {
        let encoded = serde_json::to_string(&ActiveStateV4 {
            version: 4,
            roles: BTreeMap::from([("irisy.primary".into(), "configured".into())]),
            verifications: BTreeMap::from([(
                "configured".into(),
                VerificationEvidence {
                    fingerprint: "digest".into(),
                },
            )]),
        })
        .unwrap();
        let decoded: ActiveStateV4 = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded.version, 4);
        assert_eq!(decoded.roles.get("irisy.primary").map(String::as_str), Some("configured"));
        assert_eq!(
            decoded.verifications.get("configured").map(|e| e.fingerprint.as_str()),
            Some("digest")
        );

        let legacy: ActiveStateV4 = serde_json::from_str(
            r#"{"version":3,"roles":{"irisy.primary":"configured"}}"#,
        )
        .unwrap();
        assert_eq!(legacy.version, 3);
        assert!(legacy.verifications.is_empty());
    }

    #[test]
    fn legacy_state_migrates_bound_but_unverified_and_drops_pre_v3_ollama() {
        let root = std::env::temp_dir().join(format!(
            "ctrl-provider-state-v4-{}-{}",
            std::process::id(),
            now_unix_ms()
        ));
        std::fs::create_dir_all(&root).unwrap();

        let v0_path = root.join("v0.json");
        std::fs::write(&v0_path, r#"{"text.chat":"legacy-flat"}"#).unwrap();
        let mut v0 = empty_registry();
        v0.active_state_path = Some(v0_path.clone());
        v0.restore_active_state();
        assert_eq!(
            v0.active_state().get("irisy.primary").map(String::as_str),
            Some("legacy-flat")
        );
        assert!(!v0.is_verified("legacy-flat"));
        let persisted_v0: ActiveStateV4 =
            serde_json::from_str(&std::fs::read_to_string(&v0_path).unwrap()).unwrap();
        assert_eq!(persisted_v0.version, 4);
        assert_eq!(
            persisted_v0.roles.get("irisy.primary").map(String::as_str),
            Some("legacy-flat")
        );
        assert!(persisted_v0.verifications.is_empty());

        let v2_path = root.join("v2.json");
        std::fs::write(
            &v2_path,
            r#"{"version":2,"roles":{"irisy.primary":"legacy","irisy.fallback":"ollama"}}"#,
        )
        .unwrap();
        let mut v2 = empty_registry();
        v2.active_state_path = Some(v2_path.clone());
        v2.restore_active_state();
        assert_eq!(
            v2.active_state().get("irisy.primary").map(String::as_str),
            Some("legacy")
        );
        assert!(!v2.active_state().contains_key("irisy.fallback"));
        assert!(!v2.is_verified("legacy"));
        let persisted: ActiveStateV4 =
            serde_json::from_str(&std::fs::read_to_string(&v2_path).unwrap()).unwrap();
        assert_eq!(persisted.version, 4);
        assert!(persisted.verifications.is_empty());

        let v3_path = root.join("v3.json");
        std::fs::write(
            &v3_path,
            r#"{"version":3,"roles":{"irisy.primary":"legacy","irisy.fallback":"ollama"}}"#,
        )
        .unwrap();
        let mut v3 = empty_registry();
        v3.active_state_path = Some(v3_path);
        v3.restore_active_state();
        assert_eq!(
            v3.active_state().get("irisy.fallback").map(String::as_str),
            Some("ollama")
        );
        assert!(!v3.is_verified("ollama"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cooldown_marks_then_clears_and_unknown_is_never_cooling() {
        let reg = empty_registry();
        assert!(!reg.is_in_cooldown("anthropic-api"));

        reg.mark_failure("anthropic-api", "401 unauthorized");
        // Just-marked failure is within the cooldown window immediately.
        assert!(reg.is_in_cooldown("anthropic-api"));

        reg.clear_failure("anthropic-api");
        assert!(!reg.is_in_cooldown("anthropic-api"));

        // A provider that never failed is never in cooldown.
        assert!(!reg.is_in_cooldown("never-seen"));
    }
}
