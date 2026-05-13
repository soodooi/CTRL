// Global hotkey controller.
//
// Two layers:
//
//   1. Lone-modifier `Ctrl` single-tap detector — ports W3's
//      `win/CTRL/Services/HotkeyService.cs` state machine to Rust.
//      tauri-plugin-global-shortcut (like Win32 RegisterHotKey before it)
//      rejects bare modifier keys, so we install a low-level keyboard hook
//      and run the detection state machine ourselves.
//
//   2. Configurable user-defined fallback hotkey (e.g. `Ctrl+Space`) — routed
//      through tauri-plugin-global-shortcut. Users who can't make lone-Ctrl
//      work (macOS Karabiner conflicts, Wayland) fall back to this.
//
// State machine for the lone-Ctrl path:
//
//   Ctrl KEYDOWN (no other modifier already down)  -> arm pending, record T0
//   any non-Ctrl KEYDOWN while pending             -> mark other_seen
//   Ctrl KEYUP                                     -> if pending && !other_seen
//                                                       && elapsed < 400ms
//                                                      -> fire HotkeyTriggered
//
// The hook callback runs in the OS message dispatch path and MUST return
// promptly (Microsoft guidance: <30ms or the OS unmaps the hook), so the hot
// path stays allocation-free.
//
// Full Win + Mac implementations land in sub-PR b commit 2. This file is the
// public API contract.

use anyhow::Result;

/// Threshold (ms) within which Ctrl-down and Ctrl-up must occur, with no
/// intermediate key press, to be recognized as a single tap. Crate-private
/// so cbindgen doesn't surface it on the C ABI (the W3 .NET path has its
/// own copy, `SINGLE_CTRL_MAX_DURATION_MS`).
pub(crate) const TAP_THRESHOLD_MS: u64 = 400;

/// Public surface for the shell to drive hotkey enable/disable + listen for
/// the "Ctrl single-tap" event.
pub struct HotkeyController {
    // Real handle (HHOOK on Win / CGEventTapRef on Mac) lands in commit 2.
    _placeholder: (),
}

impl HotkeyController {
    /// Install the low-level keyboard hook (lone-Ctrl detection) and register
    /// the configurable fallback shortcut via Tauri's plugin.
    ///
    /// `on_tap` is invoked on a background thread when a lone Ctrl tap is
    /// detected; the shell is responsible for hopping to the UI thread.
    pub fn install<F>(_on_tap: F) -> Result<Self>
    where
        F: Fn() + Send + Sync + 'static,
    {
        // sub-PR b commit 2: install hook here.
        // Win path: SetWindowsHookExW(WH_KEYBOARD_LL, ...) — port from
        //   win/CTRL/Services/HotkeyService.cs + HotkeyInterop.cs.
        // Mac path: CGEventTapCreate(...) — already have core-graphics dep.
        tracing::info!("HotkeyController::install — skeleton (sub-PR b commit 2)");
        Ok(Self { _placeholder: () })
    }

    /// Uninstall the hook. Idempotent.
    pub fn uninstall(&mut self) {
        tracing::info!("HotkeyController::uninstall — skeleton");
    }
}

impl Drop for HotkeyController {
    fn drop(&mut self) {
        self.uninstall();
    }
}
