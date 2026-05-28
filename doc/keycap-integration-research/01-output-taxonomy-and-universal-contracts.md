# 01 — Output Taxonomy & Universal Layer Contracts

> **Author**: hephaestus (keycap lane)
> **Date**: 2026-05-26
> **Status**: brainstorm → contract spec
> **Reframe of**: 17-builtin anchoring in H-2026-05-26-001 v0
> **Related**: `.olym/specs/keycap-base-layer/spec.md` (v0.1 gap list now subsumed) · `.olym/specs/tool-manifest/spec.md` · ADR-001 · ADR-010 · `00-inventory-and-abstractions.md` (older inventory)

---

## 1. Why this doc

Keycap lane was anchored on the 17 v1 builtin slate. **CTRL's actual scope = 万级 keycap** from 5 sources (MCP 10K+ / OAuth big platforms / Local agents / ST-SS streams / Built-in) + creator economy. Per-keycap special-casing breaks the platform — every new keycap should be a manifest, not a PR.

This doc inventories **what target users produce across ALL keycaps**, categorizes by output **shape** (not by keycap), and locks the universal contracts each layer (base / frontend / Irisy) must provide so no future keycap requires a new kernel primitive or PWA component (modulo `workspace.ui = custom` escape hatch, which should be rare).

---

## 2. Target user output taxonomy (7 categories × 30 sub-types)

### A. Text outputs

| # | Sub-type | Example keycaps |
|---|---|---|
| A1 | Inline text replacement (read input → transform → write back same surface) | Clipboard AI rewrite · Translate paste-back · Snippet expand · Email tone-fix |
| A2 | New text body (no input replacement; new artifact) | Quick Ask answer · Code gen · Email draft · Commit message gen · Summary |
| A3 | Structured text (markdown / JSON / YAML / TOML / code with lang) | New Note · Vault frontmatter · Config dump · LaTeX export · Mermaid source |
| A4 | Streaming chat dialogue (multi-turn retained in workspace) | Irisy chat · Quick Ask follow-up · Code-review back-and-forth |
| A5 | List / picker results (multi-item selection) | Search Vault · Snippet picker · RAG hits · MCP tool list |

### B. Binary / media outputs

| # | Sub-type | Example keycaps |
|---|---|---|
| B1 | Images (generated or captured) | Generate Image · Poster · Screen Capture · OCR source preview · Mermaid SVG · 屏幕录 frame |
| B2 | Audio (generated or captured) | Speak (TTS) · Transcribe source preview · 会议 record |
| B3 | Video / animation | 屏幕录 · future shader playground · future Lottie keycap |
| B4 | Document / file (PDF / LaTeX / Office / arbitrary blob) | PDF assist · LaTeX export · Email attachment compose |

### C. Side effects (no UI output, world-changing call)

| # | Sub-type | Example keycaps |
|---|---|---|
| C1 | File system writes (vault or arbitrary path) | vault.write · Clip to Vault · save attachment |
| C2 | OS calls (clipboard / shell.open / app launch) | Open Vault Folder · Open in VMark · Clipboard AI write-back |
| C3 | External API mutations (Notion / Linear / Feishu / Slack / GitHub) | OAuth keycaps — create page / file issue / send message / open PR |
| C4 | Subprocess invocation (local agent / CLI / Python script) | OpenClaw / ClawX / user-supplied Python tool |

### D. Long-running / stateful outputs (multi-frame, not one-shot)

| # | Sub-type | Example keycaps |
|---|---|---|
| D1 | LLM token streams | every text.chat call |
| D2 | PTY / terminal streams (interactive subprocess) | Code Space · build logs viewer · agent loop watcher |
| D3 | ST-SS subscription streams (long-tail desktop + hardware) | hardware sensors · Quicker bridge · OBS overlay · custom dev tools |
| D4 | Approval-gated mid-stream pauses (tool calls awaiting user OK) | any brain keycap doing destructive ops · oauth scope re-confirm |
| D5 | Background jobs / cron / scheduled | hermes cron-loaded keycaps · 同步 keycap · scheduled summary email |

### E. Interactive mid-keycap prompts (input, but part of the output protocol)

