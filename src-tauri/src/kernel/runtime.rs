// KernelRuntime — single composition root for L1 Kernel.
//
// Owned by lib.rs::run() at startup, injected into Tauri AppState so
// inbound commands can route to kernel services. Holds:
//   - Scheduler (actor lifecycle)
//   - EventBus (pub-sub routing)
//   - CapabilityBroker (capability check)
//   - McpHost (MCP server connections)
//   - EffectExecutor (effect dispatch)
//   - EventStore (SQLite event log)
//   - LlmPortRouter (LLM adapter fallback chain)
//
// P2.8 stage: structured composition, runtime ready to host the existing
// Tauri command path AND new kernel-driven actors. Full effect dispatch
// wiring (scheduler -> handler -> effect -> capability check) lands in P5.

use crate::kernel::capability::CapabilityBroker;
use crate::kernel::effect::EffectExecutor;
use crate::kernel::event::EventBus;
use crate::kernel::local_storage::{default_db_path as ls_default_db_path, LocalStorage};
use crate::kernel::mcp_host::McpHost;
use crate::kernel::persistence::EventStore;
use crate::kernel::provider::ProviderRegistry;
use crate::kernel::scheduler::Scheduler;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

pub struct KernelRuntime {
    pub scheduler: Arc<Scheduler>,
    pub event_bus: Arc<EventBus>,
    pub capability_broker: Arc<CapabilityBroker>,
    pub mcp_host: Arc<McpHost>,
    pub effect_executor: Arc<EffectExecutor>,
    pub event_store: Arc<EventStore>,
    /// Provider sub-system (ADR-002 substrate § provider v2). Backs `text.chat` for Pi (via
    /// the bridge HTTP endpoint), Irisy direct invokes, and mcp MCP
    /// `llm.chat` tool. Replaces the legacy `llm_port` router.
    pub provider_registry: Arc<ProviderRegistry>,
    /// Per-mcp persistent JSON KV opened against ls_default_db_path so the
    /// MCP server's kv.* tools share state with Tauri storage commands. None
    /// when HOME isn't resolvable (CI / sandboxed test runs).
    pub local_storage: Option<Arc<LocalStorage>>,
    /// Monotonic instant captured at boot — used by the kernel_status
    /// Tauri command to report uptime to the PWA status bar.
    pub booted_at: Instant,
    /// Human-approval gate for high-blast-radius calls (ADR-002 §264 +
    /// ADR-006 §4). Shared by the MCP gate (`call_tool`, awaits) and the
    /// Tauri approval commands (resolve) — same in-process Arc.
    pub review_gate: Arc<crate::kernel::review_gate::ReviewGate>,
    /// UI-session bridge (ADR-002 §1.9 v46 E2/E3): active-note state reported
    /// by the PWA + the open-note push channel the supervisor forwards to it.
    pub ui_bridge: Arc<crate::kernel::ui_bridge::UiBridge>,
}

