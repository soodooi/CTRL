// Smart-table SQLite derived index — the relational backbone (ADR-002 §14 v30
// route C). Design: vault/ctrl/smart-table-relational-index-design.md.
//
// Per CLAUDE.md ## Design Philosophy (same doctrine as vault_index.rs):
//   - the markdown smart-table files are the source of truth (vim test)
//   - this index is a *derivative* — rebuilt from those files, deletable and
//     reconstructible at any time without data loss
//   - SQLite is a public format; inspect with
//     `sqlite3 ~/.ctrl/state/smart-table-index.db` if needed
//
// Why a generic EAV long table (st_cells) keyed by table-file path rather than
// one physical SQLite table per smart-table: smart-tables have user-defined,
// mutable schemas; per-table DDL means runtime CREATE/ALTER on every schema
// edit. The FTS5 / embeddings precedent is one db, one logical table keyed by
// path — we follow it. `value_num` / `value_date` are derived typed
// projections that give index-backed filter/sort speed without per-table DDL.
//
// Slice 1 (this file): the store + reindex-from-markdown + staleness gate. No
// st_refs / Reference parsing yet (slice 4) and no query path yet (slice 2);
// every read still degrades to the in-memory `run_query` in query.rs until the
// index is wired in.

use crate::kernel::query::{CellType, FieldSpec, Row};
use chrono::NaiveDate;
use rusqlite::{params, Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Default index db path: `$HOME/.ctrl/state/smart-table-index.db`.
/// None when HOME isn't set — caller falls back to the in-memory query path.
pub fn default_st_index_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join(".ctrl")
            .join("state")
            .join("smart-table-index.db"),
    )
}

/// Stable per-file table id = first 16 hex chars of sha256(vault-rel path).
/// Deterministic so Lookup/Rollup edges and write-back survive a rebuild.
pub fn table_id_for(path: &str) -> String {
    short_hash(path)
}

/// Smart-table index handle. One rusqlite Connection guarded by a Mutex —
/// writes are short transactions, reads are CPU-bound; contention is fine.
pub struct SmartTableIndex {
    conn: Mutex<Connection>,
}

