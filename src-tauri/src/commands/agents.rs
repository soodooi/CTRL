// ADR-002 substrate §1 v19 (2026-06-09, H-2026-06-09-002) — 3-agent aggregator.
//
// Tauri commands surfacing agent_installer + agent_launcher to the PWA.
// PWA flow:
//   onboarding → install_agent(name) for hermes / opencode in parallel
//   route mount → launch_agent(name) returns endpoint descriptor
//   route unmount → stop_agent(name)
//
// No supervise — PWA owns retry on errors. Agents installed once, launched
// per-PWA-session, stopped when the PWA route unmounts.

use crate::shell::agent_installer::{install, is_installed, read_manifest, AgentName};
use crate::shell::agent_launcher::AgentEndpoint;
use crate::shell::KernelHandle;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct InstallResult {
    pub name: String,
    pub version: String,
    pub install_at: String,
    pub already_installed: bool,
}

#[tauri::command]
pub async fn install_agent(name: String, force: Option<bool>) -> Result<InstallResult, String> {
    let agent = AgentName::from_str(&name).map_err(|e| e.to_string())?;
    let already = is_installed(&agent) && !force.unwrap_or(false);
    let manifest = install(agent, force.unwrap_or(false)).map_err(|e| e.to_string())?;
    Ok(InstallResult {
        name: manifest.name,
        version: manifest.version,
        install_at: manifest.install_at,
        already_installed: already,
    })
}

#[tauri::command]
pub async fn launch_agent(
    name: String,
    kernel: State<'_, KernelHandle>,
) -> Result<AgentEndpoint, String> {
    let agent = AgentName::from_str(&name).map_err(|e| e.to_string())?;
    // Unified provider injection (ADR-002 §1.3): feed the active CTRL
    // provider into the agent so opencode/hermes use the same BYOK config
    // the user picked — configure once, every face uses it.
    let provider_env = kernel.runtime.provider_registry.agent_env_injection();
    // The child handle is dropped here; on Unix the child inherits SIGHUP
    // and is reaped when the parent exits. For long-lived launches we'll
    // hold the handle in a process registry, but for the initial wire we
    // surface the endpoint and let the PWA own the lifecycle.
    let launched = crate::shell::agent_launcher::launch_with_env(&agent, &provider_env)
        .map_err(|e| e.to_string())?;
    Ok(launched.endpoint)
}

#[tauri::command]
pub async fn stop_agent(name: String) -> Result<(), String> {
    let _agent = AgentName::from_str(&name).map_err(|e| e.to_string())?;
    // Process registry to stop a specific launch is TODO — PWA can kill the
    // window which cascades SIGHUP to the agent subprocess. Returning Ok
    // here keeps the command surface stable until the registry lands.
    Ok(())
}

#[tauri::command]
pub async fn agent_status(name: String) -> Result<bool, String> {
    let agent = AgentName::from_str(&name).map_err(|e| e.to_string())?;
    Ok(is_installed(&agent))
}

#[derive(Debug, Serialize)]
pub struct ConnectedAgentMcp {
    pub server_id: String,
    pub tools: Vec<String>,
}

/// Connect an mcp-stdio agent (hermes) to the kernel MCP bus per
/// ADR-002 substrate §1 v19 (2026-06-09) §1.3 — the MCP bus is one of
/// the four things the kernel owns. mcp_host spawns and owns the stdio
/// child; the PWA then chats via the existing `mcp_call` command.
/// Idempotent: re-registering the same descriptor and re-connecting an
/// already-connected server are both no-ops at the mcp_host layer.
#[tauri::command]
pub async fn connect_agent_mcp(
    name: String,
    kernel: State<'_, KernelHandle>,
) -> Result<ConnectedAgentMcp, String> {
    use crate::kernel::mcp_host::{McpServerDescriptor, McpServerSource};

    let agent = AgentName::from_str(&name).map_err(|e| e.to_string())?;
    let manifest = read_manifest(&agent)
        .ok_or_else(|| format!("agent {} not installed — call install_agent first", name))?;
    if manifest.endpoint_type != "mcp-stdio" {
        return Err(format!(
            "agent {} endpoint_type is {} — only mcp-stdio agents connect to the MCP bus",
            name, manifest.endpoint_type
        ));
    }

    let mut iter = manifest.entry_cmd.iter();
    let command = iter
        .next()
        .cloned()
        .ok_or_else(|| format!("agent {} manifest entry_cmd is empty", name))?;
    let args: Vec<String> = iter.cloned().collect();

    let server_id = format!("agent-{}", agent.as_str());
    let host = kernel.runtime.mcp_host.clone();
    host.register(McpServerDescriptor {
        id: server_id.clone(),
        name: agent.as_str().to_string(),
        version: manifest.version.clone(),
        description: format!("{} agent (3-agent aggregator)", agent.as_str()),
        tools: Vec::new(),
        source: McpServerSource::Local { command, args },
    })
    .await;
    host.connect(&server_id).await.map_err(|e| e.to_string())?;
    let tools = host
        .list_tools(&server_id)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|t| t.name.to_string())
        .collect();

    Ok(ConnectedAgentMcp { server_id, tools })
}

