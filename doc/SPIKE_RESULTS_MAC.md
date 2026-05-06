# Phase 1 Spike — macOS Results

> Filled iteratively over the 5–6 day spike. Final A/B/C decision and Mac vs Win cross-validation belong here.

## Environment

| Field | Value |
|---|---|
| macOS | _e.g. 14.6 (Sonoma) — fill via `sw_vers -productVersion`_ |
| Arch | _arm64 / x86_64_ |
| Rust | _e.g. 1.81.0_ |
| Node | _e.g. 22.6.0_ |
| Tauri CLI | _e.g. 2.1.0_ |
| Permission state at start | _Granted / Pending_ |

## Detector unit tests

| Test | Result |
|---|---|
| `single_press_within_window_triggers` | _pass / fail_ |
| `press_exceeds_window_does_not_trigger` | _pass / fail_ |
| `other_key_during_press_disarms_and_release_yields_idle` | _pass / fail_ |
| `back_to_back_clicks_each_trigger` | _pass / fail_ |
| `ctrl_repeat_does_not_reset_arm_timestamp` | _pass / fail_ |

## Test matrix (35 cases)

Reference Task 7 of the Mac plan. Fill `wake_latency_ms` (P50 / P95) and `false_positive` count over a 30-min usage window where applicable.

| # | Scenario | Expected | Wake latency P50 ms | Wake latency P95 ms | False positives | Notes |
|---|---|---|---|---|---|---|
| 1 | TextEdit "hello" selected, single Ctrl | trigger + capture | | | | |
| 2 | TextEdit nothing selected, single Ctrl | trigger, no capture | | | | |
| 3 | TextEdit Cmd+C | no trigger | n/a | n/a | | |
| 4 | TextEdit Ctrl+A (line start on Mac) | no trigger | n/a | n/a | | |
| 5 | TextEdit Ctrl+E (line end on Mac) | no trigger | n/a | n/a | | |
| 6 | Ctrl held 1s then released | no trigger | n/a | n/a | | |
| 7 | Ctrl+Shift held | no trigger | n/a | n/a | | |
| 8 | Mission Control Ctrl+↑ | no trigger | n/a | n/a | | |
| 9 | Spaces switch Ctrl+→ / Ctrl+← | no trigger | n/a | n/a | | |
| 10–13 | Safari (1–4) | | | | | |
| 14–17 | Chrome (1–4) | | | | | |
| 18–21 | VSCode (1–4) | | | | | |
| 22–24 | Cursor (1–3) | | | | | |
| 25–27 | WeChat / Telegram | | | | | |
| 28–30 | Notion / Figma desktop / Slack | | | | | |
| 31 | Sogou IME, 30 min typing | | n/a | n/a | | |
| 32 | Squirrel (鼠须管), 30 min typing | | n/a | n/a | | |
| 33 | System Pinyin, 30 min typing | | n/a | n/a | | |
| 34 | Vim/Neovim coding, 1 hour | | n/a | n/a | | |
| 35 | VoiceOver enabled (Ctrl+F5) | | n/a | n/a | | |

## Aggregate metrics

| Metric | Threshold | Measured |
|---|---|---|
| False positive rate (overall) | <1% A / 1–8% B / >8% C | _x.x%_ |
| Wake latency P95 | <200 ms | _xxx ms_ |
| Apps with successful selection capture | ≥5 (TextEdit / Safari / Chrome / VSCode / WeChat) | _list_ |

## Decision

> A — ship single-Ctrl as primary; B — ship single-Ctrl with developer-mode opt-out (double-tap fallback); C — abandon single-Ctrl, double-tap only.

**Recommendation:** _to be filled_

**Reasoning:** _data points + screenshots_

## Mac vs Win cross-validation

_Filled once Win spike has data._

- Mac false positive rate vs Win: _—_
- State machine identical behavior across platforms: _—_
- Should `SINGLE_CTRL_MAX_DURATION_MS` differ per platform? _—_

## Open issues / deferred to V1

- AXUIElement implementation for selection capture (replaces Cmd+C PoC)
- Universal binary (Intel + Apple Silicon)
- Notarization & code signing pipeline
- App Store compatibility evaluation (`macOSPrivateApi` conflict)
