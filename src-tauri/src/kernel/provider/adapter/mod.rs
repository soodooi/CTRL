// Adapter implementations of the `Provider` trait — one file per
// transport family. Adding a new provider almost never means a new file
// here: 9 cloud LLMs all share `http_api.rs`, 2 CLIs share `cli/`.

pub mod cli;
pub mod http_api;

pub use cli::claude_persistent::ClaudePersistentProvider;
pub use cli::one_shot::OneShotCliProvider;
pub use http_api::HttpApiProvider;
