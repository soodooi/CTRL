---
adr_id: 001
title: 4-layer AI-native Agent OS kernel architecture (project doc + module index)
status: accepted
date: 2026-05-11
last_state_refresh: 2026-05-26
deciders: [bao, zeus]
module: spine
related:
  - .olym/decisions/002-pwa-pivot.md
  - .olym/decisions/003-multi-device-mesh.md
  - .olym/decisions/004-kernel-capability-surface.md
  - .olym/decisions/010-keycap-execution-model.md
  - .olym/decisions/013-kernel-as-mcp-server.md
  - .olym/steering/ctrl-strategy.md
scope: framework
supersedes: []
superseded_by: []
---

> **This is the CTRL project doc.** New session reads §1 Current state. Architecture spine is immutable in §3 Decision. All module-specific detail lives in `.olym/specs/<module>/SPEC.md` linked from §8 Module index.

---

## TL;DR

- **4 layers** — Tauri 2 shell · Rust kernel · SDK · keycaps (subprocess-isolated)
- **5 kernel primitives** — Actor / Capability / Channel / Event / Effect
- **5 keycap sources** — MCP · OAuth · local agent · ST-SS · builtin
- **Pi = sole brain** (a keycap with `target: brain`), inline brain router in kernel
- **Vault = plain-text** in `~/Documents/CTRL/`, MCP both inbound + outbound

---

## 1. Current state (2026-05-26)

### 1.1 4-layer stack

```
L3 Userland — subprocess-isolated keycaps via MCP (hardware, LLM call, OAuth flow, …)
       ↑↓
L2 SDK — @ctrl/{kernel-sdk, stss, memory, keycap-sdk}
       ↑↓
L1 CTRL Kernel — Rust microkernel
                 5 primitives + mcp_host (outbound) + mcp_server (inbound :17873)
                 + ST-SS WS (:17872) + vault_index (SQLite FTS5)
       ↑↓
L0 Tauri 2 Native Shell — ~500 LOC Rust
                          (hotkey / tray / window / keychain / kernel_supervisor)
       ↑↓ embeds WebView2 / WKWebView
PWA (packages/ctrl-web) — single web codebase
                          Tauri WebView (desktop) + browser (mobile)
```

### 1.2 5 primitives (`src-tauri/src/kernel/`)

| Primitive | File | Role |
|---|---|---|
| Actor | `actor.rs` · `subprocess_actor.rs` | subprocess-isolated runtime unit |
| Capability | `capability.rs` · `capability_resolver.rs` | typed kernel↔userland surface |
| Channel | `channel.rs` | bidi message stream |
| Event | `event.rs` | pub/sub bus |
| Effect | `effect.rs` | controlled side-effect proxy |

### 1.3 5 keycap sources (manifest `source:`)

1. **MCP servers** (10k+ Day-1, via `mcp_host.rs`)
2. **Big-platform OAuth** (Feishu / Notion / Linear / Slack / …)
3. **Local agents** (subprocess + portable-pty)
4. **ST-SS shared windows** (long-tail desktop + hardware, `stss_bridge.rs`)
5. **Builtin** (`packages/ctrl-keycaps/` ships with app; v1 starter pack ~15 keycaps)

### 1.4 Current brain

- **Pi** (`@ctrl/pi-plugin`, MIT, lazy npm install) = v1 **sole brain**
- A keycap with `target: brain`; kernel routes `text.chat` via inline brain router (`~/.ctrl/active-brain` → MCP server URL, ≤100 LOC)
- hermes (`@ctrl/hermes-plugin`) = optional personal-assistant keycap, **NOT** brain (ADR-019 superseded)

### 1.5 Current vault stack

- `~/Documents/CTRL/` = plain-text vault (truth)
- **Viewers**: Tiptap (markdown WYSIWYG+source) · CodeMirror 6 (code/JSON/YAML/TOML/HTML) · mermaid.js · iframe+CSP (HTML) · browser-native (SVG)
- **Index**: SQLite FTS5 (`kernel/vault_index.rs`) + tag/backlink scanners
- VMark = compatibility commitment, **not dependency** (S15 deprecated)

### 1.6 Module index (jump to detail)

