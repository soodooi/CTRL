// Tauri 2 #[tauri::command] handlers — the JS↔Rust bridge.
//
// Per ADR-003 frontend §3 + §6, the PWA calls into the Rust kernel through these
// handlers (instead of the UniFFI path that the W3 .NET surface uses). Each
// command is capability-gated; the kernel's CapabilityBroker decides whether
// the invocation is allowed.
//
// Commands grouped by domain:
//   • kernel   — mcp install / list / run; MCP introspection + invoke
//   • stss     — subscribe / publish / list streams
//   • memory   — read_log / append / query AI memory event store
//   • keychain — BYOK API key store / get / delete
//
// Skeleton stage (sub-PR b): each handler returns NotImplementedYet so the
// JS bridge can be wired before kernel integration in sub-PR c.

// ADR-002 substrate §1 v19 (3-agent aggregator) retirements:
//   pub mod hermes_chat;   ← v18 supervisor-shaped command (retired)
//   pub mod opencode_chat; ← v18 supervisor-shaped command (retired)
//   pub mod pi_rpc;        ← Pi exited CTRL hot path (retired)
// PWA now connects directly to each agent's native endpoint via the new
// `agents` command surface (install_agent / launch_agent / agent_status /
// stop_agent). Streaming + tool calling happen agent-to-PWA, not kernel-mediated.
pub mod agents;
// Obsidian Local REST API connector (ADR-002 §1.9.1).
pub mod obsidian;
pub mod chat;
// ADR-002 substrate § capability-faces v19 §13.4 (2026-06-09): image
// generation surface. Currently fal.ai-only; multi-provider routing for
// image.generate lands when the second image provider is wired.
pub mod image;
pub mod screenshot;
pub mod code_space;
pub mod config;
pub mod draft;
pub mod draft_run;
pub mod gate;
// ADR-002 substrate § vault v1 §8.6 v5 (2026-06-01) — vault-side git via git CLI
// (cheaper than libgit2/isomorphic-git). Powers the Notes app Git
// panel: status / init / commit_all / push / log.
pub mod git;
pub mod hermes_acp;
pub mod irisy;
pub mod irisy_chat;
pub mod kernel;
pub mod keychain;
pub mod memory;
pub mod provider;
// bao 2026-06-06: provider preset list = data file (bundled +
// ~/.ctrl/provider-templates.json user override), not hardcoded.
// 2026-06-19 (decision 0007): cloud-sourced refresh layer between
// bundled and user — new model ids arrive without a CTRL release.
pub mod cloud_catalog;
// 2026-06-19 (decision 0007 §per-provider-models): opencode-style live
// /models fetch — provider's own endpoint is the source of truth, not
// the catalog's static defaultModel.
pub mod provider_models;
pub mod provider_templates;
pub mod skills;
pub mod storage;
pub mod stss;
pub mod system;
pub mod updater;
pub mod vault;
// (commands/vault_embeddings.rs retired 2026-06-24 — moved to the :17873 gate,
//  PWA calls via gate_invoke; kernel logic stays in kernel/vault_embeddings.rs.)
// Irisy synthesize — Layer 4 product surface (brainstorm §5.3/§5.5/§5.10)
pub mod irisy_synth;
pub mod workshop;

