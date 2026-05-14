// Composition root.
//
// Per ADR-002 §3 + §6, both desktop targets boot the same shape:
//   tauri::Builder::default()
//     .plugin(tauri-plugin-global-shortcut)
//     .setup(|app| ShellLifecycle::boot(app.handle()))
//     .invoke_handler(pwa_invoke_handler!())
//     .run(generate_context!())
//
// macOS path (H-2026-05-14-002 mac/b) mirrors the Windows path that landed
// in H-2026-05-13-001 sub-PR b. Single source of behavior — `shell::*` owns
// the four PWA-impossible responsibilities (hotkey / tray / kernel daemon
// supervision / keychain) for both OSes.
//
// `mod actors` / `application` / `domain` / `ffi` + `ctrl.udl` are W3-era
// hexagonal-architecture residue from the macOS-only spike. They are
// unreferenced by the run() entry points after mac/b and get deleted in
// mac/c (they pre-date ADR-002's PWA pivot).

mod actors;
mod adapters;
mod application;
mod commands;
mod domain;
mod error;
mod ffi;
mod kernel;
mod shell;

// UniFFI scaffolding for FFI exports — deleted in mac/c (PWA pivot
// removed the SwiftUI / Kotlin / C# native UI plan; PWA reaches the
// kernel via Tauri 2 invoke handlers in `commands::*`).
use crate::ffi::*;
uniffi::include_scaffolding!("ctrl");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(target_os = "macos")]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // tauri-plugin-updater registration deferred to P8 (needs ctrl-cloud
        // static manifest host + production signing key). The dep stays in
        // Cargo.toml so the surface is wired for fast turn-on once those land.
        .setup(|app| {
            shell::ShellLifecycle::boot(app.handle())?;
            Ok(())
        })
        .invoke_handler(pwa_invoke_handler!())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Windows path — H-2026-05-13-001 sub-PR b + d + e.
//
// Tauri 2 native shell + PWA invoke surface. Kernel boot happens inside
// ShellLifecycle::boot -> KernelSupervisor::start (one place); the previous
// stub also booted a runtime here, but the supervisor was the canonical
// owner — keeping both bootstraps caused a second event-store handle that
// would later race the supervisor's. Removed per pre-merge review.
#[cfg(target_os = "windows")]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // tauri-plugin-updater registration deferred to P8 (needs ctrl-cloud
        // static manifest host + production signing key). The dep stays in
        // Cargo.toml so the surface is wired for fast turn-on once those land.
        .setup(|app| {
            shell::ShellLifecycle::boot(app.handle())?;
            Ok(())
        })
        .invoke_handler(pwa_invoke_handler!())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn run() {
    panic!("CTRL only supports macOS + Windows currently");
}