| Module | Lane owner | SPEC entry | Key ADRs |
|---|---|---|---|
| **spine** | zeus | this file (§3) | 001 |
| **substrate** | hephaestus / zeus | [`.olym/specs/substrate/SPEC.md`](../specs/substrate/SPEC.md) | 003 · 004 · 007 · 012 · 013 |
| **cap** | hephaestus | [`.olym/specs/cap/SPEC.md`](../specs/cap/SPEC.md) | 010 · 011 · 018 |
| **irisy** | hephaestus | [`.olym/specs/irisy/SPEC.md`](../specs/irisy/SPEC.md) | 016 · 017 |
| **frontend** | daedalus | [`.olym/specs/frontend/SPEC.md`](../specs/frontend/SPEC.md) | 002 · 020 |
| **cross-cutting** | zeus | — | 005 · 014 · 015 |

ADR-019 (hermes-primary) superseded; ADR-006/008/009 reserved (not numbered file).

---

## 2. Context (immutable)

Solo founder building "ambient AI desktop entry" for CN OPC market. CTRL must host 10K+ MCP servers + creator-authored keycaps + hardware adapters without each becoming a custom integration. Existing precedents (Raycast, Coze, 豆包) either lack a creator economy, lack the protocol layer for 10K+ tool ecosystem, or aren't shippable into CN. Need an architectural frame that absorbs the variety at solo-team scale.

---

## 3. Decision (immutable spine)

Adopt a 4-layer kernel architecture with **5 primitives** (Actor / Capability / Channel / Event / Effect). Desktop runs a Rust microkernel (L1) under a thin Tauri 2 shell (L0); userland keycaps run as sandboxed actors (L3) consuming the kernel via L2 SDK. **5 keycap sources** integrate everything: MCP servers / Big-platform OAuth / Local agents / ST-SS shared windows / Built-in. **Default LLM** = CF Workers AI subscription (Qwen / Llama bundled); **BYOK** for Claude / GPT-4 / Volc Doubao / local Ollama (Pattern D, on-demand only).

---

## 4. 10 file-system invariants (ship-after immutable)

1. **One keycap = one directory** — `~/.ctrl/keycaps/<id>/` holds manifest + entry + assets + skills + patches + upstream record. `rm -rf` fully uninstalls; no registry to drift out of sync.
2. **Vault is sibling-structured** — `~/Documents/CTRL/{notes,assets/}`. Compatible with Obsidian / Logseq / VMark default layouts.
3. **`~/.ctrl/state/` is derivative** — `event-log.sqlite`, `vault-index.sqlite`, `cache/` rebuildable from vault + keycap manifests. Out of backup scope by design.
4. **Prompts are markdown** — `keycap.md` frontmatter + body, `assets/prompt.md`, `system-prompt.md` all plain text. vim-editable, git-diffable; agentskills.io standard.
5. **Secrets always go through macOS Keychain** — provider keys, OAuth tokens, mesh identity. `~/.ctrl/config.toml` carries only non-sensitive settings.
6. **Manifest is YAML frontmatter** — Zod-validated but plain text. User can hand-edit; CI/runtime validates.
7. **Mobile = IndexedDB queue + LRU evict + soft quota** — captures (photo / audio) enqueue immediately, upload-drain when mesh online. Capped and recycled, not "no binary asset".
8. **Backup source set** = `~/Documents/CTRL/` + `~/.ctrl/{keycaps, config.toml, mesh/identity}`. `cp -r` of the vault is sufficient for user content; CTRL state restores on next launch.
9. **Skills truth model** — `~/.ctrl/keycaps/<id>/skills/` is the **source**. `~/.ctrl/skills/<keycap-id>/<sub-id>/` is an **aggregated view** populated at install. Removing the keycap removes the view. Brain keycaps read source via `PI_SKILLS_PATH` / `HERMES_SKILLS_PATH` env injection (Windows-safe, no symlinks).
10. **v1.0 keycap runtime = `.ts` / `.js` only** — Tauri ships Node. Python / Rust / native binaries deferred to v1.x ADR.

---

## 5. Filesystem layout

### 5.1 User-facing (vault)

```
~/Documents/CTRL/                  VAULT (truth, plain markdown + assets)
├── notes/                         markdown
├── assets/{images,audio,pdf,attachments}/
└── ctrl.toml                      user-editable vault policy
```

### 5.2 CTRL runtime state (private)

