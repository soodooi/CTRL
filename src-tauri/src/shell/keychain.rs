// OS keychain bridge for BYOK API keys.
//
// Per ADR-002 §6, BYOK uses the system keychain (Win Credential Vault /
// macOS Keychain) via the `keyring` crate that's already in this crate.
//
// Wrap it behind a thin port-shaped type so future swap to
// tauri-plugin-stronghold (encrypted-at-rest snapshot file) is a one-line
// change at the call site.
//
// Service id is shared across the app per `setup_llm_key.rs` convention.

use anyhow::{Context, Result};

const SERVICE: &str = "app.ctrl.spike";

pub struct KeychainStore;

impl KeychainStore {
    /// Store a secret for `account` (e.g. "anthropic", "openai").
    pub fn store(account: &str, value: &str) -> Result<()> {
        let entry = keyring::Entry::new(SERVICE, account)
            .with_context(|| format!("keyring entry for {account}"))?;
        entry
            .set_password(value)
            .with_context(|| format!("keyring write for {account}"))?;
        // Verify round-trip without logging the value.
        let _ = entry
            .get_password()
            .with_context(|| format!("keyring read-back for {account}"))?;
        Ok(())
    }

    /// Read a secret. Returns `None` if no entry exists.
    pub fn get(account: &str) -> Result<Option<String>> {
        let entry = keyring::Entry::new(SERVICE, account)
            .with_context(|| format!("keyring entry for {account}"))?;
        match entry.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e).with_context(|| format!("keyring read for {account}")),
        }
    }

    /// Delete a secret. Idempotent — missing entry is treated as success.
    pub fn delete(account: &str) -> Result<()> {
        let entry = keyring::Entry::new(SERVICE, account)
            .with_context(|| format!("keyring entry for {account}"))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e).with_context(|| format!("keyring delete for {account}")),
        }
    }
}
