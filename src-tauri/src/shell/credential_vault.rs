// Credential vault — encrypted file at `~/.ctrl/credentials.dat`.
//
// bao 2026-06-06: Option B per ctrl-provider-management skill. Replaces
// the OS keychain (option A — needs Apple Developer entitlements that
// CTRL doesn't have yet) and the subprocess `security` CLI workaround
// (option C — macOS-only, Tahoe-fragile). The vault is one encrypted
// file containing a JSON map { provider_id -> api_key }.
//
// Crypto: `cocoon::MiniCocoon` (chacha20-poly1305 envelope, version 0)
// with a 32-byte key derived from machine-bound entropy:
//   hostname || ":" || bundle id  ->  SHA-256
// This keeps the vault portable across CTRL versions on the same
// machine but unreadable on a different machine without the same
// `hostname` + bundle id (which would mean someone copied the file +
// matched the install).
//
// A future iteration can layer a user-supplied master passphrase on
// top: the derived machine key wraps a per-vault key, and the
// passphrase is required to unlock the wrap. v1 ships without that
// gate so the user does not see a password prompt on every CTRL boot.
//
// Migration: `migrate_from_keychain(slugs)` reads each slug from the
// macOS keychain (via `keychain_subprocess`) once on boot. Anything it
// finds is rewritten into the vault. Subsequent reads come exclusively
// from the vault.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use cocoon::MiniCocoon;
use sha2::{Digest, Sha256};

/// Bundle id used as a stable per-install secret namespace.
/// Mirrors `tauri.conf.json` `identifier`.
const BUNDLE_ID: &str = "app.ctrl.spike";

/// In-memory cache so we do not re-read + decrypt the file on every
/// provider lookup. Single-process owner is the CTRL binary.
static CACHE: Mutex<Option<BTreeMap<String, String>>> = Mutex::new(None);

fn vault_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("HOME not set")?;
    Ok(PathBuf::from(home).join(".ctrl").join("credentials.dat"))
}

/// Derive the 32-byte encryption key from machine-bound entropy.
/// Same inputs => same key, so the vault round-trips across CTRL
/// restarts. Different machine => different key => unreadable vault.
fn derive_key() -> [u8; 32] {
    let host = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown-host".to_string());
    let mut h = Sha256::new();
    h.update(host.as_bytes());
    h.update(b":");
    h.update(BUNDLE_ID.as_bytes());
    let out = h.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&out);
    key
}

fn load() -> Result<BTreeMap<String, String>, String> {
    if let Some(cached) = CACHE.lock().unwrap().clone() {
        return Ok(cached);
    }
    let path = vault_path()?;
    if !path.exists() {
        let empty = BTreeMap::new();
        *CACHE.lock().unwrap() = Some(empty.clone());
        return Ok(empty);
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("vault read {}: {e}", path.display()))?;
    let key = derive_key();
    // MiniCocoon needs a 16-byte seed in addition to the key; we use a
    // constant seed derived from the bundle id so the same input
    // round-trips. The encryption strength comes from the 32-byte key.
    let mut seed = [0u8; 32];
    let h = Sha256::digest(BUNDLE_ID.as_bytes());
    seed.copy_from_slice(&h);
    let mut cocoon = MiniCocoon::from_key(&key, &seed);
    let plaintext = cocoon
        .unwrap(&bytes)
        .map_err(|e| format!("vault decrypt: {e:?}"))?;
    let map: BTreeMap<String, String> =
        serde_json::from_slice(&plaintext).map_err(|e| format!("vault JSON parse: {e}"))?;
    *CACHE.lock().unwrap() = Some(map.clone());
    Ok(map)
}

fn save(map: &BTreeMap<String, String>) -> Result<(), String> {
    let path = vault_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("vault mkdir {}: {e}", parent.display()))?;
    }
    let plaintext = serde_json::to_vec(map).map_err(|e| format!("vault JSON encode: {e}"))?;
    let key = derive_key();
    let mut seed = [0u8; 32];
    let h = Sha256::digest(BUNDLE_ID.as_bytes());
    seed.copy_from_slice(&h);
    let mut cocoon = MiniCocoon::from_key(&key, &seed);
    let ciphertext = cocoon
        .wrap(&plaintext)
        .map_err(|e| format!("vault encrypt: {e:?}"))?;
    // Atomic write — tmp then rename so a partial write never corrupts
    // a previously-good vault.
    let tmp_path = path.with_extension("dat.tmp");
    std::fs::write(&tmp_path, &ciphertext)
        .map_err(|e| format!("vault tmp write {}: {e}", tmp_path.display()))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("vault rename {} -> {}: {e}", tmp_path.display(), path.display()))?;
    *CACHE.lock().unwrap() = Some(map.clone());
    Ok(())
}

pub fn set(account: &str, value: &str) -> Result<(), String> {
    if account.is_empty() {
        return Err("vault set: account is empty".into());
    }
    let mut map = load()?;
    map.insert(account.to_string(), value.to_string());
    save(&map)
}

pub fn get(account: &str) -> Result<Option<String>, String> {
    if account.is_empty() {
        return Err("vault get: account is empty".into());
    }
    let map = load()?;
    if let Some(secret) = map.get(account).cloned() {
        return Ok(Some(secret));
    }
    // bao 2026-06-06: auto-migrate on miss. The pre-vault build wrote
    // credentials via `security` CLI subprocess. When we see a vault
    // miss, check the keychain once; if the key is there, copy it
    // into the vault so subsequent reads are fast and the keychain
    // entry can eventually be deleted by the user without losing the
    // key. Pure read-through cache + opportunistic migration.
    match crate::shell::keychain_subprocess::get(account) {
        Ok(Some(secret)) if !secret.is_empty() => {
            let _ = set(account, &secret);
            tracing::info!(account, "vault: auto-migrated entry from keychain");
            Ok(Some(secret))
        }
        _ => Ok(None),
    }
}

pub fn delete(account: &str) -> Result<(), String> {
    if account.is_empty() {
        return Err("vault delete: account is empty".into());
    }
    let mut map = load()?;
    if map.remove(account).is_some() {
        save(&map)?;
    }
    Ok(())
}

/// One-shot boot-time migration from the macOS Keychain into the
/// vault. Reads each candidate slug; anything present is moved into
/// the vault (and intentionally NOT deleted from the keychain — a
/// belt-and-suspenders fallback in case the user reverts a build).
pub fn migrate_from_keychain(slugs: &[&str]) {
    let mut map = match load() {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(error = %e, "vault: load failed during migration; aborting migrate");
            return;
        }
    };
    let mut migrated = 0usize;
    for slug in slugs {
        if map.contains_key(*slug) {
            continue;
        }
        if let Ok(Some(secret)) = crate::shell::keychain_subprocess::get(slug) {
            if !secret.is_empty() {
                map.insert((*slug).to_string(), secret);
                migrated += 1;
            }
        }
    }
    if migrated > 0 {
        if let Err(e) = save(&map) {
            tracing::warn!(error = %e, "vault: save failed during migration");
        } else {
            tracing::info!(count = migrated, "vault: migrated entries from keychain");
        }
    }
}