```
~/.ctrl/                           RUNTIME state
├── config.toml                    provider keys ref + non-sensitive settings
├── keycaps/<id>/                  canonical keycap dir (see §5.3)
├── skills/<keycap-id>/            aggregated VIEW (read-only, GC'd on uninstall)
├── state/                         derivative — event-log / vault-index / automerge
├── cache/
│   ├── thumbnails/
│   ├── llm/
│   └── keycap-upstream/<id>/<lock_version>/   base for 3-way patch merge
├── mesh/peers.json + identity
└── active-brain                   single file, holds "pi" or other brain keycap id
```

### 5.3 Canonical keycap directory

```
~/.ctrl/keycaps/<id>/
├── keycap.md                manifest (YAML frontmatter + markdown body)
├── mcp-server.{ts,js}       entry executable (kernel spawn target)
├── package.json             Node deps (optional)
├── assets/
│   ├── icon.svg             12-grid icon (always required)
│   ├── icon.lottie          optional animation
│   ├── prompt.md            LLM prompt template (vim-editable)
│   ├── few-shots.json       examples
│   ├── system-prompt.md     optional persona override
│   └── tool-schema.json     MCP tool schema (Zod-derived)
├── skills/<sub-id>/         keycap-bundled SKILL.md (truth)
├── config.toml              Config-tier adjustments (user-editable; stays in sync with upstream)
├── patches/                 Patch-tier overrides (3-way merge on upgrade)
│   └── prompt.md.patch
├── upstream.json            { source, channel, lock_version } — drives upgrade
└── README.md
```

### 5.4 Secrets

macOS Keychain = sole truth for provider keys / OAuth tokens / mesh-device-key.

### 5.5 App bundle (`CTRL.app/Contents/Resources/`)

- `ctrl-web/` — PWA static (Vite build, ≤ 500 KB gzip critical path)
- `keycaps/` — v1 builtin keycaps (15 starter), first-run idempotent copy to `~/.ctrl/keycaps/`
- `brand/` — icon / logo / splash (promoted from `doc/visual-identity/`)
- `third-party/LICENSES` — MIT compliance (Pi / hermes / Tiptap / CodeMirror / mermaid / etc.)

First-run policy: target exists + `.ctrl-user-modified` marker → skip; no marker → safe to refresh from bundle.

---

## 6. Design philosophy locks (release/0.1.39 — canonical for v1)

1. **Subprocess + Tauri ACL > WASM** — re-use Tauri Capability + Isolation Pattern + CSP; don't double-sandbox. (Research-cited: Shayon 2026 sandbox isolation; Wasmer comparison; Raycast/VSCode/Obsidian all use process isolation.)
2. **Kernel atomic, composition in brain/skill** — kernel commands are one-shot per derived rule #4 ("One-shot, not flows"); multi-step workflow lives in Pi agent loop or user-authored hermes SKILL.md, not kernel.
3. **MCP is the tool wire** — both inbound (kernel as MCP server, ADR-013) and outbound (kernel as MCP host, ADR-010).
4. **Lean kernel** — only ship substrates v1 actually uses; defer unused with explicit comment + research-cited rationale (no speculative "we'll need it later"). v1.x WASM re-eval target: WasmEdge (8MB, 1.5ms cold start) not wasmtime (80MB+).

---

## 7. Acceptance status

### Done (current state §1 covers these)

- [x] 5 primitive Rust modules — `src-tauri/src/kernel/{actor,capability,channel,event,effect}.rs`
- [x] 5 keycap source types documented (`.olym/steering/ctrl-strategy.md`)
- [x] LLM Pattern D wired (CF Workers AI subscription + BYOK)
- [x] Repo topology lock — single deliverable repo + ctrl-cloud separate
- [x] Anti-list (CTRL is NOT, §10 Consequences)
- [x] Brain layer — Pi sole brain via keycap, inline brain router
- [x] Vault stack — Tiptap + CodeMirror 6 + mermaid.js + FTS5
- [x] File-system canonical layout (10 invariants)
- [x] Lean kernel — wasmtime/cranelift/sandbox.rs/composition.rs removed
- [x] Kernel-as-MCP-server @ :17873 (ADR-013)
- [x] `ctrl-asset://` custom scheme handler

### Open / in-flight (tracked elsewhere)

