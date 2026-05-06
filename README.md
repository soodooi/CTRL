# CTRL — Phase 1 Spike (macOS)

5–6 day technical spike validating **single-Ctrl press as a global hotkey on macOS**, plus a selection-text proof of concept (Cmd+C + NSPasteboard).

This repo is the macOS sibling of the Windows-first PRD. See:
- PRD: `.claude/PRPs/prds/ctrl-platform.prd.md`
- Mac plan: `.claude/PRPs/plans/phase-1-spike-single-ctrl-mac.plan.md`
- Win plan: `.claude/PRPs/plans/phase-1-spike-single-ctrl.plan.md`

## Architecture — Hexagonal (Ports & Adapters)

The Rust crate is laid out as a hexagonal/Clean architecture so the OS-specific code can be replaced (or a Windows sibling added) without touching domain or application layers.

```
src-tauri/src/
  main.rs                     binary entry → ctrl_lib::run()
  lib.rs                      composition root (only place that names both ports and adapters)
  error.rs                    cross-cutting SpikeError + Result alias

  domain/                     pure business rules — no framework, no I/O
    detector.rs               SingleCtrlDetector state machine
    events.rs                 HotkeyEvent, PermissionState (value types)

  application/                use cases + port traits they depend on
    ports.rs                  KeyboardListenerPort / SelectionCapturePort /
                              AccessibilityPort / ClockPort / EventBusPort
    use_cases.rs              start_hotkey_pipeline / capture_selection /
                              ensure_accessibility

  adapters/                   concrete implementations of ports
    inbound/
      tauri_commands.rs       Tauri IPC → use-case calls
    outbound/
      clock.rs                std::time::Instant → ClockPort
      macos/
        keyboard.rs           CGEventTap + CFRunLoop → KeyboardListenerPort
        capture.rs            Cmd+C synth + arboard → SelectionCapturePort
        accessibility.rs      AX trust check → AccessibilityPort
      tauri/
        event_bus.rs          tauri::Emitter → EventBusPort
```

Dependency rule: `adapters → application → domain`. Domain never imports anything from outside itself; application only imports its own ports + domain; adapters import application ports + domain.

The Windows sibling (Phase 1 Win plan) plugs in by adding `adapters/outbound/windows/{keyboard,capture,accessibility}.rs` — domain and application stay untouched.

## Prerequisites

- macOS 13+ (Ventura or later)
- Rust ≥ 1.77 (`rustup show`)
- Node ≥ 20, npm ≥ 10
- Xcode Command Line Tools (`xcode-select --install`)

## First-time setup

```bash
npm install
npm run tauri dev   # first build pulls all Rust crates — 5–10 minutes
```

On first launch macOS will prompt for **Accessibility** permission. After granting:

1. **Quit CTRL** (the dev binary keeps the CGEventTap alive in a CFRunLoop thread; restart is required for a fresh tap on a freshly-trusted bundle).
2. Re-run `npm run tauri dev`.

> Development gotcha: each `cargo run` re-signs the binary with a new ad-hoc identity, which can void the existing TCC entry. Stick to `npm run tauri dev` — Tauri preserves a stable bundle id, so the granted permission carries across runs.

## Verifying the detector

The state machine has zero OS dependencies and runs anywhere:

```bash
cargo test --manifest-path src-tauri/Cargo.toml detector
```

Expect 5 tests green.

## Verifying the listener (manual)

After `tauri dev` is running with permission granted:

1. Single-tap **Control** → terminal logs `single-ctrl triggered`.
2. Hold Control >250 ms → no trigger.
3. Press Ctrl+A → no trigger.
4. Select text in TextEdit, single-tap Control → in-app pill shows the captured text.

## Test matrix

Track all 35 cases in `doc/SPIKE_RESULTS_MAC.md`.

## Build (debug)

```bash
npm run tauri build -- --debug
```

Output: `src-tauri/target/debug/bundle/macos/CTRL.app`

## Status

Phase 1 spike, in progress. Decision A/B/C will be recorded in `doc/SPIKE_RESULTS_MAC.md` at the end of week.
