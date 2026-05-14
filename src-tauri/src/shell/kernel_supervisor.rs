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

use crate::kernel::runtime::KernelRuntime;
use crate::kernel::stss_bridge::StssBridge;
use crate::kernel::STSS_LISTEN_ADDR;

/// Shared kernel handle managed by Tauri. Commands pull this via `State`.
#[derive(Clone)]
pub struct KernelHandle {
    pub runtime: Arc<KernelRuntime>,
    pub bridge: StssBridge,
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

        let handle = KernelHandle {
            runtime: runtime.clone(),
            bridge: bridge_for_handle,
        };
        app.manage(handle);

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
