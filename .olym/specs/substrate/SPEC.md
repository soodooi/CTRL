---
module: substrate
purpose: Kernel + sandbox + mesh + transport — the system layer everything else stands on
lane_owner: hephaestus + zeus (kernel internals)
sub_specs:
  - .olym/specs/kernel/
  - .olym/specs/mesh-comm/
  - .olym/specs/stss-protocol/
  - .olym/specs/infrastructure.md
---

# substrate — module SPEC

> Entry page. Links to ADRs + sub-specs + code paths. Detail lives in linked docs, not here.

---

## What this module is

The L0 + L1 layers: Tauri 2 native shell + Rust microkernel (5 primitives) + outbound MCP host + inbound MCP server + ST-SS bridge + vault index + mesh thin-wire. Everything above (cap / Irisy / frontend) consumes this module's capability surface.

## Code paths

- `src-tauri/src/shell/` — L0 Tauri shell (hotkey · tray · window · keychain · kernel_supervisor · lifecycle)
- `src-tauri/src/kernel/` — L1 Rust kernel (5 primitives + mcp_host + mcp_server + vault + vault_index + persistence + stss_bridge + scheduler + subprocess_actor)
- `src-tauri/src/commands/` — Tauri `#[command]` handlers (PWA invoke surface)
- `src-tauri/src/asset_scheme.rs` — `ctrl-asset://` custom scheme
- `packages/ctrl-kernel-sdk/` — L2 TS syscall surface (mirrors Rust kernel)
- `packages/ctrl-stss/` — ST-SS protocol TS
- `packages/ctrl-mesh/` — mesh comm TS (in flight)

## Owned ADRs

| ADR | Title | Status |
|---|---|---|
| [003](../../decisions/003-multi-device-mesh.md) | Mesh cross-device comm (vodozemac + Automerge + ctrl-relay) | accepted |
| [004](../../decisions/004-kernel-capability-surface.md) | Kernel capability surface — 10 namespaces / 28 methods | **proposed 3/7** |
| [007](../../decisions/007-encryption-library.md) | vodozemac (Matrix Olm) for E2E crypto | accepted |
| [012](../../decisions/012-subprocess-actor-pty.md) | SubprocessActor + portable-pty for Code Space | accepted |
| [013](../../decisions/013-kernel-as-mcp-server.md) | Kernel as MCP server (:17873) | accepted |

Cross-references: ADR-001 §1.1/§1.2 (4-layer + 5 primitives), §5 (filesystem), §6 (lean kernel principles).

## Adjacent sub-specs (drill down)

- `.olym/specs/kernel/` — kernel detailed design
- `.olym/specs/mesh-comm/` — mesh wire / handshake / sync
- `.olym/specs/stss-protocol/` — ST-SS CBOR Cell/Op
- `.olym/specs/infrastructure.md` — Tokyo VPS + Caddy + Postgres (hermes runtime hosting)

## Current state (2026-05-26)

✅ shipped:
- 5 primitives + capability resolver + scheduler
- MCP host (outbound, ADR-010) + MCP server (inbound :17873, ADR-013)
- SubprocessActor + portable-pty (ADR-012)
- vault root (`~/Documents/CTRL/`) + FTS5 index + tag scanner
- ctrl-asset:// scheme
- ST-SS bridge @ :17872 with token auth
- Lean kernel pass (sandbox.rs/composition.rs/wasmtime removed)

⚠️ open:
- Kernel capability surface 3/7 (ADR-004 still `proposed`) — needs 4 more namespace closures + spec land
- Mesh end-to-end (ADR-003) — hephaestus lane in flight, `packages/ctrl-mesh/` stub
- `current_context` primitive (gap G2 in brainstorm doc) — not in surface yet

## Known drift / dead refs

- None currently. Substrate ADRs match `src-tauri/src/kernel/` as of release 0.1.41.
