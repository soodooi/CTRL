---
name: keycap-base-layer
version: 0.1.0
status: draft
owner: hephaestus
lane: keycap-dev
review-target: zeus
related-memory:
  - decision_keycap_base_vs_functional_layer
  - decision_ctrl_is_hermes_workbench
  - decision_ai_providers_are_kernel_capabilities
  - decision_first_run_asset_prompt_ok
  - feedback_reuse_existing_capability_first
  - feedback_stay_in_lane_dont_switch_roles
related-adr:
  - 001-system-architecture
  - 004-kernel-capability-surface
  - 013-kernel-mcp-server (if pending — base layer touches MCP host + client both)
unblocks-functional-keycaps:
  - Clipboard AI · Translate · Quick Ask · OCR · Generate Image · Poster
  - Speak (TTS) · Transcribe (STT) · Mermaid Diagram
  - New Note · Search Vault · Open Vault Folder · Clip to Vault
  - Screen Capture · Open in VMark · Insert at VMark cursor · Code Space
---

# CTRL Keycap Base Layer — Substrate Roadmap

> The shared foundation every functional keycap stands on. Spec defines what
> "base" means (substrates, not keycaps), audits what's ✅ ready vs ❌ missing,
> and locks the design + owners for each gap so functional keycap development
> can proceed without infrastructure drift.

---

## 1. Why

Two-layer keycap model (per memory `decision_keycap_base_vs_functional_layer`):

- **Base layer** = substrate / infrastructure (大模型接入 / VMark / Vault / hermes /
  Shell / MCP client / etc.). NOT user-facing keycaps. Other code consumes
  base via well-defined kernel capabilities.
- **Functional layer** = user-facing keycaps. Each stands on one or more base
  substrates. Examples: Clipboard AI → text.chat substrate; Open in VMark →
  VMark integration substrate.

bao's directive (2026-05-23, this session):
> vmark 是 base, 大模型接入是 base 等等, 你要分清楚一下, 其他键帽的开发有需要的都是要提前接入的

Implication: any functional keycap that depends on a missing substrate is
blocked. We need to close substrate gaps **before** functional-keycap dev
breaks the lane by reaching for half-finished infrastructure.

This spec formalizes the gap audit + locks the design for each missing
substrate. Lane assignments (in §6) hand each piece to its owner. zeus
reviews; once APPROVE, the keycap-dev lane (hephaestus) + adjacent lanes
(zeus / athena / daedalus per ownership) execute.

---

## 2. Scope

**In scope**:
- Substrates that **2 or more** functional keycaps consume. Single-keycap
  internals stay within that keycap.
- Designs at the kernel-capability + Tauri-command + PWA-bridge boundary.
- Lane assignment for each missing component.
- Acceptance criteria (each substrate testable in isolation).

**Out of scope**:
- Individual functional keycap design (separate handoff per keycap, after
  base lands).
- hermes-skill keycap content (separate, per memory `decision_irisy_architecture`).
- Mesh sync substrate (ADR-003 owns; mentioned only as future dependency).
- UI design of Pool / Keyboard surfaces (daedalus lane H-2026-05-20-001
  owns).

**Pre-decided (bao verbal approval this session)**:
- Drop Logseq from default editor recommendation.
- VMark = recommended default vault editor (ISC license, filesystem-truth,
  Tauri 2 same stack, MCP-native).
- VMark integration is **single-direction**: CTRL → VMark MCP (one-way
  client). CTRL kernel does NOT expose itself to VMark — VMark and CTRL
  kernel are siblings under any AI agent (hermes / Claude Code), not
  peer-meshed via MCP.
- Game-style first-run asset prompt OK for optional dependencies (VMark /
  Ollama / hermes), one-time + skippable + explained.

---

## 3. Substrate inventory (current state)

### ✅ Ready (PR / lane reference)

