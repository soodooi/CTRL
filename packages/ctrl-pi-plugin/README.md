# @ctrl/pi-plugin

> Pi → MCP wrapper. Exposes [Pi](https://github.com/badlogic/pi-mono)
> (a minimalist coding agent) as a CTRL **brain keycap** so Irisy and
> any other MCP client can call it through the standard `text.chat`
> capability.

**Status**: 0.1.0, ships as CTRL's default brain per H-2026-05-25-001
(bao verbal-go 2026-05-25).

## Why this exists

CTRL keycap manifests have a `target` axis (orthogonal to `variant`):

- `target: mcp-tool` — most keycaps (90%). One-shot tool call.
- `target: hermes-skill` — optional, rich SKILL.md-driven keycaps.
- **`target: brain`** — pluggable agent runtime. **This package**.

The keycap manifest says "use `text.chat`"; the bridge translates that
into a Pi subprocess invocation, streams tokens back as MCP progress
events, and lets Pi own its own LLM provider config. CTRL is
provider-passthrough for brain keycaps — we do not stash a second copy
of the user's API keys.

## What's in here

| File                              | Purpose                                                                |
| --------------------------------- | ---------------------------------------------------------------------- |
| `src/pi-detect.ts`                | Locate the user's `pi` binary (env / PATH / `~/.local/bin` / `npx`).   |
| `src/pi-bridge.ts`                | Spawn Pi (`pi rpc` preferred, `pi -q --json` fallback). Stream tokens. |
| `src/mcp-server.ts`               | Tiny streamable-HTTP MCP server. One tool: `text.chat`.                |
| `bin/ctrl-pi-mcp.ts`              | CLI entrypoint. Prints `{event:"ready", url, mcp, health}` on stdout.  |
| `keycap.md`                       | Manifest template — copied to `~/.ctrl/keycaps/pi/` at install time.   |

## Install Pi (one-time, user-side)

The bridge does **not** bundle Pi (lazy install — same pattern CTRL uses
for hermes). Pick one:

```bash
npm i -g @earendil-works/pi-coding-agent          # preferred — single global binary
npm i --prefix ~/.local @earendil-works/pi-coding-agent   # per-user install
# or just have npx around; the bridge falls back to `npx pi` on demand.
```

The bridge auto-detects in this order:

1. `$CTRL_PI_BIN` env var
2. `pi` on `$PATH`
3. `~/.local/bin/pi`
4. `npx pi`

If none resolve, `tools/call text.chat` returns JSON-RPC error code
`-32004` with an install hint. Irisy surfaces that as a one-tap "install
Pi" toast.

## Run the MCP server

```bash
cd packages/ctrl-pi-plugin
npm start
# {"event":"ready","url":"http://127.0.0.1:17874","mcp":"http://127.0.0.1:17874/mcp",...}
```

Env knobs:

| Var              | Default       | Purpose                                  |
| ---------------- | ------------- | ---------------------------------------- |
| `CTRL_PI_PORT`   | `17874`       | Server bind port.                        |
| `CTRL_PI_HOST`   | `127.0.0.1`   | Server bind host (loopback by default).  |
| `CTRL_PI_TOKEN`  | _(none)_      | Required `Authorization: Bearer …` token. Omit for loopback no-auth. |
| `CTRL_PI_BIN`    | _(auto)_      | Explicit Pi binary path.                 |

## Smoke test

```bash
# liveness
curl -s http://localhost:17874/healthz

# non-streaming call
npm run test:chat

# streaming call (SSE)
curl -sN -H 'Accept: text/event-stream' \
  -X POST http://localhost:17874/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":1,
    "method":"tools/call",
    "params":{
      "name":"text.chat",
      "arguments":{"messages":[{"role":"user","content":"hi"}]}
    }
  }'
```

Expected SSE timeline:

```
event: delta
data: {"delta":"Hi"}

event: delta
data: {"delta":"!"}

event: done
data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Hi!"}],"isError":false,"_meta":{"transport":"rpc","duration_ms":421}}}
```

## Pi RPC vs print mode

We probe `pi rpc` first (long-running NDJSON server — token-stream cheap).
On failure (Pi too old, RPC subcommand missing) we degrade silently to
`pi -q "<prompt>" --json` print mode for the rest of the bridge's life.
The active transport surfaces under `healthz.transport` (`rpc` or `print`).

## MIT compliance

Pi is MIT-licensed. Per `decision_hermes_mit_compliance` (same pattern
applies to any MIT brain runtime we lazy-install):

1. `THIRD_PARTY_LICENSES.md` ships beside this README.
2. The CTRL "About" pane lists "Powered by Pi Agent (MIT)".
3. CTRL does **not** fork / modify Pi source — we always invoke the
   user-installed binary.

## What we deliberately do NOT do

- ❌ Bundle Pi binaries. Pi is the user's tool; CTRL augments it.
- ❌ Re-implement Pi's provider config. Pi owns `~/.pi/config`.
- ❌ Wrap Pi as a hermes skill. Pi competes with hermes at the agent-
  runtime layer — they're peers, not nested.
- ❌ Cache Pi's responses outside the kernel event log. The kernel's
  audit-first event stream is the only persistent record.
