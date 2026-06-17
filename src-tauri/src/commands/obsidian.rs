// Obsidian Local REST API connector (ADR-002 substrate §1.9.1).
//
// The Obsidian "Local REST API" community plugin ships its own MCP server at
// https://127.0.0.1:<port>/mcp/ (bearer-authed). We detect it (token from the
// vault's plugin data) and register that MCP endpoint on the kernel MCP bus
// (:17873 host side) via mcp_host's HTTP transport, so Irisy/hermes reach the
// user's REAL Obsidian vault — read / search / operate-on-active-note / run any
// plugin command. Optional, opt-in tier: when Obsidian isn't running this stays
// absent and Irisy falls back to the baseline kernel notes-MCP over the folder.
//
// NOTE (verification): the detection + token read + registration are unit-safe;
// the live MCP round-trip requires a machine running Obsidian + this plugin and
// has NOT been verified here. The plugin's /mcp/ is expected to speak Streamable
// HTTP (GET-SSE + POST); if it uses the older HTTP+SSE shape this connector
// needs a transport-variant tweak.

use serde::Serialize;
use tauri::State;

use crate::shell::KernelHandle;

const DEFAULT_HTTPS_PORT: u16 = 27124;
const PLUGIN_ID: &str = "obsidian-local-rest-api";
const PLUGIN_FILES: [&str; 3] = ["manifest.json", "main.js", "styles.css"];
const PLUGIN_RELEASE_BASE: &str =
    "https://github.com/coddingtonbear/obsidian-local-rest-api/releases/latest/download";

#[derive(Debug, Serialize)]
pub struct ObsidianStatus {
    pub plugin_data_found: bool,
    pub has_token: bool,
    pub mcp_url: Option<String>,
}

fn notes_vault_dir() -> Option<std::path::PathBuf> {
    let base = directories::BaseDirs::new()?;
    Some(base.home_dir().join("Documents").join("CTRL").join("Notes"))
}

/// Read the Local REST API plugin's `data.json` from the CTRL Notes vault and
/// return (apiKey, https port). None if the plugin isn't installed there. The
/// token is the USER'S own credential (lives in their vault), never a CTRL one.
fn read_plugin_config() -> Option<(String, u16)> {
    let path = notes_vault_dir()?
        .join(".obsidian")
        .join("plugins")
        .join("obsidian-local-rest-api")
        .join("data.json");
    let body = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    let key = v.get("apiKey")?.as_str()?.to_string();
    let port = v
        .get("port")
        .and_then(|p| p.as_u64())
        .map(|p| p as u16)
        .unwrap_or(DEFAULT_HTTPS_PORT);
    Some((key, port))
}

/// Build the Authorization header value from the user's own plugin token.
fn authorization_value(token: &str) -> String {
    let mut v = String::from("Bearer ");
    v.push_str(token);
    v
}

/// Detect whether the Obsidian Local REST API plugin is set up for the CTRL
/// Notes vault (surfaces onboarding state; does not connect).
#[tauri::command]
pub async fn obsidian_status() -> Result<ObsidianStatus, String> {
    match read_plugin_config() {
        Some((key, port)) => Ok(ObsidianStatus {
            plugin_data_found: true,
            has_token: !key.is_empty(),
            mcp_url: Some(format!("https://127.0.0.1:{port}/mcp/")),
        }),
        None => Ok(ObsidianStatus {
            plugin_data_found: false,
            has_token: false,
            mcp_url: None,
        }),
    }
}

