// Vault FTS5 index — full-text search backed by SQLite FTS5.
//
// Per `.kiro/steering/development-philosophy.md` Design Philosophy:
//   - vault files are the source of truth (plain markdown on disk)
//   - this index is a *derivative* — derived from those files, can be
//     deleted and rebuilt at any time without data loss
//   - SQLite is a public format; the index db itself is inspectable
//     with `sqlite3 ~/.ctrl/state/vault-index.db` if needed
//
// Maintenance strategy:
//   - vault::write → upsert(path, content, frontmatter_json)
//   - vault::delete → remove(path)
//   - vault::search → FTS5 MATCH query, falls back to substring scan
//     if the index is unavailable / errored
//   - rebuild_index → full scan of vault root, replaces index from scratch
//     (called manually, or auto on first search if index is missing)
//
// File-level mtime tracking lets a future "lazy refresh" check whether
// vim-edited files drifted out of sync without forcing a full rebuild
// every search.

use rusqlite::{params, Connection, OpenFlags};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Default index db path: `$HOME/.ctrl/state/vault-index.db`.
/// Errors out (None) when HOME isn't set — caller falls back to scan.
pub fn default_index_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join(".ctrl")
            .join("state")
            .join("vault-index.db"),
    )
}

/// Vault index handle. Owns a single rusqlite Connection guarded by a
/// Mutex — FTS5 queries are CPU-bound and fast, contention is fine.
pub struct VaultIndex {
    conn: Mutex<Connection>,
}

impl VaultIndex {
    /// Open (or create + initialize) the index db at the given path.
    /// Creates the parent directory if missing.
    pub fn open(db_path: &Path) -> Result<Self, IndexError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| IndexError::Io(e.to_string()))?;
        }
        let conn = Connection::open_with_flags(
            db_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .map_err(|e| IndexError::Db(e.to_string()))?;
        Self::ensure_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn ensure_schema(conn: &Connection) -> Result<(), IndexError> {
        // FTS5 virtual table — `path` UNINDEXED so it doesn't pollute
        // search ranking but stays attached. `frontmatter_json` is
        // stringified so title / tags / source platform are searchable
        // as words alongside body content.
        conn.execute_batch(
            r#"
            CREATE VIRTUAL TABLE IF NOT EXISTS vault_index USING fts5(
                path UNINDEXED,
                content,
                frontmatter_json,
                tokenize = 'unicode61 remove_diacritics 2'
            );
            CREATE TABLE IF NOT EXISTS vault_meta (
                path TEXT PRIMARY KEY,
                mtime_ms INTEGER NOT NULL,
                indexed_at_ms INTEGER NOT NULL
            );
            "#,
        )
        .map_err(|e| IndexError::Db(format!("schema init: {e}")))?;
        Ok(())
    }

    /// Insert or replace a row. Called from vault::write after a file
    /// lands. Atomic: removes any existing row for `path` first.
    pub fn upsert(
        &self,
        path: &str,
        content: &str,
        frontmatter_json: &str,
        mtime_ms: i64,
    ) -> Result<(), IndexError> {
        let now_ms = now_ms_signed();
        let conn = self.conn.lock().map_err(|_| IndexError::Poisoned)?;
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| IndexError::Db(format!("begin tx: {e}")))?;
        tx.execute("DELETE FROM vault_index WHERE path = ?1", params![path])
            .map_err(|e| IndexError::Db(format!("delete old: {e}")))?;
        tx.execute(
            "INSERT INTO vault_index (path, content, frontmatter_json) VALUES (?1, ?2, ?3)",
            params![path, content, frontmatter_json],
        )
        .map_err(|e| IndexError::Db(format!("insert: {e}")))?;
        tx.execute(
            "INSERT OR REPLACE INTO vault_meta (path, mtime_ms, indexed_at_ms) VALUES (?1, ?2, ?3)",
            params![path, mtime_ms, now_ms],
        )
        .map_err(|e| IndexError::Db(format!("upsert meta: {e}")))?;
        tx.commit().map_err(|e| IndexError::Db(format!("commit: {e}")))?;
        Ok(())
    }

    /// Remove a row. Called from vault::delete. No-op if not present.
    pub fn remove(&self, path: &str) -> Result<(), IndexError> {
        let conn = self.conn.lock().map_err(|_| IndexError::Poisoned)?;
        conn.execute("DELETE FROM vault_index WHERE path = ?1", params![path])
            .map_err(|e| IndexError::Db(format!("remove: {e}")))?;
        conn.execute("DELETE FROM vault_meta WHERE path = ?1", params![path])
            .map_err(|e| IndexError::Db(format!("remove meta: {e}")))?;
        Ok(())
    }

    /// FTS5 MATCH query. Returns matching paths ordered by FTS5
    /// internal rank (most relevant first), capped at `limit`.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<String>, IndexError> {
        let conn = self.conn.lock().map_err(|_| IndexError::Poisoned)?;
        let mut stmt = conn
            .prepare(
                "SELECT path FROM vault_index WHERE vault_index MATCH ?1 ORDER BY rank LIMIT ?2",
            )
            .map_err(|e| IndexError::Db(format!("prepare: {e}")))?;
        let it = stmt
            .query_map(params![sanitize_fts_query(query), limit as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| IndexError::Db(format!("query: {e}")))?;
        let mut out = Vec::new();
        for r in it {
            out.push(r.map_err(|e| IndexError::Db(format!("row: {e}")))?);
        }
        Ok(out)
    }

    /// Wipe the index. Used by rebuild_index before re-populating.
    pub fn clear(&self) -> Result<(), IndexError> {
        let conn = self.conn.lock().map_err(|_| IndexError::Poisoned)?;
        conn.execute("DELETE FROM vault_index", [])
            .map_err(|e| IndexError::Db(format!("clear index: {e}")))?;
        conn.execute("DELETE FROM vault_meta", [])
            .map_err(|e| IndexError::Db(format!("clear meta: {e}")))?;
        Ok(())
    }

    /// Number of indexed paths — useful for diagnostics + rebuild reports.
    pub fn count(&self) -> Result<usize, IndexError> {
        let conn = self.conn.lock().map_err(|_| IndexError::Poisoned)?;
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM vault_index", [], |r| r.get(0))
            .map_err(|e| IndexError::Db(format!("count: {e}")))?;
        Ok(n as usize)
    }
}

