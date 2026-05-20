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
// W3-era hexagonal-architecture (`actors/`, `adapters/`, `application/`,
// `domain/`) and the UniFFI bindings layer (`ffi/`, `ctrl.udl`) were
// deleted in H-2026-05-14-002 mac/c. ADR-002 retired both:
//   • PWA — not native UI — is the surface, so SwiftUI / WinUI 3 / C#
//     bindings have no consumer
//   • `commands::*` (Tauri 2 invoke) replaces the port-shaped tauri_commands
//     adapter; `shell::*` replaces the macOS-only outbound adapters.

mod commands;
mod error;
mod kernel;
mod shell;

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

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // tauri-plugin-updater registration deferred to P8 (needs ctrl-cloud
        // static manifest host + production signing key). The dep stays in
        // Cargo.toml so the surface is wired for fast turn-on once those land.
        .setup(|app| {
            shell::ShellLifecycle::boot(app.handle())?;
            Ok(())
        })
        .invoke_handler(pwa_invoke_handler!())
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Launcher app contract: destroying the main window does NOT exit the
    // process. Tauri 2 default behavior is to exit when the last webview
    // window closes, but our destroy + rebuild toggle pattern would then
    // kill kernel + hotkey + tray after a single lone-Ctrl tap. Prevent the
    // exit and let the process stay alive in tray for re-summoning.
    app.run(|_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
            // code = None means user-initiated (last window closed / Quit).
            // code = Some(_) means explicit shutdown (tray Quit menu) — let it through.
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn run() {
    panic!("CTRL only supports macOS + Windows currently");
}
