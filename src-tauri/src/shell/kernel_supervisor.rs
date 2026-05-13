// Kernel daemon supervisor.
//
// Per ADR-002 §3 + §6, the L1 kernel becomes a localhost daemon exposing a WS
// bridge on :17872. The shell spawns + supervises it.
//
// Two deployment modes:
//
//   • In-process (current sub-PR b stage) — kernel runs as a tokio task inside
//     the Tauri main process; "supervision" is just a JoinHandle. This keeps
//     development friction low.
//
//   • Out-of-process (later, when binary-size budget needs the split) — kernel
//     runs as a child process; supervisor restarts on crash, reads stderr,
//     enforces health-check timeouts.
//
// The public API is shaped for both: callers don't care which mode is active.

use anyhow::Result;
use tauri::AppHandle;

pub struct KernelSupervisor;

impl KernelSupervisor {
    /// Start the kernel daemon (in-process for sub-PR b).
    pub fn start(_app: &AppHandle) -> Result<()> {
        // sub-PR b commit 2 wires this to crate::kernel::runtime::KernelRuntime::boot_default()
        // + spawn the ST-SS WS bridge (port from share/stss-spike/).
        tracing::info!("KernelSupervisor::start — skeleton (sub-PR b commit 2 wires to KernelRuntime)");
        Ok(())
    }

    /// Wait until the kernel reports ready. Currently a no-op since the kernel
    /// boots synchronously; future out-of-process mode will block on an IPC
    /// ready signal with a configurable timeout.
    pub fn wait_ready(_timeout_ms: u64) -> Result<()> {
        Ok(())
    }

    /// Request a graceful shutdown.
    pub fn shutdown() -> Result<()> {
        tracing::info!("KernelSupervisor::shutdown — skeleton");
        Ok(())
    }
}
