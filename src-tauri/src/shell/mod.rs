// L0 Tauri 2 native shell.
//
// Per ADR-002 §6 + .olym/specs/pwa-shell/spec.md, the shell owns exactly four
// responsibilities that the PWA cannot:
//
//   1. Global `Ctrl` hotkey (lone-modifier single-tap detection)
//   2. System tray icon + menu
//   3. Kernel daemon supervision (spawn + restart)
//   4. OS keychain (BYOK API key storage)
//
// Everything else — product UI, keycap runtime, marketplace, manifest editor —
// lives in `packages/ctrl-web` (the PWA) and reaches the kernel through Tauri 2
// `invoke()` handlers declared in `crate::commands::*`.
//
// Status: sub-PR b skeleton. Modules below expose the public surface; full
// implementations land in sub-PR b's second commit (hotkey port from W3
// HotkeyService.cs, tray + window glue, lifecycle wiring).

pub mod brain_supervisor;
pub mod builtin_keycaps;
pub mod hotkey;
pub mod keychain;
pub mod kernel_supervisor;
pub mod lifecycle;
pub mod pi_install;
pub mod tray;
pub mod window;

pub use brain_supervisor::BrainSupervisor;
pub use hotkey::HotkeyController;
pub use keychain::KeychainStore;
pub use kernel_supervisor::{KernelHandle, KernelSupervisor};
pub use lifecycle::ShellLifecycle;
pub use tray::TrayController;
pub use window::WindowController;