- [ ] Kernel capability surface 7/7 (ADR-004 currently `proposed` 3/7)
- [ ] v1 starter keycap pack (`packages/ctrl-keycaps/` skeleton only; tracked in `doc/brainstorm-workbench-flexibility-2026-05-26.md` G1)
- [ ] Auto-update keycap channel (ADR-018 layer 3 not wired; layer 1 Tauri updater done in 0.1.41)
- [ ] Mesh end-to-end (ADR-003 in flight, hephaestus lane)
- [ ] Irisy spec re-spec (`.olym/specs/irisy/spec.md` still references hermes-as-brain, superseded by §1.4)

---

## 8. Module index → SPEC entry points

Each module has its own SPEC.md as the entry; sub-specs (e.g. `.olym/specs/kernel/`, `.olym/specs/tool-manifest/`, etc.) remain in place and are linked from each SPEC.

| Module | SPEC | Owns ADRs | Adjacent sub-specs (linked from SPEC) |
|---|---|---|---|
| substrate | `.olym/specs/substrate/SPEC.md` | 003 mesh · 004 capability surface · 007 vodozemac · 012 SubprocessActor · 013 kernel-as-MCP | `kernel/` · `mesh-comm/` · `stss-protocol/` |
| cap | `.olym/specs/cap/SPEC.md` | 010 keycap MCP outward · 011 updater · 018 auto-update | `tool-manifest/` · `keycap-base-layer/` · `creator-economy/` |
| irisy | `.olym/specs/irisy/SPEC.md` | 016 8-stage lifecycle · 017 remote co-view | `irisy/spec.md` (drift, see Open above) |
| frontend | `.olym/specs/frontend/SPEC.md` | 002 PWA pivot · 020 VMark stack | `pwa-shell/` · `pwa-workstation/` |
| cross-cutting | (no module SPEC) | 005 no-claude · 014 global-English · 015 plain-text | — |

---

## 9. Alternatives considered (immutable)

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Raycast clone (curated tool launcher) | No moat — Raycast already won English creator market; doesn't capture creator economy; can't host 10K+ MCP servers |
| A2 | Single-purpose AI chat (豆包-style consumer app) | No protocol layer; can't sell to creators; loses to ByteDance distribution power |
| A3 | Workflow editor (Coze / n8n) | Coze owns that segment; visual graph editing wrong abstraction for OS entry (user thinks "Ctrl + 1 key" not "drag nodes") |
| A4 | Pure WASM sandboxed plugin model (original ADR draft) | Forces every keycap to WASM-compile; cuts off MCP ecosystem; creator barrier too high. Later resolved by ADR-010. |

---

## 10. Consequences (immutable)

**Positive**:
- Protocol-shaped scaling (new integrations = +1 source under existing contract, not custom code)
- Creator economy enabled (manifest = declarative API)
- Hardware-ready (ST-SS source class anchors future hardware adapters)
- Architectural ceiling absorbs CTRL's stated ambition without later structural redesign

**Negative / cost**:
- ~6 months upfront kernel work before user-facing value
- Every keycap creator must understand actor model + capability declaration to author
- Solo founder must steward 5 primitives' integrity through every subsequent decision

**Reversal cost**:
- One-way door. This is the spine — every subsequent ADR + every line of `src-tauri/src/kernel/` references the 5 primitives + 5 sources. Reversing would discard ~10K LOC Rust kernel + every manifest contract + every SDK package. Not reversible after v1 ship.

**Anti-list (what CTRL is NOT)**:

| Don't | Why |
|---|---|
| Workflow editor | Coze / n8n 已经做了 |
| 自己造硬件 | Solo + 资本错配 |
| 100+ 长尾 platform adapter | ST-SS 给创作者自己接 |
| Quicker 8000 长尾 clone | 不可能赢 |
| ChatGPT GPTs 接入 | API 不开放 |
| 多 tenant SaaS | Pandagooo 那条线, 不混 |
| AI chat app | Workbench framing, AI 是 pipe 不是 sidebar |

---

## 11. Spine evolution — 4 校准 (2026-05-25) narrative

This ADR was amended 4× during 2026-05-25's 灵活开发 window. The original Decision body (5 primitives / 4 layers / 5 sources) remains untouched; below summarizes WHAT changed in each校准 and points to the active narrative sections above (§1, §4-6).

