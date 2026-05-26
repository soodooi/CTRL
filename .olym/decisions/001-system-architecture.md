---
adr_id: 001
title: Adopt 4-layer AI-native Agent OS kernel architecture
status: accepted
date: 2026-05-11
deciders: [bao, zeus]
related:
  - .olym/decisions/002-pwa-pivot.md
  - .olym/decisions/003-multi-device-mesh.md
  - .olym/decisions/010-keycap-execution-model.md
  - .olym/steering/ctrl-strategy.md
scope: framework
supersedes: []
superseded_by: []
---

## Context

Solo founder building "ambient AI desktop entry" for CN OPC market. CTRL must host 10K+ MCP servers + creator-authored keycaps + hardware adapters without each becoming a custom integration. Existing precedents (Raycast, Coze, 豆包) either lack a creator economy, lack the protocol layer for 10K+ tool ecosystem, or aren't shippable into CN. Need an architectural frame that absorbs the variety at solo-team scale.

## Decision

Adopt a 4-layer kernel architecture with **5 primitives** (Actor / Capability / Channel / Event / Effect). Desktop runs a Rust microkernel (L1) under a thin Tauri 2 shell (L0); userland keycaps run as sandboxed actors (L3) consuming the kernel via L2 SDK. **5 keycap sources** integrate everything: MCP servers / Big-platform OAuth / Local agents / ST-SS shared windows / Built-in. Default LLM = CF Workers AI + Doubao; BYOK for Claude / GPT-4 / local Ollama (Pattern D).

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Raycast clone (curated tool launcher) | No moat — Raycast already won English creator market; doesn't capture creator economy; can't host 10K+ MCP servers |
| A2 | Single-purpose AI chat (豆包-style consumer app) | No protocol layer; can't sell to creators; loses to ByteDance distribution power |
| A3 | Workflow editor (Coze / n8n) | Coze owns that segment; visual graph editing wrong abstraction for OS entry (user thinks "Ctrl + 1 key" not "drag nodes") |
| A4 | Pure WASM sandboxed plugin model (original ADR draft) | Forces every keycap to WASM-compile; cuts off MCP ecosystem; creator barrier too high. Later resolved by 010. |

## Consequences

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

## Acceptance

- [x] 5 primitive Rust modules exist under `src-tauri/src/kernel/{actor,capability,channel,event,effect}.rs`
- [x] 5 keycap source types documented in `.olym/steering/ctrl-strategy.md`
- [x] LLM Pattern D wired (CF Workers AI subscription + BYOK + local Ollama) in `adapters/outbound/llm/`
- [x] Repo topology lock: single deliverable repo (`soodooi/CTRL`) + `ctrl-cloud` separate
- [x] Anti-list documented (CTRL is NOT: Raycast clone / workflow editor / consumer chat / ChatGPT GPTs adapter / shared mamamiya tenant)
- [x] Related: ADR-002 supersedes §3.1 rendering; ADR-003 supersedes §6 #18; ADR-010 resolves WASM-only plugin question (all three accepted as of 2026-05-17)

## 2026-05-25 amendment — file system + keycap canonical layout + brain-as-keycap

Scope: file system viewpoint, vault/assets canonical structure, keycap internal layout, brain target framing. Does not reverse the 4-layer spine — adds canonical structure under the existing primitive set. Triggered by H-2026-05-25-001 (Pi as default brain) plus hephaestus + daedalus joint review.

### Brain-as-keycap framing (supersedes "decision_ctrl_is_hermes_workbench" memory)

- The kernel primitive is the *provider abstraction* (`text.chat`, `text.embed`, `image.generate`, `audio.tts`, …). A brain is a *task-specific runtime* that consumes that abstraction.
- A brain is therefore a **keycap with `target: brain`**, not a kernel-level module. Manifest schema gains `target` (mcp-tool | hermes-skill | brain), `capability`, `bridge`, `provider_passthrough` — see `.olym/specs/tool-manifest/spec.md` §13.
- The kernel **brain router** is an inline lookup (`~/.ctrl/active-brain` → MCP server URL), not a substrate module. ≤100 LOC, embedded in the chat command path.
- Pi (`@ctrl/pi-plugin`) is the v1 default brain (H-2026-05-25-001, shipped 2026-05-25). hermes (`@ctrl/hermes-plugin`) is an optional second brain (lives on `feat/h-2026-05-22-kernel-mcp-server`, will rebase into `keycap-dev`).

