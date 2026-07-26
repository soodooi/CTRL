// Native installation boundary and relaunch for the Tauri updater.
//
// On macOS, production updates may mutate exactly one bundle:
// /Applications/CTRL.app. macOS development bundles under target/ are previews
// and must never query or install from the production updater channel. The
// WebView has no direct updater-plugin permission; check, download, verification,
// installation, and macOS relaunch are mediated here.
// (ADR-004 cap § updater v11)

#[cfg(target_os = "macos")]
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::collections::HashSet;
#[cfg(target_os = "macos")]
use std::ffi::CString;
#[cfg(target_os = "macos")]
use std::io::{Cursor, Write};
#[cfg(target_os = "macos")]
use std::os::unix::ffi::{OsStrExt, OsStringExt};
#[cfg(target_os = "macos")]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
#[cfg(target_os = "macos")]
use std::path::{Component, Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::{Command, Output, Stdio};
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

#[cfg(target_os = "macos")]
const CANONICAL_BUNDLE: &str = "/Applications/CTRL.app";
#[cfg(target_os = "macos")]
const CANONICAL_EXECUTABLE: &str = "/Applications/CTRL.app/Contents/MacOS/ctrl";
#[cfg(target_os = "macos")]
static UPDATE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

#[cfg(all(target_os = "macos", feature = "updater-debug-channel"))]
const UPDATER_DEBUG_FAULT_FILE: &str = ".ctrl/state/updater-debug-fault";

#[cfg(all(target_os = "macos", feature = "updater-debug-channel"))]
fn updater_debug_endpoint() -> Result<tauri::Url, String> {
    let endpoint = env!("CTRL_UPDATER_DEBUG_ENDPOINT")
        .parse::<tauri::Url>()
        .map_err(|error| format!("parse updater debug endpoint failed: {error}"))?;
    let isolated = endpoint.scheme() == "http"
        && endpoint.host_str() == Some("127.0.0.1")
        && endpoint.port().is_some()
        && endpoint.path() == "/latest.json"
        && endpoint.username().is_empty()
        && endpoint.password().is_none()
        && endpoint.query().is_none()
        && endpoint.fragment().is_none();
    if !isolated {
        return Err(
            "updater debug endpoint must be http://127.0.0.1:<port>/latest.json".to_string(),
        );
    }
    Ok(endpoint)
}

/// Signed localhost A/B builds can consume named, one-shot fault markers. The
/// entire path is absent from production binaries because the Cargo feature is
/// opt-in and the governed release command never enables it.
/// (ADR-004 cap § updater v11)
#[cfg(all(target_os = "macos", feature = "updater-debug-channel"))]
fn consume_updater_debug_fault(expected: &str) -> Result<bool, String> {
    let home = std::env::var_os("HOME")
        .ok_or_else(|| "resolve updater debug fault path failed: HOME is unset".to_string())?;
    let path = PathBuf::from(home).join(UPDATER_DEBUG_FAULT_FILE);
    match std::fs::symlink_metadata(&path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "inspect updater debug fault marker {} failed: {error}",
                path.display()
            ))
        }
    }
    let lock_path = path.with_extension("lock");
    let mut lock_options = std::fs::OpenOptions::new();
    lock_options
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW);
    let lock = lock_options.open(&lock_path).map_err(|error| {
        format!(
            "open updater debug fault lock {} failed: {error}",
            lock_path.display()
        )
    })?;
    let lock_status = unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&lock), libc::LOCK_EX) };
    if lock_status != 0 {
        return Err(format!(
            "lock updater debug fault marker failed: {}",
            std::io::Error::last_os_error()
        ));
    }

    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "inspect updater debug fault marker {} failed: {error}",
                path.display()
            ))
        }
    };
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err("updater debug fault marker must be a regular file".to_string());
    }
    let contents = std::fs::read_to_string(&path).map_err(|error| {
        format!(
            "read updater debug fault marker {} failed: {error}",
            path.display()
        )
    })?;

    let mut pending: Vec<&str> = contents
        .split(|character: char| character == ',' || character.is_whitespace())
        .filter(|value| !value.is_empty())
        .collect();
    let Some(index) = pending.iter().position(|value| *value == expected) else {
        return Ok(false);
    };
    pending.remove(index);
    if pending.is_empty() {
        remove_file_if_present(&path)?;
    } else {
        let mut options = std::fs::OpenOptions::new();
        options
            .write(true)
            .truncate(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW);
        let mut marker = options.open(&path).map_err(|error| {
            format!(
                "rewrite updater debug fault marker {} failed: {error}",
                path.display()
            )
        })?;
        marker
            .write_all(pending.join("\n").as_bytes())
            .and_then(|_| marker.sync_all())
            .map_err(|error| format!("persist updater debug fault marker failed: {error}"))?;
    }
    tracing::warn!(fault = expected, "consumed updater debug fault");
    Ok(true)
}

#[cfg(target_os = "macos")]
#[derive(Debug)]
struct UpdateOperationGuard;

#[cfg(target_os = "macos")]
impl UpdateOperationGuard {
    fn acquire() -> Result<Self, String> {
        UPDATE_IN_PROGRESS
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| "another app update is already in progress".to_string())
    }
}

#[cfg(target_os = "macos")]
impl Drop for UpdateOperationGuard {
    fn drop(&mut self) {
        UPDATE_IN_PROGRESS.store(false, Ordering::Release);
    }
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct ProcBsdInfo {
    flags: u32,
    status: u32,
    xstatus: u32,
    pid: u32,
    ppid: u32,
    uid: libc::uid_t,
    gid: libc::gid_t,
    ruid: libc::uid_t,
    rgid: libc::gid_t,
    svuid: libc::uid_t,
    svgid: libc::gid_t,
    reserved: u32,
    command: [libc::c_char; 16],
    name: [libc::c_char; 32],
    open_files: u32,
    process_group: u32,
    job_control_count: u32,
    controlling_device: u32,
    terminal_process_group: u32,
    nice: i32,
    start_seconds: u64,
    start_microseconds: u64,
}

#[cfg(target_os = "macos")]
#[link(name = "proc")]
unsafe extern "C" {
    fn proc_pidinfo(
        pid: libc::c_int,
        flavor: libc::c_int,
        arg: u64,
        buffer: *mut libc::c_void,
        buffer_size: libc::c_int,
    ) -> libc::c_int;
    fn proc_pidpath(pid: libc::c_int, buffer: *mut libc::c_void, buffer_size: u32) -> libc::c_int;
}

#[cfg(target_os = "macos")]
const PROC_PIDTBSDINFO: libc::c_int = 3;
#[cfg(target_os = "macos")]
const PROC_PIDPATH_BUFFER_SIZE: usize = 4096;

/// A PID is reusable; the kernel start timestamp and executable vnode path bind
/// journal ownership to one process instance. (ADR-004 cap § updater v11)
#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessIdentity {
    pid: u32,
    start_seconds: u64,
    start_microseconds: u64,
    executable: PathBuf,
}