| Substrate | Form | PR / Source |
|---|---|---|
| Vault — read / write / search / FTS5 | `vault.*` MCP tools + Tauri commands | PR #37, #38 |
| Vault — 3-tier storage (localstorage / cache) | `localstorage.*` + `cache.*` | PR #39 |
| Capability broker (permission gating) | kernel broker checks per call | PR #40 |
| MCP host (run keycap as MCP server) | `mcp_host` in kernel, `run_keycap` dispatch | PR #35 |
| LLM provider config | `~/.ctrl/config.toml` single source | PR #33 + #34 |
| LLM — text.chat | `chat_stream` Tauri command, kernel `llm_port` | PR #41 |
| LLM — image.generate | Volc adapter (validated by Poster keycap landing) | session 2026-05-18 |
| Keychain (BYOK API key store) | `keychain.*` Tauri commands | (prior) |
| ST-SS bridge (Cell/Op stream @ :17872) | `stss.*` Tauri commands, kernel bridge | foundation |
| kernel_status (boot health surface) | `kernel_status` Tauri command | PR #42 |
| hermes-agent integration (probe + sidecar wire) | `irisy_init`, `irisy_chat_hermes`, `irisy_upgrade_hermes` | this session (35e6902 → 0c4dcb4) |
| hermes update detection (PyPI poll, 1h cache) | embedded in `irisy_init` | this session (2105c1c, 8056505) |

### 🚧 In progress (lane + handoff)

| Substrate | Lane | Handoff |
|---|---|---|
| Subprocess + PTY (Code Space substrate) | zeus | H-2026-05-19-001 in_progress |
| Mesh sync (cross-device, ADR-003) | hephaestus | H-2026-05-14-001 in_progress (design phase) |

### ❌ Missing (this spec covers the design + ownership)

| # | Substrate | Unblocks functional keycaps |
|---|---|---|
| G1 | **VMark integration** (lazy install + state file + URL scheme handler) | Open in VMark; partial: Insert at VMark cursor |
| G2 | **MCP client** (kernel as MCP client to external servers) | Insert at VMark cursor; future: Cursor / Cline / Zed editor integrations |
| G3 | **LLM image.ocr** (Volc adapter) | OCR |
| G4 | **LLM audio.tts** (Volc adapter) | Speak |
| G5 | **LLM audio.stt** (Volc adapter) | Transcribe |
| G6 | **LLM image.edit** (Volc adapter) | future image-editing keycaps |
| G7 | **Shell — clipboard wrap** (kernel capability around Tauri clipboard plugin) | Clipboard AI, Clip to Vault |
| G8 | **Shell — capture** (region screenshot, cross-platform native) | Screen Capture, OCR (image source) |
| G9 | **Shell — open_path wrap** (kernel capability around Tauri shell-open) | Open Vault Folder, Open in VMark URL |

9 gaps. §5 designs each.

---

## 4. Functional keycap → base dependency map

