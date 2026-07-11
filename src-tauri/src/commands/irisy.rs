//! Irisy init surface — the status the PWA needs to render the chat header.
//!
//! On the first PWA → Tauri `irisy_init` call:
//!   1. probe the provider router — is a brain adapter (Volc/BYOK) wired?
//!   2. write `~/.ctrl/state/kernel-handshake.json` so a brain mcp's
//!      MCP client can reach the kernel MCP server (ADR-002 substrate § mcp-bus v1) with a token
//!
//! Irisy's brain = the Hermes Agent (ADR-002 substrate § brain v28; CTRL
//! bundles + launches it, dashboard `:17890`). The provider router
//! (`route_chain(IrisyPrimary)`) supplies the active model for direct,
//! fast replies and synth.

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
    /// Active IrisyPrimary provider's display label (matches the value
    /// shown in the InfraBar ENGINE chip — e.g. "Volcano Ark" when
    /// volc-byok is active). Falls back to "none" when no provider is
    /// configured (ADR-002 substrate § brain v28: Irisy brain = Hermes;
    /// the provider router supplies the model label).
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

// PiStatus + probe_pi removed: Pi exited the CTRL hot path (ADR-002 substrate § brain v19, 2026-06-09).
// Irisy's brain is the Hermes Agent (ADR-002 substrate § brain v28); the provider router supplies the
// model. The PWA's IrisyStatus shape already treats `pi` as optional, so dropping the field is safe.

#[tauri::command]
pub async fn irisy_init(
    app: tauri::AppHandle,
    kernel: State<'_, KernelHandle>,
) -> Result<IrisyStatus, String> {
    let app_version = app.package_info().version.to_string();
    let kernel_llm = probe_kernel_llm(&kernel);
    let mcp_bridge = write_handshake_file()?;
    // Mirror the same provider label kernel_status surfaces — the IrisyPrimary
    // provider label. Falls back to "none" when no provider is configured
    // (ADR-002 substrate § brain v28: Irisy brain = Hermes Agent).
    let active_brain = kernel
        .runtime
        .provider_registry
        .route_chain(&crate::kernel::provider::Consumer::IrisyPrimary)
        .primary
        .as_ref()
        .and_then(|id| kernel.runtime.provider_registry.snapshot(id))
        .map(|snap| crate::commands::system::short_label(&snap.label))
        .unwrap_or_else(|| "none".to_string());

    // ADR-002 substrate § brain v28: no Pi probe; the active provider label
    // is the only brain signal the header needs.
    tracing::info!(
        app_version = %app_version,
        adapter = ?kernel_llm.adapter,
        active_brain = %active_brain,
        "irisy_init ok"
    );

    Ok(IrisyStatus {
        app_version,
        kernel_llm,
        mcp_bridge,
        active_brain,
    })
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
