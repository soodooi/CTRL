// Provision runner — executes a feature pack's `provision` axis at install
// time (ADR-002 substrate § composition v21 §7.2). For each declared tool:
// run its `check`; if absent, install via the built-in downloader
// (standalone binaries) or, on a registry miss, the system package manager
// (language packages — npm / pip — and anything else). Then resolve the
// `env` map, pulling {{secret:<key>}} values from the keychain at inject
// time so the LLM never sees them (decision 0004).
//
// Wired into the .mcpb install path next; the module-level allow keeps the
// in-progress base clean.
#![allow(dead_code)]

use anyhow::{anyhow, Context, Result};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;

use super::keychain::KeychainStore;
use super::tool_installer;

/// Outcome of provisioning one feature pack.
#[derive(Debug, Default)]
pub struct ProvisionResult {
    /// Absolute paths to tool binaries the built-in downloader installed —
    /// prepended to the pack's PATH at run time.
    pub tool_bins: Vec<PathBuf>,
    /// Resolved env for the pack's actions, secrets already substituted.
    /// Contains plaintext secret values — kernel-side only, never returned
    /// to the PWA or fed to the LLM (decision 0004).
    pub env: BTreeMap<String, String>,
}

/// Keychain account for a feature-pack secret, namespaced by mcp id so two
/// packs with the same field key never collide. The configure flow MUST
/// write secrets under this same account (single SSOT for the naming rule).
pub fn secret_account(mcp_id: &str, field_key: &str) -> String {
    format!("mcp:{mcp_id}:{field_key}")
}

/// Run the `provision` axis of `manifest` for feature pack `mcp_id`.
/// No-op (empty result) when the manifest declares no provision block.
pub fn run_provision(mcp_id: &str, manifest: &serde_json::Value) -> Result<ProvisionResult> {
    let mut result = ProvisionResult::default();
    let Some(provision) = manifest.get("provision") else {
        return Ok(result);
    };

    // ── tools ────────────────────────────────────────────────────────────
    if let Some(tools) = provision.get("tools").and_then(|t| t.as_array()) {
        for tool in tools {
            let id = tool
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("provision tool missing id"))?;

            // Already present (check probe exits 0)? skip.
            if let Some(check) = tool.get("check").and_then(|v| v.as_str()) {
                if check_passes(check) {
                    continue;
                }
            }

            // Built-in downloader first (standalone binaries) …
            if tool_installer::is_in_registry(id) {
                let bin = tool_installer::ensure_tool(id)
                    .with_context(|| format!("built-in install of '{id}'"))?;
                result.tool_bins.push(bin);
                continue;
            }

            // … else fall back to the system package manager.
            install_via_pkg_mgr(tool, id)
                .with_context(|| format!("pkg-mgr install of '{id}'"))?;
        }
    }

    // ── env (secret substitution) ────────────────────────────────────────
    if let Some(env) = provision.get("env").and_then(|e| e.as_object()) {
        for (key, val) in env {
            let raw = val
                .as_str()
                .ok_or_else(|| anyhow!("provision env '{key}' must be a string"))?;
            result
                .env
                .insert(key.clone(), resolve_env_value(mcp_id, raw)?);
        }
    }

    Ok(result)
}

/// Run a `check` probe through the platform shell; true iff it exits 0.
fn check_passes(check: &str) -> bool {
    shell_command(check)
        .map(|mut c| c.output().map(|o| o.status.success()).unwrap_or(false))
        .unwrap_or(false)
}

/// Build a Command from a shell command line, via the platform shell so a
/// `check` string like "wrangler --version" runs as written.
fn shell_command(line: &str) -> Option<Command> {
    if line.trim().is_empty() {
        return None;
    }
    #[cfg(windows)]
    {
        let mut c = Command::new("cmd");
        c.args(["/C", line]);
        Some(c)
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new("sh");
        c.args(["-c", line]);
        Some(c)
    }
}

/// Install via the OS package manager using the tool's `install.<os>` (or
/// `install.any`) hint. Standalone binaries never reach here (handled by the
/// built-in downloader); this path is for npm / pip / brew / winget packages.
fn install_via_pkg_mgr(tool: &serde_json::Value, id: &str) -> Result<()> {
    let install = tool
        .get("install")
        .and_then(|v| v.as_object())
        .ok_or_else(|| anyhow!("tool '{id}' has no built-in entry and no install hints"))?;
    let os_key = current_os_key();
    let spec = install
        .get(os_key)
        .or_else(|| install.get("any"))
        .ok_or_else(|| anyhow!("tool '{id}' has no install hint for {os_key} or 'any'"))?;
    let via = spec
        .get("via")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("tool '{id}' install hint missing 'via'"))?;
    let pkg = spec
        .get("pkg")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("tool '{id}' install hint missing 'pkg'"))?;
    let global = spec.get("global").and_then(|v| v.as_bool()).unwrap_or(false);

    let mut cmd = match via {
        "npm" => {
            let mut c = Command::new("npm");
            c.arg("install");
            if global {
                c.arg("-g");
            }
            c.arg(pkg);
            c
        }
        "brew" => {
            let mut c = Command::new("brew");
            c.args(["install", pkg]);
            c
        }
        "winget" => {
            let mut c = Command::new("winget");
            c.args(["install", "-e", "--id", pkg]);
            c
        }
        "apt" => {
            let mut c = Command::new("apt-get");
            c.args(["install", "-y", pkg]);
            c
        }
        other => return Err(anyhow!("unknown install.via '{other}' for tool '{id}'")),
    };
    let out = cmd
        .output()
        .with_context(|| format!("spawn {via} for '{id}'"))?;
    if !out.status.success() {
        return Err(anyhow!(
            "{via} install of '{id}' failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

fn current_os_key() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

/// Resolve an env value: substitute a single `{{secret:<field_key>}}`
/// placeholder with the keychain secret; pass plain values through. Secrets
/// are read kernel-side here and never returned to / seen by the LLM
/// (decision 0004).
fn resolve_env_value(mcp_id: &str, raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("{{secret:") {
        if let Some(field) = rest.strip_suffix("}}") {
            let field = field.trim();
            let account = secret_account(mcp_id, field);
            let secret = KeychainStore::get(&account)
                .with_context(|| format!("read secret for '{field}'"))?
                .ok_or_else(|| {
                    anyhow!("secret '{field}' not set in keychain (account {account})")
                })?;
            return Ok(secret);
        }
    }
    Ok(raw.to_string())
}
