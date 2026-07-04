//! Generic silent-auth executors for the feature-pack provision+auth engine
//! (design: `vault/ctrl/feature-pack-provision-auth-engine.md`). The manifest
//! DECLARES how a pack gets credentials (`auth.bootstrap` / `auth.token_exchange`
//! / `auth.oauth`); this runs the declared flow with no manual token entry, so
//! any self-hosted connector is silent by data — zero per-pack code.
//!
//! Kernel-internal reqwest against the user's own provisioned service; captured
//! credentials go to the credential store, never the LLM (ADR-006 decision 0004).

use serde_json::Value;

#[derive(Debug)]
pub enum AuthError {
    Http(String),
    Status(u16),
    Parse(String),
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthError::Http(e) => write!(f, "auth request failed: {e}"),
            AuthError::Status(c) => write!(f, "auth returned HTTP {c}"),
            AuthError::Parse(e) => write!(f, "auth response parse failed: {e}"),
        }
    }
}

fn join(base_url: &str, path: &str) -> String {
    format!("{}/{}", base_url.trim_end_matches('/'), path.trim_start_matches('/'))
}

/// Extract a value at a JSON pointer as a string (numbers stringified). The
/// pointer is RFC-6901 (`/accessToken`, `/data/token`).
fn pointer_str(v: &Value, pointer: &str) -> Option<String> {
    match v.pointer(pointer)? {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// `auth.bootstrap` — run a one-time HTTP call post-provision and capture a value
/// (e.g. Ghostfolio `POST /api/v1/user` → capture `/accessToken`). Returns the
/// captured credential; the caller stores it as the pack's long-lived secret.
pub async fn run_bootstrap(
    client: &reqwest::Client,
    base_url: &str,
    method: &str,
    path: &str,
    body: &Value,
    capture_pointer: &str,
) -> Result<String, AuthError> {
    let url = join(base_url, path);
    let req = if method.eq_ignore_ascii_case("GET") {
        client.get(&url)
    } else {
        client.post(&url).json(body)
    };
    let resp = req
        .send()
        .await
        .map_err(|_| AuthError::Http("could not reach the service".into()))?;
    if !resp.status().is_success() {
        return Err(AuthError::Status(resp.status().as_u16()));
    }
    let v: Value = resp.json().await.map_err(|e| AuthError::Parse(e.to_string()))?;
    pointer_str(&v, capture_pointer)
        .ok_or_else(|| AuthError::Parse(format!("bootstrap response had no value at {capture_pointer}")))
}

/// `auth.token_exchange` — exchange a stored long-lived secret for a short-lived
/// bearer on each call (e.g. Ghostfolio `POST /api/v1/auth/anonymous`
/// `{accessToken}` → `{authToken}`). Generic over the field/pointer names so any
/// connector's exchange is data, not code.
pub async fn mint_bearer(
    client: &reqwest::Client,
    base_url: &str,
    path: &str,
    as_body_field: &str,
    security_token: &str,
    capture_pointer: &str,
) -> Result<String, AuthError> {
    let url = join(base_url, path);
    let body = serde_json::json!({ as_body_field: security_token });
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|_| AuthError::Http("could not reach the service".into()))?;
    if !resp.status().is_success() {
        return Err(AuthError::Status(resp.status().as_u16()));
    }
    let v: Value = resp.json().await.map_err(|e| AuthError::Parse(e.to_string()))?;
    pointer_str(&v, capture_pointer)
        .ok_or_else(|| AuthError::Parse("exchange response had no bearer token".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap()
    }

    #[test]
    fn pointer_reads_string_and_number() {
        let v = serde_json::json!({ "accessToken": "abc", "data": { "n": 42 } });
        assert_eq!(pointer_str(&v, "/accessToken"), Some("abc".to_string()));
        assert_eq!(pointer_str(&v, "/data/n"), Some("42".to_string()));
        assert_eq!(pointer_str(&v, "/missing"), None);
    }

    #[tokio::test]
    async fn bootstrap_captures_declared_pointer() {
        use axum::{routing::post, Json, Router};
        let app = Router::new().route(
            "/api/v1/user",
            post(|| async { Json(serde_json::json!({ "accessToken": "sec-xyz", "role": "USER" })) }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let captured = run_bootstrap(
            &client(),
            &format!("http://{addr}"),
            "POST",
            "/api/v1/user",
            &serde_json::json!({}),
            "/accessToken",
        )
        .await
        .unwrap();
        assert_eq!(captured, "sec-xyz");
    }

    #[tokio::test]
    async fn mint_bearer_exchanges_secret() {
        use axum::{routing::post, Json, Router};
        // Echo that the exchange sent {accessToken: <secret>} and return a JWT.
        let app = Router::new().route(
            "/api/v1/auth/anonymous",
            post(|Json(body): Json<Value>| async move {
                let ok = body.get("accessToken").and_then(Value::as_str) == Some("sec-xyz");
                Json(serde_json::json!({ "authToken": if ok { "jwt-ok" } else { "jwt-bad" } }))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let bearer = mint_bearer(
            &client(),
            &format!("http://{addr}"),
            "/api/v1/auth/anonymous",
            "accessToken",
            "sec-xyz",
            "/authToken",
        )
        .await
        .unwrap();
        assert_eq!(bearer, "jwt-ok");
    }

    #[tokio::test]
    async fn bad_status_is_typed_error() {
        use axum::{http::StatusCode, routing::post, Router};
        let app = Router::new()
            .route("/api/v1/user", post(|| async { StatusCode::UNAUTHORIZED }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let err = run_bootstrap(
            &client(),
            &format!("http://{addr}"),
            "POST",
            "/api/v1/user",
            &serde_json::json!({}),
            "/accessToken",
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AuthError::Status(401)));
    }
}