/// Returns the `invoke_handler!` tuple for `tauri::Builder::invoke_handler`.
/// Call sites use this to keep the handler list in one place.
#[macro_export]
macro_rules! pwa_invoke_handler {
    () => {
        tauri::generate_handler![
            // gate_invoke — PWA cross-domain capability bridge (comms-system-design
            // Phase B): one governed path through :17873, replaces bespoke
            // per-capability Tauri commands as they retire.
            $crate::commands::gate::gate_invoke,
            // kernel
            $crate::commands::kernel::list_mcps,
            $crate::commands::kernel::install_mcp,
            $crate::commands::kernel::install_mcpb,
            $crate::commands::kernel::install_mcp_from_mcp,
            $crate::commands::kernel::run_mcp,
            $crate::commands::kernel::run_action,
            $crate::commands::kernel::uninstall_mcp,
            $crate::commands::kernel::read_mcp_manifest,
            $crate::commands::kernel::set_mcp_config,
            // chat — raw streaming LLM via Tauri events (mcp-internal use)
            $crate::commands::chat::chat_stream,
            // irisy_chat — Irisy persona PWA shell streaming endpoint.
            // ADR-005 v5: Irisy = persona shell, not brain. Routes to whichever
            // agent matches the active L1 chip (default hermes via /assistant).
            $crate::commands::irisy_chat::irisy_chat_stream,
            // Irisy conversation history (reads hermes session store) — vault 0013
            $crate::commands::hermes_acp::irisy_session_list,
            $crate::commands::hermes_acp::irisy_session_get,
            // agents — 3-agent aggregator (ADR-002 §1 v19): install / launch /
            // stop / status. PWA owns retry; kernel does not supervise.
            $crate::commands::agents::install_agent,
            $crate::commands::agents::launch_agent,
            $crate::commands::agents::stop_agent,
            $crate::commands::agents::agent_status,
            $crate::commands::agents::list_agents,
            // connect_agent_mcp — hermes (mcp-stdio) onto the kernel MCP bus
            // (ADR-002 §1.3 v19); PWA chats via mcp_call afterwards.
            $crate::commands::agents::connect_agent_mcp,
            // Obsidian Local REST API connector (ADR-002 §1.9.1)
            $crate::commands::obsidian::obsidian_status,
            $crate::commands::obsidian::obsidian_connect,
            $crate::commands::obsidian::obsidian_provision,
            $crate::commands::obsidian::obsidian_launch,
            // assistant_oneshot — hermes -z bridge until the ACP
            // streaming client lands (ADR-002 §1.1 v20, 2026-06-10).
            $crate::commands::agents::assistant_oneshot,
            // image — fal.ai BYOK image generation (ADR-002 §13.4 v19)
            $crate::commands::image::image_generate,
            $crate::commands::screenshot::capture_screen_and_ocr,
            // ADR-002 §1 v19 retirements (commands no longer registered):
            //   hermes_chat::hermes_chat_stream — PWA now talks MCP stdio directly
            //   opencode_chat::opencode_chat_stream — PWA now talks HTTP directly
            //   pi_rpc::{pi_rpc, pi_sessions, restart_brain} — Pi exited
            //   system::{pi_status, pi_upgrade_now} — Pi install retired
            // ollama install / hermes3:8b auto-pull (Pi-first, bao 2026-06-05)
            $crate::commands::system::ollama_status,
            $crate::commands::system::ollama_pull_default,
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
            // ADR-002 substrate § provider v9 §3.7 (2026-06-06): SSOT
            // INTENT projection — Settings UI and the PWA chat-header
            // chip both consume this (Pi runtime truth retired with Pi,
            // ADR-002 §1 v19).
            $crate::commands::provider::get_active_providers,
            $crate::commands::provider::provider_list,
            $crate::commands::provider::provider_set_active,
            $crate::commands::provider::provider_detect,
            $crate::commands::provider_templates::list_provider_templates,
            // cloud-sourced catalog refresh — fire-and-forget on boot +
            // Settings → Providers Refresh button (decision 0007, 2026-06-19)
            $crate::commands::provider_templates::refresh_provider_catalog,
            // opencode-style live model list — GET {baseUrl}/models
            // (decision 0007 §per-provider-models, 2026-06-19)
            $crate::commands::provider_models::provider_list_models,
            $crate::commands::provider_models::provider_query_models,
            // system — explicit window hide for the StatusBar × button
            // (click fallback when Ctrl hotkey state desyncs)
            $crate::commands::system::hide_window,
            // system — dynamic window growth for COMPANION mode
            // (bao 2026-05-30: "the whole window flows downward")
            $crate::commands::system::set_window_height,
            $crate::commands::system::position_window_top_right,
            // system — input-companion-window retired (bao 2026-05-31:
            // composer moved inside Irisy chat column). destroy_input_window
            // closes any persisted instance from a previous launch.
            $crate::commands::system::destroy_input_window,
            // system — workspace expansion via main window self-resize
            // (bao 2026-05-30 final clarification: "open on the left side,
            // not a floating pane"). Main slides left edge 430 ↔ 1600. CSS @media
            // drives the expanded grid. No independent NSWindow.
            $crate::commands::system::toggle_workspace_window,
            // system — idempotent expand for L1 chip clicks. Unlike toggle,
            // calling this when already expanded is a no-op; never collapses.
            // bao 2026-06-03: closes "L1 vault button can't open workspace".
            $crate::commands::system::ensure_workspace_window_expanded,
            // ADR-002 substrate § provider v11 §3.11 (2026-06-07): L1
            // chip click-toggle counterpart.
            $crate::commands::system::collapse_workspace_window,
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
            // ST-SS protocol surface retired to one load-bearing call (SC6,
            // ADR-010 § transports v5): the stream is a plain CBOR-over-WS, so
            // only `subscribe` (hand the PWA the authed WS URL) remains; the
            // publish / list_streams / get_bridge_token commands were dead.
            $crate::commands::stss::subscribe,
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
            // draft — workshop authoring state under ~/.ctrl/mcps/.drafts/
            $crate::commands::draft::draft_list,
            $crate::commands::draft::draft_read,
            $crate::commands::draft::draft_save,
            $crate::commands::draft::draft_delete,
            $crate::commands::draft::draft_record_run,
            $crate::commands::draft::draft_list_runs,
            // draft_run — sandbox execution + per-step trace for canvas preview
            $crate::commands::draft_run::run_mcp_draft,
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
            // Retired 2026-06-24 (comms-system-design Phase B): the vault /
            // smart-table / embeddings / sourcing capability commands moved to
            // the :17873 gate; the PWA now calls them via gate_invoke. Only the
            // commands without an exact MCP twin stay as Tauri commands
            // (vault_write_image / vault_watch_recent / irisy_soul_*).
            $crate::commands::vault::vault_write_image,
            $crate::commands::vault::vault_watch_recent,
            // SOUL.md (Irisy persistent memory) retired to the gate's memory-domain
            // tools irisy_soul_get/set (SC5 convergence); PWA reaches them via gate_invoke.
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
            // localstorage — small persistent JSON KV per mcp
            $crate::commands::storage::localstorage_get,
            $crate::commands::storage::localstorage_set,
            $crate::commands::storage::localstorage_remove,
            $crate::commands::storage::localstorage_list,
            $crate::commands::storage::localstorage_clear,
            // cache — transient blob LRU per mcp
            $crate::commands::storage::cache_get,
            $crate::commands::storage::cache_set,
            $crate::commands::storage::cache_remove,
            $crate::commands::storage::cache_clear,
            $crate::commands::storage::cache_total_bytes,
        ]
    };
}