/// Mirror the active CTRL provider into hermes's own config file
/// (`~/.hermes/.env`). hermes does NOT read injected process env (verified
/// 2026-06-11 — it reports "No inference provider configured" and points to
/// ~/.hermes/.env), so CTRL's unified provider injection (ADR-002 §1.3) is
/// written there instead. Only the key + base_url vars are mirrored;
/// existing user lines are preserved (merge, not clobber). No active HTTP
/// provider -> leave the file untouched so the user's own hermes setup
/// survives.
pub(crate) fn write_hermes_dotenv(
    env: &std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    // TAVILY_API_KEY lights up hermes's built-in web_search / web_extract for
    // Irisy. hermes reads it from ~/.hermes/.env (not process env, see the
    // doc above), so it MUST ride this managed-merge or it never reaches the
    // agent — process-env injection alone is silently dropped.
    const MANAGED: [&str; 5] = [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "TAVILY_API_KEY",
    ];
    if MANAGED.iter().all(|k| !env.contains_key(*k)) {
        return Ok(());
    }
    let base =
        directories::BaseDirs::new().ok_or_else(|| "could not resolve home dir".to_string())?;
    let dir = base.home_dir().join(".hermes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create ~/.hermes: {e}"))?;
    let path = dir.join(".env");

    // Keep every existing line whose key we do NOT manage, then append ours.
    let mut lines: Vec<String> = Vec::new();
    if let Ok(existing) = std::fs::read_to_string(&path) {
        for line in existing.lines() {
            let is_managed = line
                .split_once('=')
                .map(|(k, _)| MANAGED.contains(&k.trim()))
                .unwrap_or(false);
            if !is_managed {
                lines.push(line.to_string());
            }
        }
    }
    for k in MANAGED {
        if let Some(v) = env.get(k) {
            lines.push(format!("{k}={v}"));
        }
    }
    std::fs::write(&path, format!("{}\n", lines.join("\n")))
        .map_err(|e| format!("write ~/.hermes/.env: {e}"))?;
    Ok(())
}

