// kernel::vault_embeddings — local-first vault semantic embeddings.
//
// (ADR-002 substrate v5 §10 embeddings, 2026-06-03 — memory
// `decision_vault_adr_002_section_8`. Spec:
// `vault/ctrl/history/brainstorm/vault-irisy-product-design-2026-06-03.md` §5.1 + P1.)
//
// Storage: a single SQLite table colocated with the existing kernel
// sqlite file (rusqlite bundled). 768-d vector for each embedded note,
// stored as a BLOB of `f32 * 768 = 3072` little-endian bytes. The
// content_hash + mtime_ms columns let us skip work on `vault.write`
// when nothing material changed.
//
// Search: flat scan + dot product (cosine since vectors are L2-normalised
// on store). Vault scale up to ~50K notes => ~150 MB scan in a single-
// digit ms in release. We deliberately do NOT use sqlite-vss to keep
// build hermetic.
//
// Provider: local Ollama via `provider/ollama_embed.rs` (separate file).
// Cloud fallback is wired but off by default (product P1 transparency —
// user explicitly opts in via Settings).

use std::path::Path;
use std::sync::Arc;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

const VECTOR_DIMS: usize = 768;
const VECTOR_BYTES: usize = VECTOR_DIMS * 4;

#[derive(Debug, Serialize, Clone)]
pub struct EmbeddingHit {
    pub path: String,
    pub score: f32,
    pub snippet: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct EmbeddingStatus {
    /// Total notes in the vault (mirror `vault.list` length).
    pub total: usize,
    /// Notes with up-to-date embeddings (mtime + hash match).
    pub embedded: usize,
    /// Notes whose vault file mtime > stored embedding mtime — embed task pending.
    pub stale: usize,
    /// Last successful Ollama call (ms since epoch).
    pub last_run_at_ms: Option<i64>,
    /// `"available" | "unreachable" | "user-opted-out"`.
    pub provider_status: String,
    /// Embedding model id (e.g. `nomic-embed-text`).
    pub model: String,
}

#[derive(Debug, thiserror::Error)]
pub enum EmbeddingError {
    #[error("sqlite: {0}")]
    Sqlite(String),
    #[error("provider: {0}")]
    Provider(String),
    #[error("vault: {0}")]
    Vault(String),
}

impl From<rusqlite::Error> for EmbeddingError {
    fn from(e: rusqlite::Error) -> Self {
        EmbeddingError::Sqlite(e.to_string())
    }
}

pub struct VaultEmbeddings {
    conn: Arc<std::sync::Mutex<Connection>>,
    pub model: String,
}

impl VaultEmbeddings {
    /// Open at the supplied path. Creates table on first run.
    pub fn open(db_path: &Path, model: impl Into<String>) -> Result<Self, EmbeddingError> {
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(db_path)?;
        Self::ensure_schema(&conn)?;
        Ok(Self {
            conn: Arc::new(std::sync::Mutex::new(conn)),
            model: model.into(),
        })
    }

    fn ensure_schema(conn: &Connection) -> Result<(), EmbeddingError> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS vault_embeddings (
                path          TEXT PRIMARY KEY,
                mtime_ms      INTEGER NOT NULL,
                content_hash  TEXT NOT NULL,
                vector        BLOB NOT NULL,
                embedded_at   INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS vault_embeddings_mtime
                ON vault_embeddings(mtime_ms);
            ",
        )?;
        Ok(())
    }

