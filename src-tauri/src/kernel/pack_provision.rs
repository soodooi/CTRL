//! Generic provision engine for the feature-pack provision+auth engine (design:
//! `vault/ctrl/feature-pack-provision-auth-engine.md`). Turns a manifest's
//! declared `provision.service` (a container/compose stack) + `auth` into a
//! one-click, silent install — zero per-pack code:
//!
//!   install → generate secrets → render compose + .env → `docker compose up`
//!           → poll ready → run auth.bootstrap (mint + capture credential)
//!
//! Everything the user would otherwise type (URL, token, DB/JWT secrets) is
//! generated or auto-minted and stored in the credential store, never the LLM
//! (ADR-006 decision 0004). The actual `docker compose up` runs on the user's
//! machine (needs a container runtime); the pure render/orchestration logic is
//! unit-tested here, the container round-trip is verified on a real build.

use crate::shell::credential_vault;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;

/// Credential-store account for a pack field (mirrors the provision runner +
/// the gate's generic `resolve_pack_creds`): `mcp:<pack_id>:<field>`.
pub fn secret_account(pack_id: &str, field: &str) -> String {
    format!("mcp:{pack_id}:{field}")
}

/// A strong random secret (two v4 UUIDs = 64 hex chars, 244 random bits) for
/// generated service secrets (JWT keys, DB passwords). No new dependency.
fn generate_secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// Idempotently ensure each generated-secret key exists in the credential store
/// for this pack: reuse an existing value, else mint + store. Returns the full
/// map (key → value) for compose interpolation.
fn ensure_generated_secrets(
    pack_id: &str,
    keys: &[String],
) -> Result<BTreeMap<String, String>, String> {
    let mut out = BTreeMap::new();
    for key in keys {
        let account = secret_account(pack_id, key);
        let value = match credential_vault::get(&account)? {
            Some(v) if !v.trim().is_empty() => v,
            _ => {
                let v = generate_secret();
                credential_vault::set(&account, &v)?;
                v
            }
        };
        out.insert(key.clone(), value);
    }
    Ok(out)
}

/// Render the `.env` file docker compose interpolates: the generated secrets +
/// `PORT_APP`. Pure — the unit-tested core of provisioning.
fn render_env(secrets: &BTreeMap<String, String>, port_app: u16) -> String {
    let mut lines: Vec<String> = secrets.iter().map(|(k, v)| format!("{k}={v}")).collect();
    lines.push(format!("PORT_APP={port_app}"));
    lines.join("\n") + "\n"
}

/// Resolve a `ready.url` / auth-path template's `{port:app}` placeholder. Pure.
fn resolve_port_template(template: &str, port_app: u16) -> String {
    template.replace("{port:app}", &port_app.to_string())
}

fn service_dir(pack_id: &str) -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME unset".to_string())?;
    Ok(PathBuf::from(home).join(".ctrl").join("services").join(pack_id))
}

/// The container-runtime base command: prefer `docker compose`, fall back to
/// `podman compose`. Errs (with guidance) when neither is present.
async fn compose_program() -> Result<&'static str, String> {
    for prog in ["docker", "podman"] {
        let ok = tokio::process::Command::new(prog)
            .arg("version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return Ok(prog);
        }
    }
    Err("no container runtime found — install Docker or Podman to run this pack".into())
}

/// Provision the declared service: ensure secrets → write compose + .env →
/// `<runtime> compose up -d` → poll ready. Stores + returns the base URL
/// (`http://127.0.0.1:<port>`). Idempotent: re-running reuses secrets and
/// `compose up` is a no-op when already healthy.
pub async fn provision_service(pack_id: &str, service: &Value) -> Result<String, String> {
    let port_app = service
        .pointer("/ports/app")
        .and_then(Value::as_u64)
        .unwrap_or(3333) as u16;
    let compose = service
        .get("compose_inline")
        .and_then(Value::as_str)
        .ok_or("provision.service.compose_inline missing (v1 requires inline compose)")?;
    let gen_keys: Vec<String> = service
        .get("generated_secrets")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    let secrets = ensure_generated_secrets(pack_id, &gen_keys)?;
    let env = render_env(&secrets, port_app);

    let dir = service_dir(pack_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("service dir: {e}"))?;
    let compose_path = dir.join("compose.yml");
    let env_path = dir.join(".env");
    std::fs::write(&compose_path, compose).map_err(|e| format!("write compose: {e}"))?;
    std::fs::write(&env_path, env).map_err(|e| format!("write env: {e}"))?;

    let prog = compose_program().await?;
    let status = tokio::process::Command::new(prog)
        .arg("compose")
        .arg("-f")
        .arg(&compose_path)
        .arg("--env-file")
        .arg(&env_path)
        .arg("up")
        .arg("-d")
        .status()
        .await
        .map_err(|e| format!("{prog} compose up failed to start: {e}"))?;
    if !status.success() {
        return Err(format!("{prog} compose up exited with a non-zero status"));
    }

    let base_url = format!("http://127.0.0.1:{port_app}");
    if let Some(ready) = service.get("ready") {
        let url = resolve_port_template(
            ready.get("url").and_then(Value::as_str).unwrap_or_default(),
            port_app,
        );
        let timeout_s = ready.pointer("/timeout_s").and_then(Value::as_u64).unwrap_or(180);
        poll_ready(&url, timeout_s).await?;
    }

    // Record the resolved base URL for the auth/query layer to read.
    credential_vault::set(&secret_account(pack_id, "_base_url"), &base_url)?;
    Ok(base_url)
}