/// Project the active CTRL provider into `~/.hermes/config.yaml` so
/// Hermes (Irisy's brain) serves chat with the user's chosen model
/// instead of the stale default. Decision 0007 §hermes-sync, 2026-06-19.
///
/// Hermes reads its model + provider config from config.yaml, NOT from
/// the `.env` written by `write_hermes_dotenv` (that file only carries
/// keys for hermes builds that read process env). Without this
/// projection Irisy kept answering "I'm using doubao" even after the
/// user switched to GLM in Settings — two sources of truth drifted.
///
/// What we touch (everything else preserved verbatim):
///   model.default   = <active first model>
///   model.provider  = "ctrl"             (hermes-internal key)
///   providers.ctrl.base_url / api_key / model
///
/// `active_manifest` carries the CTRL-side provider; `api_key` is the
/// already-resolved credential (keychain / config / env). Empty key =
/// bail (don't clobber an existing working setup with an unauth-able
/// one — let hermes fall through to its own config).
pub(crate) fn write_hermes_config_yaml(
    active_manifest: &crate::kernel::provider::manifest::ProviderManifest,
    api_key: &str,
) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Ok(());
    }
    let Some(endpoint) = active_manifest.endpoint.as_deref() else {
        return Ok(());
    };
    let model = active_manifest
        .models
        .first()
        .cloned()
        .unwrap_or_default();
    if model.is_empty() {
        return Ok(());
    }
    let base =
        directories::BaseDirs::new().ok_or_else(|| "could not resolve home dir".to_string())?;
    let dir = base.home_dir().join(".hermes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create ~/.hermes: {e}"))?;
    let path = dir.join("config.yaml");

    // Load existing config (if any) as a free-form Value so we preserve
    // every field hermes owns (skills / plugins / agent / toolsets / etc).
    // First boot / missing file → start from an empty map.
    let mut doc: serde_yaml::Value = if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_yaml::from_str(&text).unwrap_or_else(|e| {
                tracing::warn!(
                    error = %e,
                    "hermes config.yaml parse failed; rewriting from scratch"
                );
                serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
            }),
            Err(_) => serde_yaml::Value::Mapping(serde_yaml::Mapping::new()),
        }
    } else {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    };

    // Walk to doc.model.{default,provider} and doc.providers.ctrl.{...},
    // creating intermediate maps as needed. serde_yaml::Value uses
    // string keys so we don't depend on a typed Hermes schema.
    set_mapping_path(&mut doc, &["model", "default"], serde_yaml::Value::String(model.clone()));
    set_mapping_path(&mut doc, &["model", "provider"], serde_yaml::Value::String("ctrl".into()));
    set_mapping_path(
        &mut doc,
        &["providers", "ctrl", "base_url"],
        serde_yaml::Value::String(endpoint.trim_end_matches('/').to_string()),
    );
    set_mapping_path(
        &mut doc,
        &["providers", "ctrl", "api_key"],
        serde_yaml::Value::String(api_key.to_string()),
    );
    set_mapping_path(
        &mut doc,
        &["providers", "ctrl", "model"],
        serde_yaml::Value::String(model),
    );

    let serialized = serde_yaml::to_string(&doc)
        .map_err(|e| format!("serialize ~/.hermes/config.yaml: {e}"))?;
    let tmp = path.with_extension("yaml.tmp");
    std::fs::write(&tmp, serialized).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;
    tracing::info!(
        endpoint = endpoint,
        model = active_manifest.models.first().unwrap_or(&String::new()),
        "hermes config.yaml projected from CTRL active provider"
    );
    Ok(())
}

/// Walk a serde_yaml::Value as nested mappings, creating intermediate
/// maps when missing, then set `path[..last] -> last` to `value`.
fn set_mapping_path(doc: &mut serde_yaml::Value, path: &[&str], value: serde_yaml::Value) {
    if path.is_empty() {
        return;
    }
    let mut current = doc;
    for key in path.iter().take(path.len() - 1) {
        let key_v = serde_yaml::Value::String((*key).to_string());
        if current.get(&key_v).is_none() {
            if let serde_yaml::Value::Mapping(map) = current {
                map.insert(key_v.clone(), serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));
            } else {
                *current = serde_yaml::Value::Mapping(serde_yaml::Mapping::new());
            }
        }
        current = current
            .get_mut(&key_v)
            .expect("just-inserted mapping must exist");
    }
    if let serde_yaml::Value::Mapping(map) = current {
        map.insert(
            serde_yaml::Value::String(path[path.len() - 1].to_string()),
            value,
        );
    }
}

