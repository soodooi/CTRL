---
adr_id: 001
module: spine
title: CTRL spine — 4-layer kernel + 5 primitives + 5 keycap sources + Pi-centric 5-block reframe
version: 1
status: accepted
last_updated: 2026-05-31
deciders: [bao, zeus]
sections:
  - { id: layers,      source: orig-001-§3 }
  - { id: primitives,  source: orig-001-§1.2 }
  - { id: sources,     source: orig-001-§1.3 }
  - { id: pi-centric,  source: orig-001-§11-6th }
  - { id: invariants,  source: orig-001-§4 }
  - { id: philosophy,  source: orig-001-§6 }
changelog:
  - v1 2026-05-31: module reorg — merged from numbered ADR-001 (4-layer + 5 primitives + 5 sources + Pi-centric reframe + 10 invariants + design philosophy locks). 21 numbered ADRs collapsed into 7 module ADRs; this is the spine.
related:
  - .olym/decisions/002-substrate.md
  - .olym/decisions/003-frontend.md
  - .olym/steering/ctrl-strategy.md
---

> **Spine — immutable**. New session reads §1. All module-specific detail in module ADR + `.olym/specs/<module>/SPEC.md`.

## §1 Layers — 4-layer stack (physical topology)

```
L3 Userland — subprocess-isolated keycaps via MCP
       ↑↓
L2 SDK — @ctrl/{kernel-sdk, stss, memory, keycap-sdk}
       ↑↓
L1 CTRL Kernel — Rust microkernel
                 5 primitives + mcp_host (out) + mcp_server :17873 (in)
                 + ST-SS WS :17872 + vault_index (SQLite FTS5)
                 + provider sub-system (ADR-002 § provider)
       ↑↓
L0 Tauri 2 Native Shell — ~500 LOC Rust
                          (hotkey / tray / window / keychain / kernel_supervisor)
       ↑↓ embeds WebView2 / WKWebView
PWA — single web codebase (Tauri WebView desktop + browser mobile)
```

## §2 Primitives — 5 (`src-tauri/src/kernel/`)

| Primitive | File | Role |
|---|---|---|
| Actor | `actor.rs` · `subprocess_actor.rs` | subprocess-isolated runtime unit |
| Capability | `capability.rs` · `capability_resolver.rs` | typed kernel↔userland surface |
| Channel | `channel.rs` | bidi message stream |
| Event | `event.rs` | pub/sub bus |
| Effect | `effect.rs` | controlled side-effect proxy |

## §3 Keycap sources — 5

1. **MCP servers** (10k+ Day-1, via `mcp_host.rs`)
2. **Big-platform OAuth** (Feishu / Notion / Linear / Slack / …)
3. **Local agents** (subprocess + portable-pty, ADR-002 § subprocess)
4. **ST-SS shared windows** (long-tail desktop + hardware, `stss_bridge.rs`)
5. **Builtin** (`packages/ctrl-keycaps/` ships with app)

## §4 Pi-centric 5-block view (logical, co-exists with §1)

```
USER ↔ ui-ux (PWA, Irisy 表达) ↔ KERNEL ↔ Pi ★ (sole brain) ↔ { PROVIDER (LLM) · KEYCAP (tool) }
```

- **ui-ux** — PWA, single React 18 + Vite 5 + TanStack codebase (ADR-003)
- **KERNEL** — Rust microkernel + sub-systems (ADR-002)
- **Pi** ★ — sole agent loop (ADR-002 § brain). Hermes fully removed 2026-05-28.
- **PROVIDER** — LLM adapters Pi calls (ADR-002 § provider)
- **KEYCAP** — tools Pi invokes via MCP (ADR-004)

Two views are not mutually exclusive: §1 = process / binary boundary; §4 = role in Irisy's run.

## §5 Filesystem invariants (10 — ship-after immutable)

1. One keycap = one directory `~/.ctrl/keycaps/<id>/`. `rm -rf` fully uninstalls.
2. Vault sibling-structured `~/Documents/CTRL/{notes,assets/}`. Obsidian / VMark default compatible.
3. `~/.ctrl/state/` is derivative (event-log / vault-index / cache). Out of backup scope.
4. Prompts are markdown (vim-editable, git-diffable, agentskills.io standard).
5. Secrets → macOS Keychain. `~/.ctrl/config.toml` non-sensitive only.
6. Manifest = YAML/TOML frontmatter. Zod-validated, plain text.
7. Mobile = IndexedDB queue + LRU evict + soft quota.
8. Backup source = `~/Documents/CTRL/` + `~/.ctrl/{keycaps,config.toml,mesh/identity}`.
9. Skills truth model — `~/.ctrl/keycaps/<id>/skills/` source; `~/.ctrl/skills/<keycap-id>/<sub-id>/` aggregated view.
10. v1.0 keycap runtime = `.ts` / `.js` only. Python / Rust deferred.

## §6 Design philosophy locks

1. **Subprocess + Tauri ACL > WASM** — Tauri Capability + Isolation + CSP, no double-sandbox.
2. **Kernel atomic, composition in brain/skill** — one-shot per kernel call.
3. **MCP is the tool wire** — inbound (kernel-as-MCP-server) + outbound (kernel-as-MCP-host).
4. **Lean kernel** — only what v1 uses; v1.x WASM target = WasmEdge if ever needed.

## §7 Anti-list (what CTRL is NOT)

Workflow editor (Coze/n8n own that) · 自己造硬件 · 100+ 长尾 platform adapter · Quicker 8000 clone · ChatGPT GPTs 接入 · 多 tenant SaaS · AI chat app (workbench framing).

## Acceptance

- [x] 5 primitive Rust modules in `src-tauri/src/kernel/{actor,capability,channel,event,effect}.rs`. Verified.
- [x] 5 keycap source types documented. Verified.
- [x] Repo topology — single deliverable repo + ctrl-cloud separate. Verified.
- [x] Pi sole brain via kernel routing (ADR-002 § brain). Verified v0.1.124.
- [x] Vault stack — Tiptap + CodeMirror 6 + mermaid.js + FTS5 (ADR-003). Verified.
- [x] Lean kernel — wasmtime / cranelift / sandbox.rs / composition.rs removed. Verified.
- [x] Kernel-as-MCP-server @ :17873 (ADR-002 § mcp-bus). Verified.
- [x] Provider router shipped v0.1.126 (ADR-002 § provider v1). Verified 2026-05-31.

## Provenance

Original ADR-001 v1.x (2026-05-11 → 2026-05-30) — 4-layer architecture + 5 primitives + 5 sources + 6 校准 narrative. Full校准 history preserved in git log; this v1 keeps the load-bearing decisions only.
