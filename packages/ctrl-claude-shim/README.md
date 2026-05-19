# @ctrl/claude-shim

OpenAI-compatible HTTP shim that wraps the local `claude` CLI. **Production path** for CTRL v1 Irisy: PWA → Tauri invoke → this shim → `claude` subprocess → Anthropic API.

## Why
- User runs CTRL with their own Claude subscription → **零边际 LLM 成本**
- Same shim plugs into Hermes / any OpenAI-shape client (v1.1 ready)
- `claude -p ... --output-format stream-json` already does authenticated agent calls

## Run

```bash
cd packages/ctrl-claude-shim
npm start
# server on http://localhost:8787
```

Env:
- `PORT` (default 8787)
- `CLAUDE_BIN` (default `claude`)
- `CLAUDE_DEFAULT_MODEL` (default `claude-haiku-4-5`)
- `CLAUDE_MAX_BUDGET_USD` (default `0.50` per request)
- `CLAUDE_SPAWN_CWD` (default `/tmp` — keeps spawn hermetic)

## Test

```bash
# health
curl http://localhost:8787/healthz

# streaming
npm run test:chat

# non-streaming
npm run test:nonstream
```

## Hermes config

Add to `~/.hermes/config.yaml`:

```yaml
custom_providers:
  - name: claude-cli
    base_url: http://localhost:8787/v1
    api_key: not-needed
    models:
      - claude-haiku-4-5
      - claude-sonnet-4-6
      - claude-opus-4-7
```

Then use: `hermes --provider custom:claude-cli ...`

## Limitations (v0.0.1)
- Multi-turn history flattened to "User: ... / Assistant: ..." prefixed text (not Claude's native message-turn format)
- No function calling translation (Hermes won't expect it from this provider for now)
- `temperature` / `max_tokens` ignored (Claude CLI doesn't expose them)
- Doesn't pre-warm a pool — every request is cold-spawn

## Next steps
1. Add `--mcp-config` passthrough so Hermes-routed keycap tools become Claude MCP tools (closes the loop with Hephaestus)
2. Process pool to amortize ~2 s cold start
3. Promote to `packages/ctrl-claude-shim/` and ship with CTRL desktop
