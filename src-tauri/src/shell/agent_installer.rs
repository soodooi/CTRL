// ADR-002 substrate §1 v19 (2026-06-09, H-2026-06-09-002) — 3-agent aggregator.
//
// Lazy installer for the external brain agents (hermes only — opencode
// retired/unwired 2026-06-25, its AgentName variant kept as a no-op). Notes/KB
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
    // Retired (bao 2026-06-25): opencode is unwired — the truth source says
    // "reserved as a future coding path, not wired". The variant is kept so
    // the kernel boot prefetch loop (kernel_supervisor) still type-checks;
    // install()/launch_with_env() return an explicit "opencode retired" error
    // for it, so the prefetch logs "deferred" and nothing installs/launches.
    Opencode,
    // Right-region BYO engines (ADR-005 §8.8 v10): selectable as Irisy's brain
    // over ACP. CTRL installs these into its OWN managed prefix
    // (~/.ctrl/agents/<id>) via `npm install --prefix` — never global, never
    // sudo — with Node self-bootstrapped by ensure_node() (zero prerequisite,
    // same model as ensure_uvx). hermes stays the zero-install default; these
    // are the one-click opt-in.
    Codex,
    ClaudeCode,
}

impl AgentName {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentName::Hermes => "hermes",
            AgentName::Opencode => "opencode",
            AgentName::Codex => "codex",
            AgentName::ClaudeCode => "claude-code",
        }
    }

    pub fn from_str(s: &str) -> Result<Self> {
        match s {
            "hermes" => Ok(AgentName::Hermes),
            "opencode" => Ok(AgentName::Opencode),
            "codex" => Ok(AgentName::Codex),
            "claude-code" => Ok(AgentName::ClaudeCode),
            other => Err(anyhow!("unknown agent: {}", other)),
        }
    }

    /// Executable name inside `node_modules/.bin/` after an npm install. Usually
    /// == as_str(), but claude-code's package ships its binary as `claude`.
    pub fn bin_name(&self) -> &'static str {
        match self {
            AgentName::Hermes => "hermes",
            AgentName::Opencode => "opencode",
            AgentName::Codex => "codex",
            AgentName::ClaudeCode => "claude",
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
            // opencode retired — never installed (install() bails first).
            AgentName::Opencode => None,
            // ADR-005 §8.8: the right-region BYO engines. End-user machines may
            // have no Node — ensure_node() bootstraps one into ~/.ctrl, then we
            // `npm install --prefix ~/.ctrl/agents/<id>` (local, no global/sudo).
            AgentName::Codex => Some("@openai/codex"),
            AgentName::ClaudeCode => Some("@anthropic-ai/claude-code"),
        }
    }
}

/// Pinned upstream distributions, verified against real sources 2026-06-10
/// (ADR-002 substrate §1.1 v20):
/// - hermes = NousResearch/hermes-agent (PyPI, MIT). Embedding path is the
///   ACP stdio server (`hermes-acp`), NOT an MCP `chat` tool.
/// Notes/KB = CTRL's native NotesApp (ADR-002 §1.9 v46 — Obsidian connector
/// retired; earlier the kairo/SilverBullet binary download was retired too).
pub const HERMES_ACP_SPEC: &str = "hermes-agent[acp]==0.16.0";
pub const HERMES_ONESHOT_SPEC: &str = "hermes-agent==0.16.0";
/// hermes-agent requires Python >=3.11,<3.14; pin one so uv fetches a managed
/// CPython instead of the system Python (3.9 on macOS). See HERMES_ACP_SPEC use.
pub const HERMES_PYTHON: &str = "3.12";
const UV_VERSION: &str = "0.11.20";
/// Node LTS pinned for the self-bootstrapped runtime (ADR-005 §8.8). Matches the
/// stack table (Node 20.x LTS). Used only to install/run the right-region BYO
/// engines into ~/.ctrl/agents — the user's own Node is preferred when present.
const NODE_VERSION: &str = "20.18.1";

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
    // opencode retired (bao 2026-06-25) — unwired. Check FIRST, before the
    // cached-manifest early return, so a leftover ~/.ctrl/agents/opencode
    // manifest from a prior install is never re-read as a success.
    if matches!(name, AgentName::Opencode) {
        return Err(anyhow!("opencode retired — unwired"));
    }
    if !force {
        if let Some(existing) = read_manifest(&name) {
            return Ok(existing);
        }
    }

    let manifest = match (&name, name.npm_package()) {
        // opencode retired (bao 2026-06-25) — unwired; kept for match
        // exhaustiveness, unreachable via the early return above.
        (AgentName::Opencode, _) => return Err(anyhow!("opencode retired — unwired")),
        (_, Some(pkg)) => install_via_npm(&name, pkg)?,
        (AgentName::Hermes, None) => install_via_uvx(&name)?,
        (other, None) => {
            return Err(anyhow!("agent {} has no install method", other.as_str()))
        }
    };

    let manifest_path = agent_dir(&name)?.join("manifest.json");
    fs::write(&manifest_path, serde_json::to_string_pretty(&manifest)?)
        .context("write manifest.json")?;
    Ok(manifest)
}

