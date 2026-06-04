// Vault embeddings Tauri commands (ADR-002 v5 §10.4).
//
// PWA-facing surface for the 5 new tools. Mirrors the MCP names so the
// frontend and external agents see the same shapes.

use serde::{Deserialize, Serialize};

use crate::kernel::provider::ollama_embed::OllamaEmbedClient;
use crate::kernel::vault;
use crate::kernel::vault_embeddings::{
    self, content_hash as compute_hash, EmbeddingHit, EmbeddingStatus, VaultEmbeddings,
};

fn vault_root() -> Result<std::path::PathBuf, String> {
    vault::default_vault_root().ok_or_else(|| "HOME env var not set".to_string())
}

fn db_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME env var not set".to_string())?;
    Ok(std::path::PathBuf::from(home).join(".ctrl/embeddings.db"))
}

fn open_embeddings() -> Result<VaultEmbeddings, String> {
    let path = db_path()?;
    VaultEmbeddings::open(&path, "nomic-embed-text").map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct EmbedNoteArgs {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct EmbedNoteReply {
    pub path: String,
    pub vector_dims: usize,
    pub cached: bool,
}

#[tauri::command]
pub async fn vault_embed_note(args: EmbedNoteArgs) -> Result<EmbedNoteReply, String> {
    let root = vault_root()?;
    let entry = vault::read(&root, &args.path).map_err(|e| e.to_string())?;
    let hash = compute_hash(&entry.content);
    let emb = open_embeddings()?;
    if let Some((_mtime, cached_hash)) = emb.cached_meta(&args.path).map_err(|e| e.to_string())? {
        if cached_hash == hash {
            return Ok(EmbedNoteReply {
                path: args.path,
                vector_dims: 768,
                cached: true,
            });
        }
    }
    let client = OllamaEmbedClient::new();
    let vector = client.embed(&entry.content).await.map_err(|e| e.to_string())?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    emb.upsert(&args.path, now_ms, &hash, &vector)
        .map_err(|e| e.to_string())?;
    Ok(EmbedNoteReply {
        path: args.path,
        vector_dims: vector.len(),
        cached: false,
    })
}

#[derive(Debug, Deserialize)]
pub struct ReembedAllArgs {
    /// When true, forces re-embed of all notes even if their hash matches.
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Serialize)]
pub struct ReembedAllReply {
    pub embedded: usize,
    pub skipped: usize,
    pub failed: usize,
}

#[tauri::command]
pub async fn vault_reembed_all(args: ReembedAllArgs) -> Result<ReembedAllReply, String> {
    let root = vault_root()?;
    let paths = vault::list(&root, None).map_err(|e| e.to_string())?;
    let emb = open_embeddings()?;
    let client = OllamaEmbedClient::new();
    let mut embedded = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;
    for path in paths {
        let entry = match vault::read(&root, &path) {
            Ok(e) => e,
            Err(_) => {
                failed += 1;
                continue;
            }
        };
        let hash = compute_hash(&entry.content);
        if !args.force {
            if let Ok(Some((_mtime, cached))) = emb.cached_meta(&path) {
                if cached == hash {
                    skipped += 1;
                    continue;
                }
            }
        }
        match client.embed(&entry.content).await {
            Ok(vec) => {
                let now_ms = chrono::Utc::now().timestamp_millis();
                if emb.upsert(&path, now_ms, &hash, &vec).is_ok() {
                    embedded += 1;
                } else {
                    failed += 1;
                }
            }
            Err(_) => {
                failed += 1;
            }
        }
    }
    Ok(ReembedAllReply {
        embedded,
        skipped,
        failed,
    })
}

#[tauri::command]
pub async fn vault_embedding_status() -> Result<EmbeddingStatus, String> {
    let root = vault_root()?;
    let total = vault::list(&root, None)
        .map(|v| v.len())
        .unwrap_or(0);
    let client = OllamaEmbedClient::new();
    let provider_status = match client.probe().await {
        Ok(_) => "available",
        Err(_) => "unreachable",
    };
    let emb = open_embeddings()?;
    emb.status(total, provider_status).map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct SemanticSearchArgs {
    pub query: String,
    pub limit: Option<usize>,
    pub threshold: Option<f32>,
}

#[tauri::command]
pub async fn vault_semantic_search(
    args: SemanticSearchArgs,
) -> Result<Vec<EmbeddingHit>, String> {
    let client = OllamaEmbedClient::new();
    let query_vec = client
        .embed(&args.query)
        .await
        .map_err(|e| e.to_string())?;
    let emb = open_embeddings()?;
    let mut hits = emb
        .search(&query_vec, args.limit.unwrap_or(10), args.threshold)
        .map_err(|e| e.to_string())?;
    // Hydrate snippets from disk.
    let root = vault_root()?;
    for hit in hits.iter_mut() {
        if let Ok(entry) = vault::read(&root, &hit.path) {
            let snip = entry.content.chars().take(160).collect::<String>();
            hit.snippet = snip;
        }
    }
    Ok(hits)
}

#[derive(Debug, Deserialize)]
pub struct SuggestLinksArgs {
    /// Source path whose embedding seeds the search.
    pub for_path: String,
    pub limit: Option<usize>,
}

#[tauri::command]
pub async fn vault_suggest_links(
    args: SuggestLinksArgs,
) -> Result<Vec<EmbeddingHit>, String> {
    let root = vault_root()?;
    let entry = vault::read(&root, &args.for_path).map_err(|e| e.to_string())?;
    let client = OllamaEmbedClient::new();
    let vec = client.embed(&entry.content).await.map_err(|e| e.to_string())?;
    let emb = open_embeddings()?;
    let mut hits = emb
        .search(&vec, args.limit.unwrap_or(5) + 1, None)
        .map_err(|e| e.to_string())?;
    // Drop self.
    hits.retain(|h| h.path != args.for_path);
    hits.truncate(args.limit.unwrap_or(5));
    // Hydrate snippets.
    for hit in hits.iter_mut() {
        if let Ok(entry) = vault::read(&root, &hit.path) {
            let snip = entry.content.chars().take(120).collect::<String>();
            hit.snippet = snip;
        }
    }
    Ok(hits)
}

// Silence the unused warning on the `vault_embeddings` re-export when no
// caller below needs it (module-level pub use stays available).
#[allow(dead_code)]
fn _force_use_vault_embeddings() {
    let _ = vault_embeddings::content_hash("");
}