### 10 file-system invariants (ship-after immutable)

1. **One keycap = one directory** — `~/.ctrl/keycaps/<id>/` holds manifest + entry + assets + skills + patches + upstream record. `rm -rf` fully uninstalls; no registry to drift out of sync.
2. **Vault is sibling-structured** — `~/Documents/CTRL/{notes,assets/}`. Compatible with Obsidian / Logseq / VMark default layouts.
3. **`~/.ctrl/state/` is derivative** — `event-log.sqlite`, `vault-index.sqlite`, `cache/` rebuildable from vault + keycap manifests. Out of backup scope by design.
4. **Prompts are markdown** — `keycap.md` frontmatter + body, `assets/prompt.md`, `system-prompt.md` all plain text. vim-editable, git-diffable; same format as hermes/Pi SKILL.md (agentskills.io standard).
5. **Secrets always go through macOS Keychain** — provider keys, OAuth tokens, mesh identity. `~/.ctrl/config.toml` carries only non-sensitive settings.
6. **Manifest is YAML frontmatter** — Zod-validated but plain text. User can hand-edit; CI/runtime validates.
7. **Mobile = IndexedDB queue + LRU evict + soft quota** — captures (photo / audio) enqueue immediately, upload-drain when mesh online. Not "no binary asset"; capped and recycled.
8. **Backup source set** = `~/Documents/CTRL/` + `~/.ctrl/{keycaps, config.toml, mesh/identity}`. `cp -r` of the vault is sufficient for user content; CTRL state restores on next launch.
9. **Skills truth model** — `~/.ctrl/keycaps/<id>/skills/` is the **source**. `~/.ctrl/skills/<keycap-id>/<sub-id>/` is an **aggregated view** populated at install. Removing the keycap removes the view. Brain keycaps read the source directly via `PI_SKILLS_PATH` / `HERMES_SKILLS_PATH` env injection — no symlink dependency (Windows-safe).
10. **v1.0 keycap runtime = `.ts` / `.js` only** — Tauri ships Node, so JS keycaps work everywhere CTRL ships. Python / Rust / native binaries deferred to v1.x ADR.

### Canonical keycap directory layout

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
├── skills/<sub-id>/         keycap-bundled SKILL.md (truth; aggregated to ~/.ctrl/skills)
├── config.toml              Config-tier adjustments (user-editable; stays in sync with upstream)
├── patches/                 Patch-tier overrides (3-way merge on upgrade)
│   └── prompt.md.patch
├── upstream.json            { source, channel, lock_version } — drives upgrade
└── README.md
```

### Filesystem viewpoint summary

```
~/Documents/CTRL/                  VAULT (truth, plain markdown + assets)
├── notes/                         markdown
├── assets/{images,audio,pdf,attachments}/
└── ctrl.toml                      user-editable vault policy

