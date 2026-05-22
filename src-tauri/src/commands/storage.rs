// Storage Tauri commands — LocalStorage (persistent KV) + Cache (LRU blob).
//
// Two siblings to the vault.* surface:
//   localstorage.* — small persistent JSON values per keycap (user prefs,
//                    last-used choices, draft text). Backed by SQLite.
//   cache.*        — transient blobs with optional TTL, LRU-evicted at
//                    256 MB total. Backed by SQLite index + flat blob files.
//
// Both per-keycap scoped via the `scope` argument (capability gating on
// top of this in a follow-up commit).

use crate::kernel::cache::{self, Cache, CacheError, DEFAULT_MAX_BYTES};
use crate::kernel::local_storage::{self, LocalStorage, StorageEntry, StorageError};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

static GLOBAL_LOCAL_STORAGE: OnceLock<Option<LocalStorage>> = OnceLock::new();
static GLOBAL_CACHE: OnceLock<Option<Cache>> = OnceLock::new();

fn try_local_storage() -> Result<&'static LocalStorage, String> {
    GLOBAL_LOCAL_STORAGE
        .get_or_init(|| {
            local_storage::default_db_path().and_then(|p| LocalStorage::open(&p).ok())
        })
        .as_ref()
        .ok_or_else(|| "localstorage unavailable (HOME unset?)".to_string())
}

fn try_cache() -> Result<&'static Cache, String> {
    GLOBAL_CACHE
        .get_or_init(|| {
            cache::default_cache_root().and_then(|p| Cache::open(&p, DEFAULT_MAX_BYTES).ok())
        })
        .as_ref()
        .ok_or_else(|| "cache unavailable (HOME unset?)".to_string())
}

// ── LocalStorage commands ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LocalStorageGetArgs {
    pub scope: String,
    pub key: String,
}

#[tauri::command]
pub async fn localstorage_get(
    args: LocalStorageGetArgs,
) -> Result<Option<serde_json::Value>, String> {
    try_local_storage()?
        .get(&args.scope, &args.key)
        .map_err(stringify_storage_error)
}

#[derive(Debug, Deserialize)]
pub struct LocalStorageSetArgs {
    pub scope: String,
    pub key: String,
    pub value: serde_json::Value,
}

#[tauri::command]
pub async fn localstorage_set(args: LocalStorageSetArgs) -> Result<(), String> {
    try_local_storage()?
        .set(&args.scope, &args.key, &args.value)
        .map_err(stringify_storage_error)
}

#[derive(Debug, Deserialize)]
pub struct LocalStorageRemoveArgs {
    pub scope: String,
    pub key: String,
}

#[tauri::command]
pub async fn localstorage_remove(args: LocalStorageRemoveArgs) -> Result<(), String> {
    try_local_storage()?
        .remove(&args.scope, &args.key)
        .map_err(stringify_storage_error)
}

#[derive(Debug, Deserialize)]
pub struct LocalStorageListArgs {
    pub scope: String,
}

#[tauri::command]
pub async fn localstorage_list(args: LocalStorageListArgs) -> Result<Vec<StorageEntry>, String> {
    try_local_storage()?
        .list(&args.scope)
        .map_err(stringify_storage_error)
}

#[derive(Debug, Deserialize)]
pub struct LocalStorageClearArgs {
    pub scope: String,
}

#[tauri::command]
pub async fn localstorage_clear(args: LocalStorageClearArgs) -> Result<usize, String> {
    try_local_storage()?
        .clear(&args.scope)
        .map_err(stringify_storage_error)
}

// ── Cache commands ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CacheGetArgs {
    pub scope: String,
    pub key: String,
}

#[derive(Debug, Serialize)]
pub struct CacheGetReply {
    /// Base64 of the blob, or null when the entry is missing / expired.
    /// PWA decodes with atob(); base64 over the Tauri wire avoids JSON
    /// string escaping issues for binary content.
    pub data_b64: Option<String>,
}

#[tauri::command]
pub async fn cache_get(args: CacheGetArgs) -> Result<CacheGetReply, String> {
    let bytes = try_cache()?
        .get(&args.scope, &args.key)
        .map_err(stringify_cache_error)?;
    Ok(CacheGetReply {
        data_b64: bytes.map(|b| B64.encode(b)),
    })
}

#[derive(Debug, Deserialize)]
pub struct CacheSetArgs {
    pub scope: String,
    pub key: String,
    /// Base64-encoded blob.
    pub data_b64: String,
    /// Optional TTL in milliseconds. Absent = never expires (until LRU).
    pub ttl_ms: Option<i64>,
}

#[tauri::command]
pub async fn cache_set(args: CacheSetArgs) -> Result<(), String> {
    let bytes = B64
        .decode(&args.data_b64)
        .map_err(|e| format!("base64 decode: {e}"))?;
    try_cache()?
        .set(&args.scope, &args.key, &bytes, args.ttl_ms)
        .map_err(stringify_cache_error)
}

#[derive(Debug, Deserialize)]
pub struct CacheRemoveArgs {
    pub scope: String,
    pub key: String,
}

#[tauri::command]
pub async fn cache_remove(args: CacheRemoveArgs) -> Result<(), String> {
    try_cache()?
        .remove(&args.scope, &args.key)
        .map_err(stringify_cache_error)
}

#[derive(Debug, Deserialize)]
pub struct CacheClearArgs {
    pub scope: String,
}

#[tauri::command]
pub async fn cache_clear(args: CacheClearArgs) -> Result<usize, String> {
    try_cache()?
        .clear(&args.scope)
        .map_err(stringify_cache_error)
}

#[tauri::command]
pub async fn cache_total_bytes() -> Result<u64, String> {
    try_cache()?.total_bytes().map_err(stringify_cache_error)
}

fn stringify_storage_error(e: StorageError) -> String {
    e.to_string()
}

fn stringify_cache_error(e: CacheError) -> String {
    e.to_string()
}