### 1st 校准 — Pi-as-sole-brain + VMark-not-substrate

- Brain layer: hermes-as-brain framing (2026-05-22) → Pi sole brain
- Vault substrate: VMark MCP sidecar → CTRL-native (Tiptap + CodeMirror 6 + mermaid.js + FTS5)
- ADR-019 (hermes-primary) superseded
- ⤴ Active sections: §1.4 Current brain · §1.5 Current vault stack

### 2nd 校准 — File-system canonical layout + brain-as-keycap

- Codified 10 file-system invariants (one-keycap-one-directory, vault sibling-structured, `~/.ctrl/state/` derivative, etc.)
- Brain framed as "keycap with `target: brain`" — not kernel module
- Manifest schema gains `target` (mcp-tool | hermes-skill | brain), `capability`, `bridge`, `provider_passthrough` (see `.olym/specs/tool-manifest/spec.md` §13)
- ⤴ Active sections: §4 invariants · §5 Filesystem layout · §1.6 Module map

### 3rd 校准 (release/0.1.37) — plan-vs-actual reconciliation

6 gaps fixed in single ship:
1. Vault default path migrated `~/.ctrl/vault/` → `~/Documents/CTRL/` (+ auto-create sibling layout + legacy migration)
2. Kernel-as-MCP-server (`mcp_server.rs` @ 17873) merged — restores ADR-013
3. Composition runtime (`composition.rs`) merged — later removed in 4th 校准
4. `packages/ctrl-hermes-plugin/` brought into release branch
5. `brand/` promoted top-level from `doc/visual-identity/`
6. Legacy `src-tauri/src/actors/` removed (W3-era hexagonal arch, dead)

`packages/ctrl-keycaps/` skeleton added as future builtin source-of-truth.
- ⤴ Active sections: §5 Filesystem layout · §7 Acceptance status

### 4th 校准 (release/0.1.39) — kernel lean + Design Philosophy

Web-researched 2026 industry signals (Shayon sandbox isolation, Wasmer comparison, Tauri 2 Security docs) confirm: WASM can't uniformly sandbox mixed-language subprocesses; Tauri 2 already provides Capability + Isolation Pattern + CSP; MCP is 2026 industry-standard tool protocol; WasmEdge is the right v1.x WASM choice if needed.

