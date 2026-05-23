# CTRL changelog

User-visible changes between builds. Rendered in **Settings → About** via
`app_changelog` Tauri command — bao reads this in-app, no terminal.

Format = [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with one
section per build SHA. New entries go at the top; `## Unreleased` collects
work-in-progress.

---

## 0.1.0+46f60e1 — 2026-05-23

### Fixed

- **Ctrl hotkey works in every focused app**, not just Finder. Root cause: CGEventTap was at `Session` location which only delivers events to taps when no foreground app consumed them — every text-input field eats bare Ctrl. Switched to `HID` location which taps at the hardware-input layer (same as Raycast / Karabiner / Hammerspoon).

### Added

- **Version pill in cockpit StatusBar** (`v0.1.0+<sha>`) — bao can tell at a glance which build is running.
- **`app_meta` Tauri command** returns build version + git SHA + UTC timestamp from compile-time env (build.rs injection).

---

## 0.1.0+4855521 — 2026-05-23

### Added

- **macOS Accessibility auto-prompt** on first launch. `AXIsProcessTrustedWithOptions({prompt: YES})` surfaces the standard Privacy & Security dialog so bao doesn't have to guess that the hotkey needs permission.
- **First-launch visible main window**. `~/.ctrl/state/first-launch-done` flag detects first boot — skips the prewarm-cloak path and shows the window directly so the user can tell CTRL is running before the hotkey is armed.

---

## 0.1.0+b9446bd — 2026-05-23

### Added

- **`ctrl-hermes-plugin` Python package** (`packages/ctrl-hermes-plugin/`). Hermes-side Tool plugin that exposes 11 kernel MCP tools (`vault.*` / `kv.*` / `llm.chat` / `mcp.proxy_*`) to any Hermes Agent session. Install via `cp -r packages/ctrl-hermes-plugin ~/.hermes/plugins/ctrl && hermes plugins enable ctrl` — verified working on Hermes 0.14.0.
- **Kernel handshake file** at `~/.ctrl/state/kernel-handshake.json` (mode 0600, written on every kernel boot). Holds `{url, token}` for the MCP server — plugin reads on first invocation, refreshes on 401.

### Fixed

- **Release-mode SIGABRT panic at boot**. `KernelRuntime::boot` was calling `tokio::spawn` for MCP registry hydration — works in `tauri dev` (a Tokio reactor is active) but the release `.app` runs the setup hook BEFORE the runtime spins up. Switched to `futures::executor::block_on` (synchronous, ~5ms, no reactor required).

### Added (kernel + commands)

- **`KernelStatus.hermes_dashboard_url: Option<String>`** field — TCP-probes `127.0.0.1:9119` with a 200ms timeout, returns the URL when the daemon is reachable, `None` otherwise. PWA's EmbedView tab can switch from hardcoded to dynamic.
- **`system_check` Tauri command** — host capability snapshot (Python / pipx / hermes / plugin presence) for the install wizard.
- **`install_irisy` Tauri command** — internal pipx-install hermes-agent + plugin copy + `hermes plugins enable ctrl`, streams progress via the `irisy.install.progress` event channel.

---

## 0.1.0+cd22dac — 2026-05-23

### Added (architecture)

- **ADR-019: CTRL = Hermes plugin (primary integration)** — demotes ADR-013 kernel MCP server to "IPC layer + secondary surface for non-hermes agents". Primary hermes UX is now a Python plugin in `~/.hermes/plugins/ctrl/`.
- **`packages/ctrl-hermes-plugin/` scaffold** — plugin.yaml, register.py, mcp_client.py, handshake.py, pyproject.toml, README. Zero business logic; every tool handler forwards to the kernel MCP server.

---

## 0.1.0+604f0e2 — 2026-05-22

### Added (architecture)

- **Manifest spec v0.3 amendment** (`.olym/specs/tool-manifest/spec.md` §0) — adds `target: "mcp-tool" | "hermes-skill"`, `workspace.ui` 10-enum + `custom_component_path`, `upstream` / `signing` / `config_migration` / `compatibility` / `i18n` fields. v0.1 manifests remain valid.
- **Spec stubs**: `vault-layout/spec.md` (3 default policies — flat / by-day / by-entity), `auto-update/spec.md` (4 layers × 3 tiers operationalization), `skill-generator/spec.md` (target=hermes-skill SKILL.md generator).

---

## 0.1.0+b1c1ba0 — 2026-05-22

### Added / Changed (ADR batch)

- **ADR-001 / 002 / 010 / 011 amended** for 2026-05-22 framing locks (hermes-as-brain, 2-zone workbench, `target` field, auto-update Layer 1 scope).
- **ADR-014**: CTRL = global English first.
- **ADR-015**: Obsidian philosophy (local = truth, vim test as design gate).
- **ADR-016**: Irisy 8-stage keycap lifecycle.
- **ADR-017**: Remote co-view = Irisy primitives (mesh = sync only).
- **ADR-018**: Auto-update strategy — 4 layers × 3 tiers.

---

## 0.1.0+08d1ae3 — 2026-05-22

### Added (kernel)

- **ADR-013: Kernel as MCP server** — `kernel::mcp_server` module exposes 11 tools (`kernel.status` / `vault.read|write|list|search` / `kv.get|set` / `llm.chat` / `mcp.list_servers` / `mcp.proxy_list_tools` / `mcp.proxy_call_tool`) on `127.0.0.1:17873` via rmcp 1.7 streamable-http. Bearer-token auth via axum middleware, ephemeral per-boot.
- **`hermes-agent` spike** (`doc/hermes-spike/RESULT.md`) — verified `pip install hermes-agent` v0.14.0 works; proved Irisy spec §3.3 + §3.4 assumptions wrong; locked the real integration path.
