// Tauri build hook.
//
// Pre-mac/c this also drove UniFFI scaffolding from `src/ctrl.udl` and
// cbindgen's C header for the WinUI 3 P/Invoke surface (`win/CTRL/Bindings/
// ctrl_native.h`). ADR-002 retired both:
//   • PWA reaches the kernel via Tauri 2 `invoke()` handlers in
//     `commands::*` — no UniFFI bindings needed.
//   • The W3 native UI was deleted in H-2026-05-13-001 sub-PR e — no C
//     header consumer remains.
//
// Only `tauri_build::build()` is left here so the next mac/c-style refactor
// doesn't have to rediscover this file's contract.

fn main() {
    tauri_build::build();
    inject_build_metadata();
}

/// Inject build-time metadata as compile-time env vars so the running
/// shell can show users which build they're staring at. Per bao 2026-05-23:
/// "你没有版本号 不知道是新的还是旧的". Two values:
///   CTRL_BUILD_SHA   — short git SHA of HEAD when this build ran
///   CTRL_BUILD_TIME  — RFC-3339 UTC timestamp of when this build ran
/// Both fall back to "unknown" when the tools aren't available (rare —
/// build hosts have git + date).
fn inject_build_metadata() {
    let sha = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let time = std::process::Command::new("date")
        .args(["-u", "+%Y-%m-%dT%H:%M:%SZ"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    println!("cargo:rustc-env=CTRL_BUILD_SHA={sha}");
    println!("cargo:rustc-env=CTRL_BUILD_TIME={time}");
    // Re-run if .git/HEAD changes (commit / branch switch) so the SHA
    // stays in sync without a full rebuild.
    println!("cargo:rerun-if-changed=../.git/HEAD");
}
