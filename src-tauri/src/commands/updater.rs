// Safe relaunch for the Tauri auto-updater on macOS.
//
// The default Tauri 2 flow — `downloadAndInstall()` then `relaunch()` —
// races on macOS. `downloadAndInstall` replaces /Applications/CTRL.app in
// place (cp -R style). `relaunch()` then spawns the new process while the
// old one is still exiting; tauri-plugin-single-instance sees the old
// process alive, intercepts the new launch, forwards it back to the old
// (dying) instance, and the new instance never actually starts. Result:
// window vanishes, bundle is sometimes left half-written, app does not
// come back. (bao 2026-05-30: "install 时窗口已经关闭 无法升级".)
//
// Fix (the Chrome / Cursor / Linear pattern):
//   1. Verify the new bundle is intact (Info.plist exists, CFBundleVersion
//      readable) — abort if the install left a broken .app.
//   2. On a detached background thread (the "relaunch helper"):
//        a. sleep briefly so this command's response flushes to the PWA
//        b. cleanly shut down our own Pi brain child
//        c. sleep a settle window so launchd quiesces
//        d. spawn `/usr/bin/open <bundle>` DIRECTLY (no `/bin/sh -c`, the
//           bundle path is a single argv element so a path containing
//           quotes/spaces cannot inject — OWASP A03 fix, bao 2026-06-08)
//        e. exit the process — LaunchServices then launches a clean new
//           instance and the single-instance plugin sees no live process.
//
// Previously this built a `/bin/sh -c` script with the bundle path
// single-quoted via `format!`, which a path containing `'` could escape
// to inject arbitrary shell. The shell is gone entirely; the path is never
// interpolated into a command string.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

/// Best-effort current bundle path. `current_exe` returns
/// `<bundle>/Contents/MacOS/ctrl`; the bundle root is three parents up.
fn bundle_root() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent()?.parent()?.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("/Applications/CTRL.app"))
}

/// Cheap integrity probe: a real .app bundle must have
/// `Contents/Info.plist` and an executable at `Contents/MacOS/ctrl`. If
/// the updater install half-failed (the smoking gun bao saw — empty
/// /Applications/CTRL.app), this returns Err and we DO NOT exit, so the
/// user keeps a running process to recover from.
fn verify_bundle(root: &Path) -> Result<(), String> {
    let info_plist = root.join("Contents").join("Info.plist");
    let executable = root.join("Contents").join("MacOS").join("ctrl");
    if !info_plist.is_file() {
        return Err(format!(
            "Info.plist missing at {} — auto-updater install was incomplete",
            info_plist.display()
        ));
    }
    if !executable.is_file() {
        return Err(format!(
            "executable missing at {} — auto-updater install was incomplete",
            executable.display()
        ));
    }
    Ok(())
}

/// Called from the PWA after `downloadAndInstall()` completes. Verifies
/// the new bundle, spawns the detached relaunch helper, then exits the
/// current process.
///
/// Returns `Ok(())` synchronously (before exit) so the JS caller sees a
/// clean response; the actual exit happens from a background thread ~100ms
/// later so the response can flush.
#[tauri::command]
pub fn safe_relaunch_after_update() -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        // Windows / Linux use the standard relaunch path — Tauri's
        // updater is reliable there, no race.
        return Err("safe_relaunch_after_update is macOS-only".into());
    }

    #[cfg(target_os = "macos")]
    {
        let root = bundle_root();
        verify_bundle(&root)?;

        // Run the relaunch sequence on a detached background thread so this
        // command's response can serialize back to the PWA before the
        // process dies. std::process::exit bypasses Tauri's ExitRequested
        // prevent_exit handler — intentional; auto-update is the canonical
        // "actually exit now" path.
        std::thread::spawn(move || {
            // a. Let the command response flush to the PWA.
            std::thread::sleep(Duration::from_millis(150));

            // b. Clean up the Pi brain child so port 17874 isn't held when
            //    the new instance comes up. Mirrors the explicit-quit path
            //    in lib.rs ExitRequested handler.
            crate::shell::BrainSupervisor::shutdown();

            // c. Settle window so launchd quiesces before relaunch.
            std::thread::sleep(Duration::from_millis(500));

            // d. Relaunch via LaunchServices. The bundle path is passed as a
            //    single argv element — no shell, no string interpolation, so
            //    a path with quotes/spaces cannot inject. `open` returns once
            //    LaunchServices has accepted the request.
            if let Err(e) = Command::new("/usr/bin/open")
                .arg(&root)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                tracing::error!(error = %e, "relaunch: /usr/bin/open spawn failed");
            }

            // e. Exit so the single-instance plugin sees no live process.
            std::process::exit(0);
        });

        Ok(())
    }
}
