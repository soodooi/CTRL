// ADR-002 substrate §1 v19 (2026-06-09, H-2026-06-09-002) — 3-agent aggregator.
//
// Lazy installer for the external brain agents (hermes / opencode). Notes/KB
// = the user's own Obsidian (ADR-002 §1.9 v25 — kairo/SilverBullet bundling
// retired, don't reinvent the wheel), not a CTRL-installed agent.
// Each agent gets its own directory under ~/.ctrl/agents/<name>/ with a
// manifest.json recording version + install timestamp + endpoint type.
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
}

impl AgentName {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentName::Hermes => "hermes",
            AgentName::Opencode => "opencode",
        }
    }

    pub fn from_str(s: &str) -> Result<Self> {
        match s {
            "hermes" => Ok(AgentName::Hermes),
            "opencode" => Ok(AgentName::Opencode),
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
            // End-user machines have no Node/npm — every agent installs
            // from self-contained binaries (ADR-002 §1.2 v20: zero
            // prerequisite runtimes; kernel bootstraps what it needs).
            AgentName::Hermes => None,
            AgentName::Opencode => None,
        }
    }
}

/// Pinned upstream distributions, verified against real sources 2026-06-10
/// (ADR-002 substrate §1.1 v20):
/// - hermes = NousResearch/hermes-agent (PyPI, MIT). Embedding path is the
///   ACP stdio server (`hermes-acp`), NOT an MCP `chat` tool.
/// Notes/KB = the user's Obsidian (ADR-002 §1.9 v25), not a bundled agent —
/// the kairo/SilverBullet binary download was retired (don't reinvent the wheel).
pub const HERMES_ACP_SPEC: &str = "hermes-agent[acp]==0.16.0";
pub const HERMES_ONESHOT_SPEC: &str = "hermes-agent==0.16.0";
/// hermes-agent requires Python >=3.11,<3.14; pin one so uv fetches a managed
/// CPython instead of the system Python (3.9 on macOS). See HERMES_ACP_SPEC use.
pub const HERMES_PYTHON: &str = "3.12";
const OPENCODE_VERSION: &str = "1.17.3";
const UV_VERSION: &str = "0.11.20";

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
        (AgentName::Opencode, None) => install_opencode_binary(&name)?,
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
    };

    let entry_cmd = match name {
        AgentName::Hermes => vec![bin.display().to_string(), "acp".into()],
        // Real flags verified against opencode 1.17 docs: `opencode serve
        // [--port N] [--hostname H]`; the launcher appends a picked free
        // port + 127.0.0.1 and parses the announce line from stdout.
        AgentName::Opencode => vec![bin.display().to_string(), "serve".into()],
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
    let uvx = ensure_uvx()?;
    // Touch the agent dir so is_installed()'s manifest probe has a home.
    let _ = agent_dir(name)?;
    Ok(AgentManifest {
        name: name.as_str().to_string(),
        version: "0.16.0".into(),
        install_at: chrono::Utc::now().to_rfc3339(),
        endpoint_type: "acp-stdio".to_string(),
        // `--python 3.12`: hermes-agent[acp] requires Python >=3.11; without
        // this uvx falls back to the system Python (3.9 on macOS) and fails
        // to resolve. uv fetches a managed CPython on first run. Verified via
        // scripts/probes/hermes-acp-probe.mjs 2026-06-17 (ADR-002 §1.8.4).
        entry_cmd: vec![
            uvx.display().to_string(),
            "--python".into(),
            HERMES_PYTHON.into(),
            "--from".into(),
            HERMES_ACP_SPEC.into(),
            "hermes-acp".into(),
        ],
    })
}

