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

- **`chat_turn.py "message"`** — drives ONE full Irisy turn end-to-end via the
  dev-only `/debug/irisy/turn` endpoint (isolated engine), auto-approving any
  review the turn triggers. Verifies: think -> tool selection -> review pause ->
  approve -> answer. `python3 scripts/debug/chat_turn.py "write a note saying hi"`

- **`visual.mjs`** — renders the REAL React components in a browser (Vite :5173)
  with a MOCKED Tauri IPC (`window.__TAURI_INTERNALS__`), so the review modal,
  @-mention menu etc. render with fake data and can be screenshotted — the visual
  layer, no desktop app. `node scripts/debug/visual.mjs` (screenshots to
  /tmp/ctrl-debug/). Layer 2 of the harness.
