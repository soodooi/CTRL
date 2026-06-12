// Built-in tool downloader — installs standalone binary tools (ripgrep / go /
// node …) that a feature pack's `provision.tools[]` requests, into
// ~/.ctrl/tools/<id>/. ADR-002 substrate § composition v21 §7.2.
//
// Resolution order (bao 2026-06-12; decision in vault/ctrl/decisions/0005):
// the provision runner calls ensure_tool() FIRST. Only on a registry miss
// (NotInRegistry) does it fall back to the system package manager. This
// module hosts ONLY standalone binaries; language packages (npm / pip) are
// deliberately NOT in this registry — they go through their own package
// manager, handled by the provision runner's fallback path.
//
// Same lineage as agent_installer.rs: curl download + tar/unzip extract,
// ~/.ctrl/ isolation, removed on uninstall. sha256 verified via the sha2
// crate when the registry entry pins a checksum.
//
// Public API below is consumed by the provision runner (next commit); the
// module-level allow keeps the in-progress base clean until it is wired.
#![allow(dead_code)]

use anyhow::{anyhow, Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Archive container of a downloaded tool artifact — drives the extractor.
#[derive(Clone, Copy)]
enum ArchiveKind {
    Zip,
    TarGz,
    TarXz,
    /// Bare executable (no archive) — moved into place + chmod +x.
    Bin,
}

/// One downloadable artifact for a (tool, platform) pair.
struct ToolArtifact {
    /// Release archive or bare-binary URL.
    url: &'static str,
    /// Hex sha256 of the downloaded artifact. When Some it is verified
    /// before extraction; None skips verification (TODO: pin per tool).
    sha256: Option<&'static str>,
    /// Executable path INSIDE the extracted archive, relative to the tool
    /// dir. For ArchiveKind::Bin this is just the destination file name.
    bin_rel: &'static str,
    kind: ArchiveKind,
}

/// ~/.ctrl/tools/ — created on demand. Mirrors agent_installer::agents_root.
pub fn tools_root() -> Result<PathBuf> {
    let base = directories::BaseDirs::new().context("could not resolve home dir")?;
    let root = base.home_dir().join(".ctrl").join("tools");
    fs::create_dir_all(&root).context("create ~/.ctrl/tools/")?;
    Ok(root)
}

fn current_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn current_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x86_64"
    }
}

/// Registry of standalone binary tools CTRL hosts. Returns None when `id`
/// is not a standalone binary we host on the current platform → caller
/// falls back to the system package manager. Extend the match arms here as
/// feature packs need more standalone tools.
fn registry_lookup(id: &str) -> Option<ToolArtifact> {
    match (id, current_os(), current_arch()) {
        // ripgrep — example standalone-binary entry (small, stable GitHub
        // releases). Proves the downloader end-to-end; extend with node /
        // go / etc. as packs require them. Checksums TODO-pinned.
        ("ripgrep", "macos", "aarch64") => Some(ToolArtifact {
            url: "https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-aarch64-apple-darwin.tar.gz",
            sha256: None,
            bin_rel: "ripgrep-14.1.1-aarch64-apple-darwin/rg",
            kind: ArchiveKind::TarGz,
        }),
        ("ripgrep", "macos", "x86_64") => Some(ToolArtifact {
            url: "https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-apple-darwin.tar.gz",
            sha256: None,
            bin_rel: "ripgrep-14.1.1-x86_64-apple-darwin/rg",
            kind: ArchiveKind::TarGz,
        }),
        ("ripgrep", "linux", "x86_64") => Some(ToolArtifact {
            url: "https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz",
            sha256: None,
            bin_rel: "ripgrep-14.1.1-x86_64-unknown-linux-musl/rg",
            kind: ArchiveKind::TarGz,
        }),
        ("ripgrep", "windows", "x86_64") => Some(ToolArtifact {
            url: "https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-pc-windows-msvc.zip",
            sha256: None,
            bin_rel: "ripgrep-14.1.1-x86_64-pc-windows-msvc/rg.exe",
            kind: ArchiveKind::Zip,
        }),
        _ => None,
    }
}

/// True iff CTRL hosts `id` as a standalone binary on this platform.
pub fn is_in_registry(id: &str) -> bool {
    registry_lookup(id).is_some()
}

/// True iff the tool's binary already exists under ~/.ctrl/tools/<id>/.
pub fn is_tool_installed(id: &str) -> bool {
    match (registry_lookup(id), tools_root()) {
        (Some(entry), Ok(root)) => root.join(id).join(entry.bin_rel).exists(),
        _ => false,
    }
}

/// Ensure standalone binary tool `id` is present; returns the absolute path
/// to its executable. Err when `id` is not in the registry (caller falls
/// back to the system package manager) or the download/extract fails.
pub fn ensure_tool(id: &str) -> Result<PathBuf> {
    let entry = registry_lookup(id)
        .ok_or_else(|| anyhow!("tool '{id}' not in built-in registry (use pkg-mgr fallback)"))?;
    let tool_dir = tools_root()?.join(id);
    let bin = tool_dir.join(entry.bin_rel);
    if bin.exists() {
        return Ok(bin);
    }
    fs::create_dir_all(&tool_dir).context("create tool dir")?;
    download_and_extract(&entry, &tool_dir).with_context(|| format!("install tool '{id}'"))?;
    if !bin.exists() {
        return Err(anyhow!(
            "tool '{id}' binary missing after install: {}",
            bin.display()
        ));
    }
    Ok(bin)
}

fn download_and_extract(entry: &ToolArtifact, tool_dir: &Path) -> Result<()> {
    let archive = tool_dir.join("download.tmp");
    run_ok(
        Command::new("curl")
            .args(["-fsSL", "-o"])
            .arg(&archive)
            .arg(entry.url),
        "tool download",
    )?;
    if let Some(expected) = entry.sha256 {
        verify_sha256(&archive, expected)?;
    }
    match entry.kind {
        ArchiveKind::Zip => run_ok(
            Command::new("unzip")
                .arg("-o")
                .arg(&archive)
                .arg("-d")
                .arg(tool_dir),
            "unzip",
        )?,
        ArchiveKind::TarGz => run_ok(
            Command::new("tar")
                .args(["-xzf"])
                .arg(&archive)
                .arg("-C")
                .arg(tool_dir),
            "tar xz",
        )?,
        ArchiveKind::TarXz => run_ok(
            Command::new("tar")
                .args(["-xJf"])
                .arg(&archive)
                .arg("-C")
                .arg(tool_dir),
            "tar xJ",
        )?,
        ArchiveKind::Bin => {
            let dest = tool_dir.join(entry.bin_rel);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).ok();
            }
            fs::rename(&archive, &dest).context("place bare binary")?;
            make_executable(&dest)?;
        }
    }
    let _ = fs::remove_file(&archive);
    Ok(())
}

fn verify_sha256(path: &Path, expected_hex: &str) -> Result<()> {
    use sha2::{Digest, Sha256};
    let bytes = fs::read(path).context("read artifact for checksum")?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let got: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if !got.eq_ignore_ascii_case(expected_hex) {
        return Err(anyhow!("checksum mismatch: expected {expected_hex}, got {got}"));
    }
    Ok(())
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(path)?.permissions();
    perms.set_mode(0o755);
    fs::set_permissions(path, perms).context("chmod +x")?;
    Ok(())
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<()> {
    Ok(())
}

fn run_ok(cmd: &mut Command, what: &str) -> Result<()> {
    let out = cmd.output().with_context(|| format!("{what}: spawn failed"))?;
    if !out.status.success() {
        return Err(anyhow!(
            "{what} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}