#[cfg(target_os = "macos")]
fn process_identity(pid: u32) -> Option<ProcessIdentity> {
    let mut info = std::mem::MaybeUninit::<ProcBsdInfo>::zeroed();
    let info_size = std::mem::size_of::<ProcBsdInfo>();
    let read = unsafe {
        proc_pidinfo(
            pid as libc::c_int,
            PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            info_size as libc::c_int,
        )
    };
    if read != info_size as libc::c_int {
        return None;
    }
    let info = unsafe { info.assume_init() };
    if info.pid != pid {
        return None;
    }

    let mut path = vec![0u8; PROC_PIDPATH_BUFFER_SIZE];
    let path_len = unsafe {
        proc_pidpath(
            pid as libc::c_int,
            path.as_mut_ptr().cast(),
            path.len() as u32,
        )
    };
    if path_len <= 0 {
        return None;
    }
    path.truncate(path_len as usize);
    if path.last() == Some(&0) {
        path.pop();
    }
    Some(ProcessIdentity {
        pid,
        start_seconds: info.start_seconds,
        start_microseconds: info.start_microseconds,
        executable: PathBuf::from(std::ffi::OsString::from_vec(path)),
    })
}

#[cfg(target_os = "macos")]
fn current_process_identity() -> Result<ProcessIdentity, String> {
    process_identity(std::process::id())
        .ok_or_else(|| "resolve current process identity failed".to_string())
}

#[cfg(target_os = "macos")]
fn same_process_instance(expected: &ProcessIdentity) -> bool {
    process_identity(expected.pid).as_ref() == Some(expected)
}

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
/// (ADR-004 cap § updater v11)
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

#[cfg(target_os = "macos")]
fn bundle_version(root: &Path) -> Result<String, String> {
    let info_plist = root.join("Contents/Info.plist");
    let output = successful_output(
        "/usr/bin/plutil",
        &["-extract", "CFBundleShortVersionString", "raw", "-o", "-"],
        &info_plist,
    )?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Owns the same-volume staging directory until the atomic swap has either
/// committed or rolled back. Dropping it can only remove staged/old content;
/// the canonical bundle is never inside this directory.
/// (ADR-004 cap § updater v11)
#[cfg(target_os = "macos")]
struct StagedUpdate {
    root: PathBuf,
    bundle: PathBuf,
    cleanup_on_drop: bool,
}

#[cfg(target_os = "macos")]
impl StagedUpdate {
    fn preserve(&mut self) {
        self.cleanup_on_drop = false;
    }
}

#[cfg(target_os = "macos")]
impl Drop for StagedUpdate {
    fn drop(&mut self) {
        if !self.cleanup_on_drop {
            return;
        }
        if let Err(error) = std::fs::remove_dir_all(&self.root) {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(path = %self.root.display(), %error, "failed to clean updater staging directory");
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn create_staging_root(canonical_bundle: &Path) -> Result<PathBuf, String> {
    let parent = canonical_bundle
        .parent()
        .ok_or_else(|| format!("app bundle has no parent: {}", canonical_bundle.display()))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("resolve updater staging timestamp failed: {error}"))?
        .as_nanos();

    for attempt in 0..32 {
        let path = parent.join(format!(
            ".ctrl-update-{}-{nonce}-{attempt}",
            std::process::id()
        ));
        let mut builder = std::fs::DirBuilder::new();
        builder.mode(0o700);
        match builder.create(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "create same-volume updater staging directory {} failed: {error}",
                    path.display()
                ));
            }
        }
    }

    Err("allocate unique updater staging directory failed".to_string())
}

const MAX_UPDATE_ARCHIVE_ENTRIES: usize = 100_000;
#[cfg(target_os = "macos")]
const MAX_UPDATE_UNPACKED_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[cfg(target_os = "macos")]
fn validate_link_target(
    entry_path: &Path,
    target: &Path,
    bundle_name: &std::ffi::OsStr,
    hard_link: bool,
) -> Result<(), String> {
    if target.is_absolute() {
        return Err(format!(
            "updater archive link target is absolute: {} -> {}",
            entry_path.display(),
            target.display()
        ));
    }

    let mut normalized: Vec<std::ffi::OsString> = if hard_link {
        Vec::new()
    } else {
        entry_path
            .parent()
            .into_iter()
            .flat_map(Path::components)
            .filter_map(|component| match component {
                Component::Normal(value) => Some(value.to_owned()),
                _ => None,
            })
            .collect()
    };
    for component in target.components() {
        match component {
            Component::Normal(value) => normalized.push(value.to_owned()),
            Component::CurDir => {}
            Component::ParentDir if normalized.len() > 1 => {
                normalized.pop();
            }
            _ => {
                return Err(format!(
                    "updater archive link escapes the bundle: {} -> {}",
                    entry_path.display(),
                    target.display()
                ));
            }
        }
    }
    if normalized.first().map(std::ffi::OsString::as_os_str) != Some(bundle_name) {
        return Err(format!(
            "updater archive link is outside the expected bundle: {} -> {}",
            entry_path.display(),
            target.display()
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn validate_archive_entry(
    entry: &tar::Entry<'_, flate2::read::GzDecoder<Cursor<&[u8]>>>,
    path: &Path,
    bundle_name: &std::ffi::OsStr,
) -> Result<(), String> {
    let entry_type = entry.header().entry_type();
    if entry_type.is_file() || entry_type.is_dir() {
        return Ok(());
    }
    if entry_type.is_symlink() || entry_type.is_hard_link() {
        let target = entry
            .link_name()
            .map_err(|error| format!("read updater link target failed: {error}"))?
            .ok_or_else(|| format!("updater archive link has no target: {}", path.display()))?;
        return validate_link_target(path, &target, bundle_name, entry_type.is_hard_link());
    }
    Err(format!(
        "updater archive has unsupported entry type at {}",
        path.display()
    ))
}

/// Extract the Tauri-signed archive beside the canonical bundle and verify its
/// release identity before any live path is mutated. Every archive member must
/// remain under the one expected `CTRL.app` root.
/// (ADR-004 cap § updater v11)
#[cfg(target_os = "macos")]
fn stage_verified_update(
    bytes: &[u8],
    canonical_bundle: &Path,
    verify: impl Fn(&Path) -> Result<(), String>,
) -> Result<StagedUpdate, String> {
    let root = create_staging_root(canonical_bundle)?;
    let bundle_name = canonical_bundle
        .file_name()
        .ok_or_else(|| {
            format!(
                "app bundle has no file name: {}",
                canonical_bundle.display()
            )
        })?
        .to_owned();
    let result = (|| {
        let decoder = flate2::read::GzDecoder::new(Cursor::new(bytes));
        let mut archive = tar::Archive::new(decoder);
        let mut saw_entry = false;
        let mut entry_count = 0usize;
        let mut unpacked_bytes = 0u64;
        let mut seen_paths = HashSet::new();

        for entry in archive
            .entries()
            .map_err(|error| format!("read updater archive failed: {error}"))?
        {
            let mut entry = entry.map_err(|error| format!("read updater entry failed: {error}"))?;
            let path = entry
                .path()
                .map_err(|error| format!("read updater entry path failed: {error}"))?
                .into_owned();
            let mut components = path.components();
            match components.next() {
                Some(Component::Normal(component)) if component == bundle_name => {}
                _ => {
                    return Err(format!(
                        "updater archive entry is outside the expected bundle root: {}",
                        path.display()
                    ));
                }
            }
            if components
                .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
            {
                return Err(format!(
                    "updater archive entry has an unsafe path: {}",
                    path.display()
                ));
            }
            entry_count += 1;
            if entry_count > MAX_UPDATE_ARCHIVE_ENTRIES {
                return Err("updater archive contains too many entries".to_string());
            }
            unpacked_bytes = unpacked_bytes
                .checked_add(entry.header().size().map_err(|error| {
                    format!("read updater entry size {} failed: {error}", path.display())
                })?)
                .ok_or_else(|| "updater archive expanded size overflow".to_string())?;
            if unpacked_bytes > MAX_UPDATE_UNPACKED_BYTES {
                return Err("updater archive expanded size exceeds the limit".to_string());
            }
            if !seen_paths.insert(path.clone()) {
                return Err(format!(
                    "updater archive contains a duplicate entry: {}",
                    path.display()
                ));
            }
            validate_archive_entry(&entry, &path, &bundle_name)?;
            if !entry.unpack_in(&root).map_err(|error| {
                format!("extract updater entry {} failed: {error}", path.display())
            })? {
                return Err(format!(
                    "updater archive entry escaped the staging directory: {}",
                    path.display()
                ));
            }
            saw_entry = true;
        }

        if !saw_entry {
            return Err("updater archive is empty".to_string());
        }
        let bundle = root.join(&bundle_name);
        if !bundle.is_dir() {
            return Err(format!(
                "updater archive did not contain {}",
                canonical_bundle.display()
            ));
        }
        reject_symlink(&bundle)?;
        verify(&bundle)?;
        Ok(bundle)
    })();

    match result {
        Ok(bundle) => Ok(StagedUpdate {
            root,
            bundle,
            cleanup_on_drop: true,
        }),
        Err(error) => {
            if let Err(cleanup_error) = std::fs::remove_dir_all(&root) {
                tracing::warn!(path = %root.display(), %cleanup_error, "failed to clean rejected updater staging directory");
            }
            Err(error)
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg(target_os = "macos")]
enum UpdatePhase {
    Prepared,
    Swapped,
    Launching,
    RollingBack,
    Healthy,
    RolledBack,
    RollbackFailed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg(target_os = "macos")]
struct UpdateTransaction {
    schema_version: u32,
    id: String,
    phase: UpdatePhase,
    canonical_bundle: PathBuf,
    staged_bundle: PathBuf,
    staging_root: PathBuf,
    health_marker: PathBuf,
    expected_version: String,
    old_process: ProcessIdentity,
    launch_process: Option<ProcessIdentity>,
    helper_process: Option<ProcessIdentity>,
    failure: Option<String>,
}

#[cfg(target_os = "macos")]
fn transaction_journal(canonical_bundle: &Path) -> Result<PathBuf, String> {
    Ok(canonical_bundle
        .parent()
        .ok_or_else(|| format!("app bundle has no parent: {}", canonical_bundle.display()))?
        .join(".ctrl-update-transaction.json"))
}

#[cfg(target_os = "macos")]
fn sync_directory(path: &Path) -> Result<(), String> {
    std::fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("sync updater directory {} failed: {error}", path.display()))
}

#[cfg(target_os = "macos")]
fn write_transaction(path: &Path, transaction: &UpdateTransaction) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("transaction journal has no parent: {}", path.display()))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("resolve transaction timestamp failed: {error}"))?
        .as_nanos();
    let temporary = parent.join(format!(
        ".ctrl-update-transaction-{}-{nonce}.tmp",
        std::process::id()
    ));
    let bytes = serde_json::to_vec(transaction)
        .map_err(|error| format!("serialize update transaction failed: {error}"))?;
    let write_result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true).mode(0o600);
        let mut file = options.open(&temporary).map_err(|error| {
            format!(
                "create update transaction {} failed: {error}",
                temporary.display()
            )
        })?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("persist update transaction failed: {error}"))?;
        std::fs::rename(&temporary, path)
            .map_err(|error| format!("activate update transaction failed: {error}"))?;
        sync_directory(parent)
    })();
    if write_result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    write_result
}

