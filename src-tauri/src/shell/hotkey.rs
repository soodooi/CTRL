// Global hotkey controller — lone-`Ctrl` single-tap detector.
//
// tauri-plugin-global-shortcut (like Win32 RegisterHotKey before it) rejects
// bare modifier keys, so for the "Ctrl-tap to summon CTRL" UX we install a
// low-level keyboard hook and run the detection state machine ourselves.
//
// State machine (ports W3 `win/CTRL/Services/HotkeyService.cs`):
//
//   Ctrl KEYDOWN (no other modifier already down) -> arm pending, record T0
//   any non-Ctrl KEYDOWN while pending             -> mark other_seen
//   Ctrl KEYUP                                     -> if pending && !other_seen
//                                                       && elapsed < TAP_THRESHOLD_MS
//                                                      -> fire callback
//
// Hook callback runs in the OS message dispatch path; it must return promptly
// (<30ms per Microsoft guidance, or the OS unmaps the hook silently). The hot
// path stays allocation-free: only one `try_lock` + integer math + a single
// `Arc::clone` on the rare success case.

/// Threshold (ms) within which Ctrl-down and Ctrl-up must occur, with no
/// intermediate key press, to be recognized as a single tap. Matches the
/// retired W3 .NET path's `SINGLE_CTRL_MAX_DURATION_MS` — same user feel
/// across Win and Mac.
pub(crate) const TAP_THRESHOLD_MS: u64 = 400;

use anyhow::Result;
use std::sync::Arc;

/// Callback fired when a lone Ctrl tap is detected. Invoked on the OS
/// dispatch thread — hop to a UI thread inside the closure if needed.
pub type OnTap = Arc<dyn Fn() + Send + Sync + 'static>;

pub struct HotkeyController {
    #[cfg(target_os = "windows")]
    _win: win_impl::WinHook,
    #[cfg(target_os = "macos")]
    _mac: mac_impl::MacTap,
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    _phantom: (),
}

impl HotkeyController {
    /// Install the low-level keyboard hook. Returns immediately; the callback
    /// fires on the OS dispatch thread when a lone Ctrl tap is detected.
    pub fn install<F>(on_tap: F) -> Result<Self>
    where
        F: Fn() + Send + Sync + 'static,
    {
        let cb: OnTap = Arc::new(on_tap);
        #[cfg(target_os = "windows")]
        {
            let win = win_impl::WinHook::install(cb)?;
            Ok(Self { _win: win })
        }
        #[cfg(target_os = "macos")]
        {
            let mac = mac_impl::MacTap::install(cb)?;
            Ok(Self { _mac: mac })
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            let _ = cb;
            anyhow::bail!("HotkeyController: unsupported OS")
        }
    }

    /// Reset the hotkey state machine. Call this when the window is shown
    /// to clear any partial state that might interfere with closing.
    ///
    /// Critical on macOS: CGEventTap state can desync after Cmd-Tab app
    /// switches (modifier-flag races), leaving ctrl_pending stuck. Without
    /// reset, the 3rd+ Ctrl tap silently no-ops because the state machine
    /// thinks Ctrl is still down from a previous cycle.
    pub fn reset_state() {
        #[cfg(target_os = "windows")]
        win_impl::reset_hotkey_state();
        #[cfg(target_os = "macos")]
        mac_impl::reset_hotkey_state();
    }
}

