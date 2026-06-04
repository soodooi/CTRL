// Tauri 2 #[tauri::command] handlers — the JS↔Rust bridge.
//
// Per ADR-003 frontend §3 + §6, the PWA calls into the Rust kernel through these
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

// brain retired per ADR-002 substrate (Pi is the sole brain — see file header
// for context); module not declared so the file is not compiled.
pub mod chat;
pub mod code_space;
pub mod config;
pub mod draft;
pub mod draft_run;
// ADR-002 § vault v1 §8.6 v5 (2026-06-03) — vault-side git via git CLI
// (cheaper than libgit2/isomorphic-git). Powers the Notes app Git
// panel: status / init / commit_all / push / log.
pub mod git;
pub mod irisy;
pub mod irisy_chat;
pub mod kernel;
pub mod keychain;
pub mod memory;
pub mod provider;
pub mod skills;
pub mod storage;
pub mod stss;
pub mod system;
pub mod updater;
pub mod vault;
// Vault embeddings — 5 new commands (ADR-002 v5 §10.4)
pub mod vault_embeddings;
// Irisy synthesize — Layer 4 product surface (brainstorm §5.3/§5.5/§5.10)
pub mod irisy_synth;
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
            // brain switcher retired per ADR-002 substrate — Pi is the sole brain.
            // Pi version + upgrade controls live in system::pi_status /
            // pi_upgrade_now.
            $crate::commands::system::pi_status,
            $crate::commands::system::pi_upgrade_now,
            // irisy — init status (kernel llm / Pi brain / mcp bridge)
            $crate::commands::irisy::irisy_init,
            // system — kernel health (PWA status bar Phase 1F)
            $crate::commands::system::kernel_status,
            // provider — ADR-002 substrate § provider v2 §3.6 + §3.7
            // brain_status: Irisy self-awareness (closes "doesn't know stack" gap)
            // provider_list: /settings/providers picker rows
            // provider_set_active: 2-role assignment with trial-verify
            // provider_detect: PATH scan for known CLIs (cached)
            $crate::commands::provider::brain_status,
            $crate::commands::provider::provider_list,
            $crate::commands::provider::provider_set_active,
            $crate::commands::provider::provider_detect,
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
            // system — idempotent expand for L1 chip clicks. Unlike toggle,
            // calling this when already expanded is a no-op; never collapses.
            // bao 2026-06-03: closes "L1 vault button can't open workspace".
            $crate::commands::system::ensure_workspace_window_expanded,
            // updater — safe macOS relaunch after auto-update (Chrome-style
            // detached helper, sidesteps the Tauri 2 race)
            $crate::commands::updater::safe_relaunch_after_update,
            $crate::commands::kernel::mcp_call,
            $crate::commands::kernel::list_mcp_servers,
            $crate::commands::kernel::open_workspace,
            // skills — kernel-local skill discovery (ADR-007 workbench § discovery v1 Phase 1)
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
            // vault — plain-text markdown store. ADR-002 § vault v1 §8.3, 2026-06-01.
            // §8 expanded the surface from 8 → 21 commands; the first 8 keep their
            // original signatures, the remaining 13 expose the link/tag/mention/
            // orphan/broken/graph scanner (vault_graph), single-file mutations
            // (rename/move/create_folder/set_starred), and the notify-backed
            // watcher poll (vault_watch). Daily Note + Sourcing are NOT here —
            // those run at the feature layer per §8.4.
            $crate::commands::vault::vault_write,
            $crate::commands::vault::vault_write_image,
            $crate::commands::vault::vault_read,
            $crate::commands::vault::vault_list,
            $crate::commands::vault::vault_search,
            $crate::commands::vault::vault_delete,
            $crate::commands::vault::vault_root_path,
            $crate::commands::vault::vault_rebuild_index,
            $crate::commands::vault::vault_backlinks,
            $crate::commands::vault::vault_tags,
            $crate::commands::vault::vault_notes_by_tag,
            $crate::commands::vault::vault_mentions,
            $crate::commands::vault::vault_orphans,
            $crate::commands::vault::vault_broken_links,
            $crate::commands::vault::vault_graph_data,
            $crate::commands::vault::vault_rename,
            $crate::commands::vault::vault_move,
            $crate::commands::vault::vault_create_folder,
            $crate::commands::vault::vault_set_starred,
            $crate::commands::vault::vault_aliases,
            $crate::commands::vault::vault_watch_recent,
            // ADR-002 § vault v1 §8.4 sourcing-workflow (2026-06-01) —
            // kernel-seeded review-queue producer (Irisy attaches the
            // richer LLM pass on top of the same file).
            $crate::commands::vault::vault_sourcing_run,
            $crate::commands::vault::vault_sourcing_pending,
            // SOUL.md — Irisy persistent memory file (ADR-005 v2 § soul-md-compat §4.3)
            $crate::commands::vault::irisy_soul_read,
            $crate::commands::vault::irisy_soul_write,
            // Vault embeddings (ADR-002 v5 §10) — local Ollama + SQLite flat cosine
            $crate::commands::vault_embeddings::vault_embed_note,
            $crate::commands::vault_embeddings::vault_reembed_all,
            $crate::commands::vault_embeddings::vault_embedding_status,
            $crate::commands::vault_embeddings::vault_semantic_search,
            $crate::commands::vault_embeddings::vault_suggest_links,
            // Irisy synthesize — Layer 4 (question vault / cross-note / daily)
            $crate::commands::irisy_synth::irisy_question_vault,
            $crate::commands::irisy_synth::irisy_synthesize_notes,
            $crate::commands::irisy_synth::irisy_daily_summarize,
            // git — vault-side CLI shim (§8.6 v5)
            $crate::commands::git::git_status,
            $crate::commands::git::git_init,
            $crate::commands::git::git_commit_all,
            $crate::commands::git::git_push,
            $crate::commands::git::git_log,
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
