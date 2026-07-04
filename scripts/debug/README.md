# CTRL debug harness

Autonomous verification of CTRL/Irisy without a desktop click. See the plan in
`vault/ctrl/debug-harness-plan.md`. The kernel must be running (dev build) — the
gate token is read from `~/.ctrl/state/gate-token`.

- **`capabilities.py`** — drives every core gate capability over `:17873` (HTTP MCP)
  and asserts a correct return. Exit 0 = all green (DEGRADE = a correct
  setup-needed reply). `python3 scripts/debug/capabilities.py`

Review-gate E2E (brain write → pause → external approve/deny) uses the dev-only
debug endpoints `GET /debug/review/pending` + `POST /debug/review/resolve`
(kernel `mcp_server.rs`, on in `debug_assertions` builds).
