// Cache — transient blob store, LRU-evicted, per-keycap scoped.
//
// Sibling to vault.* (long-form markdown, source of truth) and
// localstorage.* (persistent JSON KV, structured state). Cache holds
// things that are cheap to re-derive but expensive to compute / fetch:
// LLM-embedding results, fetched HTTP responses, OCR'd image text,
// thumbnail previews. Raycast's `Cache` equivalent.
//
// Storage shape (per CLAUDE.md design philosophy — public formats only):
//   ~/.ctrl/state/cache/
//     index.db                  ← LRU metadata (scope, key, size, last_used_ms)
//     blobs/<scope>/<key-hash>  ← actual blob payload
//
// Eviction policy: LRU by `last_used_ms`. Triggered when total cache
// size > max_bytes. Defaults to 256 MB; configurable per Cache instance.
// Eviction runs after every `set` that grows the total beyond the cap,
// dropping oldest entries until back under.

use rusqlite::{params, Connection, OpenFlags};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Default cache root: `$HOME/.ctrl/state/cache/`.
pub fn default_cache_root() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".ctrl").join("state").join("cache"))
}

/// Default eviction cap: 256 MB across all scopes.
pub const DEFAULT_MAX_BYTES: u64 = 256 * 1024 * 1024;

pub struct Cache {
    root: PathBuf,
    max_bytes: u64,
    conn: Mutex<Connection>,
}

impl Cache {
    pub fn open(root: &Path, max_bytes: u64) -> Result<Self, CacheError> {
        std::fs::create_dir_all(root.join("blobs"))
            .map_err(|e| CacheError::Io(e.to_string()))?;
        let conn = Connection::open_with_flags(
            root.join("index.db"),
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .map_err(|e| CacheError::Db(e.to_string()))?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS cache_index (
                scope TEXT NOT NULL,
                key TEXT NOT NULL,
                blob_path TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                last_used_ms INTEGER NOT NULL,
                created_at_ms INTEGER NOT NULL,
                ttl_ms INTEGER,
                PRIMARY KEY (scope, key)
            );
            CREATE INDEX IF NOT EXISTS idx_cache_lru ON cache_index(last_used_ms);
            "#,
        )
        .map_err(|e| CacheError::Db(format!("schema: {e}")))?;
        Ok(Self {
            root: root.to_path_buf(),
            max_bytes,
            conn: Mutex::new(conn),
        })
    }

