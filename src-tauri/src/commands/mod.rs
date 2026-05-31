// Tauri 2 #[tauri::command] handlers — the JS↔Rust bridge.
//
// Per ADR-002 §3 + §6, the PWA calls into the Rust kernel through these
// handlers (instead of the UniFFI path that the W3 .NET surface uses). Each
// command is capability-gated; the kernel's CapabilityBroker decides whether
// the invocation is allowed.
//
// Commands grouped by domain:
//   • kernel   — keycap install / list / run; MCP introspection + invoke
//   • stss     — subscribe / publish / list streams
//   • memory   — read_log / append / query AI memory event store
//   • keychain — BYOK API key store / get / delete
//
// Skeleton stage (sub-PR b): each handler returns NotImplementedYet so the
// JS bridge can be wired before kernel integration in sub-PR c.

// brain retired per ADR-003 (Pi is the sole brain — see file header
// for context); module not declared so the file is not compiled.
pub mod chat;
pub mod code_space;
pub mod config;
pub mod draft;
pub mod draft_run;
pub mod irisy;
pub mod irisy_chat;
pub mod kernel;
pub mod keychain;
pub mod memory;
pub mod skills;
pub mod storage;
pub mod stss;
pub mod system;
pub mod updater;
pub mod vault;
pub mod workshop;

/// Returns the `invoke_handler!` tuple for `tauri::Builder::invoke_handler`.
/// Call sites use this to keep the handler list in one place.
#[macro_export]
macro_rules! pwa_invoke_handler {
    () => {
        tauri::generate_handler![
            // kernel
            $crate::commands::kernel::list_keycaps,
            $crate::commands::kernel::install_keycap,
            $crate::commands::kernel::install_keycap_from_mcp,
            $crate::commands::kernel::run_keycap,
            $crate::commands::kernel::uninstall_keycap,
            $crate::commands::kernel::read_keycap_manifest,
            $crate::commands::kernel::set_keycap_config,
            // chat — raw streaming LLM via Tauri events (keycap-internal use)
            $crate::commands::chat::chat_stream,
            // irisy_chat — brain-routed streaming (Irisy → active brain keycap MCP)
            $crate::commands::irisy_chat::irisy_chat_stream,
            // brain switcher retired per ADR-003 — Pi is the sole brain.
            // Pi version + upgrade controls live in system::pi_status /
            // pi_upgrade_now.
            $crate::commands::system::pi_status,
            $crate::commands::system::pi_upgrade_now,
            // irisy — init status (kernel llm / Pi brain / mcp bridge)
            $crate::commands::irisy::irisy_init,
            // system — kernel health (PWA status bar Phase 1F)
            $crate::commands::system::kernel_status,
            // system — explicit window hide for the StatusBar × button
            // (click fallback when Ctrl hotkey state desyncs)
            $crate::commands::system::hide_window,
            // system — dynamic window growth for COMPANION mode
            // (bao 2026-05-30: "整个窗口往下流")
            $crate::commands::system::set_window_height,
            $crate::commands::system::position_window_top_right,
            // system — input-companion-window retired (bao 2026-05-31:
            // composer moved inside Irisy chat column). destroy_input_window
            // closes any persisted instance from a previous launch.
            $crate::commands::system::destroy_input_window,
            // system — workspace expansion via main window self-resize
            // (bao 2026-05-30 final clarification: "左侧打开的意思，
            // 不是浮窗"). Main slides left edge 430 ↔ 1600. CSS @media
            // drives the expanded grid. No independent NSWindow.
            $crate::commands::system::toggle_workspace_window,
            // updater — safe macOS relaunch after auto-update (Chrome-style
            // detached helper, sidesteps the Tauri 2 race)
            $crate::commands::updater::safe_relaunch_after_update,
            $crate::commands::kernel::mcp_call,
            $crate::commands::kernel::list_mcp_servers,
            $crate::commands::kernel::open_workspace,
            // skills — kernel-local skill discovery (ADR-023 Phase 1)
            $crate::commands::skills::search_skills,
            $crate::commands::skills::list_local_skills,
            // stss
            $crate::commands::stss::subscribe,
            $crate::commands::stss::publish,
            $crate::commands::stss::list_streams,
            $crate::commands::stss::get_bridge_token,
            // memory
            $crate::commands::memory::read_log,
            $crate::commands::memory::append_event,
            $crate::commands::memory::query,
            // keychain
            $crate::commands::keychain::store_key,
            $crate::commands::keychain::get_key,
            $crate::commands::keychain::delete_key,
            // config — typed LLM provider configuration (Settings → Provider tab)
            $crate::commands::config::config_list_providers,
            $crate::commands::config::config_set_provider_key,
            $crate::commands::config::config_test_provider,
            $crate::commands::config::config_delete_provider,
            // draft — workshop authoring state under ~/.ctrl/keycaps/.drafts/
            $crate::commands::draft::draft_list,
            $crate::commands::draft::draft_read,
            $crate::commands::draft::draft_save,
            $crate::commands::draft::draft_delete,
            $crate::commands::draft::draft_record_run,
            $crate::commands::draft::draft_list_runs,
            // draft_run — sandbox execution + per-step trace for canvas preview
            $crate::commands::draft_run::run_keycap_draft,
            // workshop — composite canvas operations (read-modify-save in one call)
            $crate::commands::workshop::workshop_add_step,
            $crate::commands::workshop::workshop_update_step,
            $crate::commands::workshop::workshop_remove_step,
            $crate::commands::workshop::workshop_move_step,
            // code_space — coding remote desktop (ST-SS spec v0.7 wire)
            $crate::commands::code_space::cs_spawn,
            $crate::commands::code_space::cs_stdin,
            $crate::commands::code_space::cs_signal,
            $crate::commands::code_space::cs_resize,
            $crate::commands::code_space::cs_kill,
            $crate::commands::code_space::cs_list,
            // vault — Obsidian-compatible local-first markdown store
            $crate::commands::vault::vault_write,
            $crate::commands::vault::vault_write_image,
            $crate::commands::vault::vault_read,
            $crate::commands::vault::vault_list,
            $crate::commands::vault::vault_search,
            $crate::commands::vault::vault_delete,
            $crate::commands::vault::vault_root_path,
            $crate::commands::vault::vault_rebuild_index,
            // localstorage — small persistent JSON KV per keycap
            $crate::commands::storage::localstorage_get,
            $crate::commands::storage::localstorage_set,
            $crate::commands::storage::localstorage_remove,
            $crate::commands::storage::localstorage_list,
            $crate::commands::storage::localstorage_clear,
            // cache — transient blob LRU per keycap
            $crate::commands::storage::cache_get,
            $crate::commands::storage::cache_set,
            $crate::commands::storage::cache_remove,
            $crate::commands::storage::cache_clear,
            $crate::commands::storage::cache_total_bytes,
        ]
    };
}
