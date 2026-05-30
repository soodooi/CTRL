// Builtin keycaps bootstrap.
//
// CTRL ships a small set of "builtin" keycaps under
// `packages/ctrl-keycaps/builtin/<id>/` (dev) or
// `<bundle>/Contents/Resources/keycaps/<id>/` (installed app). On every
// launch we walk that source set; for each builtin id that isn't already
// present at `~/.ctrl/keycaps/<id>/`, we copy the manifest + assets in.
//
// Why on every launch (not just first run): users can permanently delete a
// builtin folder by accident; the next launch should heal that. Existing
// user-modified files are NEVER overwritten — only missing files are
// written, never replaced. The persona override in vault is a separate
// resolver path and is not touched here.
//
// Idempotency rule: this code is safe to run on every boot. If the user
// already has every builtin installed and untouched, this is a no-op
// (read-only stat).
//
// Pattern follows `shell/brain_supervisor.rs::find_pi_plugin_dir`: walk up
// from `current_exe` / `current_dir` looking for the dev directory; fall
// back to the bundle `Resources/` path on installed `.app` builds.

use std::fs;
use std::path::{Path, PathBuf};

/// Subdirectory under the bundle / repo that holds the builtin source set.
/// Each subfolder is `<bundle>/<BUILTIN_SRC_RELATIVE>/<id>/manifest.json`.
const BUILTIN_SRC_RELATIVE: &str = "packages/ctrl-keycaps/builtin";

/// Subpath inside the macOS `.app` bundle's Contents/Resources/ where the
/// builtin keycap source lands (per tauri.conf.json bundle.resources).
const BUNDLE_RESOURCE_SUBPATH: &str = "keycaps/builtin";

/// Locate the builtin source directory.
///
/// Priority:
///   1. `CTRL_BUILTIN_KEYCAPS_DIR` env var (testing / packaging override)
///   2. Walk up from `current_exe` looking for `packages/ctrl-keycaps/builtin`
///      (dev mode + `tauri dev` + run-in-repo)
///   3. Walk up from `current_dir` (same purpose; helps when exec path is odd)
///   4. Installed `.app` bundle's `Contents/Resources/keycaps/builtin/` —
///      derived from `current_exe` by stripping `MacOS/<binary>` and
///      appending `Resources/<BUNDLE_RESOURCE_SUBPATH>`. tauri.conf.json
///      bundle.resources includes the directory so this path exists at
///      runtime on installed .app builds.
fn find_source_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("CTRL_BUILTIN_KEYCAPS_DIR") {
        // ECC review H8: log loudly when the env override is honored so a
        // compromised env shows up in trace. This bypass exists for tests
        // + packaging; it should never appear in normal user logs.
        let p = PathBuf::from(dir);
        if p.is_dir() {
            tracing::warn!(
                path = %p.display(),
                "BuiltinKeycaps: CTRL_BUILTIN_KEYCAPS_DIR override honored — \
                 this should only happen during tests / packaging"
            );
            return Some(p);
        }
    }

    // (1) macOS bundle Resources — preferred for installed `.app` builds.
    // Trust path: codesigned bundle; we still don't follow symlinks during
    // the actual copy (see copy_tree_inner). Tauri 2 also exposes
    // app.path().resource_dir() but ShellLifecycle::boot doesn't have an
    // AppHandle in this scope — derive the path geometrically.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(macos_dir) = exe.parent() {
            if macos_dir.file_name().is_some_and(|n| n == "MacOS") {
                if let Some(contents_dir) = macos_dir.parent() {
                    let candidate =
                        contents_dir.join("Resources").join(BUNDLE_RESOURCE_SUBPATH);
                    if candidate.is_dir() {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    // (2) Repo walk-up — DEBUG BUILDS ONLY. ECC review H8: in release builds
    // a malicious CWD (`/tmp/attacker/packages/ctrl-keycaps/builtin/...`)
    // would pass this walk and seed attacker-controlled keycaps. Release
    // builds rely on the bundle path above; dev / tauri-dev / cargo-test
    // use this walk.
    #[cfg(debug_assertions)]
    {
        let mut starts: Vec<PathBuf> = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            starts.push(exe);
        }
        if let Ok(cwd) = std::env::current_dir() {
            starts.push(cwd);
        }
        for start in starts {
            let mut cur: &Path = start.as_path();
            loop {
                let candidate = cur.join(BUILTIN_SRC_RELATIVE);
                if candidate.is_dir() {
                    return Some(candidate);
                }
                match cur.parent() {
                    Some(parent) => cur = parent,
                    None => break,
                }
            }
        }
    }

    None
}

/// Resolve the on-disk install root — `~/.ctrl/keycaps/`.
fn install_root() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok().filter(|h| !h.is_empty())?;
    Some(PathBuf::from(home).join(".ctrl").join("keycaps"))
}

