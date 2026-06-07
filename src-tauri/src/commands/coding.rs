// commands/coding — coding.primary native Pi TUI spawn.
//
// ADR-002 substrate § provider v11 §3.11 (2026-06-07): the Coding L1
// workspace runs Pi in its OWN process (separate from the kernel-managed
// Irisy Pi daemon), in native TUI mode, with the user's coding.primary
// provider+model. This file packages the small piece of plumbing the PWA
// cannot do safely from the renderer:
//
//   1. Read coding.primary from the provider registry SSOT.
//   2. Resolve the provider's API key from credential_vault (server-side
//      only — never crosses the Tauri IPC boundary).
//   3. Return a SpawnSpec the PWA hands directly to `cs_spawn`:
//        - command  = absolute path to the bundled `pi` binary
//        - args     = ["--provider", <provider_id>, "--model", <model_id>]
//        - env      = { CTRL_PI_API_KEY_<UPPER_ID>: <real key> }
//        - model_id = manifest's first declared model
//
// PWA then invokes `cs_spawn(command, args, env)` exactly like any other
// shell — we reuse the existing portable-pty + StssBridge plumbing for
// xterm streaming, no new wire. When the user closes the chip, the PWA
// calls `cs_kill(stream_id)` and the Pi child exits.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

use crate::kernel::provider::registry::ProviderManagedBy;
use crate::kernel::provider::Consumer;
use crate::shell::credential_vault;
use crate::shell::KernelHandle;

#[derive(Debug, Serialize)]
pub struct CodingSpawnSpec {
    /// Absolute path to the Pi binary (`~/.ctrl/pi/node_modules/.bin/pi`
    /// in production, the locally installed `pi` in dev).
    pub command: String,
    /// CLI args for `pi`: `--provider <id> [--model <model>]`.
    pub args: Vec<String>,
    /// Env vars to merge into the child: `CTRL_PI_API_KEY_<UPPER_ID>`.
    /// PWA must not log this map.
    pub env: HashMap<String, String>,
    /// Resolved provider id (echo for UI).
    pub provider_id: String,
    /// Resolved model id (echo for UI; may be `None` for providers with
    /// no manifest-declared default).
    pub model_id: Option<String>,
    /// Human label for the active provider (Settings UI display).
    pub provider_label: String,
}

#[derive(Debug, Deserialize)]
pub struct CodingResolveArgs {
    /// Override the coding.primary binding for one spawn — used when the
    /// user clicks a per-mcp "use X provider" shortcut. Defaults to
    /// SSOT coding.primary.
    #[serde(default)]
    pub provider_id_override: Option<String>,
}

#[tauri::command]
pub fn coding_resolve_spawn(
    kernel: State<'_, KernelHandle>,
    args: CodingResolveArgs,
) -> Result<CodingSpawnSpec, String> {
    let registry = &kernel.runtime.provider_registry;

    let provider_id = match args.provider_id_override {
        Some(id) if !id.is_empty() => id,
        _ => registry
            .active_state()
            .get(&Consumer::CodingPrimary.id())
            .cloned()
            .ok_or_else(|| {
                "coding.primary is not configured — open Settings → Providers and \
                 bind a provider (recommended: Claude / Codex / Gemini) to the \
                 'Coding primary' row."
                    .to_string()
            })?,
    };

    let manifest = registry
        .manifest_for(&provider_id)
        .ok_or_else(|| format!("provider {provider_id} not in registry"))?;
    let snap = registry
        .snapshot(&provider_id)
        .ok_or_else(|| format!("provider {provider_id} not registered"))?;

    let api_key = match &manifest.auth {
        crate::kernel::provider::manifest::AuthSource::Keychain { account } => {
            credential_vault::get(account.as_str())
                .map_err(|e| format!("vault read for {account}: {e}"))?
                .ok_or_else(|| {
                    format!(
                        "no vault entry for {account} — add the key in Settings → Providers"
                    )
                })?
        }
        crate::kernel::provider::manifest::AuthSource::Env { var } => std::env::var(var)
            .map_err(|_| format!("env var {var} not set for provider {provider_id}"))?,
        crate::kernel::provider::manifest::AuthSource::ConfigKey { field } => manifest
            .config
            .get(field)
            .cloned()
            .ok_or_else(|| format!("config key {field} missing for provider {provider_id}"))?,
        crate::kernel::provider::manifest::AuthSource::None => String::new(),
    };

    let model_id = registry.first_model_for(&provider_id);
    let label = match snap.managed_by {
        ProviderManagedBy::Ctrl => "CTRL Cloud".to_string(),
        ProviderManagedBy::User => snap.label.clone(),
    };

    let env_var_name = format!(
        "CTRL_PI_API_KEY_{}",
        provider_id
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' })
            .collect::<String>()
    );

    let mut env: HashMap<String, String> = HashMap::new();
    if !api_key.is_empty() {
        env.insert(env_var_name, api_key);
    }

    let pi_bin = pi_binary_path();
    let mut cli_args = vec!["--provider".to_string(), provider_id.clone()];
    if let Some(m) = model_id.as_ref() {
        cli_args.push("--model".to_string());
        cli_args.push(m.clone());
    }

    Ok(CodingSpawnSpec {
        command: pi_bin,
        args: cli_args,
        env,
        provider_id,
        model_id,
        provider_label: label,
    })
}

/// Mirrors `shell::brain_supervisor::pi_binary_path` resolution but kept
/// inline here to avoid pulling the supervisor's whole module into the
/// commands surface. Production: `~/.ctrl/pi/node_modules/.bin/pi`.
/// Dev: `pi` (assumes user has Pi on PATH).
fn pi_binary_path() -> String {
    if let Some(home) = std::env::var_os("HOME") {
        let bundled = std::path::PathBuf::from(home)
            .join(".ctrl")
            .join("pi")
            .join("node_modules")
            .join(".bin")
            .join("pi");
        if bundled.exists() {
            return bundled.to_string_lossy().into_owned();
        }
    }
    "pi".to_string()
}
