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

use crate::kernel::query::{
    run_query, CellType, Conjunction, FieldSpec, Filter, Operator, QueryError, QueryRequest,
    QueryResult, Row, SortKey,
};
use chrono::NaiveDate;
use rusqlite::{params, params_from_iter, Connection, OpenFlags};
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

    /// Index-backed read (slice 2). Pushes the exactly-reproducible number /
    /// date comparison filters (under AND) into SQL to prune candidate rows at
    /// scale, then runs the SHARED `run_query` engine over the reconstructed
    /// candidate set for the authoritative filter / sort / group / limit. Because
    /// `run_query` re-applies every filter, the SQL prune only ever needs to be a
    /// SUPERSET of the true matches — so the result is byte-identical to running
    /// `run_query` over the whole table (the parity invariant, proven in tests).
    /// One semantic definition; SQL is only an accelerator (design §C).
    ///
    /// Returns the same `QueryError::UnknownField` as the in-memory path (raised
    /// by `run_query`'s up-front validation), so Irisy self-correction is unchanged.
    pub fn query_indexed(
        &self,
        table_id: &str,
        fields: &[FieldSpec],
        req: &QueryRequest,
        now: NaiveDate,
    ) -> Result<QueryResult, StIndexError> {
        let type_of = |key: &str| fields.iter().find(|f| f.key == key).map(|f| f.cell_type);

        // Collect the pushable predicates. Only AND conjunction is safe to prune
        // with (an OR row passes on ANY filter, so pruning on a subset would drop
        // true matches). Eq/Neq on numbers use a magnitude-scaled epsilon in
        // `run_query`, not exact `=`, so they are NOT pushed; `within` is relative
        // and left to the full scan. Everything not pushed is handled by run_query.
        let mut conds: Vec<PushCond> = Vec::new();
        if req.conjunction == Conjunction::And {
            for f in &req.filters {
                if let Some(ct) = type_of(&f.field) {
                    if let Some(c) = pushable(f, ct) {
                        conds.push(c);
                    }
                }
            }
        }

        let rows = if conds.is_empty() {
            self.reconstruct_rows(table_id, None)?
        } else {
            let ids = self.candidate_ids(table_id, &conds)?;
            self.reconstruct_rows(table_id, Some(&ids))?
        };

        // run_query is authoritative: validates fields (→ UnknownField), re-applies
        // ALL filters (incl. the pushed ones), sorts, groups, limits.
        run_query(fields, &rows, req, now).map_err(StIndexError::Query)
    }

    /// Row-ids matching ALL pushable predicates (AND intersection), via the
    /// typed-projection indexes. Each predicate is an `IN (subquery)` over
    /// st_cells so the composite indexes (st_cells_num / st_cells_date) serve it.
    fn candidate_ids(&self, table_id: &str, conds: &[PushCond]) -> Result<Vec<String>, StIndexError> {
        let conn = self.conn.lock().map_err(|_| StIndexError::Poisoned)?;
        let mut sql = String::from(
            "SELECT r.row_id FROM st_rows r WHERE r.table_id = ?1",
        );
        for (i, c) in conds.iter().enumerate() {
            // params: ?1 = table_id; then per cond field_key + value, indexed from ?2.
            let p_field = i * 2 + 2;
            let p_val = i * 2 + 3;
            let col = match c {
                PushCond::Num(..) => "value_num",
                PushCond::Date(..) => "value_date",
            };
            sql.push_str(&format!(
                " AND r.row_id IN (SELECT row_id FROM st_cells \
                  WHERE table_id = ?1 AND field_key = ?{p_field} AND {col} {} ?{p_val})",
                c.sql_op(),
            ));
        }
        sql.push_str(" ORDER BY r.row_ord");

        // Bind params: table_id, then (field_key, value) per cond.
        let mut binds: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(table_id.to_string())];
        for c in conds {
            binds.push(Box::new(c.field().to_string()));
            match c {
                PushCond::Num(_, _, v) => binds.push(Box::new(*v)),
                PushCond::Date(_, _, v) => binds.push(Box::new(v.clone())),
            }
        }
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| StIndexError::Db(format!("prepare candidates: {e}")))?;
        let it = stmt
            .query_map(params_from_iter(binds.iter().map(|b| b.as_ref())), |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| StIndexError::Db(format!("candidates: {e}")))?;
        let mut out = Vec::new();
        for r in it {
            out.push(r.map_err(|e| StIndexError::Db(format!("cand row: {e}")))?);
        }
        Ok(out)
    }

    /// Rebuild `Row`s from st_cells in markdown (row_ord) order. `only` restricts
    /// to a candidate set; None = the whole table. Each row carries every field
    /// key (empty string when blank). CTRL-authored tables always serialize a full
    /// cell row, so this matches the markdown-parsed shape exactly; for downstream
    /// consumers (run_query reads `row.get(f).unwrap_or("")`) a present-blank key
    /// and a missing key are value-equivalent, so the blank-fill is not a divergence.
    fn reconstruct_rows(&self, table_id: &str, only: Option<&[String]>) -> Result<Vec<Row>, StIndexError> {
        let conn = self.conn.lock().map_err(|_| StIndexError::Poisoned)?;
        let base = "SELECT c.row_id, c.field_key, c.value_text \
             FROM st_cells c JOIN st_rows r ON r.table_id = c.table_id AND r.row_id = c.row_id \
             WHERE c.table_id = ?1";
        let (sql, ids): (String, Vec<String>) = match only {
            None => (format!("{base} ORDER BY r.row_ord, c.field_key"), Vec::new()),
            Some(ids) => {
                if ids.is_empty() {
                    return Ok(Vec::new());
                }
                let ph = (0..ids.len())
                    .map(|i| format!("?{}", i + 2))
                    .collect::<Vec<_>>()
                    .join(", ");
                (
                    format!("{base} AND c.row_id IN ({ph}) ORDER BY r.row_ord, c.field_key"),
                    ids.to_vec(),
                )
            }
        };
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| StIndexError::Db(format!("prepare rows: {e}")))?;
        // Group consecutive cells (ordered by row_ord) into rows.
        let mut rows: Vec<Row> = Vec::new();
        let mut cur_id: Option<String> = None;
        let mut cur: Row = Row::new();
        let mut bind: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(table_id.to_string())];
        for id in &ids {
            bind.push(Box::new(id.clone()));
        }
        let it = stmt
            .query_map(params_from_iter(bind.iter().map(|b| b.as_ref())), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| StIndexError::Db(format!("rows: {e}")))?;
        for r in it {
            let (row_id, field_key, value_text) =
                r.map_err(|e| StIndexError::Db(format!("row cell: {e}")))?;
            if cur_id.as_deref() != Some(row_id.as_str()) {
                if cur_id.is_some() {
                    rows.push(std::mem::take(&mut cur));
                }
                cur_id = Some(row_id);
            }
            cur.insert(field_key, value_text);
        }
        if cur_id.is_some() {
            rows.push(cur);
        }
        Ok(rows)
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