    pub fn get(&self, scope: &str, key: &str) -> Result<Option<Vec<u8>>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Poisoned)?;
        let row: rusqlite::Result<(String, i64, Option<i64>, i64)> = conn.query_row(
            "SELECT blob_path, created_at_ms, ttl_ms, last_used_ms FROM cache_index WHERE scope = ?1 AND key = ?2",
            params![scope, key],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        );
        let (blob_path, created_at_ms, ttl_ms, _last_used) = match row {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
            Err(e) => return Err(CacheError::Db(e.to_string())),
        };
        // TTL check — expired entries return None and get evicted.
        if let Some(ttl) = ttl_ms {
            if now_ms_signed() > created_at_ms + ttl {
                drop(conn);
                let _ = self.remove(scope, key);
                return Ok(None);
            }
        }
        let bytes = std::fs::read(&blob_path).map_err(|e| CacheError::Io(e.to_string()))?;
        // Bump last_used_ms (LRU touch).
        conn.execute(
            "UPDATE cache_index SET last_used_ms = ?1 WHERE scope = ?2 AND key = ?3",
            params![now_ms_signed(), scope, key],
        )
        .map_err(|e| CacheError::Db(format!("touch: {e}")))?;
        Ok(Some(bytes))
    }

    pub fn set(
        &self,
        scope: &str,
        key: &str,
        bytes: &[u8],
        ttl_ms: Option<i64>,
    ) -> Result<(), CacheError> {
        let scope_dir = self.root.join("blobs").join(scope);
        std::fs::create_dir_all(&scope_dir).map_err(|e| CacheError::Io(e.to_string()))?;
        let blob_path = scope_dir.join(hash_key(key));
        std::fs::write(&blob_path, bytes).map_err(|e| CacheError::Io(e.to_string()))?;
        let now = now_ms_signed();
        {
            let conn = self.conn.lock().map_err(|_| CacheError::Poisoned)?;
            conn.execute(
                "INSERT INTO cache_index (scope, key, blob_path, size_bytes, last_used_ms, created_at_ms, ttl_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)
                 ON CONFLICT(scope, key) DO UPDATE SET
                    blob_path = excluded.blob_path,
                    size_bytes = excluded.size_bytes,
                    last_used_ms = excluded.last_used_ms,
                    created_at_ms = excluded.created_at_ms,
                    ttl_ms = excluded.ttl_ms",
                params![scope, key, blob_path.to_string_lossy(), bytes.len() as i64, now, ttl_ms],
            )
            .map_err(|e| CacheError::Db(format!("set: {e}")))?;
        }
        self.maybe_evict()?;
        Ok(())
    }

    pub fn remove(&self, scope: &str, key: &str) -> Result<(), CacheError> {
        let blob_path: Option<String> = {
            let conn = self.conn.lock().map_err(|_| CacheError::Poisoned)?;
            let row: rusqlite::Result<String> = conn.query_row(
                "SELECT blob_path FROM cache_index WHERE scope = ?1 AND key = ?2",
                params![scope, key],
                |r| r.get(0),
            );
            match row {
                Ok(p) => {
                    conn.execute(
                        "DELETE FROM cache_index WHERE scope = ?1 AND key = ?2",
                        params![scope, key],
                    )
                    .map_err(|e| CacheError::Db(format!("remove: {e}")))?;
                    Some(p)
                }
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(CacheError::Db(e.to_string())),
            }
        };
        if let Some(p) = blob_path {
            let _ = std::fs::remove_file(p);
        }
        Ok(())
    }

    pub fn clear(&self, scope: &str) -> Result<usize, CacheError> {
        let paths: Vec<String> = {
            let conn = self.conn.lock().map_err(|_| CacheError::Poisoned)?;
            let mut stmt = conn
                .prepare("SELECT blob_path FROM cache_index WHERE scope = ?1")
                .map_err(|e| CacheError::Db(format!("prepare: {e}")))?;
            let rows = stmt
                .query_map(params![scope], |r| r.get::<_, String>(0))
                .map_err(|e| CacheError::Db(format!("query: {e}")))?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(|e| CacheError::Db(format!("row: {e}")))?);
            }
            conn.execute(
                "DELETE FROM cache_index WHERE scope = ?1",
                params![scope],
            )
            .map_err(|e| CacheError::Db(format!("clear: {e}")))?;
            out
        };
        let n = paths.len();
        for p in paths {
            let _ = std::fs::remove_file(p);
        }
        // Best-effort drop the scope directory too (empty after blob removals).
        let _ = std::fs::remove_dir(self.root.join("blobs").join(scope));
        Ok(n)
    }

    /// Total cached bytes across all scopes.
    pub fn total_bytes(&self) -> Result<u64, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::Poisoned)?;
        let n: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(size_bytes), 0) FROM cache_index",
                [],
                |r| r.get(0),
            )
            .map_err(|e| CacheError::Db(format!("total_bytes: {e}")))?;
        Ok(n.max(0) as u64)
    }

    /// LRU eviction — drop oldest entries until total <= max_bytes.
    /// No-op when within budget. Called after every set.
    fn maybe_evict(&self) -> Result<(), CacheError> {
        let mut total = self.total_bytes()?;
        if total <= self.max_bytes {
            return Ok(());
        }
        // Snapshot LRU order, then delete one-by-one until under cap.
        let candidates: Vec<(String, String, String, i64)> = {
            let conn = self.conn.lock().map_err(|_| CacheError::Poisoned)?;
            let mut stmt = conn
                .prepare(
                    "SELECT scope, key, blob_path, size_bytes FROM cache_index ORDER BY last_used_ms ASC",
                )
                .map_err(|e| CacheError::Db(format!("prepare evict: {e}")))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                    ))
                })
                .map_err(|e| CacheError::Db(format!("query evict: {e}")))?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(|e| CacheError::Db(format!("row evict: {e}")))?);
            }
            out
        };
        for (scope, key, blob_path, size) in candidates {
            if total <= self.max_bytes {
                break;
            }
            let _ = std::fs::remove_file(&blob_path);
            let conn = self.conn.lock().map_err(|_| CacheError::Poisoned)?;
            conn.execute(
                "DELETE FROM cache_index WHERE scope = ?1 AND key = ?2",
                params![scope, key],
            )
            .map_err(|e| CacheError::Db(format!("evict delete: {e}")))?;
            total = total.saturating_sub(size as u64);
        }
        Ok(())
    }
}

