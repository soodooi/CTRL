// Credential vault — encrypted file at `~/.ctrl/credentials.dat`.
//
// bao 2026-06-06: Option B per ctrl-provider-management skill. Replaces
// the OS keychain (option A — needs Apple Developer entitlements that
// CTRL doesn't have yet) and the subprocess `security` CLI workaround
// (option C — macOS-only, Tahoe-fragile). The vault is one encrypted
// file containing a JSON map { provider_id -> api_key }.
//
// Crypto: `cocoon::MiniCocoon` (chacha20-poly1305 envelope, version 0)
// with a 32-byte key derived as:
//   SHA-256( machine_secret || hostname || bundle id )
// where `machine_secret` is 32 random bytes generated on first use and
// stored in the OS keychain (service "app.ctrl", account
// "credential-vault-master"). The machine secret is the dominant entropy:
// hostname + bundle id alone are non-secret, so without the keychained
// secret the vault file cannot be decrypted offline even by someone who
// knows the host name and copied the file (OWASP A02 fix, bao 2026-06-08).
//
// Seed / nonce: MiniCocoon seeds an internal RNG from the `seed` argument
// and draws the AEAD nonce from it. The nonce is embedded in the wrapped
// container, so `unwrap` does NOT need the seed reconstructed. We therefore
// pass a FRESH 32 random bytes as the seed on every `save`, which yields a
// fresh-random nonce per encryption — identical plaintext no longer maps to
// identical ciphertext (nonce-reuse fix, bao 2026-06-08).
//
// On-disk format: unchanged — the file is exactly the MiniCocoon wrapped
// container (`wrap()` output: serialized prefix with the embedded nonce +
// tag, followed by the ChaCha20-Poly1305 ciphertext). The seed/nonce lives
// inside that container; no sidecar is needed.
//
// Migration: if decryption with the new machine-secret key fails (e.g. a
// vault written by the old hostname-only derivation), `load` retries with
// the legacy key (SHA-256(hostname || ":" || bundle id)) and, on success,
// re-encrypts under the new key so the next read is upgraded.
//
// Boot migration: `migrate_from_keychain(slugs)` reads each slug from the
// macOS keychain (via `keychain_subprocess`) once on boot. Anything it
// finds is rewritten into the vault. Subsequent reads come exclusively
// from the vault.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use cocoon::MiniCocoon;
use sha2::{Digest, Sha256};

/// Bundle id used as a stable per-install secret namespace.
/// Mirrors `tauri.conf.json` `identifier`. Aligned with `keychain.rs`
/// (`app.ctrl`) so all keychain entries share one namespace; the legacy
/// `app.ctrl.spike` derivation is still accepted via the migration path.
const BUNDLE_ID: &str = "app.ctrl";

/// Legacy bundle id used before the namespace was unified. Retained ONLY
/// for the decryption migration path in `load`.
const LEGACY_BUNDLE_ID: &str = "app.ctrl.spike";

/// Keychain account holding the 32-byte per-machine master secret that is
/// the dominant entropy in the vault key derivation.
const MASTER_SECRET_ACCOUNT: &str = "credential-vault-master";

/// In-memory cache so we do not re-read + decrypt the file on every
/// provider lookup. Single-process owner is the CTRL binary.
static CACHE: Mutex<Option<BTreeMap<String, String>>> = Mutex::new(None);

fn vault_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("HOME not set")?;
    Ok(PathBuf::from(home).join(".ctrl").join("credentials.dat"))
}

/// Current machine hostname (or a stable fallback). One of the three
/// inputs mixed into the key derivation.
fn machine_hostname() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown-host".to_string())
}

/// Fetch (or, on first use, generate + persist) the 32-byte per-machine
/// master secret from the OS keychain. This is the dominant entropy in the
/// key derivation — without it the vault file is undecryptable offline.
///
/// Fails closed: if keychain access errors, we return an error rather than
/// silently degrading to the weak hostname-only key.
fn machine_secret() -> Result<[u8; 32], String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    match crate::shell::KeychainStore::get(MASTER_SECRET_ACCOUNT) {
        Ok(Some(b64)) => {
            let bytes = B64
                .decode(b64.as_bytes())
                .map_err(|e| format!("vault master secret decode: {e}"))?;
            let arr: [u8; 32] = bytes
                .try_into()
                .map_err(|_| "vault master secret has wrong length".to_string())?;
            Ok(arr)
        }
        Ok(None) => {
            // First use on this machine: mint a fresh secret and persist it.
            let mut secret = [0u8; 32];
            rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut secret);
            let b64 = B64.encode(secret);
            crate::shell::KeychainStore::store(MASTER_SECRET_ACCOUNT, &b64)
                .map_err(|e| format!("vault master secret store: {e}"))?;
            Ok(secret)
        }
        Err(e) => Err(format!("vault master secret keychain access failed: {e}")),
    }
}

