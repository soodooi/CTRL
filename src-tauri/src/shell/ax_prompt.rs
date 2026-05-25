// macOS Accessibility-permission prompt helper.
//
// CGEventTap (kernel hotkey detector, `hotkey.rs::mac_impl`) silently
// returns failure when the running app lacks the Accessibility privilege.
// The result is "Ctrl does nothing" — bao's actual symptom. macOS will
// show its standard permission dialog if the app calls
// `AXIsProcessTrustedWithOptions` with `kAXTrustedCheckOptionPrompt:
// kCFBooleanTrue`. We call that early in `ShellLifecycle::boot` so the
// dialog appears on first launch before the user wonders why Ctrl is
// inert.
//
// Per bao 2026-05-23: "你应该自动弹出 不要让用户猜". This module is the
// auto-prompt path.

#[cfg(target_os = "macos")]
mod mac_impl {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::{CFString, CFStringRef};

    extern "C" {
        fn AXIsProcessTrustedWithOptions(
            options: core_foundation::base::CFTypeRef,
        ) -> bool;

        /// CFString constant exported by ApplicationServices.framework.
        /// Linked via the same framework chain core-graphics already pulls
        /// in (see Cargo.toml).
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    /// Returns `true` when the app already has the Accessibility
    /// privilege; otherwise asks macOS to surface its standard "open
    /// Privacy & Security → Accessibility" dialog and returns `false`.
    /// Safe to call repeatedly; macOS coalesces / cooldowns the dialog.
    pub fn ensure_accessibility_trusted_with_prompt() -> bool {
        unsafe {
            let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let value = CFBoolean::true_value();
            let dict = CFDictionary::from_CFType_pairs(&[(key, value)]);
            AXIsProcessTrustedWithOptions(dict.as_CFTypeRef())
        }
    }
}

#[cfg(target_os = "macos")]
pub use mac_impl::ensure_accessibility_trusted_with_prompt;

/// No-op on platforms other than macOS — Windows / Linux hotkey paths
/// don't need an Accessibility prompt. Always reports "trusted" so the
/// caller doesn't gate non-macOS behavior on a prompt that doesn't exist.
#[cfg(not(target_os = "macos"))]
pub fn ensure_accessibility_trusted_with_prompt() -> bool {
    true
}

/// macOS only: open System Settings → Privacy & Security → Accessibility
/// directly. The auto-prompt from `AXIsProcessTrustedWithOptions` is
/// dismissable + cooldown'd; when the user reports "Ctrl 没反应" it's
/// usually because they missed the prompt and the hotkey runloop never
/// armed. Best-effort, non-blocking.
pub fn open_accessibility_settings() {
    #[cfg(target_os = "macos")]
    {
        let result = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
        match result {
            Ok(_) => tracing::info!("opened System Settings → Accessibility"),
            Err(err) => tracing::warn!(?err, "failed to open Accessibility settings"),
        }
    }
}

// ─── First-launch flag ────────────────────────────────────────────────
//
// `~/.ctrl/state/first-launch-done` is written after the first successful
// boot. We use it to:
//   • Skip the prewarm-cloak path on first launch — the user sees the
//     window directly, not an invisible app waiting for a hotkey they
//     can't trigger yet.
//   • Surface the install/welcome flow once.
//
// Subsequent boots prewarm + cloak per the usual ambient-launcher UX.

use std::path::PathBuf;

fn first_launch_flag_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join(".ctrl")
            .join("state")
            .join("first-launch-done"),
    )
}

/// `true` when this is the first boot of CTRL on this user account.
pub fn is_first_launch() -> bool {
    match first_launch_flag_path() {
        Some(p) => !p.exists(),
        // HOME unset (sandboxed CI / cold env) — treat as first launch so
        // we don't pessimistically cloak a window the user can't recover.
        None => true,
    }
}

/// Write the first-launch flag. Best-effort; logged on failure.
pub fn mark_first_launch_done() {
    let Some(path) = first_launch_flag_path() else {
        tracing::warn!("first_launch: HOME unset; skipping flag write");
        return;
    };
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::warn!(error = %e, ?parent, "first_launch: create state dir failed");
            return;
        }
    }
    if let Err(e) = std::fs::write(&path, b"1\n") {
        tracing::warn!(error = %e, ?path, "first_launch: flag write failed");
    } else {
        tracing::info!(?path, "first_launch flag written");
    }
}
