// macOS adapter implementing KeyboardListenerPort via CGEventTap on a CFRunLoop thread.

use std::sync::Mutex;

use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_graphics::event::{
    CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
    CGEventType, EventField,
};

use crate::application::ports::{KeyboardCallback, KeyboardListenerPort, RawKeyEvent};
use crate::error::Result;

const KVK_CONTROL: i64 = 0x3B;
const KVK_RIGHT_CONTROL: i64 = 0x3E;

pub struct CgEventTapKeyboard;

impl CgEventTapKeyboard {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CgEventTapKeyboard {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyboardListenerPort for CgEventTapKeyboard {
    fn start(&self, on_event: KeyboardCallback) -> Result<()> {
        std::thread::spawn(move || {
            let cb = Mutex::new(on_event);

            let event_types = vec![
                CGEventType::KeyDown,
                CGEventType::KeyUp,
                CGEventType::FlagsChanged,
            ];

            let tap_result = CGEventTap::new(
                CGEventTapLocation::Session,
                CGEventTapPlacement::HeadInsertEventTap,
                CGEventTapOptions::ListenOnly,
                event_types,
                |_proxy, event_type, event| {
                    let keycode =
                        event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
                    let is_ctrl = keycode == KVK_CONTROL || keycode == KVK_RIGHT_CONTROL;

                    let raw = match (event_type, is_ctrl) {
                        (CGEventType::FlagsChanged, true) => {
                            let flags = event.get_flags();
                            if flags.contains(CGEventFlags::CGEventFlagControl) {
                                Some(RawKeyEvent::CtrlDown)
                            } else {
                                Some(RawKeyEvent::CtrlUp)
                            }
                        }
                        (CGEventType::KeyDown, false) => Some(RawKeyEvent::OtherKeyDown),
                        _ => None,
                    };

                    if let Some(raw) = raw {
                        if let Ok(cb) = cb.lock() {
                            cb(raw);
                        }
                    }
                    None
                },
            );

            let tap = match tap_result {
                Ok(t) => t,
                Err(_) => {
                    tracing::error!(
                        "CGEventTap creation failed — Accessibility permission likely missing"
                    );
                    return;
                }
            };

            let runloop_source = match tap.mach_port.create_runloop_source(0) {
                Ok(s) => s,
                Err(_) => {
                    tracing::error!("create_runloop_source failed");
                    return;
                }
            };

            // SAFETY: `CFRunLoop::get_current()` returns the run loop bound to
            // the *current* thread — this closure runs on the dedicated thread
            // we just spawned, so the returned run loop reference is valid for
            // the lifetime of this thread. `runloop_source` was created by
            // `create_runloop_source` and is owned for the duration of this
            // closure, so the add_source call cannot observe a freed source.
            // `kCFRunLoopCommonModes` is a static immutable CFString from the
            // CoreFoundation library and is always valid.
            unsafe {
                CFRunLoop::get_current().add_source(&runloop_source, kCFRunLoopCommonModes);
            }
            tap.enable();
            tracing::info!("CGEventTap enabled, entering CFRunLoop");
            CFRunLoop::run_current();
        });

        Ok(())
    }
}