#[cfg(target_os = "windows")]
mod win_impl {
    use super::{OnTap, TAP_THRESHOLD_MS};
    use anyhow::{anyhow, Result};
    use std::sync::{Mutex, OnceLock};
    use std::time::Instant;
    use windows_sys::Win32::Foundation::{HMODULE, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_LCONTROL, VK_LWIN, VK_MENU, VK_RCONTROL, VK_RWIN, VK_SHIFT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION, HHOOK,
        KBDLLHOOKSTRUCT, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    static STATE: OnceLock<Mutex<HookState>> = OnceLock::new();

    struct HookState {
        hook: HHOOK, // null = not installed
        callback: OnTap,
        ctrl_pending: bool,
        other_seen: bool,
        ctrl_down_at: Option<Instant>,
        /// Last time the callback fired. Used for debugging.
        last_fire_at: Option<Instant>,
    }

    // No cooldown period - injected events are filtered by LLKHF_INJECTED flag

    // SAFETY: HHOOK is a `*mut c_void` raw handle that windows-sys does not
    // implement Send/Sync for. We only ever read/write it on the main thread
    // (install + drop both run on the Tauri main thread that owns the message
    // pump). Wrapping in a Mutex still requires Send because OnceLock<T>
    // demands T: Send. The handle is opaque and treated as an integer-equivalent
    // identifier; no dereferencing happens on this side.
    unsafe impl Send for HookState {}

    pub(crate) struct WinHook;

    impl WinHook {
        pub fn install(callback: OnTap) -> Result<Self> {
            // SAFETY: GetModuleHandleW(NULL) returns the current process's
            // module handle; no allocation, no ownership transfer.
            let module: HMODULE = unsafe { GetModuleHandleW(std::ptr::null()) };

            let new_state = HookState {
                hook: std::ptr::null_mut(),
                callback,
                ctrl_pending: false,
                other_seen: false,
                ctrl_down_at: None,
                last_fire_at: None,
            };
            STATE
                .set(Mutex::new(new_state))
                .map_err(|_| anyhow!("HotkeyController is a process-singleton; install() called twice"))?;

            // SAFETY: hook_proc has the required `unsafe extern "system" fn`
            // ABI; module is valid; dwThreadId = 0 installs a system-wide hook.
            let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), module, 0) };
            if hook.is_null() {
                return Err(anyhow!(
                    "SetWindowsHookExW failed (error {})",
                    std::io::Error::last_os_error()
                ));
            }
            STATE.get().expect("just set").lock().unwrap().hook = hook;
            tracing::info!("WH_KEYBOARD_LL installed for lone-Ctrl detection");
            Ok(Self)
        }
    }

    impl Drop for WinHook {
        fn drop(&mut self) {
            if let Some(state) = STATE.get() {
                if let Ok(mut s) = state.lock() {
                    if !s.hook.is_null() {
                        // SAFETY: hook was returned by SetWindowsHookExW and not previously unhooked.
                        unsafe { UnhookWindowsHookEx(s.hook) };
                        s.hook = std::ptr::null_mut();
                    }
                }
            }
        }
    }

    unsafe extern "system" fn hook_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        let pass_through = || unsafe { CallNextHookEx(std::ptr::null_mut(), n_code, w_param, l_param) };

        if n_code != HC_ACTION as i32 {
            return pass_through();
        }
        let msg = w_param as u32;
        let is_keydown = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        let is_keyup = msg == WM_KEYUP || msg == WM_SYSKEYUP;
        if !is_keydown && !is_keyup {
            return pass_through();
        }

        // SAFETY: l_param points to a KBDLLHOOKSTRUCT during a WH_KEYBOARD_LL
        // callback (OS contract).
        let kbd: *const KBDLLHOOKSTRUCT = l_param as *const KBDLLHOOKSTRUCT;
        let vk = unsafe { (*kbd).vkCode };
        let flags = unsafe { (*kbd).flags };
        let is_ctrl = vk == VK_LCONTROL as u32 || vk == VK_RCONTROL as u32;

        // Drop software-injected events. Win11 synthesizes phantom key
        // up/down pairs during focus transitions (after SetForegroundWindow
        // / window cloak-uncloak); they carry LLKHF_INJECTED. Without this
        // filter the state machine accepts the phantom Ctrl-down as a new
        // tap start, then the user's real second Ctrl looks like "still
        // held from before" and never fires the callback (perceived as
        // "Ctrl-close doesn't work, must click outside first").
        // Reference: KBDLLHOOKSTRUCT.flags, LLKHF_INJECTED bit (= 0x10).
        const LLKHF_INJECTED: u32 = 0x10;
        if flags & LLKHF_INJECTED != 0 {
            return pass_through();
        }

        let Some(state_cell) = STATE.get() else {
            return pass_through();
        };
        // try_lock: if a callback dispatch is mid-flight, drop this event
        // rather than block — hot path must return in <30ms.
        let mut state = match state_cell.try_lock() {
            Ok(s) => s,
            Err(_) => return pass_through(),
        };

        // No cooldown period - injected events are filtered by LLKHF_INJECTED flag

        let mut fire_callback: Option<OnTap> = None;
        if is_ctrl && is_keydown && !state.ctrl_pending {
            if !is_any_other_modifier_down() {
                state.ctrl_pending = true;
                state.other_seen = false;
                state.ctrl_down_at = Some(Instant::now());
            }
        } else if is_ctrl && is_keyup && state.ctrl_pending {
            let elapsed_ok = state
                .ctrl_down_at
                .map(|t| t.elapsed().as_millis() < TAP_THRESHOLD_MS as u128)
                .unwrap_or(false);
            if elapsed_ok && !state.other_seen {
                fire_callback = Some(state.callback.clone());
                state.last_fire_at = Some(Instant::now());
            }
            state.ctrl_pending = false;
            state.other_seen = false;
            state.ctrl_down_at = None;
        } else if is_keydown && state.ctrl_pending && !is_ctrl {
            state.other_seen = true;
        }
        drop(state); // release lock before invoking user callback

        if let Some(cb) = fire_callback {
            cb();
        }
        pass_through()
    }

    fn is_any_other_modifier_down() -> bool {
        let down = |vk: u16| -> bool {
            // SAFETY: GetAsyncKeyState is read-only and always safe to call.
            (unsafe { GetAsyncKeyState(vk as i32) } as u16) & 0x8000 != 0
        };
        down(VK_SHIFT) || down(VK_MENU) || down(VK_LWIN) || down(VK_RWIN)
    }

    /// Reset the hotkey state machine. Call this when the window is shown
    /// to clear any partial state that might interfere with closing.
    pub(crate) fn reset_hotkey_state() {
        let Some(state_cell) = STATE.get() else {
            return;
        };
        if let Ok(mut state) = state_cell.try_lock() {
            tracing::info!("Hotkey state reset (window shown)");
            state.ctrl_pending = false;
            state.other_seen = false;
            state.ctrl_down_at = None;
            // Don't reset last_fire_at - we still want to know when the last callback fired
        }
    }
}