/// Belt for Irisy's web tools (ADR-002 substrate §1 v36 — Irisy web search).
///
/// hermes auto-selects the Tavily backend when `TAVILY_API_KEY` is present, so
/// on 0.16.0 the key alone (written to `~/.hermes/.env`) is enough. But the
/// web backend is also configurable via `web.{backend,search_backend,
/// extract_backend}` in config.yaml, and some hermes builds (issue #29617)
/// treat an empty/unset value as "disabled" and silently drop web_search /
/// web_extract. Pin all three to `tavily` so Irisy's web reach survives
/// version drift — defence in depth on top of the key.
///
/// Only written when a Tavily credential exists; with no key we leave
/// config.yaml untouched (don't pin a backend the user can't authenticate).
/// Every other field hermes owns is preserved verbatim (free-form merge).
pub(crate) fn write_hermes_web_belt() -> Result<(), String> {
    let has_key = crate::kernel::provider::registry::read_credential("tavily")
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);
    if !has_key {
        return Ok(());
    }
    let base =
        directories::BaseDirs::new().ok_or_else(|| "could not resolve home dir".to_string())?;
    let dir = base.home_dir().join(".hermes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create ~/.hermes: {e}"))?;
    let path = dir.join("config.yaml");

    let mut doc: serde_yaml::Value = if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_yaml::from_str(&text).unwrap_or_else(|e| {
                tracing::warn!(
                    error = %e,
                    "hermes config.yaml parse failed; rewriting from scratch"
                );
                serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
            }),
            Err(_) => serde_yaml::Value::Mapping(serde_yaml::Mapping::new()),
        }
    } else {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    };

    for leaf in ["backend", "search_backend", "extract_backend"] {
        set_mapping_path(
            &mut doc,
            &["web", leaf],
            serde_yaml::Value::String("tavily".into()),
        );
    }

    let serialized = serde_yaml::to_string(&doc)
        .map_err(|e| format!("serialize ~/.hermes/config.yaml: {e}"))?;
    let tmp = path.with_extension("yaml.web.tmp");
    std::fs::write(&tmp, serialized).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;
    tracing::info!("hermes config.yaml web backend pinned to tavily (Irisy web belt)");
    Ok(())
}

/// Core hermes one-shot — `uvx --from hermes-agent==<pin> hermes -z "<prompt>"`
/// prints only the final answer to stdout (verified upstream oneshot.py,
/// 2026-06-10). Shared by the `assistant_oneshot` command and the
/// irisy_chat hermes-first branch (ADR-002 substrate §1.1 v20). hermes keeps
/// its own persistent memory + skills, so callers pass a single prompt
/// (typically the latest user turn) rather than the whole history.
pub async fn run_hermes_oneshot(
    prompt: &str,
    registry: &crate::kernel::provider::registry::ProviderRegistry,
) -> Result<String, String> {
    use crate::shell::agent_installer::{ensure_uvx, HERMES_ONESHOT_SPEC};

    let agent = AgentName::Hermes;
    if !is_installed(&agent) {
        return Err("hermes not installed — call install_agent first".to_string());
    }
    let uvx = ensure_uvx().map_err(|e| e.to_string())?;
    // Unified provider injection (ADR-002 §1.3) — hermes uses the same BYOK
    // provider the user picked in CTRL. hermes reads it from ~/.hermes/.env
    // (not process env), so mirror it there; the process env below stays as
    // a fallback for hermes builds that do read it.
    let provider_env = registry.agent_env_injection();
    write_hermes_dotenv(&provider_env)?;
    // Pin the web backend so Irisy's search/extract survive hermes version
    // drift (issue #29617). Best-effort: a config-write hiccup must never
    // sink the chat turn — the key in .env already enables web on 0.16.0.
    if let Err(e) = write_hermes_web_belt() {
        tracing::warn!(error = %e, "hermes web belt write failed; web search may be version-fragile");
    }

    let mut cmd = tokio::process::Command::new(uvx);
    cmd.args(["--from", HERMES_ONESHOT_SPEC, "hermes", "-z", prompt]);
    for (k, v) in &provider_env {
        cmd.env(k, v);
    }
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(180),
        cmd.output(),
    )
    .await
    .map_err(|_| "hermes one-shot timed out after 180 s".to_string())?
    .map_err(|e| format!("hermes spawn failed: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "hermes exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// One-shot hermes answer surfaced to the PWA (bridge until the ACP
/// streaming client lands, ADR-002 substrate §1.1 v20).
#[tauri::command]
pub async fn assistant_oneshot(
    prompt: String,
    kernel: State<'_, KernelHandle>,
) -> Result<String, String> {
    run_hermes_oneshot(&prompt, &kernel.runtime.provider_registry).await
}

#[tauri::command]
pub async fn list_agents() -> Result<Vec<String>, String> {
    // opencode retired (bao 2026-06-25) — unwired; only hermes is installable.
    Ok(["hermes"]
        .iter()
        .filter(|n| {
            AgentName::from_str(n)
                .map(|a| is_installed(&a))
                .unwrap_or(false)
        })
        .map(|s| s.to_string())
        .collect())
}
