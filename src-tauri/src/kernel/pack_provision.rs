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

/// Probe whether `<prog> <args...>` runs successfully (exit 0), silently.
async fn probe(prog: &str, args: &[&str]) -> bool {
    tokio::process::Command::new(prog)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Detect a REAL container-compose command PREFIX (program + any subcommand),
/// probing in order: `docker compose` (the v2 plugin), the standalone
/// `docker-compose` binary (Homebrew installs THIS, not the plugin), then
/// `podman compose`. Returns e.g. `["docker", "compose"]` or `["docker-compose"]`,
/// or `None` when no runtime is present. Probing `docker version` alone is NOT
/// enough — the compose plugin can be absent even when the docker CLI is present,
/// which fails `docker compose -f …` with "unknown shorthand flag: 'f'"
/// (real-machine finding 2026-07-05).
pub async fn detect_compose() -> Option<Vec<String>> {
    if probe("docker", &["compose", "version"]).await {
        return Some(vec!["docker".into(), "compose".into()]);
    }
    if probe("docker-compose", &["version"]).await {
        return Some(vec!["docker-compose".into()]);
    }
    if probe("podman", &["compose", "version"]).await {
        return Some(vec!["podman".into(), "compose".into()]);
    }
    None
}

async fn compose_command() -> Result<Vec<String>, String> {
    detect_compose()
        .await
        .ok_or_else(|| "no container compose found — install Docker (with the compose plugin) \
             or docker-compose / podman to run this pack".to_string())
}

/// Error-message sentinel prefixing the JSON guidance payload returned when a
/// pack needs `provision.service` but no container runtime is installed. The
/// frontend strips this prefix, parses the JSON, and renders a friendly
/// guided-install card instead of the raw error (bao 2026-07-05 "no-docker
/// guided install"). Design: feature-pack-provision-auth-engine.md line 34
/// (no runtime -> guide the install), line 77 (heavy auto-install orchestration
/// deferred — we GUIDE, not silently `brew install` a VM-class runtime).
pub const NEEDS_CONTAINER_RUNTIME: &str = "NEEDS_CONTAINER_RUNTIME";

/// Platform-specific, copy-pasteable guidance for installing a container runtime.
/// Returned (behind the sentinel) when provisioning needs Docker/Podman but none
/// is present. A guide, not an auto-installer: a container runtime is a VM-class
/// dependency (multi-package + a `start`), too heavy to `brew install` silently
/// without consent — so CTRL hands the user the exact steps + commands to run.
pub fn container_runtime_guidance() -> Value {
    // macOS primary (bao's machine): Colima = the lightweight runtime we
    // verified end-to-end (a Docker Desktop alternative, no license).
    #[cfg(target_os = "macos")]
    let (platform, steps, commands, docs_url) = (
        "macos",
        vec![
            "Install Homebrew if you don't have it (https://brew.sh).",
            "Install a container runtime + the compose CLI.",
            "Start the runtime — it stays up in the background.",
            "Come back and press Set up again.",
        ],
        vec!["brew install colima docker docker-compose", "colima start"],
        "https://github.com/abiosoft/colima#installation",
    );
    #[cfg(target_os = "linux")]
    let (platform, steps, commands, docs_url) = (
        "linux",
        vec![
            "Install Docker (with the compose plugin) via your package manager.",
            "Make sure your user can reach the Docker daemon (add yourself to the docker group, then re-login), or use rootless Podman.",
            "Come back and press Set up again.",
        ],
        vec![
            "sudo apt-get install -y docker.io docker-compose-v2",
            "sudo usermod -aG docker \"$USER\"",
        ],
        "https://docs.docker.com/engine/install/",
    );
    #[cfg(target_os = "windows")]
    let (platform, steps, commands, docs_url) = (
        "windows",
        vec![
            "Install Docker Desktop (it bundles the compose plugin + a WSL2 backend).",
            "Launch Docker Desktop once so the engine starts.",
            "Come back and press Set up again.",
        ],
        vec!["winget install Docker.DockerDesktop"],
        "https://www.docker.com/products/docker-desktop/",
    );

    serde_json::json!({
        "kind": "needs_container_runtime",
        "platform": platform,
        "headline": "This pack runs a self-hosted service, which needs a container runtime (Docker or Podman). None was found on this machine.",
        "steps": steps,
        "commands": commands,
        "docs_url": docs_url,
    })
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

    let compose_cmd = compose_command().await?;
    let status = tokio::process::Command::new(&compose_cmd[0])
        .args(&compose_cmd[1..])
        .arg("-f")
        .arg(&compose_path)
        .arg("--env-file")
        .arg(&env_path)
        .arg("up")
        .arg("-d")
        .status()
        .await
        .map_err(|e| format!("compose up failed to start: {e}"))?;
    if !status.success() {
        return Err("compose up exited with a non-zero status".into());
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

    // No-docker guided install: if this pack brings up a container service but
    // no runtime is installed, fail EARLY with structured guidance the frontend
    // renders as a friendly card — not a deep raw compose error.
    if manifest.pointer("/provision/service").is_some() && detect_compose().await.is_none() {
        return Err(format!("{NEEDS_CONTAINER_RUNTIME} {}", container_runtime_guidance()));
    }

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

    // Post-auth CONTEXT capture: a write often needs a connector-side id the
    // bootstrap doesn't return (e.g. ghostfolio's default account id, required
    // to record a trade). Declare `auth.capture_context` = token-exchange for a
    // bearer, GET an endpoint, pull a value by JSON pointer, store it kernel-side
    // as a secret the produce body references via `from_secret`. Idempotent.
    if let Some(ctx) = manifest.pointer("/auth/capture_context") {
        let into = ctx
            .pointer("/into_secret")
            .and_then(Value::as_str)
            .ok_or("auth.capture_context.into_secret missing")?;
        let account = secret_account(pack_id, into);
        let have = credential_vault::get(&account)?.is_some_and(|v| !v.trim().is_empty());
        if !have {
            let te = manifest
                .pointer("/auth/token_exchange")
                .ok_or("auth.capture_context needs auth.token_exchange for a bearer")?;
            let te_path = te.get("path").and_then(Value::as_str).unwrap_or_default();
            let send_field = te.get("as_body_field").and_then(Value::as_str).unwrap_or("accessToken");
            let capture_bearer = te.get("capture_bearer").and_then(Value::as_str).unwrap_or("/authToken");
            let send_secret = te.get("send_secret").and_then(Value::as_str).unwrap_or_default();
            let security_token =
                credential_vault::get(&secret_account(pack_id, send_secret))?.unwrap_or_default();
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .map_err(|e| e.to_string())?;
            let bearer = crate::kernel::pack_auth::mint_bearer(
                &client, &base_url, te_path, send_field, &security_token, capture_bearer,
            )
            .await
            .map_err(|e| e.to_string())?;
            let path = ctx.get("path").and_then(Value::as_str).unwrap_or_default();
            let pointer = ctx.get("pointer").and_then(Value::as_str).unwrap_or_default();
            let method = ctx.get("method").and_then(Value::as_str).unwrap_or("GET");
            let url = format!("{}{}", base_url.trim_end_matches('/'), path);
            // Honor the declared method (manifest=data): most context reads are
            // GET, but a connector may POST to fetch its context.
            let req = if method.eq_ignore_ascii_case("POST") {
                client.post(&url)
            } else {
                client.get(&url)
            };
            let resp = req
                .bearer_auth(&bearer)
                .send()
                .await
                .map_err(|e| format!("capture_context {method} failed: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!("capture_context GET {path} -> {}", resp.status()));
            }
            let json: Value = resp
                .json()
                .await
                .map_err(|e| format!("capture_context parse: {e}"))?;
            let val = json
                .pointer(pointer)
                .and_then(Value::as_str)
                .ok_or_else(|| format!("capture_context pointer {pointer} not found in response"))?;
            credential_vault::set(&account, val)?;
            steps.push(format!("captured {into}"));
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

    #[test]
    fn runtime_guidance_is_actionable_for_this_platform() {
        let g = container_runtime_guidance();
        assert_eq!(g["kind"], "needs_container_runtime");
        // Non-empty ordered steps + at least one copy-pasteable command.
        assert!(g["steps"].as_array().is_some_and(|a| !a.is_empty()));
        let cmds = g["commands"].as_array().expect("commands array");
        assert!(!cmds.is_empty());
        assert!(cmds.iter().all(|c| c.as_str().is_some_and(|s| !s.trim().is_empty())));
        // A docs link the card can point at.
        assert!(g["docs_url"].as_str().is_some_and(|u| u.starts_with("https://")));
    }

    #[test]
    fn guidance_error_is_sentinel_prefixed_parseable_json() {
        // The frontend splits on the sentinel and JSON.parse's the remainder.
        let msg = format!("{NEEDS_CONTAINER_RUNTIME} {}", container_runtime_guidance());
        let rest = msg
            .strip_prefix(NEEDS_CONTAINER_RUNTIME)
            .expect("sentinel prefix")
            .trim();
        let parsed: Value = serde_json::from_str(rest).expect("guidance JSON parses");
        assert_eq!(parsed["kind"], "needs_container_runtime");
    }
}