~/.ctrl/                           RUNTIME state (CTRL private)
├── config.toml                    provider keys ref + non-sensitive settings
├── keycaps/<id>/                  canonical (above)
├── skills/<keycap-id>/            aggregated VIEW (read-only, GC'd on keycap uninstall)
├── state/                         derivative — event-log / vault-index / automerge
├── cache/
│   ├── thumbnails/
│   ├── llm/
│   └── keycap-upstream/<id>/<lock_version>/   base for 3-way patch merge
├── mesh/peers.json + identity
└── active-brain                   single file, holds "pi" or other brain keycap id

macOS Keychain                     SECRETS — providers / OAuth / mesh-device-key
```

### App bundle (`CTRL.app/Contents/Resources/`)

- `ctrl-web/` — PWA static (Vite build, ≤ 500 KB gzip critical path)
- `keycaps/` — v1 builtin keycaps (15 starter), first-run idempotent copy to `~/.ctrl/keycaps/`
- `brand/` — icon / logo / splash (promoted from `doc/visual-identity/`)
- `third-party/LICENSES` — MIT compliance (Pi / hermes / Tiptap / CodeMirror / mermaid / etc.)

First-run policy: target exists + `.ctrl-user-modified` marker → skip; no marker → safe to refresh from bundle. Marker is written by PWA file watcher on first user edit of any file under the keycap directory.

### Decision log (E-series, hephaestus review acceptance)

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
| E10 | `~/.ctrl/state/` derivative status | Made an invariant (#3 above). Backup scope clarified (#8 above). |

Mesh identity: Keychain is sole truth. `~/.ctrl/mesh/identity` mirror only if vodozemac SDK strictly requires file path (verify before implementing); if mirrored, 0600 + ADR note.

### Decision log (D-series, daedalus PWA ripple)

| # | Item | Decision |
|---|---|---|
| D1 | `list_keycaps` envelope expansion | Add `target` / `source` / `adjustment` / `config_schema` / `upstream` fields. zeus owns kernel side. |
| D2 | Keycap-bundled assets transport | New Tauri custom scheme `ctrl-asset://` — zeus implements protocol handler. Replaces invoke + base64. |
| D3 | Viewer registry dimensions | Triple-axis: `source: 'vault' | 'keycap' | 'system'` + `editable: boolean` + `onSave` handler. Not mime alone. |
| D4 | PDF sidecar transport | Viewer loads `<file>.pdf` (binary) + `<file>.pdf.md` (sidecar) together. Registry adds `companion?: string`. |
| D5 | Mobile cache invariant | See invariant #7 above (D5 motivated the invariant rewrite). |
| D6 | `first_run_state` field | `kernel_status.first_run_state ∈ { copying, ready }` surfaces in PWA empty state UI. |

### PWA surface deltas (daedalus design-lead, mock-first)

- Pool card: source / target badge + 3-tier adjustment badge (Config / Patch / Fork) + upgrade dot.
- Settings: keycap-level update inventory, distinct from app-level updates.
- Pool detail side-pane: open `keycap.md` / `prompt.md` for editing via the viewer registry (location=`keycap`, editable=true).
- Dev workflow: `CTRL_KEYCAP_DEV_PATH` env redirects `~/.ctrl/keycaps/` → `packages/ctrl-keycaps/`; auto-on when `NODE_ENV=development`. Zero impact on shipped users.

### v1.0 blocker delta (additions from this amendment)

Quoted from bao's review consolidation (raw scope estimates per bao; not amplified here):

| Lane | Added blockers from this amendment |
|---|---|
| zeus kernel | D1 envelope · D2 `ctrl-asset://` scheme + handler · D6 `first_run_state` · E6 upstream cache layout · E8 vault path config · E9 wizard backend · mesh identity Keychain-only verify · BrainRouter inline · `irisy_chat_stream` Tauri command · rewrite `irisy.rs` (Pi probe, drop hermes detection) |
| hephaestus cap | E4/E5 brain keycap reads `keycap-bundled skills/` via env (`PI_SKILLS_PATH` / `HERMES_SKILLS_PATH`) · Gap A dev path override doc · E7 `.ts`/`.js` entry enforcement · `ctrl-hermes-plugin` rebase / cherry-pick into `keycap-dev` |
| daedalus PWA | D3 viewer registry 3-axis · D4 PDF sidecar · D5 mobile IndexedDB queue + LRU · E9 init wizard UI · Pool card badges + 3-tier UI · Settings keycap update inventory · Pool detail side-pane prompt editing |
| apollo | no change |

Critical path: zeus mesh thin-wire + `ctrl-asset://` scheme. Other lanes work in parallel.

### Open follow-ups (not blockers, tracked)

- 4 ship blockers in Pi plugin (B1 RPC degrade re-emit / B2 Win detect / B3 Win shebang + Node 20 strip-types / B4 main → dist) — recorded in commit 202bfc9 body; address before v1.0 ship.
- `pnpm-lock.yaml` / `pnpm-workspace.yaml` appeared in `packages/ctrl-web/` working tree on 2026-05-25; CLAUDE.md mandates npm workspaces — left untracked pending bao decision (keep / delete / migrate).
- ADR-019 (referenced in earlier review by inference) does not exist; reservations there were potential-slope, not realised. No new ADR needed beyond this amendment unless multi-brain UI / hermes activation rolls in.

## Amendment 2026-05-25 — Pi-as-sole-brain + hermes-as-keycap + VMark-not-substrate

This session **撤销 2026-05-22 hermes-as-brain framing**, replaces it with Pi-as-sole-brain. Decision body (5 primitives + 5 sources + 4 layers) remains immutable; brain assignment + substrate set updated.

### What changed

**Brain layer (was hermes, now Pi):**

- **Pi** ([github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono)) is the **sole brain** that powers Irisy. Sole = no "active brain switch" UI; kernel routes Irisy `text.chat` to Pi unconditionally.
- Rationale: agentskills.io = open standard (Anthropic 2025-12), not hermes-private; Pi supports SKILL.md and consumes the same 90k+ skill ecosystems (Skills.sh / SkillsMP / agentskill.sh). Pi is lighter (TS + npm, <1000-token system prompt floor, 4-tool floor), philosophy-aligned (stateless brain + vault as truth, no separate memory store), has Rust port (`pi_agent_rust`) as future kernel-embed path. hermes' persistent memory + auto-skill-generation conflict with CTRL's plain-text-vault truth model.
- **hermes降级 → 普通 functional keycap** ("个人助理键帽"). User installs hermes from keycap pool when they want a personal-assistant agent with persistent memory + auto-skill-gen. hermes is NOT in the brain slot — Pi keeps that slot. hermes keycap runs as its own MCP server subprocess (lazy `pip install hermes-agent`), with its own memory store kept in `~/.hermes/`. README warns users that hermes' memory does NOT integrate with the CTRL vault (it's the trade-off of installing this keycap).
- ADR-019 (hermes-primary) **supersedes by this amendment**. ctrl-hermes-plugin code is NOT deleted — repositioned as the personal-assistant keycap's bridge (metadata + README change only). MIT compliance from `decision_hermes_mit_compliance` carries forward unchanged.