async fn poll_ready(url: &str, timeout_s: u64) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let deadline = timeout_s;
    let mut waited = 0u64;
    loop {
        if let Ok(resp) = client.get(url).send().await {
            if resp.status().is_success() {
                return Ok(());
            }
        }
        if waited >= deadline {
            return Err(format!("service not ready after {timeout_s}s ({url})"));
        }
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        waited += 3;
    }
}

/// One-click install orchestration: bring up the declared service (if any), then
/// run the declared bootstrap auth (if any) to mint + store the pack's
/// credential. Idempotent. `manifest` is the parsed manifest JSON.
pub async fn install_pack(pack_id: &str, manifest: &Value) -> Result<String, String> {
    let mut steps: Vec<String> = Vec::new();

    let base_url = if let Some(service) = manifest.pointer("/provision/service") {
        let url = provision_service(pack_id, service).await?;
        steps.push(format!("service up at {url}"));
        url
    } else {
        credential_vault::get(&secret_account(pack_id, "_base_url"))?.unwrap_or_default()
    };

    if let Some(bootstrap) = manifest.pointer("/auth/bootstrap") {
        let into = bootstrap
            .pointer("/capture/into_secret")
            .and_then(Value::as_str)
            .ok_or("auth.bootstrap.capture.into_secret missing")?;
        let account = secret_account(pack_id, into);
        // Idempotent: skip if already minted.
        let have = credential_vault::get(&account)?.is_some_and(|v| !v.trim().is_empty());
        if !have {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .map_err(|e| e.to_string())?;
            let method = bootstrap.get("method").and_then(Value::as_str).unwrap_or("POST");
            let path = bootstrap.get("path").and_then(Value::as_str).unwrap_or_default();
            let body = bootstrap.get("body").cloned().unwrap_or(Value::Object(Default::default()));
            let pointer = bootstrap
                .pointer("/capture/pointer")
                .and_then(Value::as_str)
                .unwrap_or("/accessToken");
            let captured =
                crate::kernel::pack_auth::run_bootstrap(&client, &base_url, method, path, &body, pointer)
                    .await
                    .map_err(|e| e.to_string())?;
            credential_vault::set(&account, &captured)?;
            steps.push(format!("bootstrapped {into}"));
        } else {
            steps.push(format!("{into} already set"));
        }
    }

    Ok(if steps.is_empty() {
        "nothing to provision".into()
    } else {
        steps.join("; ")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_secret_is_long_and_unique() {
        let a = generate_secret();
        let b = generate_secret();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn render_env_emits_secrets_and_port() {
        let mut secrets = BTreeMap::new();
        secrets.insert("JWT_SECRET_KEY".to_string(), "aaa".to_string());
        secrets.insert("POSTGRES_PASSWORD".to_string(), "bbb".to_string());
        let env = render_env(&secrets, 3333);
        assert!(env.contains("JWT_SECRET_KEY=aaa"));
        assert!(env.contains("POSTGRES_PASSWORD=bbb"));
        assert!(env.contains("PORT_APP=3333"));
    }

    #[test]
    fn ready_url_template_resolves_port() {
        assert_eq!(
            resolve_port_template("http://127.0.0.1:{port:app}/api/v1/health", 8080),
            "http://127.0.0.1:8080/api/v1/health"
        );
    }

    #[test]
    fn secret_account_is_namespaced() {
        assert_eq!(secret_account("ctrl-ghostfolio", "ghostfolio_token"), "mcp:ctrl-ghostfolio:ghostfolio_token");
    }
}
