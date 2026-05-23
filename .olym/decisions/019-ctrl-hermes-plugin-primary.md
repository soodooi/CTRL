---
adr_id: 019
title: CTRL = hermes plugin (primary integration); kernel MCP server demoted to IPC + secondary surface
status: accepted
date: 2026-05-23
deciders: [bao, zeus, hephaestus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/010-keycap-execution-model.md
  - .olym/decisions/013-kernel-as-mcp-server.md
  - .olym/decisions/016-irisy-eight-stage-lifecycle.md
scope: framework
supersedes: []
superseded_by: []
---

## Context

ADR-013 (2026-05-22) shipped kernel-as-MCP-server with the premise that hermes-agent would consume CTRL via `hermes mcp add ctrl-kernel http://127.0.0.1:17873/mcp`. Spike (`doc/hermes-spike/RESULT.md`) verified that path works.

After ADR-013 landed, hephaestus did deeper due diligence on hermes plugin system (`<hermes-repo>/plugins/`). Discovery: hermes ships a **3-class plugin system** (Provider plugin, Tool plugin, Dashboard plugin) with built-in:

- Plugin discovery (4 sources: bundled / `~/.hermes/plugins/` / project / pip `hermes_agent.plugins` entry-point)
- Profile-awareness (per-profile plugin sets, switches with profile)
- Cron scheduling (`hermes cron` runs plugins on schedule)
- Logging (`hermes logs` shows plugin output)
- Models / fallback integration

If CTRL ships a hermes **Tool plugin** (`~/.hermes/plugins/ctrl/`), it inherits all of the above for free. The MCP `add ctrl-kernel` path **requires user manual `hermes mcp add` step + tool surface is exposed under generic MCP namespace, missing profile/cron/logs integration**.

Both paths work technically; the plugin path is a strictly better hermes-side UX and reuses hermes infrastructure that ADR-013 was implicitly going to re-implement (per-profile tool sets, scheduled invocations, integrated logs).

memory `decision_ctrl_is_hermes_workbench`: "hermes 大脑, CTRL 加手 / 脚 / 眼 / 嘴 / 工作台". A plugin literally **writes the CTRL body spec for hermes to consume** — protocol-level expression of the framing.

ADR-013 is not wrong; it's necessary as the kernel-side IPC. But its role demotes from "primary hermes integration" to "kernel IPC layer + secondary surface for non-hermes agents".

## Decision

**CTRL primary hermes integration path = hermes Tool plugin.**

### 1. Plugin distribution

- Package: `ctrl-hermes-plugin` on PyPI (separate from `hermes-agent`)
- Install: `pip install ctrl-hermes-plugin` (lazy, on first CTRL.app launch with hermes detected)
- Lands at `~/.hermes/plugins/ctrl/` (user-scoped) OR pip entry-point group `hermes_agent.plugins` (pip-detected)
- Plugin manifest: `plugin.yaml` + `register.py` (Python handler)
- License: MIT (same as hermes-agent itself — frictionless ecosystem alignment)

### 2. Plugin shape

```yaml
# ~/.hermes/plugins/ctrl/plugin.yaml
name: ctrl
version: 0.1.0
kind: tool
description: CTRL workbench tools — keycap invocation, vault read/write, kv, llm, mcp proxy
author: CTRL team
website_url: https://github.com/soodooi/CTRL
provides_tools: true
```

```python
# ~/.hermes/plugins/ctrl/register.py
from hermes_agent.plugin_api import PluginContext, register_tool

def register(ctx: PluginContext) -> None:
    # Each tool wraps a kernel MCP server call (ADR-013 wire).
    # No business logic in the plugin — pure adapter from hermes
    # plugin protocol to kernel MCP protocol.
    register_tool(ctx, _vault_read)
    register_tool(ctx, _vault_write)
    register_tool(ctx, _kv_get)
    register_tool(ctx, _kv_set)
    register_tool(ctx, _llm_chat)
    register_tool(ctx, _keycap_invoke)
    register_tool(ctx, _mcp_proxy_call)
    # ...
```

### 3. Plugin handler → kernel IPC

The plugin's tool handlers do NOT re-implement business logic. Each handler:

1. Reads kernel URL + Bearer token from `~/.ctrl/state/kernel-handshake.json` (written by CTRL.app at boot; rotated per process)
2. Issues an MCP `tools/call` request to `http://127.0.0.1:17873/mcp` (the ADR-013 kernel MCP server)
3. Returns the result back to hermes

So the kernel MCP server (ADR-013) stays — it's the kernel-side IPC layer. The plugin is a thin facade Python ↔ Rust over MCP wire.

### 4. Profile-aware plugin scope

Hermes profile switching (`hermes profile use <name>`) switches plugin sets. CTRL's plugin attaches to the **default profile** at install; user can scope it per-profile through standard hermes profile management. CTRL's PWA Settings → Hermes pane is a thin wrapper showing which profile + which plugins are active.

### 5. Kernel MCP server (ADR-013) role demoted to:

- **Primary consumer**: the `ctrl-hermes-plugin` Python adapter (path B)
- **Secondary consumer**: non-hermes AI agents (Claude Code / Cursor / future) that want direct MCP-based access
- **Tertiary consumer**: PWA mobile mode (intra-device WebSocket+token path)

ADR-013 implementation remains unchanged; only the framing of "who uses it" shifts.

### 6. PWA Irisy companion path

Irisy (8-stage lifecycle, ADR-016) still consumes hermes via subprocess (`hermes chat -q "..."` non-interactive) OR via the plugin's tool list (when Irisy wants to know what tools hermes has available — uses `hermes mcp list` style introspection internally).

The plugin's existence simplifies Irisy: Irisy doesn't need to manually `hermes mcp add ctrl-kernel`; the plugin auto-loads when hermes session starts.

### 7. Keycap → plugin tool mapping

For `target: "mcp-tool"` keycaps: kernel MCP server exposes `keycap.invoke(id, params)`; the plugin's `_keycap_invoke` tool forwards it. From hermes's view, every keycap is callable as `ctrl:keycap_invoke{id="...", params=...}`.

For `target: "hermes-skill"` keycaps: kernel `skill_generator` writes SKILL.md to `~/.hermes/skills/<id>/`; hermes loads it independently (skill convention, not plugin convention). Plugin and skill are orthogonal axes.

### 8. Plugin doesn't replace MCP server for other agents

Claude Code / Cursor / external agents still use kernel MCP server directly (ADR-013 path). They don't go through the Python plugin. Single source of truth (kernel) feeds both paths.

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Keep ADR-013 primary (no plugin) | Re-implements hermes plugin discovery / profile / cron / logs in CTRL; wastes ecosystem reuse |
| A2 | Plugin only (drop ADR-013) | Non-hermes agents (Claude Code / Cursor) lose access; secondary surface valuable; reverting ADR-013 wastes shipped work |
| A3 | Plugin + new HTTP REST kernel API (not MCP) | Two kernel API surfaces; MCP standard already in place; complexity for no value |
| A4 | Plugin handler runs business logic in Python (no kernel callback) | Splits source-of-truth (Rust kernel vs Python plugin); state synchronization headache; violates "kernel is the brain of CTRL body" |

## Consequences

**Positive**:
- Hermes UX is "install CTRL → ⇧ hermes works": no manual MCP add step, profile-aware, cron-aware, logs integrated
- ADR-013 not wasted — becomes the IPC layer the plugin uses + secondary surface for non-hermes
- Plugin → kernel adapter is ~1 Python file (~150 lines) of handler shims; tiny engineering
- Aligns with `decision_ctrl_is_hermes_workbench` memory: CTRL spec lives as a plugin hermes parses + understands natively
- Plugin is `pip install ctrl-hermes-plugin` — propagates via PyPI; cross-device install is one command

**Negative / cost**:
- Plugin API stability tied to hermes-agent versioning (`compatibility.hermes_min_version` field in manifest)
- Two distribution channels (CTRL.app via Tauri updater + ctrl-hermes-plugin via PyPI) — release coupling needs CI automation
- Plugin handler must keep kernel handshake state synchronized (token rotation per CTRL.app boot)

**Reversal cost**:
- Low. If hermes plugin API drifts dangerously, fall back to ADR-013 path (`hermes mcp add ctrl-kernel`). Plugin code is the disposable side. Estimated 1 week to remove plugin + document fallback.

## Acceptance

- [ ] `packages/ctrl-hermes-plugin/` Python package exists (plugin.yaml + register.py + setup.py)
- [ ] Plugin handler shims for all 11 kernel MCP tools (vault.read / write / list / search / kv.get / set / llm.chat / kernel.status / mcp.list_servers / proxy_list_tools / proxy_call_tool)
- [ ] Kernel handshake file written at boot: `~/.ctrl/state/kernel-handshake.json` = `{ "url": "http://127.0.0.1:17873/mcp", "token": "<ephemeral>" }` (gitignored, mode 0600)
- [ ] Plugin reads handshake file on each tool invocation (lazy refresh on Bearer rejection)
- [ ] `pip install ctrl-hermes-plugin` published to PyPI (private until v1 ship)
- [ ] CTRL.app first-launch detects hermes installation; if present + plugin absent, prompts `pip install ctrl-hermes-plugin` (consent gate)
- [ ] PWA Settings → "Hermes Plugins" pane is a thin wrapper showing installed plugins + profile binding (read-only; install/uninstall via `hermes plugins` CLI)
- [ ] `.olym/specs/ctrl-hermes-plugin/spec.md` exists with plugin.yaml schema + handler conventions + handshake file format
- [ ] hephaestus's spec v0.3.0 references ADR-019 as the primary integration path (replacing manual `hermes mcp add` in §3.3)

## Counter-evidence (would invalidate this ADR)

1. hermes plugin API changes incompatibly between versions and CTRL plugin breaks frequently → fall back to ADR-013 path (less coupling)
2. Non-hermes agent demand grows large enough that "plugin first" framing confuses users — re-elevate ADR-013 path
3. Profile-aware plugin sets prove too coarse-grained for CTRL's needs (e.g. per-keycap activation per profile) — would push us back toward direct MCP

## Changelog

| Date | Change |
|---|---|
| 2026-05-23 | Initial accept (bao verbal-go after hephaestus plugin 3-class due diligence). zeus's ADR-013 demoted to "IPC layer + secondary surface" (no implementation change). |
