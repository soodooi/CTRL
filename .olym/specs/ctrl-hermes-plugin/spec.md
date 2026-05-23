# ctrl-hermes-plugin — Hermes Tool Plugin Spec

- **Status**: v0.1 (2026-05-23)
- **Parent**: ADR-019 (primary integration) + ADR-013 (kernel IPC layer)
- **Audience**: hermes-agent users, CTRL packagers, hephaestus spec v0.3.0 maintainer

---

## 1. Purpose

CTRL ships as a hermes-agent Tool plugin so that hermes auto-discovers + registers CTRL capabilities without a manual `hermes mcp add` step. Profile awareness, cron scheduling, log integration, model selection — all inherited from hermes's plugin system for free.

This spec documents:

- Plugin manifest (`plugin.yaml`) schema
- Python package layout (`ctrl_hermes_plugin/`)
- Kernel handshake file format (`~/.ctrl/state/kernel-handshake.json`)
- Tool handler conventions (thin shims, zero business logic)
- Install / discovery / update flow

## 2. Plugin manifest

`plugin.yaml` lives at the package root. Hermes reads it on discovery.

```yaml
name: ctrl
version: 0.1.0
kind: tool
description: CTRL workbench tools
author: CTRL team
website_url: https://github.com/soodooi/CTRL
license: MIT
provides_tools: true
profile_scope: default
handshake_file: ~/.ctrl/state/kernel-handshake.json
tools:
  - kernel.status
  - vault.read
  - vault.write
  - vault.list
  - vault.search
  - kv.get
  - kv.set
  - llm.chat
  - mcp.list_servers
  - mcp.proxy_list_tools
  - mcp.proxy_call_tool
requires:
  hermes_agent: ">=0.14.0"
  python: ">=3.11"
  ctrl_app: ">=1.0.0"
```

Notes:

- `kind: tool` — distinguishes from Provider / Dashboard plugin kinds
- `profile_scope: default` — attaches to user's default hermes profile on first load; user can re-scope per profile via `hermes profile`
- `tools[]` — declarative list of tool names; the actual handler resolution happens in `register.py`
- `requires` — hermes pins these at install time; mismatch surfaces in `hermes doctor`

## 3. Python package layout

```
packages/ctrl-hermes-plugin/
├── plugin.yaml                       # Hermes manifest (above)
├── pyproject.toml                    # PyPI metadata + entry-point
├── README.md
└── ctrl_hermes_plugin/
    ├── __init__.py                   # Re-export register
    ├── handshake.py                  # ~/.ctrl/state/kernel-handshake.json reader
    ├── mcp_client.py                 # httpx-based JSON-RPC client
    └── register.py                   # 11 tool handlers + register(ctx) entry
```

The entire plugin is ~300 lines of Python. Every tool handler is 1-5 lines (call_tool with arguments dict).

## 4. Kernel handshake file

`~/.ctrl/state/kernel-handshake.json` is written by CTRL.app at each boot.

```json
{
  "url": "http://127.0.0.1:17873/mcp",
  "token": "<UUID v4>",
  "schema_version": 1
}
```

Properties:

- **File mode**: 0600 (Unix) — Bearer token must not be readable by other local users
- **Atomic write**: kernel writes to `kernel-handshake.json.tmp` then renames; partial reads impossible
- **Rotation**: token regenerates per kernel boot; plugin invalidates cache + re-reads on first 401
- **schema_version**: starts at 1; bumps if file format changes (kernel ↔ plugin coordinated)

## 5. Tool handler convention

Every handler is a thin shim:

```python
def ctrl_vault_read(path: str) -> Any:
    return call_tool("vault_read", {"path": path})
```

Rules:

1. **Zero business logic in the plugin** — all logic lives in the Rust kernel
2. **Handler name = `ctrl_<kernel_tool_name>`** (dot replaced with underscore) — namespaces tool surface in hermes
3. **Type hints reflect the kernel's tool input schema** — keeps docstrings / autocomplete accurate
4. **Errors propagate** as `KernelCallError`; hermes maps to tool error semantics