/// Resolve uvx: user's PATH first, else the kernel-bootstrapped copy in
/// ~/.ctrl/bin/ (downloaded from astral-sh/uv releases — single static
/// binary, no Python prerequisite; uv manages Python itself). End users
/// never install anything by hand (bao 2026-06-10).
pub fn ensure_uvx() -> Result<PathBuf> {
    if let Some(p) = crate::kernel::provider::path_resolver::resolve_binary_path("uvx") {
        return Ok(p);
    }
    let base = directories::BaseDirs::new().context("home dir")?;
    let bin_dir = base.home_dir().join(".ctrl").join("bin");
    let uvx = bin_dir.join("uvx");
    if uvx.exists() {
        return Ok(uvx);
    }
    fs::create_dir_all(&bin_dir).context("create ~/.ctrl/bin")?;
    let asset = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "uv-aarch64-apple-darwin.tar.gz",
        ("macos", _) => "uv-x86_64-apple-darwin.tar.gz",
        ("windows", _) => "uv-x86_64-pc-windows-msvc.zip",
        (_, "aarch64") => "uv-aarch64-unknown-linux-gnu.tar.gz",
        _ => "uv-x86_64-unknown-linux-gnu.tar.gz",
    };
    let url = format!(
        "https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/{asset}"
    );
    let tarball = bin_dir.join(asset);
    run_ok(Command::new("curl").args(["-fsSL", "-o"]).arg(&tarball).arg(&url), "uv download")?;
    // tar.gz unpacks uv-<target>/{uv,uvx}; strip the top dir into bin/.
    run_ok(
        Command::new("tar")
            .args(["-xzf"])
            .arg(&tarball)
            .args(["--strip-components", "1", "-C"])
            .arg(&bin_dir),
        "uv unpack",
    )?;
    let _ = fs::remove_file(&tarball);
    if !uvx.exists() {
        return Err(anyhow!("uvx missing after unpack: {}", uvx.display()));
    }
    Ok(uvx)
}

/// opencode — official standalone release binary (no Node prerequisite).
/// Asset names verified against anomalyco/opencode v1.17.3 releases.
fn install_opencode_binary(name: &AgentName) -> Result<AgentManifest> {
    let dir = agent_dir(name)?;
    let bin_dir = dir.join("bin");
    fs::create_dir_all(&bin_dir).context("create agent bin dir")?;
    let bin = bin_dir.join(if cfg!(windows) { "opencode.exe" } else { "opencode" });

    if !bin.exists() {
        let asset = match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => "opencode-darwin-arm64.zip",
            ("macos", _) => "opencode-darwin-x64.zip",
            ("windows", _) => "opencode-windows-x64.zip",
            (_, "aarch64") => "opencode-linux-arm64.zip",
            _ => "opencode-linux-x64.zip",
        };
        let url = format!(
            "https://github.com/anomalyco/opencode/releases/download/v{OPENCODE_VERSION}/{asset}"
        );
        let zip_path = bin_dir.join(asset);
        run_ok(Command::new("curl").args(["-fsSL", "-o"]).arg(&zip_path).arg(&url), "opencode download")?;
        run_ok(Command::new("unzip").arg("-o").arg(&zip_path).arg("-d").arg(&bin_dir), "opencode unzip")?;
        let _ = fs::remove_file(&zip_path);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if bin.exists() {
                let mut perm = fs::metadata(&bin)?.permissions();
                perm.set_mode(0o755);
                fs::set_permissions(&bin, perm)?;
            }
        }
        if !bin.exists() {
            return Err(anyhow!("opencode binary missing after unzip"));
        }
    }

    Ok(AgentManifest {
        name: name.as_str().to_string(),
        version: OPENCODE_VERSION.into(),
        install_at: chrono::Utc::now().to_rfc3339(),
        endpoint_type: "http-port".to_string(),
        entry_cmd: vec![bin.display().to_string(), "serve".into()],
    })
}

fn run_ok(cmd: &mut Command, what: &str) -> Result<()> {
    let out = cmd.output().with_context(|| format!("{what}: spawn failed"))?;
    if !out.status.success() {
        return Err(anyhow!("{what} failed: {}", String::from_utf8_lossy(&out.stderr)));
    }
    Ok(())
}

#[cfg(test)]
mod e2e_tests {
    use super::*;

    /// Real user auto-install path — network + disk. Run explicitly:
    /// `cargo test e2e_user_autoinstall -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn e2e_user_autoinstall_and_launch() {
        for name in [AgentName::Opencode, AgentName::Hermes] {
            let m = install(name.clone(), false).expect("install");
            println!("installed {} v{} ({})", m.name, m.version, m.endpoint_type);
        }
        // Launch smoke for the long-running HTTP server (opencode).
        for name in [AgentName::Opencode] {
            let mut launched = crate::shell::agent_launcher::launch(&name).expect("launch");
            println!("launched {:?} -> {:?}", name, launched.endpoint);
            let _ = launched.child.kill();
        }
    }
}
