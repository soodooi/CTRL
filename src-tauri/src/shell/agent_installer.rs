// Bundled Hermes installer for the one managed Irisy runtime.
//
// Hermes lives under ~/.ctrl/agents/hermes/ with a manifest recording the
// pinned version and ACP entry command. External BYO CLIs are projected gate
// clients; CTRL never installs or owns their agent loops.
// (ADR-001 spine §4 v22; ADR-005 irisy §11 v40)
//
// Idempotent — calling install() on an already-installed Hermes re-reads the
// manifest. Re-install is opt-in so user-modified configuration is preserved.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AgentName {
    Hermes,
}

impl AgentName {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentName::Hermes => "hermes",
        }
    }
}

/// Pinned upstream distributions, verified against real sources 2026-06-10
/// (ADR-002 substrate §1.1 v20):
/// - hermes = NousResearch/hermes-agent (PyPI, MIT). Embedding path is the
///   ACP stdio server (`hermes-acp`), NOT an MCP `chat` tool.
/// Notes/KB = CTRL's native NotesApp (ADR-002 §1.9 v46 — Obsidian connector
/// retired; earlier the kairo/SilverBullet binary download was retired too).
/// Pinned hermes-agent version — single source of truth for both uvx specs AND
/// the manifest version stamp. Bump this and both specs together; the
/// `hermes_specs_match_version` test enforces they stay in sync. Existing
/// installs auto-upgrade to this on next boot via `reconcile_hermes_pin`
/// (install(force=false) + the persisted entry_cmd would otherwise pin a user
/// to whatever version they first installed).
///
/// bao 2026-07-07: 0.16.0 -> 0.18.0. Upstream 0.17 ("Reach") + 0.18 ("Judgment")
/// bring completion contracts (self-verify against evidence), `/learn`
/// auto-skills, and no-cron Automation Blueprints; release notes flag NO
/// breaking changes to the ACP stdio / `hermes acp` / OpenAI `/v1` / dashboard
/// surfaces CTRL depends on, and 0.18 requires-python is still `<3.14,>=3.11`
/// (HERMES_PYTHON=3.12 satisfies it). Verified against PyPI 2026-07-07.
pub const HERMES_VERSION: &str = "0.18.0";
pub const HERMES_ACP_SPEC: &str = "hermes-agent[acp]==0.18.0";
/// Hermes 0.18 checks the legacy `streamablehttp_client` export that MCP 2.x
/// removed before it considers Streamable HTTP available. Keep this runtime
/// dependency on the latest compatible 1.x line until Hermes adopts MCP 2.x.
/// (ADR-002 substrate §1.8 v23)
pub const HERMES_MCP_SPEC: &str = "mcp>=1.24,<2";
/// hermes-agent requires Python >=3.11,<3.14; pin one so uv fetches a managed
/// CPython instead of the system Python (3.9 on macOS). See HERMES_ACP_SPEC use.
pub const HERMES_PYTHON: &str = "3.12";
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

/// True if hermes is installed but its manifest records a different version than
/// this build's `HERMES_VERSION` — i.e. the bundled pin was bumped since the
/// user last installed. Needed because `install(force=false)` returns the cached
/// manifest untouched and both the launcher and the dashboard replay the
/// persisted `entry_cmd` (which bakes the old `==x.y.z` spec), so an existing
/// install never picks up a pin bump on its own. Mirrors the builtin-pack
/// `builtin_is_newer` re-seed. Any mismatch counts (a downgrade re-seeds too —
/// the bundled pin always wins).
pub fn hermes_needs_upgrade() -> bool {
    matches!(read_manifest(&AgentName::Hermes), Some(m) if m.version != HERMES_VERSION)
}

/// Bring an already-installed hermes up to the current bundled pin by
/// force-reinstalling (rewrites `manifest.json`'s `entry_cmd` + `version`).
/// No-op when hermes is absent or already current. Cheap: `install_via_uvx`
/// only rewrites the manifest — uvx resolves the new PyPI spec on next launch.
/// Call at boot before anything reads the manifest (dashboard / acp_client).
///
/// Returns `true` if an upgrade actually happened — the caller uses this to
/// cycle the stale dashboard (a prior boot's detached `hermes dashboard`
/// survives kernel reboots and squats :17890, so the fresh-version dashboard
/// can't bind until the old one is killed).
/// The fixed managed owner is Hermes; there is no selectable agent branch.
/// (ADR-005 irisy §11 v40)
pub fn reconcile_hermes_pin() -> Result<bool> {
    if hermes_needs_upgrade() {
        let from = read_manifest(&AgentName::Hermes)
            .map(|m| m.version)
            .unwrap_or_default();
        install(AgentName::Hermes, true)?;
        tracing::info!(from = %from, to = %HERMES_VERSION, "hermes pin bumped — manifest re-seeded");
        return Ok(true);
    }
    Ok(false)
}