For each preinstall-candidate functional keycap (from this session's slate),
which substrates it consumes and current ship-readiness:

| Functional keycap | Consumes | Ship-ready now? |
|---|---|---|
| Clipboard AI | clipboard + text.chat | ❌ blocked on G7 |
| Translate | text.chat | ✅ |
| Quick Ask | text.chat | ✅ |
| OCR | shell.capture + image.ocr | ❌ blocked on G3, G8 |
| Generate Image | image.generate + vault.write | ✅ (Poster validates) |
| Poster | image.generate + template | ✅ already shipped |
| Speak (TTS) | text input + audio.tts | ❌ blocked on G4 |
| Transcribe (STT) | vault.read + audio.stt | ❌ blocked on G5 |
| Mermaid Diagram | text.chat + vault.write | ✅ |
| New Note | vault.write | ✅ |
| Search Vault | vault.search | ✅ |
| Open Vault Folder | shell.open_path | ❌ blocked on G9 |
| Clip to Vault | clipboard + vault.write | ❌ blocked on G7 |
| Screen Capture | shell.capture | ❌ blocked on G8 |
| Open in VMark | VMark integration + shell.open_path | ❌ blocked on G1, G9 |
| Insert at VMark cursor | VMark MCP (via MCP client) + text.chat | ❌ blocked on G1, G2 |
| Code Space | ST-SS + subprocess + PTY | 🚧 in_progress (zeus path C) |

**5 functional keycaps are ship-ready today** (Translate, Quick Ask, Generate Image,
Poster, Mermaid Diagram, New Note, Search Vault). Without this base spec, the
other 10 remain blocked.

---

## 5. Designs (per gap)

### 5.1 G1 — VMark integration substrate

**Three sub-components**:

1. **Lazy install** (Tauri command `install_vmark`)
2. **State file** (`~/.ctrl/state/vmark.json`)
3. **URL scheme handler** (`shell.open("vmark://open?path=...")`)

**Not included in this gap** (separate gap G2): MCP client wire to VMark.
G1 alone unblocks "Open in VMark" keycap. G1 + G2 together unblock "Insert
at VMark cursor".

**Architecture**:

```
CTRL.app  ←──────── lazy install ─────────→  User's package manager
                                              (brew install --cask vmark
                                               or DMG fallback)
                              ↓
                    ~/.ctrl/state/vmark.json
                    (install path + version + user-configured vault dir)
                              ↓
   Keycap "Open in VMark" → shell.open("vmark://open?path=...")
                                              ↓
                                         VMark.app receives URL,
                                         opens file in appropriate viewer
                                         (markdown WYSIWYG / JSON tree /
                                          Mermaid render / etc.)
```

**Why lazy install (not bundled)**:
- CTRL never bundles VMark binary → no AGPL §13 / license-aggregation
  concern (VMark license = ISC, but lazy install means CTRL is downloader,
  not distributor; lowest legal burden either way).
- User can choose not to install VMark and CTRL remains fully functional
  (degraded: "Open in VMark" keycap greys out with helpful tooltip).
- Matches game-style asset-prompt pattern (memory
  `decision_first_run_asset_prompt_ok`): one-time prompt, skippable,
  explained.

**Tauri command surface**:

- `install_vmark(app) -> Result<VMarkInstallOutcome, String>` — `VMarkInstallOutcome` carries `kind` (`"installed"` / `"already-installed"` / `"no-installer"` / `"user-cancelled"` / `"error"`), optional `method` (`"brew-cask"` / `"dmg-direct"` / `"winget"` / `"flatpak"` / `"appimage"`), optional `binary_path`, optional `version` (parsed from Info.plist CFBundleShortVersionString on macOS or equivalent), and `message`.
- `vmark_status() -> Result<VMarkStatus, String>` — `VMarkStatus` carries `installed`, optional `binary_path`, `version`, `vault_dir` (user-configured; null until set), and `install_method`.
- `vmark_set_vault_path(vault_dir) -> Result<(), String>`.

*(Tauri command + result struct definitions elided. Implementation: `src-tauri/src/commands/vmark.rs`.)*

**Install paths per platform**:

| Platform | Primary | Fallback |
|---|---|---|
| macOS | `brew install xiaolai/tap/vmark` | Direct DMG from GitHub Releases (`VMark_<ver>_<arch>.dmg`) |
| Windows | Direct binary from GitHub Releases (winget probably not yet — verify upstream) | (only one path) |
| Linux | Direct binary from GitHub Releases | (only one path) |

Per upstream README: macOS is "primary platform"; Windows/Linux are
"best-effort". CTRL surfaces this honestly in the install prompt — if user
is on Win/Linux, prompt mentions "VMark on this platform is upstream
best-effort; you may prefer your existing editor". No forced install.

**State file shape** (`~/.ctrl/state/vmark.json`): JSON object with `installed` (bool), `install_method` (e.g. `"brew-cask"`), `binary_path`, `version`, `installed_at` (ISO timestamp), `vault_dir` (initially null), `url_scheme_supported` (bool).

State is read-mostly. Written by `install_vmark` on success and by `vmark_set_vault_path` when user picks a shared vault dir.

**URL scheme — how it works**:
- VMark registers `vmark://` URL scheme on install (handled by VMark, not
  by CTRL).
- CTRL invokes via `shell.open` capability (G9).
- Open in VMark keycap manifest: `id: 'open-in-vmark'`, `target: 'mcp-tool'`, declares `capabilities: ['vault.read', 'shell.open']`, `workspace: { ui: 'none' }`, and a `run` function that reads `ctx.input.path` (the focused vault file) and forwards it to `ctx.shell.open('vmark://open?path=<encoded>')`. *(Manifest snippet elided — implementation lives under `share/manifests/open-in-vmark/`.)*
- Degrade behavior: if VMark not installed → `shell.open` falls back to
  system default editor for that extension (macOS Launch Services / Win
  ShellExecute). User still gets a viewer; CTRL doesn't crash.

**License compliance (THIRD_PARTY_LICENSES.md entry)**: declare VMark as ISC (root) / MIT (sidecar `@vmark/mcp-server` npm package), source `https://github.com/xiaolai/vmark`, copyright "© 2026 Xiaolai Li and contributors", and clarify that CTRL does not bundle or distribute VMark binaries — CTRL triggers installation via the user's package manager (Homebrew tap) or by downloading VMark's unmodified release artifact from upstream. The installed VMark remains an independent program.

*(THIRD_PARTY_LICENSES.md entry text elided — lives at repo root.)*

No AGPL §13 concern — VMark is not AGPL. ISC is permissive (MIT-equivalent).

### 5.2 G2 — MCP client substrate (CTRL kernel calling external MCP servers)

**Module**: `src-tauri/src/kernel/mcp_client.rs` (new).

CTRL kernel already has `mcp_host` (PR #35) for running keycaps **as** MCP
servers. G2 is the dual: CTRL kernel as MCP **client** of external servers
(VMark today, Cursor / Cline / Zed tomorrow).

**Reuse rmcp** (already in Cargo.toml per memory): rmcp Rust SDK supports
both server and client modes. We instantiate `rmcp::Client` and route
requests through the capability broker (same gating as `mcp_host`).

**Connection strategy** (bao decision needed — flagged as Open Q1):

| Strategy | Description | Pros | Cons |
|---|---|---|---|
| **A. Spawn sidecar** | CTRL spawns `vmark-mcp-server` binary as child process, talks MCP stdio | Follows VMark's official contract; stable across VMark versions | Requires VMark to be installed (its install includes the sidecar binary on PATH or in `${VMark.app}/Contents/Resources/`); CTRL has to manage subprocess lifecycle |
| **B. Direct WebSocket** | CTRL connects to `localhost:63702` (VMark's internal bridge) directly | No subprocess management; faster | VMark internal bridge is not a stable public contract; VMark version upgrades may break this |

**My recommendation**: A (sidecar). Cost of subprocess management is low
(we already do it for hermes_chat); cost of upstream version drift is
unbounded. Pin to the sidecar contract that has documented stability.

**Connection state**:
- Stored in `~/.ctrl/state/mcp-clients.json` as a `clients` map keyed by server id (e.g. `vmark`). Each entry carries `kind` (`"sidecar"` etc.), `binary_path`, `auto_start: bool`, `last_connected_at` timestamp.
- Lifecycle: lazy start on first keycap call requiring MCP client; graceful shutdown on CTRL kernel shutdown; reconnect on VMark restart.

**Tauri command surface**:

- `mcp_client_call(server, tool, args: serde_json::Value) -> Result<serde_json::Value, String>` — e.g. `server="vmark"`, `tool="selection"`.
- `mcp_client_list_servers() -> Result<Vec<McpClientServer>, String>`.
- `mcp_client_register_server(spec: McpClientServerSpec) -> Result<(), String>`.

*(Command signatures elided. Implementation: `src-tauri/src/commands/mcp_client.rs`.)*

**Capability gating**: any keycap calling `mcp_client.*` must declare the target server in its manifest `capabilities` array (e.g. `["mcp:vmark"]`), enforced by capability broker.

**Manifest dependency declaration**: an `insert-at-vmark-cursor` keycap declares `capabilities: ['mcp:vmark', 'text.chat']` and `requires: ['mcp:vmark']` (hard requirement — keycap greys out if VMark not connected).

### 5.3 G3 / G4 / G5 / G6 — LLM image.ocr / audio.tts / audio.stt / image.edit

Same adapter pattern as `image.generate` (Volc, validated by Poster keycap
landing per memory `project_session_2026-05-18_handoff`).

Each new capability:
1. Add Volc API method to `kernel/llm/adapter/volc.rs` (or split into
   per-capability submodule if file grows).
2. Register capability name in capability broker registry.
3. Add Tauri command `<capability>_invoke` (or expose via existing
   `mcp_call` if hosting under kernel MCP server).
4. Document Volc API endpoint + payload shape in `doc/llm-capabilities.md`
   (new doc, lives alongside `00-inventory-and-abstractions.md`).

**Volc endpoint references** (verify each against current Volc Ark API):

| Capability | Volc endpoint pattern | Model |
|---|---|---|
| image.ocr | `/v3/ocr` or `/v3/visual/ocr` | Volc OCR series |
| audio.tts | `/v3/audio/speech` | bigtts series |
| audio.stt | `/v3/audio/transcriptions` | bigasr series |
| image.edit | `/v3/images/edits` | Volc image edit series |

**Open question** (Q2): Volc API stability for image.edit — last I checked
the edit endpoint was beta. zeus or bao to verify before C6 commits.

**Fallback chain**: each capability supports BYOK (user-provided
Anthropic / OpenAI / direct provider key) per existing config.toml pattern
(memory `project_session_2026-05-18_handoff`). Volc is default, BYOK
overrides per-capability.

**Cost-awareness UX** (out of base scope, flagged for functional keycap
docs): image.generate / image.edit / audio.* cost more than text.chat.
Functional keycaps that consume these should surface "this will cost
~$0.0N" estimate in pre-call confirmation (deferred to functional keycap
design phase).

### 5.4 G7 — Shell.clipboard wrap

Tauri already exposes `tauri-plugin-clipboard-manager`. G7 wraps it as
kernel capability so:
- Capability broker can gate clipboard access (some keycaps may not need
  clipboard; explicit declaration in manifest).
- Audit trail logs clipboard reads (privacy/security: knowing which keycap
  touched clipboard at what time).

**Tauri commands** (thin wrap around `tauri-plugin-clipboard-manager`):

- `clipboard_read_text() -> Result<String, String>`
- `clipboard_read_image() -> Result<Vec<u8>, String>` (PNG bytes)
- `clipboard_write_text(text: String) -> Result<(), String>`

*(Command signatures elided. Implementation: `src-tauri/src/commands/clipboard.rs`.)*

**Capability name**: `clipboard.read` / `clipboard.write`.

### 5.5 G8 — Shell.capture (region screenshot)

Cross-platform region capture. macOS = Vision framework / CGWindowList;
Windows = GDI+ / DXGI; Linux = scrot / grim (Wayland).

**API surface**:

- `CaptureArgs { mode: 'region'|'fullscreen'|'window', format: 'png'|'jpg', destination: Option<vault-relative-path> }` (omitting `destination` returns bytes).
- `CaptureResult { bytes?, file_path?, width: u32, height: u32, elapsed_ms: u64 }`.
- `shell_capture(args: CaptureArgs) -> Result<CaptureResult, String>` (Tauri command).

*(Struct + command signatures elided. Implementation: `src-tauri/src/commands/shell_capture.rs`.)*

**Cross-platform implementation**:
- macOS: `CGWindowListCreateImage` for window/full; SystemEvents OSA for
  region picker (or shell out to `screencapture -i` which is supported
  since macOS 10.7).
- Windows: `gdiplus` for full; UIAutomation for region picker (or shell
  out to `Snipping Tool` via `explorer ms-screenclip:`).
- Linux: shell out to `scrot -s` (X11) or `grim -g` + `slurp` (Wayland).

**Recommendation**: defer Linux to "best-effort" (matches VMark's stance),
ship macOS + Windows in v1 base.

**Capability name**: `shell.capture`.

### 5.6 G9 — Shell.open_path wrap

Wraps Tauri's `shell.open` (already a Tauri plugin). G9 adds the capability-broker registration + per-keycap audit, same as G7.

Single command: `shell_open_path(path_or_url: String) -> Result<(), String>`.

*(Command signature elided. Implementation: `src-tauri/src/commands/shell_open.rs`.)*

**Capability name**: `shell.open`.

Handles file paths (Finder/Explorer/file-manager opens at that path) AND
URL schemes (`https://`, `vmark://`, custom). Tauri delegates to OS Launch
Services on each platform.

---

## 6. Components × Owners

20 components mapped across 4 lanes. None overlap; each component fully
owned by one persona.

| C# | Component | Lane / Persona | Notes |
|---|---|---|---|
| C1 | VMark lazy-install Tauri command (`install_vmark`) | hephaestus (keycap-dev) | brew-tap primary, DMG fallback |
| C2 | VMark state file (`~/.ctrl/state/vmark.json`) schema + read/write helpers | hephaestus | thin |
| C3 | VMark URL scheme keycap (`open-in-vmark`) manifest | hephaestus | builtin, target=mcp-tool |
| C4 | `vmark_status` + `vmark_set_vault_path` Tauri commands | hephaestus | thin |
| C5 | MCP client module (`kernel/mcp_client.rs`) | **zeus** (kernel architecture) | rmcp client wire |
| C6 | MCP client Tauri commands (`mcp_client_*`) + registration | zeus | bridges to PWA |
| C7 | MCP client state file (`~/.ctrl/state/mcp-clients.json`) + lifecycle | zeus | start/stop/reconnect |
| C8 | "Insert at VMark cursor" keycap manifest | hephaestus | depends on C5-C7 + G1 |
| C9 | LLM image.ocr Volc adapter | hephaestus | mirrors image.generate |
| C10 | LLM audio.tts Volc adapter | hephaestus | mirrors image.generate |
| C11 | LLM audio.stt Volc adapter | hephaestus | mirrors image.generate |
| C12 | LLM image.edit Volc adapter | hephaestus | mirrors image.generate, verify beta API |
| C13 | Shell.clipboard kernel-capability wrap (`clipboard_*` Tauri commands) | hephaestus | tauri-plugin-clipboard-manager |
| C14 | Shell.capture region screenshot (`shell_capture`) — macOS impl | **athena** (mac shell) | Vision / screencapture |
| C15 | Shell.capture region screenshot — Windows impl | athena (with athena-windows expertise check, or zeus if athena scope is mac-only) | gdiplus / snip |
| C16 | Shell.open_path kernel-capability wrap (`shell_open_path`) | hephaestus | thin Tauri-plugin-shell wrap |
| C17 | THIRD_PARTY_LICENSES.md — VMark (ISC) + sidecar (MIT) entries | hephaestus | drop-in |
| C18 | PWA "first-run game-style prompt" UI for VMark install | **daedalus** (frontend) | reuses prompt component when other optional deps added later |
| C19 | PWA "VMark status" row in About panel | daedalus | reads `vmark_status` |
| C20 | Acceptance test harness (each substrate testable in isolation) | hephaestus | covers C1-C19 |

**Conditional ownership note**: athena lane (mac shell migration H-2026-05-14-002)
is the natural owner for C14 (macOS Vision / screencapture). Windows
implementation (C15) — if athena scope is mac-only (per current lane
description), this defaults to zeus or a new lane assignment from bao.
Flagged as Open Q3.

---

## 7. Open Questions

**Q1** — VMark MCP client connection strategy (§5.2): sidecar (A) vs
direct WebSocket (B)?
- **My recommendation**: A (sidecar). Stable contract, low ongoing cost.
- **Needs bao decision** before C5 commits.

**Q2** — Volc image.edit API stability (§5.3, C12)?
- Verify current Volc Ark image edit endpoint status (beta / GA).
- If still beta, C12 defers to functional-keycap phase; G6 marked
  "depends on upstream maturity".

**Q3** — C15 (Shell.capture Windows impl) ownership?
- athena scope per current handoff = macOS. If Windows shell.capture is in
  scope, either: (a) extend athena lane, (b) assign to zeus, (c) open new
  Windows-specific lane.
- bao to confirm.

**Q4** — Game-style first-run prompt (C18) — when does it trigger?
- On CTRL.app first launch after install? On `/irisy` route first visit?
- bao implicit approval to "game-style asset prompt"; trigger point not
  spec'd.
- **My recommendation**: first launch after install, with a 1-shot
  `~/.ctrl/state/first-run.json` flag preventing re-display. User can
  re-trigger via About panel.

---

## 8. Counter-evidence (how this spec could be wrong)

Per house pattern (Irisy spec §8): 6 failure modes that would break this
plan.

1. **VMark abandons MCP** — xiaolai/vmark removes MCP support or stops
   maintaining sidecar. CTRL → VMark MCP wire dies; G1 URL scheme still
   works but C5-C8 stop. Mitigation: G2 (MCP client) is built generically
   — VMark is first instance, not only one. Cursor / Cline / Zed will be
   alternates. Spec acknowledges in §5.2.

2. **Volc raises pricing on audio.* / image.edit** beyond acceptable. The
   Volc-default + BYOK pattern absorbs this: users can BYOK directly to
   Anthropic / OpenAI. Spec already supports.

3. **Cross-platform shell.capture is more work than estimated** — Linux
   Wayland fragmentation, Windows region picker quirks. Mitigation: ship
   macOS + Windows in v1 base, Linux best-effort.

4. **Sidecar lifecycle bugs** — VMark crash / hang while CTRL has live
   MCP client → CTRL hangs. Mitigation: client-side timeout (2s per
   request), backoff reconnect, capability broker reports degraded state
   to PWA so functional keycaps grey out.

5. **MCP capability broker over-blocks** — adding new substrate
   capabilities, broker rules may unintentionally deny legitimate keycap
   calls. Mitigation: broker has explicit allow-list per manifest, fail
   loud (return permission error to keycap, not silent).

6. **Lane execution drift** — 4 personas (zeus / hephaestus / athena /
   daedalus) collaborating on 20 components may have integration gaps.
   Mitigation: zeus orchestration role + this spec acts as contract;
   acceptance tests (C20) per substrate prevent silent regressions.

---

## 9. Acceptance

Each substrate is "done" when:

- **G1 (VMark integration)**: `install_vmark` runs on bao's macOS,
  installs VMark via brew, writes vmark.json correctly; "Open in VMark"
  keycap opens current focused vault file in VMark; VMark uninstalled →
  keycap greys out with helpful tooltip.
- **G2 (MCP client)**: CTRL kernel connects to VMark sidecar, lists
  VMark's 5 tools, calls `selection.replace` end-to-end and the change
  appears in VMark.app's focused tab.
- **G3 / G4 / G5**: each LLM capability passes a smoke test
  (clipboard.copy English text → audio.tts produces audio file → file
  plays in vault).
- **G6 (image.edit)**: deferred per Q2; minimum is G6 marked "ready for
  C12 once upstream confirmed GA".
- **G7 (clipboard wrap)**: kernel `clipboard.read` returns current
  clipboard contents; manifest declaration enforced (keycap without
  `clipboard.read` in capabilities array gets permission denied).
- **G8 (shell.capture)**: macOS region picker works, image saved to vault
  or returned as bytes per CaptureArgs.destination; Windows same.
- **G9 (shell.open_path)**: opens Finder/Explorer at vault root; opens
  `vmark://` URL when VMark installed.

Overall acceptance: a fresh CTRL.app install → on first boot, game-style
prompt offers VMark install + AI capability selection → user accepts both
→ all 16 functional keycaps (Code Space excluded — separate lane) are
either ready or have explicit "depends on upstream" reason.

---

## 10. Implementation notes

- **No phasing** (memory `feedback_no_planning_no_phasing`). Components
  ship as they're ready, single PR per coherent slice (e.g. all VMark
  G1+C1-C4+C17 in one PR; all LLM substrates G3-G6+C9-C12 in another).
- **bao approval gates** flagged at each Open Question in §7. Spec lands
  only after Q1-Q4 resolved.
- **Single PR ship per slice** (memory `feedback_no_planning_no_phasing`):
  - PR-A: VMark URL scheme + lazy install (C1-C4, C17, C18 partial)
  - PR-B: MCP client substrate (C5-C7) + Insert at VMark cursor keycap (C8)
  - PR-C: LLM image.ocr + audio.tts + audio.stt (C9-C11)
  - PR-D: Shell wraps (C13, C14, C16)
  - PR-E: PWA wire (C18, C19)
  - PR-F: License + acceptance (C17, C20)
  These are coherent slices, NOT phases — each can ship independently.
- **MCP client capability broker entry** must be added to ADR-004 (kernel
  capability surface) — flagged for zeus during cross-cutting review.

---

## 11. Changelog

| Version | Date | Author | Summary |
|---|---|---|---|
| 0.1.0 | 2026-05-23 | hephaestus | Initial draft — Base layer substrate roadmap; 9 gaps with designs; 20 components × 4 lanes; 4 open questions for bao/zeus. Ready for zeus review. |

---

## bao approval

Pre-approved in this session (2026-05-23, before spec writing):

- ✅ **VMark = recommended default vault editor** (replaces earlier
  setup-logseq-lazy-install.md scope; Logseq dropped due to DB-version
  split risk). bao: "先弃用 logseq".
- ✅ **VMark integration = base substrate, not single keycap**. bao:
  "vmark 是 base, 大模型接入是 base 等等".
- ✅ **One-way MCP: CTRL → VMark only, no peer mesh**. bao: "互相 MCP 我感觉
  不是很妥".
- ✅ **Game-style first-run asset prompt OK**. bao: "第一次弹窗可以跟游戏一样
  提示用户装 asset, 用户点击确定就行了".
- ✅ **Base layer must close gaps before functional keycap development**.
  bao: "其他键帽的开发有需要的都是要提前接入的".
- ✅ **Logseq dropped from v1**. bao: "先弃用 logseq".

Pending bao decisions (Open Questions in §7):
- ⏳ Q1: VMark MCP client = sidecar (A) or direct WebSocket (B)?
- ⏳ Q2: Volc image.edit API status (beta / GA)?
- ⏳ Q3: Shell.capture Windows impl ownership (athena scope extension /
  zeus / new lane)?
- ⏳ Q4: Game-style first-run prompt trigger point (CTRL first launch
  vs `/irisy` first visit)?

zeus REVIEW expected next; on APPROVE the lane assignments in §6 begin
execution in parallel.
