// Composition root.
//
// Per ADR-003 frontend §3 + §6, both desktop targets boot the same shape:
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
// deleted in H-2026-05-14-002 mac/c. ADR-003 frontend retired both:
//   • PWA — not native UI — is the surface, so SwiftUI / WinUI 3 / C#
//     bindings have no consumer
//   • `commands::*` (Tauri 2 invoke) replaces the port-shaped tauri_commands
//     adapter; `shell::*` replaces the macOS-only outbound adapters.

mod asset_scheme;
mod commands;
mod kernel;
mod shell;

/// Export the kernel MCP endpoint spec (the authoritative `tools/list` JSON
/// Schema) as a JSON value. Thin re-export so the `dump_mcp_schema` bin can
/// produce the artifact without making the whole `kernel` module public
/// (ADR-010 § endpoint-spec v6).
pub fn export_mcp_endpoint_spec() -> serde_json::Value {
    kernel::mcp_server::KernelMcpRouter::export_tool_schemas()
}

/// Initialize tracing to stderr AND `~/.ctrl/ctrl.log`. A Finder-launched
/// .app has its stderr discarded by LaunchServices, so the file mirror is the
/// only way to diagnose boot / hotkey / Accessibility behavior in the shipped
/// app. The log is truncated on each launch (fresh per run); best-effort —
/// falls back to stderr-only if `$HOME` can't be resolved.
fn init_tracing() {
    use tracing_subscriber::prelude::*;

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let stderr_layer = tracing_subscriber::fmt::layer();

    let log_path = std::env::var_os("HOME").map(|home| {
        let dir = std::path::PathBuf::from(home).join(".ctrl");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("ctrl.log");
        let _ = std::fs::File::create(&path); // truncate: fresh log per launch
        path
    });

    match log_path {
        Some(path) => {
            let file_layer = tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(move || {
                    std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&path)
                        .unwrap_or_else(|_| std::fs::File::create("/dev/null").unwrap())
                });
            let _ = tracing_subscriber::registry()
                .with(filter)
                .with(stderr_layer)
                .with(file_layer)
                .try_init();
        }
        None => {
            let _ = tracing_subscriber::registry()
                .with(filter)
                .with(stderr_layer)
                .try_init();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(target_os = "macos")]
pub fn run() {
    init_tracing();

    let builder = tauri::Builder::default()
        // Single-instance lock — Spotlight / Dock re-launch reveals the
        // existing CTRL window instead of spawning a second kernel that
        // would race on ports 17872/17873. Fixes bao's "in the taskbar
        // but just won't open" symptom.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tracing::info!("single-instance: second launch detected, revealing window");
            if let Err(err) = shell::WindowController::reveal(app) {
                tracing::error!(?err, "single-instance reveal failed");
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Tauri-side auto-updater. Endpoint + pubkey live in
        // tauri.conf.json -> plugins.updater. Signed release pipeline:
        // scripts/release.sh produces .app.tar.gz + .sig + latest.json
        // and uploads to the public soodooi/CTRL-releases sibling repo.
        // ADR-004 cap § updater v1 / 018 — Layer 1 of 4 of the auto-update strategy.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            shell::ShellLifecycle::boot(app.handle())?;
            Ok(())
        })
        .invoke_handler(pwa_invoke_handler!());
    let app = asset_scheme::register(builder)
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // macOS Dock click reveal: NSApplicationDelegate's
    // applicationShouldHandleReopen fires RunEvent::Reopen. Default Tauri
    // behavior does nothing on Reopen when all windows are hidden — we
    // explicitly toggle cloak → reveal so Dock click works as "show CTRL".
    app.run(|app, event| match event {
        tauri::RunEvent::Reopen { .. } => {
            tracing::info!("dock reopen: revealing window");
            if let Err(err) = shell::WindowController::reveal(app) {
                tracing::error!(?err, "dock reopen reveal failed");
            }
        }
        // Launcher contract (mirrors the Windows path): closing the last
        // window must NOT quit the tray-resident app. code = None means
        // user-initiated (window closed / Cmd-Q) → keep running in the tray.
        // code = Some(_) is an explicit shutdown (tray Quit) — ADR-002 §1 v19:
        // no kernel-side brain supervisors, so no per-brain shutdown call.
        // Agent processes launched via agent_launcher are owned by the PWA
        // session lifetime; they exit naturally when their parent webview closes.
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            if code.is_none() {
                api.prevent_exit();
            } else {
                // Explicit shutdown — kill the persistent hermes-acp brain
                // (ADR-002 §1.8.1). Other agents are PWA-session-scoped.
                shell::acp_client::shutdown();
            }
        }
        _ => {}
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
    init_tracing();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tracing::info!("single-instance: second launch detected, revealing window");
            if let Err(err) = shell::WindowController::reveal(app) {
                tracing::error!(?err, "single-instance reveal failed");
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            shell::ShellLifecycle::boot(app.handle())?;
            Ok(())
        })
        .invoke_handler(pwa_invoke_handler!());
    let app = asset_scheme::register(builder)
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
            // code = Some(_) means explicit shutdown (tray Quit menu) — let it
            // through and kill the persistent hermes-acp brain (ADR-002 §1.8.1);
            // other agents are PWA-session-scoped.
            if code.is_none() {
                api.prevent_exit();
            } else {
                shell::acp_client::shutdown();
            }
        }
    });
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn run() {
    panic!("CTRL only supports macOS + Windows currently");
}
