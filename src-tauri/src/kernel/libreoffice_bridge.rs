//! Secure resolution of the private LibreOffice extension bridge.
//!
//! The rendezvous carries process-bound loopback metadata only. The bearer
//! credential remains in the OS keychain and process memory.
//! (ADR-010 communication § trust-domains v13; § transports v13)

use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const BRIDGE_URL_ENV: &str = "CTRL_LIBREOFFICE_BRIDGE_URL";
pub const BRIDGE_TOKEN_ENV: &str = "CTRL_LIBREOFFICE_BRIDGE_TOKEN";
const KEYCHAIN_ACCOUNT: &str = "libreoffice-bridge";
const RENDEZVOUS_RELATIVE_PATH: &str = ".ctrl/run/libreoffice-bridge.json";
const PROTOCOL_VERSION: &str = "1";
const MAX_RENDEZVOUS_BYTES: u64 = 4 * 1024;
#[cfg(target_os = "macos")]
const LIBREOFFICE_BUNDLE: &str = "/Applications/LibreOffice.app";
#[cfg(target_os = "macos")]
const LIBREOFFICE_EXECUTABLE: &str = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
#[cfg(target_os = "macos")]
const LIBREOFFICE_BUNDLE_ID: &str = "org.libreoffice.script";
#[cfg(target_os = "macos")]
const LIBREOFFICE_TEAM_ID: &str = "7P5S3ZLCN7";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Rendezvous {
    schema_version: u32,
    protocol_version: String,
    pid: u32,
    port: u16,
}

const TRUSTED_ADAPTER_SOURCE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../packages/ctrl-mcps/optional/ctrl-libreoffice/server.mjs"
));

/// Grant the keychain-backed bridge environment only to the exact bundled
/// adapter bytes and the canonical Node interpreter resolved by CTRL. The
/// decision is kernel-owned and is not serialized, so a manifest id, arbitrary
/// executable named `node`, or saved descriptor cannot claim this privilege.
/// (ADR-010 communication § transports v13)
pub fn is_trusted_adapter(pack_dir: &Path, command: &str, args: &[String]) -> bool {
    let canonical_node = crate::kernel::provider::path_resolver::resolve_binary_path("node")
        .and_then(|path| std::fs::canonicalize(path).ok());
    let candidate_node = std::fs::canonicalize(command).ok();
    if pack_dir.file_name().and_then(|value| value.to_str()) != Some("ctrl-libreoffice")
        || canonical_node.is_none()
        || candidate_node != canonical_node
        || args.len() != 1
    {
        return false;
    }
    let script = pack_dir.join("server.mjs");
    if Path::new(&args[0]) != script {
        return false;
    }
    std::fs::read(script)
        .map(|bytes| bytes == TRUSTED_ADAPTER_SOURCE)
        .unwrap_or(false)
}

/// Execute trusted adapter bytes embedded in CTRL rather than reopening the
/// mutable installed script after validation. The explicit call is needed
/// because the module's normal file-entry guard does not fire under `--eval`.
pub fn embedded_adapter_args() -> Vec<String> {
    let source = std::str::from_utf8(TRUSTED_ADAPTER_SOURCE)
        .expect("bundled LibreOffice adapter source must be UTF-8");
    vec![
        "--input-type=module".into(),
        "--eval".into(),
        format!("{source}\nrunStdioServer();"),
    ]
}

/// Resolve bridge values at spawn without storing them in a descriptor or
/// inheriting them from CTRL's parent environment. Process identity is checked
/// before keychain access and again immediately before the token is returned.
/// (ADR-010 communication § trust-domains v13)
pub fn resolve_spawn_environment() -> Result<BTreeMap<String, String>, String> {
    #[cfg(target_os = "macos")]
    {
        resolve_macos_spawn_environment()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("LibreOffice Companion secure binding is unavailable on this operating system".into())
    }
}

#[cfg(target_os = "macos")]
fn resolve_macos_spawn_environment() -> Result<BTreeMap<String, String>, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "LibreOffice bridge home directory is unavailable".to_string())?;
    let path = home.join(RENDEZVOUS_RELATIVE_PATH);
    let (rendezvous, validated_identity) = read_validated_rendezvous(&path)?;

    // Do not release or create the credential until the rendezvous has been
    // bound to the canonical, signed LibreOffice process. A second kernel
    // identity read closes the PID-reuse window during keychain access.
    // (ADR-004 cap §1 v13; ADR-010 communication § trust-domains v13)
    let token = ensure_bridge_credential()?;
    if process_identity(rendezvous.pid).as_ref() != Some(&validated_identity) {
        return Err("LibreOffice bridge process changed during validation".to_string());
    }

    let mut environment = BTreeMap::new();
    environment.insert(
        BRIDGE_URL_ENV.to_string(),
        format!("http://127.0.0.1:{}/selection", rendezvous.port),
    );
    environment.insert(BRIDGE_TOKEN_ENV.to_string(), token);
    Ok(environment)
}

