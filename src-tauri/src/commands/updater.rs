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
//   2. Spawn a detached `/bin/sh` helper that:
//        a. polls until the current process is gone (`kill -0 <pid>`)
//        b. sleeps another 500ms so launchd settles
//        c. `open` the new .app — LSLaunchServices launches a clean new
//           process, the single-instance plugin sees no live instance and
//           lets it through.
//   3. Cleanly shut down our own Pi brain child + exit immediately. By
//      the time the helper's `open` fires, this PID is gone, no race.

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

        let pid = std::process::id();
        let bundle_str = root.to_string_lossy().to_string();
        // The shell guards a 30s ceiling so a wedged process can't keep
        // the helper alive indefinitely. The `open` call relaunches the
        // app cleanly via LaunchServices (respects codesign + AX state).
        let script = format!(
            "i=0; while kill -0 {pid} 2>/dev/null && [ $i -lt 150 ]; do sleep 0.2; i=$((i+1)); done; sleep 0.5; /usr/bin/open '{bundle_str}'"
        );

        Command::new("/bin/sh")
            .arg("-c")
            .arg(&script)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn relaunch helper failed: {e}"))?;

        // ADR-002 substrate §1 v19 (2026-06-09): no kernel-side brain
        // supervisor to shut down. Agent subprocesses launched via
        // commands::agents will exit when the parent process dies.

        // Exit from a background thread so this command's response can
        // serialize back to the PWA before the process dies. Using
        // std::process::exit bypasses Tauri's ExitRequested prevent_exit
        // handler — that's intentional; auto-update is the canonical
        // "actually exit now" path.
        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(150));
            std::process::exit(0);
        });

        Ok(())
    }
}