#[cfg(target_os = "macos")]
fn read_transaction(path: &Path) -> Result<UpdateTransaction, String> {
    if std::fs::symlink_metadata(path)
        .map_err(|error| {
            format!(
                "inspect update transaction {} failed: {error}",
                path.display()
            )
        })?
        .file_type()
        .is_symlink()
    {
        return Err(format!(
            "update transaction must not be a symlink: {}",
            path.display()
        ));
    }
    let bytes = std::fs::read(path)
        .map_err(|error| format!("read update transaction {} failed: {error}", path.display()))?;
    let transaction: UpdateTransaction = serde_json::from_slice(&bytes)
        .map_err(|error| format!("parse update transaction failed: {error}"))?;
    if transaction.schema_version != 2 {
        return Err(format!(
            "unsupported update transaction schema: {}",
            transaction.schema_version
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("transaction journal has no parent: {}", path.display()))?;
    let expected_canonical = parent.join("CTRL.app");
    let valid_staging_name = transaction
        .staging_root
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.starts_with(".ctrl-update-"))
        .unwrap_or(false);
    if transaction.canonical_bundle != expected_canonical
        || transaction.staging_root.parent() != Some(parent)
        || !valid_staging_name
        || transaction.staged_bundle != transaction.staging_root.join("CTRL.app")
        || transaction.health_marker != transaction.staging_root.join("launch-healthy")
    {
        return Err("update transaction contains paths outside its canonical layout".to_string());
    }
    Ok(transaction)
}

#[cfg(target_os = "macos")]
fn remove_file_if_present(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("remove {} failed: {error}", path.display())),
    }
}

#[cfg(target_os = "macos")]
fn cleanup_completed_transaction(
    journal: &Path,
    transaction: &UpdateTransaction,
) -> Result<(), String> {
    if transaction.staging_root.exists() {
        std::fs::remove_dir_all(&transaction.staging_root).map_err(|error| {
            format!(
                "remove completed update staging {} failed: {error}",
                transaction.staging_root.display()
            )
        })?;
    }
    remove_file_if_present(&transaction.health_marker)?;
    remove_file_if_present(journal)?;
    if let Some(parent) = journal.parent() {
        sync_directory(parent)?;
    }
    Ok(())
}