impl SmartTableIndex {
    /// Open (or create + initialize) the index db. Creates parent dir if missing.
    pub fn open(db_path: &Path) -> Result<Self, StIndexError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| StIndexError::Io(e.to_string()))?;
        }
        let conn = Connection::open_with_flags(
            db_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .map_err(|e| StIndexError::Db(e.to_string()))?;
        Self::ensure_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn ensure_schema(conn: &Connection) -> Result<(), StIndexError> {
        // One registry row per smart-table file; one st_rows row per data row
        // (row_ord = markdown order, for vim parity); st_cells = EAV long table
        // with derived typed projections. st_refs (relational edges) lands in
        // slice 4. `CREATE TABLE IF NOT EXISTS` keeps this forward-compatible.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS st_tables (
                table_id      TEXT PRIMARY KEY,
                path          TEXT NOT NULL UNIQUE,
                title         TEXT,
                schema_json   TEXT NOT NULL,
                mtime_ms      INTEGER NOT NULL,
                content_hash  TEXT NOT NULL,
                indexed_at_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS st_rows (
                table_id TEXT NOT NULL,
                row_id   TEXT NOT NULL,
                row_ord  INTEGER NOT NULL,
                PRIMARY KEY (table_id, row_id)
            );
            CREATE INDEX IF NOT EXISTS st_rows_ord ON st_rows(table_id, row_ord);
            CREATE TABLE IF NOT EXISTS st_cells (
                table_id   TEXT NOT NULL,
                row_id     TEXT NOT NULL,
                field_key  TEXT NOT NULL,
                value_text TEXT NOT NULL DEFAULT '',
                value_num  REAL,
                value_date TEXT,
                PRIMARY KEY (table_id, row_id, field_key)
            );
            CREATE INDEX IF NOT EXISTS st_cells_field ON st_cells(table_id, field_key);
            CREATE INDEX IF NOT EXISTS st_cells_num   ON st_cells(table_id, field_key, value_num);
            CREATE INDEX IF NOT EXISTS st_cells_date  ON st_cells(table_id, field_key, value_date);
            "#,
        )
        .map_err(|e| StIndexError::Db(format!("schema init: {e}")))?;
        Ok(())
    }

    /// Rebuild the index for one smart-table from its parsed (fields, rows).
    /// Delete-then-insert in one transaction (table-granular incremental) — a
    /// single table is thousands of rows = sub-ms, so no row-level diffing.
    /// `content_hash` + `mtime_ms` are the staleness gate (see `is_fresh`).
    /// Returns the table_id. The markdown file remains the source of truth;
    /// callers reindex AFTER a successful `vault::write`.
    pub fn reindex_table(
        &self,
        path: &str,
        title: Option<&str>,
        fields: &[FieldSpec],
        rows: &[Row],
        mtime_ms: i64,
        content_hash: &str,
    ) -> Result<String, StIndexError> {
        let table_id = table_id_for(path);
        let schema_json =
            serde_json::to_string(fields).map_err(|e| StIndexError::Db(format!("schema json: {e}")))?;
        let now_ms = now_ms_signed();

        let conn = self.conn.lock().map_err(|_| StIndexError::Poisoned)?;
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| StIndexError::Db(format!("begin tx: {e}")))?;

        tx.execute("DELETE FROM st_rows WHERE table_id = ?1", params![table_id])
            .map_err(|e| StIndexError::Db(format!("del rows: {e}")))?;
        tx.execute("DELETE FROM st_cells WHERE table_id = ?1", params![table_id])
            .map_err(|e| StIndexError::Db(format!("del cells: {e}")))?;
        tx.execute(
            "INSERT OR REPLACE INTO st_tables
                (table_id, path, title, schema_json, mtime_ms, content_hash, indexed_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![table_id, path, title, schema_json, mtime_ms, content_hash, now_ms],
        )
        .map_err(|e| StIndexError::Db(format!("upsert table: {e}")))?;

        // field key → cell type, for the derived value_num / value_date columns.
        let types: HashMap<&str, CellType> =
            fields.iter().map(|f| (f.key.as_str(), f.cell_type)).collect();

        // Occurrence counter disambiguates duplicate-content rows so identical
        // rows get distinct, deterministic ids (design §A.3).
        let mut seen: HashMap<String, u32> = HashMap::new();
        for (ord, row) in rows.iter().enumerate() {
            let canonical = canonical_row(fields, row);
            let occ = seen.entry(canonical.clone()).or_insert(0);
            let row_id = short_hash(&format!("{table_id}\u{1}{occ}\u{1}{canonical}"));
            *occ += 1;

            tx.execute(
                "INSERT INTO st_rows (table_id, row_id, row_ord) VALUES (?1, ?2, ?3)",
                params![table_id, row_id, ord as i64],
            )
            .map_err(|e| StIndexError::Db(format!("ins row: {e}")))?;

            for field in fields {
                let value = row.get(&field.key).cloned().unwrap_or_default();
                let ct = types.get(field.key.as_str()).copied().unwrap_or(CellType::Text);
                let value_num = if ct == CellType::Number {
                    value.trim().parse::<f64>().ok().filter(|n| n.is_finite())
                } else {
                    None
                };
                let value_date = if ct == CellType::Date {
                    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
                        .ok()
                        .map(|d| d.format("%Y-%m-%d").to_string())
                } else {
                    None
                };
                tx.execute(
                    "INSERT INTO st_cells
                        (table_id, row_id, field_key, value_text, value_num, value_date)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![table_id, row_id, field.key, value, value_num, value_date],
                )
                .map_err(|e| StIndexError::Db(format!("ins cell: {e}")))?;
            }
        }

        tx.commit()
            .map_err(|e| StIndexError::Db(format!("commit: {e}")))?;
        Ok(table_id)
    }

    /// Drop a table's index (rows + cells + registry). No-op if absent.
    /// Called from `vault::delete`. st_refs cascade lands in slice 4.
    pub fn remove_table(&self, path: &str) -> Result<(), StIndexError> {
        let table_id = table_id_for(path);
        let conn = self.conn.lock().map_err(|_| StIndexError::Poisoned)?;
        for sql in [
            "DELETE FROM st_cells WHERE table_id = ?1",
            "DELETE FROM st_rows WHERE table_id = ?1",
            "DELETE FROM st_tables WHERE table_id = ?1",
        ] {
            conn.execute(sql, params![table_id])
                .map_err(|e| StIndexError::Db(format!("remove: {e}")))?;
        }
        Ok(())
    }

    /// True iff the index has this path at exactly `mtime_ms` + `content_hash`.
    /// Drift (or never-indexed) → false, so the read path reindexes or falls
    /// back to in-memory query. markdown always wins.
    pub fn is_fresh(&self, path: &str, mtime_ms: i64, content_hash: &str) -> Result<bool, StIndexError> {
        let table_id = table_id_for(path);
        let conn = self.conn.lock().map_err(|_| StIndexError::Poisoned)?;
        let found: Option<(i64, String)> = conn
            .query_row(
                "SELECT mtime_ms, content_hash FROM st_tables WHERE table_id = ?1",
                params![table_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        Ok(matches!(found, Some((m, h)) if m == mtime_ms && h == content_hash))
    }

    /// Number of indexed smart-tables.
    pub fn table_count(&self) -> Result<usize, StIndexError> {
        self.scalar_count("SELECT COUNT(*) FROM st_tables", None)
    }

    /// Number of data rows indexed for a table.
    pub fn row_count(&self, table_id: &str) -> Result<usize, StIndexError> {
        self.scalar_count("SELECT COUNT(*) FROM st_rows WHERE table_id = ?1", Some(table_id))
    }

    /// Number of cells with a populated numeric projection for a field —
    /// diagnostics + the slice-1 typed-projection test.
    pub fn numeric_cell_count(&self, table_id: &str, field_key: &str) -> Result<usize, StIndexError> {
        let conn = self.conn.lock().map_err(|_| StIndexError::Poisoned)?;
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM st_cells
                 WHERE table_id = ?1 AND field_key = ?2 AND value_num IS NOT NULL",
                params![table_id, field_key],
                |r| r.get(0),
            )
            .map_err(|e| StIndexError::Db(format!("numeric count: {e}")))?;
        Ok(n as usize)
    }

    fn scalar_count(&self, sql: &str, arg: Option<&str>) -> Result<usize, StIndexError> {
        let conn = self.conn.lock().map_err(|_| StIndexError::Poisoned)?;
        let n: i64 = match arg {
            Some(a) => conn.query_row(sql, params![a], |r| r.get(0)),
            None => conn.query_row(sql, [], |r| r.get(0)),
        }
        .map_err(|e| StIndexError::Db(format!("count: {e}")))?;
        Ok(n as usize)
    }
}

