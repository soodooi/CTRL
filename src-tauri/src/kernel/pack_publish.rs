//! Feature-pack publish — the PRODUCE side of share-and-be-shared (ADR-002 §7.6).
//! Discover already consumes registries (§7.3/§7.4 pull); this is the missing
//! half: publish a `ctrl-*` manifest to a commons so what one user builds is what
//! another discovers. v1 publishes the v2 manifest JSON (the `.mcpb` bundle is
//! reserved).
//!
//! Invariant: EVALS FIRST — a pack that fails `pack_validate` is never published
//! (§7.4/§7.5 quality bar; you can't ship a broken pack to the commons). The real
//! public registry (official MCP Registry mcp-publisher + namespace ownership, or
//! the ctrl-market Worker) is the honest external gap; the CTRL-side producer is
//! kernel-internal HTTPS with the token resolved kernel-side (never the LLM),
//! verified here by mock-HTTP — the same posture as the §14 connector fetch.

use crate::kernel::pack_validate::{self, Issue};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug)]
pub enum PublishError {
    /// The manifest failed evals — not published (carries the issues to fix).
    Blocked(Vec<Issue>),
    Http(String),
    Status(u16),
    Parse(String),
}

impl std::fmt::Display for PublishError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PublishError::Blocked(issues) => {
                let n = issues.iter().filter(|i| matches!(i.severity, pack_validate::Severity::Error)).count();
                write!(f, "not published: {n} eval error(s) — fix them first")
            }
            PublishError::Http(e) => write!(f, "publish request failed: {e}"),
            PublishError::Status(c) => write!(f, "registry returned HTTP {c}"),
            PublishError::Parse(e) => write!(f, "registry response parse failed: {e}"),
        }
    }
}

/// The published reference the registry returns (what a peer would `discover`).
#[derive(Debug, Clone, Serialize)]
pub struct PublishRef {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// Publish a candidate manifest to a registry. Evals first (never publish a
/// broken pack), then POST the manifest JSON. Token, if present, is sent as a
/// bearer; it stays kernel-side.
pub async fn publish(
    manifest: &Value,
    registry_url: &str,
    token: &str,
) -> Result<PublishRef, PublishError> {
    // Evals first — the §7.4/§7.5 quality bar. No HTTP if it fails.
    let report = pack_validate::validate_manifest(manifest);
    if !report.ok {
        return Err(PublishError::Blocked(report.issues));
    }

    let id = manifest
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|_| PublishError::Http("could not build http client".into()))?;
    let mut req = client.post(registry_url).json(manifest);
    if !token.trim().is_empty() {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    let resp = req
        .send()
        .await
        .map_err(|_| PublishError::Http("could not reach the registry".into()))?;
    if !resp.status().is_success() {
        return Err(PublishError::Status(resp.status().as_u16()));
    }
    let body: Value = resp.json().await.map_err(|e| PublishError::Parse(e.to_string()))?;

    // Tolerant of the registry's response shape: take namespace/url if present,
    // fall back to the manifest id.
    Ok(PublishRef {
        id: body.get("id").and_then(Value::as_str).map(str::to_string).unwrap_or(id),
        namespace: body.get("namespace").and_then(Value::as_str).map(str::to_string),
        url: body.get("url").and_then(Value::as_str).map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ghostfolio_manifest() -> Value {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../packages/ctrl-mcps/builtin/ctrl-ghostfolio/manifest.json"
        );
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    // A broken manifest is blocked by evals BEFORE any network call — proven by
    // pointing at an unroutable URL that would error if reached.
    #[tokio::test]
    async fn broken_manifest_is_blocked_before_any_http() {
        let bad = serde_json::json!({ "name": "no id, no actions" });
        let err = publish(&bad, "http://127.0.0.1:1/never", "").await.unwrap_err();
        match err {
            PublishError::Blocked(issues) => {
                assert!(issues.iter().any(|i| i.field == "id"));
            }
            other => panic!("expected Blocked, got {other}"),
        }
    }

    // A valid pack publishes over real HTTP to a mock registry that echoes a ref.
    #[tokio::test]
    async fn valid_pack_publishes_and_returns_ref() {
        use axum::{routing::post, Json, Router};
        let app = Router::new().route(
            "/publish",
            post(|Json(m): Json<Value>| async move {
                // Echo a registry-style ref for the received manifest.
                Json(serde_json::json!({
                    "id": m.get("id").cloned().unwrap_or(Value::Null),
                    "namespace": "soodooi",
                    "url": "https://registry.example/soodooi/ctrl-ghostfolio"
                }))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let out = publish(&ghostfolio_manifest(), &format!("http://{addr}/publish"), "tok")
            .await
            .unwrap();
        assert_eq!(out.id, "ctrl-ghostfolio");
        assert_eq!(out.namespace.as_deref(), Some("soodooi"));
        assert!(out.url.unwrap().contains("ctrl-ghostfolio"));
    }

    #[tokio::test]
    async fn registry_error_is_typed() {
        use axum::{http::StatusCode, routing::post, Router};
        let app = Router::new().route("/publish", post(|| async { StatusCode::FORBIDDEN }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let err = publish(&ghostfolio_manifest(), &format!("http://{addr}/publish"), "")
            .await
            .unwrap_err();
        assert!(matches!(err, PublishError::Status(403)));
    }
}