/// Derive the 32-byte encryption key as
/// `SHA-256(machine_secret || hostname || bundle_id)`. The keychained
/// machine secret dominates; hostname + bundle id only add machine binding.
fn derive_key() -> Result<[u8; 32], String> {
    let secret = machine_secret()?;
    Ok(derive_key_with(&secret, BUNDLE_ID))
}

/// Pure key derivation given an explicit machine secret and bundle id.
/// Factored out so the migration path can re-derive deterministically.
fn derive_key_with(secret: &[u8; 32], bundle_id: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(secret);
    h.update(machine_hostname().as_bytes());
    h.update(bundle_id.as_bytes());
    let out = h.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&out);
    key
}

/// Legacy key derivation used before the machine-secret + namespace-unify
/// change: `SHA-256(hostname || ":" || bundle_id)`. Retained ONLY so `load`
/// can decrypt + re-encrypt an old vault. `bundle_id` is passed explicitly
/// so we can try both the unified and legacy namespaces.
fn legacy_derive_key(bundle_id: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(machine_hostname().as_bytes());
    h.update(b":");
    h.update(bundle_id.as_bytes());
    let out = h.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&out);
    key
}

/// A 32-byte seed whose only job is to seed MiniCocoon's nonce RNG.
/// `unwrap` reads the nonce back out of the container, so any seed works
/// for decryption — `unwrap` below uses a zero seed for that reason.
const UNWRAP_SEED: [u8; 32] = [0u8; 32];

/// Attempt to decrypt + parse the vault bytes under one candidate key.
/// MiniCocoon's nonce is embedded in the container, so the seed passed to
/// `from_key` is irrelevant for `unwrap` — we use a fixed `UNWRAP_SEED`.
fn try_decrypt(bytes: &[u8], key: &[u8; 32]) -> Option<BTreeMap<String, String>> {
    let cocoon = MiniCocoon::from_key(key, &UNWRAP_SEED);
    let plaintext = cocoon.unwrap(bytes).ok()?;
    serde_json::from_slice(&plaintext).ok()
}

fn load() -> Result<BTreeMap<String, String>, String> {
    if let Some(cached) = CACHE.lock().unwrap_or_else(|p| p.into_inner()).clone() {
        return Ok(cached);
    }
    let path = vault_path()?;
    if !path.exists() {
        let empty = BTreeMap::new();
        *CACHE.lock().unwrap_or_else(|p| p.into_inner()) = Some(empty.clone());
        return Ok(empty);
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("vault read {}: {e}", path.display()))?;

    // Primary path: the current machine-secret-derived key.
    let key = derive_key()?;
    if let Some(map) = try_decrypt(&bytes, &key) {
        *CACHE.lock().unwrap_or_else(|p| p.into_inner()) = Some(map.clone());
        return Ok(map);
    }

    // Migration path: a vault written by the old hostname-only derivation
    // (no machine secret). Try the legacy key under both the unified and
    // legacy bundle ids; on success, re-encrypt under the new key so the
    // next read is upgraded and the weak derivation is retired.
    for legacy_bundle in [BUNDLE_ID, LEGACY_BUNDLE_ID] {
        let legacy_key = legacy_derive_key(legacy_bundle);
        if let Some(map) = try_decrypt(&bytes, &legacy_key) {
            *CACHE.lock().unwrap_or_else(|p| p.into_inner()) = Some(map.clone());
            // Re-encrypt under the strong key. Best-effort: a write failure
            // must not block the read, the legacy key still works next boot.
            if let Err(e) = save(&map) {
                tracing::warn!(error = %e, "vault: re-encrypt after legacy decrypt failed");
            } else {
                tracing::info!("vault: migrated to machine-secret key derivation");
            }
            return Ok(map);
        }
    }

    Err("vault decrypt: no candidate key could decrypt the vault".into())
}

fn save(map: &BTreeMap<String, String>) -> Result<(), String> {
    let path = vault_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("vault mkdir {}: {e}", parent.display()))?;
    }
    let plaintext = serde_json::to_vec(map).map_err(|e| format!("vault JSON encode: {e}"))?;
    let key = derive_key()?;
    // Fresh random seed per encryption => fresh random AEAD nonce. The nonce
    // is embedded in the wrapped container, so decryption does not need this
    // seed. A constant seed would deterministically reuse the nonce, leaking
    // plaintext equality across encryptions (the bug this fixes).
    let mut seed = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut seed);
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
    *CACHE.lock().unwrap_or_else(|p| p.into_inner()) = Some(map.clone());
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