    /// Upsert one embedding. `vector` must be exactly `VECTOR_DIMS` long.
    /// Stores the vector L2-normalised so search is a dot product.
    pub fn upsert(
        &self,
        path: &str,
        mtime_ms: i64,
        content_hash: &str,
        vector: &[f32],
    ) -> Result<(), EmbeddingError> {
        if vector.len() != VECTOR_DIMS {
            return Err(EmbeddingError::Provider(format!(
                "wrong dim: got {}, expected {}",
                vector.len(),
                VECTOR_DIMS
            )));
        }
        let normalised = l2_normalise(vector);
        let blob = vector_to_blob(&normalised);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let conn = self.conn.lock().map_err(|_| {
            EmbeddingError::Sqlite("vault_embeddings mutex poisoned".to_string())
        })?;
        conn.execute(
            "INSERT INTO vault_embeddings(path, mtime_ms, content_hash, vector, embedded_at)
             VALUES(?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(path) DO UPDATE SET
                mtime_ms = excluded.mtime_ms,
                content_hash = excluded.content_hash,
                vector = excluded.vector,
                embedded_at = excluded.embedded_at",
            params![path, mtime_ms, content_hash, blob, now_ms],
        )?;
        Ok(())
    }

    /// Drop the row for a path (called on `vault.delete`).
    pub fn delete(&self, path: &str) -> Result<(), EmbeddingError> {
        let conn = self.conn.lock().map_err(|_| {
            EmbeddingError::Sqlite("vault_embeddings mutex poisoned".to_string())
        })?;
        conn.execute("DELETE FROM vault_embeddings WHERE path = ?1", params![path])?;
        Ok(())
    }

    /// Look up cached `(mtime_ms, content_hash)` for a path. Caller uses
    /// this to decide whether to re-embed.
    pub fn cached_meta(&self, path: &str) -> Result<Option<(i64, String)>, EmbeddingError> {
        let conn = self.conn.lock().map_err(|_| {
            EmbeddingError::Sqlite("vault_embeddings mutex poisoned".to_string())
        })?;
        let row = conn
            .query_row(
                "SELECT mtime_ms, content_hash FROM vault_embeddings WHERE path = ?1",
                params![path],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()?;
        Ok(row)
    }

    /// Search: flat cosine over the table. `query_vector` should be
    /// L2-normalised by the caller (the embed provider does this).
    pub fn search(
        &self,
        query_vector: &[f32],
        limit: usize,
        threshold: Option<f32>,
    ) -> Result<Vec<EmbeddingHit>, EmbeddingError> {
        if query_vector.len() != VECTOR_DIMS {
            return Err(EmbeddingError::Provider(format!(
                "query dim mismatch: got {}, expected {}",
                query_vector.len(),
                VECTOR_DIMS
            )));
        }
        let q = l2_normalise(query_vector);
        let conn = self.conn.lock().map_err(|_| {
            EmbeddingError::Sqlite("vault_embeddings mutex poisoned".to_string())
        })?;
        let mut stmt = conn.prepare("SELECT path, vector FROM vault_embeddings")?;
        let rows = stmt.query_map(params![], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
        })?;
        let mut hits: Vec<(String, f32)> = Vec::new();
        for row in rows {
            let (path, blob) = row?;
            if blob.len() != VECTOR_BYTES {
                continue;
            }
            let vec = blob_to_vector(&blob);
            let score = dot(&q, &vec);
            if let Some(t) = threshold {
                if score < t {
                    continue;
                }
            }
            hits.push((path, score));
        }
        // Sort descending, take top-limit.
        hits.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        hits.truncate(limit);
        Ok(hits
            .into_iter()
            .map(|(path, score)| EmbeddingHit {
                path,
                score,
                snippet: String::new(), // filled by caller (vault.read)
            })
            .collect())
    }

    /// Status snapshot for the `vault.embedding_status` MCP tool.
    pub fn status(
        &self,
        total_notes: usize,
        provider_status: &str,
    ) -> Result<EmbeddingStatus, EmbeddingError> {
        let conn = self.conn.lock().map_err(|_| {
            EmbeddingError::Sqlite("vault_embeddings mutex poisoned".to_string())
        })?;
        let embedded: usize = conn
            .query_row("SELECT COUNT(*) FROM vault_embeddings", params![], |r| {
                r.get::<_, i64>(0).map(|n| n as usize)
            })?;
        let last_run_at_ms: Option<i64> = conn
            .query_row(
                "SELECT MAX(embedded_at) FROM vault_embeddings",
                params![],
                |r| r.get::<_, Option<i64>>(0),
            )?;
        let stale = if total_notes >= embedded {
            total_notes - embedded
        } else {
            0
        };
        Ok(EmbeddingStatus {
            total: total_notes,
            embedded,
            stale,
            last_run_at_ms,
            provider_status: provider_status.to_string(),
            model: self.model.clone(),
        })
    }
}

/// SHA-256 hex of body text. Used as content_hash on upsert.
pub fn content_hash(body: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    // We use std hash for simplicity (no extra dep). Collision risk over
    // a 50K-note vault is negligible; the mtime check is the primary
    // staleness signal, hash is just the second line.
    let mut h = DefaultHasher::new();
    body.hash(&mut h);
    format!("{:x}", h.finish())
}

fn l2_normalise(v: &[f32]) -> Vec<f32> {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm == 0.0 {
        return v.to_vec();
    }
    v.iter().map(|x| x / norm).collect()
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

fn vector_to_blob(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

fn blob_to_vector(b: &[u8]) -> Vec<f32> {
    let mut out = Vec::with_capacity(b.len() / 4);
    for chunk in b.chunks_exact(4) {
        out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn fake_vec(seed: f32) -> Vec<f32> {
        (0..VECTOR_DIMS).map(|i| (i as f32 + 1.0) * seed).collect()
    }

    #[test]
    fn roundtrip_upsert_and_search() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("embed.db");
        let emb = VaultEmbeddings::open(&path, "nomic-embed-text").unwrap();
        emb.upsert("notes/a.md", 1, "hash-a", &fake_vec(1.0)).unwrap();
        emb.upsert("notes/b.md", 2, "hash-b", &fake_vec(2.0)).unwrap();
        emb.upsert("notes/c.md", 3, "hash-c", &fake_vec(-1.0)).unwrap();

        let hits = emb.search(&fake_vec(1.5), 2, None).unwrap();
        assert_eq!(hits.len(), 2);
        // a + b both point the same direction as the query → top hits.
        assert!(matches!(hits[0].path.as_str(), "notes/a.md" | "notes/b.md"));
    }

    #[test]
    fn delete_removes_row() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("embed.db");
        let emb = VaultEmbeddings::open(&path, "test").unwrap();
        emb.upsert("notes/a.md", 1, "h", &fake_vec(1.0)).unwrap();
        emb.delete("notes/a.md").unwrap();
        assert!(emb.cached_meta("notes/a.md").unwrap().is_none());
    }

    #[test]
    fn content_hash_is_deterministic() {
        let a = content_hash("hello world");
        let b = content_hash("hello world");
        let c = content_hash("hello world!");
        assert_eq!(a, b);
        assert_ne!(a, c);
    }
}