/// A pushable predicate — a number / date comparison reproducible exactly in
/// SQL over the typed-projection columns (design §C). Anything else stays in
/// `run_query`.
enum PushCond {
    Num(String, Operator, f64),
    Date(String, Operator, String),
}

impl PushCond {
    fn field(&self) -> &str {
        match self {
            PushCond::Num(f, ..) | PushCond::Date(f, ..) => f,
        }
    }
    fn sql_op(&self) -> &'static str {
        let op = match self {
            PushCond::Num(_, op, _) | PushCond::Date(_, op, _) => op,
        };
        match op {
            Operator::Gt | Operator::After => ">",
            Operator::Lt | Operator::Before => "<",
            Operator::Gte => ">=",
            Operator::Lte => "<=",
            Operator::Eq => "=",
            // Only the operators selected by `pushable` reach here.
            _ => "=",
        }
    }
}

/// Decide whether a filter can be pushed to SQL with EXACT `run_query` parity.
/// Number Eq/Neq use a magnitude-scaled epsilon in `run_query` (not exact `=`),
/// so they are excluded; `within` is relative and excluded. A non-parsing value
/// yields None → the filter is left entirely to `run_query`.
fn pushable(f: &Filter, ct: CellType) -> Option<PushCond> {
    match ct {
        CellType::Number => match f.op {
            Operator::Gt | Operator::Lt | Operator::Gte | Operator::Lte => {
                let v = f.value.trim().parse::<f64>().ok().filter(|n| n.is_finite())?;
                Some(PushCond::Num(f.field.clone(), f.op, v))
            }
            _ => None,
        },
        CellType::Date => match f.op {
            Operator::Eq
            | Operator::Before
            | Operator::After
            | Operator::Lt
            | Operator::Gt
            | Operator::Lte
            | Operator::Gte => {
                let d = NaiveDate::parse_from_str(f.value.trim(), "%Y-%m-%d").ok()?;
                Some(PushCond::Date(f.field.clone(), f.op, d.format("%Y-%m-%d").to_string()))
            }
            _ => None,
        },
        _ => None,
    }
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum StIndexError {
    #[error("st-index io error: {0}")]
    Io(String),
    #[error("st-index db error: {0}")]
    Db(String),
    #[error("st-index mutex poisoned")]
    Poisoned,
    #[error("query rejected: {0}")]
    Query(QueryError),
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

    // --- Slice 2: index-backed query parity with the in-memory run_query ---

    fn parity_fields() -> Vec<FieldSpec> {
        vec![
            field("name", CellType::Text),
            field("amount", CellType::Number),
            field("due", CellType::Date),
            field("done", CellType::Checkbox),
            field("tags", CellType::Tags),
        ]
    }

    /// Complete rows (every field key present) — matches the markdown-parsed
    /// shape, so the reconstructed rows equal the in-memory rows exactly.
    fn parity_rows() -> Vec<Row> {
        vec![
            row(&[("name", "Acme"), ("amount", "100"), ("due", "2026-06-20"), ("done", "x"), ("tags", "crm, vip")]),
            row(&[("name", "Beta"), ("amount", "50"), ("due", "2026-07-01"), ("done", ""), ("tags", "crm")]),
            row(&[("name", "Cobalt"), ("amount", "250"), ("due", "2026-06-18"), ("done", ""), ("tags", "lead")]),
            row(&[("name", "Delta"), ("amount", "n/a"), ("due", ""), ("done", "x"), ("tags", "")]),
        ]
    }

    fn now() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 6, 19).unwrap()
    }

    /// The core safety net: for each request the index path must return the
    /// EXACT same rows + match_count as the shared in-memory engine.
    #[test]
    fn index_query_matches_run_query_across_operators() {
        let (path, idx) = fresh_index("parity");
        let fields = parity_fields();
        let rows = parity_rows();
        let tid = idx
            .reindex_table("tables/p.md", None, &fields, &rows, 1, "h")
            .unwrap();

        let f = |field: &str, op: Operator, value: &str| Filter {
            field: field.into(),
            op,
            value: value.into(),
        };
        let cases: Vec<QueryRequest> = vec![
            // empty
            QueryRequest::default(),
            // number gt (pushed)
            QueryRequest { filters: vec![f("amount", Operator::Gt, "80")], ..Default::default() },
            // number lte (pushed)
            QueryRequest { filters: vec![f("amount", Operator::Lte, "100")], ..Default::default() },
            // number eq (NOT pushed — epsilon path)
            QueryRequest { filters: vec![f("amount", Operator::Eq, "250")], ..Default::default() },
            // date before (pushed)
            QueryRequest { filters: vec![f("due", Operator::Before, "2026-06-25")], ..Default::default() },
            // date within (NOT pushed — relative)
            QueryRequest { filters: vec![f("due", Operator::Within, "this_week")], ..Default::default() },
            // text contains (NOT pushed)
            QueryRequest { filters: vec![f("name", Operator::Contains, " co")], ..Default::default() },
            // checkbox is (NOT pushed)
            QueryRequest { filters: vec![f("done", Operator::Is, "true")], ..Default::default() },
            // tags has_tag (NOT pushed)
            QueryRequest { filters: vec![f("tags", Operator::HasTag, "crm")], ..Default::default() },
            // AND of pushed + non-pushed
            QueryRequest {
                filters: vec![f("amount", Operator::Gt, "40"), f("tags", Operator::HasTag, "crm")],
                ..Default::default()
            },
            // OR (not pruned — full scan)
            QueryRequest {
                filters: vec![f("amount", Operator::Lt, "80"), f("tags", Operator::HasTag, "lead")],
                conjunction: Conjunction::Or,
                ..Default::default()
            },
            // sort desc + limit
            QueryRequest {
                sort: vec![SortKey { field: "amount".into(), desc: true }],
                limit: Some(2),
                ..Default::default()
            },
            // group
            QueryRequest { group_by: vec!["done".into()], ..Default::default() },
        ];

        for (i, req) in cases.iter().enumerate() {
            let mem = run_query(&fields, &rows, req, now()).unwrap();
            let via = idx.query_indexed(&tid, &fields, req, now()).unwrap();
            assert_eq!(via.match_count, mem.match_count, "case {i}: match_count");
            assert_eq!(via.rows, mem.rows, "case {i}: rows");
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn index_query_rejects_unknown_field_like_run_query() {
        let (path, idx) = fresh_index("parity-unknown");
        let fields = parity_fields();
        let rows = parity_rows();
        let tid = idx
            .reindex_table("tables/p.md", None, &fields, &rows, 1, "h")
            .unwrap();
        let req = QueryRequest {
            filters: vec![Filter { field: "nope".into(), op: Operator::Eq, value: "x".into() }],
            ..Default::default()
        };
        // Same structured error as the in-memory path (anti-hallucination).
        assert!(run_query(&fields, &rows, &req, now()).is_err());
        match idx.query_indexed(&tid, &fields, &req, now()) {
            Err(StIndexError::Query(QueryError::UnknownField { field, .. })) => {
                assert_eq!(field, "nope");
            }
            other => panic!("expected UnknownField, got {other:?}"),
        }
        let _ = std::fs::remove_file(&path);
    }
}