Adding a new tool when the kernel adds a new MCP tool:

1. Add handler in `register.py` (~3 lines)
2. Append to `_ALL_TOOLS` tuple
3. List the kernel name in `plugin.yaml` `tools[]`
4. Bump plugin `version` if hermes plugin loader is version-sensitive

## 6. Install / discovery flow

User has hermes-agent installed (`pip install hermes-agent`). User installs CTRL.app:

1. CTRL.app first-launch: detects hermes in `~/.hermes/` or `$PATH`
2. If hermes present + plugin absent: prompt "Install CTRL hermes plugin? `pip install ctrl-hermes-plugin`" (consent gate; never auto-pip)
3. User consents → CTRL.app shells out: `python3 -m pip install ctrl-hermes-plugin` (uses the venv hermes was installed in)
4. Plugin discoverable via pip entry-point `hermes_agent.plugins`
5. CTRL.app boots → kernel writes handshake file
6. User runs `hermes chat -q "list my notes"` → hermes auto-loads plugin → invokes `ctrl_vault_list` → plugin reads handshake → POST to kernel MCP server → result back to hermes

No manual `hermes mcp add ctrl-kernel` required.

## 7. Update flow

Plugin updates follow the same channel as hermes plugins generally:

```sh
hermes plugins update ctrl   # checks PyPI, applies if newer
# OR
pip install --upgrade ctrl-hermes-plugin
```

Coordinated with CTRL.app updates via `compatibility.ctrl_app` envelope.

## 8. PWA Settings UX

The PWA's `Settings → Hermes Plugins` pane is a thin wrapper:

- Lists installed hermes plugins (read from `hermes plugins list --json`)
- Shows which profile each plugin is attached to
- Provides "open in hermes CLI" buttons (instructs user to run `hermes plugins ...`)
- Does NOT install/uninstall plugins itself (user runs `hermes` commands in their shell)

This is intentional — hermes is the source of truth for plugin state; CTRL only views it.

## 9. Failure modes

| Failure | Symptom | Recovery |
|---|---|---|
| Handshake file absent | `FileNotFoundError` on first plugin call | Restart CTRL.app (writes handshake on boot) |
| 401 from kernel | Plugin invalidates cache + retries once | If still fails, user sees error; restart CTRL.app |
| Kernel MCP server didn't bind (port 17873 conflict) | Plugin sees connection refused | CTRL.app logs surface the bind error; user investigates port use |
| hermes-agent version drift breaks plugin API | Plugin import fails / register() fails | Plugin re-pinned; PyPI update with new `requires.hermes_agent` |
| Tool name mismatch (kernel renamed, plugin not updated) | Specific tool errors `unknown tool` | Plugin update with matching tool name |

## 10. Security notes

- Bearer token in `~/.ctrl/state/kernel-handshake.json` mode 0600 — only the owning user can read
- Token rotates per kernel boot; an offline-captured token expires within hours
- Plugin calls go to `127.0.0.1` only — loopback, never LAN/WAN
- No CTRL user identity leaks to hermes — hermes only sees tool calls; user identity stays in CTRL Keychain (ADR-015 Obsidian philosophy)

## 11. Open questions

1. **Per-keycap tools** — when user installs a keycap, should the plugin auto-register a tool for it? Current: kernel exposes `keycap.invoke(id, params)` generically. Alternative: kernel surface dynamic tools and plugin reloads on keycap install. v1.1 decision.
2. **Streaming tool output** — kernel's `llm.chat` is non-streaming (per ADR-013); streaming is via Tauri events. Does the plugin need a streaming variant for hermes-side streaming UX? Investigate hermes plugin streaming primitives.
3. **Async-only handlers** — current handlers are sync (httpx.post). Should switch to `httpx.AsyncClient` when hermes plugin runtime is async-aware? Check hermes 0.14+ plugin docs.

## 12. Changelog

| Date | Change |
|---|---|
| 2026-05-23 | v0.1 — initial draft per ADR-019; plugin scaffold in `packages/ctrl-hermes-plugin/` |