fn install_via_npm(name: &AgentName, package: &str) -> Result<AgentManifest> {
    let dir = agent_dir(name)?;
    let prefix = dir.to_str().context("non-utf8 agent dir")?;

    // Self-bootstrap Node (ADR-005 §8.8) so a Node-less machine installs in one
    // click. ensure_node returns the dir holding node/npm; npm is a JS script
    // run BY node, so node must be visible on PATH for the spawn to work.
    let node_bin = ensure_node()?;
    let npm = node_bin.join(if cfg!(windows) { "npm.cmd" } else { "npm" });
    let path_env = prepend_path(&node_bin);

    let output = Command::new(&npm)
        .args(["install", "--prefix", prefix, package])
        .env("PATH", &path_env)
        .output()
        .with_context(|| format!("npm spawn failed ({})", npm.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("npm install failed: {}", stderr));
    }

    let bin = dir.join("node_modules").join(".bin").join(name.bin_name());
    if !bin.exists() {
        return Err(anyhow!(
            "agent binary missing after install: {}",
            bin.display()
        ));
    }

    let endpoint_type = match name {
        AgentName::Hermes => "acp-stdio",
        // Right-region BYO engines: CTRL drives them over ACP via their adapter
        // (codex-acp / claude-code-acp, spawned by acp_client::engine_argv). The
        // manifest records the installed binary path for detection + version; the
        // ACP adapter is fetched separately at spawn time.
        AgentName::Codex | AgentName::ClaudeCode => "acp-stdio",
        // opencode retired — install() bails before reaching here.
        AgentName::Opencode => return Err(anyhow!("opencode retired — unwired")),
    };

    let entry_cmd = match name {
        AgentName::Hermes => vec![bin.display().to_string(), "acp".into()],
        AgentName::Codex | AgentName::ClaudeCode => vec![bin.display().to_string()],
        AgentName::Opencode => return Err(anyhow!("opencode retired — unwired")),
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
        //
        // `--with mcp>=1.24`: hermes-agent[acp] does NOT declare the `mcp` client
        // SDK as a dependency, so without this the spawned env has
        // `_MCP_AVAILABLE=False` and hermes silently drops the CTRL gate we pass
        // via session/new.mcpServers — the brain sees ZERO CTRL tools (verified
        // end-to-end 2026-06-28). acp_client re-injects this at spawn too, for
        // stale manifests; keep both in sync.
        entry_cmd: vec![
            uvx.display().to_string(),
            "--python".into(),
            HERMES_PYTHON.into(),
            "--with".into(),
            "mcp>=1.24".into(),
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

/// Resolve a Node runtime dir (the folder holding `node` + `npm`): the user's
/// own Node on PATH first, else the kernel-bootstrapped copy in ~/.ctrl/node/
/// (downloaded from nodejs.org — official LTS tarball, no prerequisite). Same
/// zero-install model as ensure_uvx (ADR-005 §8.8). End users never install
/// Node by hand; the one-click managed install of Codex/Claude bootstraps it.
pub fn ensure_node() -> Result<PathBuf> {
    // The user's own Node wins — never double-install.
    if let Some(npm) = crate::kernel::provider::path_resolver::resolve_binary_path("npm") {
        if let Some(parent) = npm.parent() {
            return Ok(parent.to_path_buf());
        }
    }
    let base = directories::BaseDirs::new().context("home dir")?;
    let node_root = base.home_dir().join(".ctrl").join("node");
    // Unix tarballs unpack to <root>/bin/{node,npm}; the Windows zip lays the
    // executables (node.exe / npm.cmd) at the top level after strip-1.
    let bin_dir = if cfg!(windows) {
        node_root.clone()
    } else {
        node_root.join("bin")
    };
    let npm_name = if cfg!(windows) { "npm.cmd" } else { "npm" };
    if bin_dir.join(npm_name).exists() {
        return Ok(bin_dir);
    }
    fs::create_dir_all(&node_root).context("create ~/.ctrl/node")?;

    // Asset names follow the stable nodejs.org/dist scheme (pending real-machine
    // verify on Windows per ADR-005 §8.8).
    let (asset, is_zip) = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => (format!("node-v{NODE_VERSION}-darwin-arm64.tar.gz"), false),
        ("macos", _) => (format!("node-v{NODE_VERSION}-darwin-x64.tar.gz"), false),
        ("windows", _) => (format!("node-v{NODE_VERSION}-win-x64.zip"), true),
        (_, "aarch64") => (format!("node-v{NODE_VERSION}-linux-arm64.tar.gz"), false),
        _ => (format!("node-v{NODE_VERSION}-linux-x64.tar.gz"), false),
    };
    let url = format!("https://nodejs.org/dist/v{NODE_VERSION}/{asset}");
    let archive = node_root.join(&asset);
    run_ok(
        Command::new("curl").args(["-fsSL", "-o"]).arg(&archive).arg(&url),
        "node download",
    )?;
    // bsdtar (macOS/Win10+) auto-detects compression; strip the top dir so the
    // executables land directly under node_root (Windows) / node_root/bin (Unix).
    let strip = if is_zip {
        Command::new("tar")
            .args(["-xf"])
            .arg(&archive)
            .args(["--strip-components", "1", "-C"])
            .arg(&node_root)
            .status()
    } else {
        Command::new("tar")
            .args(["-xzf"])
            .arg(&archive)
            .args(["--strip-components", "1", "-C"])
            .arg(&node_root)
            .status()
    };
    strip.with_context(|| "node unpack: spawn failed".to_string())?;
    let _ = fs::remove_file(&archive);
    if !bin_dir.join(npm_name).exists() {
        return Err(anyhow!(
            "npm missing after Node unpack: {}",
            bin_dir.join(npm_name).display()
        ));
    }
    Ok(bin_dir)
}

/// Prepend `dir` to the current PATH so a spawned `npm` finds its sibling
/// `node` (npm is a node script). Returns the full PATH value to set on the
/// child Command.
fn prepend_path(dir: &std::path::Path) -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    match std::env::var("PATH") {
        Ok(existing) => format!("{}{}{}", dir.display(), sep, existing),
        Err(_) => dir.display().to_string(),
    }
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
        for name in [AgentName::Hermes] {
            let m = install(name.clone(), false).expect("install");
            println!("installed {} v{} ({})", m.name, m.version, m.endpoint_type);
        }
    }

    /// opencode is retired (bao 2026-06-25) — install must refuse it.
    #[test]
    fn opencode_install_is_retired() {
        let err = install(AgentName::Opencode, false).unwrap_err();
        assert!(err.to_string().contains("retired"));
    }
}
