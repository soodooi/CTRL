// Settings storage adapters.
//   - FileConfigStore: JSON file at ~/Library/Application Support/CTRL/settings.json
//   - KeychainSecretStore: macOS Keychain entries under service "app.ctrl.spike"
//
// Why split: non-secret config (profile name / base_url / model) goes in plain JSON
// (versionable, debuggable). API keys go in Keychain (OS-encrypted, not on disk in plain).

pub mod file_store;
pub mod keychain;

pub use file_store::FileConfigStore;
pub use keychain::KeychainSecretStore;
