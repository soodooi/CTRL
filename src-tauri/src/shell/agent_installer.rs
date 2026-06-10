// ADR-002 substrate §1 v19 (2026-06-09, H-2026-06-09-002) — 3-agent aggregator.
//
// Lazy installer for the 3 external agents (hermes / opencode / kairo).
// Each agent gets its own directory under ~/.ctrl/agents/<name>/ with a
// manifest.json recording version + install timestamp + endpoint type.
//
// First-launch onboarding triggers all 3 in parallel via npm; CLI binary
// downloads (kairo) fall back to upstream releases.
//
// Idempotent — calling install() on an already-installed agent re-reads
// the manifest and returns the existing record. Re-install is opt-in
// (caller passes force=true) so we never blow away user-modified configs.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AgentName {
    Hermes,
    Opencode,
    Kairo,
}

impl AgentName {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentName::Hermes => "hermes",
            AgentName::Opencode => "opencode",
            AgentName::Kairo => "kairo",
        }
    }

    pub fn from_str(s: &str) -> Result<Self> {
        match s {
            "hermes" => Ok(AgentName::Hermes),
            "opencode" => Ok(AgentName::Opencode),
            "kairo" => Ok(AgentName::Kairo),
            other => Err(anyhow!("unknown agent: {}", other)),
        }
    }

    /// npm package name for npm-installed agents.
    /// Returns None for agents that ship as a standalone binary.
    pub fn npm_package(&self) -> Option<&'static str> {
        match self {
            AgentName::Hermes => Some("hermes-agent"),
            AgentName::Opencode => Some("opencode-ai"),
            AgentName::Kairo => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentManifest {
    pub name: String,
    pub version: String,
    pub install_at: String,
    pub endpoint_type: String, // "mcp-stdio" | "http-port" | "webview"
    pub entry_cmd: Vec<String>,
}

pub fn agents_root() -> Result<PathBuf> {
    let base = directories::BaseDirs::new().context("could not resolve home dir")?;
    let root = base.home_dir().join(".ctrl").join("agents");
    fs::create_dir_all(&root).context("create ~/.ctrl/agents/")?;
    Ok(root)
}

pub fn agent_dir(name: &AgentName) -> Result<PathBuf> {
    let dir = agents_root()?.join(name.as_str());
    fs::create_dir_all(&dir).context("create agent dir")?;
    Ok(dir)
}

pub fn read_manifest(name: &AgentName) -> Option<AgentManifest> {
    let path = agent_dir(name).ok()?.join("manifest.json");
    let body = fs::read_to_string(path).ok()?;
    serde_json::from_str(&body).ok()
}

pub fn is_installed(name: &AgentName) -> bool {
    read_manifest(name).is_some()
}

/// Install or re-read the agent record. If already installed and force=false,
/// returns the cached manifest without network access.
pub fn install(name: AgentName, force: bool) -> Result<AgentManifest> {
    if !force {
        if let Some(existing) = read_manifest(&name) {
            return Ok(existing);
        }
    }

    let manifest = match name.npm_package() {
        Some(pkg) => install_via_npm(&name, pkg)?,
        None => install_via_binary(&name)?,
    };

    let manifest_path = agent_dir(&name)?.join("manifest.json");
    fs::write(&manifest_path, serde_json::to_string_pretty(&manifest)?)
        .context("write manifest.json")?;
    Ok(manifest)
}

fn install_via_npm(name: &AgentName, package: &str) -> Result<AgentManifest> {
    let dir = agent_dir(name)?;
    let prefix = dir.to_str().context("non-utf8 agent dir")?;

    let output = Command::new("npm")
        .args(["install", "--prefix", prefix, package])
        .output()
        .context("npm not on PATH — install Node 20.x first")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("npm install failed: {}", stderr));
    }

    let bin = dir.join("node_modules").join(".bin").join(name.as_str());
    if !bin.exists() {
        return Err(anyhow!(
            "agent binary missing after install: {}",
            bin.display()
        ));
    }

    let endpoint_type = match name {
        AgentName::Hermes => "mcp-stdio",
        AgentName::Opencode => "http-port",
        AgentName::Kairo => "webview",
    };

    let entry_cmd = match name {
        AgentName::Hermes => vec![bin.display().to_string(), "mcp".into(), "serve".into()],
        AgentName::Opencode => vec![bin.display().to_string(), "serve".into()],
        AgentName::Kairo => vec![bin.display().to_string()],
    };

    Ok(AgentManifest {
        name: name.as_str().to_string(),
        version: "latest".into(), // refined when launcher first probes --version
        install_at: chrono::Utc::now().to_rfc3339(),
        endpoint_type: endpoint_type.to_string(),
        entry_cmd,
    })
}

fn install_via_binary(_name: &AgentName) -> Result<AgentManifest> {
    // kairo + future binary agents — PWA onboarding will surface a download
    // URL + manual-install instructions until we wire automated binary
    // fetching. Keeping this as a stub avoids fabricating a download path
    // that doesn't exist yet (verification-before-completion rule).
    Err(anyhow!(
        "binary install path not yet wired — see ~/.ctrl/agents/<name>/README for manual install"
    ))
}
