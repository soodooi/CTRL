# @ctrl/mcp-sdk

Single stable interface for any CTRL client that consumes mcps (Irisy /
PWA components / future Janus persona / 3rd-party).

The transport beneath — Anthropic MCP server, Tauri direct command, REST —
is hidden. Per ADR-010, mcps are MCP servers outward; builtin / OAuth-wrap
variants currently dispatch via Tauri. This SDK normalises both.

## API (3 methods)

```ts
import { listMcps, invokeMcp, onMcpEvent } from '@ctrl/mcp-sdk';

// 1. discover what's installed
const mcps = await listMcps();
// → [{ id, name, description, tools[], variant, platforms? }]

// 2. invoke a tool
const result = await invokeMcp(
  'ctrl.builtin.screenshot',
  'capture_region',
  {},
);
// → { status: 'ok' | 'error' | 'cancelled' | 'permission_denied', data?, error? }

// 3. subscribe to lifecycle events
const unsub = await onMcpEvent((e) => {
  // { mcpId, kind: 'started' | 'progress' | 'output' | 'completed' | 'failed', ts, payload? }
});
unsub();
```

## What consumers DON'T need to know

- Whether the mcp is a Node MCP server, Python MCP server, builtin Rust
  actor, OAuth-wrapped REST API, or a CLI wrapper
- Whether it runs locally via stdio or remotely via HTTP
- Manifest schema details (those are creator-side concerns)

## Adding a new mcp

Use the CLI scaffold:

```sh
npx ctrl new-mcp my-tool --ts
cd my-tool && npm install && npm run dev
```

The SDK auto-discovers it via the kernel's `list_tools` command.

## See also

- ADR-010: mcp execution model (MCP outward, actor inward)
- `packages/ctrl-cli`: scaffold + dev + publish
- `share/modules/builtin/*`: existing 16 builtin mcps as reference