/// Schema-ordered tab-joined raw cells — the basis of the content-derived
/// row_id. Missing cells render empty so a row's identity is stable.
fn canonical_row(fields: &[FieldSpec], row: &Row) -> String {
    fields
        .iter()
        .map(|f| row.get(&f.key).map(String::as_str).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\t")
}

/// First 16 hex chars of sha256 — short, stable, collision-safe enough for ids.
fn short_hash(s: &str) -> String {
    let digest = Sha256::digest(s.as_bytes());
    let hex = digest.iter().map(|b| format!("{b:02x}")).collect::<String>();
    hex[..16].to_string()
}

fn now_ms_signed() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum StIndexError {
    #[error("st-index io error: {0}")]
    Io(String),
    #[error("st-index db error: {0}")]
    Db(String),
    #[error("st-index mutex poisoned")]
    Poisoned,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::query::CellType;

    fn fresh_index(label: &str) -> (PathBuf, SmartTableIndex) {
        let mut p = std::env::temp_dir();
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        p.push(format!("ctrl-st-idx-{label}-{pid}-{nanos}.db"));
        let idx = SmartTableIndex::open(&p).expect("open st index");
        (p, idx)
    }

    fn field(key: &str, ct: CellType) -> FieldSpec {
        FieldSpec {
            key: key.to_string(),
            label: key.to_string(),
            cell_type: ct,
            options: None,
        }
    }

    fn row(pairs: &[(&str, &str)]) -> Row {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn sample() -> (Vec<FieldSpec>, Vec<Row>) {
        let fields = vec![
            field("name", CellType::Text),
            field("amount", CellType::Number),
            field("due", CellType::Date),
        ];
        let rows = vec![
            row(&[("name", "Acme"), ("amount", "12000"), ("due", "2026-06-01")]),
            row(&[("name", "Beta"), ("amount", "4500"), ("due", "2026-07-01")]),
            row(&[("name", "Gamma"), ("amount", "n/a"), ("due", "")]),
        ];
        (fields, rows)
    }

    #[test]
    fn reindex_populates_rows_cells_and_typed_projections() {
        let (path, idx) = fresh_index("reindex");
        let (fields, rows) = sample();
        let tid = idx
            .reindex_table("tables/leads.md", Some("Leads"), &fields, &rows, 100, "h1")
            .unwrap();
        assert_eq!(idx.row_count(&tid).unwrap(), 3);
        // amount: 2 of 3 parse as finite numbers ("n/a" does not).
        assert_eq!(idx.numeric_cell_count(&tid, "amount").unwrap(), 2);
        // a text field never gets a numeric projection.
        assert_eq!(idx.numeric_cell_count(&tid, "name").unwrap(), 0);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn reindex_is_idempotent() {
        let (path, idx) = fresh_index("idem");
        let (fields, rows) = sample();
        let tid = idx
            .reindex_table("tables/leads.md", None, &fields, &rows, 1, "h")
            .unwrap();
        idx.reindex_table("tables/leads.md", None, &fields, &rows, 2, "h2")
            .unwrap();
        assert_eq!(idx.table_count().unwrap(), 1);
        assert_eq!(idx.row_count(&tid).unwrap(), 3);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn remove_table_cascades() {
        let (path, idx) = fresh_index("remove");
        let (fields, rows) = sample();
        let tid = idx
            .reindex_table("tables/leads.md", None, &fields, &rows, 1, "h")
            .unwrap();
        assert_eq!(idx.row_count(&tid).unwrap(), 3);
        idx.remove_table("tables/leads.md").unwrap();
        assert_eq!(idx.table_count().unwrap(), 0);
        assert_eq!(idx.row_count(&tid).unwrap(), 0);
        // idempotent
        idx.remove_table("tables/leads.md").unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn is_fresh_tracks_mtime_and_hash() {
        let (path, idx) = fresh_index("fresh");
        let (fields, rows) = sample();
        idx.reindex_table("tables/leads.md", None, &fields, &rows, 100, "hashA")
            .unwrap();
        assert!(idx.is_fresh("tables/leads.md", 100, "hashA").unwrap());
        // mtime drift → stale
        assert!(!idx.is_fresh("tables/leads.md", 200, "hashA").unwrap());
        // content drift → stale
        assert!(!idx.is_fresh("tables/leads.md", 100, "hashB").unwrap());
        // unknown table → stale
        assert!(!idx.is_fresh("tables/other.md", 100, "hashA").unwrap());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn duplicate_rows_get_distinct_ids() {
        let (path, idx) = fresh_index("dupes");
        let fields = vec![field("name", CellType::Text)];
        let rows = vec![row(&[("name", "same")]), row(&[("name", "same")])];
        let tid = idx
            .reindex_table("tables/d.md", None, &fields, &rows, 1, "h")
            .unwrap();
        // Both rows survive — the occurrence counter keeps row_ids distinct
        // despite identical content (no PRIMARY KEY collision dropping a row).
        assert_eq!(idx.row_count(&tid).unwrap(), 2);
        let _ = std::fs::remove_file(&path);
    }
}
