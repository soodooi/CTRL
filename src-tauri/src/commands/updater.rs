// Native installation boundary and relaunch for the Tauri updater.
//
// On macOS, production updates may mutate exactly one bundle:
// /Applications/CTRL.app. macOS development bundles under target/ are previews
// and must never query or install from the production updater channel. The
// WebView has no direct updater-plugin permission; check, download, verification,
// installation, and macOS relaunch are mediated here.
// (ADR-004 cap § updater v6)

#[cfg(target_os = "macos")]
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::{Command, Output, Stdio};
#[cfg(target_os = "macos")]
use std::time::Duration;
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

#[cfg(target_os = "macos")]
const CANONICAL_BUNDLE: &str = "/Applications/CTRL.app";
#[cfg(target_os = "macos")]
const CANONICAL_EXECUTABLE: &str = "/Applications/CTRL.app/Contents/MacOS/ctrl";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateMetadata {
    version: String,
    body: Option<String>,
}

#[cfg(target_os = "macos")]
fn running_bundle_root() -> Result<PathBuf, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("resolve running executable failed: {error}"))?;
    executable
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            format!(
                "running executable is not inside a macOS app bundle: {}",
                executable.display()
            )
        })
}

#[cfg(target_os = "macos")]
fn reject_symlink(path: &Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("inspect app bundle {} failed: {error}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "app bundle must not be a symlink: {}",
            path.display()
        ));
    }
    Ok(())
}

/// Require the lexical running bundle path to be the fixed install path. A
/// canonicalized comparison is intentionally insufficient because it would let
/// /Applications/CTRL.app symlink to a development bundle.
#[cfg(target_os = "macos")]
fn assert_canonical_bundle() -> Result<(), String> {
    let running = running_bundle_root()?;
    if running != Path::new(CANONICAL_BUNDLE) {
        return Err(format!(
            "Production updates are available only from {CANONICAL_BUNDLE}; running bundle is {}",
            running.display()
        ));
    }
    reject_symlink(Path::new(CANONICAL_BUNDLE))
}

/// Read release identity from tauri.conf.json, the signing source of truth.
#[cfg(target_os = "macos")]
fn release_identity() -> Result<(String, String), String> {
    let config: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
        .map_err(|error| format!("parse embedded Tauri config failed: {error}"))?;
    let identifier = config
        .get("identifier")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "embedded Tauri config has no bundle identifier".to_string())?;
    let fingerprint = config
        .pointer("/bundle/macOS/signingIdentity")
        .and_then(serde_json::Value::as_str)
        .filter(|value| value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| {
            "embedded Tauri config macOS signing identity must be a certificate fingerprint"
                .to_string()
        })?;
    Ok((identifier.to_string(), fingerprint.to_ascii_lowercase()))
}

#[cfg(target_os = "macos")]
fn expected_requirement(identifier: &str, fingerprint: &str) -> String {
    format!("=identifier \"{identifier}\" and certificate root = H\"{fingerprint}\"")
}

#[cfg(target_os = "macos")]
fn run_command(program: &str, args: &[&str], path: &Path) -> Result<Output, String> {
    Command::new(program)
        .args(args)
        .arg(path)
        .output()
        .map_err(|error| format!("run {program} failed: {error}"))
}

#[cfg(target_os = "macos")]
fn successful_output(program: &str, args: &[&str], path: &Path) -> Result<Output, String> {
    let output = run_command(program, args, path)?;
    if output.status.success() {
        return Ok(output);
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if detail.is_empty() {
        format!("{program} rejected {}", path.display())
    } else {
        format!("{program} rejected {}: {detail}", path.display())
    })
}

/// Enforce release identity using an independently constructed codesign
/// requirement, then reject unstable cdhash-bound Designated Requirements.
/// (ADR-004 cap § updater v6)
#[cfg(target_os = "macos")]
fn verify_bundle(root: &Path) -> Result<(), String> {
    reject_symlink(root)?;
    let info_plist = root.join("Contents/Info.plist");
    let executable = root.join("Contents/MacOS/ctrl");
    if !info_plist.is_file() {
        return Err(format!(
            "Info.plist missing at {}; updater installation was incomplete",
            info_plist.display()
        ));
    }
    if !executable.is_file() {
        return Err(format!(
            "executable missing at {}; updater installation was incomplete",
            executable.display()
        ));
    }

    let (expected_identifier, signing_fingerprint) = release_identity()?;
    let plist_output = successful_output(
        "/usr/bin/plutil",
        &["-extract", "CFBundleIdentifier", "raw", "-o", "-"],
        &info_plist,
    )?;
    let actual_identifier = String::from_utf8_lossy(&plist_output.stdout)
        .trim()
        .to_string();
    if actual_identifier != expected_identifier {
        return Err(format!(
            "bundle identifier mismatch: expected {expected_identifier}, found {actual_identifier}"
        ));
    }

    let requirement = expected_requirement(&expected_identifier, &signing_fingerprint);
    successful_output(
        "/usr/bin/codesign",
        &["--verify", "--deep", "--strict", "-R", &requirement],
        root,
    )?;

    let details_output = successful_output("/usr/bin/codesign", &["-dv", "--verbose=4"], root)?;
    let details = String::from_utf8_lossy(&details_output.stderr);
    if details.contains("Signature=adhoc") || !details.contains("Authority=") {
        return Err("installed app does not have a trusted release signature".to_string());
    }

    let requirement_output = successful_output("/usr/bin/codesign", &["-d", "-r-"], root)?;
    let designated_requirement = String::from_utf8_lossy(&requirement_output.stderr);
    if designated_requirement
        .to_ascii_lowercase()
        .contains("cdhash")
    {
        return Err("installed app Designated Requirement is cdhash-bound".to_string());
    }

    Ok(())
}

