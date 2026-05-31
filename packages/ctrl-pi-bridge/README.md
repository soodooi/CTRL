# @ctrl/pi-bridge

Pi extension that routes Pi's LLM calls back into the CTRL kernel provider sub-system.

- ADR-003 — Brain (Pi is the sole core agent loop)
- ADR-004 §9.1 — Kernel provider sub-system (`/text-chat` endpoint)

## How it loads

CTRL's `shell/brain_supervisor.rs` spawns Pi with:

```
pi --extension /path/to/packages/ctrl-pi-bridge/src/index.ts
   env CTRL_PROVIDER_PORT=<port> CTRL_PROVIDER_TOKEN=<token>
```

Pi imports the default export, calls it with its `ExtensionAPI`, and we
register one provider:

```
api    = "ctrl-bridge"
models = ["default"]
streamSimple(model, ctx, opts) -> AsyncIterable<PiStreamEvent>
```

`streamSimple` POSTs `{ messages, model, capability }` to
`http://127.0.0.1:$CTRL_PROVIDER_PORT/text-chat`, parses SSE
(`delta`/`done`/`error`), and yields Pi-shaped events.

## Why this shape

Pi has no MCP-client surface (`grep mcp pi-mono/coding-agent/src/` = 0),
so the only seam to redirect Pi's LLM call through CTRL's provider
sub-system is `pi.registerProvider({ streamSimple })`. The bridge is
intentionally tiny (one file, no transitive deps beyond Pi's own API
surface) so upstream Pi version bumps either keep working or fail loudly
at extension-load time.