#[cfg(target_os = "macos")]
mod mac_impl {
    // CGEventTap-based lone-Ctrl detector. Mirrors `win_impl` 1:1 in state
    // machine semantics, so behavior across Win/Mac is identical from the
    // user's perspective (TAP_THRESHOLD_MS, "any non-Ctrl key cancels"
    // guard, "another modifier already down cancels arming" guard).
    //
    // Differences from the Win path are environmental, not behavioral:
    //   • CGEventTap requires the Accessibility privilege; tap creation
    //     fails until the user grants it. Bootstrap responsibility lives in
    //     `shell::lifecycle` — here we surface the failure as Err so the
    //     supervisor can prompt + retry.
    //   • The tap callback runs on whatever thread runs the CFRunLoop. We
    //     spawn a dedicated thread for that loop so the Tauri main thread
    //     stays free for IPC + UI; the user-supplied callback fires on the
    //     hotkey thread (same hop expectation as Windows).
    //   • Bare-modifier transitions arrive as `FlagsChanged`, not KeyDown /
    //     KeyUp — we synthesize Ctrl up/down from the current modifier mask.
    //
    // Ports the working CGEventTap setup from
    // `adapters/outbound/macos/keyboard.rs` (which only emitted raw events
    // for an external state machine in `application::use_cases`); this file
    // collapses both into the same shape `win_impl` uses.

    use super::{OnTap, TAP_THRESHOLD_MS};
    use anyhow::{anyhow, Result};
    use std::sync::{Mutex, OnceLock};
    use std::thread;
    use std::time::Instant;

    use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
    use core_graphics::event::{
        CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions,
        CGEventTapPlacement, CGEventType, EventField,
    };

    /// macOS virtual key codes for left + right Control (HIToolbox / Events.h).
    const KVK_CONTROL: i64 = 0x3B;
    const KVK_RIGHT_CONTROL: i64 = 0x3E;

    static STATE: OnceLock<Mutex<TapState>> = OnceLock::new();

    struct TapState {
        callback: OnTap,
        ctrl_pending: bool,
        other_seen: bool,
        ctrl_down_at: Option<Instant>,
    }

    pub(crate) struct MacTap;

    impl MacTap {
        pub fn install(callback: OnTap) -> Result<Self> {
            STATE
                .set(Mutex::new(TapState {
                    callback,
                    ctrl_pending: false,
                    other_seen: false,
                    ctrl_down_at: None,
                }))
                .map_err(|_| anyhow!(
                    "HotkeyController is a process-singleton; install() called twice"
                ))?;

            // CGEventTap only delivers events on a thread that runs a
            // CFRunLoop. We dedicate one — the Tauri main thread already
            // owns the AppKit run loop and we don't want to share.
            thread::Builder::new()
                .name("ctrl-hotkey-runloop".into())
                .spawn(|| {
                    if let Err(err) = run_loop() {
                        // Failure is almost always Accessibility permission
                        // missing; lifecycle.rs surfaces a prompt + retry.
                        tracing::error!(?err, "CGEventTap run loop exited");
                    }
                })
                .map_err(|e| anyhow!("spawn hotkey runloop thread: {e}"))?;

            tracing::info!("CGEventTap install requested for lone-Ctrl detection");
            Ok(Self)
        }
    }

    fn run_loop() -> Result<()> {
        let event_types = vec![
            CGEventType::KeyDown,
            CGEventType::KeyUp,
            CGEventType::FlagsChanged,
        ];

        // ListenOnly: we observe events but never consume them, so other
        // apps see Ctrl exactly as the user pressed it.
        //
        // Location = HID, not Session — bao 2026-05-23 root-cause:
        // CGEventTapLocation::Session only delivers events to the tap
        // when (a) our app is foreground, OR (b) no other foreground
        // app consumed them first. Real-world Ctrl gets eaten by every
        // text-input field (Ctrl+letter chords), browsers, terminals,
        // etc. — so the tap effectively only fires when Finder (the
        // desktop) is foreground. HID taps the event flow at the
        // hardware-input layer, BEFORE any app handler runs, so the
        // lone-Ctrl tap fires from any focused app. Raycast / Karabiner
        // / Hammerspoon all use HID for the same reason. Accessibility
        // privilege (already required for any CGEventTap) is sufficient.
        let tap = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            event_types,
            |_proxy, event_type, event| {
                process_event(event_type, event);
                None
            },
        )
        .map_err(|_| {
            anyhow!("CGEventTap creation failed — Accessibility permission likely missing")
        })?;

