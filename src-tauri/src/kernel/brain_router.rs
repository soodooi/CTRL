// Brain router — routes `text.chat` to the active brain keycap.
//
// Per ADR-001 amendment 2026-05-25: CTRL has a sole brain (Pi) that drives
// Irisy. The router resolves `~/.ctrl/active-brain` (single-line file holding
// the brain keycap id, default `pi`) and dispatches text.chat MCP calls to
// that keycap's local MCP server.
//
// Deliberately ≤ 200 LOC inline lookup, NOT a substrate / module sprawl —
// per hephaestus review 2026-05-25 ("BrainRouter 别长成 substrate").
//
// Wire shape (ctrl-pi-plugin runs on 127.0.0.1:17874):
//   PWA Irisy → invoke('irisy_chat_stream', { messages })
//   → kernel chat.rs → BrainRouter::route_text_chat
//   → POST http://127.0.0.1:17874/mcp tools/call text.chat { messages }
//   → SSE stream back to PWA via 'chat-stream-delta' event
//
// First-version scope: resolve active brain id + bridge endpoint registry.
// Spawn supervisor + HTTP/SSE dispatch lands in the next commit (depends on
// keycap-dev merge so the Pi plugin code path exists).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Active brain id. Default = "pi" (sole brain for Irisy per ADR-001
/// amendment 2026-05-25). The `~/.ctrl/active-brain` single-line file lets
/// power users override (e.g. swap to a future kernel-embedded brain) but
/// v1.0 ships with "pi" baked in — no Settings UI surfaces this switch.
const DEFAULT_BRAIN_ID: &str = "pi";

/// Endpoint registry for installed brain keycaps. Populated at boot by
/// scanning `~/.ctrl/keycaps/*/keycap.md` for manifests with `target: brain`
/// and reading their `bridge` field. v1.0 expects exactly one entry (pi);
/// hermes-as-optional-keycap (memory `decision_pi_is_sole_brain_hermes_is_keycap`)
/// is registered the same way when the user installs that keycap from Pool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainEndpoint {
    pub keycap_id: String,
    pub bridge_package: String, // e.g. "@ctrl/pi-plugin"
    pub mcp_url: String,        // e.g. "http://127.0.0.1:17874/mcp"
    pub capability: String,     // e.g. "text.chat"
}

#[derive(Debug, thiserror::Error)]
pub enum BrainRouterError {
    #[error("active brain '{0}' is not installed — install it from Pool or change ~/.ctrl/active-brain")]
    BrainNotInstalled(String),
    #[error("brain keycap '{0}' bridge not yet spawned — supervisor wiring lands in next commit")]
    BridgeNotReady(String),
    #[error("io error reading ~/.ctrl/active-brain: {0}")]
    Io(String),
}

pub struct BrainRouter {
    config_dir: PathBuf,
    endpoints: RwLock<Vec<BrainEndpoint>>,
}

impl BrainRouter {
    /// Build a router rooted at `config_dir` (typically ~/.ctrl). The router
    /// resolves the active brain id lazily on each call so that user edits
    /// to `~/.ctrl/active-brain` take effect without a kernel restart.
    pub fn new(config_dir: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            config_dir,
            endpoints: RwLock::new(Vec::new()),
        })
    }

    /// Resolve the active brain id. Reads `~/.ctrl/active-brain` if it exists,
    /// otherwise falls back to DEFAULT_BRAIN_ID. The file is a single-line
    /// plain-text id (no JSON / TOML — matches the plain-text philosophy in
    /// CLAUDE.md "Meta: Plain-text 哲学").
    pub fn active_brain_id(&self) -> String {
        let path = self.config_dir.join("active-brain");
        match std::fs::read_to_string(&path) {
            Ok(s) => {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    DEFAULT_BRAIN_ID.to_string()
                } else {
                    trimmed.to_string()
                }
            }
            Err(_) => DEFAULT_BRAIN_ID.to_string(),
        }
    }

    /// Register a brain keycap's bridge endpoint. Called by the supervisor
    /// when it spawns / discovers a brain keycap MCP server. Idempotent —
    /// re-registering by id replaces the previous entry.
    pub async fn register(&self, endpoint: BrainEndpoint) {
        let mut endpoints = self.endpoints.write().await;
        endpoints.retain(|e| e.keycap_id != endpoint.keycap_id);
        endpoints.push(endpoint);
    }

    /// Look up the endpoint for the currently-active brain. Returns
    /// `BrainNotInstalled` if no endpoint is registered for the active id —
    /// the PWA surfaces an "install Pi" prompt in that case.
    pub async fn active_endpoint(&self) -> Result<BrainEndpoint, BrainRouterError> {
        let active = self.active_brain_id();
        let endpoints = self.endpoints.read().await;
        endpoints
            .iter()
            .find(|e| e.keycap_id == active)
            .cloned()
            .ok_or_else(|| BrainRouterError::BrainNotInstalled(active))
    }

    /// List all registered brain keycaps. Used by Settings → brain page to
    /// show "Pi (active) / hermes (installed, inactive)" inventory.
    pub async fn list_brains(&self) -> Vec<BrainEndpoint> {
        self.endpoints.read().await.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn defaults_to_pi_when_no_config() {
        let dir = tempdir().unwrap();
        let router = BrainRouter::new(dir.path().to_path_buf());
        assert_eq!(router.active_brain_id(), "pi");
    }

    #[tokio::test]
    async fn reads_active_brain_file() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("active-brain"), "hermes\n").unwrap();
        let router = BrainRouter::new(dir.path().to_path_buf());
        assert_eq!(router.active_brain_id(), "hermes");
    }

    #[tokio::test]
    async fn trims_whitespace_and_falls_back_on_empty() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("active-brain"), "   \n").unwrap();
        let router = BrainRouter::new(dir.path().to_path_buf());
        assert_eq!(router.active_brain_id(), "pi");
    }

    #[tokio::test]
    async fn register_is_idempotent_by_id() {
        let dir = tempdir().unwrap();
        let router = BrainRouter::new(dir.path().to_path_buf());
        router
            .register(BrainEndpoint {
                keycap_id: "pi".into(),
                bridge_package: "@ctrl/pi-plugin".into(),
                mcp_url: "http://127.0.0.1:17874/mcp".into(),
                capability: "text.chat".into(),
            })
            .await;
        router
            .register(BrainEndpoint {
                keycap_id: "pi".into(),
                bridge_package: "@ctrl/pi-plugin".into(),
                mcp_url: "http://127.0.0.1:17875/mcp".into(), // changed port
                capability: "text.chat".into(),
            })
            .await;
        let list = router.list_brains().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].mcp_url, "http://127.0.0.1:17875/mcp");
    }

    #[tokio::test]
    async fn active_endpoint_errors_when_no_brain_registered() {
        let dir = tempdir().unwrap();
        let router = BrainRouter::new(dir.path().to_path_buf());
        let err = router.active_endpoint().await.unwrap_err();
        assert!(matches!(err, BrainRouterError::BrainNotInstalled(id) if id == "pi"));
    }
}