fn updater_for(app: &tauri::AppHandle) -> Result<Updater, String> {
    #[cfg(target_os = "macos")]
    {
        assert_canonical_bundle()?;
        app.updater_builder()
            .executable_path(CANONICAL_EXECUTABLE)
            .build()
            .map_err(|error| format!("initialize updater failed: {error}"))
    }

    #[cfg(not(target_os = "macos"))]
    {
        app.updater()
            .map_err(|error| format!("initialize updater failed: {error}"))
    }
}

async fn available_update(app: &tauri::AppHandle) -> Result<Option<Update>, String> {
    updater_for(app)?
        .check()
        .await
        .map_err(|error| format!("check for update failed: {error}"))
}

/// Check through the native boundary so macOS development bundles cannot query
/// the production endpoint even if WebView code is modified.
#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<Option<AppUpdateMetadata>, String> {
    Ok(available_update(&app)
        .await?
        .map(|update| AppUpdateMetadata {
            version: update.version,
            body: update.body,
        }))
}

#[cfg(target_os = "macos")]
fn schedule_verified_relaunch() -> Result<(), String> {
    let root = Path::new(CANONICAL_BUNDLE);
    verify_bundle(root)?;
    let (identifier, fingerprint) = release_identity()?;
    let requirement = expected_requirement(&identifier, &fingerprint);
    let pid = std::process::id().to_string();

    // The helper repeats identity verification after the old process exits,
    // immediately before LaunchServices opens the fixed path. Every dynamic
    // value is a positional argument, never interpolated into shell source.
    let script = "pid=\"$1\"; bundle=\"$2\"; identifier=\"$3\"; requirement=\"$4\"; i=0; while kill -0 \"$pid\" 2>/dev/null && [ \"$i\" -lt 150 ]; do sleep 0.2; i=$((i+1)); done; kill -0 \"$pid\" 2>/dev/null && exit 1; sleep 0.5; [ -L \"$bundle\" ] && exit 1; actual=$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - \"$bundle/Contents/Info.plist\") || exit 1; [ \"$actual\" = \"$identifier\" ] || exit 1; /usr/bin/codesign --verify --deep --strict -R \"$requirement\" \"$bundle\" || exit 1; details=$(/usr/bin/codesign -dv --verbose=4 \"$bundle\" 2>&1) || exit 1; case \"$details\" in *\"Signature=adhoc\"*) exit 1;; esac; case \"$details\" in *\"Authority=\"*) ;; *) exit 1;; esac; designated=$(/usr/bin/codesign -d -r- \"$bundle\" 2>&1) || exit 1; case \"$designated\" in *cdhash*|*CDHash*) exit 1;; esac; /usr/bin/open \"$bundle\"";
    Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .arg("ctrl-update-relaunch")
        .arg(&pid)
        .arg(root)
        .arg(&identifier)
        .arg(&requirement)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("spawn relaunch helper failed: {error}"))?;

    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(150));
        std::process::exit(0);
    });
    Ok(())
}

/// Re-check, download, signature-verify, and install inside one native command.
/// The expected version binds installation to the metadata the user accepted.
#[tauri::command]
pub async fn install_app_update(
    app: tauri::AppHandle,
    expected_version: String,
) -> Result<bool, String> {
    let update = available_update(&app)
        .await?
        .ok_or_else(|| "no newer update is available".to_string())?;
    if update.version != expected_version {
        return Err(format!(
            "available update changed: expected {expected_version}, found {}",
            update.version
        ));
    }

    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| format!("download update failed: {error}"))?;

    #[cfg(target_os = "macos")]
    assert_canonical_bundle()?;

    update
        .install(bytes)
        .map_err(|error| format!("install update failed: {error}"))?;

    #[cfg(target_os = "macos")]
    {
        schedule_verified_relaunch()?;
        Ok(true)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}