#[cfg(target_os = "macos")]
fn ensure_bridge_credential() -> Result<String, String> {
    if let Some(existing) = crate::shell::KeychainStore::get(KEYCHAIN_ACCOUNT)
        .map_err(|_| "LibreOffice bridge credential is unavailable".to_string())?
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(existing);
    }
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    crate::shell::KeychainStore::store(KEYCHAIN_ACCOUNT, &token)
        .map_err(|_| "LibreOffice bridge credential could not be created".to_string())?;
    Ok(token)
}

#[cfg(target_os = "macos")]
fn read_validated_rendezvous(path: &Path) -> Result<(Rendezvous, ProcessIdentity), String> {
    use std::os::unix::fs::MetadataExt;

    let parent = path
        .parent()
        .ok_or_else(|| "LibreOffice bridge rendezvous path is invalid".to_string())?;
    let parent_metadata = std::fs::symlink_metadata(parent)
        .map_err(|_| "LibreOffice bridge rendezvous is unavailable".to_string())?;
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| "LibreOffice bridge rendezvous is unavailable".to_string())?;
    let current_uid = unsafe { libc::geteuid() };
    if parent_metadata.file_type().is_symlink()
        || !parent_metadata.is_dir()
        || parent_metadata.uid() != current_uid
        || parent_metadata.mode() & 0o077 != 0
        || metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.uid() != current_uid
        || metadata.mode() & 0o077 != 0
        || metadata.len() > MAX_RENDEZVOUS_BYTES
    {
        return Err("LibreOffice bridge rendezvous is not owner-only".to_string());
    }
    let bytes = std::fs::read(path)
        .map_err(|_| "LibreOffice bridge rendezvous could not be read".to_string())?;
    let rendezvous: Rendezvous = serde_json::from_slice(&bytes)
        .map_err(|_| "LibreOffice bridge rendezvous is invalid".to_string())?;
    if rendezvous.schema_version != 1
        || rendezvous.protocol_version != PROTOCOL_VERSION
        || rendezvous.port == 0
    {
        return Err("LibreOffice bridge rendezvous version is unsupported".to_string());
    }
    let identity = validate_libreoffice_process(&rendezvous, &metadata)?;
    Ok((rendezvous, identity))
}

#[cfg(target_os = "macos")]
fn validate_libreoffice_process(
    rendezvous: &Rendezvous,
    metadata: &std::fs::Metadata,
) -> Result<ProcessIdentity, String> {
    use std::os::unix::fs::MetadataExt;

    let identity = process_identity(rendezvous.pid)
        .ok_or_else(|| "LibreOffice bridge process is unavailable".to_string())?;
    let current_uid = unsafe { libc::geteuid() };
    let expected_executable = std::fs::canonicalize(LIBREOFFICE_EXECUTABLE)
        .map_err(|_| "LibreOffice application identity is unavailable".to_string())?;
    let actual_executable = std::fs::canonicalize(&identity.executable)
        .map_err(|_| "LibreOffice bridge process identity is invalid".to_string())?;
    if !identity_matches_expected(&identity, current_uid, &expected_executable)
        || actual_executable != expected_executable
    {
        return Err("LibreOffice bridge process identity is invalid".to_string());
    }
    verify_libreoffice_signature()?;

    let file_micros = metadata
        .mtime()
        .saturating_mul(1_000_000)
        .saturating_add(metadata.mtime_nsec() / 1_000);
    let process_micros = i64::try_from(identity.start_seconds)
        .unwrap_or(i64::MAX)
        .saturating_mul(1_000_000)
        .saturating_add(i64::try_from(identity.start_microseconds).unwrap_or(i64::MAX));
    if file_micros.saturating_add(1_000_000) < process_micros {
        return Err("LibreOffice bridge rendezvous belongs to a stale process".to_string());
    }
    Ok(identity)
}

#[cfg(target_os = "macos")]
fn identity_matches_expected(
    identity: &ProcessIdentity,
    current_uid: libc::uid_t,
    expected_executable: &Path,
) -> bool {
    identity.uid == current_uid && identity.executable == expected_executable
}