**Removed**:
- `kernel/sandbox.rs` + wasmtime + cranelift deps (0 usage in v1)
- `kernel/composition.rs` (0 usage, violates derived rule #4 "One-shot, not flows")
- Ollama from default LLM fallback chain (BYOK still works on demand)

**Locked**: 4 Design Philosophy principles → §6.

- ⤴ Active sections: §6 Design philosophy locks

### Appendix A — Decision log E-series (hephaestus review acceptance, 2nd校准)

| # | Item | Decision |
|---|---|---|
| E1 | `ctrl-hermes-plugin` visibility | Exists on `feat/h-2026-05-22-kernel-mcp-server`; appears on `keycap-dev` post-rebase. Not a fact error — branch divergence. |
| E2 | Invariant count | Codified as 10 above (was loosely 6/8). |
| E3 | Mobile cache lifecycle | IndexedDB queue + LRU evict + explicit quota; "soft cap" surfaces in PWA. |
| E4 | Skills truth model | Bundled SOURCE in `~/.ctrl/keycaps/<id>/skills/`; aggregated VIEW in `~/.ctrl/skills/`. |
| E5 | Windows symlink risk | Eliminated — brain keycaps read source path via env injection, no symlinks required. |
| E6 | Patch base | `~/.ctrl/cache/keycap-upstream/<id>/<lock_version>/` holds upstream tarball for 3-way merge. |
| E7 | Multi-runtime entry | v1.0 = `.ts`/`.js` only. Python / Rust deferred to v1.x ADR. |
| E8 | Vault path customisation | `~/.ctrl/config.toml [vault] path` (default `~/Documents/CTRL/`); user may relocate. |
| E9 | First-run vault init wizard | First-screen flow: "Create new / Use existing / Skip". daedalus owns. |
| E10 | `~/.ctrl/state/` derivative status | Made an invariant (#3 in §4). Backup scope clarified (#8 in §4). |

Mesh identity: Keychain is sole truth. `~/.ctrl/mesh/identity` mirror only if vodozemac SDK strictly requires file path (verify before implementing); if mirrored, 0600 + ADR note.

### Appendix B — Decision log D-series (daedalus PWA ripple, 2nd校准)

| # | Item | Decision |
|---|---|---|
| D1 | `list_keycaps` envelope expansion | Add `target` / `source` / `adjustment` / `config_schema` / `upstream` fields. zeus owns kernel side. |
| D2 | Keycap-bundled assets transport | New Tauri custom scheme `ctrl-asset://` — zeus implements protocol handler. Replaces invoke + base64. |
| D3 | Viewer registry dimensions | Triple-axis: `source: 'vault' \| 'keycap' \| 'system'` + `editable: boolean` + `onSave` handler. Not mime alone. |
| D4 | PDF sidecar transport | Viewer loads `<file>.pdf` (binary) + `<file>.pdf.md` (sidecar) together. Registry adds `companion?: string`. |
| D5 | Mobile cache invariant | See invariant #7 in §4 (D5 motivated the invariant rewrite). |
| D6 | `first_run_state` field | `kernel_status.first_run_state ∈ { copying, ready }` surfaces in PWA empty state UI. |

### Appendix C — PWA surface deltas (daedalus design-lead, 2nd校准)

- Pool card: source / target badge + 3-tier adjustment badge (Config / Patch / Fork) + upgrade dot.
- Settings: keycap-level update inventory, distinct from app-level updates.
- Pool detail side-pane: open `keycap.md` / `prompt.md` for editing via the viewer registry (location=`keycap`, editable=true).
- Dev workflow: `CTRL_KEYCAP_DEV_PATH` env redirects `~/.ctrl/keycaps/` → `packages/ctrl-keycaps/`; auto-on when `NODE_ENV=development`.

### Appendix D — Open follow-ups (2nd校准 trail, not blockers)

- 4 ship blockers in Pi plugin (B1 RPC degrade re-emit / B2 Win detect / B3 Win shebang + Node 20 strip-types / B4 main → dist) — recorded in commit 202bfc9 body
- `pnpm-lock.yaml` / `pnpm-workspace.yaml` appeared in `packages/ctrl-web/` working tree on 2026-05-25; CLAUDE.md mandates npm workspaces — left untracked pending bao decision

---

## 12. Changelog

| Date | Change |
|---|---|
| 2026-05-11 | Initial accept (bao) — frame lock for CTRL v1 scope |
| 2026-05-13 | ADR-002 supersedes UI/rendering portion (§3.1) |
| 2026-05-14 | ADR-003 supersedes cross-device sync portion (§6 #18) |
| 2026-05-17 | ADR-010 resolves WASM-vs-MCP plugin model question; spine remains |
| 2026-05-18 | Rewrite to olym 0.3.1 ADR format (Context/Decision/Alternatives/Consequences/Acceptance/Changelog) |
| 2026-05-18 | Clarification (no policy change): "Default LLM = CF Workers AI + Doubao" 实际 = CF subscription bundled Qwen/Llama; Doubao = BYOK Volc path |
| 2026-05-22 | Amend: hermes-as-brain framing (later superseded by 1st 校准); ADR-013/014/015 land as protocol/positioning/philosophy locks |
| 2026-05-25 | **1st 校准**: Pi-as-sole-brain + hermes-as-keycap + VMark-not-substrate. Supersedes 2026-05-22 hermes-as-brain. ADR-019 superseded. |
| 2026-05-25 | **2nd 校准**: File-system canonical layout, 10 invariants, brain-as-keycap framing (E1–E10 + D1–D6 logs). |
| 2026-05-25 | **3rd 校准** (release/0.1.37): plan-vs-actual reconciliation (6 gaps fixed). |
| 2026-05-25 | **4th 校准** (release/0.1.39): kernel lean — sandbox.rs/composition.rs/wasmtime/cranelift removed, Ollama out of default chain. Design Philosophy locked (4 principles). |
| 2026-05-26 | **Restructure as project doc**: §1 Current state added on top, immutable spine (§2-3, §9-10) preserved verbatim, 4 校准 consolidated into §11 narrative + appendices. Module index (§1.6, §8) added — 4 module SPEC.md entries created at `.olym/specs/{substrate,cap,irisy,frontend}/SPEC.md`. Every other ADR (002-020) gets `module:` frontmatter field. |
