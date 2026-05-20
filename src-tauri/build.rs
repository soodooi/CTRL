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
}