/// Max recursion depth for copy_tree — bounds keycap layout. ECC review C1
/// flagged that symlink cycles in source would stack-overflow without this.
const COPY_MAX_DEPTH: u8 = 8;

/// Recursively copy `src` into `dst`. Existing files are NOT overwritten —
/// user customizations are preserved.
///
/// Security hardening (ECC review C1, 2026-05-30):
/// - **Rejects symlinks** in both src and dst — `entry.file_type()` returns
///   the link's own type (NOT followed). A symlink in src is skipped + logged.
///   A symlink already at dst path is treated as "already exists" so
///   `fs::copy` cannot follow it to write attacker-controlled bytes
///   through the link to wherever it points.
/// - **Rejects `..` / `/` / `\\` in filenames** (defense-in-depth even
///   though `entry.file_name()` shouldn't contain them on any sane FS).
/// - **Uses `symlink_metadata`** to gate the dst-exists check so dangling
///   symlinks at dst correctly count as "exists" (the prior `dst.exists()`
///   returns `false` for broken symlinks, leading to TOCTOU / overwrite).
/// - **`create_new(true)` open** instead of `fs::copy` — atomic exists-check
///   + write that closes the TOCTOU window between `symlink_metadata` and
///   `fs::copy`. Returns `AlreadyExists` if the path appeared mid-loop;
///   we treat that as "another process or the user got here first" and
///   skip without erroring.
/// - **Depth-bounded** via `COPY_MAX_DEPTH` to prevent symlink-cycle stack
///   overflow even if a symlink slipped past the filter on some platform.
fn copy_tree_no_overwrite(src: &Path, dst: &Path) -> std::io::Result<usize> {
    copy_tree_inner(src, dst, 0)
}

fn copy_tree_inner(src: &Path, dst: &Path, depth: u8) -> std::io::Result<usize> {
    use std::io::ErrorKind;

    if depth > COPY_MAX_DEPTH {
        return Err(std::io::Error::new(
            ErrorKind::Other,
            format!("BuiltinKeycaps: copy depth exceeds {COPY_MAX_DEPTH} at {dst:?}"),
        ));
    }

    // Use symlink_metadata for dst so a dangling/live symlink at dst is
    // detected (regular `exists()` returns false for dangling symlinks).
    let dst_already = fs::symlink_metadata(dst).is_ok();
    if !dst_already {
        fs::create_dir_all(dst)?;
    }

    let mut written: usize = 0;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        // Defense-in-depth: reject path-special filename components even
        // though OS readdir shouldn't yield them.
        if name_str == "." || name_str == ".." || name_str.contains('/') || name_str.contains('\\') {
            tracing::warn!(
                ?src_path,
                name = %name_str,
                "BuiltinKeycaps: refusing entry with path-special filename"
            );
            continue;
        }

        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            tracing::warn!(
                ?src_path,
                "BuiltinKeycaps: refusing symlink in source (security)"
            );
            continue;
        }

        let dst_path = dst.join(&file_name);

        if file_type.is_dir() {
            written += copy_tree_inner(&src_path, &dst_path, depth + 1)?;
        } else if file_type.is_file() {
            // Refuse to copy onto a symlink at dst (would write through
            // the link to wherever it points).
            match fs::symlink_metadata(&dst_path) {
                Ok(meta) if meta.file_type().is_symlink() => {
                    tracing::warn!(
                        ?dst_path,
                        "BuiltinKeycaps: refusing to copy onto symlink at destination"
                    );
                    continue;
                }
                Ok(_) => continue, // file already exists (regular file or dir) — preserve user copy
                Err(_) => { /* nothing at dst — fall through to atomic create */ }
            }
            // Atomic create-only open closes the symlink_metadata → fs::copy
            // TOCTOU window. AlreadyExists = lost the race; treat as "user
            // file present" and skip.
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&dst_path)
            {
                Ok(mut out) => {
                    let mut input = fs::File::open(&src_path)?;
                    std::io::copy(&mut input, &mut out)?;
                    written += 1;
                }
                Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e),
            }
        }
        // Skip everything else (block devices, fifos, etc.) — keycaps are
        // markdown + JSON + SVG; nothing else belongs here.
    }
    Ok(written)
}