| # | Sub-type | Example keycaps |
|---|---|---|
| E1 | Form input (schema-driven) | Configurator · OAuth scope confirm · Email compose form |
| E2 | Picker (choose-one or choose-many from list) | tone picker · model picker · snippet picker · keycap pick during chain |
| E3 | Canvas / region select (graphical input) | screenshot crop · OCR region · image.edit mask · 屏幕录 region |
| E4 | Confirmation modal (yes/no / risk gate) | approval modal · cost-disclosure · uninstall confirm |
| E5 | File / folder picker (OS native dialog) | Transcribe source pick · Generate Image reference pick · Mermaid SVG load |

### F. Discovery / meta outputs (about keycaps themselves)

| # | Sub-type | Example keycaps |
|---|---|---|
| F1 | Keycap manifest / install proposal (Irisy / market proposes) | Irisy Discovery stage · ctrl-market search result · agentskills.io browse |
| F2 | Tool list / capability ad (introspection) | kernel MCP `tools/list` · `hermes mcp list` · keycap manifest preview |
| F3 | Skill / template / asset fetch (download into local) | agentskills.io install · ctrl-market download · upstream channel update |
| F4 | Patch diff / manifest preview (Improvement stage) | patch.json editor · upstream conflict view · fork diff |

### G. Cross-device / cross-session outputs

| # | Sub-type | Example keycaps |
|---|---|---|
| G1 | Mesh sync delta (Automerge CRDT update, ADR-003) | vault sync · keycap state sync |
| G2 | Remote co-view stream (Irisy mirror to phone, ADR-017) | "watch my desktop from my phone" |
| G3 | Messaging gateway (Telegram / Discord bot via local hermes) | hermes-keycap users firing keycaps from their bot |

---

## 3. Universal contracts each layer must provide

### 3.1 Base substrate (zeus + hephaestus shared) — 7 universal primitives

Each primitive covers a whole category, not a keycap. **New keycap must compose existing primitives — adding a primitive is a kernel-level decision.**

| # | Contract | Covers | Surface |
|---|---|---|---|
| **B-1 Effect envelope** | Uniform `{type, payload, cost_estimate, approval_gate, idempotency_key, deadline_ms, capability_token}` for any side-effect or provider call | C1-C4, F1-F4 | kernel internal + via MCP tools |
| **B-2 Stream protocol** | Single `Stream<T>` with subscribe / cancel / replay-from-cursor / emit-back; T = token / pty-frame / event / cell-op | A4, D1-D5, G2 | ST-SS bridge generalized; LLM stream / PTY / SSE all conform |
| **B-3 Provider capability table (open)** | Typed namespaces: `text.*` / `image.*` / `audio.*` / `video.*` / `embed.*` — registered per kernel build, declared in manifest `capabilities`; Volc + BYOK + Ollama as providers | A1-A5, B1-B3 | kernel `llm_port` extended |
| **B-4 Side-effect capability table (open)** | Typed namespaces: `clipboard.*` / `vault.*` / `shell.*` / `mcp.*` / `oauth.*` / `hotkey.*` / `notify.*` / `dialog.*` | A1, C1-C4, E1-E5 | kernel commands + capability broker |
| **B-5 Sandbox profile derivation** | Manifest `variant` (builtin / mcp-server / oauth / cli-wrapper / stss-publisher / local-agent) → OS sandbox profile (sandbox-exec / landlock / AppContainer) auto-applied; per ADR-010 §5.4 | all source types | install-time |
| **B-6 Cost / quota / approval primitive** | Per-call cost estimate (provider-typed); user quota check; approval-token issuance / consumption | A1-A5, B1-B3, C3, F3 (anything $) | preflight + ledger |
| **B-7 Discovery surface** | `keycap.search` / `keycap.recommend` / `keycap.install_proposed` MCP tools so Irisy drives Discovery stage uniformly across all 5 sources | F1-F3 | kernel MCP server |

### 3.2 Frontend (daedalus) — 6 universal rendering / interaction contracts

