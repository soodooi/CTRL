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
use crate::kernel::llm_port::LlmPortRouter;
use crate::kernel::mcp_host::McpHost;
use crate::kernel::persistence::EventStore;
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
    pub llm_port: Arc<LlmPortRouter>,
    /// Monotonic instant captured at boot — used by the kernel_status
    /// Tauri command to report uptime to the PWA status bar.
    pub booted_at: Instant,
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

        // ADR-005 / -011 launch posture: Volc Ark (Doubao) is the v1 default
        // provider; Anthropic + Ollama stay in the fallback chain for BYOK /
        // local dev. The router only routes to adapters that actually
        // registered themselves at boot — missing keys → adapter not
        // registered → router falls through silently.
        let mut llm_port = LlmPortRouter::new(vec![
            "volc".into(),
            "anthropic".into(),
            "ollama".into(),
        ]);
        crate::kernel::llm_adapters::register_default_adapters(&mut llm_port);

        let mcp_host = Arc::new(McpHost::new());
        // Hydrate the MCP server registry from disk so previously
        // installed Pattern D keycaps re-register without the user
        // re-running the install wizard each launch. Connections lazy-
        // establish on first invoke; this only reloads descriptors.
        if let Some(reg_path) = McpHost::default_registry_path() {
            let host_clone = Arc::clone(&mcp_host);
            // KernelRuntime::boot is called from Tauri setup() which runs on the
            // main thread before tokio is fully wired. Guard tokio::spawn behind
            // an active-runtime check so boot doesn't panic when no runtime is
            // available; fall back to a blocking single-threaded mini-runtime so
            // the registry still hydrates synchronously on cold start. Fixes
            // 0.1.34 "打不开" — panic at runtime.rs:75:13 on Tauri setup path.
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

        Ok(Self {
            scheduler: Arc::new(Scheduler::new()),
            event_bus: Arc::new(EventBus::new()),
            capability_broker: Arc::new(CapabilityBroker::new()),
            mcp_host,
            effect_executor: Arc::new(EffectExecutor::new()),
            event_store: Arc::new(event_store),
            llm_port: Arc::new(llm_port),
            booted_at: Instant::now(),
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