#[cfg(target_os = "macos")]
fn verify_libreoffice_signature() -> Result<(), String> {
    let info_plist = Path::new(LIBREOFFICE_BUNDLE).join("Contents/Info.plist");
    let plist = std::process::Command::new("/usr/bin/plutil")
        .args(["-extract", "CFBundleIdentifier", "raw", "-o", "-"])
        .arg(&info_plist)
        .output()
        .map_err(|_| "LibreOffice bundle identity could not be verified".to_string())?;
    if !plist.status.success()
        || String::from_utf8_lossy(&plist.stdout).trim() != LIBREOFFICE_BUNDLE_ID
    {
        return Err("LibreOffice bundle identity is invalid".to_string());
    }

    // Verify the executable's signed code pages and TDF designated identity.
    // LibreOffice permits user extensions, so resource verification is ignored;
    // executable integrity, bundle id, Apple trust anchor, and team id are not.
    // (ADR-010 communication § trust-domains v13)
    let requirement = format!(
        "=identifier \"{LIBREOFFICE_BUNDLE_ID}\" and anchor apple generic and certificate leaf[subject.OU] = \"{LIBREOFFICE_TEAM_ID}\""
    );
    let status = std::process::Command::new("/usr/bin/codesign")
        .args([
            "--verify",
            "--strict",
            "--ignore-resources",
            "-R",
            requirement.as_str(),
            LIBREOFFICE_EXECUTABLE,
        ])
        .status()
        .map_err(|_| "LibreOffice code signature could not be verified".to_string())?;
    if !status.success() {
        return Err("LibreOffice code signature is invalid".to_string());
    }
    Ok(())
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
#[derive(Debug, Clone, PartialEq, Eq)]
struct ProcessIdentity {
    uid: libc::uid_t,
    start_seconds: u64,
    start_microseconds: u64,
    executable: PathBuf,
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
fn process_identity(pid: u32) -> Option<ProcessIdentity> {
    use std::os::unix::ffi::OsStringExt;

    const PROC_PIDTBSDINFO: libc::c_int = 3;
    const PROC_PIDPATH_BUFFER_SIZE: usize = 4096;
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
        uid: info.uid,
        start_seconds: info.start_seconds,
        start_microseconds: info.start_microseconds,
        executable: PathBuf::from(std::ffi::OsString::from_vec(path)),
    })
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn trusted_adapter_requires_exact_bundled_bytes_and_launch_shape() {
        let root = tempfile::TempDir::new().unwrap();
        let pack = root.path().join("ctrl-libreoffice");
        std::fs::create_dir(&pack).unwrap();
        let script = pack.join("server.mjs");
        std::fs::write(&script, TRUSTED_ADAPTER_SOURCE).unwrap();
        let args = vec![script.to_string_lossy().into_owned()];
        let node = crate::kernel::provider::path_resolver::resolve_binary_path("node").unwrap();

        assert!(is_trusted_adapter(&pack, node.to_str().unwrap(), &args));
        let fake_dir = root.path().join("fake");
        std::fs::create_dir(&fake_dir).unwrap();
        let fake_node = fake_dir.join("node");
        std::fs::write(&fake_node, b"not node").unwrap();
        assert!(!is_trusted_adapter(
            &pack,
            fake_node.to_str().unwrap(),
            &args
        ));

        let embedded = embedded_adapter_args();
        assert_eq!(embedded[0], "--input-type=module");
        assert_eq!(embedded[1], "--eval");
        assert!(embedded[2].ends_with("runStdioServer();"));

        std::fs::write(&script, b"modified adapter").unwrap();
        assert!(!is_trusted_adapter(&pack, node.to_str().unwrap(), &args));
    }

    #[test]
    fn process_identity_rejects_suffix_forgery_and_wrong_uid() {
        let expected = Path::new(LIBREOFFICE_EXECUTABLE);
        let uid = unsafe { libc::geteuid() };
        let forged = ProcessIdentity {
            uid,
            start_seconds: 1,
            start_microseconds: 2,
            executable: PathBuf::from("/tmp/LibreOffice.app/Contents/MacOS/soffice"),
        };
        assert!(!identity_matches_expected(&forged, uid, expected));

        let wrong_uid = ProcessIdentity {
            uid: uid.saturating_add(1),
            executable: expected.to_path_buf(),
            ..forged
        };
        assert!(!identity_matches_expected(&wrong_uid, uid, expected));
    }

    #[test]
    fn process_identity_equality_binds_start_timestamp_and_path() {
        let identity = ProcessIdentity {
            uid: unsafe { libc::geteuid() },
            start_seconds: 10,
            start_microseconds: 20,
            executable: PathBuf::from(LIBREOFFICE_EXECUTABLE),
        };
        let mut reused_pid = identity.clone();
        reused_pid.start_microseconds += 1;
        assert_ne!(identity, reused_pid);
    }
}