/// Install or re-read the sole managed Hermes record.
/// (ADR-005 irisy §11 v40)
pub fn install(name: AgentName, force: bool) -> Result<AgentManifest> {
    if !force {
        if let Some(existing) = read_manifest(&name) {
            return Ok(existing);
        }
    }

    let manifest = install_via_uvx(&name)?;
    let manifest_path = agent_dir(&name)?.join("manifest.json");
    fs::write(&manifest_path, serde_json::to_string_pretty(&manifest)?)
        .context("write manifest.json")?;
    Ok(manifest)
}

/// hermes — ACP stdio server via uvx (NousResearch/hermes-agent, MIT).
/// uvx resolves + caches the pinned PyPI spec on first launch; "install"
/// here means probing that uv exists and recording the manifest. State
/// lives in ~/.hermes (not ~/.ctrl/agents/hermes) per upstream layout.
/// This is the only managed agent installation path.
/// (ADR-005 irisy §11 v40)
fn install_via_uvx(name: &AgentName) -> Result<AgentManifest> {
    let uvx = ensure_uvx()?;
    // Touch the agent dir so is_installed()'s manifest probe has a home.
    let _ = agent_dir(name)?;
    Ok(AgentManifest {
        name: name.as_str().to_string(),
        version: HERMES_VERSION.into(),
        install_at: chrono::Utc::now().to_rfc3339(),
        endpoint_type: "acp-stdio".to_string(),
        // `--python 3.12`: hermes-agent[acp] requires Python >=3.11; without
        // this uvx falls back to the system Python (3.9 on macOS) and fails
        // to resolve. uv fetches a managed CPython on first run. Verified via
        // scripts/probes/hermes-acp-probe.mjs 2026-06-17 (ADR-002 §1.8.4).
        //
        // `--with mcp>=1.24,<2`: hermes-agent[acp] does NOT declare the `mcp`
        // client SDK as a dependency. Hermes 0.18 also checks the legacy
        // `streamablehttp_client` export removed by MCP 2.x, so an open upper
        // bound silently drops the CTRL gate. Keep this synchronized with the
        // spawn-time normalization for stale manifests.
        // (ADR-002 substrate §1.8 v23)
        entry_cmd: vec![
            uvx.display().to_string(),
            "--python".into(),
            HERMES_PYTHON.into(),
            "--with".into(),
            HERMES_MCP_SPEC.into(),
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
/// Resolve uvx only for the fixed bundled Hermes runtime.
/// External BYO CLIs remain user-owned gate clients.
/// (ADR-005 irisy §11 v40)
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
    let url = format!("https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/{asset}");
    let tarball = bin_dir.join(asset);
    run_ok(
        Command::new("curl")
            .args(["-fsSL", "-o"])
            .arg(&tarball)
            .arg(&url),
        "uv download",
    )?;
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

// Installer subprocesses support only the bundled Hermes owner.
// (ADR-005 irisy §11 v40)
fn run_ok(cmd: &mut Command, what: &str) -> Result<()> {
    let out = cmd
        .output()
        .with_context(|| format!("{what}: spawn failed"))?;
    if !out.status.success() {
        return Err(anyhow!(
            "{what} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
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

    /// The two uvx specs and the manifest stamp must all carry HERMES_VERSION —
    /// bumping the pin in one place but not another would silently install a
    /// mismatched version or make reconcile_hermes_pin loop. Guards the "bump
    /// all three together" contract (ADR-002 substrate § brain v59, 2026-07-07).
    #[test]
    fn hermes_specs_match_version() {
        assert!(
            HERMES_ACP_SPEC.ends_with(HERMES_VERSION),
            "HERMES_ACP_SPEC {HERMES_ACP_SPEC} must pin =={HERMES_VERSION}"
        );
    }
}
