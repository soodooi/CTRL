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

// Production service identifier. Was `app.ctrl.spike` during the P0/P1 spike;
// renamed before any user-stored BYOK key shipped so we don't strand secrets
// in a deprecated namespace later (pre-merge review M3). The legacy id stays
// readable below so any spike-era dev install migrates seamlessly on first
// read (H-2026-05-19-003).
const SERVICE: &str = "app.ctrl";
const LEGACY_SERVICE: &str = "app.ctrl.spike";

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
    ///
    /// One-shot migration: if the new SERVICE has no entry but the legacy
    /// spike-era SERVICE does, copy it across and delete the old — the next
    /// read finds the new entry directly.
    pub fn get(account: &str) -> Result<Option<String>> {
        let entry = keyring::Entry::new(SERVICE, account)
            .with_context(|| format!("keyring entry for {account}"))?;
        match entry.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => migrate_legacy(account, &entry),
            Err(e) => Err(e).with_context(|| format!("keyring read for {account}")),
        }
    }

    /// Delete a secret. Idempotent — missing entry is treated as success.
    /// Also clears the legacy entry if one happens to exist (e.g. user deleted
    /// a key that had just been migrated and the legacy delete previously
    /// best-effort failed).
    pub fn delete(account: &str) -> Result<()> {
        let entry = keyring::Entry::new(SERVICE, account)
            .with_context(|| format!("keyring entry for {account}"))?;
        let result = match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e).with_context(|| format!("keyring delete for {account}")),
        };
        // Sweep any leftover legacy entry too; ignore NoEntry.
        if let Ok(legacy) = keyring::Entry::new(LEGACY_SERVICE, account) {
            let _ = legacy.delete_credential();
        }
        result
    }
}

fn migrate_legacy(account: &str, new_entry: &keyring::Entry) -> Result<Option<String>> {
    let legacy = keyring::Entry::new(LEGACY_SERVICE, account)
        .with_context(|| format!("legacy keyring entry for {account}"))?;
    match legacy.get_password() {
        Ok(secret) => {
            tracing::info!(
                account = account,
                from = LEGACY_SERVICE,
                to = SERVICE,
                "keychain: migrating BYOK entry",
            );
            new_entry
                .set_password(&secret)
                .with_context(|| format!("keyring migrate write for {account}"))?;
            // Best-effort sweep — next read hits the new entry first either way.
            let _ = legacy.delete_credential();
            Ok(Some(secret))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e).with_context(|| format!("keyring legacy read for {account}")),
    }
}
