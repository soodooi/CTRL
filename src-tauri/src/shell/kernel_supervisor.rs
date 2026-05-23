// Kernel daemon supervisor.
//
// Sub-PR d: real wire. Boots KernelRuntime + spawns StssBridge listening on
// 127.0.0.1:17872. Exposes both via Tauri's `manage()` so commands can pull
// them as `tauri::State<Arc<KernelRuntime>>` / `State<StssBridge>`.
//
// Future out-of-process mode (when binary-size budget needs the split) keeps
// the same public API; only the start() body swaps to a child process spawn.

use anyhow::{anyhow, Result};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

use crate::kernel::mcp_server::{self, McpServerHandle};
use crate::kernel::runtime::KernelRuntime;
use crate::kernel::stss_bridge::StssBridge;
use crate::kernel::{MCP_SERVER_LISTEN_ADDR, STSS_LISTEN_ADDR};

/// Shared kernel handle managed by Tauri. Commands pull this via `State`.
#[derive(Clone)]
pub struct KernelHandle {
    pub runtime: Arc<KernelRuntime>,
    pub bridge: StssBridge,
    /// MCP server handle (URL + ephemeral bearer token). None when the
    /// listener failed to bind (port in use / IPv4 disabled in sandbox).
    pub mcp_server: Option<McpServerHandle>,
}

pub struct KernelSupervisor;

impl KernelSupervisor {
    /// Boot the kernel + start the ST-SS WS bridge. Registers both with
    /// `app.manage()` so commands can resolve them as Tauri State.
    pub fn start(app: &AppHandle) -> Result<()> {
        tracing::info!("KernelSupervisor::start — booting L1 kernel");
        let runtime = KernelRuntime::boot_default()
            .map_err(|e| anyhow!("kernel boot failed: {e:?}"))?;
        let runtime = Arc::new(runtime);

        let bridge = StssBridge::new();
        let bridge_for_handle = bridge.clone();

        // Spawn the kernel MCP server (ADR-013). Binds to 127.0.0.1:17873
        // (loopback only). The accept loop is detached on Tauri's tokio
        // runtime; failure to bind is logged + we boot without MCP rather
        // than aborting the whole shell (e.g. port collision during dev).
        let runtime_for_mcp = runtime.clone();
        let local_storage_for_mcp = runtime.local_storage.clone();
        let mcp_handle = tauri::async_runtime::block_on(async move {
            mcp_server::serve(runtime_for_mcp, local_storage_for_mcp, MCP_SERVER_LISTEN_ADDR)
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, addr = MCP_SERVER_LISTEN_ADDR, "mcp_server bind failed");
                    e
                })
                .ok()
        });

        // ADR-019: write the kernel handshake file so the
        // `ctrl-hermes-plugin` Python adapter (and any external agent we
        // configure) can read `{ url, token }` without an env var. Best-
        // effort; failure to write is logged but doesn't block boot.
        if let Some(ref mcp) = mcp_handle {
            if let Err(e) = write_kernel_handshake(&mcp.url(), mcp.auth_token.as_ref()) {
                tracing::warn!(error = %e, "kernel handshake file write failed (plugin path will fail until kernel restart)");
            }
        }

        let handle = KernelHandle {
            runtime: runtime.clone(),
            bridge: bridge_for_handle,
            mcp_server: mcp_handle,
        };
        app.manage(handle);

        // Code Space env registry — coding 远程桌面 v1 (zeus Z1, ST-SS spec v0.7).
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
                .serve(STSS_LISTEN_ADDR, |op| {
                    tracing::info!("kernel received op kind={:?} (dispatch TBD sub-PR d/2)", op.kind);
                })
                .await
            {
                tracing::error!("StssBridge::serve failed: {e}");
            }
        });

        tracing::info!("KernelSupervisor::start — ready (kernel + WS bridge on {STSS_LISTEN_ADDR})");
        Ok(())
    }

    pub fn wait_ready(_timeout_ms: u64) -> Result<()> {
        // In-process: kernel boots synchronously, ready returns immediately.
        Ok(())
    }

    pub fn shutdown() -> Result<()> {
        tracing::info!("KernelSupervisor::shutdown");
        Ok(())
    }
}

/// Write the kernel handshake file at `~/.ctrl/state/kernel-handshake.json`
/// for the ctrl-hermes-plugin Python adapter (ADR-019). Contents:
/// `{ "url": "http://127.0.0.1:17873/mcp", "token": "<ephemeral>" }`.
///
/// File is rewritten atomically (temp + rename) so a partial write never
/// confuses the plugin. Permissions are set to 0600 on Unix so other
/// local users can't read the Bearer token.
fn write_kernel_handshake(url: &str, token: &str) -> Result<()> {
    let home = std::env::var("HOME").map_err(|e| anyhow!("HOME unset: {e}"))?;
    let dir = std::path::PathBuf::from(home).join(".ctrl").join("state");
    std::fs::create_dir_all(&dir)
        .map_err(|e| anyhow!("create_dir_all {dir:?}: {e}"))?;

    let path = dir.join("kernel-handshake.json");
    let tmp = dir.join("kernel-handshake.json.tmp");
    let body = serde_json::json!({
        "url": url,
        "token": token,
        "schema_version": 1,
    });
    let body_bytes = serde_json::to_vec_pretty(&body)
        .map_err(|e| anyhow!("serialize: {e}"))?;

    std::fs::write(&tmp, body_bytes).map_err(|e| anyhow!("write tmp: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| anyhow!("chmod tmp: {e}"))?;
    }
    std::fs::rename(&tmp, &path).map_err(|e| anyhow!("rename: {e}"))?;
    tracing::info!(?path, "kernel handshake written for ctrl-hermes-plugin");
    Ok(())
}