/// Atomically exchange the staged and canonical bundles on the same volume.
/// `RENAME_SWAP` guarantees that the canonical path never disappears, while a
/// failed post-swap verification swaps the original bundle back into place.
/// (ADR-004 cap § updater v11)
#[cfg(target_os = "macos")]
fn swap_bundle_paths(left: &Path, right: &Path) -> Result<(), String> {
    let left_c = CString::new(left.as_os_str().as_bytes())
        .map_err(|_| format!("app bundle path contains NUL: {}", left.display()))?;
    let right_c = CString::new(right.as_os_str().as_bytes())
        .map_err(|_| format!("app bundle path contains NUL: {}", right.display()))?;
    let status = unsafe { libc::renamex_np(left_c.as_ptr(), right_c.as_ptr(), libc::RENAME_SWAP) };
    if status == 0 {
        Ok(())
    } else {
        Err(format!(
            "atomically swap {} with {} failed: {}",
            left.display(),
            right.display(),
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(target_os = "macos")]
fn terminate_candidate(transaction: &UpdateTransaction) -> Result<(), String> {
    let Some(process) = transaction.launch_process.as_ref() else {
        return Ok(());
    };
    if !process_matches_candidate(process, &transaction.id) {
        return Ok(());
    }
    // Revalidate the non-reusable process instance immediately before signal.
    if !process_matches_candidate(process, &transaction.id) {
        return Ok(());
    }
    let status = unsafe { libc::kill(process.pid as i32, libc::SIGTERM) };
    if status != 0 {
        return Err(format!(
            "terminate update candidate {} failed: {}",
            process.pid,
            std::io::Error::last_os_error()
        ));
    }
    for _ in 0..25 {
        if !process_matches_candidate(process, &transaction.id) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err(format!(
        "update candidate {} did not exit after termination",
        process.pid
    ))
}

#[cfg(target_os = "macos")]
fn terminate_helper(journal: &Path, transaction: &UpdateTransaction) -> Result<(), String> {
    let Some(process) = transaction.helper_process.as_ref() else {
        return Ok(());
    };
    if !process_matches_helper(process, journal, transaction) {
        return Ok(());
    }
    // Revalidate the non-reusable process instance immediately before signal.
    if !process_matches_helper(process, journal, transaction) {
        return Ok(());
    }
    let status = unsafe { libc::kill(process.pid as i32, libc::SIGTERM) };
    if status != 0 {
        return Err(format!(
            "terminate update helper {} failed: {}",
            process.pid,
            std::io::Error::last_os_error()
        ));
    }
    for _ in 0..25 {
        if !process_matches_helper(process, journal, transaction) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err(format!(
        "update helper {} did not exit after termination",
        process.pid
    ))
}

#[cfg(target_os = "macos")]
fn rollback_swapped_before_launch<T>(
    journal: &Path,
    transaction: &mut UpdateTransaction,
    reason: &str,
) -> Result<T, String> {
    transaction.phase = UpdatePhase::RollingBack;
    transaction.failure = Some(reason.to_string());
    write_transaction(journal, transaction).map_err(|error| {
        format!(
            "{reason}; rollback intent could not be persisted, so no rollback mutation occurred: {error}"
        )
    })?;
    if let Err(rollback_error) =
        swap_bundle_paths(&transaction.canonical_bundle, &transaction.staged_bundle)
    {
        transaction.phase = UpdatePhase::RollbackFailed;
        transaction.failure = Some(format!("{reason}; rollback failed: {rollback_error}"));
        let _ = write_transaction(journal, transaction);
        return Err(format!(
            "{reason}; atomic rollback failed and recovery was preserved at {}: {rollback_error}",
            transaction.staging_root.display()
        ));
    }
    transaction.phase = UpdatePhase::RolledBack;
    if let Err(error) = write_transaction(journal, transaction) {
        // The durable RollingBack intent remains authoritative. Startup
        // reconciles bundle versions before any further swap.
        return Err(format!(
            "{reason}; previous version was restored but rollback completion could not be persisted: {error}"
        ));
    }
    cleanup_completed_transaction(journal, transaction)?;
    Err(format!("{reason}; previous version was restored"))
}

#[cfg(target_os = "macos")]
fn rollback_transaction(
    journal: &Path,
    transaction: &mut UpdateTransaction,
    reason: &str,
    reopen: bool,
) -> Result<(), String> {
    verify_bundle(&transaction.staged_bundle)
        .map_err(|error| format!("rollback bundle verification failed: {error}"))?;
    transaction.phase = UpdatePhase::RollingBack;
    transaction.failure = Some(reason.to_string());
    write_transaction(journal, transaction).map_err(|error| {
        format!(
            "{reason}; rollback intent could not be persisted, so no process or bundle mutation occurred: {error}"
        )
    })?;

    #[cfg(feature = "updater-debug-channel")]
    if consume_updater_debug_fault("rollback_interrupt")? {
        return Err(format!(
            "{reason}; debug fault interrupted rollback after durable intent"
        ));
    }

    if let Err(termination_error) = terminate_candidate(transaction) {
        transaction.phase = UpdatePhase::RollbackFailed;
        transaction.failure = Some(format!("{reason}; {termination_error}"));
        let _ = write_transaction(journal, transaction);
        return Err(format!(
            "{reason}; candidate termination was not confirmed, so both bundles were preserved at {}: {termination_error}",
            transaction.staging_root.display()
        ));
    }

    if let Err(rollback_error) =
        swap_bundle_paths(&transaction.canonical_bundle, &transaction.staged_bundle)
    {
        transaction.phase = UpdatePhase::RollbackFailed;
        transaction.failure = Some(format!("{reason}; rollback failed: {rollback_error}"));
        let _ = write_transaction(journal, transaction);
        return Err(format!(
            "{reason}; atomic rollback failed and recovery was preserved at {}: {rollback_error}",
            transaction.staging_root.display()
        ));
    }

    transaction.phase = UpdatePhase::RolledBack;
    transaction.failure = Some(reason.to_string());
    write_transaction(journal, transaction)?;
    verify_bundle(&transaction.canonical_bundle)
        .map_err(|error| format!("rollback restored an invalid bundle: {error}"))?;
    cleanup_completed_transaction(journal, transaction)?;
    if reopen {
        Command::new("/usr/bin/open")
            .arg("-n")
            .arg(&transaction.canonical_bundle)
            .status()
            .map_err(|error| format!("reopen rolled-back app failed: {error}"))?;
    }
    Err(format!("{reason}; previous version was restored"))
}

#[cfg(target_os = "macos")]
fn begin_bundle_transaction(
    canonical_bundle: &Path,
    staged: &mut StagedUpdate,
    expected_version: String,
    verify: impl Fn(&Path) -> Result<(), String>,
) -> Result<(PathBuf, UpdateTransaction), String> {
    let canonical_bundle = canonical_bundle.to_path_buf();
    reject_symlink(&canonical_bundle)?;
    reject_symlink(&staged.bundle)?;
    let journal = transaction_journal(&canonical_bundle)?;
    if journal.exists() {
        return Err(format!(
            "a previous update transaction requires recovery: {}",
            journal.display()
        ));
    }

    let old_process = current_process_identity()?;
    let mut transaction = UpdateTransaction {
        schema_version: 2,
        id: format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|error| format!("resolve transaction id failed: {error}"))?
                .as_nanos()
        ),
        phase: UpdatePhase::Prepared,
        canonical_bundle,
        staged_bundle: staged.bundle.clone(),
        staging_root: staged.root.clone(),
        health_marker: staged.root.join("launch-healthy"),
        expected_version,
        old_process,
        launch_process: None,
        helper_process: None,
        failure: None,
    };
    write_transaction(&journal, &transaction)?;
    if let Err(error) = swap_bundle_paths(&transaction.canonical_bundle, &transaction.staged_bundle)
    {
        let _ = remove_file_if_present(&journal);
        return Err(error);
    }

    transaction.phase = UpdatePhase::Swapped;
    if let Err(error) = write_transaction(&journal, &transaction) {
        staged.preserve();
        return rollback_swapped_before_launch(
            &journal,
            &mut transaction,
            &format!("persist swapped update failed: {error}"),
        );
    }

    if let Err(verification_error) = verify(&transaction.canonical_bundle) {
        staged.preserve();
        return rollback_swapped_before_launch(
            &journal,
            &mut transaction,
            &format!("updated bundle verification failed: {verification_error}"),
        );
    }

    staged.preserve();
    Ok((journal, transaction))
}

fn updater_for(app: &tauri::AppHandle) -> Result<Updater, String> {
    #[cfg(target_os = "macos")]
    {
        assert_canonical_bundle()?;
        let builder = app.updater_builder().executable_path(CANONICAL_EXECUTABLE);
        #[cfg(feature = "updater-debug-channel")]
        let builder = builder
            .endpoints(vec![updater_debug_endpoint()?])
            .map_err(|error| format!("configure updater debug endpoint failed: {error}"))?;
        builder
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

const UPDATE_HELPER_FLAG: &str = "--ctrl-update-helper";
const UPDATE_CANDIDATE_FLAG: &str = "--ctrl-update-candidate";

#[cfg(target_os = "macos")]
fn process_command(pid: u32) -> Option<String> {
    let pid_string = pid.to_string();
    let output = Command::new("/bin/ps")
        .args(["-p", pid_string.as_str(), "-o", "command="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let command = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!command.is_empty()).then_some(command)
}

#[cfg(target_os = "macos")]
fn command_matches_exact(command: &str, executable: &str, flag: &str, value: &str) -> bool {
    let args: Vec<&str> = command.split_whitespace().collect();
    args == [executable, flag, value]
}

#[cfg(target_os = "macos")]
fn os_args_match_exact(args: &[std::ffi::OsString], flag: &str, value: &str) -> bool {
    args.len() == 3 && args[1].to_str() == Some(flag) && args[2].to_str() == Some(value)
}

#[cfg(target_os = "macos")]
fn process_matches_old_app(process: &ProcessIdentity) -> bool {
    same_process_instance(process)
        && process_command(process.pid)
            .map(|command| {
                let mut args = command.split_whitespace();
                args.next() == Some(CANONICAL_EXECUTABLE)
                    && !args.any(|arg| arg == UPDATE_HELPER_FLAG || arg == UPDATE_CANDIDATE_FLAG)
            })
            .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn process_matches_candidate(process: &ProcessIdentity, transaction_id: &str) -> bool {
    same_process_instance(process)
        && process_command(process.pid)
            .map(|command| {
                command_matches_exact(
                    &command,
                    CANONICAL_EXECUTABLE,
                    UPDATE_CANDIDATE_FLAG,
                    transaction_id,
                )
            })
            .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn process_matches_helper(
    process: &ProcessIdentity,
    journal: &Path,
    transaction: &UpdateTransaction,
) -> bool {
    let helper_executable = transaction.staged_bundle.join("Contents/MacOS/ctrl");
    let helper_executable = helper_executable.to_string_lossy();
    let journal = journal.to_string_lossy();
    same_process_instance(process)
        && process_command(process.pid)
            .map(|command| {
                command_matches_exact(
                    &command,
                    helper_executable.as_ref(),
                    UPDATE_HELPER_FLAG,
                    journal.as_ref(),
                )
            })
            .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn embedded_app_version() -> Result<String, String> {
    #[cfg(all(target_os = "macos", feature = "updater-debug-channel"))]
    {
        return Ok(env!("CTRL_UPDATER_DEBUG_VERSION").to_string());
    }

    #[cfg(not(all(target_os = "macos", feature = "updater-debug-channel")))]
    {
        let config: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
            .map_err(|error| format!("parse embedded Tauri config failed: {error}"))?;
        config
            .get("version")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .ok_or_else(|| "embedded Tauri config has no version".to_string())
    }
}

#[cfg(target_os = "macos")]
fn run_update_helper(journal: &Path) -> Result<(), String> {
    let mut transaction = read_transaction(journal)?;
    for _ in 0..150 {
        if !process_matches_old_app(&transaction.old_process) {
            break;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    if process_matches_old_app(&transaction.old_process) {
        // Revalidate the non-reusable process instance immediately before signal.
        if !process_matches_old_app(&transaction.old_process) {
            return rollback_transaction(
                journal,
                &mut transaction,
                "old app identity changed before termination",
                true,
            );
        }
        let status = unsafe { libc::kill(transaction.old_process.pid as i32, libc::SIGTERM) };
        if status == 0 {
            for _ in 0..25 {
                if !process_matches_old_app(&transaction.old_process) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        }
        if process_matches_old_app(&transaction.old_process) {
            transaction.phase = UpdatePhase::RollbackFailed;
            transaction.failure = Some(
                "old app did not exit; update and rollback bundles were preserved".to_string(),
            );
            let _ = write_transaction(journal, &transaction);
            return Err(format!(
                "old app {} did not exit; preserved transaction at {}",
                transaction.old_process.pid,
                transaction.staging_root.display()
            ));
        }
        return rollback_transaction(
            journal,
            &mut transaction,
            "old app exceeded the update exit timeout",
            true,
        );
    }

    if transaction.phase == UpdatePhase::RollingBack {
        return match transaction_bundle_layout(&transaction, bundle_version)? {
            TransactionBundleLayout::CandidateCanonical => rollback_transaction(
                journal,
                &mut transaction,
                "resuming interrupted rollback",
                true,
            ),
            TransactionBundleLayout::PreviousCanonical => {
                verify_bundle(&transaction.canonical_bundle)?;
                cleanup_completed_transaction(journal, &transaction)?;
                let status = Command::new("/usr/bin/open")
                    .arg("-n")
                    .arg(&transaction.canonical_bundle)
                    .status()
                    .map_err(|error| format!("reopen rolled-back app failed: {error}"))?;
                if status.success() {
                    Ok(())
                } else {
                    Err(format!(
                        "reopen rolled-back app was rejected with status {status}"
                    ))
                }
            }
        };
    }

    if let Err(error) = verify_bundle(&transaction.canonical_bundle) {
        return rollback_transaction(
            journal,
            &mut transaction,
            &format!("prelaunch verification failed: {error}"),
            true,
        );
    }
    transaction.helper_process = Some(current_process_identity()?);
    transaction.phase = UpdatePhase::Launching;
    write_transaction(journal, &transaction)?;

    #[cfg(feature = "updater-debug-channel")]
    if consume_updater_debug_fault("launch_failure")? {
        return rollback_transaction(
            journal,
            &mut transaction,
            "debug fault rejected candidate launch",
            true,
        );
    }

    let candidate_is_running = transaction
        .launch_process
        .as_ref()
        .map(|process| process_matches_candidate(process, &transaction.id))
        .unwrap_or(false);
    if !candidate_is_running {
        let launch = Command::new("/usr/bin/open")
            .arg("-n")
            .arg(&transaction.canonical_bundle)
            .arg("--args")
            .arg(UPDATE_CANDIDATE_FLAG)
            .arg(&transaction.id)
            .status();
        match launch {
            Ok(status) if status.success() => {}
            Ok(status) => {
                return rollback_transaction(
                    journal,
                    &mut transaction,
                    &format!("LaunchServices rejected the updated app with status {status}"),
                    true,
                );
            }
            Err(error) => {
                return rollback_transaction(
                    journal,
                    &mut transaction,
                    &format!("launch updated app failed: {error}"),
                    true,
                );
            }
        }
    }

    for _ in 0..150 {
        std::thread::sleep(Duration::from_millis(200));
        if let Ok(observed) = read_transaction(journal) {
            transaction = observed;
            let marker_matches = std::fs::read_to_string(&transaction.health_marker)
                .map(|value| value == transaction.id)
                .unwrap_or(false);
            if transaction.phase == UpdatePhase::Healthy && marker_matches {
                verify_bundle(&transaction.canonical_bundle)?;
                return cleanup_completed_transaction(journal, &transaction);
            }
        }
    }

    rollback_transaction(
        journal,
        &mut transaction,
        "updated app did not report a healthy launch before timeout",
        true,
    )
}

/// Entered by the old signed executable before Tauri initialization. It owns
/// post-exit launch confirmation, cleanup, and rollback without an installer or
/// a second privileged service. (ADR-004 cap § updater v11)
/// Reject argv-controlled journals before the old signed executable enters
/// helper mode. Only the owner-only canonical journal beside CTRL.app carries
/// authority to mutate the installed bundle. (ADR-004 cap § updater v11)
#[cfg(target_os = "macos")]
fn validate_canonical_helper_journal(journal: &Path) -> Result<(), String> {
    let expected = transaction_journal(Path::new(CANONICAL_BUNDLE))?;
    if journal != expected {
        return Err(format!(
            "update helper journal must be the canonical transaction journal: {}",
            expected.display()
        ));
    }
    let metadata = std::fs::symlink_metadata(journal).map_err(|error| {
        format!(
            "inspect canonical update transaction {} failed: {error}",
            journal.display()
        )
    })?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err("canonical update transaction must be a regular file".to_string());
    }
    let mode = std::os::unix::fs::MetadataExt::mode(&metadata) & 0o777;
    if mode != 0o600 {
        return Err(format!(
            "canonical update transaction must have mode 0600, found {mode:04o}"
        ));
    }
    let owner = std::os::unix::fs::MetadataExt::uid(&metadata);
    let current_user = unsafe { libc::geteuid() };
    if owner != current_user {
        return Err(format!(
            "canonical update transaction owner mismatch: expected {current_user}, found {owner}"
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn run_updater_helper_from_args() -> bool {
    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    if args.len() != 3 || args[1].to_str() != Some(UPDATE_HELPER_FLAG) {
        return false;
    }
    let result = args
        .get(2)
        .map(PathBuf::from)
        .ok_or_else(|| "update helper requires a journal path".to_string())
        .and_then(|journal| {
            validate_canonical_helper_journal(&journal)?;
            run_update_helper(&journal)
        });
    if let Err(error) = result {
        eprintln!("CTRL update helper failed: {error}");
    }
    true
}

#[cfg(not(target_os = "macos"))]
pub fn run_updater_helper_from_args() -> bool {
    false
}

#[cfg(target_os = "macos")]
#[derive(Debug, Eq, PartialEq)]
enum TransactionBundleLayout {
    CandidateCanonical,
    PreviousCanonical,
}

#[cfg(target_os = "macos")]
fn transaction_bundle_layout(
    transaction: &UpdateTransaction,
    read_version: impl Fn(&Path) -> Result<String, String>,
) -> Result<TransactionBundleLayout, String> {
    let canonical_version = read_version(&transaction.canonical_bundle)?;
    let staged_version = read_version(&transaction.staged_bundle)?;
    let canonical_is_candidate = canonical_version == transaction.expected_version;
    let staged_is_candidate = staged_version == transaction.expected_version;
    match (canonical_is_candidate, staged_is_candidate) {
        (true, false) => Ok(TransactionBundleLayout::CandidateCanonical),
        (false, true) => Ok(TransactionBundleLayout::PreviousCanonical),
        _ => Err(format!(
            "update transaction bundle versions are ambiguous: canonical={canonical_version}, staged={staged_version}, expected={}",
            transaction.expected_version
        )),
    }
}

#[cfg(target_os = "macos")]
fn spawn_transaction_helper(
    journal: &Path,
    transaction: &UpdateTransaction,
) -> Result<ProcessIdentity, String> {
    let helper_executable = transaction.staged_bundle.join("Contents/MacOS/ctrl");
    let mut child = Command::new(&helper_executable)
        .arg(UPDATE_HELPER_FLAG)
        .arg(journal)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("spawn updater helper failed: {error}"))?;
    let pid = child.id();
    for _ in 0..25 {
        if let Some(identity) = process_identity(pid) {
            return Ok(identity);
        }
        if child
            .try_wait()
            .map_err(|error| format!("inspect updater helper failed: {error}"))?
            .is_some()
        {
            return Err("updater helper exited before its identity was captured".to_string());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let _ = child.kill();
    Err("capture updater helper process identity timed out".to_string())
}

/// Record the launched replacement PID as early as possible so the helper can
/// terminate a hung candidate before rolling back. (ADR-004 cap § updater v11)
#[cfg(target_os = "macos")]
pub fn record_pending_update_process_start() -> Result<(), String> {
    let canonical = Path::new(CANONICAL_BUNDLE);
    let running = match running_bundle_root() {
        Ok(path) => path,
        Err(_) => return Ok(()),
    };
    if running != canonical {
        return Ok(());
    }
    let journal = transaction_journal(canonical)?;
    if !journal.exists() {
        return Ok(());
    }
    let mut transaction = read_transaction(&journal)?;
    let actual_version = embedded_app_version()?;
    if transaction.phase == UpdatePhase::RollingBack {
        match transaction_bundle_layout(&transaction, bundle_version)? {
            TransactionBundleLayout::PreviousCanonical => {
                verify_bundle(canonical)?;
                cleanup_completed_transaction(&journal, &transaction)?;
                return Ok(());
            }
            TransactionBundleLayout::CandidateCanonical => {
                transaction.old_process = current_process_identity()?;
                transaction.launch_process = None;
                transaction.helper_process = None;
                write_transaction(&journal, &transaction)?;
                let helper = spawn_transaction_helper(&journal, &transaction)?;
                transaction.helper_process = Some(helper);
                write_transaction(&journal, &transaction)?;
                return Err("restarting through the interrupted rollback helper".to_string());
            }
        }
    }
    if matches!(
        transaction.phase,
        UpdatePhase::Healthy | UpdatePhase::RolledBack
    ) {
        cleanup_completed_transaction(&journal, &transaction)?;
        return Ok(());
    }
    if transaction.phase == UpdatePhase::Prepared {
        if actual_version == transaction.expected_version {
            transaction.phase = UpdatePhase::Swapped;
            write_transaction(&journal, &transaction)?;
        } else {
            cleanup_completed_transaction(&journal, &transaction)?;
            return Ok(());
        }
    }
    if !matches!(
        transaction.phase,
        UpdatePhase::Swapped | UpdatePhase::Launching
    ) {
        return Ok(());
    }

    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    let candidate_token_matches =
        os_args_match_exact(&args, UPDATE_CANDIDATE_FLAG, transaction.id.as_str());
    if !candidate_token_matches {
        // A primary launch recovering an interrupted helper must exit and let a
        // token-bound helper relaunch it. This branch runs only after the
        // single-instance plugin admitted this process.
        transaction.old_process = current_process_identity()?;
        transaction.launch_process = None;
        transaction.helper_process = None;
        transaction.phase = UpdatePhase::Swapped;
        write_transaction(&journal, &transaction)?;
        let helper_process = spawn_transaction_helper(&journal, &transaction)?;
        transaction.helper_process = Some(helper_process);
        write_transaction(&journal, &transaction)?;
        return Err("restarting through the pending update helper".to_string());
    }

    transaction.phase = UpdatePhase::Launching;
    transaction.launch_process = Some(current_process_identity()?);
    write_transaction(&journal, &transaction)?;
    let helper_is_running = transaction
        .helper_process
        .as_ref()
        .map(|process| process_matches_helper(process, &journal, &transaction))
        .unwrap_or(false);
    if !helper_is_running {
        let process = spawn_transaction_helper(&journal, &transaction)?;
        transaction.helper_process = Some(process);
        write_transaction(&journal, &transaction)?;
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn record_pending_update_process_start() -> Result<(), String> {
    Ok(())
}

/// Shell boot is the health boundary: only after hotkey/tray/kernel startup has
/// succeeded may the helper retire the previous bundle. (ADR-004 cap § updater v11)
#[cfg(target_os = "macos")]
pub fn acknowledge_pending_update_launch() -> Result<(), String> {
    let canonical = Path::new(CANONICAL_BUNDLE);
    let journal = transaction_journal(canonical)?;
    if !journal.exists() {
        return Ok(());
    }
    #[cfg(feature = "updater-debug-channel")]
    if consume_updater_debug_fault("health_timeout")? {
        tracing::warn!("debug fault suppressed updater health acknowledgement");
        return Ok(());
    }
    let mut transaction = read_transaction(&journal)?;
    if transaction.phase == UpdatePhase::Healthy {
        return Ok(());
    }
    let current_process = current_process_identity()?;
    if transaction.phase != UpdatePhase::Launching
        || transaction.launch_process.as_ref() != Some(&current_process)
    {
        return Ok(());
    }
    let actual_version = embedded_app_version()?;
    if actual_version != transaction.expected_version {
        return Err(format!(
            "updated app version mismatch: expected {}, found {actual_version}",
            transaction.expected_version
        ));
    }
    verify_bundle(canonical)?;

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true).mode(0o600);
    let mut marker = options
        .open(&transaction.health_marker)
        .map_err(|error| format!("create update health marker failed: {error}"))?;
    marker
        .write_all(transaction.id.as_bytes())
        .and_then(|_| marker.sync_all())
        .map_err(|error| format!("persist update health marker failed: {error}"))?;
    transaction.phase = UpdatePhase::Healthy;
    write_transaction(&journal, &transaction)
}

#[cfg(not(target_os = "macos"))]
pub fn acknowledge_pending_update_launch() -> Result<(), String> {
    Ok(())
}

/// Bind the authenticated archive to the accepted release version before the
/// first journal write or live-path mutation. (ADR-004 cap § updater v11)
#[cfg(target_os = "macos")]
fn begin_version_bound_transaction(
    canonical_bundle: &Path,
    staged: &mut StagedUpdate,
    expected_version: String,
    read_version: impl Fn(&Path) -> Result<String, String>,
    verify: impl Fn(&Path) -> Result<(), String>,
) -> Result<(PathBuf, UpdateTransaction), String> {
    let staged_version = read_version(&staged.bundle)?;
    if staged_version != expected_version {
        return Err(format!(
            "authenticated update version mismatch: expected {expected_version}, found {staged_version}"
        ));
    }
    begin_bundle_transaction(canonical_bundle, staged, expected_version, verify)
}

#[cfg(target_os = "macos")]
fn schedule_verified_relaunch(
    journal: &Path,
    transaction: &mut UpdateTransaction,
) -> Result<(), String> {
    verify_bundle(&transaction.canonical_bundle)?;
    match spawn_transaction_helper(journal, transaction) {
        Ok(process) => {
            transaction.helper_process = Some(process);
            if let Err(error) = write_transaction(journal, transaction) {
                if let Err(termination_error) = terminate_helper(journal, transaction) {
                    transaction.phase = UpdatePhase::RollbackFailed;
                    transaction.failure = Some(format!(
                        "persist updater helper identity failed: {error}; {termination_error}"
                    ));
                    let _ = write_transaction(journal, transaction);
                    return Err(format!(
                        "persist updater helper identity failed and helper termination was not confirmed; recovery was preserved at {}: {termination_error}",
                        transaction.staging_root.display()
                    ));
                }
                return rollback_transaction(
                    journal,
                    transaction,
                    &format!("persist updater helper identity failed: {error}"),
                    false,
                );
            }
        }
        Err(error) => {
            return rollback_transaction(journal, transaction, &error, false);
        }
    }

    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(150));
        std::process::exit(0);
    });
    Ok(())
}

/// Re-check, download, signature-verify, and atomically apply inside one native command.
/// The expected version binds the transaction to the metadata the user accepted.
#[tauri::command]
pub async fn apply_app_update(
    app: tauri::AppHandle,
    expected_version: String,
) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    let _operation_guard = UpdateOperationGuard::acquire()?;

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
    {
        assert_canonical_bundle()?;
        let canonical_bundle = Path::new(CANONICAL_BUNDLE);
        let mut staged = stage_verified_update(&bytes, canonical_bundle, verify_bundle)?;
        let (journal, mut transaction) = begin_version_bound_transaction(
            canonical_bundle,
            &mut staged,
            expected_version,
            bundle_version,
            verify_bundle,
        )?;
        schedule_verified_relaunch(&journal, &mut transaction)?;
        Ok(true)
    }

    #[cfg(not(target_os = "macos"))]
    {
        update
            .install(bytes)
            .map_err(|error| format!("install update failed: {error}"))?;
        Ok(false)
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::fs;
    use tar::Builder;
    use tempfile::tempdir;

    fn fake_bundle(parent: &Path, name: &str, marker: &str) -> PathBuf {
        let bundle = parent.join(name);
        fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
        fs::write(bundle.join("Contents/MacOS/ctrl"), marker).unwrap();
        bundle
    }

    fn marker(bundle: &Path) -> String {
        fs::read_to_string(bundle.join("Contents/MacOS/ctrl")).unwrap()
    }

    fn archive_bundle(bundle: &Path) -> Vec<u8> {
        let encoder = GzEncoder::new(Vec::new(), Compression::default());
        let mut archive = Builder::new(encoder);
        archive.append_dir_all("CTRL.app", bundle).unwrap();
        archive.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn stages_and_verifies_archive_without_mutating_canonical_bundle() {
        let temp = tempdir().unwrap();
        let canonical = fake_bundle(temp.path(), "CTRL.app", "old");
        let source_parent = tempdir().unwrap();
        let source = fake_bundle(source_parent.path(), "release.app", "new");
        let bytes = archive_bundle(&source);

        let staged = stage_verified_update(&bytes, &canonical, |bundle| {
            if marker(bundle) == "new" {
                Ok(())
            } else {
                Err("unexpected staged marker".to_string())
            }
        })
        .unwrap();

        assert_eq!(marker(&canonical), "old");
        assert_eq!(marker(&staged.bundle), "new");
        assert_eq!(staged.root.parent(), canonical.parent());
    }

    #[test]
    fn rejected_staged_bundle_leaves_canonical_bundle_untouched() {
        let temp = tempdir().unwrap();
        let canonical = fake_bundle(temp.path(), "CTRL.app", "old");
        let source_parent = tempdir().unwrap();
        let source = fake_bundle(source_parent.path(), "release.app", "untrusted");
        let bytes = archive_bundle(&source);

        let error = stage_verified_update(&bytes, &canonical, |_| {
            Err("release identity mismatch".to_string())
        })
        .err()
        .expect("staging must reject an untrusted bundle");

        assert!(error.contains("release identity mismatch"));
        assert_eq!(marker(&canonical), "old");
        let leftovers = fs::read_dir(temp.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".ctrl-update-")
            })
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn transaction_swap_preserves_old_bundle_until_launch_is_healthy() {
        let temp = tempdir().unwrap();
        let canonical = fake_bundle(temp.path(), "CTRL.app", "old");
        let staging_root = temp.path().join(".ctrl-update-test");
        fs::create_dir(&staging_root).unwrap();
        let staged_bundle = fake_bundle(&staging_root, "CTRL.app", "new");
        let mut staged = StagedUpdate {
            root: staging_root,
            bundle: staged_bundle,
            cleanup_on_drop: true,
        };

        let (journal, transaction) =
            begin_bundle_transaction(&canonical, &mut staged, "2.0.0".to_string(), |bundle| {
                if marker(bundle) == "new" {
                    Ok(())
                } else {
                    Err("new bundle missing".to_string())
                }
            })
            .unwrap();

        assert_eq!(marker(&canonical), "new");
        assert_eq!(marker(&transaction.staged_bundle), "old");
        assert_eq!(
            read_transaction(&journal).unwrap().phase,
            UpdatePhase::Swapped
        );
        cleanup_completed_transaction(&journal, &transaction).unwrap();
    }

    #[test]
    fn stale_rolling_back_journal_reconciles_without_reswapping_candidate() {
        let temp = tempdir().unwrap();
        let canonical = fake_bundle(temp.path(), "CTRL.app", "old");
        let staging_root = temp.path().join(".ctrl-update-test");
        fs::create_dir(&staging_root).unwrap();
        let staged_bundle = fake_bundle(&staging_root, "CTRL.app", "new");
        let mut staged = StagedUpdate {
            root: staging_root,
            bundle: staged_bundle,
            cleanup_on_drop: true,
        };
        let (journal, mut transaction) =
            begin_bundle_transaction(&canonical, &mut staged, "new".to_string(), |_| Ok(()))
                .unwrap();

        transaction.phase = UpdatePhase::RollingBack;
        write_transaction(&journal, &transaction).unwrap();
        assert_eq!(
            transaction_bundle_layout(&transaction, |bundle| Ok(marker(bundle))).unwrap(),
            TransactionBundleLayout::CandidateCanonical
        );

        swap_bundle_paths(&transaction.canonical_bundle, &transaction.staged_bundle).unwrap();
        assert_eq!(marker(&canonical), "old");
        assert_eq!(
            transaction_bundle_layout(&transaction, |bundle| Ok(marker(bundle))).unwrap(),
            TransactionBundleLayout::PreviousCanonical
        );

        cleanup_completed_transaction(&journal, &transaction).unwrap();
        assert_eq!(marker(&canonical), "old");
        assert!(!journal.exists());
    }

    #[test]
    fn failed_post_swap_verification_restores_original_bundle() {
        let temp = tempdir().unwrap();
        let canonical = fake_bundle(temp.path(), "CTRL.app", "old");
        let staging_root = temp.path().join(".ctrl-update-test");
        fs::create_dir(&staging_root).unwrap();
        let staged_bundle = fake_bundle(&staging_root, "CTRL.app", "new");
        let mut staged = StagedUpdate {
            root: staging_root,
            bundle: staged_bundle,
            cleanup_on_drop: true,
        };

        let error = begin_bundle_transaction(&canonical, &mut staged, "2.0.0".to_string(), |_| {
            Err("post-swap verification failed".to_string())
        })
        .unwrap_err();

        assert!(error.contains("previous version was restored"));
        assert_eq!(marker(&canonical), "old");
        assert!(!transaction_journal(&canonical).unwrap().exists());
    }

    #[test]
    fn staged_version_mismatch_does_not_create_a_transaction_or_swap() {
        let temp = tempdir().unwrap();
        let canonical = fake_bundle(temp.path(), "CTRL.app", "old");
        let staging_root = temp.path().join(".ctrl-update-test");
        fs::create_dir(&staging_root).unwrap();
        let staged_bundle = fake_bundle(&staging_root, "CTRL.app", "new");
        let mut staged = StagedUpdate {
            root: staging_root,
            bundle: staged_bundle,
            cleanup_on_drop: true,
        };

        let error = begin_version_bound_transaction(
            &canonical,
            &mut staged,
            "2.0.0".to_string(),
            |_| Ok("1.0.0".to_string()),
            |_| panic!("identity verification must not run after a version mismatch"),
        )
        .unwrap_err();

        assert!(error.contains("version mismatch"));
        assert_eq!(marker(&canonical), "old");
        assert_eq!(marker(&staged.bundle), "new");
        assert!(!transaction_journal(&canonical).unwrap().exists());
    }

    #[test]
    fn candidate_token_requires_the_exact_argv_layout() {
        let exact = vec![
            "ctrl".into(),
            UPDATE_CANDIDATE_FLAG.into(),
            "transaction-42".into(),
        ];
        let wrong = vec![
            "ctrl".into(),
            UPDATE_CANDIDATE_FLAG.into(),
            "transaction-420".into(),
        ];
        let extra = vec![
            "ctrl".into(),
            "unrelated".into(),
            UPDATE_CANDIDATE_FLAG.into(),
            "transaction-42".into(),
        ];

        assert!(os_args_match_exact(
            &exact,
            UPDATE_CANDIDATE_FLAG,
            "transaction-42"
        ));
        assert!(!os_args_match_exact(
            &wrong,
            UPDATE_CANDIDATE_FLAG,
            "transaction-42"
        ));
        assert!(!os_args_match_exact(
            &extra,
            UPDATE_CANDIDATE_FLAG,
            "transaction-42"
        ));
        assert!(command_matches_exact(
            "/Applications/CTRL.app/Contents/MacOS/ctrl --ctrl-update-candidate transaction-42",
            CANONICAL_EXECUTABLE,
            UPDATE_CANDIDATE_FLAG,
            "transaction-42"
        ));
        assert!(!command_matches_exact(
            "/Applications/CTRL.app/Contents/MacOS/ctrl unrelated --ctrl-update-candidate transaction-42",
            CANONICAL_EXECUTABLE,
            UPDATE_CANDIDATE_FLAG,
            "transaction-42"
        ));
    }

    #[test]
    fn persisted_process_identity_rejects_a_reused_pid() {
        let current = current_process_identity().unwrap();
        assert!(same_process_instance(&current));

        let mut reused = current.clone();
        reused.start_microseconds = reused.start_microseconds.wrapping_add(1);
        assert!(!same_process_instance(&reused));
    }

    #[test]
    fn update_operation_guard_rejects_concurrent_acquisition() {
        let first = UpdateOperationGuard::acquire().unwrap();
        assert_eq!(
            UpdateOperationGuard::acquire().unwrap_err(),
            "another app update is already in progress"
        );
        drop(first);
        assert!(UpdateOperationGuard::acquire().is_ok());
    }

    #[test]
    fn staging_directory_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        let canonical = fake_bundle(temp.path(), "CTRL.app", "old");
        let root = create_staging_root(&canonical).unwrap();
        let mode = fs::metadata(&root).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn escaping_symlink_target_is_rejected() {
        let error = validate_link_target(
            Path::new("CTRL.app/Contents/Resources/escape"),
            Path::new("../../../../tmp/owned"),
            std::ffi::OsStr::new("CTRL.app"),
            false,
        )
        .unwrap_err();
        assert!(error.contains("escapes the bundle"));
    }
}