| # | Contract | Covers | Surface |
|---|---|---|---|
| **F-1 Content renderer registry by content kind** | NOT by keycap. Renderer per content type: markdown / code (lang-tagged) / chart (mermaid + dataset) / image / audio / video / table / diff / pty / form / picker / canvas / iframe-html-sandbox / file-link. `workspace.ui = custom` only for genuinely novel UI (Code Space tier). | A-B, partial D, E1-E3, F4 | `keycap-tab-registry.ts` |
| **F-2 Stream replay UI** | Subscribes to any B-2 Stream → render incrementally with cancel / scrub / clear / "save as artifact" | A4, D1-D5, G2 | reusable across LLM chat / PTY / SSE |
| **F-3 Interactive prompt protocol** | Single way for any keycap to request mid-run input: `prompt(kind, schema) -> response`; kind ∈ {form, picker, canvas, file, confirmation} | E1-E5 | PWA modal + Tauri dialog |
| **F-4 Status surface registry** | Uniform UI for install / running / failed / approval-pending / quota-exceeded / sandbox-violated / upstream-conflict per keycap; shown in Workspace status strip | all keycap lifecycle | status row component |
| **F-5 Drill-down protocol** | Any rendered output → long-press / hover → raw source + invocation trace (3-layer view per Design Philosophy #6 transparency-by-drill-down) | all of A-D | wrapper around F-1 renderers |
| **F-6 Cost / approval modal protocol** | Preflight modal before any B-6 paid or approval-gated call: "this will cost ~$X, approve?" → consume approval-token | A-D with $ | reusable across all paid providers |

### 3.3 Irisy (Pi brain + PWA companion) — 7 universal companion contracts

Irisy is **not** a chat app. It's the bridge between user intent and keycap execution. These 7 contracts ARE Irisy.

| # | Contract | Covers | Owner detail |
|---|---|---|---|
| **I-1 Intent → keycap dispatch** | NL → manifest match (search across installed + agentskills.io + ctrl-market + MCP registry) → install propose if missing → invoke. Output = F1 install proposal OR direct dispatch. | F1-F3 + start of any A-D | Pi brain via B-7 tools |
| **I-2 Multi-keycap chain primitive** | Accept "do X then Y then Z" → dispatch sequence with state passing between steps; rolls back on mid-chain failure; surfaces F-2 stream of the chain. Content-creation (poster / slide-deck) is the canonical use case. | composition of A-D | Pi brain orchestrates via B-1 envelopes |
| **I-3 Improvement → patch authoring** | Receive instructive feedback ("more casual", "shorter") → produce `patch.json` keyed by JSON Pointer over the active keycap manifest; preview as F4 diff before commit | F4 | Pi brain reads manifest + writes patch |
| **I-4 Conflict merge as a service** | Receive `{base, patch, upstream}` → produce merged patch with rationale; surfaces in F-6 modal | F4 on auto-update | Pi brain one-shot |
| **I-5 Vault context exposure** | Surface "Irisy is reading vault/foo.md to ground response" + which vault paths informed each output (per Design Philosophy #6 transparency) | all A-D when grounded | PWA reads Pi tool-call trace, renders inline citation chips |
| **I-6 Keycap factory drive** *(added 2026-05-26 — see 02 doc §5)* | Irisy not only dispatches installed keycaps — when user intent isn't covered, calls CLI-Anything-class manifest-generator to derive a new keycap from user's installed software / API endpoints; surfaces F4 manifest preview before install | F1 + creator economy | Pi brain calls B-7 + manifest-gen sub-tool |
| **I-7 Multimodal asset reasoning** *(added 2026-05-26 — see 02 doc §8)* | Pi brain receives generated image / video / 3d / audio as input + provides feedback ("too dark", "headline doesn't fit", "wrong aspect"); requires vision-capable Pi (multi-modal LLM input) or BYOK vision provider. Without I-7, Irisy can only edit prompts blindly. | B1+B3 image/video/audio/3d outputs | Pi vision input via brain router |
| **I-8 Asset versioning lineage** *(added 2026-05-26 — see 02 doc §8)* | Vault stores `<asset>.v1.png` + `<asset>.v1.meta.json` (prompt + provider + cost + job_id); Irisy tracks v1→v2→v3 with prompt diff + cumulative cost; surfaces in F-5 drill-down. User says "go back to v2 + try slight variant" → reachable. | content-creation re-roll | Pi writes vault meta on each generation, surfaces history |
| **I-9 Group-chat autonomy** *(added 2026-05-27 — see 02 doc §10)* | (a) `should_speak(msg, context) → {speak, listen, defer}` — Pi brain throttle decision per group message; (b) pulls history via `chat.context.window` before deciding; (c) consent disclosure post on bot join (Transparency-by-drill-down); (d) per-group rate envelope; (e) member-info panel surfacing scope. **Anti-spam + privacy is the v1 trust gate.** Without I-9, Irisy in group = spammy + invasive. | bidirectional group bots (Telegram / Matrix / Lark / etc.) | Pi consumes B-4 `gateway.participant.*` + `chat.*` sub-tables |

---

## 4. The 17 v1 builtins as universal-contract instances (compactness check)

If contracts in §3 are right, every v1 builtin = composition of contracts. **No new contract should be needed for any of 17.**

| Keycap | B contracts used | F contracts used | I contracts used |
|---|---|---|---|
| Clipboard AI | B-3 text.chat · B-4 clipboard | F-1 markdown · F-2 stream · F-6 cost | I-3 improve |
| Translate | B-3 text.chat · B-4 clipboard | F-1 markdown · F-2 stream | I-3 |
| Quick Ask | B-3 text.chat | F-1 markdown · F-2 stream | I-1 |
| OCR | B-3 image.ocr · B-4 capture+clipboard | F-1 image+markdown · F-3 region · F-6 | — |
| Generate Image | B-3 image.generate · B-4 vault.write | F-1 image · F-3 form · F-6 | I-3 |
| Poster | B-3 image.generate · B-4 vault.write | F-1 image · F-3 form · F-6 | — |
| Speak (TTS) | B-3 audio.tts · B-4 vault.write | F-1 audio-player · F-3 form · F-6 | — |
| Transcribe | B-3 audio.stt · B-4 vault.read · B-4 dialog | F-1 markdown · F-3 file-pick · F-6 | — |
| Mermaid | B-3 text.chat · B-4 vault.write | F-1 chart+code · F-2 stream | I-3 |
| New Note | B-4 vault.write | F-1 markdown · F-3 form | — |
| Search Vault | B-4 vault.search | F-1 picker | I-1 |
| Open Vault Folder | B-4 shell.open | F-4 notification | — |
| Clip to Vault | B-4 clipboard+vault | F-4 notification | — |
| Screen Capture | B-4 capture+vault.write | F-1 image · F-3 region | — |
| Open in VMark | B-4 shell.open | F-4 notification | — |
| Insert at VMark cursor | B-4 mcp:vmark · B-3 text.chat | F-3 form · F-2 stream · F-6 | I-2 (selection→transform→insert chain) |
| Code Space | B-2 PTY stream · B-4 subprocess | F-1 `workspace.ui=custom` (only first-party custom) · F-2 stream | I-2 (chain agent steps) · I-5 (vault citations) |

✅ **No contract gaps** — every cell maps to §3. Adding a 18th / 19th / ... keycap = pick more contracts, never add new ones.

---

## 5. Long-tail / creator-economy implications

Any new keycap from MCP / OAuth / Local-agent / ST-SS must hit only contracts in §3. Quick worked-examples:

- **A new MCP server emitting image with bounding-box overlay** (e.g. object detection)
  → B-1 effect for the call + B-3 image.* (or generic mcp.invoke) for the result + F-1 canvas-with-bbox-layer (extension of canvas renderer, NOT new component) + F-5 drill-down to raw JSON. **Zero new contracts.**

- **A new OAuth integration with multi-account** (e.g. user has 3 Notion workspaces)
  → B-4 oauth.* extension to support account-id parameter + F-4 status surface gets an "account: <name>" sub-row. **Status-surface generalization, no new contracts.**

- **A new ST-SS stream publisher** (e.g. user's custom keyboard publishes keystroke stream)
  → B-2 stream protocol (already covers) + F-2 stream replay UI (already covers) + manifest declares `variant: stss-publisher`. **Zero new contracts.**

- **A new local-agent keycap with HTTP IPC pool mode** (e.g. user's own LLM proxy)
  → B-4 mcp.spawn extension to support http+pool variant + B-5 sandbox profile auto-derived. **Zero new contracts (extends existing entries).**

- **A new "data import" keycap that reads Excel and writes vault rows**
  → B-4 dialog.file-pick + B-3 text.chat (for schema mapping) + B-4 vault.write + F-1 table renderer + F-3 form. **Zero new contracts.**

**Rule of thumb**: if a new keycap proposal needs a new contract, it's a kernel/PWA review trigger (zeus / daedalus / hephaestus consensus). Otherwise it's pure manifest + optional `workspace.ui = custom` component (rare).

---

## 6. Mapping H-2026-05-26-001 v0 "13 hidden gaps" to contract terms

The 13 hidden gaps I listed in dialog above reduce to **5 unfilled contract slots**:

| Old "hidden gap" framing | New universal contract framing |
|---|---|
| audio.play / file.pick / platform.notify / hotkey.register / template.expand | **B-4** missing capability namespace entries (`audio.play`, `dialog.*`, `notify.*`, `hotkey.*`) — open table, just register the entries; template-expand may sink into ctrl-keycap-sdk pure-TS, not kernel |
| Cost-disclosure pre-call modal | **F-6** — not unfilled, the spec just deferred it; lock as v1 must-ship |
| Audio-player renderer / diff viewer / jobs pane / tools-list panel | **F-1** — these are renderer-kinds, just register in the kind table; no new component framework |
| Hotkey conflict resolver UI | **F-3 confirmation kind** + **B-4 hotkey.* conflict event** |
| Improvement auto-patch / chain orchestration / vault-context exposure / conflict-assist merge / Code Space PTY ingest | **I-1 / I-2 / I-3 / I-4 / I-5** — the entire Irisy contract layer was unspecified; this doc names it |

**Conclusion**: the 13 individual gaps consolidate to **4 contract-table extensions (B-4 / F-1) + 1 deferral lift (F-6) + Irisy contract layer (I-1..I-5)**. Far easier to dispatch + much harder for keycap-PR drift to break.

---

## 7. Acceptance for keycap lane (hephaestus)

What keycap lane delivers under this reframe:

1. **This doc** lands; H-2026-05-26-001 amended to reference §3 contracts per lane.
2. **Manifest schema v0.2** (`packages/ctrl-keycap-sdk`) fully covers all 5 source variants × `target` × `capabilities` table — done up to H-2026-05-25-001 partial pass; finish remainder.
3. **16-18 v1 builtin manifest set** is the conformance harness — each exercises ≥1 contract from §3; no keycap goes to a new contract.
4. **Synthetic conformance smoke** — one MCP / one OAuth / one Local-agent / one ST-SS keycap exists in test fixtures, validating no new PWA component or kernel primitive is needed for any.
5. **Per-source manifest exemplars** — `doc/keycap-integration-research/02-..06-` (already started: 02-pattern-A / B / C / D + 06-jiazuo-result) finalized as creator-onboarding reference.

What keycap lane does NOT write: base / frontend / Irisy implementation. That's the per-lane responsibility under §3 contracts.

---

## 8. Open questions (need bao / cross-lane resolution)

| Q | Question | Owner |
|---|---|---|
| Q1 | Should `template.expand` sink into ctrl-keycap-sdk (TS, no kernel) or be a kernel capability? Affects whether prompt templating runs in-process keycap or via syscall. | hephaestus + zeus |
| Q2 | I-2 multi-keycap chain — does kernel `run_keycap` accept a chain spec, or does Pi brain dispatch each separately and chain in Pi? First simpler, second more flexible. | zeus + Pi brain owner |
| Q3 | I-5 vault-context exposure — Pi reads vault via `read` tool; how does PWA know what Pi read mid-stream? Need Pi tool-call trace surfaced through brain router. | zeus + daedalus |
| Q4 | F-1 `workspace.ui = custom` threshold — what's the bar? Code Space is justified (full IDE pane); cost-disclosure modal is NOT (use F-6); image-with-bbox is NOT (extend canvas). Need bar criteria. | hephaestus + daedalus |
| Q5 | B-6 cost ledger — single ledger across all providers, or per-provider sub-ledger? Multi-tenant case (creator quota) needs design. | zeus |

---

## 9. Changelog

| Date | Change |
|---|---|
| 2026-05-26 | Initial brainstorm — reframe keycap lane scope from "17 v1 builtin" to "universal contracts ×万级 keycap". Establishes 7 base + 6 frontend + 5 Irisy contracts. Maps 13 hidden gaps from H-2026-05-26-001 v0 to 5 contract-table extensions + Irisy contract layer. |
