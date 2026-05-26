# ctrl-hermes-plugin

CTRL workbench tools as a [hermes-agent](https://pypi.org/project/hermes-agent/) plugin — the primary hermes integration path for CTRL.

Per [ADR-019](../../.olym/decisions/019-ctrl-hermes-plugin-primary.md), this plugin is the recommended way to wire hermes-agent into a CTRL install. It auto-loads via pip entry-point + inherits hermes profile awareness / cron / logs / models for free.

## Install

```sh
pip install ctrl-hermes-plugin
```

On next hermes session start, the plugin loads automatically. Verify with:

```sh
hermes plugins list   # `ctrl` should appear with kind=tool
hermes tools list     # `ctrl_kernel_status`, `ctrl_vault_read`, etc.
```

## What it does

11 tools, each a thin shim that forwards to the kernel MCP server (`127.0.0.1:17873`) running inside CTRL.app:

| Tool | Purpose |
|---|---|
| `ctrl_kernel_status` | Health probe |
| `ctrl_vault_read/write/list/search` | User's Obsidian-compatible markdown vault |
| `ctrl_kv_get/set` | Per-keycap persistent JSON KV |
| `ctrl_llm_chat` | Non-streaming LLM completion via CTRL's LLM port |
| `ctrl_mcp_list_servers / proxy_list_tools / proxy_call_tool` | Reach external MCP servers the kernel has registered |

## How it works

1. CTRL.app boots its kernel and writes `~/.ctrl/state/kernel-handshake.json` (mode 0600) with `{ url, token }`.
2. On first tool call, the plugin reads the handshake and caches it.
3. Each tool call is an HTTP POST to the kernel MCP server with `Authorization: Bearer <token>`.
4. On 401 (kernel restarted, token rotated), the plugin drops its cache and retries once.

The plugin contains **zero business logic** — every operation flows through the kernel. This keeps the source of truth in one place (the Rust kernel) and makes the plugin trivially auditable.

## Requirements

- hermes-agent >= 0.14.0
- Python >= 3.11
- CTRL.app >= 1.0.0 running on the same machine
- Kernel MCP server reachable on `127.0.0.1:17873` (default)

## License

MIT — same as hermes-agent. See `../../LICENSE` of the CTRL repo.
