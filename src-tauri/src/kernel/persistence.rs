// Persistence — local event store + actor registry on SQLite (WAL mode).
//
// Schema follows .olym/specs/kernel/spec.md §5:
//   events    — append-only with secondary indexes
//   actors    — actor registry with capability + state snapshot
//   manifests — cached keycap manifests
//
// Optional CRDT layer (P11+) syncs cross-device via Yjs/Automerge.
// P2.1 skeleton — bootstrap + schema only. Query/replay API in P2.5.

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
        Ok(Self {
            conn: Mutex::new(conn),
        })
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
"#;