        let runloop_source = tap
            .mach_port
            .create_runloop_source(0)
            .map_err(|_| anyhow!("CGEventTap create_runloop_source failed"))?;

        // SAFETY: kCFRunLoopCommonModes is a CFString constant exposed by
        // core-foundation; CFRunLoop::add_source retains the source via CF
        // semantics, so dropping `runloop_source` after this call is safe.
        unsafe {
            CFRunLoop::get_current().add_source(&runloop_source, kCFRunLoopCommonModes);
        }
        tap.enable();
        tracing::info!("CGEventTap enabled, entering CFRunLoop");
        CFRunLoop::run_current();
        Ok(())
    }

    fn process_event(event_type: CGEventType, event: &CGEvent) {
        let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
        let is_ctrl = keycode == KVK_CONTROL || keycode == KVK_RIGHT_CONTROL;

        // Decode the raw event into a state-machine input. CGEvent reports
        // bare-modifier transitions as `FlagsChanged`, not KeyDown/KeyUp,
        // so the modifier mask in `CGEventFlags` is the source of truth for
        // Ctrl up vs down. KeyDown/KeyUp still fire for non-modifier keys
        // and are how we observe "any other key was pressed while pending".
        let edge = match (event_type, is_ctrl) {
            (CGEventType::FlagsChanged, true) => {
                if event.get_flags().contains(CGEventFlags::CGEventFlagControl) {
                    Some(Edge::CtrlDown(event.get_flags()))
                } else {
                    Some(Edge::CtrlUp)
                }
            }
            (CGEventType::KeyDown, false) => Some(Edge::OtherDown),
            _ => None,
        };
        let Some(edge) = edge else {
            return;
        };

        let Some(state_cell) = STATE.get() else {
            return;
        };
        // try_lock keeps the tap thread responsive — if a user callback
        // is mid-flight we drop this event rather than block.
        let Ok(mut state) = state_cell.try_lock() else {
            return;
        };

        let mut fire_callback: Option<OnTap> = None;
        match edge {
            Edge::CtrlDown(flags) if !state.ctrl_pending => {
                if !is_any_other_modifier_down(flags) {
                    state.ctrl_pending = true;
                    state.other_seen = false;
                    state.ctrl_down_at = Some(Instant::now());
                }
            }
            Edge::CtrlUp if state.ctrl_pending => {
                let elapsed_ok = state
                    .ctrl_down_at
                    .map(|t| t.elapsed().as_millis() < TAP_THRESHOLD_MS as u128)
                    .unwrap_or(false);
                if elapsed_ok && !state.other_seen {
                    fire_callback = Some(state.callback.clone());
                }
                state.ctrl_pending = false;
                state.other_seen = false;
                state.ctrl_down_at = None;
            }
            Edge::OtherDown if state.ctrl_pending => {
                state.other_seen = true;
            }
            _ => {}
        }
        drop(state);

        if let Some(cb) = fire_callback {
            cb();
        }
    }

    enum Edge {
        CtrlDown(CGEventFlags),
        CtrlUp,
        OtherDown,
    }

    /// Reset the tap state machine. Called by WindowController::toggle when
    /// the window is shown to prevent stuck ctrl_pending state caused by
    /// Cmd-Tab app switches dropping FlagsChanged events asymmetrically
    /// (CtrlDown observed but CtrlUp delivered to the other app).
    pub(crate) fn reset_hotkey_state() {
        let Some(state_cell) = STATE.get() else {
            return;
        };
        if let Ok(mut state) = state_cell.try_lock() {
            tracing::info!("Hotkey state reset (macOS, window shown)");
            state.ctrl_pending = false;
            state.other_seen = false;
            state.ctrl_down_at = None;
        }
    }

    /// Mirrors `win_impl::is_any_other_modifier_down` — at Ctrl-down time,
    /// reject arming if Shift / Option / Command are already held. (Pure
    /// Ctrl chord like Ctrl-S still cancels via `OtherDown`.)
    fn is_any_other_modifier_down(flags: CGEventFlags) -> bool {
        flags.contains(CGEventFlags::CGEventFlagShift)
            || flags.contains(CGEventFlags::CGEventFlagAlternate)
            || flags.contains(CGEventFlags::CGEventFlagCommand)
    }
}