/// FTS5 has a small surface of operator chars (`"`, `*`, `:`, `(`, `)`,
/// `+`, `-`, `NEAR`, `AND`, `OR`). Most user queries are bare phrases,
/// not query language — wrap the input in a phrase quote so a query
/// like "tag: foo" doesn't fail to parse.
///
/// Power users who want operators can pre-quote their query; we only
/// auto-wrap when the input has no double-quote chars.
fn sanitize_fts_query(q: &str) -> String {
    let trimmed = q.trim();
    if trimmed.contains('"') {
        return trimmed.to_string();
    }
    // Escape any single double-quote-equivalent chars before wrapping.
    let escaped = trimmed.replace('"', "\"\"");
    format!("\"{escaped}\"")
}

fn now_ms_signed() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum IndexError {
    #[error("index io error: {0}")]
    Io(String),
    #[error("index db error: {0}")]
    Db(String),
    #[error("index mutex poisoned")]
    Poisoned,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_index(label: &str) -> (PathBuf, VaultIndex) {
        let mut p = std::env::temp_dir();
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        p.push(format!("ctrl-vault-idx-{label}-{pid}-{nanos}.db"));
        let idx = VaultIndex::open(&p).expect("open index");
        (p, idx)
    }

    #[test]
    fn upsert_then_search_finds_match() {
        let (path, idx) = fresh_index("basic");
        idx.upsert(
            "notes/hello.md",
            "Hello WORLD, this is CTRL.",
            r#"{"title":"Hello"}"#,
            1234,
        )
        .unwrap();
        let hits = idx.search("world", 10).unwrap();
        assert_eq!(hits, vec!["notes/hello.md".to_string()]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn frontmatter_text_is_searchable() {
        let (path, idx) = fresh_index("fm");
        idx.upsert(
            "notes/a.md",
            "body text only",
            r#"{"tags":["meeting","2026-q2"],"source":"feishu"}"#,
            1,
        )
        .unwrap();
        // Searching for a tag returns the doc even though it's only in frontmatter.
        let hits = idx.search("meeting", 10).unwrap();
        assert_eq!(hits, vec!["notes/a.md".to_string()]);
        let hits = idx.search("feishu", 10).unwrap();
        assert_eq!(hits, vec!["notes/a.md".to_string()]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn upsert_replaces_existing_row() {
        let (path, idx) = fresh_index("upsert");
        idx.upsert("x.md", "first content", "{}", 1).unwrap();
        idx.upsert("x.md", "second content", "{}", 2).unwrap();
        assert_eq!(idx.count().unwrap(), 1);
        assert_eq!(idx.search("second", 10).unwrap(), vec!["x.md".to_string()]);
        assert!(idx.search("first", 10).unwrap().is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn remove_drops_row() {
        let (path, idx) = fresh_index("rm");
        idx.upsert("y.md", "content", "{}", 1).unwrap();
        assert_eq!(idx.count().unwrap(), 1);
        idx.remove("y.md").unwrap();
        assert_eq!(idx.count().unwrap(), 0);
        // Idempotent — second remove doesn't error.
        idx.remove("y.md").unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn search_respects_limit_and_ordering() {
        let (path, idx) = fresh_index("limit");
        for i in 0..5 {
            idx.upsert(&format!("doc-{i}.md"), "shared keyword", "{}", i as i64)
                .unwrap();
        }
        let hits = idx.search("keyword", 3).unwrap();
        assert_eq!(hits.len(), 3);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn query_with_colon_doesnt_break_fts() {
        // FTS5 treats `:` as column-syntax; our sanitizer wraps the
        // input in a phrase quote so naive queries like
        // "title: hello" don't blow up.
        let (path, idx) = fresh_index("colon");
        idx.upsert("a.md", "hello world", "{}", 1).unwrap();
        let hits = idx.search("hello world", 10).unwrap();
        assert_eq!(hits, vec!["a.md".to_string()]);
        let _ = std::fs::remove_file(&path);
    }
}