/// Walk the builtin source directory; for each `<id>` subfolder, ensure
/// `~/.ctrl/keycaps/<id>/` exists and contains the bundled `manifest.json`
/// + `assets/`. Existing user files are preserved.
///
/// Idempotent; safe to call on every boot. Errors don't propagate — a
/// failed builtin seed shouldn't crash the shell. They surface in trace
/// logs instead.
pub fn ensure_builtins_installed() {
    let Some(src_root) = find_source_dir() else {
        tracing::warn!(
            "BuiltinKeycaps: source dir not found (looked for {}); skipping bootstrap. \
             Set CTRL_BUILTIN_KEYCAPS_DIR to override or run from the repo so dev resolution works.",
            BUILTIN_SRC_RELATIVE
        );
        return;
    };
    let Some(dst_root) = install_root() else {
        tracing::warn!("BuiltinKeycaps: HOME not set; can't resolve ~/.ctrl/keycaps");
        return;
    };
    if let Err(e) = fs::create_dir_all(&dst_root) {
        tracing::error!(error = %e, dst = %dst_root.display(), "BuiltinKeycaps: create install root failed");
        return;
    }

    let entries = match fs::read_dir(&src_root) {
        Ok(e) => e,
        Err(e) => {
            tracing::error!(error = %e, src = %src_root.display(), "BuiltinKeycaps: read source dir failed");
            return;
        }
    };

    let mut seeded: usize = 0;
    let mut copied_files: usize = 0;
    for entry in entries.flatten() {
        let src_dir = entry.path();
        if !src_dir.is_dir() {
            continue;
        }
        let id = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue,
        };
        // Skip non-keycap subfolders (e.g. a top-level README without a manifest).
        if !src_dir.join("manifest.json").is_file() {
            continue;
        }
        let dst_dir = dst_root.join(&id);
        let pre_existed = dst_dir.is_dir();
        match copy_tree_no_overwrite(&src_dir, &dst_dir) {
            Ok(n) => {
                if n > 0 {
                    tracing::info!(
                        keycap = %id,
                        files_copied = n,
                        pre_existed,
                        "BuiltinKeycaps: seeded"
                    );
                    seeded += 1;
                    copied_files += n;
                }
            }
            Err(e) => {
                tracing::error!(
                    error = %e,
                    keycap = %id,
                    src = %src_dir.display(),
                    dst = %dst_dir.display(),
                    "BuiltinKeycaps: seed failed"
                );
            }
        }
    }

    tracing::info!(
        seeded,
        copied_files,
        src = %src_root.display(),
        dst = %dst_root.display(),
        "BuiltinKeycaps: bootstrap complete"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn copy_tree_creates_dst_when_missing() {
        let src = TempDir::new().unwrap();
        fs::write(src.path().join("a.txt"), "hi").unwrap();
        fs::create_dir(src.path().join("sub")).unwrap();
        fs::write(src.path().join("sub/b.txt"), "yo").unwrap();
        let dst = TempDir::new().unwrap().path().join("nested/new");
        let n = copy_tree_no_overwrite(src.path(), &dst).unwrap();
        assert_eq!(n, 2);
        assert!(dst.join("a.txt").is_file());
        assert!(dst.join("sub/b.txt").is_file());
    }

    #[test]
    fn copy_tree_preserves_existing_files() {
        let src = TempDir::new().unwrap();
        fs::write(src.path().join("persona.md"), "BUNDLED").unwrap();
        let dst_holder = TempDir::new().unwrap();
        let dst = dst_holder.path().join("keycap");
        fs::create_dir(&dst).unwrap();
        fs::write(dst.join("persona.md"), "USER_EDIT").unwrap();
        let n = copy_tree_no_overwrite(src.path(), &dst).unwrap();
        assert_eq!(n, 0, "no files should be copied when destination already has them");
        let contents = fs::read_to_string(dst.join("persona.md")).unwrap();
        assert_eq!(contents, "USER_EDIT", "user edits must be preserved");
    }
}
