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
// Everything else — product UI, mcp runtime, marketplace, manifest editor —
// lives in `packages/ctrl-web` (the PWA) and reaches the kernel through Tauri 2
// `invoke()` handlers declared in `crate::commands::*`.
//
// Status: sub-PR b skeleton. Modules below expose the public surface; full
// implementations land in sub-PR b's second commit (hotkey port from W3
// HotkeyService.cs, tray + window glue, lifecycle wiring).

pub mod builtin_mcps;
pub mod hotkey;
pub mod keychain;
// bao 2026-06-05 d: provider keychain reads/writes used to go through
// this subprocess-`security`-CLI helper. Kept for boot-time migration
// only (vault reads keychain once to import any pre-vault entries).
pub mod keychain_subprocess;
// bao 2026-06-06: credential storage now lives in an encrypted file
// vault at ~/.ctrl/credentials.dat. Option B per ctrl-provider-management
// skill — cross-platform, no entitlements, no signed-app fragility.
pub mod credential_vault;
pub mod kernel_supervisor;
pub mod lifecycle;
pub mod ollama_install;
pub mod tray;
pub mod window;
// ADR-002 §1 v19 (3-agent aggregator): lazy install + on-demand launch of
// the 3 external agents (hermes / opencode / kairo) under ~/.ctrl/agents/.
// No supervisor — PWA owns retry.
pub mod agent_installer;
pub mod agent_launcher;
// Built-in tool downloader for feature-pack provision (ADR-002 §7.2 v21).
pub mod tool_installer;
// Provision runner — check → install (downloader/pkg-mgr) → env+secret inject.
pub mod provision_runner;

pub use hotkey::HotkeyController;
pub use keychain::KeychainStore;
pub use kernel_supervisor::{KernelHandle, KernelSupervisor};
pub use lifecycle::ShellLifecycle;
pub use tray::TrayController;
pub use window::WindowController;
// ADR-002 §1 v19 retirements (kept as comments for code archaeology):
//   pub mod brain_supervisor;     ← Pi sole-brain supervisor (Pi exited)
//   pub mod hermes_supervisor;    ← v18 dual-brain supervisor (no supervise in v19)
//   pub mod opencode_supervisor;  ← v18 dual-brain supervisor (no supervise in v19)
//   pub mod pi_install;           ← Pi npm install (Pi exited)
