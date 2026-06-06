// L0 Tauri 2 native shell.
//
// Per ADR-003 frontend §6 + .olym/specs/pwa-shell/spec.md, the shell owns exactly four
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
// bao 2026-06-05 d: provider keychain reads/writes go through this
// subprocess-`security`-CLI helper. keyring v3 apple-native silently
// non-persists in signed CTRL.app without entitlements.
pub mod keychain_subprocess;
pub mod kernel_supervisor;
pub mod lifecycle;
pub mod ollama_install;
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
