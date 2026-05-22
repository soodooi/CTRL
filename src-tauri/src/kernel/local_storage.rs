// LocalStorage — persistent JSON key/value store, per-keycap scoped.
//
// Sibling to vault.* (long-form markdown) and cache.* (transient blobs).
// LocalStorage holds the small persistent state a keycap needs to remember
// between invocations: user preferences, last-used choices, draft text,
// "did I onboard?" flags. Raycast's `LocalStorage` equivalent.
//
// Per CLAUDE.md design philosophy:
//   - SQLite is a public format; `sqlite3 ~/.ctrl/state/localstorage.db`
//     inspects everything.
//   - Per-keycap scoping prevents one keycap from snooping another's state
//     (capability gating layered on top in a follow-up commit).
//   - Values are arbitrary JSON — frontmatter-style structure, not opaque
//     binary blobs.

use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Default db path: `$HOME/.ctrl/state/localstorage.db`.
pub fn default_db_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join(".ctrl")
            .join("state")
            .join("localstorage.db"),
    )
}

pub struct LocalStorage {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageEntry {
    pub key: String,
    pub value: serde_json::Value,
    pub updated_at_ms: i64,
}

impl LocalStorage {
    pub fn open(db_path: &Path) -> Result<Self, StorageError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| StorageError::Io(e.to_string()))?;
        }
        let conn = Connection::open_with_flags(
            db_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .map_err(|e| StorageError::Db(e.to_string()))?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS localstorage (
                scope TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                PRIMARY KEY (scope, key)
            );
            CREATE INDEX IF NOT EXISTS idx_localstorage_scope
                ON localstorage(scope);
            "#,
        )
        .map_err(|e| StorageError::Db(format!("schema: {e}")))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn get(
        &self,
        scope: &str,
        key: &str,
    ) -> Result<Option<serde_json::Value>, StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::Poisoned)?;
        let result: rusqlite::Result<String> = conn.query_row(
            "SELECT value FROM localstorage WHERE scope = ?1 AND key = ?2",
            params![scope, key],
            |row| row.get(0),
        );
        match result {
            Ok(s) => Ok(Some(
                serde_json::from_str(&s).map_err(|e| StorageError::Db(format!("parse: {e}")))?,
            )),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(StorageError::Db(e.to_string())),
        }
    }

    pub fn set(
        &self,
        scope: &str,
        key: &str,
        value: &serde_json::Value,
    ) -> Result<(), StorageError> {
        let s = serde_json::to_string(value)
            .map_err(|e| StorageError::Db(format!("serialize: {e}")))?;
        let now = now_ms_signed();
        let conn = self.conn.lock().map_err(|_| StorageError::Poisoned)?;
        conn.execute(
            "INSERT INTO localstorage (scope, key, value, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(scope, key) DO UPDATE SET value=excluded.value, updated_at_ms=excluded.updated_at_ms",
            params![scope, key, s, now],
        )
        .map_err(|e| StorageError::Db(format!("set: {e}")))?;
        Ok(())
    }

    pub fn remove(&self, scope: &str, key: &str) -> Result<(), StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::Poisoned)?;
        conn.execute(
            "DELETE FROM localstorage WHERE scope = ?1 AND key = ?2",
            params![scope, key],
        )
        .map_err(|e| StorageError::Db(format!("remove: {e}")))?;
        Ok(())
    }

    pub fn list(&self, scope: &str) -> Result<Vec<StorageEntry>, StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::Poisoned)?;
        let mut stmt = conn
            .prepare("SELECT key, value, updated_at_ms FROM localstorage WHERE scope = ?1 ORDER BY key")
            .map_err(|e| StorageError::Db(format!("prepare: {e}")))?;
        let rows = stmt
            .query_map(params![scope], |row| {
                let key: String = row.get(0)?;
                let value_str: String = row.get(1)?;
                let updated_at_ms: i64 = row.get(2)?;
                Ok((key, value_str, updated_at_ms))
            })
            .map_err(|e| StorageError::Db(format!("query: {e}")))?;
        let mut out = Vec::new();
        for r in rows {
            let (key, value_str, updated_at_ms) =
                r.map_err(|e| StorageError::Db(format!("row: {e}")))?;
            let value =
                serde_json::from_str(&value_str).unwrap_or(serde_json::Value::Null);
            out.push(StorageEntry {
                key,
                value,
                updated_at_ms,
            });
        }
        Ok(out)
    }

    pub fn clear(&self, scope: &str) -> Result<usize, StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::Poisoned)?;
        let n = conn
            .execute(
                "DELETE FROM localstorage WHERE scope = ?1",
                params![scope],
            )
            .map_err(|e| StorageError::Db(format!("clear: {e}")))?;
        Ok(n)
    }
}

