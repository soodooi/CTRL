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

pub mod chat;
pub mod code_space;
pub mod kernel;
pub mod keychain;
pub mod memory;
pub mod storage;
pub mod stss;
pub mod vault;

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
            // chat — streaming LLM via Tauri events (Irisy companion)
            $crate::commands::chat::chat_stream,
            $crate::commands::kernel::mcp_call,
            $crate::commands::kernel::list_mcp_servers,
            $crate::commands::kernel::open_workspace,
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
            // code_space — coding 远程桌面 (ST-SS spec v0.7 wire)
            $crate::commands::code_space::cs_spawn,
            $crate::commands::code_space::cs_stdin,
            $crate::commands::code_space::cs_signal,
            $crate::commands::code_space::cs_resize,
            $crate::commands::code_space::cs_kill,
            $crate::commands::code_space::cs_list,
            // vault — Obsidian-compatible local-first markdown store
            $crate::commands::vault::vault_write,
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
