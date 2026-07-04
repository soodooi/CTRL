// Persistence — local event store + actor registry on SQLite (WAL mode).
//
// Schema follows .olym/specs/kernel/spec.md §5:
//   events    — append-only with secondary indexes
//   actors    — actor registry with capability + state snapshot
//   manifests — cached mcp manifests
//
// Optional CRDT layer (P11+) syncs cross-device via Yjs/Automerge.
// P2.1 skeleton — bootstrap + schema only. Query/replay API in P2.5.

use crate::kernel::audit::GateRequest;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub struct EventStore {
    conn: Mutex<Connection>,
}

impl EventStore {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Self::run_migrations(&conn);
        // Enable WAL for crash safety + concurrent reads.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn open_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        Self::run_migrations(&conn);
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Apply idempotent ADD-COLUMN migrations; a "duplicate column" error means
    /// the migration already ran (SQLite lacks ADD COLUMN IF NOT EXISTS), so it
    /// is expected and ignored.
    fn run_migrations(conn: &Connection) {
        for stmt in MIGRATIONS {
            let _ = conn.execute(stmt, []);
        }
    }

    /// Record one gate-crossing call in the audit ledger
    /// (ADR-010 communication § trust-domains). The :17873 gate calls this for
    /// every `External` call so the trail is single-sourced at the boundary;
    /// kernel-internal actor<->actor traffic is `Internal` and not recorded.
    /// Best-effort by contract: a ledger write failure must never block the
    /// underlying call, so callers log-and-continue rather than propagate.
    /// Record one cross-domain call. Takes a `GateRequest` (not loose params), so
    /// the type system guarantees only gate-crossing (External) calls reach the
    /// ledger — internal traffic cannot construct one (ADR-010 § trust-domains,
    /// SC1 compile-time isolation).
    pub fn record_call(
        &self,
        req: &GateRequest,
        outcome: &str,
        detail: Option<&str>,
        result: Option<&str>,
    ) -> rusqlite::Result<()> {
        let ts_ms = chrono::Utc::now().timestamp_millis();
        // Bound the stored result so a big tool output doesn't bloat the ledger.
        const MAX_RESULT: usize = 4000;
        let result_trunc = result.map(|r| {
            if r.len() > MAX_RESULT {
                let mut s = r[..MAX_RESULT].to_string();
                s.push_str("…<truncated>");
                s
            } else {
                r.to_string()
            }
        });
        // Best-effort by contract: a poisoned ledger mutex must never panic and
        // block the underlying call — recover the guard instead of unwrapping.
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT INTO audit_calls (ts_ms, domain, caller, tool, args_hash, outcome, detail, args, result) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                ts_ms,
                req.domain().as_str(),
                req.caller(),
                req.tool(),
                req.args_hash(),
                outcome,
                detail,
                req.args_json(),
                result_trunc,
            ],
        )?;
        Ok(())
    }

    /// Count audit-ledger rows — inspection/test helper.
    pub fn audit_count(&self) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.query_row("SELECT COUNT(*) FROM audit_calls", [], |r| r.get(0))
    }
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_ms       INTEGER NOT NULL,
    actor_id    TEXT NOT NULL,
    kind        TEXT NOT NULL,
    payload     BLOB NOT NULL,
    idx_a       TEXT,
    idx_b       TEXT,
    idx_c       TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts_ms);
CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor_id);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
CREATE INDEX IF NOT EXISTS idx_events_a ON events(idx_a) WHERE idx_a IS NOT NULL;

CREATE TABLE IF NOT EXISTS actors (
    id            TEXT PRIMARY KEY,
    prototype     TEXT NOT NULL,
    parent_id     TEXT,
    capability    BLOB NOT NULL,
    state         BLOB,
    spawned_at_ms INTEGER NOT NULL,
    status        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manifests (
    id            TEXT PRIMARY KEY,
    version       TEXT NOT NULL,
    source        TEXT NOT NULL,
    spec          BLOB NOT NULL,
    cached_at_ms  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_calls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_ms       INTEGER NOT NULL,
    domain      TEXT NOT NULL,
    caller      TEXT NOT NULL,
    tool        TEXT NOT NULL,
    args_hash   TEXT NOT NULL,
    outcome     TEXT NOT NULL,
    detail      TEXT,
    args        TEXT,
    result      TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_calls(ts_ms);
CREATE INDEX IF NOT EXISTS idx_audit_tool ON audit_calls(tool);
"#;

/// Idempotent migrations for DBs created before a column existed (SQLite has no
/// ADD COLUMN IF NOT EXISTS, so we run it and ignore the "duplicate column"
/// error). S2 (plan-agent-observability.md): the audit ledger gains real-trace
/// `args` (redacted) + `result` columns on top of the existing `args_hash`.
const MIGRATIONS: &[&str] = &[
    "ALTER TABLE audit_calls ADD COLUMN args TEXT",
    "ALTER TABLE audit_calls ADD COLUMN result TEXT",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_ledger_records_external_calls() {
        let store = EventStore::open_memory().unwrap();
        assert_eq!(store.audit_count().unwrap(), 0);

        // A GateRequest can only be built at the gate boundary; the ledger
        // records exactly what crossed (External by construction).
        store
            .record_call(
                &GateRequest::at_gate("external".into(), "vault_read", None),
                "ok",
                None,
                Some("read ok"),
            )
            .unwrap();
        store
            .record_call(
                &GateRequest::at_gate("external".into(), "vault_write", None),
                "error",
                Some("boom"),
                None,
            )
            .unwrap();

        assert_eq!(store.audit_count().unwrap(), 2);
    }

    #[test]
    fn audit_ledger_captures_redacted_args_and_result() {
        let store = EventStore::open_memory().unwrap();
        let placeholder = "leaky-placeholder-xyz";
        let mut args = serde_json::Map::new();
        args.insert("path".into(), serde_json::Value::String("crm/deals.md".into()));
        args.insert("token".into(), serde_json::Value::String(placeholder.into()));
        store
            .record_call(
                &GateRequest::at_gate("hermes".into(), "smart_table_base_scaffold", Some(&args)),
                "ok",
                None,
                Some("created base"),
            )
            .unwrap();
        let conn = store.conn.lock().unwrap();
        let (a, r): (String, String) = conn
            .query_row(
                "SELECT args, result FROM audit_calls ORDER BY id DESC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        // The real arg is kept for debugging…
        assert!(a.contains("crm/deals.md"), "args should keep the real payload: {a}");
        // …but the secret VALUE is redacted (privacy red-line).
        assert!(a.contains("<redacted>"), "secret must be redacted: {a}");
        assert!(!a.contains(placeholder), "secret value must not leak: {a}");
        assert_eq!(r, "created base");
    }
}
