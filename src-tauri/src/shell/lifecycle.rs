// Shell lifecycle.
//
// Coordinates app launch + shutdown across:
//   • Kernel daemon spawn (KernelSupervisor)
//   • Hotkey hook install (HotkeyController)
//   • Tray icon install (TrayController)
//   • Window setup (WindowController)
//
// Ordering invariant: kernel must report ready before hotkey is armed, so the
// first Ctrl tap can't reach a not-yet-listening kernel (ADR-002 §11 risk #2).

use anyhow::Result;
use tauri::AppHandle;

use super::{KernelSupervisor, TrayController};

pub struct ShellLifecycle;

impl ShellLifecycle {
    /// Boot the shell. Runs inside `tauri::Builder::setup`.
    pub fn boot(app: &AppHandle) -> Result<()> {
        tracing::info!("ShellLifecycle::boot — starting kernel daemon");
        KernelSupervisor::start(app)?;

        tracing::info!("ShellLifecycle::boot — installing tray");
        TrayController::install(app)?;

        // sub-PR b commit 2: install lone-Ctrl hotkey after KernelSupervisor
        // reports ready (currently fires synchronously since supervisor is in
        // the same process).

        tracing::info!("ShellLifecycle::boot — complete");
        Ok(())
    }
}
