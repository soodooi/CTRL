// Kernel daemon supervisor.
//
// Sub-PR d: real wire. Boots KernelRuntime + spawns EventWsBridge listening on
// 127.0.0.1:17872. Exposes both via Tauri's `manage()` so commands can pull
// them as `tauri::State<Arc<KernelRuntime>>` / `State<EventWsBridge>`.
//
// Future out-of-process mode (when binary-size budget needs the split) keeps
// the same public API; only the start() body swaps to a child process spawn.

use anyhow::{anyhow, Result};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

use crate::kernel::runtime::KernelRuntime;
use crate::kernel::event_ws::EventWsBridge;
use crate::kernel::EVENT_WS_LISTEN_ADDR;

/// Shared kernel handle managed by Tauri. Commands pull this via `State`.
///
/// `app` is plumbed in by `KernelSupervisor::start` so non-#[tauri::command]
/// code paths (axum `/text-chat` failover handler in `http_endpoint.rs`)
/// can `Emitter::emit` Tauri events without a `tauri::AppHandle` argument
/// in their signature. ADR-002 substrate § provider v8 §3.5 (2026-06-06):
/// failover emits `provider:routing-override` / `provider:routing-restored`
/// so the PWA's ENGINE chip can overlay the transient fallback label
/// without polling (ADR-002 substrate § provider v8 §3.5, 2026-06-06).
#[derive(Clone)]
pub struct KernelHandle {
    pub runtime: Arc<KernelRuntime>,
    pub bridge: EventWsBridge,
    #[allow(dead_code)]
    pub app: AppHandle,
}

pub struct KernelSupervisor;