fn now_ms_signed() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum StorageError {
    #[error("storage io error: {0}")]
    Io(String),
    #[error("storage db error: {0}")]
    Db(String),
    #[error("storage mutex poisoned")]
    Poisoned,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_storage(label: &str) -> (PathBuf, LocalStorage) {
        let mut p = std::env::temp_dir();
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        p.push(format!("ctrl-ls-test-{label}-{pid}-{nanos}.db"));
        let s = LocalStorage::open(&p).expect("open");
        (p, s)
    }

    #[test]
    fn set_then_get_roundtrip() {
        let (path, s) = fresh_storage("rt");
        s.set("my-keycap", "last_query", &serde_json::json!("hello"))
            .unwrap();
        let v = s.get("my-keycap", "last_query").unwrap().unwrap();
        assert_eq!(v, serde_json::json!("hello"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn get_missing_returns_none() {
        let (path, s) = fresh_storage("miss");
        assert!(s.get("scope", "never_set").unwrap().is_none());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn set_replaces_existing_value() {
        let (path, s) = fresh_storage("rep");
        s.set("k", "k1", &serde_json::json!(1)).unwrap();
        s.set("k", "k1", &serde_json::json!(2)).unwrap();
        assert_eq!(s.get("k", "k1").unwrap().unwrap(), serde_json::json!(2));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn scopes_are_isolated() {
        let (path, s) = fresh_storage("iso");
        s.set("kc1", "shared", &serde_json::json!("from-1"))
            .unwrap();
        s.set("kc2", "shared", &serde_json::json!("from-2"))
            .unwrap();
        assert_eq!(
            s.get("kc1", "shared").unwrap().unwrap(),
            serde_json::json!("from-1")
        );
        assert_eq!(
            s.get("kc2", "shared").unwrap().unwrap(),
            serde_json::json!("from-2")
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn list_returns_scope_entries_sorted() {
        let (path, s) = fresh_storage("ls");
        s.set("kc", "b", &serde_json::json!(1)).unwrap();
        s.set("kc", "a", &serde_json::json!(2)).unwrap();
        s.set("other", "c", &serde_json::json!(3)).unwrap();
        let entries = s.list("kc").unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].key, "a");
        assert_eq!(entries[1].key, "b");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn clear_only_affects_scope() {
        let (path, s) = fresh_storage("clr");
        s.set("kc1", "k", &serde_json::json!(1)).unwrap();
        s.set("kc2", "k", &serde_json::json!(2)).unwrap();
        let cleared = s.clear("kc1").unwrap();
        assert_eq!(cleared, 1);
        assert!(s.get("kc1", "k").unwrap().is_none());
        assert!(s.get("kc2", "k").unwrap().is_some());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn remove_is_idempotent() {
        let (path, s) = fresh_storage("rm");
        s.set("k", "k1", &serde_json::json!("x")).unwrap();
        s.remove("k", "k1").unwrap();
        s.remove("k", "k1").unwrap();
        assert!(s.get("k", "k1").unwrap().is_none());
        let _ = std::fs::remove_file(&path);
    }
}