**Vault substrate (was VMark MCP sidecar, now CTRL-native plain-text stack):**

- **VMark is NOT a substrate.** VMark.app ([github.com/xiaolai/vmark](https://github.com/xiaolai/vmark)) is itself vibe-coded Tauri 2 + React + Tiptap + CodeMirror 6 + Tailwind 4. CTRL uses the **same open-source libs directly**, not VMark as an intermediary.
- **S15 (VMark MCP sidecar) deprecated.** B15 / B16 ("Open in VMark" / "Insert at VMark cursor") deprecated. VMark remains a *compatibility commitment* (vault files are plain markdown, vim + VMark + Pi all read them) — never a dependency.
- **CTRL-native vault stack** (decided 2026-05-25):
  - PWA viewer registry by content-type: **Tiptap** (markdown WYSIWYG + source), **CodeMirror 6** (code / JSON / YAML / TOML / HTML), **mermaid.js** (mermaid), iframe+CSP (HTML sandbox), browser-native (SVG)
  - Kernel **vault index** (`src-tauri/src/kernel/vault_index.rs`, already partial): SQLite FTS5 full-text + backlink scanner + tag scanner — extended in this lane
  - Image inventory module (new substrate, replaces S20 framing): FS scan + thumbnail cache, kernel-native, no VMark dep
- Frontmatter parsing: `gray-matter` (TS) + `serde_yaml` (Rust). Plain markdown + YAML frontmatter remains the vault's wire format.

**Philosophy reframe (CLAUDE.md updates separately):**

- "Obsidian philosophy" wording → **"Plain-text philosophy"**. Substance unchanged (local = truth, vim-readable, no proprietary binary, no CTRL account, end-side OAuth/LLM/RAG/sync), but no longer named after a specific app.
- vim test still applies as the design gate.
- "CTRL = hermes 长出来的手脚 + 工作台" framing (memory `decision_ctrl_is_hermes_workbench`, 2026-05-22) **superseded**: CTRL provides body + workbench for **Pi** (the brain) + N keycaps (one of which can be hermes personal-assistant). hermes is no longer the brain in CTRL's mental model.

### Why this amendment now (灵活开发 window)

bao explicitly authorized (2026-05-25): "我们现在灵活开发，就是因为不确定是否可行，是否是最好的选择；在确定架构前都可以修改". Brain selection + vault substrate are pre-v1.0-lock decisions, reversible at low cost (ctrl-hermes-plugin ~500 LOC sunk cost; no kernel API contract broken). Window closes when v1.0 ships.

### Forward-looking acceptance

- [ ] zeus: kernel `chat_stream` / `irisy_init` simplified — no "active brain" config, route directly to Pi keycap; remove hermes-specific probe from irisy.rs
- [ ] zeus: CLAUDE.md updated — Obsidian → Plain-text wording, brain layer described, Stack table includes Tiptap + CodeMirror 6 + mermaid.js
- [ ] zeus: vault_index.rs extended with backlink + tag scanners (FTS5 already in place)
- [ ] hephaestus: ctrl-pi-plugin shipped under `packages/ctrl-pi-plugin/`; Pi keycap manifest written; H-2026-05-25-001 dispatched
- [ ] hephaestus: ctrl-hermes-plugin repositioned (metadata + README only, no code change) as personal-assistant keycap
- [ ] hephaestus: H-2026-05-23-001 (hermes-primary integration) marked `superseded` with reference to this amendment
- [ ] daedalus: PWA viewer registry (Tiptap + CodeMirror 6 + mermaid.js) shipped — Settings "Active brain" UI NOT needed (sole brain)
- [ ] ADR-019 status changed to `superseded`, `superseded_by: 001#amendment-2026-05-25`

## Changelog

| Date | Change |
|---|---|
| 2026-05-11 | Initial accept (bao) — frame lock for CTRL v1 scope |
| 2026-05-13 | ADR-002 supersedes UI/rendering portion (§3.1) |
| 2026-05-14 | ADR-003 supersedes cross-device sync portion (§6 #18) |
| 2026-05-17 | ADR-010 resolves WASM-vs-MCP plugin model question; spine remains |
| 2026-05-18 | Rewrite to olym 0.3.1 ADR format (Context/Decision/Alternatives/Consequences/Acceptance/Changelog) |
| 2026-05-18 | Clarification (no policy change): line 23 "Default LLM = CF Workers AI + Doubao" 实际含义 = 默认订阅 = CF Workers AI (Qwen/Llama bundled); "Doubao" 字眼指 Volc-provided model, 通过 BYOK 或后续 kernel capability 接入, 非 CF 订阅默认含. ADR-005 (proposed) 进一步限定 BYOK Claude 仅 user action, 不是默认路径. ADR-001 Decision 段保持 immutable. |
| 2026-05-22 | Amend: hermes-as-brain framing (5-part body mapping); ADR-013 kernel-as-MCP-server lands as protocol consolidation; ADR-015 Obsidian philosophy as cross-cutting constraint; ADR-014 global-English-first positioning. Decision body remains immutable; amendments capture the new framing without restructuring the spine. |
| 2026-05-25 | **Amend (first校准): Pi-as-sole-brain + hermes-as-keycap + VMark-not-substrate.** Supersedes 2026-05-22 hermes-as-brain framing. Spine (5 primitives / 5 sources / 4 layers) immutable; brain assignment + vault substrate set updated. ADR-019 (hermes-primary) supersedes. CTRL-native vault stack chosen (Tiptap + CodeMirror 6 + mermaid.js + SQLite FTS5) — no VMark dependency. |
| 2026-05-25 | **Amend (second校准): File-system canonical layout, 10 invariants, brain-as-keycap framing (E1–E10 + D1–D6).** Triggered by H-2026-05-25-001. Spine and 5-primitive set unchanged. |
| 2026-05-25 | **Amend (third校准, release/0.1.37): plan-vs-actual reconciliation.** Six gaps fixed in single ship: (1) Vault default path = `~/Documents/CTRL/` (was `~/.ctrl/vault/`) + auto-create canonical sibling layout (`notes/` + `assets/{images,audio,pdf,attachments}/`) + legacy migration; (2) kernel-as-MCP-server (`mcp_server.rs` @ 17873) merged from zeus branch — restores ADR-013; (3) composition runtime (`composition.rs`) merged — linear flow + var interpolation; (4) `packages/ctrl-hermes-plugin/` brought into release branch (optional brain keycap, was zeus-branch-only); (5) `brand/` promoted to top-level from `doc/visual-identity/`; (6) legacy `src-tauri/src/actors/` removed (W3-era hexagonal arch, dead since H-2026-05-14-002 mac/c). `packages/ctrl-keycaps/` skeleton added as future builtin source-of-truth. Spine and 5-primitive set unchanged. |
