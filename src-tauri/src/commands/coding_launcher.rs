//! Human-triggered external coding launcher.
//!
//! CTRL projects the configured root and gate; the user's OpenCode process owns
//! its lifecycle and agent loop. This command only performs the explicit
//! app-shell Effect requested by the user. Installed feature-pack project
//! scopes are also valid OpenCode launch targets. This module remains only an
//! explicit user-triggered shell Effect; the external CLI owns its loop and
//! history and reaches CTRL as an attributed `:17873` client.
//! (ADR-001 spine §4 v22; ADR-003 frontend §8.5 v40;
//! ADR-005 irisy §11 v40)

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::kernel::provider::path_resolver::resolve_binary_path;
use crate::kernel::vault::default_vault_root;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingLauncherStatus {
    pub workspaces: Vec<CodingWorkspace>,
    pub terminals: Vec<LauncherTarget>,
    pub editors: Vec<LauncherTarget>,
    pub opencode_available: bool,
    pub launch_command: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingWorkspace {
    pub id: String,
    pub label: String,
    pub path: String,
    pub opencode_config_present: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherTarget {
    pub id: String,
    pub label: String,
    pub available: bool,
    pub supports_command: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingLaunchArgs {
    pub target: String,
    pub workspace: String,
    pub mode: CodingLaunchMode,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodingLaunchMode {
    OpenCode,
    Shell,
    Editor,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingLaunchReply {
    pub workspace: String,
    pub target: String,
    pub mode: String,
}

#[tauri::command]
pub fn coding_launcher_status() -> Result<CodingLauncherStatus, String> {
    let root = configured_root()?;
    let opencode = resolve_binary_path("opencode");
    let launch_command = opencode.as_ref().map(|binary| build_command(&root, binary));

    Ok(CodingLauncherStatus {
        workspaces: discover_workspaces(&root),
        terminals: terminal_targets(),
        editors: editor_targets(),
        opencode_available: opencode.is_some(),
        launch_command,
    })
}

#[tauri::command]
pub fn register_project_resource(path: String) -> Result<String, String> {
    let root = configured_root()?;
    let workspace = validate_workspace(&root, Path::new(&path))?;
    crate::kernel::project_resource::register_authorized_project(&workspace)
        .map(|resource| resource.to_string())
}

#[tauri::command]
pub fn launch_coding_workspace(args: CodingLaunchArgs) -> Result<CodingLaunchReply, String> {
    let root = configured_root()?;
    let workspace = validate_workspace(&root, Path::new(&args.workspace))?;

    match args.mode {
        CodingLaunchMode::OpenCode => {
            if !workspace.join("opencode.json").is_file() {
                return Err(
                    "OpenCode config is not present in the configured CTRL workspace".to_string(),
                );
            }
            let binary = resolve_binary_path("opencode").ok_or_else(|| {
                "OpenCode is not installed or is not available on PATH".to_string()
            })?;
            launch_terminal_command(&args.target, &workspace, &binary)?;
        }
        CodingLaunchMode::Shell => launch_terminal_shell(&args.target, &workspace)?,
        CodingLaunchMode::Editor => launch_editor(&args.target, &workspace)?,
    }

    Ok(CodingLaunchReply {
        workspace: workspace.to_string_lossy().into_owned(),
        target: args.target,
        mode: match args.mode {
            CodingLaunchMode::OpenCode => "opencode",
            CodingLaunchMode::Shell => "shell",
            CodingLaunchMode::Editor => "editor",
        }
        .to_string(),
    })
}

fn configured_root() -> Result<PathBuf, String> {
    let root = default_vault_root().ok_or_else(|| "CTRL workspace is unavailable".to_string())?;
    std::fs::canonicalize(root).map_err(|e| format!("Resolve CTRL workspace: {e}"))
}

fn workspace_view(id: &str, label: &str, dir: &Path) -> CodingWorkspace {
    CodingWorkspace {
        id: id.to_string(),
        label: label.to_string(),
        path: dir.to_string_lossy().into_owned(),
        opencode_config_present: dir.join("opencode.json").is_file(),
    }
}

/// Enumerate every valid OpenCode launch target: the configured root itself,
/// plus any direct child directory that carries an `opencode.json` — i.e. a
/// feature-pack scope `projector::project_pack` has actually materialized
/// (ADR-002 §1B.8 v45). A directory is skipped when it does not resolve
/// canonically inside `root` (e.g. a symlink escaping the workspace), using
/// the SAME containment rule `validate_workspace` enforces at launch time, so
/// discovery never advertises a workspace launch would reject.
fn discover_workspaces(root: &Path) -> Vec<CodingWorkspace> {
    let mut workspaces = vec![workspace_view("ctrl", "CTRL workspace", root)];

    let Ok(entries) = fs::read_dir(root) else {
        return workspaces;
    };
    let mut packs: Vec<(String, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            let canonical = canonical_child(root, &name)?;
            if canonical.join("opencode.json").is_file() {
                Some((name, canonical))
            } else {
                None
            }
        })
        .collect();
    packs.sort_by(|a, b| a.0.cmp(&b.0));
    for (name, dir) in packs {
        workspaces.push(workspace_view(&name, &name, &dir));
    }
    workspaces
}

/// Canonicalize `root/<name>` and verify it resolves to a direct child of the
/// canonical `root` — rejects a symlink (or symlinked ancestor component) that
/// escapes the workspace, and rejects anything that isn't a directory.
fn canonical_child(root: &Path, name: &str) -> Option<PathBuf> {
    let candidate = root.join(name);
    if !candidate.is_dir() {
        return None;
    }
    let canonical = fs::canonicalize(&candidate).ok()?;
    if canonical.parent() == Some(root) {
        Some(canonical)
    } else {
        None
    }
}

/// A launchable workspace is the configured root itself, or one of its direct
/// children that carries `opencode.json` — the SAME predicate `discover_workspaces`
/// filters on, applied to the resolved canonical path rather than a listing. This
/// keeps discovery and validation as one containment + pack-scope rule instead of
/// two independently maintained ones: any workspace `discover_workspaces`
/// advertises is accepted here, a symlink escaping the root is rejected in both
/// places alike, and an arbitrary non-pack child directory (`Notes/`, `tables/`)
/// is never a valid launch target just because it happens to live under the root.
fn validate_workspace(root: &Path, requested: &Path) -> Result<PathBuf, String> {
    let requested =
        fs::canonicalize(requested).map_err(|e| format!("Resolve coding workspace: {e}"))?;
    if requested == root {
        return Ok(requested);
    }
    if requested.parent() == Some(root) && requested.join("opencode.json").is_file() {
        return Ok(requested);
    }
    Err(
        "Coding workspace must be the configured CTRL workspace or one of its installed feature-pack scopes"
            .to_string(),
    )
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn build_command(workspace: &Path, binary: &Path) -> String {
    format!(
        "cd -- {} && exec {}",
        shell_quote(&workspace.to_string_lossy()),
        shell_quote(&binary.to_string_lossy())
    )
}

#[cfg(target_os = "macos")]
fn app_exists(name: &str) -> bool {
    let home = std::env::var("HOME").ok().map(PathBuf::from);
    [
        Some(PathBuf::from("/Applications").join(format!("{name}.app"))),
        home.map(|path| path.join("Applications").join(format!("{name}.app"))),
    ]
    .into_iter()
    .flatten()
    .any(|path| path.exists())
}

#[cfg(target_os = "macos")]
fn terminal_targets() -> Vec<LauncherTarget> {
    vec![
        LauncherTarget {
            id: "terminal".to_string(),
            label: "Terminal".to_string(),
            available: Path::new("/System/Applications/Utilities/Terminal.app").exists(),
            supports_command: true,
        },
        LauncherTarget {
            id: "iterm2".to_string(),
            label: "iTerm2".to_string(),
            available: app_exists("iTerm") || app_exists("iTerm2"),
            supports_command: true,
        },
    ]
}

#[cfg(target_os = "macos")]
fn editor_targets() -> Vec<LauncherTarget> {
    vec![
        LauncherTarget {
            id: "kiro".to_string(),
            label: "Kiro".to_string(),
            available: app_exists("Kiro"),
            supports_command: false,
        },
        LauncherTarget {
            id: "vscode".to_string(),
            label: "Visual Studio Code".to_string(),
            available: app_exists("Visual Studio Code"),
            supports_command: false,
        },
    ]
}

#[cfg(target_os = "macos")]
fn run_osascript(lines: &[&str], command: &str) -> Result<(), String> {
    let mut process = Command::new("/usr/bin/osascript");
    for line in lines {
        process.arg("-e").arg(line);
    }
    let status = process
        .arg(command)
        .status()
        .map_err(|e| format!("Start terminal automation: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Terminal automation exited with {status}"))
    }
}

#[cfg(target_os = "macos")]
fn launch_terminal_command(target: &str, workspace: &Path, binary: &Path) -> Result<(), String> {
    let command = build_command(workspace, binary);
    match target {
        "terminal" => run_osascript(
            &[
                "on run argv",
                "tell application \"Terminal\"",
                "activate",
                "do script (item 1 of argv)",
                "end tell",
                "end run",
            ],
            &command,
        ),
        "iterm2" => run_osascript(
            &[
                "on run argv",
                "tell application \"iTerm2\"",
                "activate",
                "create window with default profile command (item 1 of argv)",
                "end tell",
                "end run",
            ],
            &command,
        ),
        _ => Err("Unsupported terminal target".to_string()),
    }
}

#[cfg(target_os = "macos")]
fn open_macos_app(app: &str, workspace: &Path) -> Result<(), String> {
    let status = Command::new("/usr/bin/open")
        .args(["-a", app])
        .arg(workspace)
        .status()
        .map_err(|e| format!("Open {app}: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Open {app} exited with {status}"))
    }
}

#[cfg(target_os = "macos")]
fn launch_terminal_shell(target: &str, workspace: &Path) -> Result<(), String> {
    match target {
        "terminal" => open_macos_app("Terminal", workspace),
        "iterm2" => {
            open_macos_app("iTerm", workspace).or_else(|_| open_macos_app("iTerm2", workspace))
        }
        _ => Err("Unsupported terminal target".to_string()),
    }
}

#[cfg(target_os = "macos")]
fn launch_editor(target: &str, workspace: &Path) -> Result<(), String> {
    match target {
        "kiro" => open_macos_app("Kiro", workspace),
        "vscode" => open_macos_app("Visual Studio Code", workspace),
        _ => Err("Unsupported editor target".to_string()),
    }
}

#[cfg(not(target_os = "macos"))]
fn terminal_targets() -> Vec<LauncherTarget> {
    Vec::new()
}

#[cfg(not(target_os = "macos"))]
fn editor_targets() -> Vec<LauncherTarget> {
    Vec::new()
}

#[cfg(not(target_os = "macos"))]
fn launch_terminal_command(_target: &str, _workspace: &Path, _binary: &Path) -> Result<(), String> {
    Err("External coding launch is currently available on macOS only".to_string())
}

#[cfg(not(target_os = "macos"))]
fn launch_terminal_shell(_target: &str, _workspace: &Path) -> Result<(), String> {
    Err("External terminal launch is currently available on macOS only".to_string())
}

#[cfg(not(target_os = "macos"))]
fn launch_editor(_target: &str, _workspace: &Path) -> Result<(), String> {
    Err("External editor launch is currently available on macOS only".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_opencode_json(dir: &Path) {
        fs::write(dir.join("opencode.json"), "{}").unwrap();
    }

    // --- discover_workspaces ------------------------------------------------

    #[test]
    fn discover_lists_root_even_without_opencode_json() {
        let root = TempDir::new().unwrap();
        let canonical = fs::canonicalize(root.path()).unwrap();
        let workspaces = discover_workspaces(&canonical);
        assert_eq!(workspaces.len(), 1);
        assert_eq!(workspaces[0].id, "ctrl");
        assert!(!workspaces[0].opencode_config_present);
    }

    #[test]
    fn discover_lists_a_pack_child_that_carries_opencode_json() {
        let root = TempDir::new().unwrap();
        let canonical = fs::canonicalize(root.path()).unwrap();
        let pack_dir = canonical.join("ctrl-ghostfolio");
        fs::create_dir_all(&pack_dir).unwrap();
        write_opencode_json(&pack_dir);

        let workspaces = discover_workspaces(&canonical);
        assert_eq!(workspaces.len(), 2);
        let pack = workspaces
            .iter()
            .find(|w| w.id == "ctrl-ghostfolio")
            .unwrap();
        assert!(pack.opencode_config_present);
        assert_eq!(pack.path, pack_dir.to_string_lossy());
    }

    #[test]
    fn discover_skips_a_child_directory_without_opencode_json() {
        let root = TempDir::new().unwrap();
        let canonical = fs::canonicalize(root.path()).unwrap();
        // A non-pack child (e.g. Notes/) that a pack scope must NOT be confused
        // with — no opencode.json means it never appears as a launch target.
        fs::create_dir_all(canonical.join("Notes")).unwrap();

        let workspaces = discover_workspaces(&canonical);
        assert_eq!(workspaces.len(), 1, "only the root should be listed");
    }

    #[test]
    fn discover_skips_a_symlink_escaping_the_root() {
        let root = TempDir::new().unwrap();
        let canonical = fs::canonicalize(root.path()).unwrap();
        let outside = TempDir::new().unwrap();
        let outside_canonical = fs::canonicalize(outside.path()).unwrap();
        write_opencode_json(&outside_canonical);

        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside_canonical, canonical.join("escape")).unwrap();
        #[cfg(unix)]
        {
            let workspaces = discover_workspaces(&canonical);
            assert_eq!(
                workspaces.len(),
                1,
                "a symlink resolving outside root must never be advertised"
            );
        }
    }

    #[test]
    fn discover_skips_a_plain_file_named_like_a_pack() {
        let root = TempDir::new().unwrap();
        let canonical = fs::canonicalize(root.path()).unwrap();
        fs::write(canonical.join("not-a-dir"), "x").unwrap();
        let workspaces = discover_workspaces(&canonical);
        assert_eq!(workspaces.len(), 1);
    }

    // --- validate_workspace --------------------------------------------------

    #[test]
    fn validate_accepts_the_root_itself() {
        let root = TempDir::new().unwrap();
        let canonical = fs::canonicalize(root.path()).unwrap();
        let result = validate_workspace(&canonical, &canonical).unwrap();
        assert_eq!(result, canonical);
    }

    #[test]
    fn validate_accepts_a_pack_child_with_opencode_json() {
        let root = TempDir::new().unwrap();
        let canonical = fs::canonicalize(root.path()).unwrap();
        let pack_dir = canonical.join("ctrl-ghostfolio");
        fs::create_dir_all(&pack_dir).unwrap();
        write_opencode_json(&pack_dir);

        let result = validate_workspace(&canonical, &pack_dir).unwrap();
        assert_eq!(result, pack_dir);
    }

    #[test]
    fn validate_rejects_a_child_directory_without_opencode_json() {
        let root = TempDir::new().unwrap();
        let canonical = fs::canonicalize(root.path()).unwrap();
        let notes_dir = canonical.join("Notes");
        fs::create_dir_all(&notes_dir).unwrap();

        let err = validate_workspace(&canonical, &notes_dir).unwrap_err();
        assert!(err.contains("feature-pack scopes"));
    }

    #[test]
    fn validate_rejects_a_directory_traversal_outside_root() {
        let root = TempDir::new().unwrap();
        let canonical = fs::canonicalize(root.path()).unwrap();
        let outside = TempDir::new().unwrap();
        let outside_canonical = fs::canonicalize(outside.path()).unwrap();

        let err = validate_workspace(&canonical, &outside_canonical).unwrap_err();
        assert!(err.contains("feature-pack scopes"));
    }

    #[test]
    fn validate_rejects_a_symlink_escaping_the_root() {
        let root = TempDir::new().unwrap();
        let canonical = fs::canonicalize(root.path()).unwrap();
        let outside = TempDir::new().unwrap();
        let outside_canonical = fs::canonicalize(outside.path()).unwrap();
        write_opencode_json(&outside_canonical);

        #[cfg(unix)]
        {
            let link = canonical.join("escape");
            std::os::unix::fs::symlink(&outside_canonical, &link).unwrap();
            // Even though the symlink target has opencode.json, its resolved
            // parent is NOT the configured root, so it must be rejected —
            // the same containment rule discovery applies.
            let err = validate_workspace(&canonical, &link).unwrap_err();
            assert!(err.contains("feature-pack scopes"));
        }
    }

    #[test]
    fn validate_rejects_a_nonexistent_path() {
        let root = TempDir::new().unwrap();
        let canonical = fs::canonicalize(root.path()).unwrap();
        let missing = canonical.join("does-not-exist");
        let err = validate_workspace(&canonical, &missing).unwrap_err();
        assert!(err.contains("Resolve coding workspace"));
    }

    // --- shell_quote / build_command -----------------------------------------

    #[test]
    fn shell_quote_escapes_single_quotes() {
        assert_eq!(shell_quote("it's"), "'it'\"'\"'s'");
        assert_eq!(shell_quote("/plain/path"), "'/plain/path'");
    }

    #[test]
    fn build_command_quotes_workspace_and_binary() {
        let workspace = Path::new("/tmp/a workspace");
        let binary = Path::new("/usr/local/bin/opencode");
        let command = build_command(workspace, binary);
        assert_eq!(
            command,
            "cd -- '/tmp/a workspace' && exec '/usr/local/bin/opencode'"
        );
    }

    // --- CodingLaunchMode / args deserialization -----------------------------

    #[test]
    fn coding_launch_args_deserializes_snake_case_mode() {
        let json = r#"{"target":"terminal","workspace":"/tmp/x","mode":"open_code"}"#;
        let args: CodingLaunchArgs = serde_json::from_str(json).unwrap();
        assert_eq!(args.target, "terminal");
        assert!(matches!(args.mode, CodingLaunchMode::OpenCode));
    }

    #[test]
    fn coding_launch_args_rejects_unknown_mode() {
        let json = r#"{"target":"terminal","workspace":"/tmp/x","mode":"not_a_mode"}"#;
        let result: Result<CodingLaunchArgs, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }
}