impl KernelSupervisor {
    /// Boot the kernel + start the event-stream WS bridge. Registers both with
    /// `app.manage()` so commands can resolve them as Tauri State.
    pub fn start(app: &AppHandle) -> Result<()> {
        tracing::info!("KernelSupervisor::start — booting L1 kernel");
        let runtime = KernelRuntime::boot_default()
            .map_err(|e| anyhow!("kernel boot failed: {e:?}"))?;
        let runtime = Arc::new(runtime);

        let bridge = EventWsBridge::new();
        let bridge_for_handle = bridge.clone();

        let handle = KernelHandle {
            runtime: runtime.clone(),
            bridge: bridge_for_handle,
            app: app.clone(),
        };
        app.manage(handle.clone());

        // Review-gate forwarder (ADR-002 §264 + ADR-006 §4): when a high-blast
        // EXTERNAL call parks for human approval, fan the gate-derived request
        // out to the PWA as a Tauri event so the ReviewGateHost can pop a
        // confirm. The approve/deny comes back via the `review_resolve` command
        // (PWA-only surface — the external brain can't reach it: C3 boundary).
        {
            use tauri::Emitter;
            let mut rx = runtime.review_gate.subscribe();
            let app_for_review = app.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(req) => {
                            let _ = app_for_review.emit("review:pending", &req);
                        }
                        // Lagged (slow PWA) — the modal re-seeds via the
                        // `review_pending` command, so dropping is fine.
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            });
        }

        // Open-note forwarder (ADR-002 §1.9 v46 E3): when the brain calls the
        // `note_open` gate tool, fan the request out to the PWA as a Tauri
        // event so the notes workspace navigates — same pattern as the
        // review-gate forwarder above. Lagged/no-listener is fine (the tool
        // reports `delivered:false`).
        {
            use tauri::Emitter;
            let mut rx = runtime.ui_bridge.subscribe_open();
            let app_for_notes = app.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(req) => {
                            let _ = app_for_notes.emit("notes:open", &req);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            });
        }

        // NOTE (2026-06-21, full-review P0): the unauthenticated `:17878`
        // provider HTTP endpoint (`/text-chat` + `/tool/<name>`) was removed.
        // It existed only for the now-retired Pi bridge (ADR-002 §1 v19) and
        // shipped with NO auth middleware, exposing vault_write / install_mcp /
        // mcp_run and leaking provider API keys (get_active_provider_details)
        // to any local process on loopback. The PWA reaches the provider
        // router through the authenticated `:17873` gate instead.

        // Start the kernel MCP server — the single gate (ADR-002 § mcp-bus,
        // ADR-001 §4.1) exposing kernel capabilities (clipboard / OCR /
        // vault_index FTS5 / keychain / subprocess / provider router) as MCP
        // tools. The per-boot bearer token + port are published via env vars
        // CTRL_KERNEL_MCP_TOKEN + CTRL_KERNEL_MCP_PORT, consumed by the
        // projector (materializes them into the user's CLI `.mcp.json`, below)
        // and acp_client (passes them to a future ACP-aware driver). (v19
        // retired Pi / ctrl-pi-bridge / ctrl-pi-plugin; v27 = BYO-CLI driver.)
        let runtime_for_mcp = runtime.clone();
        tauri::async_runtime::spawn(async move {
            match crate::kernel::mcp_server::serve(
                runtime_for_mcp,
                None,
                crate::kernel::MCP_SERVER_LISTEN_ADDR,
            )
            .await
            {
                Ok(h) => {
                    tracing::info!(
                        listen_addr = %h.listen_addr,
                        "kernel: MCP server listening (agents auto-connect via mcpServers)"
                    );
                    // SAFETY: set_var is unsafe in Rust 2024; we are at
                    // single-threaded kernel boot, before any other task reads
                    // env vars. Consumed next by projector + acp_client
                    // (ADR-002 substrate § projection v27).
                    std::env::set_var("CTRL_KERNEL_MCP_TOKEN", h.auth_token.as_str());
                    let port = h
                        .listen_addr
                        .rsplit_once(':')
                        .map(|(_, p)| p.to_string())
                        .unwrap_or_else(|| "17873".to_string());
                    std::env::set_var("CTRL_KERNEL_MCP_PORT", &port);
                    // ADR-001 §4 projector / ADR-002 § projection: materialize
                    // the kernel gate into the CTRL workspace `.mcp.json` so the
                    // user's own CLI driver (Claude Code) auto-discovers it on
                    // launch. Uses the fresh per-boot gate token (not hardcoded);
                    // best-effort, never blocks boot.
                    crate::kernel::projector::project_kernel_gate(&port, h.auth_token.as_str());
                    // Second BYO-CLI driver: if the user has Codex, wire the same
                    // gate into its global ~/.codex/config.toml (it loads MCP from
                    // there, not the workspace .mcp.json). No-op unless ~/.codex/
                    // exists — CTRL never installs/supervises a BYO-CLI.
                    crate::kernel::projector::project_codex_gate(&port, h.auth_token.as_str());
                }
                Err(e) => tracing::warn!(error = %e, "kernel: MCP server spawn failed"),
            }
        });

        // Agent resource-pack prefetch (bao 2026-06-10: agents live
        // OUTSIDE the app bundle in ~/.ctrl/, downloaded as resource
        // packs right after install — independent upgrade cadence,
        // installer stays lean). Best-effort + idempotent: install()
        // returns the cached manifest when already present; failures
        // are logged and retried lazily on first route visit (PWA
        // useAgent), never blocking boot or the user.
        tauri::async_runtime::spawn_blocking(|| {
            use crate::shell::agent_installer::{install, AgentName};
            // Hermes is the only wired agent — opencode retired
            // 2026-06-25 (DRIFT D8). Best-effort + idempotent.
            let agent = AgentName::Hermes;
            let label = agent.as_str();
            match install(agent, false) {
                Ok(m) => tracing::info!(agent = label, version = %m.version, "agent resource pack ready"),
                Err(e) => tracing::info!(agent = label, error = %e, "agent prefetch deferred (will retry on first use)"),
            }
            // Obsidian connector RETIRED per ADR-002 substrate §1.9 v46
            // (2026-07-02, notes-module-replacement-plan S1): no app install,
            // no plugin provision, no bus connect. CTRL's NotesApp + native
            // note endpoints are the notes surface; the vault stays
            // Obsidian-format-compatible, unwired.
        });

        // ADR-002 substrate § provider + vault/ctrl/strategy/0013 (2026-06-16):
        // start hermes's own dashboard web UI on a fixed loopback port so the
        // PWA's Settings -> Irisy page can embed it (the agent's config / sessions
        // live in hermes; CTRL only frames its UI). Best-effort + backgrounded; it
        // is a plain web server (no keychain read) so it never blocks boot. If the
        // port is already taken (a dashboard from a previous boot), the spawn just
        // fails and is logged — the existing one keeps serving.
        tauri::async_runtime::spawn_blocking(|| {
            use crate::shell::agent_installer::{is_installed, read_manifest, AgentName};
            if !is_installed(&AgentName::Hermes) {
                return;
            }
            let Some(manifest) = read_manifest(&AgentName::Hermes) else {
                return;
            };
            let entry = manifest.entry_cmd; // [<uvx>, --from, <spec>, hermes-acp]
            if entry.len() < 3 {
                return;
            }
            let status = std::process::Command::new(&entry[0])
                .args(&entry[1..3]) // --from <spec>
                .args([
                    "hermes",
                    "dashboard",
                    "--port",
                    "17890",
                    "--host",
                    "127.0.0.1",
                    "--no-open",
                    "--skip-build",
                ])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
            match status {
                Ok(_) => tracing::info!(
                    "hermes dashboard launched on 127.0.0.1:17890 (Settings -> Irisy embed)"
                ),
                Err(e) => tracing::warn!(error = %e, "hermes dashboard launch failed"),
            }
        });

        // Code Space env registry — coding remote desktop v1 (zeus Z1, event-stream spec v0.7).
        // commands::code_space::cs_* invocations pull this State to spawn /
        // control SubprocessActor instances. Independent from KernelHandle so
        // the registry lifetime is tied to the app, not to a specific kernel
        // boot cycle.
        app.manage(crate::commands::code_space::CodeSpaceRegistry::new());

        // Spawn the WS bridge on the Tauri tokio runtime. The on_op callback
        // is currently a no-op log; sub-PR d/2 routes it to scheduler::dispatch.
        let bridge_for_serve = bridge.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = bridge_for_serve
                .serve(EVENT_WS_LISTEN_ADDR, |op| {
                    tracing::info!("kernel received op kind={:?} (dispatch TBD sub-PR d/2)", op.kind);
                })
                .await
            {
                tracing::error!("EventWsBridge::serve failed: {e}");
            }
        });

        tracing::info!("KernelSupervisor::start — ready (kernel + WS bridge on {EVENT_WS_LISTEN_ADDR})");
        Ok(())
    }

    pub fn wait_ready(_timeout_ms: u64) -> Result<()> {
        // In-process: kernel boots synchronously, ready returns immediately.
        Ok(())
    }

    #[allow(dead_code)]
    pub fn shutdown() -> Result<()> {
        tracing::info!("KernelSupervisor::shutdown");
        Ok(())
    }
}