impl KernelRuntime {
    /// Build the kernel runtime. `data_dir` is where the event store DB lives.
    pub fn boot(data_dir: PathBuf) -> Result<Self, KernelBootError> {
        let db_path = data_dir.join("event-store.db");

        // Ensure parent dir exists.
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                KernelBootError::DataDirCreateFailed(format!("{}: {}", parent.display(), e))
            })?;
        }

        let event_store =
            EventStore::open(&db_path).map_err(|e| KernelBootError::EventStoreOpenFailed(e.to_string()))?;

        // ADR-002 substrate § provider v2 provider sub-system. Loads 6 builtin presets
        // (claude-oauth / anthropic-api / openai-api / volc / kimi /
        // deepseek) + scans ~/.ctrl/providers/ for user-installed +
        // bridges legacy ~/.ctrl/config.toml so pre-PR users' keys
        // keep working.
        let provider_registry = Arc::new(ProviderRegistry::load());

        // NOTE: HTTP endpoint (Pi-facing /text-chat + /tool/<name>) was
        // previously spawned here. It now spawns from
        // `shell::kernel_supervisor::start` AFTER the `KernelHandle` is
        // available so the new `/tool/<name>` dispatcher (ADR-002 substrate
        // § brain v7 §1.1 + ADR-005 irisy v4 §7.5, 2026-06-04) can reuse
        // the same `KernelHandle` the Tauri commands hold — single SSOT
        // dispatch path, no shadow copy of `bridge` / `mcp_host`.

        let mcp_host = Arc::new(McpHost::new());
        // Hydrate the MCP server registry from disk so previously
        // installed Pattern D mcps re-register without the user
        // re-running the install wizard each launch. Connections lazy-
        // establish on first invoke; this only reloads descriptors.
        if let Some(reg_path) = McpHost::default_registry_path() {
            let host_clone = Arc::clone(&mcp_host);
            // KernelRuntime::boot is called from Tauri setup() which runs on the
            // main thread before tokio is fully wired. Guard tokio::spawn behind
            // an active-runtime check so boot doesn't panic when no runtime is
            // available; fall back to a blocking single-threaded mini-runtime so
            // the registry still hydrates synchronously on cold start. Fixes
            // 0.1.34 "won't open" — panic at runtime.rs:75:13 on Tauri setup path.
            if tokio::runtime::Handle::try_current().is_ok() {
                tokio::spawn(async move {
                    match host_clone.load_registry(&reg_path).await {
                        Ok(n) if n > 0 => tracing::info!(count = n, ?reg_path, "mcp_host: registry loaded"),
                        Ok(_) => tracing::debug!(?reg_path, "mcp_host: empty registry, fresh start"),
                        Err(e) => tracing::warn!(error = %e, ?reg_path, "mcp_host: registry load failed"),
                    }
                });
            } else {
                tracing::debug!("mcp_host: no tokio runtime in boot context, hydrating registry inline");
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build();
                match rt {
                    Ok(rt) => match rt.block_on(host_clone.load_registry(&reg_path)) {
                        Ok(n) if n > 0 => tracing::info!(count = n, ?reg_path, "mcp_host: registry loaded inline"),
                        Ok(_) => tracing::debug!(?reg_path, "mcp_host: empty registry, fresh start"),
                        Err(e) => tracing::warn!(error = %e, ?reg_path, "mcp_host: registry load failed"),
                    },
                    Err(e) => tracing::warn!(error = %e, "mcp_host: failed to build fallback runtime, skipping registry hydration"),
                }
            }
        }

        // Vault canonical layout (ADR-001 spine amendment 2026-05-25 invariant #2).
        // Migrates legacy ~/.ctrl/vault/ to ~/Documents/CTRL/ on first boot.
        // Best-effort — failure leaves vault dir uninit, vault.* commands
        // will surface a clean error and the PWA can prompt a wizard.
        if let Some(vault_root) = crate::kernel::vault::default_vault_root() {
            if let Err(e) = crate::kernel::vault::ensure_vault_layout(&vault_root) {
                tracing::warn!(error = %e, ?vault_root, "vault: ensure_layout failed");
            }
            // Spawn the daily sourcing tick (ADR-002 § vault v1 §8.4
            // cron trigger). Tokio runtime is already up at this point
            // because we're inside an async boot path. Best-effort —
            // panic in the spawn helper would not affect kernel boot.
            if tokio::runtime::Handle::try_current().is_ok() {
                crate::kernel::sourcing_scheduler::spawn(vault_root.clone());
            }
        }

        // LocalStorage: open the same SQLite path the Tauri commands/storage
        // module uses so kv.* MCP tools and storage_* invoke handlers share
        // one file. Best-effort — when HOME is absent (CI) the field stays
        // None and the kv.* MCP tools surface a clean error.
        let local_storage = ls_default_db_path()
            .and_then(|p| match LocalStorage::open(&p) {
                Ok(ls) => Some(Arc::new(ls)),
                Err(e) => {
                    tracing::warn!(error = %e, path = ?p, "local_storage open failed");
                    None
                }
            });

        Ok(Self {
            scheduler: Arc::new(Scheduler::new()),
            event_bus: Arc::new(EventBus::new()),
            capability_broker: Arc::new(CapabilityBroker::new()),
            mcp_host,
            effect_executor: Arc::new(EffectExecutor::new()),
            event_store: Arc::new(event_store),
            provider_registry,
            local_storage,
            booted_at: Instant::now(),
            review_gate: Arc::new(crate::kernel::review_gate::ReviewGate::new()),
            ui_bridge: Arc::new(crate::kernel::ui_bridge::UiBridge::new()),
        })
    }

    /// Boot with default data dir under platform config dir.
    pub fn boot_default() -> Result<Self, KernelBootError> {
        let data_dir = directories::ProjectDirs::from("ai", "ctrl", "ctrl")
            .map(|d| d.data_local_dir().to_path_buf())
            .unwrap_or_else(|| std::env::temp_dir().join("ctrl"));
        Self::boot(data_dir)
    }
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum KernelBootError {
    #[error("failed to create data directory: {0}")]
    DataDirCreateFailed(String),
    #[error("failed to open event store: {0}")]
    EventStoreOpenFailed(String),
}
