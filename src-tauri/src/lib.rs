// Composition root — wires concrete adapters into the application's port-shaped holes.
// Every other module talks to traits, not concrete types. This is the only file that
// names both ports and adapters.

// Cross-platform support: lifted macOS-only restriction per ADR-001 cross-platform target.
// macOS-specific adapters in adapters/outbound/macos/ remain target-gated (see Cargo.toml).
// Windows adapters added incrementally in P2.5 (full rewrite of adapter layer).

mod actors;
mod adapters;
mod application;
mod commands;
mod domain;
mod error;
mod ffi;
mod kernel;
mod shell;

// UniFFI scaffolding for FFI exports (Swift / Kotlin / C# bindings).
// Generated from src/ctrl.udl by build.rs at compile time. The scaffolding
// references functions defined in `ffi::*` via fully-qualified path, so no
// re-export needed at crate root.
use crate::ffi::*;
uniffi::include_scaffolding!("ctrl");

use std::sync::Arc;

use tauri::Manager;

// Kernel commands moved off Tauri surface — kernel now exposed via UniFFI (ffi/mod.rs).
// Native UIs (WinUI 3 / SwiftUI) call Rust kernel through UniFFI bindings, not
// Tauri invoke. Tauri shell remains here only as a transitional dev tool.
use crate::adapters::inbound::tauri_commands::{
    bootstrap_minimax, capture_selected_text, check_accessibility, get_llm_settings,
    hide_all_panels, hide_if_unfocused, hide_window, list_tools, open_accessibility_settings,
    peek_clipboard, run_action, run_chat, set_llm_key, set_panel_visible, AppState,
};
use crate::kernel::runtime::KernelRuntime;
#[cfg(target_os = "macos")]
use crate::adapters::outbound::browser::MacBrowser;
use crate::adapters::outbound::clipboard::ArboardClipboard;
use crate::adapters::outbound::clock::InstantClock;
use crate::adapters::outbound::config::{FileConfigStore, KeychainSecretStore};
use crate::adapters::outbound::llm::{LlmGateway, ProviderConfig, ProviderKind};
#[cfg(target_os = "macos")]
use crate::adapters::outbound::macos::{
    accessibility::MacAccessibility, capture::PasteboardCapture, keyboard::CgEventTapKeyboard,
};
use crate::adapters::outbound::manifest_loader::InMemoryToolRegistry;
use crate::adapters::outbound::notifier::TauriNotifier;
use crate::adapters::outbound::tauri::event_bus::TauriEventBus;
use crate::application::ports::{
    AccessibilityPort, BrowserPort, ClipboardPort, ClockPort, ConfigStorePort, EventBusPort,
    KeyboardListenerPort, LlmPort, NotifierPort, SecretStorePort, SelectionCapturePort,
    ToolRegistryPort,
};
use crate::application::use_cases;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(target_os = "macos")]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .try_init();

    // 1. Build outbound adapters that don't depend on the Tauri AppHandle.
    let keyboard: Arc<dyn KeyboardListenerPort> = Arc::new(CgEventTapKeyboard::new());
    let capture: Arc<dyn SelectionCapturePort> = Arc::new(PasteboardCapture::new());
    let accessibility: Arc<dyn AccessibilityPort> = Arc::new(MacAccessibility::new());
    let clock: Arc<dyn ClockPort> = Arc::new(InstantClock::new());
    let clipboard: Arc<dyn ClipboardPort> = Arc::new(ArboardClipboard::new());
    let browser: Arc<dyn BrowserPort> = Arc::new(MacBrowser::new());

    // Settings store + secret store + LLM gateway (boot path).
    let config_store: Arc<dyn ConfigStorePort> = match FileConfigStore::new() {
        Ok(s) => {
            tracing::info!(path = %s.path().display(), "config store initialized");
            Arc::new(s)
        }
        Err(err) => {
            tracing::error!(?err, "FileConfigStore init failed; LLM settings unavailable");
            // Fall back to a barren store; AI tools will report 'not configured'.
            Arc::new(FileConfigStore::new().expect("config store fallback"))
        }
    };
    let secret_store: Arc<dyn SecretStorePort> = Arc::new(KeychainSecretStore::new());
    let llm: Option<Arc<dyn LlmPort>> = build_llm_gateway(&*config_store, &*secret_store)
        .map(|g| Arc::new(g) as Arc<dyn LlmPort>);
    if llm.is_none() {
        tracing::warn!(
            "no LLM gateway configured; AI tools will fail until provider + key set via settings"
        );
    }

    // Tool registry — load declarative manifests from share/modules/builtin.
    // In dev, resolve relative to CARGO_MANIFEST_DIR (src-tauri). For bundled apps this
    // path will be replaced with a Tauri resource lookup; spike-only shortcut here.
    let modules_dir = format!("{}/../share/modules/builtin", env!("CARGO_MANIFEST_DIR"));
    let tool_registry: Arc<dyn ToolRegistryPort> = match InMemoryToolRegistry::from_builtin_dir(
        &modules_dir,
    ) {
        Ok(r) => Arc::new(r),
        Err(err) => {
            tracing::error!(?err, %modules_dir, "tool manifest load failed; using empty registry");
            Arc::new(InMemoryToolRegistry::empty())
        }
    };

    // 2. Run the accessibility bootstrap before Tauri so the system prompt fires early.
    let permission_state = use_cases::ensure_accessibility(&*accessibility);
    tracing::info!("CTRL starting; permission state = {:?}", permission_state);

    // 2b. Boot L1 kernel runtime (Scheduler, McpHost, EventStore, etc).
    let kernel = match KernelRuntime::boot_default() {
        Ok(rt) => Arc::new(rt),
        Err(err) => {
            tracing::error!(?err, "kernel boot failed; running without kernel features");
            return;
        }
    };
    tracing::info!("L1 kernel runtime online");

    tauri::Builder::default()
        .setup({
            let accessibility = accessibility.clone();
            let capture = capture.clone();
            let tool_registry = tool_registry.clone();
            let clipboard = clipboard.clone();
            let browser = browser.clone();
            let keyboard = keyboard.clone();
            let clock = clock.clone();
            let llm = llm.clone();
            let config_store = config_store.clone();
            let secret_store = secret_store.clone();
            let kernel = kernel.clone();
            move |app| {
                // 3. Tauri-bound adapters need an AppHandle — build them inside setup.
                let event_bus: Arc<dyn EventBusPort> =
                    Arc::new(TauriEventBus::new(app.handle().clone()));
                let notifier: Arc<dyn NotifierPort> =
                    Arc::new(TauriNotifier::new(app.handle().clone()));

                // 4. Inbound adapter state — managed inside setup so notifier is wired.
                let app_state = AppState {
                    accessibility: accessibility.clone(),
                    capture: capture.clone(),
                    tool_registry: tool_registry.clone(),
                    clipboard: clipboard.clone(),
                    browser: browser.clone(),
                    notifier: notifier.clone(),
                    llm: llm.clone(),
                    config_store: config_store.clone(),
                    secret_store: secret_store.clone(),
                };
                app.manage(app_state);
                // Tauri shell no longer manages KernelAppState — native UIs
                // call Rust kernel directly via UniFFI bindings (ffi/mod.rs).

                // 5. Start the hotkey pipeline. Returns immediately.
                if let Err(err) = use_cases::start_hotkey_pipeline(
                    keyboard.clone(),
                    clock.clone(),
                    event_bus,
                ) {
                    tracing::error!(?err, "start_hotkey_pipeline failed");
                }
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            check_accessibility,
            open_accessibility_settings,
            capture_selected_text,
            list_tools,
            run_action,
            get_llm_settings,
            set_llm_key,
            bootstrap_minimax,
            set_panel_visible,
            hide_all_panels,
            hide_if_unfocused,
            hide_window,
            peek_clipboard,
            run_chat,
            // Kernel commands lifted off Tauri surface — see ffi/mod.rs for UniFFI surface.
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_llm_gateway(
    config_store: &dyn ConfigStorePort,
    secret_store: &dyn SecretStorePort,
) -> Option<LlmGateway> {
    let settings = match config_store.load_llm_settings() {
        Ok(s) => s,
        Err(err) => {
            tracing::warn!(?err, "load llm settings failed");
            return None;
        }
    };
    if settings.profiles.is_empty() {
        tracing::info!("no LLM profiles configured yet");
        return None;
    }
    let default = settings
        .default_profile
        .clone()
        .unwrap_or_else(|| settings.profiles[0].name.clone());

    let mut configs = Vec::new();
    for p in &settings.profiles {
        // v0.1 spike: prefer inline api_key, fall back to Keychain.
        let key = match (&p.api_key, secret_store.read(&p.name)) {
            (Some(k), _) if !k.is_empty() => {
                tracing::info!(profile = %p.name, "api key from settings.json");
                k.clone()
            }
            (_, Ok(Some(k))) => {
                tracing::info!(profile = %p.name, "api key from keychain");
                k
            }
            (_, Ok(None)) => {
                tracing::warn!(profile = %p.name, "no api key configured; profile skipped");
                continue;
            }
            (_, Err(err)) => {
                tracing::warn!(profile = %p.name, ?err, "keychain read failed");
                continue;
            }
        };
        let kind = match p.kind.as_str() {
            "openai-compatible" => ProviderKind::OpenAiCompatible,
            "anthropic" => ProviderKind::Anthropic,
            other => {
                tracing::warn!(kind = other, "unknown provider kind; profile skipped");
                continue;
            }
        };
        configs.push(ProviderConfig {
            name: p.name.clone(),
            kind,
            base_url: p.base_url.clone(),
            api_key: key,
            default_model: p.default_model.clone(),
        });
    }
    if configs.is_empty() {
        return None;
    }
    match LlmGateway::from_configs(configs, default) {
        Ok(g) => Some(g),
        Err(err) => {
            tracing::error!(?err, "LlmGateway construction failed");
            None
        }
    }
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
        .plugin(tauri_plugin_updater::Builder::new().build())
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
    panic!("CTRL only supports macOS (full) + Windows (stub) currently");
}