/// Is the Obsidian desktop app installed on this machine?
fn obsidian_app_installed() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::path::Path::new("/Applications/Obsidian.app").exists()
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(base) = directories::BaseDirs::new() {
            // winget/installer default: %LOCALAPPDATA%\Obsidian\Obsidian.exe
            return base
                .data_local_dir()
                .join("Obsidian")
                .join("Obsidian.exe")
                .exists();
        }
        false
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::process::Command::new("sh")
            .args(["-c", "command -v obsidian || test -f /var/lib/flatpak/exports/bin/md.obsidian.Obsidian"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

/// OS package-manager command to install Obsidian (orchestrates the user's own
/// package manager — CTRL never bundles/redistributes the proprietary app).
/// Mirrors the ADR-002 §7.2 provision pattern (brew/winget fallback).
fn obsidian_install_command() -> Option<(&'static str, Vec<&'static str>)> {
    #[cfg(target_os = "macos")]
    {
        Some(("brew", vec!["install", "--cask", "obsidian"]))
    }
    #[cfg(target_os = "windows")]
    {
        Some((
            "winget",
            vec!["install", "-e", "--id", "Obsidian.Obsidian", "--silent"],
        ))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Some(("flatpak", vec!["install", "-y", "flathub", "md.obsidian.Obsidian"]))
    }
}

/// Silently install Obsidian via the OS package manager if absent (bao
/// 2026-06-17: silent auto-install, like hermes). Orchestrates the user's own
/// brew/winget/flatpak — never bundles/redistributes the app. Ok(true)=installed
/// now, Ok(false)=already present, Err=installer unavailable/failed (best-effort).
pub(crate) fn ensure_obsidian_installed() -> Result<bool, String> {
    if obsidian_app_installed() {
        return Ok(false);
    }
    let (cmd, args) =
        obsidian_install_command().ok_or_else(|| "no installer for this OS".to_string())?;
    let status = std::process::Command::new(cmd)
        .args(&args)
        .status()
        .map_err(|e| format!("{cmd} not available: {e}"))?;
    if !status.success() {
        return Err(format!("{cmd} {} failed", args.join(" ")));
    }
    Ok(true)
}

fn obsidian_global_config_dir() -> Option<std::path::PathBuf> {
    let base = directories::BaseDirs::new()?;
    #[cfg(target_os = "macos")]
    {
        Some(base.home_dir().join("Library/Application Support/obsidian"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Some(base.config_dir().join("obsidian"))
    }
}

/// Download the Local REST API plugin (MIT) into the vault's plugins dir, enable
/// it, and register the vault with Obsidian. Idempotent + non-clobbering: skips
/// the download when already present, merges community-plugins.json + the global
/// obsidian.json vault list (never overwrites the user's other vaults/plugins).
pub(crate) fn provision_plugin() -> Result<bool, String> {
    let vault = notes_vault_dir().ok_or_else(|| "home dir".to_string())?;
    let plugin_dir = vault.join(".obsidian").join("plugins").join(PLUGIN_ID);
    std::fs::create_dir_all(&plugin_dir).map_err(|e| format!("create plugin dir: {e}"))?;

    // 1. Plugin files (skip if already there — idempotent).
    let mut downloaded = false;
    if !plugin_dir.join("main.js").exists() {
        for f in PLUGIN_FILES {
            let url = format!("{PLUGIN_RELEASE_BASE}/{f}");
            let out = plugin_dir.join(f);
            let ok = std::process::Command::new("curl")
                .args(["-fsSL", "-o"])
                .arg(&out)
                .arg(&url)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            // styles.css is optional; manifest.json + main.js are required.
            if !ok && f != "styles.css" {
                return Err(format!("download {f} failed"));
            }
        }
        downloaded = true;
    }

    // 2. Enable in community-plugins.json (merge).
    let cpj = vault.join(".obsidian").join("community-plugins.json");
    let mut enabled: Vec<String> = std::fs::read_to_string(&cpj)
        .ok()
        .and_then(|b| serde_json::from_str(&b).ok())
        .unwrap_or_default();
    if !enabled.iter().any(|p| p == PLUGIN_ID) {
        enabled.push(PLUGIN_ID.to_string());
        std::fs::write(
            &cpj,
            serde_json::to_string(&enabled).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("write community-plugins.json: {e}"))?;
    }

    // 3. Register the vault in the global obsidian.json (merge, preserve others).
    if let Some(cfg_dir) = obsidian_global_config_dir() {
        let path = cfg_dir.join("obsidian.json");
        let vault_path = vault.to_string_lossy().to_string();
        let mut root: serde_json::Value = std::fs::read_to_string(&path)
            .ok()
            .and_then(|b| serde_json::from_str(&b).ok())
            .unwrap_or_else(|| serde_json::json!({ "vaults": {} }));
        let vaults = root
            .get_mut("vaults")
            .and_then(|v| v.as_object_mut());
        if let Some(vaults) = vaults {
            let already = vaults
                .values()
                .any(|v| v.get("path").and_then(|p| p.as_str()) == Some(vault_path.as_str()));
            if !already {
                let id = uuid::Uuid::new_v4().simple().to_string()[..16].to_string();
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                vaults.insert(
                    id,
                    serde_json::json!({ "path": vault_path, "ts": ts, "open": false }),
                );
                std::fs::create_dir_all(&cfg_dir).ok();
                std::fs::write(
                    &path,
                    serde_json::to_string(&root).map_err(|e| e.to_string())?,
                )
                .map_err(|e| format!("write obsidian.json: {e}"))?;
            }
        }
    }

    Ok(downloaded)
}

#[derive(Debug, Serialize)]
pub struct ObsidianProvision {
    pub app_installed: bool,
    pub install_ran: bool,
    pub plugin_provisioned: bool,
    pub plugin_downloaded: bool,
    pub note: Option<String>,
}

/// Auto-init for the Obsidian notes connector (ADR-002 §1.9.1), run at CTRL
/// onboarding. Silently installs the app if absent (bao: like hermes), then
/// provisions the Local REST API plugin + enables it + registers the vault. The
/// plugin generates its own token + cert when Obsidian first opens; CTRL reads
/// it later via `obsidian_status` / `obsidian_connect`.
#[tauri::command]
pub async fn obsidian_provision() -> Result<ObsidianProvision, String> {
    // Both calls are blocking (subprocess + network + fs) — off the async pool.
    let install_outcome = tokio::task::spawn_blocking(ensure_obsidian_installed)
        .await
        .map_err(|e| e.to_string())?;
    let (install_ran, note) = match install_outcome {
        Ok(ran) => (ran, None),
        Err(e) => (false, Some(e)),
    };
    let plugin_downloaded = tokio::task::spawn_blocking(provision_plugin)
        .await
        .map_err(|e| e.to_string())??;

    Ok(ObsidianProvision {
        app_installed: obsidian_app_installed(),
        install_ran,
        plugin_provisioned: true,
        plugin_downloaded,
        note,
    })
}

/// Launch Obsidian on the CTRL Notes vault (via the obsidian:// URI, which
/// starts the app if not running) so its plugins — including Local REST API —
/// load and serve. A GUI window appears (Obsidian has no plugin-serving headless
/// mode); CTRL can't fully hide it. Idempotent: re-opening an already-open vault
/// just focuses it.
#[tauri::command]
pub async fn obsidian_launch() -> Result<(), String> {
    let vault = notes_vault_dir().ok_or_else(|| "home dir".to_string())?;
    let path = vault.to_string_lossy().replace(' ', "%20");
    let uri = format!("obsidian://open?path={path}");

    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(&uri);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/c", "start", "", &uri]);
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&uri);
        c
    };

    cmd.status()
        .map_err(|e| format!("launch Obsidian: {e}"))
        .and_then(|s| {
            if s.success() {
                Ok(())
            } else {
                Err("Obsidian launch returned non-zero (is it installed?)".to_string())
            }
        })
}

#[derive(Debug, Serialize)]
pub struct ObsidianConnected {
    pub server_id: String,
    pub tools: Vec<String>,
}

/// Register the Obsidian Local REST API MCP server on the kernel bus and
/// connect (ADR-002 §1.9.1). Idempotent at the mcp_host layer.
#[tauri::command]
pub async fn obsidian_connect(
    kernel: State<'_, KernelHandle>,
) -> Result<ObsidianConnected, String> {
    use crate::kernel::mcp_host::{McpServerDescriptor, McpServerSource};

    // CTRL opens Obsidian itself — idempotent, focuses if already open. The
    // plugin loads + serves /mcp/ once Obsidian is up; the retry loop below
    // waits for it. Verified live: no plugin-consent prompt because
    // community-plugins.json is pre-provisioned.
    let _ = obsidian_launch().await;

    let (key, port) = read_plugin_config().ok_or_else(|| {
        "Obsidian Local REST API plugin not found for the CTRL Notes vault — provisioning \
         may not have run yet (obsidian_provision)"
            .to_string()
    })?;
    if key.is_empty() {
        return Err("Obsidian token not generated yet — give Obsidian a moment to finish opening".into());
    }

    let server_id = "obsidian".to_string();
    let host = kernel.runtime.mcp_host.clone();
    host.register(McpServerDescriptor {
        id: server_id.clone(),
        name: "Obsidian".to_string(),
        version: "local-rest-api".to_string(),
        description: "User's Obsidian vault via Local REST API (ADR-002 §1.9.1)".to_string(),
        tools: Vec::new(),
        source: McpServerSource::Http {
            url: format!("https://127.0.0.1:{port}/mcp/"),
            auth_header: Some(authorization_value(&key)),
        },
    })
    .await;
    // The plugin takes a moment to serve after Obsidian opens; retry a few times.
    let mut last_err = String::new();
    for attempt in 0..5u32 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        match host.connect(&server_id).await {
            Ok(()) => {
                last_err.clear();
                break;
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    if !last_err.is_empty() {
        return Err(format!("connect failed (is Obsidian open with the vault?): {last_err}"));
    }
    let tools = host
        .list_tools(&server_id)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|t| t.name.to_string())
        .collect();

    Ok(ObsidianConnected { server_id, tools })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real provisioning against the local machine (network + filesystem):
    /// downloads the plugin into ~/Documents/CTRL/Notes/.obsidian/, enables it,
    /// merges the vault into the global obsidian.json. Idempotent + preserves
    /// existing vaults. Run: `cargo test obsidian_provision_real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn obsidian_provision_real() {
        let downloaded = provision_plugin().expect("provision");
        let vault = notes_vault_dir().unwrap();
        let pdir = vault.join(".obsidian").join("plugins").join(PLUGIN_ID);
        assert!(pdir.join("manifest.json").exists(), "manifest.json missing");
        assert!(pdir.join("main.js").exists(), "main.js missing");
        let cpj: Vec<String> = serde_json::from_str(
            &std::fs::read_to_string(vault.join(".obsidian").join("community-plugins.json")).unwrap(),
        )
        .unwrap();
        assert!(cpj.iter().any(|p| p == PLUGIN_ID), "plugin not enabled");
        println!("downloaded={downloaded}; plugin dir + community-plugins.json OK");
    }
}
