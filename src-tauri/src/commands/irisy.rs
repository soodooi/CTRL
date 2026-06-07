//! Irisy init surface — the status the PWA needs to render the chat header.
//!
//! On the first PWA → Tauri `irisy_init` call:
//!   1. probe the kernel's LLM port — is a brain adapter (Volc/BYOK) wired?
//!   2. probe the Pi brain plugin (`@ctrl/pi-plugin` MCP server `/healthz`)
//!   3. write `~/.ctrl/state/kernel-handshake.json` so a brain mcp's
//!      MCP client can reach the kernel MCP server (ADR-002 substrate § mcp-bus v1) with a token
//!
//! Pi is the sole brain (ADR-001 spine amendment 2026-05-25). When Pi isn't
//! running, the PWA falls back to the kernel `chat_stream` command
//! (llm_port → Volc) for a direct, fast reply.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

use crate::shell::KernelHandle;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IrisyStatus {
    /// Irisy companion version = CTRL app version. Single source of truth
    /// = `src-tauri/tauri.conf.json` (read via Tauri `package_info()` at
    /// runtime). No standalone Irisy semver — Irisy ships in lockstep with
    /// the host shell, so the user-visible version stays one number.
    pub app_version: String,
    pub kernel_llm: KernelLlmStatus,
    pub mcp_bridge: McpBridgeStatus,
    /// Pi default-brain probe (ADR-001 spine amendment 2026-05-25, H-2026-05-25-001).
    /// `reachable` = the @ctrl/pi-plugin MCP server is responding on its
    /// `/healthz` endpoint. PWA reads this to decide whether `irisy_chat_stream`
    /// will succeed; degraded UI prompts the user to start the subprocess
    /// (until the kernel supervisor for pi-plugin lands).
    pub pi: PiStatus,
    /// Active IrisyPrimary provider's display label (matches the value
    /// shown in the InfraBar ENGINE chip — e.g. "Claude" when
    /// claude-oauth is active). Falls back to "pi" when no provider is
    /// configured.
    pub active_brain: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KernelLlmStatus {
    pub adapter: Option<String>,
    pub ready: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct McpBridgeStatus {
    pub handshake_written: bool,
    pub handshake_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PiStatus {
    /// MCP endpoint the brain router dispatches to. v1.0 hardcoded
    /// `http://127.0.0.1:17874/mcp` for brain id "pi"; future supervisor
    /// reports the actual ephemeral port through this field.
    pub mcp_url: String,
    /// `true` when /healthz returned 200 within the probe timeout. `false`
    /// covers both "Pi plugin not running" and "Pi binary missing" — PWA
    /// surfaces a single "start pi-plugin" hint either way.
    pub reachable: bool,
    /// Pi binary version reported by the plugin's /healthz (`pi.version`
    /// field). `None` when the plugin is running but Pi itself is missing,
    /// or when the probe didn't complete in time.
    pub version: Option<String>,
}

#[tauri::command]
pub async fn irisy_init(
    app: tauri::AppHandle,
    kernel: State<'_, KernelHandle>,
) -> Result<IrisyStatus, String> {
    let app_version = app.package_info().version.to_string();
    let kernel_llm = probe_kernel_llm(&kernel);
    let mcp_bridge = write_handshake_file()?;
    let pi = probe_pi().await;
    // Mirror the same provider label kernel_status surfaces — see the
    // comment there for why this is the IrisyPrimary provider label,
    // not the literal "pi". ADR-002 substrate § provider v2 §3.6.
    let active_brain = kernel
        .runtime
        .provider_registry
        .route_chain(&crate::kernel::provider::Consumer::IrisyPrimary)
        .primary
        .as_ref()
        .and_then(|id| kernel.runtime.provider_registry.snapshot(id))
        .map(|snap| crate::commands::system::short_label(&snap.label))
        .unwrap_or_else(|| "pi".to_string());

    tracing::info!(
        app_version = %app_version,
        adapter = ?kernel_llm.adapter,
        pi_reachable = pi.reachable,
        pi_version = ?pi.version,
        "irisy_init ok"
    );

    Ok(IrisyStatus {
        app_version,
        kernel_llm,
        mcp_bridge,
        pi,
        active_brain,
    })
}

async fn probe_pi() -> PiStatus {
    // ADR-002 substrate: Pi now runs as a stdin RPC subprocess (no HTTP server);
    // reachability = "supervisor reports a live child". Version comes
    // from the install metadata cache. PWA shows install/upgrade UI by
    // calling `pi_status` (commands/system.rs) for the richer surface.
    let install = crate::shell::pi_install::current_status();
    let port = crate::shell::brain_supervisor::provider_port();
    PiStatus {
        mcp_url: format!("rpc://pi/extension/ctrl-bridge@{port}"),
        reachable: crate::shell::brain_supervisor::is_running(),
        version: install.installed_version,
    }
}

fn probe_kernel_llm(kernel: &State<'_, KernelHandle>) -> KernelLlmStatus {
    let adapter = kernel
        .runtime
        .provider_registry
        .primary_text_chat()
        .map(|p| p.id().to_string());
    KernelLlmStatus {
        ready: adapter.is_some(),
        adapter,
    }
}

fn write_handshake_file() -> Result<McpBridgeStatus, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME env not set".to_string())?;
    let dir = PathBuf::from(&home).join(".ctrl").join("state");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {dir:?}: {e}"))?;
    let path = dir.join("kernel-handshake.json");

    let token = std::env::var("CTRL_KERNEL_TOKEN").unwrap_or_else(|_| "dev-placeholder".into());
    let body = serde_json::json!({
        "url": "http://127.0.0.1:17873/mcp",
        "token": token,
        "written_at_ms": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    });
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&body).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("write {path:?}: {e}"))?;

    Ok(McpBridgeStatus {
        handshake_written: true,
        handshake_path: path.display().to_string(),
    })
}
