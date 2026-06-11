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
            // Verified 2026-06-10: npm "hermes-agent" is an UNOFFICIAL
            // third-party pip shim (not NousResearch) — hermes installs
            // via uv instead (install_via_uvx below).
            AgentName::Hermes => None,
            AgentName::Opencode => Some("opencode-ai"),
            AgentName::Kairo => None,
        }
    }
}

/// Pinned upstream distributions, verified against real sources 2026-06-10
/// (ADR-002 substrate §1.1 v20):
/// - hermes = NousResearch/hermes-agent (PyPI, MIT). Embedding path is the
///   ACP stdio server (`hermes-acp`), NOT an MCP `chat` tool.
/// - kairo codename resolves to SilverBullet (silverbulletmd, MIT) — single
///   Go binary serving a web UI over a plain markdown folder.
pub const HERMES_ACP_SPEC: &str = "hermes-agent[acp]==0.16.0";
pub const HERMES_ONESHOT_SPEC: &str = "hermes-agent==0.16.0";
const SILVERBULLET_VERSION: &str = "2.8.1";

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

    let manifest = match (&name, name.npm_package()) {
        (_, Some(pkg)) => install_via_npm(&name, pkg)?,
        (AgentName::Hermes, None) => install_via_uvx(&name)?,
        (_, None) => install_via_binary(&name)?,
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
        AgentName::Hermes => "acp-stdio",
        AgentName::Opencode => "http-port",
        AgentName::Kairo => "webview",
    };

    let entry_cmd = match name {
        AgentName::Hermes => vec![bin.display().to_string(), "acp".into()],
        // Real flags verified against opencode 1.17 docs: `opencode serve
        // [--port N] [--hostname H]`; the launcher appends a picked free
        // port + 127.0.0.1 and parses the announce line from stdout.
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

/// hermes — ACP stdio server via uvx (NousResearch/hermes-agent, MIT).
/// uvx resolves + caches the pinned PyPI spec on first launch; "install"
/// here means probing that uv exists and recording the manifest. State
/// lives in ~/.hermes (not ~/.ctrl/agents/hermes) per upstream layout.
fn install_via_uvx(name: &AgentName) -> Result<AgentManifest> {
    let uvx = crate::kernel::provider::path_resolver::resolve_binary_path("uvx")
        .ok_or_else(|| {
            anyhow!(
                "uv not found on PATH — install it first (https://docs.astral.sh/uv/): \
                 `curl -LsSf https://astral.sh/uv/install.sh | sh`"
            )
        })?;
    // Touch the agent dir so is_installed()'s manifest probe has a home.
    let _ = agent_dir(name)?;
    Ok(AgentManifest {
        name: name.as_str().to_string(),
        version: "0.16.0".into(),
        install_at: chrono::Utc::now().to_rfc3339(),
        endpoint_type: "acp-stdio".to_string(),
        entry_cmd: vec![
            uvx.display().to_string(),
            "--from".into(),
            HERMES_ACP_SPEC.into(),
            "hermes-acp".into(),
        ],
    })
}

/// kairo (SilverBullet) — single-binary download from GitHub releases,
/// unzipped into ~/.ctrl/agents/kairo/bin/. Verified 2026-06-10: release
/// assets are silverbullet-server-<os>-<arch>.zip containing one
/// `silverbullet` executable (~36 MB, hence lazy download not bundle).
fn install_via_binary(name: &AgentName) -> Result<AgentManifest> {
    let dir = agent_dir(name)?;
    let bin_dir = dir.join("bin");
    fs::create_dir_all(&bin_dir).context("create agent bin dir")?;
    let bin = bin_dir.join("silverbullet");

    if !bin.exists() {
        let (os, arch) = match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => ("darwin", "aarch64"),
            ("macos", _) => ("darwin", "x86_64"),
            ("windows", _) => ("windows", "x86_64"),
            (_, "aarch64") => ("linux", "aarch64"),
            _ => ("linux", "x86_64"),
        };
        let url = format!(
            "https://github.com/silverbulletmd/silverbullet/releases/download/{v}/silverbullet-server-{os}-{arch}.zip",
            v = SILVERBULLET_VERSION
        );
        let zip_path = bin_dir.join("silverbullet.zip");
        let dl = Command::new("curl")
            .args(["-fsSL", "-o"])
            .arg(&zip_path)
            .arg(&url)
            .output()
            .context("curl not available for binary download")?;
        if !dl.status.success() {
            return Err(anyhow!(
                "silverbullet download failed: {}",
                String::from_utf8_lossy(&dl.stderr)
            ));
        }
        let unzip = Command::new("unzip")
            .arg("-o")
            .arg(&zip_path)
            .arg("-d")
            .arg(&bin_dir)
            .output()
            .context("unzip not available")?;
        if !unzip.status.success() {
            return Err(anyhow!(
                "silverbullet unzip failed: {}",
                String::from_utf8_lossy(&unzip.stderr)
            ));
        }
        let _ = fs::remove_file(&zip_path);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perm = fs::metadata(&bin)?.permissions();
            perm.set_mode(0o755);
            fs::set_permissions(&bin, perm)?;
        }
    }

    Ok(AgentManifest {
        name: name.as_str().to_string(),
        version: SILVERBULLET_VERSION.into(),
        install_at: chrono::Utc::now().to_rfc3339(),
        endpoint_type: "webview".to_string(),
        entry_cmd: vec![bin.display().to_string()],
    })
}
