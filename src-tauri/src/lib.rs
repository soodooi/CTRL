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

    let app = tauri::Builder::default()
        // Single-instance lock: a second `open /Applications/CTRL.app`
        // (or Spotlight launch) calls back into the existing process
        // instead of spawning a duplicate kernel that fights over
        // 127.0.0.1:17872/17873. Callback reveals the main window so
        // a Finder double-click works as "show CTRL" — fixes bao's
        // "在任务栏 就是打不开" symptom.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tracing::info!("single-instance: second launch detected, revealing window");
            if let Err(err) = shell::WindowController::reveal(app) {
                tracing::error!(?err, "single-instance reveal failed");
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // ctrl-asset:// custom URI scheme — serves files under
        // ~/.ctrl/keycaps/<id>/{assets,skills}/... read-only. Handler is
        // crate::shell::asset_protocol. PWA IconRenderer + viewer registry
        // consumes these URLs (daedalus PR #44).
        .register_asynchronous_uri_scheme_protocol(
            shell::asset_protocol::SCHEME,
            shell::asset_protocol::handle_request,
        )
        // Tauri-side auto-updater. Endpoint + pubkey live in
        // tauri.conf.json -> plugins.updater. Signed release pipeline:
        // scripts/release.sh produces .app.tar.gz + .sig + latest.json
        // and uploads to the public soodooi/CTRL-releases sibling repo.
        // ADR-011 / 018 — Layer 1 of 4 of the auto-update strategy.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(commands::system::UpdateCache::default())
        .setup(|app| {
            shell::ShellLifecycle::boot(app.handle())?;
            Ok(())
        })
        .invoke_handler(pwa_invoke_handler!())
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Run with an event handler so we can react to macOS Dock clicks
    // (RunEvent::Reopen, fired by NSApplicationDelegate's applicationShouldHandleReopen).
    // Bao's "明明 ctrl 在任务栏 就是打不开" symptom: Dock click on a
    // running app with all windows hidden does nothing by default —
    // we explicitly toggle (cloak → reveal) on Reopen.
    app.run(|app, event| {
        if let tauri::RunEvent::Reopen { .. } = event {
            tracing::info!("dock reopen: revealing window");
            if let Err(err) = shell::WindowController::reveal(app) {
                tracing::error!(?err, "dock reopen reveal failed");
            }
        }
    });
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
        // Tauri-side auto-updater. Endpoint + pubkey live in
        // tauri.conf.json -> plugins.updater. Signed release pipeline:
        // scripts/release.sh produces .app.tar.gz + .sig + latest.json
        // and uploads to the public soodooi/CTRL-releases sibling repo.
        // ADR-011 / 018 — Layer 1 of 4 of the auto-update strategy.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // ctrl-asset:// custom URI scheme (same handler as macOS branch) —
        // serves files under ~/.ctrl/keycaps/<id>/{assets,skills}/... read-only.
        .register_asynchronous_uri_scheme_protocol(
            shell::asset_protocol::SCHEME,
            shell::asset_protocol::handle_request,
        )
        .manage(commands::system::UpdateCache::default())
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