fn hash_key(key: &str) -> String {
    // Stable filesystem-safe filename. DefaultHasher is enough for cache
    // bucketing (collisions just produce a re-fetch, not data loss).
    let mut h = DefaultHasher::new();
    key.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn now_ms_signed() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum CacheError {
    #[error("cache io error: {0}")]
    Io(String),
    #[error("cache db error: {0}")]
    Db(String),
    #[error("cache mutex poisoned")]
    Poisoned,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_cache(label: &str, max_bytes: u64) -> (PathBuf, Cache) {
        let mut p = std::env::temp_dir();
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        p.push(format!("ctrl-cache-test-{label}-{pid}-{nanos}"));
        let c = Cache::open(&p, max_bytes).expect("open");
        (p, c)
    }

    #[test]
    fn set_then_get_roundtrip() {
        let (root, c) = fresh_cache("rt", 1024);
        c.set("kc", "thumb", b"hello", None).unwrap();
        let bytes = c.get("kc", "thumb").unwrap().unwrap();
        assert_eq!(bytes, b"hello");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn get_missing_returns_none() {
        let (root, c) = fresh_cache("miss", 1024);
        assert!(c.get("kc", "never_set").unwrap().is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn ttl_expires_entries() {
        let (root, c) = fresh_cache("ttl", 1024);
        c.set("kc", "k", b"transient", Some(-1)).unwrap(); // already past
        assert!(c.get("kc", "k").unwrap().is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn set_replaces_existing_value() {
        let (root, c) = fresh_cache("rep", 1024);
        c.set("k", "k1", b"v1", None).unwrap();
        c.set("k", "k1", b"v2", None).unwrap();
        assert_eq!(c.get("k", "k1").unwrap().unwrap(), b"v2");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn lru_evicts_oldest_when_over_cap() {
        // Cap at 100 bytes; insert three 50-byte blobs → oldest gets evicted.
        let (root, c) = fresh_cache("lru", 100);
        c.set("kc", "a", &vec![0u8; 50], None).unwrap();
        // Sleep 2ms to ensure distinct last_used_ms timestamps.
        std::thread::sleep(std::time::Duration::from_millis(2));
        c.set("kc", "b", &vec![0u8; 50], None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        c.set("kc", "c", &vec![0u8; 50], None).unwrap();
        // Total is 150 > 100 → evict one (the oldest, "a").
        assert!(c.get("kc", "a").unwrap().is_none());
        assert!(c.get("kc", "b").unwrap().is_some());
        assert!(c.get("kc", "c").unwrap().is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn clear_drops_scope_only() {
        let (root, c) = fresh_cache("clr", 1024);
        c.set("kc1", "k", b"x", None).unwrap();
        c.set("kc2", "k", b"y", None).unwrap();
        let cleared = c.clear("kc1").unwrap();
        assert_eq!(cleared, 1);
        assert!(c.get("kc1", "k").unwrap().is_none());
        assert!(c.get("kc2", "k").unwrap().is_some());
        let _ = std::fs::remove_dir_all(&root);
    }
}
