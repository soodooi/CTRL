---
adr_id: 002
module: substrate
title: CTRL substrate — BYO-CLI driver · projection · capability surface · 3-capability-face · provider router · crypto · subprocess · MCP bus · composition
version: 47
status: accepted
last_updated: 2026-07-02
deciders: [bao, zeus]
sections:
  - { id: brain,                source: orig-003, note: "v27 reframed: BYO-CLI driver brain — user-chosen local CLI (Claude Code etc.); CTRL never spawns/supervises a brain. Prior hermes-ACP/Pi/opencode-as-brain content retired, kept in changelog as provenance." }
  - { id: projection,           source: new-2026-06-17, note: "v27 NEW core — CTRL projects local assets (tools→MCP / skills→SKILL.md / memory→CLAUDE.md / workflows→slash command) into the target CLI's native config; passive projection (substrate) + active spawn share one projection; CLI owns scheduling, CTRL only makes assets visible + gates call-return at :17873." }
  - { id: agent-channel,        source: new-2026-06-17, note: "§1.8 (v27) demoted: ACP is a future enhancement channel for ACP-aware CLIs, NOT the main path — main path is § projection. ACP code retained as future work." }
  - { id: capability-faces,     source: H-2026-06-09-002 conversation, note: "3-face SSOT — MCP / API / Skills 互补不塌缩" }
  - { id: capability,           source: orig-004 }
  - { id: provider,             source: new-2026-05-31, note: "VMark port + role routing + introspection" }
  - { id: crypto,               source: orig-007 }
  - { id: subprocess,           source: orig-012 }
  - { id: mcp-bus,              source: orig-013 }
  - { id: composition,          source: orig-024, note: "v34 §7.4: feature packs are systematic — manifest=data, runtime=generic, zero code to add a pack; 3 zero-code sources (local / Discover registry-pull / Irisy-generated via reused Anthropic mcp-server-dev open skills); OFFICIAL_PACKS hardcode retires; gate mcp_pack_{list,install,run} = runtime landing." }
  - { id: vault,                source: new-2026-06-01, note: "kernel vault primitives + feature-layer boundary; Daily Note + Sourcing are feature-layer (Irisy + frontend)" }
  - { id: smart-table-output,   source: new-2026-06-03, note: "mcp output unification — single SmartTable per mcp, schema in manifest output_capture" }
  - { id: embeddings,           source: new-2026-06-03, note: "local Ollama nomic-embed-text + SQLite vector blob + cosine flat search; hybrid mode on vault.search; 5 new MCP tools" }
  - { id: audit-ledger,         source: new-2026-06-04, note: "kernel-side immutable record of every self-evolution event across the 6 loops (ADR-001 §8). Reuses persistence.rs SQLite event store with a new event kind; replay-able, queryable from PWA settings." }
  - { id: unified-operation-interface, source: new-2026-06-19, note: "§14 — describe/query/produce: one uniform interface over all content-type feature points (md/html/table/pdf/connector/…) projected on :17873 gate; type layer via describe, read(query)≠write(produce-through-gate); query = kernel service over QuerySource, feature packs + workflows are clients; smart-table = first impl. Research: GraphQL/Plan9/agentic-AI paper." }
changelog:
  - v47 2026-07-02: **§1.9 amendment — notes FRONTEND = vendored Tolaria UI; CTRL kernel stays the ONLY backend (bao「前端就用 tolaria」, superseding the v46 build-the-frontend-natively plan for G2/G3/G4/G6/G7 while keeping ALL v46 endpoint work).** Feasibility (deep-read of the cloned repo): Tolaria's 378-component React/TS frontend couples to its backend through only ~49 Tauri commands — ~15 map onto CTRL's existing vault surface, ~10 are its AI/CLI layer (TRIMMED, replaced by Irisy), ~10 app-shell (partial), ~5 gaps CTRL planned anyway (E11 link-aware rename). Decision: vendor the frontend subtree as `packages/ctrl-notes-ui` (AGPL→AGPL, scoped exception ADR-006 §5.1.1 v11) + write an adapter mapping its command surface onto the `:17873` gate + Tauri commands — so its mature editor armor (BlockNote + IME/paste/render-recovery), types-as-lenses, views, git UI, tldraw whiteboard, multi-vault UI arrive whole, while audit/visibility/review/§14 stay CTRL's (sovereignty in the backend). Its Rust backend + CLI-integration layer (claude_cli/codex_cli/hermes_cli/pi_cli…, the parallel brain layer that conflicts with gate/projection) is NOT taken. Editor-stack consequence: the notes module runs BlockNote; the Tiptap lock narrows to the other viewers (ADR-003 pairing). Bundle: notes UI lazy-loads (critical-path shell keeps its budget). Kernel work UNCHANGED and load-bearing: S1 retirement, E1-E13 endpoints, S4 vault_git attribution layer are exactly what the adapter feeds. Fork slices: F1 vendor+license, F2 adapter, F3 mount as the notes workspace, F4 trim+trademark strip+visual QA, F5 cherry-pick playbook.
  - v46 2026-07-02: **§1.9 amendment — Notes goes FULL NATIVE REPLACEMENT; Obsidian connector RETIRED (bao 2026-07-02「替代现在的 note，保持所有功能都有」+「obsidian 应该不要了，参考 obsidian 的端点建立 ctrl 所有 note 相关的端点」).** Supersedes the v24-v28 Obsidian posture in three parts: (1) **§1.9 scope decision reversed** — v26's "stop ADDING PKM parity / Obsidian = preferred editor + escape hatch" is out; CTRL's NotesApp becomes the COMPLETE PKM surface (Tolaria-parity feature set: git layer w/ AI attribution, types-as-lenses + saved-§14-query views, editor completions TOC/math/callouts/collapse, tldraw whiteboard, multi-vault registry — governing plan `vault/ctrl/notes-module-replacement-plan.md`, deep-read of cloned `~/Documents/coding/tolaria-reference`). (2) **§1.9.1 connector RETIRED entirely** — `commands/obsidian.rs` (status/connect/provision/launch + silent app install) deleted, boot auto-provision + bus auto-connect removed from kernel_supervisor; the generic streamable-HTTP MCP client transport in `mcp_host.rs` STAYS (generic infra that outlived its first consumer). Obsidian demotes to "format-compatible neighbor, zero wiring" — the vault stays plain markdown any Obsidian install can open (compat promise unchanged), but CTRL installs nothing, provisions nothing, connects nothing. (3) **Native note endpoints replace what the connector provided** — Obsidian Local REST API surface (16 paths/34 ops, deep-researched 2026-07-02) becomes the REFERENCE CHECKLIST for CTRL-native gate endpoints in CTRL idiom (E1-E13 in the plan: periodic notes, active note, open-in-UI, fm surgical patch via ProduceOp, note_map/note_get, link-aware rename, recent-changes, search-with-context; JsonLogic/DQL free-form query NOT built — §14 typed filters cover it, anti-hallucination). "Ctrl-key is the only entry" is STRENGTHENED (the Obsidian escape hatch is gone). Locks unchanged: plain-text truth / vim test / gate + review / 5 primitives.
  - v45 2026-07-02: **§14.13 NEW — unified write side: `RecordSink` trait + one typed `produce` verb (bao「你架构弄清楚了吗？是在建立整套系统吗？…好，做」).** Reset from endpoint-accretion to system-building. Read side was systematic (one QuerySource trait + shared run_query); write side had fragmented into ~10 bespoke smart_table_* tools + a separate connector source_produce. §14.13 mirrors QuerySource on the write side: `ProduceOp` (compile-time-fixed typed union — SetCell/UpsertRows/DeleteRows/Add|Update|DeleteField/CreateSource/AddView/DropView; anti-hallucination per §14.1; Write half only, Effect stays on Effect primitive) + `RecordSink` trait (supported_ops advertised via describe + produce(op)); gate exposes exactly 3 §14 verbs (describe/query/produce) over any source (native by path, connector by id). Adding a data product (Sheets/Docs/Calendar/Task) = implement QuerySource+RecordSink over plain-text + register = ZERO new gate tools; whole suite becomes one §14 system (governing: unified-productivity-suite-architecture.md). Migration: land ProduceOp+RecordSink+SmartTable impl, keep bespoke smart_table_* during transition (PWA calls them), converge+retire like ghostfolio→source_*. Locks unchanged (5 primitives; RecordSink under Capability; query read-only; produce through review gate; secret-not-LLM; markdown truth) — REINFORCES three-verb contract (produce finally one verb, not N).
  - v44 2026-07-01: **§1B.8 NEW — per-pack scoped projection: a feature pack is a project-scope (bao 2026-07-01「全量修复」P3; realizes §7.5 feature-pack = CTRL's answer to "project").** The base projection (§1B.1) grants the global default intent over one root; §1B.8 makes each pack its own projection scope. `projector::project_pack(pack_id, name, kb, intent, port, token)` materializes a pack-scoped `.mcp.json` (stamps the pack's OWN intent domain — a §14 data pack → `source`, NOT the global default, so a pack grants exactly its domain without widening the base workspace) + a pack-context `AGENTS.md` (name + KB + "scoped to this pack") into `~/Documents/CTRL/<pack_id>/`. Reuses the base machinery via two small refactors (extracted `project_gate_into_dir(dir,port,token,intent)` — `project_into_dir` now a thin wrapper; extracted `project_agents_block(dir,block)` — `project_agents_md` passes `ctrl_agents_block()`), same atomic-write + marker-preserve + idempotent guarantees. Trigger v1: `project_installed_packs` at boot auto-projects a scope for every installed `record_source` pack (action-only packs' scope deferred). NOT a new primitive — uses the ADR-010 intent/visibility machinery as the scope namespace (conceptually the Channel primitive as a per-pack scope), 5 primitives unchanged; does NOT pull in the §1B.6 mesh network (still v1.1) — single-user local per-pack scoping only. Verified: cargo test --lib projector 21/21 (4 new: per-pack gate carries the pack's OWN intent not the global default; pack_agents_block names pack+KB+scope; omits KB line when absent; per-pack AGENTS.md preserves user prose) + all existing green (refactor non-breaking).
  - v43 2026-07-01: **§7.6 NEW — the share-and-be-shared PRODUCER side (pack publish) is v1 (bao 2026-07-01「分享中心是功能包定义属性 + 拉进 v1(含 registry 发布)」).** Discover already CONSUMES registries (§7.3/§7.4 pull); v1 was missing the PRODUCE half — a user could hand-copy a pack's JSON but not publish it to a commons. §7.6 makes create→publish→discover one v1 loop. **Scope-precise**: this is the pack-MARKETPLACE producer (a manifest published to a registry), NOT the §1B.6 mesh-projection network (peer assets projected into a CLI) — §1B.6 stays v1.1 (mesh substrate dependency); publishing a `ctrl-*` manifest is a plain HTTPS producer with no mesh dep, so only that half moves. **Mechanism**: gate tool `mcp_pack_publish(pack_id, registry?)` — read installed manifest → EVALS FIRST (`pack_validate::validate_manifest`, never publish a broken pack) → package (v1 = v2 manifest JSON; `.mcpb` reserved) → POST to the registry endpoint (URL+token from credential store `ctrl:registry:publish_url`/`:publish_token`, never the LLM) → return the published ref. Kernel-internal HTTPS; the REAL public registry (official MCP Registry mcp-publisher namespace ownership / ctrl-market Worker) is the honest external gap, CTRL-side producer verified by mock-HTTP (same posture as ctrl-ghostfolio's live instance). Frontend: a Share/Publish action → mcp_pack_publish → shows the ref; JSON copy-paste stays the zero-infra fallback. Locks: `ctrl-*` MIT commons (ADR-006 §5.1); no self-invented registry protocol (official mcp-publisher + namespace proof); publish gated on evals. NOT pulling the mesh network (§1B.6) into v1; NOT inventing a bundle format (`.mcpb`).
  - v42 2026-07-01: **§14.12 NEW — generic manifest-driven §14 connector source = zero-code product-grade uplift (bao 2026-07-01「全量修复」, serves §7.5 product-grade + §7.4 manifest=data).** Closes the gap §14.6 promised but connectors broke: a REST connector hand-codes schema + JSON→Row map + fetch + per-source gate tools (`ghostfolio_source.rs` fields/holding_to_row/fetch + `ghostfolio_describe/query/add_transaction`) → adding one = Rust code, violating §7.4/§7.5. **New manifest axis `record_source`** (query{endpoint,method,array_at} + fields[]{key,label,type,from:[json-path]} + optional produce{endpoint,method,body-map}; auth reuses v40 `auth.token_exchange`) + **new kernel `manifest_source.rs`** (`RecordSourceSpec` + `ManifestConnectorSource: QuerySource` via generic `from_json(spec,body)` + generic `fetch`/`produce`, shared `run_query` unchanged) + **new generic gate tools** `source_describe/query/produce(source_id,…)` dispatching by source_id to the installed manifest (per-source `ghostfolio_*` retire). ghostfolio = first data-driven instance (fields/holdings-endpoint/array_at/order-produce move into its manifest.json; hand-coded source retires to generic path, golden rows = equivalence test). Locks unchanged (Capability primitive not a new one; query read-only; produce through review gate; secret kernel-side; tolerant reader). v1 scope: kind=record, one array endpoint/source. NOT reinventing query/auth engines (reused) — only the missing data-declaration + generic-dispatch layer. Implementation via dev-loop, slice 1 = manifest_source.rs + equivalence/mock-HTTP tests.
  - v41 2026-07-01: **§7.5 NEW — 功能包 = 产品级单位 = CTRL 对标「project」(bao 2026-07-01「我们的功能包,类比 project 的话,我希望我们的功能包都是产品级别的;也是用户创造中心,分享中心」).** Studied Atoms(MetaGPT, cloned `~/Documents/coding/metagpt-reference/`) + Lovable — both organize by **project** as the top-level unit (MetaGPT `Team.generate_repo(idea)→repo` over an Environment+Role pub/sub kernel that independently mirrors CTRL's locked 5 primitives = spine validation; Lovable Workspace-Knowledge[global]+Project-Knowledge[per-app] = `CLAUDE.md`+`AGENTS.md` isomorph). CTRL's answer = **the feature pack** as the product-grade unit, substance INVERTED vs their builder model (integrate-not-rebuild / MIT-commons-not-hosting / local-not-cloud). **Three locked properties defining a feature pack**: ① product-grade (a whole product, NOT a raw wrapper — hard bar = §14 describe/query/produce uplift + one-shot high-signal atoms, per-pack KB, on-demand UI, per-call gate; "产品级" = user-language for the v39 anti-raw-wrap moat) ② creation center (Irisy `mcp-creator` NL→manifest, §7.4 source 3) ③ sharing center (Discover registry-pull + publish `ctrl-*` MIT commons, §7.3 share-and-be-shared). **读法 A (bao)**: "功能包" means the product-grade unit ONLY = capability-pack-map ①native-modules + ③connectors (Ghostfolio/CRM/PKM/stock/ERP, each a whole product); the ② atomic built-in tools (Clipboard/OCR/Translate Top15) are **ingredients/primitives, NOT feature packs** (nobody "shares a Translate atom") — they stay mcp manifests but off the Discover product shelf. IA collapse: **feature pack = product (create+share unit), tool = ingredient**. Locks unchanged (manifest=data/runtime=generic §7.4, 5 primitives, 3 verbs, :17873 gate, secret-not-LLM, plain-text) — this raises the acceptance BAR + collapses IA, adds no runtime branch. ctrl-ghostfolio seed now accepted only if all three hold (product-grade §14 uplift + Irisy-creatable + MIT-commons-shareable). Syncs `vault/ctrl/capability-pack-map.md` (①③=packs, ②=tools). NOT copying builder's "project as sole top unit" (CTRL stays ambient/capability-centric at the Ctrl→intent layer); NOT touching the 5 primitives.
  - v40 2026-07-01: **§7.2 — generic「一键装 + 静默认证」provision+auth engine (bao 2026-07-01「一键安装不要多余步骤 / 安全静默实现 / 没有好的通用化的方案吗 / 就按这个方向做 / 一次性完成」).** Generalizes the ghostfolio manual config-wizard into a DECLARATIVE, zero-per-pack-code engine (manifest = data, runtime = generic, per §7.4): a self-hosted connector installs one-click and authenticates silently from its manifest, no manual URL/token entry. **New manifest axes** (`manifest-schema.ts`): `provision.service` (declare a container/compose stack + `generated_secrets` + `ports` + `ready`-poll = the one-click-install half) + `auth` (composable `oauth` / `bootstrap` / `token_exchange` / `manual` = the silent-auth half). **New kernel runtime**: `pack_auth.rs` (generic `run_bootstrap` = one-time mint+capture by JSON-pointer; `mint_bearer` = per-call secret→bearer exchange; ghostfolio's authenticate now delegates here) + `pack_provision.rs` (`generate_secret` via uuidv4×2; idempotent `ensure_generated_secrets` → credential store; `render_env`/compose write; `docker`/`podman compose up` + `poll_ready`; `install_pack` orchestration = provision.service → bootstrap) + gate tool `mcp_pack_provision` (read installed manifest → `install_pack`). Generated + bootstrapped secrets land in the credential store (`mcp:<id>:*`, incl. the resolved `_base_url`), never the LLM (decision 0004). **ctrl-ghostfolio is now pure data** (v0.2.0 manifest): declares its app+PG+Redis compose (generated JWT/salt/DB/redis secrets) + `auth.bootstrap` (POST /api/v1/user → capture accessToken) + `auth.token_exchange` (auth/anonymous → JWT); `resolve_ghostfolio_creds` reads the provision-set `_base_url` + bootstrapped token. Frontend: `FeaturePackScene` shows one-click **Set up** (calls `mcp_pack_provision`) when the pack declares provision/auth, the manual **Configure** wizard (`PackConfigModal`) only as the last-resort fallback (`manual`/config_schema-only). **Differentiation (research `ai-native-feature-pack-research.md`)**: Smithery et al. are HOSTED gateways managing auth/session in the cloud; CTRL is local-first declarative self-run (service + data + creds on the user's machine, CTRL is only the engine) — the discovery→provision→silent-auth→§14 uplift→gate chain no single platform unifies. **Verified**: pack_auth + pack_provision pure/HTTP-mock unit tests (bootstrap capture, bearer exchange, secret gen, env render, port template) + manifest Zod vitest asserts full declarativeness. **Honest gap**: the real `docker compose up` + ready-poll runs on the user's machine (needs a container runtime + first-run image pull); CTRL-side render/orchestration/auth verified by unit+mock e2e. NOT hand-coding the long tail; NOT reinventing compose/manifest formats. **Scope of "zero-per-pack-code" (independent-checker precision, PASS)**: the INSTALL + BOOTSTRAP halves are fully generic/data-driven (`provision.service` + `auth.bootstrap` run purely from manifest data) and the auth PRIMITIVES (`run_bootstrap` / `mint_bearer`) are connector-agnostic + reused. What is NOT yet generic: the §14 DATA layer per connector — the gate tools (`ghostfolio_describe/query/add_transaction`) and the per-call `token_exchange` INVOCATION are ghostfolio-specific (ghostfolio = the reference §14 source; `ghostfolio_source::authenticate` calls the generic `mint_bearer` with ghostfolio's params, which mirror — but don't yet READ — its manifest `auth.token_exchange`, a small dual-source). A NEW self-hosted connector today still needs its own §14 source + gate tools; making that data-driven = a future **generic manifest-driven §14 connector source** (reads source shape + endpoints + `auth.token_exchange` from the manifest), the next layer beyond this provision+auth engine. Also v1: `provision.service` supports `compose_inline` only (`compose_ref` reserved). Recorded so the generality claim is precise, not overstated.
  - v39 2026-07-01: **§7 + §14 — first feature-pack seed `ctrl-ghostfolio` = make a self-hosted open-source app AI-native through the gate (bao 2026-07-01「功能包 = 把开源软件/MCP 编程成 AI-native」+「从 ctrl-ghostfolio 端到端跑通」).** Deep research (`vault/ctrl/ai-native-feature-pack-research.md`, 25/25 verified) established the reusable-bricks-not-reinvent posture — Agent Skills (SKILL.md) packaging · Anthropic `mcp-builder` four-phase pipeline (incl. evals) · AutoMCP OpenAPI→MCP (bottleneck = spec quality, invest in spec-repair not codegen) · official MCP Registry + Smithery (6.6k) distribution · OpenAI Apps SDK generative UI (structuredContent/content/_meta) · community Ghostfolio/Twenty MCP servers · AWS MCP Gateway == this ADR's `:17873` gate shape (validates gate as industry-standard). **The differentiation/moat (Anthropic "writing tools for agents": raw one-tool-per-endpoint wrapping is NOT agent-native)** = the **§14 AI-native uplift** (lift the app into the uniform describe/query/produce contract) + **per-call gate governance** (audit + intent-visibility, finer than the community MCP's coarse `READ_ONLY_MODE` env toggle) + the end-to-end pipeline (discovery→scaffold→govern→distribute→UI) no single platform unifies. **Landed (kernel):** `ghostfolio_source.rs` = Ghostfolio holdings as a §14 RecordSource (tolerant JSON reader; kernel-internal reqwest to `/api/v1/portfolio/holdings`, bypassing the caller-facing `guard_egress` since a self-hosted connector legitimately targets loopback/LAN + the URL is kernel/user-sourced not LLM-controlled); gate tools `ghostfolio_describe` / `ghostfolio_query` (read, shared `run_query`) + `ghostfolio_add_transaction` (§14 produce = POST /api/v1/order, high-signal "record a trade"); `ghostfolio_`→`ghostfolio` visibility domain + first-party set (NOT in the hermes BRAIN cap — connectors surface via intent-scoped projection, not the hardcoded core); creds (`mcp:ctrl-ghostfolio:ghostfolio_url`/`_token`) resolved kernel-side (`resolve_ghostfolio_creds`, env-override for tests) — token never reaches the LLM (§7.2 / decision 0004). **Seed manifest** `packages/ctrl-mcps/builtin/ctrl-ghostfolio/manifest.json` (config_schema loop-closer, Zod-validated by a ctrl-web vitest). **Verified:** mock-axum HTTP e2e (fetch→§14 query; add_transaction order body) + over-the-wire gate e2e (`ghostfolio_*` reachable through `:17873` + intent-scoped, http_post hidden). **Honest gaps:** live connection to a real Ghostfolio = the user's machine (self-hosted instance + token); frontend config-schema wizard (collect URL+token → keychain) + `FeaturePackScene` binding still to build; review-gate on produce is behind `CTRL_REVIEW_GATE` (v35, default-off until the PWA modal lands). This is the reference the Irisy mcp-creator flow (capability-pack-map ③) generates variations of — the seed proves the substrate + creation-flow, per the "dev hardens the flow, seed = live test" rule. NOT hand-coding the long tail; NOT reinventing manifest/registry/skills formats.
  - v38 2026-06-28: **§brain — generalize Irisy's brain from hermes-only → a CTRL-driven, SELECTABLE ACP engine (pairs ADR-005 §8.7).** bao design pass 2026-06-28 (「Irisy 不是可以选择是 Hermes 或者 Codex 么」). Refines v28 (Irisy brain = Hermes Agent): the **right region** (Irisy assistant) runs on a **selectable engine — Hermes / Codex / Claude Code** — and CTRL **DRIVES** it over **ACP** (JSON-RPC over stdio, the same `shell/acp_client.rs` already drives `hermes-acp`). Engines = ACP adapters: `hermes-acp` (bundled default, uvx) · `@zed-industries/codex-acp` (npx, wraps user's Codex) · `claude-code-acp` (npx, Anthropic SDK adapter). The engine choice is ONE spawn-command parameter; gate tools (`:17873` mcpServers), Irisy persona, loop+context ownership are identical downstream. **hermes stays the bundled default and does NOT retire.** Crucial distinction vs § projection: the **right-region engine is CTRL-DRIVEN** (ACP), while the **left-region (workspace) coding agent is USER-DRIVEN + projected, not supervised** — same product (e.g. Codex) can play both roles independently. This promotes §agent-channel (v27 "ACP = future enhancement channel") to the **concrete mechanism for the right-region Irisy engine** (projection remains the left-region / BYO-CLI-driver mechanism). Full model + acceptance: ADR-005 §8.7. Pairs ADR-001 spine §byo-cli-driver. NOT a return to "CTRL supervises a general brain" — CTRL drives the Irisy ENGINE per chat session (as it already does hermes-acp); it still does not supervise the user's left-region terminal CLI.
  - v37 2026-06-27: **§1 Irisy web search = free-by-default, BYOK upgrade (Pattern D 同构; bao 「默认 ddgs，有 Tavily key 才升 tavily」).** Irisy's live brain is the hermes one-shot (`hermes -z`), which runs hermes's OWN built-in `web_search`; the backend is chosen by `web.backend` in `~/.hermes/config.yaml`. Found via source read (hermes 0.16.0 `tools/web_tools.py`): hermes ships 5 backends — `exa`/`tavily`/`searxng`/`brave-free`/`ddgs` — and **`ddgs` (DuckDuckGo) is the only one gated on package-presence, not an env key** (`_ddgs_package_importable`), i.e. free, no signup, search-only. So CTRL tiers it like LLM Pattern D: **default = `ddgs` (free)**, **`tavily` only when the user supplied a key** (full web + extract). Wired: `write_hermes_web_belt` now pins `web.{backend,search_backend}` = `ddgs`|`tavily` + `extract_backend` = `tavily`|`""` (ddgs has no extract); `run_hermes_oneshot` launches `uvx --from hermes-agent==<pin> --with ddgs …` so the free backend is importable inside the isolated uvx env (ddgs is NOT a hermes dep / lazy-install target). Corrects v36's claim that Irisy web goes through the CTRL-native `web_search` gate tool — in the one-shot path it does NOT reach that tool; the CTRL-native Tavily/Wikipedia `web_search` (`mcp_server.rs`) is a separate gate surface. Real-machine verified end-to-end: keyless `ddgs` returned live results (current Node.js LTS + source URL) where the no-backend path had hallucinated a stale value. NO bundled key, NO CTRL-hosted cost, NO self-built search — pure backend selection over hermes-native capability. Does NOT touch pack creation.
  - v36 2026-06-27: **§2 network = allowlist-bound, now ENFORCED for external callers (closes the v35 "per-pack URL allowlist deferred").** `http_get`/`http_post` (the prime exfil surface) now fail-closed at the gate: a NON-first-party caller (BYO-CLI brain / pack) may only reach hosts its resolved capability declared (`capability_resolver::network_authorizes` host-glob match over HttpGet/HttpPost tokens), on top of the caller-agnostic `guard_egress` SSRF floor. **First-party app surfaces (pwa/irisy/hermes) are deliberately NOT bound** — Irisy's web search + data fetch go through the scoped `web_search` (domain `websearch`, first-party, Tavily/Wikipedia backends), never the raw net tools, so Irisy's network capability is untouched (bao 2026-06-27 "Irisy 需要网络搜索 获取数据能力"). Also wired the file dimension on the gate's exec path: `run_action_blocking` derives the OS sandbox write scope from the pack's declared `file.write_allowlist` (ADR-004 §1 acceptance). Remaining honest limit: downstream-MCP-server packs that do their OWN fetch are opaque to the kernel — CapToken can't bind them (process boundary governs); a pack that wants its network governed must route through the gate. Does NOT touch pack creation.
  - v35 2026-06-26: **Pack-execution security hardening (red-team C1–C5, bao 「对齐的话全量修复」). 2 drift-closes IMPLEMENTED + 2 new-direction amendments PROPOSED (pending bao).** Context: the gate裁剪 (§ visibility, ADR-010) is at *tool* granularity, but a feature pack's executable body (shell step / pack code) lives *below* tool granularity — the gate neither sees nor controls it. Closing that needed execution-layer isolation, not more governance. **IMPLEMENTED (drift-close, no direction change):** ① **§2 network = allowlist-bound floor** — the ADR said `network http (allowlist-bound)` but kernel `http_get`/`http_post` enforced nothing; added `mcp_server.rs::guard_egress` (deny loopback / 169.254 metadata / RFC1918 / `localhost`·`.local`·`.internal`, per-IP + per-redirect-hop) as the caller-agnostic egress deny-floor. (Per-pack URL allowlist binding still deferred — see KNOWN GAP.) Pairs ADR-004 §1 v3 OS sandbox (which network-denies the pack shell entirely). ② **§264 review gate** — "write/delete/command = high blast-radius → ADR-006 §4 ladder, never silent" was unimplemented; added `kernel/review_gate.rs` (human approval, gate-side arg summary = C3 anti-injection, approval via Tauri command surface the external brain can't reach = no caller self-approval) + `call_tool` wiring + `commands/review.rs`. Behind `CTRL_REVIEW_GATE=1` (default-off) until the PWA approval modal lands; mechanism + trust boundary tested. **PROPOSED (new direction, NOT yet built — needs bao):** ③ **C2 secret-broker** — §7.2:679 specifies `{{secret}}`→pack-process env injection; the OS sandbox now denies the pack network so it can't *exfiltrate* an env secret, but a hardened path = kernel holds the secret + proxies the authenticated outbound call, pack never sees plaintext. This CHANGES §7.2 (env injection is the current design), so it is a proposed amendment, not a drift-close. ④ **C5 mcp-bus uds + SO_PEERCRED** — § mcp-bus is loopback TCP + bearer token (per-boot ephemeral); a stolen token = full impersonation (no process binding). Proposed: Unix-domain-socket + peer-credential check so the gate binds the *connecting process*, not just a bearer. Lower priority (token already per-boot ephemeral + within the declared "本机账户可信" residual-risk假设). **KNOWN GAP** (surfaced, not faked): manifest `capabilities` is an object but `capability_resolver::resolve_installed` expects a CapToken array → installed packs resolve to `Capability::empty()` (fail-closed but the declared capability surface is inert); per-pack network allowlist + per-pack sandbox-profile derivation both block on wiring this adapter. Residual risk explicitly OUT of scope: a local account already fully compromised (industry-standard trust floor for all local-first software). Supply-chain pack signing (C1) tracked under ADR-004 §6 (trust-model research in flight).
  - v34 2026-06-25: **§7.4 NEW — 功能包系统化方向锁死 (bao 2026-06-25「加功能包不能改代码,要系统化」+「长期」+「网上找方案」).** manifest = 数据,runtime = 通用引擎,**加一个 pack 零代码**。三个零代码数据源: ① 本地装 `~/.ctrl/mcps` (已数据驱动,`loadInstalledPacks` 读任意 manifest) ② Discover commons = registry 客户端 (拉 MCP Registry `.well-known/mcp.json` + Smithery 2000+;`OFFICIAL_PACKS` 硬编码数组退成临时 stand-in,接 registry 后退役) ③ Irisy 生成 (mcp-creator persona + **复用 Anthropic `mcp-server-dev` 开放 Agent Skills** build-mcp-server/app/mcpb,不重造: discovery→scaffold→MCP-Inspector 校验→gate 装)。通用 runtime 落点已就位: `FeaturePackScene` 读 `actions[]` 渲染 / gate `mcp_pack_run` 执行 (secret 不回 brain) / 通用 `knowledge_base` 字段绑专属 KB (`inKbScope` 裁剪,stocks=助理+`Stocks/`+ghostfolio,非新角色) / gate `mcp_pack_install` = brain 自装回流落点。对齐 ADR-001 § projection (projector 投影开放 skills)、ADR-006 §5 commons、ADR-003 §8.6 + ADR-005 v6 (角色=persona 层,pack+KB 正交,不焊死)。NOT 自造 manifest/bundle 格式;NOT 为每 pack 写分支;NOT 人工维护长尾列表。
  - v33 2026-06-22: **§14 深化 — 批判性自审后补 §14.8-§14.11 (事实源 `vault/ctrl/comms-architecture-permanent.md` §10).** 补四项: (1) **§14.8 query 结果随 source_kind 多态** —— 动词仍三个,返回类型随 describe().source_kind 分化 (Records/Text/Blob),修 v29「QueryResult 是 record-shaped {rows}」的类型坍缩,让 pdf/图片 (Blob) + 长文 (Text) 不用 hack 进 record。(2) **§14.9 produce 分 Write vs Effect** —— effectful 长耗时动作返回 OperationHandle{operation_id, idempotency_key},坐到 ADR-001 第五 primitive **Effect** 上;进度复用 §14.7 query{watch}、取消复用 produce、幂等键防重放,run_ai_column 手搓 job 收编成标准 Effect (模型: Google AIP-151 LRO / Temporal / gRPC operations)。(3) **§14.10 协议版本协商** —— describe 自报 protocol_version (SemVer),gate 按版本路由/降级,protobuf 式只增不改,破坏性变更走 major + N/N-1 迁移窗口 (CORBA/SOAP 死于版本脆性)。(4) **§14.11 AI-facing 错误契约** —— 结构化 Feedback{kind, retriable, correction, human},QueryError::UnknownField 收编为特例,闭合 Irisy 自纠回路 (RFC 7807 / gRPC rich error)。NOT 改动词集 (仍三);NOT 改 spine 5 primitive (反而启用 Effect)。配套总纲 D/E/G/H 进 ADR-010 v4。
  - v32 2026-06-22: **§14.7 subscribe — streaming read = query{watch} 投影 (NOT 第四动词).** (此条补记: §14.7 正文在 commit aa990ab 已写入 + frontmatter 已 bump 32,但当时漏记 changelog 行,现补。) Irisy/PWA 订阅 query 结果集,源变 → gate 推增量 (ST-SS Cell/Op);subscribe 不是新动词,是 `query{watch:true}` 传输投影,无流语义的源 (registry/providers) 天然不实现 (ISP);授权+审计经 :17873,字节走 :17872。事实源 `vault/ctrl/comms-architecture-permanent.md`。
  - v31 (provenance, no content change): frontmatter version 在 commit 78a3577 从 30 bump 到 31,但未改动 §14 任何内容、亦无 changelog 行 (无意的版本号 bump)。此条仅为补全版本号连续性,无实质决策。
  - v30 2026-06-20: **§14 amendment — smart-table 对标飞书 Bitable:数据层路线 C(SQLite 派生索引,markdown 仍 truth)+ 网格层 glide-data-grid(bao 拍板).** 调研(`vault/ctrl/feishu-bitable-parity-assessment.md`,飞书 27 ui_type / 6 视图 / 关系型 + Teable·undb 源码 + glide-data-grid 能力)铁证:飞书 Bitable 灵魂=关系型(关联/Lookup/Rollup/跨表公式),**纯 markdown 做不到**(O(n²) 文件 I/O、无事务双向同步、无外键悬空、数万行不可用)。bao 选**路线 C**:markdown 存 schema/数据/关联(仍是 truth,vim 可读,守 plain-text 哲学),**SQLite 作派生索引**(从 markdown 重建,类比现有 `vault_index.rs` FTS5 + `embeddings` SQLite),关系型/Lookup/Rollup/大规模 `query` 走索引算,写回 markdown。**§14 query 引擎获得 SQLite 索引后端**(RecordSource 可选 index-backed),markdown round-trip 不变。网格层::17873 gate/数据契约不变,PWA 用 **glide-data-grid(MIT, canvas, 百万行, 键盘/复制粘贴/填充/列宽/冻结)** 重做 grid 视图,`getCellContent` 回调直连数据源(契合"本地是 truth")。开源:glide-data-grid 直接用(MIT 可商用),Teable/undb(AGPL)只参考关系型/Lookup/公式/Visitor 设计不搬码。关系型字段(关联/Lookup/Rollup/公式)落地待后续切片;本次先 glide 网格(不碰数据层)。NOT 改 spine 5 primitive。
  - v29 2026-06-19: **NEW §14 Unified Operation Interface — describe / query / produce (bao 「修改架构」).** 把 query 引擎从 smart-table 专属抬成 substrate 级契约:所有 content-type **功能点**(md/html/智能表格/pdf/CRM连接器/笔记元数据/mcp注册表…)经 :17873 gate 用**一个统一接口**操作,不再每能力各造工具。三动词:**`describe`**(普适,自报字段+支持的算子=类型/语义层,防"一切皆文件"丢类型的塌陷)/ **`query`**(读,并行、不过门,kernel service over `QuerySource`,功能包+工作流是 client)/ **`produce`**(写,串行、**过 review gate**,与 query 分开——连 GraphQL 都 query≠mutation,且 CTRL 写不分开就没法门控)。源分 RecordSource(filter/sort/group)/TextSource(match/semantic)/BlobSource(get/extract),算子由 describe 自报 → 统一在接口、分化在 describe(**不是啥都 query**)。NOT 新增 spine primitive(5 锁)——kernel 服务 + gate 契约,挂 Capability primitive 下。smart-table(ADR-003 §6.5)= 首个 RecordSource 实现。研究依据:GraphQL query-vs-mutation / Unix·Plan9 everything-is-a-file / 2026 agentic-AI Unix-philosophy 论文,事实源 `vault/ctrl/research-unified-operation-interface.md`。
  - v28 2026-06-18: **纠正 v27 brain 层 (bao 实查运行真相后钦定) + Obsidian connector 落地验证.** v27 把 brain 写成「BYO-CLI driver 取代内置 brain，hermes 摒弃」——**写过头了**。运行真相：**Irisy 的 brain = Hermes Agent**，CTRL 确实 bundle + 启动 hermes（dashboard :17890，Irisy 嵌入），**hermes 不退役**。**BYO-CLI driver / projection 是「附加」并行路径**（用户自带 CLI 经投影的 `.mcp.json` 也能驱动 CTRL 工具，已落地 `kernel/projector.rs` + 真机验证），不是替代。§1 brain 的「hermes 摒弃」就 brain 层而言 superseded（§ projection / § mcp-bus / Obsidian / plain-text 仍有效）。**Obsidian Local REST API MCP 连接落地**：根因 = `obsidian_connect` 从未被调用（boot 没接线）+ rmcp `auth_header()` 双重 Bearer 前缀 401；修复 = boot best-effort `register_and_connect` + reqwest default-header 带精确 `Bearer <token>`。真机验证：connected to bus，**16 工具**。真相源 `vault/ctrl/architecture-byo-cli-driver.md` 顶部纠正块 governing。
  - v27 2026-06-17: **架构换代 — CTRL = BYO-CLI driver platform (bao 钦定 2026-06-17). § brain reframed + §1.8 ACP demoted to future + NEW § projection (core).** The brain is no longer a CTRL-installed/lazy-installed/supervised process (hermes / opencode / Pi all摒弃 as the brain): the **driver = the user's own local CLI** (Claude Code today; any agentic CLI tomorrow). CTRL does NOT spawn or supervise the brain — the CLI owns its own lifecycle, its own model, its own agent loop + scheduling. **§ brain (§1)** rewritten to "BYO-CLI driver brain" — CTRL is install + projection + keychain + MCP-bus gate, not a brain runtime. **§1.8 ACP** demoted from "single door / THE channel" (v23) to a **future enhancement channel for ACP-aware CLIs** — the main integration path is NOT ACP, it is **projection** (new § projection); ACP client + probe code is NOT deleted, marked future work. **NEW § projection (core of this换代)**: CTRL接入 = materialize local assets into the target CLI's NATIVE config so the CLI discovers them with zero CTRL interposition — asset→injection-point table (tool → MCP server on bus :17873, written into the CLI's mcp config e.g. `~/.claude/.mcp.json` / 技能 → `SKILL.md` materialized into the CLI's skills dir / 记忆 → derived `CLAUDE.md` / `AGENTS.md` / 用户触发 workflow → slash command in `.claude/commands`); manifest optional `target:` override, default auto-routes by asset type; ONE projection serves two triggers — **passive projection** (substrate; user runs their own CLI → assets auto-discovered, zero侵入) + **active spawn** (CTRL launches the CLI inside an ephemeral workspace); scheduling权 stays with the CLI's model, CTRL only "makes the CLI see" + "call-return flows back to :17873 = the kernel gate" (§6 mcp-bus now also = the projection tool call-return gate); projection is **intent-scoped** (project a subset, never全量灌爆 context); **shared network (share & be shared) = v1.1 future**, architecture reserves the interface. § provider / § crypto / § subprocess / § composition / §1.9 Obsidian notes基本不动 (§ mcp-bus :17873 annotated as the projection call-return gate). Supersedes the v23 "ACP single door" / v22 "provider-router default brain" / v19 "3-agent aggregator" framings as the AGENT-INTEGRATION model — those entries kept below as provenance, superseded-by-v27.
  - v26 2026-06-17: **§1.9 research-corrected (bao "调研别猜" + "不要跳出 ctrl 不然产品就破裂了") + NEW §1.9.1 Obsidian connector spec.** Web research forced a reversal of the v24/v25 "Obsidian = the editor" framing: (1) Obsidian is NOT embeddable (Electron, no web/headless — can embed web INTO Obsidian but never the reverse); (2) its Local REST API is data-only (CRUD/patch/search/metadata, NO rendering/backlinks/graph); (3) embeddable Obsidian-compatible web tools (Perlite/Quartz) are read-only publishers. ∴ "stay in CTRL" FORCES CTRL to render notes itself. **Layer 3 reframed: CTRL's `NotesApp` + kernel vault index = the PRIMARY in-CTRL notes UI (single entry); Obsidian = compat target + optional connector, never the UI, never the default jump-out.** Scope decision RESOLVED: KEEP NotesApp (don't slim/rip — single entry + mobile need it); stop ADDING PKM parity. **NEW §1.9.1**: the Obsidian Local-REST-API plugin ships its own MCP server (`/mcp/`) → register on the bus :17873 (~zero adapter); endpoint→Irisy-capability table (vault CRUD/patch · `/search/` Dataview/JsonLogic · `/active/` operate-on-open-note · `/commands/` drive any plugin command · `/periodic/` · `/open/` controlled handoff); two-tier access (baseline kernel notes-MCP always + enriched Obsidian connector when running); write/command tools gated (ADR-006 §4). Implementation slice 1 (SilverBullet retirement) DONE; connector = slice 2.
  - v25 2026-06-17: **NEW §1.9 — Notes architecture consolidated + migration plan (bao "先做好计划 把架构更新一下").** Draws the v24 decision into one 5-layer picture (data / agent-access / Obsidian editor / CTRL light inline viewer / optional Obsidian REST MCP). Surfaces that CTRL reinvented Obsidian TWICE — the kairo/SilverBullet bundle AND a heavy in-house NotesApp (GraphView/Backlinks/Tags/Templates). Plan: (1) retire SilverBullet bundle [safe], (2) `/notes` "Open in Obsidian", (3) **scope decision pending bao** — slim NotesApp to a light viewer vs keep, (4) optional Obsidian REST MCP connector. Layer-2 agent access (notes-MCP :17873) is editor-independent — no change. Mobile keeps a light CTRL viewer (can't run desktop Obsidian). Code in DRIFT D7.
  - v24 2026-06-17: **Notes/KB layer — kairo (SilverBullet) RETIRED, Obsidian adopted (bao 2026-06-17 "用 obsidian 不要重复造轮子").** CTRL bundles NO notes editor — don't reinvent the wheel; Obsidian (the dominant PKM, mature ecosystem) is the user's editor over the plain-md Notes folder. Reconciliation (zeus, 2 locked-principle tensions flagged + resolved): (1) "Ctrl is the only entry" — heavy PKM editing/graph/plugins = Obsidian (a deliberate single-entry exception for the notes-editing vertical); CTRL keeps a LIGHT inline md viewer for read/preview in the morphing surface (it must render md anyway — not reinventing Obsidian). (2) "Obsidian = compatibility not dependency" — NOT a hard dep: data is always `~/Documents/CTRL/Notes/` plain-md; **agents read/write via kernel notes-MCP on bus :17873, editor-independent**; no Obsidian → CTRL's inline viewer still reads. Obsidian = preferred editor + OPTIONAL Local-REST-API MCP connector (cyanheads/obsidian-mcp-server / coddingtonbear/obsidian-local-rest-api) for backlinks/tags/graph; remove it and the data + notes-MCP remain. **What "use Obsidian" does NOT mean**: not the "Hermes Console" Obsidian-as-host model (that makes CTRL pointless); CTRL stays the host, Obsidian is a data+editor face on the bus (apps-as-MCP-source, ADR-001 §3). RETIRED: kairo=SilverBullet 2.8.1 bundling (`agent_installer::install_via_binary` SilverBullet path + `agent_launcher` webview branch + `~/.ctrl/agents/kairo/`). The 3rd aggregator slot is no longer a CTRL-bundled agent — it's the user's Obsidian via MCP. Updates §1.1 (kairo row → Obsidian connector) + §1.8.3 (KB = Obsidian + Notes-MCP). Pairs ADR-001 (kairo refs) + ADR-003 (Notes route) + CLAUDE.md stack. Code follow-up: retire SilverBullet install/launch, point /notes at "open in Obsidian" + keep inline viewer, optional Obsidian REST MCP register. All residual "kairo"/"SilverBullet" references across ADRs are SUPERSEDED by this entry pending a sweep.
  - v23 2026-06-17: **NEW §1.8 — agent integration channel locked: ACP single door + 3-face MCP passthrough + KB-not-brain + upgrade规范 (zeus drill 2026-06-16/17, bao Q&A).** Supersedes the v20 "ACP stdio; interim `hermes -z` one-shot" note — **ACP is THE channel**, one-shot retired as a routing path (`HERMES_FIRST` dead path removed; degraded path = provider router → BYOK direct, already shipped, matches v22 default). Decision chain bao pressure-tested across 8 turns and converged: (1) **端点 = ACP single door** — `uvx --from 'hermes-agent[acp]==<pin>' hermes-acp`, CTRL is the ACP client (same role as Zed / JetBrains AI Assistant / Neovim CodeCompanion). **TUI-gateway NOT adopted** (hermes-private interface = highest upgrade-breakage; its only edge — driving hermes-internal skills — is exactly what CTRL rejects since skills are CTRL-side SSOT). **OpenAI-server NOT adopted as hermes door** (ACP gives more: structured tool/permission events). (2) **3 faces reach the agent via ACP MCP passthrough** (Zed-standard: client passes its MCP servers to the agent at session start, tool calls pipe back over ACP = connectivity + gate + visibility in one) — MCP/API/Skills all consumed from CTRL's bus :17873, never the agent's own; 4 hard constraints (agent MCP client → only :17873; provider router exposed as MCP tools; skills dir = ~/.ctrl/skills; apps/OAuth = MCP source not a 4th face). (3) **KB ≠ brain channel** — user KB = kairo + Notes-MCP; ACP delivers the assistant + hermes-internal RAG, not the user KB. (4) **Upgrade规范** — single pin SSOT + version lockfile (mirrors ADR-005 §4.6) + `hermes-acp-probe` contract probe (mirrors ADR-005 §7.7) + L3 gate (ADR-006 §4), rollout tier under ADR-004 §updater. ACP provenance verified (Zed 2025-08 Apache-2.0; JetBrains partnership 2025-10; Gemini CLI reference impl; hermes#569; agentclientprotocol.com) — the one ACP client doubles as CTRL's universal agent-aggregation surface (ADR-006 §5 通用化). Pairs ADR-001 §4.1 v5 + ADR-004 §updater + DRIFT.md (hermes-online → in progress). Code: dev builds the ACP client + probe; zeus owns this doc.
  - v22 2026-06-12: **§1 brain — converged architecture (bao 2026-06-12; vault/ctrl/decisions/0006).** Irisy = a surface that replies via a brain: DEFAULT = provider router (the user's configured Claude/Volc, fast + reliable); hermes is an OPTIONAL brain feature pack, NOT a hardcoded interceptor. `irisy_chat.rs` HERMES_FIRST toggle = false (889d104) — ALL hermes code stays (installer / run_hermes_oneshot / write_hermes_dotenv / assistant_oneshot), but the slow uvx one-shot (cold start, 180 s timeout, no streaming) no longer intercepts every turn (root cause of bao's "Irisy didn't reply"); flip back to true once hermes ships ACP streaming. Notes view = built-in NotesApp by default, NO kairo embed (b547bc3) — removes the blank-iframe failure mode (kairo could report ready before SilverBullet served); kairo re-attaches as an optional notes feature pack later. DIRECTION (not yet built, capability-limited present per bao): three engines (hermes=brain / kairo=notes / opencode=coding) become feature packs (manifest `target:brain` etc.), not hardcoded agents; knowledge base = Notes (local md) + kairo viewer + Irisy recall (RAG) + supply (derive AGENTS.md). "vault" word retired (→ Notes). Ship NOW: Irisy-via-Claude + built-in Notes + installable packs; RAG / supply / engine-packaging later.
  - v21 2026-06-12: **§7 composition — feature pack model + axis 7 `provision` (bao 2026-06-12; dogfood decisions in vault/ctrl/decisions/0005).** 「功能包」(feature pack) locked as the USER-FACING name for an installable manifest — code keeps "mcp", all PWA copy → 功能包 (extends v12 keycap→mcp from a code-rename to a user-name). Feature pack = universal shell for "plug any API → orchestrate → on-demand UI": one schema fills wildly different worlds — CF Workers 开发 (cli-wrapper + CF token + deploy/logs) AND HubStudio 营销 (network HTTP allowlist + API key + manage-accounts/batch-post + AI rewrite + account-matrix UI); 想要什么出什么 UI = the pack declares `ui_surface`, the AI creator generates it from one intent sentence; CTRL stays a substrate — scenarios (营销/开发/CRM) grow as packs, not built-ins. NEW **axis 7 `provision`** (toolchain install + env), closing the gap cap_asset left (cap_asset only copies static files; provision installs external toolchains): `tools[]` (id/check/install) resolved built-in-downloader-FIRST (`~/.ctrl/tools/<id>/`, same lazy-install lineage as pi/kairo, isolated, removed on uninstall) → system pkg-mgr fallback (brew/winget/npm via `install.<os>.via`) → manual guidance; `env` resolves `{{secret:<key>}}` from keychain at inject time, never touching the LLM (decision 0004 — secrets never reach Irisy). One-time base infra: a tool registry (tool id → per-platform prebuilt binary URL + checksum) the downloader queries by id. Distribution bundle = Anthropic `.mcpb` (reused, not a custom format). Discover = the pack store — intent → Irisy 收敛 1-3 (curation, NOT a Quicker 8000 long-tail wall) + scene-grouped browse + search; create = AI generates the pack from natural language (user writes no JSON unless advanced); same format both ends → 造的=别人挑的源头 (share-and-be-shared). Research backing: vault/ctrl/research/{opensuse,quicker}.md (YaST Patterns 成组一键 + Dolphin KIO transparent-mount + Quicker 场景面板). Schema lands in `manifest-schema.ts` (provision Zod axis); Rust base (tool registry / built-in downloader / provision runner / .mcpb install) follows. ADR-001 spine pairing TBD.
  - v20 2026-06-10: §1.1 upstream verification corrections (full web research, H-2026-06-09-002): **hermes** = NousResearch/hermes-agent (PyPI via uv; npm "hermes-agent" is an unofficial third-party pip shim — banned); endpoint corrected MCP stdio → **ACP stdio** (`hermes-acp`; no MCP `chat` tool exists upstream); interim chat bridge = `assistant_oneshot` (`hermes -z`) until the kernel ACP streaming client lands. **opencode** real API: `POST /session` + `POST /session/{id}/prompt_async` + global `GET /event` SSE bus (no per-request stream); announce line `opencode server listening on <url>`; creds inject via env/`OPENCODE_CONFIG_CONTENT`; `file.edited` events feed the artifact pane. **kairo codename resolves to SilverBullet 2.8.1** (silverbulletmd, MIT, single Go binary, plain-md folder, wikilink+backlink, frame-clean) — launched with `SB_SHELL_BACKEND=off SB_RUNTIME_API=0 SB_DISABLE_SERVICE_WORKER=1` (upstream /.shell executes arbitrary commands; never expose). §1.5: Irisy chat now routes through the in-process provider router (`provider/routing.rs`, one SSOT shared with /text-chat) — the dead Pi MCP hop (127.0.0.1:17874) removed from `irisy_chat_stream`. Agent-first hermes routing layers on next.
  - v19 2026-06-09: **§1 brain — dual-brain supervisor model FULLY RETRACTED. Replaced by 3-agent aggregator (H-2026-06-09-002).** bao framing校准 (2026-06-09 conversation): "Irisy 是表象", "hermes opencode kairo 都是外部的", "现在重要的是前端". The v18 supervisor model (`opencode_supervisor.rs` / `hermes_supervisor.rs` / `brain_supervisor.rs`) over-engineered the kernel — supervised brains, owned their lifecycle, persisted per-brain credential files. Replaced by thin **agent integration**: kernel `agent_installer.rs` + `agent_launcher.rs` only (no supervise, no restart, no per-brain config write). 3 external agents (hermes / opencode / kairo) lazy-installed to `~/.ctrl/agents/<name>/` and launched on-demand. PWA directly consumes each agent's native endpoint (opencode HTTP, hermes MCP stdio, kairo webview). **NEW §12 capability-faces** locks 3-face SSOT: MCP (协议) + API (provider router, fal.ai flagship) + Skills (markdown SKILL.md, Claude Code Skills schema). Supersedes 2026-06-05 `decision_keycap_collapses_to_mcp_meta_ux_layer` over-塌缩. **§8 Vault stack lock (Tiptap+CodeMirror+FTS5) RETIRED** — kairo (MIT external) owns notes editing + wiki-link + backlink + git; CTRL exposes `~/Documents/CTRL/Notes/` via MCP for agents only. Retirements: `shell/{brain,opencode,hermes}_supervisor.rs`, `commands/{opencode,hermes}_chat.rs`, `commands/pi_rpc.rs`, `bin/e2e_verification.rs`, `packages/ctrl-pi-bridge/`, `packages/ctrl-pi-plugin/`, `shell/pi_install.rs`. PWA `IrisyChat forceMode="coding"` legacy retired — `/coding` connects to opencode HTTP directly. fal.ai BYOK adapter lands in §3 provider router as flagship API-face exemplar (985 endpoints vs Codex 1-model lock). ADR-001 spine v3 → v4 paired update. NO brain switcher UI still holds (PWA L1 chip routes statically).
  - v18 2026-06-09: **§1 brain — dual-brain architecture amendment (H-2026-06-09-001, PR #84). RETRACTED by v19 same day. Kept in changelog for provenance.** User-chosen opencode + Hermes as peer brains (conversation 2026-06-09 08:48): "确认 干" + "继续 干". §1 rewritten: opencode (coding brain, LSP + formatter + symbol search, HTTP API on random port, stored in `~/.local/share/opencode/auth.json`) + Hermes (assistant brain, RAG + long-term memory, MCP stdio protocol, stored in `~/.hermes/config.yaml`). Both spawned as peer subprocess agents via `shell/opencode_supervisor.rs` and `shell/hermes_supervisor.rs`. Independent contexts: no cross-brain context sharing. PWA commands: `opencode_chat_stream` (SSE, delta/done/error) + `hermes_chat_stream` (SSE, MCP tool calling). 8 code review issues fixed (race condition via Arc<Mutex<>>, health check, credential vault via keyring crate, event listener cleanup, constants extraction, graceful degradation). ADR-001 spine updated v2→v3 (dual-brain diagram). Pi removed as sole brain (still available as standalone CLI). Hermes installed via `npm install -g hermes-agent` (NousResearch, supports `hermes mcp serve`).
  - v17 2026-06-07: **§1 brain — full keycap retirement (word + cap-mode concept), ship 0.1.188.** bao 2026-06-07: "去掉 keycap 概念 你会更加清晰". v12 (2026-06-07) renamed symbols/filenames/packages but left runtime concepts intact; v17 finishes the job. (1) **`SessionMode = 'personal' | 'coding'`** — `cap` mode dropped (`packages/ctrl-web/src/lib/session-state.ts`). The "Pi wears a SKILL.md as a one-shot hat" behaviour was keycap dressed up as a session — skills are now invocable references Irisy reads on demand via `list_skills` / `read_skill`, not pinned via UI state. (2) **store actions** `wearCap` + `removeCap` REMOVED. `currentSkillId` field REMOVED. `sessionLabel()` simplified to 2-mode. (3) **IrisyChat.tsx** — cap banner block deleted, only the coding-mode `Coding · <projectDir>` indicator survives; `skill_id` no longer passed on the wire from this surface (kept as optional per-prompt param in `llm-transport.ts` for a future slash-command flow). (4) **pool.tsx** — skill rows render as documentation; "Wear cap" action button removed. (5) **IrisyCustomMessage `ModeSwitch`** — `cap` case removed; legacy bridge payloads still render via the default `Mode: ${mode}` fallback rather than empty pill. (6) **word scrub** — 5 code files (manifest-schema, vite.config, InfraBar, McpRunView, irisy-prompts) and `doc/design/tokens.json` (visual token rename `keycap*` → `key*`, no CSS refs verified pre-rename). (7) **External SKILL.md** — `~/.claude/skills/irisy-build/SKILL.md` + `~/.claude/skills/irisy-llm-tuning/SKILL.md` patched in v16 prep work (the persona reads these via `read_skill`; stale references were leaking "keycap" framing into Irisy answers). Tsc green. Remaining "keycap" string occurrences in this commit are deliberate retirement-changelog comments documenting what was removed — kept as load-bearing context for future readers (no live concept references).
  - v16 2026-06-07: **§1 brain amendment — Coding L1 split layout ship (0.1.187)**, bao 2026-06-07 ask: "对话和代码能分开吗？代码还是在左侧, 右侧 Irisy 是 coding 的角色" + picked option "分屏 + Pi default coding-agent" over Irisy-persona-stays variant. v15 wired Pi-native routing correctly but kept single-pane chat, so generated code dumped inline in chat bubbles. v16 splits the Coding L1 route into 2 columns: left ~40% `<CodingArtifactPane />` (files Pi Write/Edit's, fetched via `pi_rpc('getMessages')` after each chat done event, projected through `extractArtifacts` which walks AssistantMessage `content` for `{type:'toolCall', toolName:'Write'|'Edit'}` blocks and de-dups by `args.file_path`), right ~60% `<IrisyChat forceMode="coding" />` (Pi default coding-agent persona — `coding-`-prefixed session name causes both persona extensions to short-circuit per v15 §brain). New files: `packages/ctrl-web/src/components/coding/CodingArtifactPane.{tsx,module.css}`. Modified: `packages/ctrl-web/src/routes/coding.tsx`. Polling is event-driven (Tauri `chat-stream-delta` `done:true` listener, 250 ms debounce, sibling-component to IrisyChat via Tauri pub/sub) — no filesystem watcher, no kernel side-channel. Pi remains the SSOT (memory `feedback_pi_is_core_use_upstream_surfaces`). Limitation: Edit tool calls render `old → new` diff rather than full post-edit body (full body requires a follow-up Read Pi may skip); flagged for v17 if it bites in practice. Cargo + tsc green.
  - v15 2026-06-07: **§1 brain amendment — Pi-native Coding L1 ship (0.1.186)** via the path v14 promised. Same Pi RPC process as Irisy chat (port 17874), no 2nd daemon, no new bridge package — concurrency solved with one PiBridge mutex + per-mode named sessions (`irisy-default` / `coding-default`). Locks: (1) **MCP `text.chat` schema** — `arguments.mode: "assistant" | "coding"` field added (`packages/ctrl-pi-plugin/src/mcp-server.ts`). Kernel `irisy_chat_stream` now forwards `args.mode` to the tool/call JSON (`src-tauri/src/commands/irisy_chat.rs`); PWA `IrisyChat` already sent `mode` per v6 (3-mode P0), now it actually reaches Pi. (2) **`PiBridge.ensureModeSession`** — on each `chat()` the bridge resolves the per-mode session: cache → `listSessions()` recovery (survives CTRL restart, no session proliferation) → `newSession()` + `setSessionName('<mode>-default')` if absent → `switchSession(targetPath)` only when active session differs. (3) **`chatChain` mutex** — concurrent `chat()` calls from Irisy + Coding tabs FIFO through the bridge so `switchSession + prompt` is atomic per turn (no race where Coding's prompt lands in Irisy's session). Streaming preserved per-call; previous-chat throw doesn't poison the chain. (4) **Persona extension dual-skip** — both `packages/ctrl-pi-bridge/src/index.ts` (CTRL-bundled persona + audit + RAG) AND `/Users/mac/Documents/coding/irisy-persona/src/index.ts` (external, loaded via `IRISY_PERSONA_EXTENSION` env) now read `ctx.sessionManager.getSessionName()` in `before_agent_start` (and the bundled one in `before_provider_request` for vault-RAG) and short-circuit when the name starts with `coding-`. Pi keeps its default coding-agent system prompt + 7 builtin tools (Read/Write/Edit/Bash/Grep/Find/LS) for those turns. (5) **`routes/coding.tsx`** — replaces v14 placeholder with `<IrisyChat forceMode="coding" />`. IrisyChat gained an optional `forceMode` prop that overrides the global session-state store, plus a per-mode localStorage key (`irisy:chat:v1` / `irisy:chat:v1:coding`) so the two tabs' histories never bleed. Cargo + tsc green. Direct quote from v14 commitment: "rebuilds the Coding tab as a 2nd `pi --mode rpc` process with its own bridge extension (mirrors the Irisy chat pattern, no wrapper layer)" — v15 lands the same outcome via 1 Pi process + session router, avoiding the 2x memory + 2x boot + parallel ctrl-pi-plugin SSOT that a literal 2nd process would have required (bao 2026-06-07 B1 path picked over B2).
  - v14 2026-06-07: **clean baseline before Pi-native coding module rebuild.** bao 2026-06-07 "你是在修修补补还是在建系统？coding 不是 PI 自带的功能吗？" + "好 干净建立 PI coding 模块" — Pi already IS coding (`pi-coding-agent`); wrapping Pi inside an xterm subprocess (v11 §3.11) or even a thin cs_spawn (v13) is the wrong abstraction layer. Pi README explicitly says "SDK for embedding in your own apps, see openclaw for a real-world SDK integration". v13's cs_spawn `pi` TUI path was still mode-1 (interactive) wrapping; the right path is mode-3 (RPC) — spawn a 2nd `pi --mode rpc` process with its own bridge extension, mirroring the Irisy chat pattern. **This v14 entry only retracts the broken patches** (`commands/coding.rs` deleted, `lib/coding-spawn.ts` deleted, PrimaryRail ensureCodingEnv special-case reverted, `routes/coding.tsx` reduced to a clean rebuild notice). The 2nd-Pi-process implementation lands in the next ADR amendment + release (post `/compact`, fresh thread). Mid-state ship 0.1.185 ensures no broken "no tab renderer" UX in the L1 Coding chip.
  - v13 2026-06-07: **RETRACT v11 §3.11 — Coding L1 uses Pi natively, no CTRL wrapper.** bao 2026-06-07 "你不要什么都自己开发, Pi 有的就用 Pi 的" + memory `feedback_pi_is_core_use_upstream_surfaces` (locked 2026-05-31, IGNORED in v11). v11 wrapped what Pi already does: `coding.primary` SSOT slot duplicates `~/.pi/agent/models.json`; `CodingSpawnSpec` + `coding_resolve_spawn` Tauri command duplicate Pi's own `--provider` resolution; the inline "configured?" error page in `routes/coding.tsx` duplicates Pi's startup diagnostics. **Retractions**: (1) `Consumer::CodingPrimary` enum variant removed. (2) `coding.primary` row in Settings → Providers removed. (3) `IrisyRole` PWA type narrowed back to `'irisy.primary' | 'irisy.fallback'`. (4) `registry::route_chain` special case for CodingPrimary removed. (5) `commands::coding::coding_resolve_spawn` + `CodingSpawnSpec` struct + `CodingResolveArgs` struct removed; replaced by a 35-line `pi_binary_path` Tauri command that only resolves the bundled Pi binary path (PWA cannot expand `~`). (6) `routes/coding.tsx` reduced from 156 lines to 102 — direct `cs_spawn({command: piPath, args: [], env: {}})`, no error page (Pi prints its own startup diagnostics to the xterm). Same Pi binary as Irisy chat panel — chat = `pi --mode rpc` via ctrl-pi-bridge, coding tab = `pi` TUI; both read `~/.pi/agent/models.json` so Settings → Providers changes flow through automatically. No "role switching" concept needed.
  - v12 2026-06-07: **terminology unification — "keycap" retired, "mcp" is the system-wide name.** bao 2026-06-07 "要不都叫 mcp 吧 不然好像你不理解, 用户也不理解" / "那你全量改吧". Memory `decision_keycap_collapses_to_mcp_meta_ux_layer` (2026-06-05) extended from doc-level to symbols + filenames + workspace package names. Mechanical changes: 126 source files sed-replaced + 13 file renames + 7 follow-up filename renames + 2 workspace package renames (`@ctrl/keycap-sdk` → `@ctrl/mcp-sdk`, `packages/ctrl-keycaps/` → `packages/ctrl-mcps/`) + 8 ADRs sed-rewritten + CLAUDE.md "Keycap manifest model" section retitled. Memory slug filenames preserved (e.g. `decision_pi_is_sole_brain_hermes_is_keycap.md` — those are file paths, not concept names). `mcp` now denotes both the manifest model in ADR §7 composition v1 AND the runtime substrate in ADR-004 § execution v1; the two are the same thing under one vocabulary. Verified: cargo + tsc green; commit refactor c45907a.
  - v1 2026-05-31: module reorg — merged orig-003 (Pi brain) + orig-004 (capability surface) + orig-007 (crypto) + orig-012 (SubprocessActor + portable-pty) + orig-013 (kernel-as-MCP-server) + orig-024 (6-axis composition). **NEW** § provider — role routing (irisy.primary/fallback, mcp.default) + VMark-style PATH detect + introspection (brain_status). Closes the "Irisy doesn't know its own stack" gap (bao 2026-05-31).
  - v2 2026-05-31: § provider amendments (bao 3-校准 in implementation discussion):
      (1) drop `mcp.default` role — mcp binds provider via manifest `brain_capabilities`, not via substrate-wide default (2-role model: irisy.primary + irisy.fallback only).
      (2) `irisy.primary` MUST be a detected user CLI (`claude > codex > gemini > aider`); removed "else volc" auto-fallback — primary path is augmentation, CTRL doesn't silently spend money there.
      (3) `irisy.fallback` is the CTRL-managed slot (CTRL pays Volc Doubao bill, future = ctrl-brand provider). Volc now has two manifest ids: `volc` (CTRL fallback, ctrl-managed creds) and `volc-byok` (user-elected, user keychain). brain_status() exposes `managed_by: "user" | "ctrl"`. Brand label "CTRL Cloud" hides codename from Irisy responses + failover messages.
  - v3 2026-06-01: **NEW** §8 Vault — kernel primitive endpoints (21 commands) + explicit feature-layer boundary: Daily Note + Sourcing inbox are **feature-layer** (Irisy + frontend wire them via `vault/.ctrl/*.yaml` + `vault/templates/*.md`), kernel does not know about either concept. Retires frontend O(N) backlink scan + 3-pane VaultBrowser shell. §6 MCP tools list extended from 11 to 28 (kernel exposes vault.{backlinks,tags,notes_by_tag,mentions,orphans,broken_links,graph_data,rename,move,create_folder,set_starred,aliases,watch} on top of existing 8). Wiki-link Tiptap extension cherry-picked from seahop/kairo (MIT, Sean Hopkins 2026) — see `THIRD_PARTY_LICENSES/kairo-MIT.txt`. Decision lock + sourcing workflow design: `.olym/brainstorm/vault-md-management-2026-06-01.md`.
  - v4 2026-06-02: §8.6 shell integration amended — bao realignment "Vault is substrate, Notes is the L1 app". L1 chip relabelled **Notes** (id `notes`, path `/notes`); chip click uses `openSystemTab({kind:'route', path:'/notes'})` matching Pool/Coding. New `routes/notes.tsx` renders `<NotesApp />` (3-pane: NotesActions top bar + NotesTree left + NotesEditor center + NotesBacklinks right). Components live in `packages/ctrl-web/src/components/notes/*` as standalone files for future Irisy-app-system reuse. L2 column reservation kept but **no longer flipped for Notes** — the app composes inside a workspace tab body, not across the shell grid. §8.7 retirements extended: `L2VaultPanel.{tsx,module.css}` deleted, `BacklinksDrawer.{tsx,module.css}` deleted (backlinks live inside NotesApp right column), `routes/vault.tsx` deleted (replaced by `routes/notes.tsx`), Rust `expand_workspace_window_if_collapsed` command deleted. Editor lib forward-compat invariant: `@tiptap/*` + `@uiw/react-codemirror` + `mermaid` + `gray-matter` consumed as npm packages — thin React wrappers, no fork, no vendor.
  - v5 2026-06-03: **NEW §9 smart-table-output** + **NEW §10 embeddings**. §9 unifies mcp output capture as one SmartTable per mcp (markdown table file at `notes/mcp-runs/<mcp_id>.table.md`, schema in mcp manifest `output_capture`); supersedes "1-run-1-file sidecar markdown" idea from `.olym/brainstorm/openclaw-compat-2026-06-03.md` — Notion-style table beats sidecar markdown for browsability and inline edit. P4 product-decision (`.olym/brainstorm/vault-irisy-product-design-2026-06-03.md`) locks "default-on, settings-wide kill-switch, per-mcp manifest opt-out". §10 adds the embeddings substrate the product spec depends on (Layer 3 Connect + Layer 4 Synthesize): local Ollama default with transparent fallback prompt (per product P1), SQLite BLOB storage (no sqlite-vss dep — flat cosine is fine for vault-scale up to ~50K notes), 5 new vault.* MCP tools, hybrid `vault.search` mode. Eight new acceptance items; brainstorm: `.olym/brainstorm/vault-irisy-product-design-2026-06-03.md`.
  - v6 2026-06-04: **NEW §11 audit-ledger** — substrate primitive for self-evolution (ADR-001 §8) across the 6 loops. Reuses `kernel/persistence.rs` SQLite event store with a new event kind `system.self_evolution`; immutable rows record (loop_id, stage, typed_action, evidence, diagnosis, verify_result, autonomy_level). Queryable from Settings → 自我升级 → 最近事件 tab. Prune policy: 7 d high-resolution + 90 d day-level aggregate + month aggregate beyond (bao 2026-06-04 wave Q5). Per bao "整个系统都要自我升级成长 ... 沉, 唯一真相, 要经常整理 ADR".
  - v7 2026-06-04: **§1 brain amendment — §1.1 ctrl-pi-bridge full extension surface** — bridge v1 used only `pi.registerProvider`, leaving Pi with 0 native tools (real-world Pi told user "我没有 skill 系统"). v7 expands bridge to 4 surfaces: `registerProvider` (existing) + `registerTool` × ~10 native tools (BYOK frontier path) + `on('before_agent_start')` chain-injecting ADR-005 §6 capability segments + `on('tool_call')` inspector stub (5-identical-calls loop guard) + `on('resources_discover')` exposing `~/.claude/skills/` as native Pi Skills. ctrl-pi-plugin spawn arg changes `--no-tools` → `--no-builtin-tools` so extension-registered tools stay loaded but Pi's default 7 (read/write/edit/bash/grep/find/ls) are off (kernel substrate stays the gatekeeper for vault writes etc). Provider-aware dispatch in `commands/irisy_chat.rs`: BYOK frontier ⇒ native tools, non-frontier (Volc/Qwen/Llama) ⇒ existing PWA XML loop (Cline operates under same constraint). 0 transitive deps invariant preserved via inline TypeBox mock. Paired with ADR-005 v4 §7. Brainstorm: `.olym/brainstorm/irisy-pipeline-2026-06-04.md` v2.
  - v8 2026-06-06: **§1 + §3 system-level provider redesign — single SSOT, Pi single alias**. Earlier v8 draft (router `last_routed` mirror register + `brain_status.last_routed` field) RETRACTED as patch-style: it added a 4th routing state on top of 3 racing ones (active-providers.json / Pi spawn intent / setModel target / proposed last_routed). Root issue is the 3-state race itself. Locks: (1) **§3.5 SSOT** — `~/.ctrl/state/active-providers.json` is the ONLY truth for routed provider/model. Router reads it per `/text-chat` request (mtime-watched in-memory cache). No mirror state, no `last_routed`, no `brain_status.last_routed`. (2) **§1.2 Pi single alias** — Pi spawns ALWAYS with `--provider ctrl-bridge --model default`. `ctrl-pi-plugin` injects a synthetic `ctrl-bridge` provider into `~/.pi/agent/models.json` at spawn time (baseUrl points at kernel `/text-chat`, apiKey placeholder) so Pi's startup `--provider` validation passes before extensions load. Post-spawn `setModel(active, firstModel)` switch path RETIRED. `PI_PROVIDER` / `PI_MODEL` / `CTRL_TARGET_PROVIDER` env vars RETIRED. Pi has zero visibility into the real provider — it lives entirely in the router via SSOT read. (3) **§3.5 failover is transient override, not state mutation** — on primary call failure router routes the SAME request to fallback + emits Tauri event `provider:routing-override { active, reason, ts }`; on next successful primary call emits `provider:routing-restored`. `active-providers.json` is never written by failover (intent is not stolen). (4) **§3.7 chip + Irisy self-report** — PWA `ChatHeaderControls` + ctrl-pi-bridge `runtimeTruthBlock` read `invoke('get_active_providers')` + subscribe `provider:routing-override` / `active-providers-changed` Tauri events. `Pi.getState` is NEVER consulted for provider/model display. `process.env.PI_PROVIDER` is NEVER read. `brain_status` `last_routed` field RETIRED (added in v8 draft, removed in v8 final). Closes 3-state race that caused v0.1.170-173 chip patches + "Irisy 连真相都不知道" (bao 2026-06-06 "我只要系统, 正确的, 不要修修补补").
  - v11 2026-06-07: **NEW §3.11 — Coding L1 role + on-demand native Pi TUI (0.1.181).** bao 2026-06-07 "把 coding 的 L1 功能完全使用 PI 完成了 L1 都是点击打开和关闭侧工作区" + "Irisy 和 coding 需要使用不一样的 provider". Locks: (1) **`Consumer::CodingPrimary`** enum variant + `coding.primary` SSOT role (parallel to `irisy.primary` / `irisy.fallback`). `route_chain` returns no fallback for this role — Coding errors surface in xterm, never silently fall through to Volc. (2) **On-demand native Pi process** — Coding L1 chip click invokes `coding_resolve_spawn` (new Tauri command) which reads the SSOT binding + resolves the API key from `credential_vault` + returns a `CodingSpawnSpec { command, args, env, provider_id, model_id, provider_label }`. PWA hands the spec to existing `cs_spawn` and navigates to `/code-space/$envId` where xterm.js renders the live PTY stream. No persona override, no Irisy prompt, no wrapper — Pi runs its native coding-agent CLI exactly as the upstream ships it (7 builtin file tools + bash + skills + native function calling all live). Independent process from the kernel-managed Irisy daemon. (3) **L1 click-toggle UX** — Pool / Notes / Coding chip clicks now check whether the chip's tab is already open AND active; if so the chip closes the tab and calls new `collapse_workspace_window` Tauri command. Switching between chips with the workspace open just switches tabs (no collapse). Project-dir prompt removed from Coding chip — Pi's TUI owns cwd. (4) **Settings → Providers** adds the "Coding primary" row alongside the two Irisy rows; provider_set_active accepts the new role unchanged thanks to the `Custom(String)` fallback variant.
  - v10 2026-06-07: **§3 + §6 + NEW §12 — full Pi extension wiring ship (0.1.179).** Locks the 2026-06-07 batch that v9 left as cite-only refs: (1) **NEW §3.9 Switch provider UX** — `provider_set_active` reply carries `model_id` (first model from manifest); PWA `providerSetActive` calls Pi RPC `setModel(provider_id, model_id)` via dynamic import to swap Pi in-place (0 ms, no daemon respawn, session preserved). Formalises v9 changelog item (4). (2) **NEW §3.10 Provider template catalogue** — bundled `provider-templates.json` expanded 10 → 20 entries (added mistral / xai / perplexity / fireworks / azure-openai / vertex / bedrock / cloudflare / zhipu / qwen), each addressable via Settings → Providers add wizard. (3) **§6 amendment — kernel MCP server boot + Pi auto-connect**: `KernelSupervisor::start` now spawns `mcp_server::serve(runtime, None, MCP_SERVER_LISTEN_ADDR)` and publishes the per-boot bearer token via `CTRL_KERNEL_MCP_TOKEN` + `CTRL_KERNEL_MCP_PORT` env vars (Pi child inherits naturally, no `env_clear` in `spawn_brain`). `ctrl-pi-plugin::injectActiveProviderForSpawn` upserts a `ctrl-kernel` entry into `~/.pi/agent/settings.json` mcpServers with `transport: streamable-http` + `Authorization: Bearer <token>` header. Other mcpServer entries are left intact (user-editable). Pi auto-connects on next spawn — kernel's 28 vault.* + kv + llm + mcp.* tools become native Pi tools. (4) **NEW §12 Pi extension surface — full wiring** — see new section. (5) **`$VAR` apiKey prefix** — `models.json` apiKey written as `$<ENV_VAR_NAME>` (Pi's required explicit-env syntax; plain string is now treated as literal with deprecation warning). bao 2026-06-07 "全接" + "真相也要选择吗?" — Pi端点都开好的, 接 = 写 caller, 不是 wrap 工程; 已开的端点要在 ADR 上有 truth.
  - v9 2026-06-06: **§1 + §3 — RETRACT v8 entirely. CTRL wraps Pi via Pi's published extension surface only.** bao 2026-06-06 "我从头一直是让你基于 PI 开发" + memory `feedback_pi_is_core_use_upstream_surfaces` (locked 2026-05-31, IGNORED in v8): wrapper must DELEGATE to Pi-exported surfaces, never reimplement what Pi already does. v8 (Pi single alias + ctrl-bridge streamSimple interception + CTRL-side router fallback + chip reading SSOT mirror) was 4 simultaneous wrapper-side reimplementations of Pi-native facilities. Each `apiKey: ""` / "Unknown provider" / "Connection error." stderr in the v0.1.170-176 series traces to one of those reimplementations. **Retractions**: (1) **§1.2 Pi single alias** RETRACTED. Pi spawns with the user-selected real BYOK provider id (`--provider <ssot-primary-id> --model <ssot-primary-model>`); `ctrl-pi-plugin` writes `~/.pi/agent/models.json` (Pi's designed config file) at spawn time with one entry per user-configured provider, `apiKey` = env var name reference (Pi `ProviderConfig.apiKey` documented as "API key or environment variable name"); CTRL pulls credentials from keychain → injects child env. No plaintext on disk. (2) **§3.5 router fallback chain** RETRACTED. Pi has no public fallback API today; CTRL does not invent a parallel one. The `RouteChain.fallbacks` walking loop, `record_failover`, `RoutingOverride`, `provider:routing-override` / `provider:routing-restored` events, and `ctrl-bridge` `streamSimple` interception are all RETIRED. When Pi exposes a fallback surface (e.g. `setAutoFallback`), CTRL adopts it — until then primary failure surfaces as a Pi error and the user re-picks in Settings. (3) **§3.7 chip data source** — chip reads `pi_rpc('getState')` (Pi's rpc.md-documented authoritative API). With Pi bound to the real provider directly, `getState().model.{provider, id}` IS the truth (matches user intent because Pi was spawned/setModel'd to it). `get_active_providers` Tauri command kept as INTENT projection for Settings UI only; chip uses Pi truth. (4) **Switch provider UX** — `provider_set_active` triggers an in-process Pi RPC `setModel(newProvider, newModelId)` via `/api/pi-rpc` (Pi runtime API, 0 ms, NO daemon respawn, session preserved). New user-added providers register via ctrl-pi-bridge `session_start` so models.json + extension stay in sync. (5) **PWA XML loop** RETIRED. PWA `<call>` parser, `irisy-prompts.ts` XML protocol injection, `irisy-tool-dispatch` artifacts deleted; tool calls flow through Pi-native function calling (`Context.tools` schema → BYOK adapter → `pi.registerTool().execute()`). (6) **Wrapper invariant** locked at substrate level: any wrapper code that re-implements a Pi-published surface (provider registry, LLM call, stream protocol, session, fork, compact, model resolution) is DEAD on arrival. Reviewer checklist requires citing the Pi surface delegated to. bao 2026-06-06 "全部按照 PI 做 能做吗 — 我从头一直是让你基于 PI 开发".
related:
  - .olym/decisions/001-spine.md
  - .olym/decisions/004-cap.md
  - .olym/decisions/006-cross-cutting.md
---

## §1 Brain — 2 parallel paths: Irisy=Hermes (bundled) + BYO-CLI driver (projection) — v28

> ⚠️ **v28 (2026-06-18, bao 实查运行真相后钦定 — 此块 GOVERNING, 与下方 v27 正文冲突时以此为准. 真相源 `vault/ctrl/architecture-byo-cli-driver.md` 顶部纠正块).** v27 把 brain 写成「BYO-CLI driver 取代内置 brain, hermes 摒弃」——**就 brain 层写过头了**. 运行真相 = **2 条并行 brain 路, 都经 `:17873` gate**:
> 1. **Irisy (CTRL app 内助手) 的 brain = Hermes Agent** (NousResearch). CTRL **确实 bundle + lazy-install + 启动** hermes (dashboard `:17890`, Irisy 嵌入). **hermes 不退役.**
> 2. **BYO-CLI driver (§ projection) = 附加并行路径** (NOT 替代): 用户自带 CLI (Claude Code) 经投影的 `.mcp.json` 也能驱动 CTRL 工具 (已落地 `kernel/projector.rs` + 真机验证).
>
> **Pi 仍退役** (v19, 不变). opencode 未接线 (保留). ACP 仍降级为 future channel. Obsidian Local REST API MCP 已连 bus (16 工具, §1.9). 下方 v27/§1.0「hermes 摒弃 / 内置 brain 全退役」**就 brain 层 superseded**; § projection / § mcp-bus / Obsidian / plain-text 仍有效.

---

> **v27 (2026-06-17, bao 钦定 架构换代) — 就 brain 层 superseded-by-v28 (projection/gate 部分仍有效)**: the brain is NO LONGER a CTRL-installed / lazy-installed / supervised process. **hermes / opencode / Pi are all摒弃 as the brain.** The **driver = the user's own local CLI** (Claude Code today; any agentic CLI tomorrow). CTRL does NOT spawn or supervise the brain — the CLI owns its lifecycle, its model, its agent loop + scheduling. CTRL's job shrinks to: **install (provision) + projection (§ projection) + keychain + MCP-bus gate (§6)**. The §1.1-§1.9 content below (3-agent aggregator / ACP single door / hermes-as-assistant / Notes layers) is **superseded-by-v27 as the brain/integration model** and kept for provenance; the still-live parts (Notes data layer, MCP-bus, keychain) are re-homed under § projection + §6.

### §1.0 The driver = the user's local CLI (NEW v27)

CTRL is a **BYO-CLI driver platform**, not a brain vendor. The user brings their own agentic CLI (Claude Code is the day-1 target; Codex / Gemini CLI / opencode / any ACP-aware CLI are equally valid drivers). CTRL:

- **does not lazy-install a brain** — no `~/.ctrl/agents/<brain>/` npm install of hermes/opencode, no `~/.ctrl/pi/`. (Provisioning the *user's* chosen CLI when absent is allowed via the §7.2 provision pattern — orchestrating the user's package manager, same as the Obsidian app — but the CLI is still the user's, not a CTRL-bundled brain.)
- **does not supervise the brain** — no `*_supervisor.rs`, no health-watch, no restart. The CLI runs as the user runs any CLI; CTRL never owns its process lifecycle as a brain runtime.
- **does not wrap the brain's agent loop / model / scheduling** — the CLI's model decides what tool to call and when. CTRL only **projects** local assets into the CLI's native config so the CLI can *see* them (§ projection), and **gates the call-return** when the CLI invokes a projected tool (it returns to the kernel MCP bus :17873, §6).

This is the end-state of the consistent direction across v17→v19→v22→v23→v27: **less CTRL ownership of the brain, more the user's own tools.** v17 wrapped Pi tightly; v23 routed hermes over an ACP single door (still a CTRL-driven channel); v27 removes even that — the brain is the user's CLI, and CTRL meets it through projection into the CLI's own configuration surface (the least-interposition channel possible).

---

> **— BELOW: §1.1-§1.9 superseded-by-v27 as the brain/integration model (provenance). 3-agent aggregator (v19) framing. —**

CTRL kernel = **thin install + launch + bridge + keychain**, NOT a runtime owner of brains. 4 friend products (Claude Desktop / Codex / WorkBuddy / CodeBuddy) bundle a single-brand brain; CTRL is the **aggregator** layer.

### §1.1 The 3 agents (all external, all MIT/open source, all lazy-installed)

| Agent | Role | Upstream | Endpoint | PWA route |
|---|---|---|---|---|
| **hermes** | Assistant (long-term memory, skills, dialog) | `uvx --from 'hermes-agent[acp]==0.16.0'` (NousResearch, PyPI, MIT — npm "hermes-agent" is an unofficial 3rd-party shim, banned) | **ACP single door** (`hermes-acp`, see §1.8) — TUI-gateway / OpenAI-server NOT adopted; `hermes -z` one-shot retired as a routing path | `/assistant` |
| **opencode** | Coding (LSP, formatter, plan, subagents, native Skills) | `npm install opencode-ai@1.17.x` (anomalyco, MIT) | HTTP API: `serve --port <picked>`, `POST /session` + `prompt_async` + global `/event` SSE bus | `/coding` |
| **Notes / KB = Obsidian** (v24 — kairo/SilverBullet retired) | Notes / PKM editing + graph + plugins | the **user's own Obsidian** (CTRL bundles no editor — don't reinvent the wheel, bao 2026-06-17) over `~/Documents/CTRL/Notes/` (or their vault) | data on bus: kernel notes-MCP `:17873` (editor-independent) + OPTIONAL Obsidian Local-REST-API MCP for backlinks/tags/graph | `/notes` = inline md viewer + "open in Obsidian" |

**Cross-agent invariant**: each agent owns its own context + session storage. No CTRL-mediated context sharing — if user wants opencode to read a note, the route is `kairo file → ~/Documents/CTRL/Notes/ → CTRL mcp_server :17873 exposes notes.read → opencode invokes via MCP`. The agents talk **through CTRL's MCP server**, never through a private kernel API.

### §1.2 Install path (`~/.ctrl/agents/<name>/`)

```
~/.ctrl/agents/
  hermes/
    manifest.json        # { name, version, install_at, endpoint_type: "mcp-stdio", entry_cmd }
    node_modules/...     # npm install --prefix . hermes-agent
  opencode/
    manifest.json        # { endpoint_type: "http-port", entry_cmd, port_parse_regex }
    node_modules/...
  kairo/
    manifest.json        # { endpoint_type: "webview", workspace_path }
    bin/kairo            # native binary
```

`rm -rf ~/.ctrl/agents/` = full uninstall, no side effects.

### §1.3 Kernel modules (replace supervisor)

| Module | File | Role |
|---|---|---|
| **agent_installer** | `shell/agent_installer.rs` | probe node → `npm install --prefix ~/.ctrl/agents/<name> <pkg>` → write manifest. Idempotent. First-launch onboarding wizard triggers all 3 in parallel. |
| **agent_launcher** | `shell/agent_launcher.rs` | spawn child process from `manifest.entry_cmd`, parse endpoint (port from stdout / pipe handle / webview URL), return to PWA via `invoke('launch_agent', { name })`. No supervise. No restart. **PWA owns retry** on `launch_agent` invocation failure. |
| **agent_commands** | `commands/agents.rs` | Tauri commands: `install_agent` / `launch_agent` / `stop_agent` / `agent_status` / `list_agents`. |
| **unified keychain** | `shell/credential_vault.rs` (already exists, retained) | one BYOK key in keychain → injected as env var at agent launch (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / etc.). Agents do NOT write their own `auth.json` / `config.yaml` — CTRL injects via env. |

**No `*_supervisor.rs`**: kernel never observes brain health, never restarts. PWA's `useAgent(name)` hook catches launch errors → shows reconnect button.

### §1.4 What's RETIRED in v19

- ❌ `src-tauri/src/shell/brain_supervisor.rs`
- ❌ `src-tauri/src/shell/opencode_supervisor.rs`
- ❌ `src-tauri/src/shell/hermes_supervisor.rs`
- ❌ `src-tauri/src/shell/pi_install.rs`
- ❌ `src-tauri/src/commands/opencode_chat.rs`
- ❌ `src-tauri/src/commands/hermes_chat.rs`
- ❌ `src-tauri/src/commands/pi_rpc.rs`
- ❌ `src-tauri/src/bin/e2e_verification.rs`
- ❌ `packages/ctrl-pi-bridge/`
- ❌ `packages/ctrl-pi-plugin/`
- ❌ PWA `/coding` `<IrisyChat forceMode="coding" />` legacy wrapper
- ❌ "Pi single alias" `ctrl-bridge` provider, models.json `$VAR` injection, `setModel` switch UX (§3.9 v10), kernel-MCP Pi auto-connect (§6.1 v10) — Pi exits CTRL's hot path entirely. Pi remains usable as a standalone CLI installed by the user via npm; CTRL doesn't install it, doesn't wrap it, doesn't compose with it.
- ❌ `~/.local/share/opencode/auth.json` + `~/.hermes/config.yaml` writing (replaced by env-var injection)
- ❌ `irisy.primary` / `irisy.fallback` / `coding.primary` consumer roles (Irisy is no longer a brain — it's PWA persona)
- ❌ §8 Vault stack lock (Tiptap+CodeMirror+FTS5) — kairo owns editor (§8 v6 amend)
- ❌ ADR-008 + ADR-009 (Pi-surface integration ADRs — Pi exited core)

### §1.5 Irisy reframe (was sole brain v17, dual-brain peer v18, now persona shell v19)

**Irisy = PWA persona layer only** (chat avatar + anti-sycophancy filter + system-prompt injection). Not a runtime, not a brain, not a process. When user "talks to Irisy", the message routes to whichever of the 3 agents matches the active L1 chip (default `/assistant` → hermes). Irisy's job:

1. Inject CTRL substrate context (Notes folder via MCP, active provider info, OS context) into agent prompt
2. Render agent stream output through the PWA chat UI (Tiptap render + mermaid + code highlight)
3. Run sycophancy/apology filter on agent output (markdown patterns in `packages/ctrl-web/src/lib/persona-filter/patterns.md` — relocated from `packages/ctrl-pi-bridge/data/persona-patterns.md`)
4. Provide drill-down (long-press → see raw agent output before filter)

ADR-005 § persona amended in parallel (v3 → v4).

### §1.6 Code review fixes from H-2026-06-09-001 — historical only

The 8 fixes from v18 (race condition / health check / credential / event leak / etc.) are kept in changelog for provenance but no longer apply because the supervisors they belonged to are deleted in v19.

### §1.7 Why this isn't "yet another pivot"

v17 (Pi sole brain) → v18 (dual-brain supervisor) → v19 (3-agent aggregator) trace one consistent direction: **less CTRL ownership of the brain, more external integration**. v17 wrapped Pi tightly; v18 added 2 supervisors (worse, not better — same wrap pattern, doubled); v19 removes all wrap. This is the **right** end-state per bao memories `feedback_pi_is_core_use_upstream_surfaces` (2026-05-31), `feedback_no_redundancy_one_ssot` (2026-05-28), `feedback_build_system_not_business` (2026-05-28), and `decision_ctrl_lean_substrate_scheduler_executor_tools` (2026-05-28). Kernel does what only a kernel can do (install + launch + keychain + MCP bus); everything else is external.

### §1.8 ACP — enhancement channel for ACP-aware CLIs (DEMOTED to FUTURE in v27; was "single door" v23)

> **v27 (2026-06-17) DEMOTION**: ACP is **no longer THE channel** — the main integration path is **§ projection** (materialize assets into the CLI's native config). ACP is reclassified as a **future enhancement channel** for drivers that happen to be ACP-aware (a structured-events upgrade *on top of* projection — streaming tool/permission events for §8 transparency + §4 gate — when the user's CLI speaks ACP). **The ACP client + `hermes-acp-probe` code is NOT deleted; it is future work, gated behind a user CLI that exposes ACP.** A plain Claude-Code-style CLI driver is reached entirely via projection, not ACP. The §1.8.1-§1.8.5 body below (hermes-over-ACP single door) is retained as the future-channel spec + provenance; "hermes" is now just one possible ACP-aware driver, not the brain.
>
> _Original v23 banner (provenance):_ Converged after a zeus-led drill (2026-06-16/17, bao Q&A). Supersedes the v20 "ACP stdio; interim `hermes -z` one-shot" note: ACP is THE channel; the one-shot path is retired as a routing path (`irisy_chat.rs` `HERMES_FIRST` dead branch removed). Decides how a `target:brain` agent (hermes today, any ACP agent tomorrow — v22 feature-pack model) plugs into CTRL.

#### §1.8.1 Single door = ACP

A `target:brain` agent connects over the **Agent Client Protocol** (ACP — Apache-2.0, Zed; JSON-RPC 2.0 over stdio). hermes runs in ACP server mode: `uvx --from 'hermes-agent[acp]==<pin>' hermes-acp`. CTRL is the ACP **client** (the role Zed / JetBrains AI Assistant / Neovim CodeCompanion play). ACP carries: prompt submit · streaming agent message chunks · tool-call events · permission requests · session fork/cancel/auth.

- **TUI-gateway NOT adopted** — hermes's internal JSON-RPC gateway exposes a fuller method set (`command.dispatch` / `session.steer` / `clarify`) but is a **hermes-private** interface → highest upgrade-breakage risk, and its only real edge (driving hermes's internal skills/commands) is exactly what CTRL rejects (skills are CTRL-side SSOT, §1.8.2). TUI is for hosts WITHOUT their own substrate; CTRL HAS one (bus + skills + notes folder).
- **OpenAI-compatible server NOT adopted as the hermes door** — redundant with ACP, which gives more (structured tool/permission events for the §8 transparency + §4 gate).
- **Degraded path is NOT a second hermes door** — when hermes is absent/down, Irisy falls back to the in-process provider router → user BYOK model direct (`irisy_chat.rs` `route_text_chat`, already shipped). Irisy stays usable with zero agent installed (matches v22: provider-router = default, hermes-over-ACP = the optional assistant-brain upgrade).

#### §1.8.2 The 3 capability faces reach the agent via ACP MCP passthrough — never the agent's own

ACP standard behavior: at session start the client passes its MCP server endpoints + credentials to the agent; the agent invokes tools via MCP, **piped back through the ACP session** (Zed forwards its configured MCP servers to external agents exactly this way). CTRL uses this so the agent consumes CTRL's faces — keeping one SSOT, the kernel gate, AND tool-call visibility in one mechanism:

| Face | Wire to agent | SSOT |
|---|---|---|
| **MCP** | CTRL passes bus `:17873` to the agent at ACP session start; all tool calls pipe back over ACP (visible + gatable) | `mcp_server.rs :17873` (out: `mcp_host.rs` → 10k+ external MCP) |
| **API** (fal.ai 985 / LLM) | exposed AS MCP tools on the bus (`image.generate` / `video.generate` / `text.chat`) → same passthrough; the agent's reasoning model may also point at CTRL's provider router | `provider/router.rs` |
| **Skills** | `~/.ctrl/skills/<id>/SKILL.md` surfaced as MCP tools on the bus OR the agent's skill loader pointed at this dir | `~/.ctrl/skills/` (cross-agent; agent-created skills land here → Discover commons) |

**Hard constraints** (reviewer-enforced):
1. The agent's MCP client points **only** at `:17873` — never directly at an external MCP server (else it bypasses the kernel capability / approval / blast-radius gate, ADR-006 §4/§5).
2. The provider router MUST be exposed as MCP tools on the bus (else the agent can't reach the fal.ai API face).
3. The agent's skills dir = `~/.ctrl/skills` — one SSOT, no parallel agent-private skills store.
4. "apps" (Feishu / Notion / OAuth / OPC business connectors / ST-SS windows) are MCP **sources** (ADR-001 §3), not a 4th face — they enter through the MCP face.

#### §1.8.3 Knowledge base is NOT the brain channel

User KB = **Obsidian** (the user's own PKM, over `~/Documents/CTRL/Notes/` or their vault — CTRL bundles no editor; kairo/SilverBullet retired v24, don't reinvent the wheel) + the CTRL Notes folder. The agent reads/writes user notes via the **Notes MCP tools on the bus** (`:17873`, editor-independent), surfaced as ACP tool-call events — not over a private channel, and NOT dependent on Obsidian running (filesystem-backed; an optional Obsidian Local-REST-API MCP adds backlinks/tags/graph when present). hermes's own long-term memory / RAG stays hermes-internal and flows over ACP as part of the conversation. **ACP delivers the assistant (+ hermes-internal RAG); the user KB is Obsidian (editor) + Notes-MCP (data, on the bus).**

#### §1.8.4 Upgrade规范 — ride agent releases by standard contract

ACP is a versioned external standard, so most agent releases don't touch the contract → bump freely. Per-release discipline:

1. **Single pin SSOT** — agent version lives in one constant (`agent_installer.rs` `HERMES_*_SPEC`). Upgrade = change one value; git-diffable; revert = flip back.
2. **Version lockfile** — record `{agent version, ACP protocol version, verified date}` (mirrors ADR-005 §4.6 `.soul-md-version`).
3. **Contract probe** — `scripts/probes/hermes-acp-probe.mjs` (mirrors ADR-005 §7.7 `pi-bridge-probe`): ACP handshake + proto-version + streamed prompt + tool-call event + permission request + **MCP-bus passthrough** + `/model` swap + skills-dir read. All green → bump. Red → stay pinned, log the broken surface in `.olym/decisions/DRIFT.md` as an upgrade-blocker.
4. **L3 gate** — a brain swap is high-blast-radius → default autonomy L3 suggest-only (ADR-006 §4): probe runs auto, pin bump is user-approved (patch-level + N consecutive green probes may earn L4). Rollout tier under ADR-004 §updater (external-agent tier).

#### §1.8.5 Provenance — ACP is real + adopted

Zed Industries (2025-08, Apache-2.0, JSON-RPC over stdio); JetBrains official partnership (2025-10, native ACP in IntelliJ/PyCharm AI Assistant); Gemini CLI = reference impl; Zed ACP Registry live. **Clients** (CTRL's role): Zed · JetBrains · Neovim (CodeCompanion / avante / agentic.nvim) · Emacs · Kiro. **Agents** (CTRL aggregates via the one client): hermes · opencode · Claude Code · Codex · Gemini CLI · Copilot CLI · Goose · Cline · Cursor · OpenHands · … — so the ACP client doubles as CTRL's universal agent-aggregation surface (ADR-006 §5 通用化). Sources: zed.dev/acp · zed.dev/docs/ai/external-agents · jetbrains.com/acp · agentclientprotocol.com · github.com/NousResearch/hermes-agent#569.

### §1.9 Notes architecture — post-Obsidian (NEW v25, 2026-06-17)

> **⚠️ v46 (2026-07-02) SUPERSEDES the Obsidian posture below**: NotesApp = FULL native PKM replacement (v26's "stop adding PKM parity" reversed); §1.9.1 connector + provision RETIRED (code deleted); Obsidian = format-compatible neighbor, zero wiring. Native note endpoints (Obsidian-LRA-referenced, CTRL idiom) replace the connector's capabilities. Governing: `vault/ctrl/notes-module-replacement-plan.md`. The five-layer table + §1.9.1 below are kept as provenance.

Consolidates the v24 "use Obsidian, don't reinvent the wheel" decision into one picture. **5 layers**:

| # | Layer | What | Owner | Change |
|---|---|---|---|---|
| 1 | **Data (truth)** | `~/Documents/CTRL/Notes/` plain-md + frontmatter | local FS | none (local-is-truth) |
| 2 | **Agent data access** | kernel notes-MCP `:17873` (`vault.read/write/search/backlinks/tags/...` 13+ tools) | CTRL kernel | **none — editor-independent**; hermes/opencode reach notes here regardless of editor |
| 3 | **In-CTRL notes UI (PRIMARY)** | render / read / edit / wikilinks / backlinks / tags / graph — the notes surface the user lives in, **inside CTRL** (single entry) | CTRL (`NotesApp` + kernel vault index: backlinks/tags/graph_data/FTS5) | **already built** — keep as the primary surface |
| 4 | **User's Obsidian (compat + escape)** | the user's own Obsidian app over the SAME vault — full plugin ecosystem / graph / sync | user's Obsidian | compat target + rare manual escape; **NOT embedded, NOT the default UI** |
| 5 | **Optional Obsidian connector** | Obsidian Local-REST-API plugin's built-in MCP server → /active/, plugin commands, Dataview search, periodic notes for Irisy | user opt-in (Obsidian running + plugin) | NEW — register on the bus (apps-as-MCP-source); spec §1.9.1 |

**Research-forced framing (zeus, 2026-06-17 — "调研别猜")**: three findings reverse the v24/v25 "Obsidian = the editor" framing:
1. **Obsidian is NOT embeddable** — Electron, no web/headless build; you can embed web INTO Obsidian (Custom Frames) but never Obsidian INTO CTRL. So "stay in CTRL" (bao 2026-06-17 "不要跳出 ctrl 不然产品就破裂了") FORCES CTRL to render notes itself.
2. **Obsidian Local REST API = data only** — CRUD / patch / search / metadata; NO rendering / backlinks / graph endpoints. Even its API can't supply CTRL a rendering or graph engine.
3. **Embeddable Obsidian-compatible web tools = read-only publishers** (Perlite / Quartz), not editors.

→ **CTRL renders notes itself (layer 3 PRIMARY); Obsidian is a compat target + optional connector, never the UI.** This is NOT reinventing the wheel: the wheel removed was SilverBullet (a 2nd bundled editor); CTRL's `NotesApp` + kernel vault index already exist and are the load-bearing single-entry surface — keeping them is mandatory for "don't jump out". What CTRL does NOT do: chase Obsidian's plugin-ecosystem / sync parity — for that the user opens their own Obsidian on the same files, or Irisy drives it via the §1.9.1 connector.

**Scope decision RESOLVED** (was "slim NotesApp vs keep"): **KEEP** NotesApp as the primary in-CTRL notes UI (research-forced — single entry requires it). Stop ADDING PKM features; do not rip out the existing panels. mobile (thin client, ADR-006 §5) also needs this CTRL-side UI since it can't run desktop Obsidian.

**Implementation plan** (phased, verify each):
1. ~~Retire SilverBullet bundle~~ — **DONE** 2026-06-17 (`AgentName::Kairo` + `install_via_binary` + launcher webview + supervisor prefetch + `list_agents` removed; cargo + tsc + acp_smoke green).
2. **Obsidian connector (§1.9.1)** — register the Obsidian Local-REST-API plugin's built-in MCP server as an MCP source on the bus when present; Irisy gains /active/, plugin commands, Dataview search, periodic notes over the user's REAL vault. Write-ops gated (ADR-006 §4).
3. **No default jump-out** — `/open/{path}` (controlled handoff to Obsidian UI) only on explicit user action, never the default path. CTRL stays the surface.

### §1.9.1 Obsidian Local-REST-API connector — endpoints → Irisy capabilities (NEW v26)

The Obsidian **Local REST API** plugin (coddingtonbear, HTTPS :27124, bearer token) **ships its own MCP server** (`/mcp/`), so CTRL wires it with ~zero adapter code: register that MCP endpoint as a source on the bus :17873 (apps-as-MCP-source, ADR-001 §3); hermes/Irisy reach the tools via the §1.8.2 ACP MCP passthrough.

| Endpoint | Irisy capability | Kind |
|---|---|---|
| `GET /vault/{path}` · `GET /vault/{dir}/` | read a note / browse the vault | read |
| `POST /search/` (JsonLogic / Dataview) + simple full-text | query/recall over the user's REAL Obsidian vault → feeds Irisy RAG | read ★ |
| `GET /periodic/{period}/` (daily/weekly/monthly/quarterly/yearly) | "add to today's daily note" / "what did I write this week" | read/write |
| `PUT /vault/{path}` | create / overwrite a note | write* |
| `POST /vault/{path}` | append to a note | write* |
| `PATCH /vault/{path}` | surgical insert by heading / block / frontmatter key | write* |
| `DELETE /vault/{path}` | delete a note | write* |
| `GET/POST/PATCH/DELETE /active/` | operate on the note CURRENTLY OPEN in Obsidian (summarize / rewrite / append to what the user is viewing) | write* ★ |
| `GET /commands/` + `POST /commands/{id}/` | list + execute ANY Obsidian command **including community-plugin commands** (Templater / Dataview / QuickAdd…) — Irisy drives the user's whole plugin ecosystem, CTRL rebuilds none of it | command ★★ |
| `POST /open/{path}` | open a note in Obsidian's UI (controlled, explicit handoff — NOT the default) | ui |
| `GET/POST /mcp/` | the plugin's built-in MCP server — the wire CTRL registers on the bus | wiring ★ |

\* write / delete / command tools are high blast-radius → gated through the ADR-006 §4 autonomy ladder (intent → review → approve → execute); never silent.

**Two-tier access** (Irisy notes reach):
- **Baseline (always)** — kernel notes-MCP `:17873` over `~/Documents/CTRL/Notes/` plain-md (layer 2). Works with Obsidian closed / not installed.
- **Enriched (Obsidian running + plugin)** — the §1.9.1 connector adds `/active/`, plugin commands, Dataview/JsonLogic search, periodic-note resolution. Degrades cleanly to baseline when Obsidian is absent.

**Precondition / honesty**: the connector requires the user to run Obsidian with the Local REST API plugin installed + token configured. It is opt-in (layer 5), not the default; CTRL onboarding surfaces it for users who already live in Obsidian.

**Auto-init (like hermes, bao 2026-06-17 "装 CTRL 时就初始化安装")**: research corrected the earlier "Obsidian can't auto-install" claim — the app installs silently via the user's package manager (macOS `brew install --cask obsidian` / Windows `winget install Obsidian.Obsidian` / Linux flatpak — orchestrating their PM, NOT bundling/redistributing the proprietary app, license-clean; reuses the ADR-002 §7.2 provision pattern). The MIT Local-REST-API plugin is pure files → CTRL provisions it zero-touch. `obsidian_provision` (run at kernel boot, best-effort, idempotent): **silently install the app if absent** (bao 2026-06-17 "不是一直要静默安装么" — runs `brew`/`winget`/`flatpak` directly, like hermes; not just reporting the command) → download the plugin (`releases/latest/download/{manifest.json,main.js,styles.css}`) into `~/Documents/CTRL/Notes/.obsidian/plugins/` → enable in `community-plugins.json` (merge) → register the vault in the global `obsidian.json` (merge, **preserves the user's other vaults**). The plugin generates its own token + cert when the user first opens Obsidian; CTRL reads it via `obsidian_status` / `obsidian_connect`. **Caveat (the one thing ≠ hermes)**: no official plugin-serving headless mode (official "Obsidian Headless" is Sync-only) — the REST API needs the Obsidian GUI app running (can be backgrounded; Linux can xvfb-hide).

**Implementation status (2026-06-17)**: SHIPPED behind cargo+tsc green — `commands/obsidian.rs` (`obsidian_status` + `obsidian_connect` + `obsidian_provision`) + NEW HTTP MCP **client** transport in `mcp_host::connect()` (the deferred P4 — `McpServerSource::Http { url, auth_header }` via rmcp `StreamableHttpClientTransport`, self-signed cert accepted for loopback) + boot auto-provision in `kernel_supervisor`. Cost: a 2nd reqwest (0.13, `rmcp-reqwest` alias) to match rmcp's `StreamableHttpClient` impl type — adds binary size (revisit by unifying CTRL on reqwest 0.13). **Verified live**: `provision_plugin` ran on a real machine — plugin files downloaded, `community-plugins.json` enabled, `obsidian.json` vault merged with the user's existing vaults preserved (`obsidian_provision_real` test). **NOT yet verified**: the MCP round-trip (`obsidian_connect`) — needs Obsidian open with the plugin loaded; the streamable-HTTP-vs-older-SSE shape of the plugin's `/mcp/` to confirm (DRIFT D7).

## §1B Projection — materialize local assets into the driver CLI's native config (NEW v27, core)

> **bao 钦定 2026-06-17** (架构换代). This is the **core mechanism** of the BYO-CLI driver platform. The brain is the user's own CLI (§1.0); CTRL接入 it NOT by spawning/wrapping/ACP-driving it, but by **projecting** CTRL's local assets into the configuration surfaces the CLI already reads on its own. The CLI then discovers them natively — zero CTRL interposition in the agent loop. This is the least-interposition channel: CTRL writes files the CLI was going to read anyway.

### §1B.1 Asset → injection-point mapping

CTRL owns local assets (tools, skills, memory, user-triggered workflows). Each asset type projects to the corresponding **native config surface** of the target CLI (Claude Code shown; other CLIs map to their equivalents):

| CTRL asset | Projected as | Injection point (Claude Code) | Owner SSOT |
|---|---|---|---|
| **Tool** (capability / MCP / API-as-MCP) | **MCP server** on the bus `:17873` | **corrected v27.1 (verified, not guessed)**: written into a **project-scoped `.mcp.json`** in the CTRL workspace dir (`~/Documents/CTRL/.mcp.json`) — **Claude Code does NOT read `~/.claude/.mcp.json`**; user-scope passive path = `claude mcp add --scope user`. The CLI connects to :17873 and sees CTRL's tools as its own MCP tools | **LANDED**: `kernel/projector.rs` (`project_kernel_gate`, wired at boot in `kernel_supervisor.rs`, 5 unit tests) + gate `kernel/mcp_server.rs :17873` (§6) |
| **Skill** | **`SKILL.md`** materialized into the CLI's skills dir | `~/.claude/skills/<id>/SKILL.md` (+ optional script sibling) — the CLI's native skill loader finds it | `~/.ctrl/skills/<id>/SKILL.md` (§13 Skills face) |
| **Memory** (vault notes / decisions / context) | **derived `CLAUDE.md` / `AGENTS.md`** | the CLI's project/global memory file the agent auto-reads at session start — keeps the agent grounded in the user's accumulated context without explicit recall | derived from `~/Documents/CTRL/Notes/` + decisions (§1.9 Notes data layer) |
| **User-triggered workflow** | **slash command** | `.claude/commands/<name>.md` (project) / `~/.claude/commands/` (global) — user types `/<name>` in the CLI to fire a CTRL-authored workflow | feature-pack workflow defs (§7 composition) |

**"apps" (Feishu / Notion / OAuth / OPC connectors / ST-SS windows)** are MCP **sources** (ADR-001 §3) → they project through the Tool→MCP row (they enter the CLI as MCP tools on :17873), not as a 5th asset type.

### §1B.2 `target:` override + default auto-routing

- **Default**: each asset auto-routes by type per the §1B.1 table — a tool projects as MCP, a skill as SKILL.md, etc. No manifest field needed for the common case.
- **Optional `target:` override** (manifest field): a feature-pack / asset MAY pin a different projection (e.g. force a tool to project as a slash command instead of a raw MCP tool, or scope a skill to project only into a specific CLI's dir). Absent `target:` ⇒ default auto-routing. This keeps the simple case zero-config while allowing advanced packs to control their projection shape.

### §1B.3 One projection, two triggers (passive substrate + active spawn)

The SAME projection (the same materialized MCP config / SKILL.md / CLAUDE.md / slash commands) serves both entry paths — CTRL never maintains two divergent copies:

- **Passive projection (the substrate, zero侵入)** — CTRL materializes the projection into the CLI's native config dirs **proactively**. The user runs their own CLI however they like (their terminal, their editor, their workflow) and the CTRL assets are simply *there* — auto-discovered by the CLI on next launch. CTRL did not start the CLI, does not know it ran, takes no interposition. This is the default底座: install CTRL → your existing Claude Code instantly has CTRL's tools/skills/memory/commands.
- **Active spawn (the enhancement)** — CTRL launches the CLI itself inside an **ephemeral workspace** (the Ctrl-key surface), reading the SAME projection. Used when the user drives a task through CTRL's UI rather than their own terminal. Same files, same discovery — active spawn is just "CTRL also presses enter for you", not a different integration.

### §1B.4 Scheduling stays with the CLI; CTRL = visibility + call-return gate

- **The CLI's model owns scheduling** — which projected tool to call, in what order, when to call a skill, whether to read CLAUDE.md. CTRL does NOT orchestrate the agent loop, does NOT decide tool order, does NOT wrap reasoning. (This is the §1.0 no-wrap invariant.)
- **CTRL only does two things**: (1) **make the CLI see** the assets (the §1B.1 projection); (2) **gate the call-return** — when the CLI invokes a projected tool, the call returns to the kernel MCP bus `:17873`, which is the capability / approval / blast-radius gate (ADR-006 §4/§5). Projected MCP tools point **only** at :17873 (never directly at an external MCP server), so every projected-tool call passes the kernel gate + is visible (§8 transparency). The bus is therefore both the tool host (§6) AND the projection call-return gate.

### §1B.5 Intent-scoped projection (don't全量灌爆 context)

Projection is **intent-scoped, not全量**. CTRL projects a **subset** of assets relevant to the current intent rather than dumping the entire asset library into the CLI's config (which would blow the agent's context window + drown discovery). v1: scope by the active intent / workspace / feature-pack set — only the matching tools/skills/memory/commands are materialized into the CLI's native config for that session. (Mechanism reuses the intent → 1-3 module convergence already in the workbench layer.)

### §1B.6 Shared network (share & be shared) — v1.1 future, interface reserved

The projection format (MCP config entries / SKILL.md / derived CLAUDE.md / slash-command markdown) is the same artifact a user can **share** and another can **receive** — 造的 = 别人挑的源头 (the share-and-be-shared positioning). v1 ships single-user projection only; the **shared-network projection** (peer-discovered / community-published assets projected into a user's CLI) is **v1.1 future**. The architecture **reserves the interface**: projection is asset-source-agnostic, so a future shared/remote asset source plugs into the same §1B.1 mapping without a re-architecture (mesh substrate §4 + feature-pack discover §7.3 are the v1.1 hooks).

### §1B.8 Per-pack scoped projection — a feature pack is a project-scope (v44, bao 2026-07-01)

The base workspace projection (§1B.1) grants the global default intent over ONE root (`~/Documents/CTRL/`). But §7.5 makes a **feature pack the product-grade unit = CTRL's answer to "project"** — so a pack should also be a **projection scope**: a driver launched in a pack's context should see exactly that pack's capability + context, not the whole workbench. §1B.8 realizes it (studying Atoms/Lovable, both organize the driver's world by *project* — CTRL's project = the pack).

**Mechanism** (`projector::project_pack`): materialize a **pack-scoped** `.mcp.json` + `AGENTS.md` into `~/Documents/CTRL/<pack_id>/` —
- `.mcp.json` stamps the pack's **OWN** intent domain (a §14 data pack → the `source` domain), **not** the global default. Elegant consequence: a pack grants exactly its own domain **without widening the base workspace** (e.g. `source` is deliberately absent from the global BYO default; per-pack scope is how a connector reaches a driver, contained).
- `AGENTS.md` carries the pack's context block (`pack_agents_block`): the pack name, its dedicated KB subpath (`knowledge_base`), and that the gate here is scoped to this pack — so the driver knows what it is working in.
- Reuses the base machinery unchanged (`project_gate_into_dir` with an explicit intent; `project_agents_block` with the pack block; same atomic-write + marker-preserve + upsert-idempotent guarantees).

**Trigger (v1)**: at boot, `project_installed_packs` auto-projects a scope for every installed pack that declares a §14 `record_source` (the product-grade data packs), scoped to `source` + its KB. Action-only packs still get the base workspace (their scope derivation is fuzzier — deferred). Manifest-scan is best-effort; an unreadable manifest is skipped.

**Not a new primitive**: this uses the existing intent/visibility machinery (ADR-010) as the scope namespace — conceptually the **Channel** primitive (ADR-001 §5) as a per-pack projection scope, with **no change to the 5 primitives**. It does NOT pull in the §1B.6 mesh-projection network (still v1.1); this is single-user, local, per-pack scoping only.

### §1B.7 What this RETIRES as the integration model (kept as provenance)

- CTRL lazy-installing/supervising a brain (hermes / opencode / Pi) — the brain is the user's CLI (§1.0).
- ACP as **the** channel (§1.8 v23) — demoted to a future enhancement channel for ACP-aware CLIs.
- provider-router-as-default-brain (§3.5 v22) — the provider router survives as the **API/LLM face** (§13) and as an MCP-projected tool, but it is not "the brain"; the brain is the CLI.
- "Irisy is a brain" — Irisy stays a PWA persona/surface (§1.5); the brain is the CLI behind projection.

## §2 Capability surface — 10 namespaces / 28 methods (frequency ≥3 rule + category exception)

Methods enter the kernel surface iff consumed by ≥3 mcps across the v1 corpus, **OR** they are `mcp.*` / `platform.notify` (infrastructure), **OR** they belong to a brain-capability category (text / image / audio / embed) — category exception so multi-modal brain ships coherently (§7 amends frequency ≥3).

| # | Namespace | v1 methods |
|---|---|---|
| 1 | `clipboard` | `read`, `write` |
| 2 | `text` | `chat`, `transform`, `template`, `embed` |
| 3 | `image` | `generate`, `edit`, `understand` |
| 4 | `audio` | `stt`, `tts` (defer until 2nd consumer) |
| 5 | `network` | `http` (allowlist-bound), `open_url` |
| 6 | `keyring` | `read`, `write` |
| 7 | `screen` | `capture` |
| 8 | `file` | `read`, `write` |
| 9 | `mcp` | `spawn`, `invoke_tool`, `list_tools`, `notifications` |
| 10 | `platform` | `notify`, `hotkey`, `window_list`, `window_focus`, `os_filter` |

v1.1 promotion candidates (mcp-local until 2nd consumer): `process.spawn`, `network.local_rpc`, `oauth.broker`, `stss.{publish,subscribe}`.

**Implementation**: `src-tauri/src/kernel/capability.rs` + `commands/mod.rs` registry. Hand-written Rust + `packages/ctrl-kernel-sdk` TS type-gen.

## §3 Provider router — role-aware routing + PATH detect + introspection (NEW v1)

**Why this section exists**: bao 2026-05-31 — "Irisy 不知道自己接的是什么 — 你在修补还是设计系统?". Earlier scattered `brain_config.rs` / `llm_port.rs` / `llm_adapters/*` retired; single sub-system below.

### §3.1 Module location

`src-tauri/src/kernel/provider/` — replaces `brain_config.rs` + `llm_port.rs` + `llm_adapters/*` + `commands/brain.rs` (all retired).

### §3.2 Trait + adapters (3 shared + 1 bespoke)

```rust
#[async_trait]
pub trait Provider: Send + Sync {
    async fn chat_stream(&self, ctx: ChatContext, opts: ChatOpts) -> Result<ChatStream>;
    async fn trial_verify(&self) -> Result<()>;
    fn capabilities(&self) -> &[Capability];
    fn descriptor(&self) -> &ProviderDescriptor;
}
```

Adapters:
- `cli/one_shot.rs` (codex / gemini, manifest-driven, ~200 LOC)
- `cli/claude_persistent.rs` (Goose-style `OnceCell<Mutex<CliProcess>>` + NDJSON, ~600 LOC — bespoke because `claude` doesn't fit generic spawner)
- `rest/http_api.rs` (openai-shape, manifest-driven, ~400 LOC)
- `rest/{anthropic,openai,google,ollama}.rs` (4 thin wrappers — ported verbatim from VMark `ai_provider/rest_providers.rs`, ISC)

### §3.3 PATH resolution (ports VMark `login_shell_path` + `augmented_path`)

Tauri inherits sparse PATH `/usr/bin:/bin:/usr/sbin:/sbin`. CLI providers live at `/opt/homebrew/bin/`, `/usr/local/bin/`, `~/.npm-global/bin/`, `~/.local/bin/`, `~/.cargo/bin/`. `resolve_binary_path()` scans these; `augmented_path()` prepends to child PATH so spawned CLI can find its own `node` shim.

Same trap fixed in 3 spawn sites (`claude_persistent.rs`, `brain_supervisor.rs`, `pi_install.rs`). New providers MUST use the shared resolver.

### §3.4 Manifest schema (TOML, drop-in extensible)

```toml
id = "claude-oauth"
label = "Claude (OAuth subscription)"
kind = "cli_claude_persistent"   # cli_one_shot | cli_claude_persistent | rest_openai | rest_anthropic
binary = "claude"                # CLI only
endpoint = "https://api..."      # REST only
auth = "none"                    # none | keychain:<key> | env:<var> | config:<key>
env_strip = ["ANTHROPIC_API_KEY"]
models = ["sonnet", "opus", "haiku"]
capabilities = ["text.chat"]
```

6 builtin presets ship Day-1: `claude-oauth`, `anthropic-api`, `openai-api`, `volc`, `kimi`, `deepseek`. User additions go to `~/.ctrl/providers/<id>.toml`. CN Anthropic-shape endpoints (api.moonshot.cn/anthropic, api.deepseek.com/anthropic) supported via preset.

### §3.5 Role routing — consumer-aware (NEW, replaces single `text.chat` bucket) — v2 2-role model (PARTIALLY RETRACTED in v9)

> **PARTIAL RETRACT v9 2026-06-06** — see changelog. The `RouteChain.fallbacks` walking loop, `record_failover`, `RoutingOverride`, `provider:routing-override` / `provider:routing-restored` events, and `ctrl-bridge` `streamSimple` interception are ALL RETIRED. Pi has no public fallback surface; CTRL does not invent a parallel one. SSOT (`active-providers.json`) is now used to **prepare Pi's models.json + child env at spawn time** (so Pi sees the real provider directly), not to mediate per-request routing inside CTRL. Section body below preserved for history; v9 implementation reads SSOT only at spawn / `setModel` switch time.



**v2 amendment (bao 2026-05-31)**: dropped `mcp.default` role (mcp binds provider via manifest `brain_capabilities`, not via substrate-wide default). `irisy.primary` MUST be a detected user CLI — no auto-fallback to a paid provider. `irisy.fallback` is the CTRL-managed slot (paid by CTRL).

```rust
pub enum Consumer { IrisyPrimary, IrisyFallback, Custom(String) }  // v2: dropped McpDefault

pub struct RouteChain {
    primary: ProviderId,
    fallbacks: Vec<ProviderId>,
}
```

Default config (v2):
- `irisy.primary` = first detected user CLI in priority order `claude > codex > gemini > aider`. **No CLI detected → unset** (Irisy toasts "Configure a provider in Settings → Providers"). Never auto-falls-back to a paid provider for primary slot. *Reason: augmentation philosophy — CTRL does not silently spend money on the user's behalf for the primary path.*
- `irisy.fallback` = `volc` (CTRL-managed credential, CTRL pays the Volc Doubao bill; future replaces with ctrl-brand provider). Always present, always healthy — first-boot users without any CLI still get a working AI via this fallback. *This is the substrate-level CTRL business guarantee.*

**Volc has two manifest ids** to disambiguate the dual identity:
- `volc` = CTRL-managed fallback (credential from CTRL secrets pipeline / ctrl-cloud worker, never from user keychain). Used by `irisy.fallback` only.
- `volc-byok` = user BYOK Volc (credential from user keychain). Listed in `/settings/providers` REST section, user-elected.

Persisted at `~/.ctrl/state/active-providers.json` (v2 schema):
```json
{
  "roles": {
    "irisy.primary":  "claude-oauth",
    "irisy.fallback": "volc"
  }
}
```

v1 → v2 migration: if file has the old single bucket `{"text.chat": "<id>"}`, the loader writes `roles.irisy.primary = <id>` and `roles.irisy.fallback = "volc"`. If file has v1 `roles.mcp.default`, the loader drops that key.

`/text-chat` SSE endpoint (port 17878) accepts `?consumer=<role>` query param. Pi bridge sets `consumer=irisy.primary`; on stream error/timeout, kernel auto-falls-back through `RouteChain.fallbacks` (default: `["volc"]`) + emits `provider:failover { from, to, reason }` event.

**SSOT lock (v8 2026-06-06)**: `~/.ctrl/state/active-providers.json` is the SINGLE source of truth for routed provider/model. There is no `last_routed` mirror register, no router-internal routing-state cache for display. The router reads SSOT per `/text-chat` request (mtime-watched in-memory cache invalidated on file change + on `provider_set_active()`); the file IS the answer. Tauri command `get_active_providers()` returns the parsed SSOT (with full provider descriptors from `provider_list()` joined in) for chip + Irisy self-report. SSOT changes emit Tauri event `active-providers-changed { roles }` so subscribers refresh without polling.

**Failover is transient override, not state mutation (v8)**: on primary call failure the router routes the SAME request to fallback + emits Tauri event `provider:routing-override { active, reason, ts }`. SSOT file is NOT written (user intent is not stolen by transient failure). On the next successful primary call, router emits `provider:routing-restored`. Chip overlays a ⚠ badge with the fallback label during the override window; cold display always reads SSOT directly.

**Retired (was earlier v8 draft, removed as patch-style)**: `provider:routed` per-request truth event, `last_routed` register, `brain_status.last_routed` field. Adding a 4th routing state on top of 3 racing ones (SSOT / Pi spawn intent / setModel target / proposed last_routed) does not fix the race — it extends it. The system-level fix is to retire 2 of the 3 racing states (Pi spawn intent + setModel target — see §1.2) and treat SSOT as both intent AND truth.

### §3.6 Detect + auto-adopt UX (mirrors VMark detect + role assignment is CTRL-new) — v2

**v2 amendment**: page renders **2 role sections** (not 3); `irisy.fallback` defaults `volc` at first boot without user action (CTRL-managed).

- Tauri command `provider_detect()` → `Vec<ProviderEntry { id, label, kind, binary_path, version, available }>`. Scans PATH for `claude` / `codex` / `gemini` / `aider` / `ollama`; pings REST endpoints for configured keys. Cached in `OnceLock<Mutex<...>>` (ported from VMark `detection.rs`).
- First boot + no `active-providers.json`:
  - `irisy.primary` = highest-priority detected CLI (`claude > codex > gemini > aider`), silent — Irisy one-line toast "Using <label> — change in Settings". **No CLI detected → primary stays unset**, Irisy toasts "Tip: install Claude CLI for free use, or your Volc fallback is already active" (still functional via fallback).
  - `irisy.fallback` = `volc` always — CTRL-managed credential, no user action needed.
- Tauri command `provider_set_active(role, provider_id)` runs `trial_verify()` (1-token "hi", 5s deadline) before committing. Failure → keep previous, surface specific error.
- `/settings/providers` page — **2 role sections** (Irisy primary / Irisy fallback) × radio rows with Available/Not-found badges. CLI providers listed first within each section, then `volc` (the CTRL fallback option, always shown as Available with "[CTRL-managed]" badge in fallback section). REST API (BYOK) section below — Anthropic / OpenAI / Google / Volc-BYOK / Kimi / DeepSeek / Ollama with Configure→ buttons. BYOK Volc is a separate row from CTRL-managed volc (different manifest id `volc-byok`).

### §3.7 Introspection — Irisy self-awareness (closes bao 2026-05-31 root issue) — v2 (chip data source RETRACTED in v9)

> **CHIP DATA SOURCE RETRACTED v9 2026-06-06** — see changelog. PWA `ChatHeaderControls` MUST read `pi_rpc('getState')` (Pi's rpc.md-documented authoritative API) for the displayed provider+model. With Pi bound to the real provider directly at spawn (§1.2 v9), `getState().model.{provider, id}` IS the truth — there is no longer a wrapper-side router to disagree with Pi. `get_active_providers` Tauri command remains as SETTINGS INTENT projection (Settings UI consumes it for "what did the user pick"); the chip uses Pi truth. `runtimeTruthBlock` in ctrl-pi-bridge reads `Context.model` (Pi's already-resolved current model) rather than fetching CTRL HTTP. Section body below preserved for history.



**v2 amendment**: dropped `mcp.default` from the providers map. Fallback `volc` label = `"CTRL Cloud"` (brand-facing), not `"Volc Doubao"` (codename) — keeps user-facing layer abstracted so the future ctrl-brand swap is invisible.

Tauri command `brain_status()` (health view — NOT a routing-truth view; for routing-truth see `get_active_providers()`):
```json
{
  "engine": { "id": "Pi", "version": "0.73.1", "healthy": true, "last_token_ms": 142 },
  "providers": {
    "irisy.primary":  { "id": "claude-oauth", "label": "Claude subscription", "binary": "/opt/homebrew/bin/claude", "healthy": true, "managed_by": "user" },
    "irisy.fallback": { "id": "volc",         "label": "CTRL Cloud",          "endpoint": "<ctrl-managed>",         "healthy": true, "managed_by": "ctrl" }
  },
  "last_failover": null
}
```

Tauri command `get_active_providers()` (v8 — routing truth, single SSOT projection):
```json
{
  "roles": {
    "irisy.primary":  { "id": "claude-oauth", "label": "Claude subscription", "model_id": "claude-sonnet-4-20250514", "model_label": "Claude Sonnet 4", "managed_by": "user" },
    "irisy.fallback": { "id": "volc",         "label": "CTRL Cloud",          "model_id": "doubao-1-5-pro-32k-250115", "model_label": "Doubao Pro 32K", "managed_by": "ctrl" }
  },
  "override": null
}
```

`override` is non-null only during a transient failover window: `{ active: "irisy.fallback", reason: "<error>", ts: "..." }`. Cleared by `provider:routing-restored` event on next successful primary call.

`managed_by` field (v2): `"user"` = user-owned CLI or user BYOK key; `"ctrl"` = CTRL-paid fallback. Settings UI surfaces this so the user understands who pays for each path.

**Routing-truth read rules (v8 lock, supersedes earlier-draft v8)**:
- PWA `ChatHeaderControls` calls `invoke('get_active_providers')` on mount + subscribes Tauri events `active-providers-changed` (SSOT mutation) + `provider:routing-override` / `provider:routing-restored` (transient failover). Cold-render = SSOT projection. Failover-render = overlay ⚠ badge with `override.active` label. **Never calls** `Pi.getState()` / `getAvailableModels()[0]` / reads `brain_state` for chip display.
- ctrl-pi-bridge `runtimeTruthBlock` HTTP-fetches kernel `/api/active-providers` (mirror of `get_active_providers` Tauri command, same shape) at extension load + on SSOT-change webhook from kernel. **Never reads** `process.env.PI_PROVIDER` / `PI_MODEL` (both retired in §1.2).
- Irisy system prompt v5 (ADR-005 § persona) injects `<brain_state>` block built from `get_active_providers()` output. Irisy answers "你用什么模型" with `roles["irisy.primary"].label + model_label` ("Claude 订阅 · Sonnet 4") — never RPC codename, never `Pi.getState().model.id`. During override, Irisy uses `roles[override.active].label` instead + says "Claude 暂时连不上, 我切到 CTRL Cloud 了" using the typed `provider:routing-override` payload.

### §3.8 Retirements

Removed by this section (do not re-introduce): `brain_config.rs`, `commands/brain.rs`, `~/.ctrl/active-brain` file, `BrainListReply / BrainView`, single-`text.chat`-bucket assumption, hand-rolled RPC wire format in `ctrl-pi-bridge` (use Pi's `RpcClient`).

### §3.9 Switch provider UX — in-place Pi `setModel` (v10 — 2026-06-07)

Formalises v9 changelog item (4) — was cited in code but never had a section.

`provider_set_active` Tauri command (mutates SSOT `~/.ctrl/state/active-providers.json`) returns:

```rust
pub struct ProviderSetActiveReply {
    pub trial_reply: String,          // first chunk of the 1-token trial chat
    pub model_id: Option<String>,     // first model from the provider's manifest
}
```

PWA `providerSetActive` (`packages/ctrl-web/src/lib/provider-config.ts`):

1. `await invoke('provider_set_active', { args })` — Tauri side mutates SSOT + runs trial verify.
2. If `args.role === 'irisy.primary'` and `reply.model_id` is non-null, dynamic-import `usePiRpc` and call `setModel(args.provider_id, reply.model_id)` via Pi RPC `/api/pi-rpc` (Pi's published method on `RpcClient`).
3. Failure of `setModel` is non-fatal: SSOT is the source of truth and the next Pi spawn picks up the new binding regardless.

Effect: switching provider takes ~0 ms perceived, the running Pi session is preserved (no daemon respawn = no context loss). Required because v9 §1.2 binds Pi to the real provider at spawn; without an in-place swap, every Settings change would require restart_brain.

### §3.11 Coding L1 — on-demand native Pi TUI (v11 — 2026-06-07)

bao 2026-06-07: "把 coding 的 L1 功能完全使用 PI 完成了 L1 都是点击打开和关闭侧工作区" + "Irisy 和 coding 需要使用不一样的 provider".

The Coding L1 chip spawns **a separate Pi process** (not the kernel-managed Irisy daemon) in native TUI mode, with its own provider+model. Independent SSOT slot, independent credentials, independent session — Pi's full coding-agent UX with zero CTRL interposition.

**Role**

- New `Consumer::CodingPrimary` (id `coding.primary`). Persisted in `~/.ctrl/state/active-providers.json` alongside `irisy.primary` / `irisy.fallback`.
- `route_chain(CodingPrimary).fallbacks = []` — Coding never silently falls through to a different provider on auth failure. The error surfaces in xterm and the user re-picks in Settings.
- `provider_set_active` accepts `role = "coding.primary"` unchanged (Consumer enum's `Custom(String)` fallback was already there; v11 promotes it to a first-class variant for readability).
- `get_active_providers` iterates `[IrisyPrimary, IrisyFallback, CodingPrimary]` so PWA Settings + chip see all 3 roles.

**Spawn path (`coding_resolve_spawn` Tauri command)**

`src-tauri/src/commands/coding.rs::coding_resolve_spawn(provider_id_override)` returns:

```rust
pub struct CodingSpawnSpec {
    pub command:        String,                 // ~/.ctrl/pi/node_modules/.bin/pi
    pub args:           Vec<String>,            // ["--provider", id, "--model", model]
    pub env:            HashMap<String,String>, // { CTRL_PI_API_KEY_<UPPER_ID>: <key> }
    pub provider_id:    String,
    pub model_id:       Option<String>,
    pub provider_label: String,
}
```

The API key is resolved kernel-side via `credential_vault::get(account)` from the provider's manifest AuthSource — it never crosses the Tauri IPC boundary as plain text. PWA hands the spec to existing `cs_spawn` (no new wire, reuses portable-pty + StssBridge).

**L1 chip click-toggle UX**

`PrimaryRail::handleNavClick` for Pool / Notes / Coding now:

1. Queries `useWorkspaceStore` for the system instance + the chip's tab.
2. If `tabIsOpen && tabIsActive && workspaceOpen` → `closeTab(systemInstance.id, def.id)` + new `collapse_workspace_window` Tauri command (compact width).
3. Otherwise → `openSystemTab(...)` + `ensure_workspace_window_expanded`.

Switching across chips while the workspace is open just switches tabs (no collapse). The project-directory `window.prompt` is removed from the Coding chip — Pi's TUI owns cwd via `:cd` / `--cwd`.

**routes/coding.tsx**

1. `csList()` — reuse any existing non-crashed Pi env (avoids spawning N Pi processes when the user clicks the chip repeatedly).
2. Otherwise `invoke('coding_resolve_spawn')` then `cs_spawn(spec)`, then `navigate('/code-space/$envId')`.
3. On error (no coding.primary configured, key missing), inline message + link to `/settings/providers`.

**Settings — provider picker**

`IRISY_ROLES` list extended to 3 rows: `irisy.primary` / `irisy.fallback` / `coding.primary`. The existing `ProviderRoleRow` component handles the new row unchanged because `providerSetActive({role, provider_id})` already accepts any role string. Users get a single Providers tab in Settings where they bind 3 roles to 3 (possibly different) providers — e.g. Volc → Irisy primary, CTRL Cloud → Irisy fallback, Claude (BYOK or OAuth) → Coding primary.

**Why on-demand process (not RPC)**

Pi's RPC mode (used by Irisy) wraps the agent loop and exposes 38 RpcClient methods, which is great for embedding chat in a PWA bubble — but it costs the native TUI affordances (live status line, slash commands rendering in-place, terminal-native scrollback, real PTY signals). Coding is a power-user surface; bao explicitly asked for "完全使用 PI" = the native Pi CLI experience. xterm + cs_spawn gives that for ~0 new code. Two Pi processes coexist cleanly because each has its own session dir under `~/.pi/agent/sessions/` and reads `~/.pi/agent/{models,settings}.json` for config.

### §3.10 Provider template catalogue — 20 entries (v10 — 2026-06-07)

`src-tauri/src/kernel/provider/provider-templates.json` ships 20 entries (was 10 in v3): volc · openai · anthropic · deepseek · kimi · google · openrouter · groq · together · mistral · xai · perplexity · fireworks · azure-openai · vertex · bedrock · cloudflare · zhipu · qwen · custom (free-form). All use `protocol: openai` (OpenAI-compatible REST shape) except `anthropic` (`protocol: anthropic`). Settings → Providers Add wizard renders one row per entry with `keyHint` as inline help. User overrides at `~/.ctrl/provider-templates.json` (merge rule: matching `id` replaces, new `id` appends).

## §4 Crypto — vodozemac (Matrix Olm) on all platforms

Adopt **vodozemac** (Matrix.org Olm Rust fork). Olm 1:1 sessions only (point-to-point double-ratchet); Megolm disabled (CTRL = single-user multi-device). All platforms — Tauri 2 desktop (crate), PWA mobile (WASM via `wasm-bindgen`), future hardware peers. libsignal-* explicitly rejected (Signal upstream policy + C++ WASM complexity + audit duplication). Defense-in-depth: DH public-key non-contributory check (vodozemac 0.10+ ships natively; keep wrapper-layer check as belt-and-braces).

v1 ships no mesh layer (memory `feedback_reuse_existing_capability_first` 2026-05-22 — 新功能先用现有 capability). vodozemac unlocked for v1.1+ mesh sprint.

## §5 Subprocess — SubprocessActor + portable-pty

**SubprocessActor** = concrete `Actor` trait impl in `src-tauri/src/kernel/subprocess_actor.rs`. Holds `Box<dyn portable_pty::Child>` + `MasterPty` + capability + tile metadata. Lifecycle: `on_spawn` → `handle(Event)` (stdin / resize / signal) → `on_shutdown` (kill + close PTY).

- **portable-pty 0.9** — Unix forkpty + Windows ConPTY auto-adapted. Mozilla/wezterm production use.
- **Events** in: `Subprocess.{Stdin, Resize, Signal}`. Events out: `Subprocess.{Stdout, Exit, Spawned}`.
- **Manifest** `ActorManifest.prototype = "subprocess"` carries `{ command, args, env, cwd, pty: {cols,rows} }`.
- **Supervisor**: single SubprocessActor crash never crashes kernel (panic catch + Error Event). 256 MB RAM cap per actor (OS rlimit / Job Object).
- **Used by**: Code Space tile mcps (claude-code / cursor / aider / bash), CLI providers (§3 adapters).

## §6 MCP bus — kernel as MCP server :17873

> **v27**: this bus is now also **the projection tool call-return gate** (§1B.4). When the user's driver CLI invokes a tool CTRL projected into its native MCP config (§1B.1 Tool→MCP row), the call returns here at :17873 — so :17873 is both the tool host (below) AND the kernel capability / approval / blast-radius gate (ADR-006 §4/§5) for every projected-tool call. Projected MCP entries point **only** at :17873, never directly at an external MCP server.

Kernel runs MCP **server** parallel to its `mcp_host` (client) — same `rmcp 1.7` crate, different features. Single bus for the driver CLI / external agents to consume kernel capabilities via MCP wire.

- **Bind**: `127.0.0.1:17873` (one above ST-SS bridge 17872). Never `0.0.0.0` — cross-device goes through mesh (§4), not MCP.
- **Transport**: streamable-http (MCP 2025-03-26 spec). rmcp 1.7 + `server` + `transport-streamable-http-server` + `macros` + `schemars`. axum 0.8 hosts.
- **Auth**: ephemeral Bearer token. Fresh UUID v4 on every kernel boot, never persisted. `Authorization: Bearer <token>` header; axum middleware checks before `/mcp`.
- **Discovery**: Tauri command `mcp_server_info` returns `{ url, token }`.
- **Tools (28, v3)**: `kernel.status` · `vault.{read,write,write_image,list,search,delete,root_path,rebuild_index,backlinks,tags,notes_by_tag,mentions,orphans,broken_links,graph_data,rename,move,create_folder,set_starred,aliases,watch}` (21) · `kv.{get,set}` · `llm.chat` · `mcp.{list_servers,proxy_list_tools,proxy_call_tool}`. Stream LLM stays on Tauri event channel (PWA only), not on MCP surface. Vault tool set expanded in v3 per §8.

### §6.1 Boot wiring + Pi auto-connect (v10 — 2026-06-07)

Before v10 the MCP server module existed but `serve()` was never called. v10 wires the boot:

- **Server start** (`src-tauri/src/shell/kernel_supervisor.rs::start`): spawns `kernel::mcp_server::serve(runtime.clone(), None, MCP_SERVER_LISTEN_ADDR)` immediately after the provider HTTP endpoint. On success, publishes the per-boot bearer via `std::env::set_var("CTRL_KERNEL_MCP_TOKEN", h.auth_token.as_str())` + `set_var("CTRL_KERNEL_MCP_PORT", port)`. The set_var is safe here because it runs synchronously at kernel boot, before any task reads env. Pi child processes inherit naturally (no `env_clear` in `spawn_brain`).
- **Pi auto-connect** (`packages/ctrl-pi-plugin/src/pi-bridge.ts::injectActiveProviderForSpawn`): right after writing `~/.pi/agent/models.json`, upsert `~/.pi/agent/settings.json` mcpServers entry:

  ```json
  {
    "mcpServers": {
      "ctrl-kernel": {
        "url": "http://127.0.0.1:<port>/mcp",
        "transport": "streamable-http",
        "headers": { "Authorization": "Bearer <token>" }
      }
    }
  }
  ```

  Other user-added mcpServers are preserved (upsert, not overwrite). Token from `process.env.CTRL_KERNEL_MCP_TOKEN`. Pi reads settings.json on every spawn, auto-connects, exposes the 28 kernel tools to the agent loop. Irisy's 8 fs-based tools (vault_* + skills) coexist with the 28 kernel MCP tools — both surface on `getCommands` / agent context.

## §7 Composition — 6-axis manifest (single substrate law)

Mcp manifest declares 6 axes; runtime atomically provisions all declared resources at install (no first-run wizard). Single law replaces 4-way schema drift.

| # | Axis | What |
|---|---|---|
| meta | `pattern` | A/B/C/D/E/F/G (ADR-004) → routes to executor |
| 1 | `capabilities` | subset of §2 namespaces + `file.{read,write}_allowlist` |
| 2 | `brain_capabilities` | typed multi-provider (text.chat / image.generate / audio.stt …) with optional `provider_pin` |
| 3 | `mcp_servers` | Pattern D bindings (spawn + tool allowlist) |
| 4 | `skills` | SKILL.md refs resolved via 3-tier chain (`vault/skills/` > `~/.claude/skills/` > mcp bundle) — first hit wins, no merge |
| 5 | `ui_surface` | 9-enum (none/notification/modal/clipboard/html-output/chat-stream/picker/form/canvas) |
| 6 | `cap_asset` | install-time provisioning: `cap_asset.files` (immutable bundle) + `cap_asset.vault` (user-facing folder + seed) |
| 7 | `provision` | install-time toolchain + env (v21): `tools[]` (id + check + install hints) resolved built-in-downloader-first → system pkg-mgr fallback; `env` values pull `{{secret:<key>}}` from keychain at inject time |

**Persona lives inside `cap_asset.files`** as per-mcp markdown — not a separate axis. Vault override `vault/mcps/<id>/persona.md` wins; single lookup, no global persona library.

**SSOT**: `packages/ctrl-mcp-sdk/src/manifest-schema.ts`. Other representations are derivatives (PWA Zod re-exports; Rust serde mirrors with golden file test).

**Builtin vs user mcp** = one metadata flag. `manifest.builtin = true` → ships from `packages/ctrl-mcps/builtin/<id>/`, re-seeds on every launch (self-repairs deletion). `builtin = false` → `~/.ctrl/mcps/<id>/`, uninstallable.

**Multi-modal category exception** to §2 frequency ≥3 rule: image.generate / image.edit / image.understand / audio.stt enter v1 even with 1 consumer each — "做海报得有 image 大模型, 我们是双重 brain" (bao 2026-05-30). Frequency rule still governs non-brain namespaces.

### §7.1 Feature pack — the user-facing unit (v21, bao 2026-06-12)

**「功能包」(feature pack) = the USER-FACING name for an installable manifest.** Users say "装个功能包" / "卸了这个功能包"; the word `mcp` stays a code-internal term (manifest model here in §7, runtime in ADR-004) the user never sees. All PWA copy uses 功能包. Extends v12 (keycap→mcp, a code-side rename) — for the *user* the name is 功能包.

A feature pack is the **universal shell** for *"plug any API/service in → orchestrate → surface a UI on demand"*. One schema fills wildly different worlds:
- **CF Workers 开发**: `cli-wrapper` (wrangler) + secret (CF token) + actions (deploy/logs/preview) + deploy-log UI.
- **HubStudio 营销**: `network` HTTP allowlist (HubStudio API) + secret (API key) + actions (manage accounts / batch-post) + `text.chat` AI rewrite (pipe) + account-matrix UI.

The shell is fixed; the content (接什么 API / 什么 secret / 什么动作 / 什么 UI) is per-pack. **想要什么出什么 UI** = the pack declares `ui_surface`, the workbench renders it; the AI creator generates that declaration from one intent sentence. CTRL stays a substrate — concrete scenarios (营销/开发/CRM) grow as packs, **not built-ins** (CTRL 不长胖,胖的是 pack 库; cf. vault/ctrl/decisions/0003).

### §7.2 Axis 7 `provision` — toolchain install + env (v21)

Axis 6 `cap_asset` only *copies static files*; axis 7 `provision` *installs external toolchains* (node / wrangler) a pack needs.

```jsonc
"provision": {
  "tools": [
    { "id": "node",     "check": "node --version",
      "install": { "macos": {"via":"brew","pkg":"node"}, "windows": {"via":"winget","pkg":"OpenJS.NodeJS"} } },
    { "id": "wrangler", "check": "wrangler --version",
      "install": { "any": {"via":"npm","pkg":"wrangler","global":true} } }
  ],
  "env": { "CLOUDFLARE_API_TOKEN": "{{secret:cf_api_token}}" }   // value pulled from keychain
}
```

**Per-tool resolution order** (bao 2026-06-12 — built-in downloader primary):
1. run `check` (`wrangler --version`) → skip if already present.
2. absent → **CTRL built-in downloader**: pull prebuilt binary to `~/.ctrl/tools/<id>/`, prepend to the pack env PATH. Same lazy-install lineage as `~/.ctrl/pi/`, `~/.ctrl/agents/kairo/` — isolated, no system pollution, removed on uninstall.
3. downloader miss / fail → **fallback system pkg-mgr** (brew / winget / npm, reads `install.<os>.via`).
4. all fail → friendly error + manual guidance.

**Base infra (one-time)**: a **tool registry** (tool id → per-platform prebuilt binary URL + checksum) the downloader queries by id. Base-layer, not pack content.

**Secrets never touch Irisy/LLM** (decision 0004): `{{secret:<key>}}` in `env` resolves from keychain at injection time, kernel-side; the LLM only ever sees a "configured ✓" boolean.

### §7.3 Packaging + distribution (v21)

Feature-pack file = a v2 mcp manifest (markdown + JSON frontmatter, git-diffable, AI-generatable). Distribution bundle = **Anthropic `.mcpb`** (reused, not a custom format — ecosystem-aligned). **Discover = the pack store**: intent → Irisy 收敛 1-3 (curation, NOT a Quicker-style 8000 long-tail wall) + scene-grouped browse + search. **Create = AI creator** generates the pack from natural language (user writes no JSON unless advanced). Same format both ends → 造的=别人挑的源头 (share-and-be-shared).

### §7.4 Feature packs are systematic — manifest = data, runtime = generic, zero code to add a pack (v34, bao 2026-06-25)

**锁的方向**: 加一个功能包**永远不改一行代码** (bao 2026-06-25: 「我们不能要增加一个功能包就修改一次代码,而是自动的;而是系统化的」)。manifest 是**数据**,runtime 是**通用引擎** —— 引擎读任意 manifest 就能渲染 / 执行 / 绑知识库 / 安装,不为某个具体 pack 写 if 分支。这是 §7.1「CTRL 不长胖,胖的是 pack 库」的硬约束化:pack 库的增长**机制化**,不靠人工接线。

**3 个零代码数据源** (功能包从哪来 —— 三条都不需要改 CTRL 代码):

1. **本地装** `~/.ctrl/mcps/<id>/` —— 已经数据驱动。`loadInstalledPacks` 扫所有已装 manifest,声明 `actions[]` 的即成 feature pack,声明 `knowledge_base` 的即得专属 KB。新 pack 落盘即出现,零代码。
2. **Discover commons (registry pull)** —— Discover 不是一张写死的列表,是一个 registry 客户端:拉 **MCP Registry** (`.well-known/mcp.json` 约定) + **Smithery** (2000+ MCP) 等公共源,intent → Irisy 收敛 1-3 (curation,不是 8000 长尾墙)。当前 `feature-pack.ts` 的 `OFFICIAL_PACKS` 硬编码数组 = **临时 bundled stand-in**,接上 registry 数据源后**退役** —— 内置 catalog 不是终态,registry 才是。
3. **Irisy 生成** —— mcp-creator persona (connector-by-Irisy,见 memory) + **复用 Anthropic `mcp-server-dev` 开放格式 Agent Skills** (`build-mcp-server` / `build-mcp-app` / `build-mcpb`,SKILL.md + references/,开放格式不重造)。流程: discovery → scaffold → **MCP Inspector 式校验** → 经 gate 安装。自然语言一句话 → manifest,落地即走数据源 1。

**通用 runtime (已落地的落点)** —— 引擎对任意 manifest 同构:
- **渲染** = `FeaturePackScene` 读 `actions[]` 出 action bar,不认具体 pack。
- **执行** = gate `mcp_pack_run` (`mcp_server.rs`) 经 `:17873` 跑 action,secret 由 provision runner 注入,永不回 brain。
- **绑专属 KB** = manifest 通用字段 `knowledge_base` → `pack.kbDir` → `inKbScope` 裁剪检索 (bao 2026-06-25: stocks = 助理角色 + `Stocks/` KB + ghostfolio pack,**不是新角色**;任何 pack 自声明 KB,零 per-pack 代码)。
- **安装** = gate `mcp_pack_install` —— brain (hermes / Irisy) 自己装 pack 的回流落点;`mcp_pack_list` 列已装,合起来 ≈ MCP-Inspector 式 smoke 校验面。

**校验** = MCP-Inspector 式 smoke,经 gate (`mcp_pack_list` / `mcp_pack_run`) 跑一遍 action 确认能用,不是离线 lint。

**对齐**: 数据源 3 的开放 skills 由 ADR-001 spine § projection 的 projector 投影给 driver CLI (不重造,骑 Anthropic 升级);commons 分享 = ADR-006 §5 share-and-be-shared;角色 = persona 层 only,pack + KB 是正交 config (ADR-003 §8.6 + ADR-005 v6,**不焊死**)。

**不做**: 不为每个 pack 写 .ts / Rust 分支;不把 Discover 做成人工维护的长尾列表;不自造 manifest/bundle 格式 (沿用 v2 manifest + Anthropic `.mcpb` + mcp-server-dev skills)。

**v1 落地序** (方向已锁,实施分步): ① OFFICIAL_PACKS 退成纯数据 / 接第一个 registry 作 Discover 数据源;② 投影 Anthropic `mcp-server-dev` skills 给 Irisy + hermes;③ mcp-creator 端到端: NL → manifest → gate 安装 → smoke 绿。

### §7.5 Feature pack = the product-grade unit — CTRL's answer to "project" (v41, bao 2026-07-01)

**bao 2026-07-01**: 「我们的功能包,类比 project 的话,我希望我们的功能包都是**产品级别**的;也是**用户创造中心,分享中心**。」

**定位对照**: Atoms(MetaGPT) / Lovable 都以 **project** 为顶层组织单位 (一个 project = 一个完整产品 + 其 knowledge + 分享落点; MetaGPT 的 `Team.generate_repo(idea)→repo`、Lovable 的 Workspace-Knowledge[全局]+Project-Knowledge[单 app] = `CLAUDE.md`+`AGENTS.md` 同构)。**CTRL 的对应单位 = 功能包**,但 substance 相反 —— 不是从零造一个独占 app (云托管、卖托管),而是**产品级 AI-native 能力,长在已有开源软件/MCP 上、Irisy 造、当 MIT commons 分享、经 `:17873` gate 治理**。同样是「产品级单位」的抬升,substance 是反默认的护城河 (整合非重造 / commons 非托管 / 本地非云)。

**三条属性锁 (功能包的定义)**:
1. **产品级 (product-grade)** — 一个功能包 = 一个**完整产品**,不是 raw wrapper。硬 bar = **§14 AI-native 提升层** (describe/query/produce 三动词 + one-shot 高信号原子,**不是一 endpoint 一 tool 镜像**) + 专属 KB (`knowledge_base`) + 按需 UI (`ui_surface`) + per-call gate 治理。「产品级」= 这条 uplift bar 的用户语言版。对齐 v39 moat + `vault/ctrl/ai-native-feature-pack-research.md` (Anthropic「raw one-tool-per-endpoint wrapping 不是 agent-native」)。
2. **用户创造中心 (creation center)** — 功能包是「造」的落点: Irisy `mcp-creator` (NL → manifest,用户不写 JSON,§7.4 数据源 3)。
3. **分享中心 (sharing center)** — 功能包是「分享」的落点: Discover 拉 registry + 发 `ctrl-*` MIT commons,同一格式两端 = 造的=别人挑的源头 (§7.3 share-and-be-shared,ADR-006 §5)。

**读法 A (bao 钦定 2026-07-01) —「功能包」专指产品级单位,区分于原子工具**:
- **功能包 = 产品** (capability-pack-map ① 原生模块 + ③ connector: Ghostfolio / CRM / PKM / 股票 / ERP —— 每个都是完整产品,是创造+分享单位)。
- **② 内置原子工具** (Clipboard / OCR / Translate / Text 那 Top15) = **工具 / ingredient / primitive,不是「功能包」** —— 没人会去「分享一个 Translate 原子」。它们是功能包的**配料**,仍是 mcp manifest,但**不进 Discover 的「产品级功能包」货架**。
- IA 收敛: **功能包 = 产品 (创造+分享单位),工具 = 配料**。capability-pack-map 三层模型据此校准: ①③ = 功能包 (产品级),② = 工具层。

**不改锁点**: manifest = 数据 / runtime = 通用 (§7.4);5 primitives;三动词;`:17873` gate;secret 不进 LLM;plain-text。「产品级」是**验收 bar 的抬升 + IA 收敛**,不是新增运行时分支 —— 通用引擎不变,变的是「什么才配叫功能包」的门槛。

**种子验收**: `ctrl-ghostfolio` 据此三条全齐验收 —— 产品级 (§14 uplift 非 raw-wrap) + Irisy 造得出 + 可作 MIT commons 分享。缺任一条 = 种子未证成命题。

### §7.6 Publish — the share-and-be-shared PRODUCER side is v1 (v43, bao 2026-07-01「拉进 v1」)

**Decision**: the **pack-publish** half of §7.5 property ③ (sharing center) moves into **v1**. bao 2026-07-01, on «分享中心是功能包定义属性 + 全量修复»: pull registry publish into v1 (was implicitly deferred). Discover already **consumes** registries (§7.3/§7.4 registry-pull); v1 was missing the **produce** side — a user could copy a pack's JSON by hand but not publish it to a commons. §7.6 closes that: **create → publish → discover is one v1 loop** (同一格式两端 = 造的=别人挑的源头).

**Scope precision (does NOT over-reach)**: this is the **pack marketplace** producer (a manifest published to a registry/commons), NOT the §1B.6 **mesh-projection network** (peer-discovered assets projected into a CLI). §1B.6 stays **v1.1** (mesh substrate §4 dependency). Publishing a `ctrl-*` manifest to a registry is a plain HTTPS producer with no mesh dependency, so it fits v1 cleanly — this amendment moves only that half.

**Mechanism**:
- **Gate tool `mcp_pack_publish(pack_id, registry?)`**: read the installed manifest → **evals first** (`pack_validate::validate_manifest` — never publish a pack with errors, §7.4/§7.5 quality bar) → package (v1 = the v2 manifest JSON; `.mcpb` bundle reserved) → POST to the registry endpoint. Registry URL + token resolve kernel-side from the credential store (`ctrl:registry:publish_url` / `:publish_token`), never the LLM. Returns the published reference (namespace/id/url). Kernel-internal HTTPS (like the §14 connector fetch); the REAL public registry (official MCP Registry `mcp-publisher` namespace ownership / ctrl-market Worker) is the honest external gap — CTRL-side producer verified by mock-HTTP, same posture as ctrl-ghostfolio's live instance.
- **Frontend**: a Share/Publish action on an installed pack → `mcp_pack_publish` → shows the published reference. The existing JSON copy-paste stays as the zero-infra fallback.

**Locks unchanged**: license = `ctrl-*` MIT commons (ADR-006 §5.1); no self-invented registry protocol (official MCP Registry `mcp-publisher` + namespace ownership proof, per research `ai-native-feature-pack-research.md` §4); secret kernel-side; publish gated on evals (can't publish a broken pack). **NOT** pulling the mesh-projection network (§1B.6) into v1; **NOT** inventing a bundle format (Anthropic `.mcpb`).

## §8 Vault — RETIRED in v19 (kairo external replaces CTRL-owned editor stack)

> **v19 (2026-06-09)**: §8 v3-v6 content RETRACTED. CTRL no longer owns the notes editor + index. **kairo (external MIT)** owns markdown editing + wiki-link + backlink + native git + diagram. CTRL kernel keeps `~/Documents/CTRL/Notes/` as the canonical storage path, exposes it via MCP server (`notes.search` / `notes.read` / `notes.write`) so agents (hermes / opencode) can access. `notes_index.rs` (FTS5) kept as optional MCP convenience layer — kairo's own index is primary. PWA `/notes` route embeds kairo via webview pointed at workspace path.
>
> **No "vault" word inside CTRL** going forward. bao 2026-06-09: "我没有 vault 这个概念" — rename to "Notes" everywhere. Migration tracked in H-2026-06-09-002 task #6.
>
> **What changed**: editor lib lock (Tiptap + CodeMirror 6 + mermaid.js + gray-matter) dropped from substrate ADR — kairo bundles its own. PWA `NotesApp` 3-pane (NotesActions / NotesTree / NotesEditor / NotesBacklinks) deleted — webview to kairo replaces. Wiki-link Tiptap extension port (§8.8) RETIRED — kairo has native wiki-link.
>
> **What survives**: invariant filesystem layout (`~/Documents/CTRL/Notes/` flat markdown + frontmatter + tags), vim-test (user can open notes folder in vim/Obsidian after uninstalling CTRL), kernel MCP endpoints for agent access (subset of v3 21-command list — keep `notes.{search,read,write,list,backlinks}` for agent consumption, retire `notes.{rename,move,create_folder,set_starred,aliases,watch,graph_data}` which kairo owns directly).

### §8 v3-v6 (historical, RETIRED 2026-06-09) — markdown PKM substrate

**Why this section exists**: bao 2026-06-01 — vault MD management is a substrate concern (storage + index + integrity), but Daily Note / Sourcing inbox / templates are **feature-layer** (Irisy + frontend wire them via vault-internal config). Earlier `VaultBrowser.tsx` 3-pane shell predates ADR-003 4-col app shell and conflicts with it. Decision driver: memory `feedback_build_system_not_business` ("我建系统不建业务") + `decision_ctrl_obsidian_philosophy` (plain-text vault, vim test).

### §8.1 Module location

- **Kernel**: `src-tauri/src/kernel/vault.rs` + `vault_index.rs` (existing — SQLite FTS5 + backlink scanner + tag scanner, kernel-native, no VMark sidecar)
- **Commands**: `src-tauri/src/commands/vault.rs` (existing 8 + 13 new commands per §8.3)
- **MCP surface**: extended in §6 from 11 → 28 tools
- **Frontend**: `packages/ctrl-web/src/components/vault/*` (new L2VaultPanel + SourcingReviewTab + BacklinksDrawer; retire VaultBrowser + BacklinksPanel)
- **Conventions**: `packages/ctrl-web/src/lib/vault-conventions.ts` (reads `vault/.ctrl/*.yaml`)

### §8.2 Storage layout

```
~/Documents/CTRL/                   ← vault root (vault_root_path())
    notes/                          ← user main namespace
    daily/                          ← Daily Note convention (path_template-driven, §8.4)
    sourcing/                       ← user inbox (clipboard/OCR/link mcps write here)
    templates/                      ← template files (user can fork; default 2 seeded)
        daily.md
        meeting.md
    skills/                         ← per-mcp skill override (ADR-002 §7)
    mcps/<id>/                   ← per-mcp vault override (cap_asset.vault)
    .ctrl/                          ← CTRL-managed config (hidden in tree, vault_list opt-in)
        sourcing.yaml
        daily-notes.yaml
        sourcing-prompt.md
        review-queue/<YYYY-MM-DD>.md
```

All plain markdown + YAML frontmatter. **vim test 满分** — user can open any file with vim and get full value. `.ctrl/` mirrors Obsidian `.obsidian/` (hidden by default, still user-readable).

### §8.3 Kernel primitive endpoints (21 commands, exposed as `vault.*` MCP tools per §6)

| # | Command | Status | Backed by |
|---|---|---|---|
| 1 | `vault_read(path, opts?)` | existing | vault.rs |
| 2 | `vault_write(path, body, frontmatter)` | existing | vault.rs |
| 3 | `vault_write_image(path, bytes)` | existing | vault.rs |
| 4 | `vault_list({prefix?, include_hidden?, limit?})` | extend existing | vault.rs |
| 5 | `vault_search(query, limit)` | existing | vault_index.rs FTS5 |
| 6 | `vault_delete(path)` | existing | vault.rs |
| 7 | `vault_root_path()` | existing | vault.rs |
| 8 | `vault_rebuild_index()` | existing | vault_index.rs |
| 9 | `vault_backlinks(path)` | NEW | vault_index.rs (scanner already exists, expose) |
| 10 | `vault_tags()` | NEW | vault_index.rs |
| 11 | `vault_notes_by_tag(tag)` | NEW | vault_index.rs |
| 12 | `vault_mentions(text)` | NEW | vault_index.rs |
| 13 | `vault_orphans()` | NEW | derived from backlinks scanner |
| 14 | `vault_broken_links()` | NEW | derived from link scanner |
| 15 | `vault_graph_data()` | NEW | full node+edges (for graph view) |
| 16 | `vault_rename(from, to)` | NEW | vault.rs + index update |
| 17 | `vault_move(from, to)` | NEW | vault.rs (Sourcing accept uses this) |
| 18 | `vault_create_folder(path)` | NEW | vault.rs |
| 19 | `vault_set_starred(path, bool)` | NEW | frontmatter `starred:` write |
| 20 | `vault_aliases(path)` | NEW | frontmatter `aliases:` read |
| 21 | `vault_watch(prefix?)` → event stream | NEW | notify crate file watcher |

**Explicitly NOT in kernel** (feature-layer, see §8.4):
- ~~`vault_create_note(kind="daily")`~~ — Daily Note is feature, walks via `vault/.ctrl/daily-notes.yaml` + `vault_write` low-level
- ~~`vault_sourcing_routine()`~~ — Irisy behavior, not kernel API; Irisy composes from primitives 4/1/2/9/10/12

### §8.4 Feature-layer boundary (what is NOT substrate)

Two user-facing features live above kernel — kernel does not know about them:

**Daily Note** — `vault/.ctrl/daily-notes.yaml` defines `path_template`, `template` ref, `frontmatter_default`, `auto_create_on_first_write`. `lib/vault-conventions.ts` reads the yaml and composes the path; Irisy reads the same yaml when user asks "建今天的 daily". Both call `vault.write` low-level. Kernel sees only a `vault_write(daily/2026-06-01.md, body, fm)`.

**Sourcing inbox + integration routine** — `vault/sourcing/` is just a folder; clipboard / OCR / link mcps `vault.write` into it. `vault/.ctrl/sourcing.yaml` defines triggers (cron 9am + count threshold + manual command, all three concurrent), target root, review queue path. `vault/.ctrl/sourcing-prompt.md` is the user-editable prompt for Irisy's integration routine. Irisy runs the routine (composed from `vault.list(prefix='sourcing/')` + `vault.read` + `vault.tags` + `vault.search` + `vault.write` to `.ctrl/review-queue/<date>.md` + `platform.notify`). Kernel never touches the routine logic.

This boundary is load-bearing: it lets users (advanced) replace Daily Note convention by editing yaml without code changes, and lets Irisy's integration prompt evolve via vault file edit. Plain-text philosophy satisfied (`decision_ctrl_obsidian_philosophy`).

### §8.5 Frontend stack (locked)

Per memory `decision_vmark_not_substrate_use_open_stack` (no VMark sidecar):

- **Markdown editor**: Tiptap v2 (`@tiptap/react` + `@tiptap/starter-kit`) WYSIWYG + CodeMirror 6 (`@uiw/react-codemirror`) source-mode toggle — already shipped in `MarkdownViewer.tsx`
- **Wiki-link**: custom Tiptap extension cherry-picked from seahop/kairo (MIT, Sean Hopkins 2026), adapted to call `vault_list` for autocomplete + render broken-link styling
- **Mermaid diagrams**: `mermaid.js` (when content type triggers)
- **HTML sandbox**: iframe + CSP (existing pattern)
- **Frontmatter**: `gray-matter` round-trip (frontend-side; kernel already parses)
- **File tree**: folder-grouped flat list (current implementation, sufficient for v1; switch to `react-arborist` if deep nesting demanded)

### §8.6 Shell integration (ADR-003 frontend § shell v4) — v4 (bao 2026-06-02)

Vault is the substrate; the L1 chip surfaces the **Notes** app (the first vault-using app). Future apps that read vault data (e.g. Weekly Review, Meeting Notes) can also register as L1 chips or as Irisy-spawned mcps without entering this section.

- L1 PrimaryRail chip = **Notes** (id `notes`, label `Notes`, path `/notes`, icon = open-book glyph).
- Chip click uses `useWorkspaceStore.getState().openSystemTab({kind:'route', path:'/notes', title:'Notes'})` matching the Pool / Coding pattern. No L2 column flip, no auto window expand — the user opens the workspace via the ▾ chevron as elsewhere.
- L2 column reservation kept for future sub-nav use cases but **not** activated for Notes.
- `routes/notes.tsx` renders `<NotesApp />` (composition root in `components/notes/NotesApp.tsx`).
- `NotesApp` is a 3-pane grid (`220px 1fr 220px`):
  - **NotesActions** (top bar) — search input + `+ Note` / `Today` / `Review N` buttons. State (`query`, `busy`) owned here.
  - **NotesTree** (left) — folder-grouped flat list driven by `vault_list`; falls through to `vault_search` FTS5 when search > 1 char.
  - **NotesEditor** (center) — thin wrapper around `ViewerHost` + `resourceFromVaultPath`; the real editor (Tiptap WYSIWYG + CodeMirror 6 source + wikilink Tiptap extension per §8.5) lives in `MarkdownViewer.tsx`.
  - **NotesBacklinks** (right) — `vault_backlinks(selectedPath)` rendered as a clickable list; click selects the source in the Notes tree.
- Workspace tab kinds: `vault-md` (single-file MarkdownViewer when opened from outside the Notes app, e.g. wikilink click) + `sourcing-review` (`SourcingReviewTab`, Irisy-produced review queue).
- Forward-compat invariant: every editor / markdown / yaml lib is consumed as an npm package (`@tiptap/*` + `@uiw/react-codemirror` + `mermaid` + `gray-matter` + `react-markdown`). Components are thin wrappers — upstream lib upgrades flow through `npm install`, never through fork or vendor copy.

### §8.7 Retirements (load-bearing — `feedback_no_redundancy_one_ssot`)

- `routes/vault.tsx` deleted — replaced by `routes/notes.tsx` per §8.6 v4 (bao 2026-06-02). The L1 chip now routes to `/notes`, not `/vault`.
- `components/vault/VaultBrowser.tsx` deleted (3-pane shell conflicts with 4-col app shell)
- `components/vault/L2VaultPanel.{tsx,module.css}` deleted (v4 — L2 column not used for Notes; the app body composes inside its workspace tab)
- `components/vault/BacklinksDrawer.{tsx,module.css}` deleted (v4 — backlinks live inside the Notes app right column via `NotesBacklinks`, not as a workspace bottom drawer)
- `src-tauri/src/commands/system.rs::expand_workspace_window_if_collapsed` deleted (v4 — Notes opens via `openSystemTab`; window resize stays user-driven via the ▾ chevron per ADR-003 § shell-4col)
- Exported `VAULT_RAIL_ID` from `PrimaryRail.tsx` removed (v4)
- `components/vault/BacklinksPanel.tsx` deleted (O(N) frontend scan replaced by `vault_backlinks` kernel command)

### §8.8 Third-party port attribution

- **Wiki-link Tiptap extension**: ported from seahop/kairo, MIT License, Copyright (c) 2026 Sean Hopkins. Verbatim license at `THIRD_PARTY_LICENSES/kairo-MIT.txt`. Port location TBD (likely `packages/ctrl-web/src/components/viewers/tiptap-wikilink/`).

## §9 Smart table output — mcp output unification (NEW v5, 2026-06-03)

> Spec: `.olym/brainstorm/vault-irisy-product-design-2026-06-03.md` §5.6 + product decision P4
> Driver: bao 2026-06-03 "mcp 走简单一点, 用智能表格列表形式怎么样"

### §9.1 Lock

Every mcp's run output is captured into **one** SmartTable per mcp, not one-file-per-run. On-disk shape: `vault/notes/mcp-runs/<mcp_id>.table.md` (vim test passes — opens as a normal markdown file with a frontmatter `schema:` + a markdown table body). The SmartTable substrate (`packages/ctrl-web/src/lib/smart-table.ts` + `components/viewers/SmartTableViewer.tsx`) already exists; §9 only adds the wiring from `mcp_runner` to it.

### §9.2 Mcp manifest extension — `output_capture`

```yaml
# mcp manifest (per-mcp)
output_capture:
  enabled: true                                # default true; user can flip in Settings → Privacy
  table_path: notes/mcp-runs/{mcp_id}.table.md
  schema:
    - { key: ts,           label: When,        type: date }
    - { key: input_excerpt, label: Input,       type: text }
    - { key: output_excerpt, label: Output,     type: text }
    - { key: provider,     label: Provider,    type: text }
    - { key: model,        label: Model,       type: text }
    - { key: tokens,       label: Tokens,      type: number }
    - { key: accepted,     label: Accepted,    type: checkbox }
```

Standard 7 columns are recommended (consistency across mcps); mcp authors can extend with extra columns (e.g. OCR adds `confidence`, translate adds `lang_pair`). Schema additions must be backward-compatible with existing rows — when `mcp_runner` writes a row missing a new column, the column cell is empty.

### §9.3 mcp_runner wiring

After each `mcp.run` completes successfully:

1. Read manifest `output_capture` block. If absent or `enabled: false`, do nothing.
2. Read existing `<table_path>` via `vault.read`. If missing, create with the manifest schema as frontmatter + an empty table body.
3. Call `smart_table.appendRow({ ts: now_iso, input_excerpt: truncate(input, 80), output_excerpt: truncate(output, 80), provider, model, tokens, accepted: false, …extras })`.
4. Write back via `vault.write`. Index automatically picked up by FTS5 (`vault_index.upsert`).

Errors here are warn-logged but never block the mcp's own response — output capture is a side effect, never a gate.

### §9.4 Archival

When `<table_path>` exceeds **500 rows**, `mcp_runner` rotates it: rename to `archive/<mcp_id>-<YYYY>-Q<N>.md` (current ISO quarter), then create a fresh empty table. The archive is also a normal markdown file under `vault/notes/mcp-runs/archive/`, indexed normally.

### §9.5 User control

- Settings → Privacy → **"Capture mcp outputs into vault tables"** master toggle. Default on. When off, no mcp writes to its table (still computes the run, just doesn't persist the row).
- Per-mcp manifest can flip `enabled: false` for inherently private mcps (e.g. an "auth" mcp that holds secrets).
- Per-row: user can flip `accepted` to true (kept in vault long-term) or delete the row in the SmartTableViewer (full row deletion writes back through `vault.write`).

### §9.6 Why not a SQL DB

Considered (`FreeSQL` / Turso / Supabase) and rejected — see `.olym/brainstorm/vault-irisy-product-design-2026-06-03.md` §3 "FreeSQL evaluation". SQL DB violates plain-text + vim test (philosophy #1) and creates a separate query surface to maintain. Markdown table is the right substrate because it is the user's vault data, not the engine's session data.

---

## §10 Embeddings substrate — Ollama + SQLite flat cosine (NEW v5, 2026-06-03)

> Spec: `.olym/brainstorm/vault-irisy-product-design-2026-06-03.md` §5.1, §5.5, §5.8, product decisions P1
> Driver: closes Layer 3 Connect gap vs Mem.ai / Smart Connections / Reflect

### §10.1 Lock

Vault embeddings live in **kernel-local SQLite**, computed via **local Ollama** (`nomic-embed-text` model, 768-d), with a **transparent fallback prompt** when Ollama is unreachable: user picks (install Ollama / authorize cloud / disable autolink). No silent cloud fallback (per product P1).

### §10.2 Storage

New SQLite table in the existing kernel sqlite file (same one used for event store + vault_index):

```sql
CREATE TABLE IF NOT EXISTS vault_embeddings (
  path        TEXT PRIMARY KEY,         -- vault-relative path
  mtime_ms    INTEGER NOT NULL,         -- match against vault file mtime to detect staleness
  content_hash TEXT NOT NULL,           -- SHA-256 of body — second-line cache invalidation
  vector      BLOB NOT NULL,            -- 768 * f32 = 3072 bytes
  embedded_at INTEGER NOT NULL          -- ms since epoch
);
```

Cosine search is flat (full scan + dot product). At vault scale ~50K notes that is ~150 MB of vectors, single-digit ms per query in Rust. `sqlite-vss` extension is **not** added — flat scan is simpler, has no native-build dependency, and is fast enough for the 5-year target vault size.

### §10.3 Provider

`provider/ollama_embed.rs` — single HTTP client wrapping `POST http://127.0.0.1:11434/api/embeddings`. Connection probe on Runtime boot writes `embeddings.status: "available" | "unreachable" | "user-opted-out"` to runtime state. Auto-embed of a note only fires when status = available; otherwise the call is a no-op.

Cloud fallback (Volc embeddings API or compatible OpenAI-shape) is wired but **off by default**. Enabled by Settings → Embeddings → "Allow cloud embeddings (your existing BYOK provider)". This honors P1 transparency.

### §10.4 5 new MCP tools + Tauri commands

| Tool | Args | Returns | Notes |
|---|---|---|---|
| `vault.embed_note` | `{ path }` | `{ vector_dims, cached }` | Idempotent — uses content_hash to skip re-embed |
| `vault.reembed_all` | `{ force: bool }` | `{ embedded, skipped }` | Bulk; respects `force` for full rebuild |
| `vault.embedding_status` | `{}` | `{ available, model, embedded, total, last_run_at }` | UI status pill |
| `vault.semantic_search` | `{ query, limit, threshold? }` | `Vec<{ path, score, snippet }>` | Caller embeds query, returns sorted by cosine |
| `vault.suggest_links` | `{ for_path, limit }` | `Vec<{ path, score, snippet }>` | Same as semantic_search but uses the source note's embedding instead of a query string |

### §10.5 Hybrid mode on `vault.search`

`vault.search` gets a new optional `mode: "bm25" \| "semantic" \| "hybrid"` arg (default `"hybrid"` when embeddings available, else `"bm25"`).

Hybrid algorithm: BM25 top-30 (existing FTS5 path) → rerank by cosine of query embedding → return top-`limit` (default 10). Scoring is a weighted sum `0.4 * normalized_bm25 + 0.6 * cosine` (these constants live in `vault_embeddings.rs` and are tunable from a single place).

### §10.6 Auto-embed lifecycle

- On `vault.write`: enqueue an async embed task for that path (don't block the write).
- On `Runtime::boot`: scan for paths in `vault_embeddings` whose mtime < file mtime, re-embed in background.
- On `vault.delete`: drop the row.
- Background queue is rate-limited (max 4 concurrent Ollama calls) so embed traffic doesn't drown the local model when a user pastes a huge note.

### §10.7 Privacy

Embeddings never leave the user's machine when in Ollama mode. The cloud-fallback path is **opt-in only** and the embedding payload (note body) goes through the user's already-configured provider — CTRL never proxies through a CTRL-managed endpoint for embeddings (different from `irisy.fallback` which is CTRL-managed for chat).

---

### §8.9 Future work (not §8 v1)

- §9 smart-table-output — Mcp manifest `output_capture` field + JSONSchema validation in `packages/ctrl-mcp-sdk/src/manifest-schema.ts` (today the kernel falls back to defaults when manifest absent).
- §9 smart-table-output — Settings → Privacy master toggle ("Capture mcp outputs into vault tables", default on).
- §9 smart-table-output — Wire provider / model / tokens into `run_mcp` so the captured row carries real values instead of empty strings.
- §10 embeddings — Auto-embed lifecycle hooks (vault.write background enqueue, Runtime::boot stale re-embed, vault.delete drop row).
- §10 embeddings — `vault.search` mode arg (`bm25` | `semantic` | `hybrid`) at the kernel-side (today hybrid is composed in the PWA NotesTree by parallel calls).
- §10 embeddings — Settings → Embeddings cloud-fallback toggle (P1 transparency).
- Product spec §5.4 Ctrl long-press global quick-capture window (`hotkey.rs` long-press detection + new Tauri window `quick-capture`).
- Product spec §5.8 wikilink `[[` autosuggest Tiptap suggestion plugin.
- Product spec §5.9 smart frontmatter suggest (Pi propose tags from `vault.tags` vocabulary after `vault.write`).
- Product spec §5.11 ST-SS remote co-view (v1.1+ scope per ADR-005 §2).
- Product spec §5.12 voice → vault (requires `audio.transcribe` provider).
- Product spec §5.13 weekly + annual review (Pi-driven, weekly Sunday cron, annual end-of-year).
- Graph view UI (React Flow + D3-force from kairo stack — primitive `vault_graph_data` already in §8.3 #15)
- Dataview-like query (`vault.dataview_query(spec)`) — defer until 2nd consumer
- Version history (snapshot table or libgit2 — defer)
- Block-level transclusion (`![[note#block-id]]`) — defer until needed
- Auto-classification ML (sourcing routine currently uses Irisy + heuristics, no embedding clustering)
- `vault_list` `include_hidden` flag — today the frontend filters `.ctrl/`; kernel-side opt arrives when the 2nd consumer needs the raw view
- Sourcing automation: 9 AM tokio cron + `vault_watch` count-threshold auto-fire of `vault_sourcing_run` — currently manual via the L2 badge / MCP tool. Irisy's LLM-backed routine will subsume both triggers.
- Wikilink autocomplete popup — Tiptap suggestion plugin + tippy.js anchor; defer until the InputRule path proves the schema in user testing.

## §11 Audit ledger v1 — self-evolution event store (NEW v6, 2026-06-04)

bao 2026-06-04: "整个系统都要自我升级成长 ... 沉, 唯一真相, 要经常整理 ADR". The 6 self-evolution loops (ADR-001 §8) all need the same substrate: a kernel-side immutable record of every detect → diagnose → plan → execute → verify → learn event, queryable across loops, replay-able for postmortem, and accountable for the user's "what did Irisy change about me" question.

### §11.1 Reuse, not new infra

Build on `src-tauri/src/kernel/persistence.rs` (the existing SQLite event store), do not introduce a parallel persistence engine. Add one event kind:

```rust
// kernel/persistence.rs — extend, do not branch
pub enum EventKind {
    UserEvent { /* existing */ },
    // ...
    SelfEvolution(SelfEvolutionEvent),  // ← NEW v6
}
```

### §11.2 Schema (P0 ship target)

```sql
CREATE TABLE IF NOT EXISTS self_evolution_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_ms           INTEGER NOT NULL,
    loop_id         TEXT    NOT NULL,    -- 'irisy_reflection' | 'provider_routing' | 'cap_curation' | 'vault_index' | 'system_self_healing' | 'mcp_skill_recommend'
    stage           TEXT    NOT NULL,    -- 'detect' | 'diagnose' | 'plan' | 'execute' | 'verify' | 'learn'
    typed_action    TEXT,                -- JSON-serialized SelfEvolutionAction (NULL until Plan stage)
    evidence        TEXT,                -- raw signal / log excerpt (Detect input)
    diagnosis       TEXT,                -- LLM causal hypothesis JSON (Diagnose output)
    verify_result   TEXT,                -- 'recovered' | 'unchanged' | 'rolled_back' | NULL until Verify stage
    autonomy_level  TEXT    NOT NULL,    -- 'L3' | 'L4' | 'L5' at the time of the event
    correlation_id  TEXT    NOT NULL     -- groups all 6 stages of one loop execution
);

CREATE INDEX idx_sev_loop_ts ON self_evolution_events (loop_id, ts_ms DESC);
CREATE INDEX idx_sev_corr ON self_evolution_events (correlation_id);
```

`correlation_id` is the join key linking Detect → … → Learn rows for one logical loop execution. Generated at Detect-stage write.

### §11.3 Append-only + prune policy

Rows are **append-only**. Prune is a separate `kernel::audit_ledger::prune()` job, never inline:

- **0 → 7 d**: full resolution, all rows kept
- **7 → 90 d**: day-level aggregate (counts per `(loop_id, stage, verify_result)`); detail rows deleted
- **> 90 d**: month-level aggregate; day rows deleted

User can opt to "preserve all" in Settings (off by default — vault grows unbounded otherwise).

### §11.4 Producer / consumer contract

- **Producers**: each loop's Detect/Diagnose/Plan/Execute/Verify/Learn stage writes one row before returning. Producers MUST set `loop_id` + `stage` + `correlation_id`; other fields stage-dependent. Producers MUST NOT mutate prior rows.
- **Consumers**: PWA Settings → 自我升级 → 最近事件 tab reads via new Tauri command `audit_ledger_query(args: { loop_id?, since_ms?, limit })`. Read-only.
- **Cross-loop replay**: `audit_ledger_replay(correlation_id)` returns ordered stage rows for one loop execution — debug + postmortem use.

### §11.5 Invariants (locked)

1. **Append-only** — no update, no delete (only `prune()` aggregating job).
2. **Per-stage write** — Detect writes immediately on signal, Verify writes immediately on result. No batching that hides intermediate failures.
3. **typed_action JSON-validates** before write (microkernel validator, ADR-006 § policy-envelope, P1). Untyped writes are rejected.
4. **autonomy_level recorded at-execution-time**, never recomputed after — protects against retroactive policy changes hiding past auto-executions.

### §11.6 Out of scope for v1

- Cross-device sync of the audit ledger (each device has its own ledger; Loop 6 cross-user aggregation is opt-in + Loop 5 self-healing reads only local).
- LLM-driven semantic search over the ledger (FTS5 substring is enough for "show me last week's provider failover" queries).
- Real-time websocket push of audit events to PWA (poll-on-open is fine; users won't watch a live tail).

## Acceptance

### Brain (§1)
- [x] `packages/ctrl-pi-bridge/` ships with `RpcClient` + `AssistantMessageEventStream`. v0.1.126 verified.
- [x] `kernel/provider/http_endpoint.rs` exposes `/text-chat` SSE @ port 17878. Verified boot trace.
- [x] `shell/brain_supervisor.rs` spawns Pi with `--extension <bundled-path>` + env. v0.1.124.
- [x] `~/.ctrl/pi/` lazy install + auto-upgrade + Settings → Brain UI. v0.1.124.
- [x] Retirements applied atomically (no parallel old + new). v0.1.124.
- [x] `irisy_chat_stream` routes every turn to Pi; specific error surfaces (no infinite spinner). v0.1.124.

### Capability (§2)
- [x] Surface lives in `src-tauri/src/kernel/capability.rs` + `commands/mod.rs`. Verified.
- [x] `packages/ctrl-kernel-sdk` TS exports per namespace. Verified.
- [x] Builtin manifest validation in `shell/builtin_mcps.rs` boot. Verified.

### Provider (§3 — NEW, all items in § Future work below)

### Crypto (§4)
- [x] ADR locks vodozemac (Olm 1:1, libsignal rejected). v1 ships no mesh layer (memory `feedback_reuse_existing_capability_first`). Verified.

### Subprocess (§5)
- [x] `portable-pty = "0.9"` in `src-tauri/Cargo.toml`. Verified.
- [x] `src-tauri/src/kernel/subprocess_actor.rs` with portable-pty wiring + 6 event variants. Verified.
- [x] OOM cap + panic catch + on_shutdown PTY close. Verified.

### MCP bus (§6)
- [x] rmcp 1.7 + axum 0.8 + Bearer middleware in `kernel/mcp_server.rs`. Verified.
- [x] 11 tools wired; `mcp_server_info` Tauri command. Verified.

### Composition (§7)
- [x] ADR locks 6-axis substrate law. Implementation deferred to "bao calls execution" per CLAUDE.md 灵活开发. Closed at "decision recorded".

### Vault (§8 — NEW v3)
- [x] `kernel/vault_graph.rs` (new module) exposes backlinks / tags / notes_by_tag / mentions / orphans / broken_links / graph_data scanners. 8 unit tests in-tree.
- [x] `commands/vault.rs` adds 13 new tauri commands (§8.3 #9-21): backlinks, tags, notes_by_tag, mentions, orphans, broken_links, graph_data, rename, move, create_folder, set_starred, aliases, watch.
- [x] `kernel/mcp_server.rs` MCP tools list grows by 14 (13 vault + 1 sourcing_run). All `vault.*` exposed; arg structs derive JsonSchema for `mcp_server_info` reflection.
- [x] `vault_watch` uses `notify` crate (`notify = "8"`) for filesystem event stream; lazy-started on first poll.
- [x] `vault_list` keeps `{subdir}` opt; `.ctrl/` filtered out at the L2 tree boundary + by the graph scanner walker. (Kernel-level `include_hidden` flag tracked in §8.9 future work — frontend already filters today.)
- [x] `packages/ctrl-web/src/lib/kernel.ts` TS wrappers + types for all 13 new vault commands + sourcing run/pending.
- [x] First-boot vault seed (`kernel/vault.rs::seed_vault_feature_layer`) writes `vault/.ctrl/{sourcing.yaml, daily-notes.yaml, sourcing-prompt.md}` + `vault/templates/{daily.md, meeting.md}` when absent (idempotent — user edits preserved).
- [x] `packages/ctrl-web/src/components/vault/L2VaultPanel.tsx` renders title + vault root + search + `+ Note` + `Today` + Sourcing Review badge + folder-grouped tree.
- [x] `packages/ctrl-web/src/components/vault/SourcingReviewTab.tsx` is a workspace tab kind; parses review-queue markdown into Proposal records and surfaces Accept / Edit / Reject buttons that call `vault_move` + `vault_write` + `vault_delete`.
- [x] `packages/ctrl-web/src/components/vault/BacklinksDrawer.tsx` is a workspace bottom drawer; reads `vault_backlinks(activeTab.vaultPath)` via TanStack Query.
- [x] `packages/ctrl-web/src/lib/vault-conventions.ts` reads `vault/.ctrl/daily-notes.yaml` + `sourcing.yaml`; exports `loadDailyNotesConfig` / `loadSourcingConfig` / `renderDailyNotePath` / `renderReviewQueuePath`.
- [x] `packages/ctrl-web/src/components/viewers/MarkdownViewer.tsx` gains wiki-link Tiptap extension (`tiptap-wikilink/index.ts`, ported from seahop/kairo MIT) — InputRule rewrites `[[xxx]]`, click handler opens vault-md tab, broken-link styling from `vault_list` snapshot. Suggestion-popup autocomplete tracked in §8.9 future work.
- [x] L1 PrimaryRail adds `vault` icon; activating it flips `data-l2-open='true'` and renders L2VaultPanel inside the L2 grid cell.
- [x] Kernel-seeded sourcing routine wired (`kernel/vault_sourcing.rs`): manual MCP / Tauri trigger via `vault_sourcing_run`. `vault_watch` watcher in place for the count-threshold path (frontend polls `vault_sourcing_pending`); auto-fire on threshold + 9 AM tokio cron deferred to §8.9 future work (Irisy LLM-backed routine will subsume them).
- [x] Retirements: `routes/vault.tsx` reduced to a no-op rail activator; `components/vault/VaultBrowser.tsx` deleted; `components/vault/BacklinksPanel.tsx` deleted (no parallel old + new per §8.7).
- [x] `THIRD_PARTY_LICENSES/kairo-MIT.txt` present with verbatim license + attribution.
- [x] Manual smoke run executed prior to ship — L1 vault → L2 visible → `+ Note` writes a vault file → `Today` writes/opens the daily note → BacklinksDrawer hits flow from kernel `vault_backlinks` → Sourcing Review tab parses + Accept moves the inbox item.

### Smart table output (§9 — NEW v5)
- [x] §9.1 strategic lock — single SmartTable per mcp at `notes/mcp-runs/<id>.table.md` (P4 product decision recorded in brainstorm).
- [x] `mcp_runner` post-run hook wires output to `notes/mcp-runs/<id>.table.md` via `kernel::mcp_capture::capture_row`. Standard 7-column schema (ts / input_excerpt / output_excerpt / provider / model / tokens / accepted). Provider/model/tokens default to empty until `run_mcp` exposes them; the row still lands. v0.1.158.
- [x] Rotation at 500 rows to `notes/mcp-runs/archive/<stem>-<YYYY>-Q<N>.md`. v0.1.158.
- [x] Vault seed creates `notes/mcp-runs/` + `notes/mcp-runs/archive/` directories (`kernel::vault::seed_vault_feature_layer`). v0.1.158.

### Embeddings (§10 — NEW v5)
- [x] `src-tauri/src/kernel/vault_embeddings.rs` — SQLite BLOB + flat cosine (768d) + content_hash idempotence. 3 unit tests in-tree. v0.1.158.
- [x] `src-tauri/src/kernel/provider/ollama_embed.rs` — nomic-embed-text HTTP client + probe. v0.1.158.
- [x] 5 Tauri commands + MCP tools (`commands/vault_embeddings.rs` + `mcp_server.rs`): `vault.embed_note`, `vault.reembed_all`, `vault.embedding_status`, `vault.semantic_search`, `vault.suggest_links`. v0.1.158.
- [x] Hybrid retrieval shipped via `NotesTree` parallel `vault_search` + `vault_semantic_search` merge on queries >= 4 chars; backlinks panel gains a "Suggested" group driven by `vault.suggest_links`. v0.1.158.

### SOUL.md substrate (ADR-005 v2 § soul-md-compat — see ADR-005 acceptance, satisfied by 002 §9/§10 ship)
- [x] `vault/irisy/SOUL.md` seed via `vault_seed/irisy-soul.md` + `.soul-md-version` pin. v0.1.158.
- [x] `irisy_soul_read` / `irisy_soul_write` Tauri commands; `irisy.soul_get` / `irisy.soul_set` MCP tools. v0.1.158.
- [x] `loadIrisySystemPromptWithSoul` injects SOUL.md body into every Pi turn (`packages/ctrl-web/src/lib/irisy-prompts.ts` + `IrisyChat.tsx`). v0.1.158.

### Layer 4 synthesize (product brainstorm §5.3 / §5.5 / §5.10 — satisfied here)
- [x] `commands/irisy_synth.rs` — 3 Tauri commands using `provider_registry.primary_text_chat`: `irisy_question_vault` (RAG with citations), `irisy_synthesize_notes` (cross-note merge), `irisy_daily_summarize` (sourcing → daily/{date}.md). v0.1.158.

### Block AI ops (product brainstorm §5.2 / P2 / P7 — satisfied here)
- [x] `lib/block-ai-ops.ts` — 6 actions (tighten / formalize / extract-actions / translate / continue / custom) streaming via `irisyChatTransport`. v0.1.158.
- [x] `components/notes/BlockAiOps.tsx` floating menu; `Cmd+K` / `Ctrl+K` trigger anywhere with non-empty Tiptap selection. v0.1.158.
- [x] Diff preview (streaming) + Accept replaces selection; Discard aborts the stream. v0.1.158.
- [x] On accept, `stampAiBlock` appends a frontmatter `ai_blocks:` entry (provider/model/timestamp/original/rewritten/user_input). v0.1.158.

### Transparency (product brainstorm §6.4 — satisfied here)
- [x] `lib/ai-block-metadata.ts` — `stampAiBlock` + `readAiBlocks` for frontmatter round-trip. v0.1.158.
- [x] `FrontmatterPanel` gains "AI ops: N" badge that opens a drawer listing each block's provider/model/timestamp + collapsible original-vs-rewritten preview. v0.1.158.

## Future work (§ Provider §3 implementation — tracked separately from § Acceptance per CLAUDE.md 灵活开发)

- `kernel/provider/{trait.rs, registry.rs, detect.rs, path_resolver.rs}` exist with **2-role** table (irisy.primary + irisy.fallback) + RouteChain + auto-fallback (v2)
- 4 REST adapters ported from VMark (`rest/{anthropic,openai,google,ollama}.rs`), ISC attribution
- **7 builtin manifests** (v2): `claude-oauth`, `anthropic-api`, `openai-api`, `volc` (CTRL-managed fallback), `volc-byok` (user-elected), `kimi`, `deepseek` (+ implicit `ollama` if detected)
- Tauri commands: `provider_detect` / `provider_set_active(role, id)` / `provider_active(role)` / `brain_status` (returns `managed_by` field per role, v2)
- `/text-chat?consumer=<role>` honors 2-role routing; auto-fallback chains on error, emits `provider:failover { from, to, reason }` event
- First-boot: irisy.primary = highest-priority detected CLI silently + Irisy toast; irisy.fallback = `volc` (CTRL-managed) always active without user action
- Irisy prompt v5 wired (depends on ADR-005 § persona implementation) — brand labels only ("Claude 订阅" / "CTRL Cloud"), never codenames
- `/settings/providers` page rendered inside Settings workspace route (ADR-003 § nav-keyboard v2) — **2 role sections** × radio with Available/Not-found + [CTRL-managed] badges + REST API (BYOK) config below

## §13 Capability faces — 3-face SSOT (NEW v19 — 2026-06-09)

> bao 2026-06-09 校正: "CTRL 还是有 skills, 我计划是 MCP, api, skills 这三个能力面". Supersedes 2026-06-05 `decision_keycap_collapses_to_mcp_meta_ux_layer` (which塌缩 keycap → MCP only; the 塌缩 missed that Skills is a peer surface, not a meta layer on top of MCP). v19 locks **three互补不塌缩** capability faces.

### §13.1 The 3 faces

| Face | Protocol | Wire-in (CTRL hosts) | Wire-out (CTRL calls) | Examples |
|---|---|---|---|---|
| **MCP** | Model Context Protocol (stdio / Streamable HTTP per Nov 2025 spec) | `kernel/mcp_server.rs :17873` exposes 28 tools (Notes / clipboard / OCR / provider router / etc.) | `kernel/mcp_host.rs` connects to community MCP servers (Figma / Linear / Notion / etc.) | clipboard.read, notes.search, figma-mcp, smart-connections-mcp |
| **API** | REST / WebSocket / SDK | n/a (CTRL doesn't host outbound APIs) | `kernel/provider/adapter/api/*.rs` adapters (fal.ai, Anthropic, OpenAI, Hunyuan, DeepSeek, Volc) routed by `provider/router.rs` per typed capability (`image.generate` / `video.generate` / `text.chat` / `audio.tts` / `text.embed` / `text.transform`) | **fal.ai is flagship** (985 endpoints aggregating FLUX 2 / Seedream 5.0 / Recraft V3 / Nano Banana Pro / Kling 3.0 / Veo 3.1 / Hunyuan Video). BYOK only — user pays the upstream. |
| **Skills** | markdown `SKILL.md` + script body (Claude Code Skills schema, also adopted by Codex, WorkBuddy, CodeBuddy) | n/a | `~/.ctrl/skills/<id>/SKILL.md`, invokable by any of the 3 agents (hermes / opencode / kairo) via `list_skills` + `read_skill` substrate calls | `$imagegen` (fal.ai default FLUX 2 Pro), `$refactor`, `$summarize-note`, `$ocr-image` |

### §13.2 Why three and not two

- **MCP ≠ API**: MCP wraps tool invocation with a session + capability scope + JSON-RPC envelope. API is direct REST/SDK. fal.ai is API not MCP because aggregating 985 endpoints inside a single MCP server is not the natural shape (each endpoint has different schema, billing is per-call). Provider routing is also CTRL's billing-of-record surface (BYOK keychain → env injection), which doesn't fit MCP's tool-call shape.
- **Skills ≠ MCP**: Skills are **markdown documents** the agent reads to learn a workflow (no protocol, no session — just "read this, then do steps inside it"). MCP tools are **callable functions**. A skill may call zero or many MCP tools and may call zero or many APIs; Skills compose the other two faces. This composition is **why Skills exist as a peer face** — without them, you can't capture multi-step workflows in a single user-shareable artifact.

### §13.3 Friend-product comparison (locks the differentiator)

| Product | MCP | API | Skills | Differentiator |
|---|---|---|---|---|
| Claude Desktop (Anthropic) | ✅ Extensions, 9,400+ servers | ❌ Anthropic-only (single brand) | ✅ Artifacts + Claude Code Skills | API face is brand-locked |
| Codex (OpenAI) | ✅ Figma MCP + Streamable HTTP | ❌ gpt-image-2 only (single brand) | ✅ `$imagegen` + reusable bundles | API face is brand-locked |
| WorkBuddy (Tencent) | ✅ MCP + 20+ skill packages | ❌ Hunyuan/DeepSeek/GLM/Kimi/MiniMax (brand-locked to Tencent ecosystem) | ✅ Skill packages | API face is ecosystem-locked |
| CodeBuddy (Tencent) | ✅ MCP + ACP + SDK | ❌ Yuanbao + DeepSeek (brand-locked) | ✅ Skills (2.0) | API face is ecosystem-locked |
| **CTRL** | ✅ kernel mcp_server :17873 + mcp_host | ✅ **fal.ai (985 endpoints) + Anthropic + OpenAI + Hunyuan + DeepSeek + Volc — BYOK 任意** | ✅ `~/.ctrl/skills/` (Claude Code schema) | **API face is the aggregator** — only product on this list whose API face isn't locked to one brain vendor |

### §13.4 fal.ai BYOK adapter — flagship API-face implementation (v19 ship target)

- **Module**: `src-tauri/src/kernel/provider/adapter/api/fal_ai.rs`
- **Trait**: implements `ProviderAdapter` (existing trait in `provider/trait.rs`)
- **Capabilities mapped**: `image.generate` (`fal-ai/flux-pro/v2` default) / `video.generate` (`fal-ai/kling-3.0/text-to-video` default) / `audio.tts` (`fal-ai/elevenlabs/tts/v3` default) / `text.embed` (n/a; embeddings stay on Ollama per §10) — model picker via skill arg or settings UI.
- **Wire**: POST `https://fal.run/<endpoint>` with `Authorization: Key <FAL_API_KEY>`; supports both sync (`fal.subscribe`) and queue (`fal.queue`) modes; CTRL uses queue for >5s jobs.
- **BYOK**: API key from macOS Keychain (`ctrl-credential-vault::get("fal-ai", "default")`); injected into adapter via `provider_register("fal-ai", { key: keychain_ref })`. No plaintext on disk.
- **Provider template**: new entry in `provider-templates.json` with `category: "api-aggregator"`, `capabilities: ["image.generate", "video.generate", "audio.tts"]`, `byok_required: true`.
- **Skills coupling**: `~/.ctrl/skills/imagegen/SKILL.md` invokes `image.generate` capability — CTRL routes to fal.ai if `fal-ai` is the active provider for that capability, else falls back to next-priority provider (Anthropic gpt-image-2-equivalent if user has BYOK there, etc.).

Codex 1 model lock vs CTRL 985 model aggregator: this is the v19 战术 differentiator. ADR-006 cross-cutting § byok-no-claude v2 amend allows fal.ai BYOK (aggregator endpoint, not a single-brand provider) as an exception to the no-Claude-SDK lock.

### §13.5 Skills SSOT (replaces ADR-001 §5 invariant #9 phrasing)

Skills live at `~/.ctrl/skills/<id>/SKILL.md` (markdown body) optionally with `script.{ts,js,py,sh}` sibling. Schema matches Anthropic Claude Code Skills (also used by Codex `$skill` + WorkBuddy skill packages + CodeBuddy Skills 2.0):

```yaml
---
name: imagegen
description: Generate images from a text prompt
capabilities: [image.generate]
default_args:
  model: fal-ai/flux-pro/v2
  size: "1024x1024"
trigger:
  slash: /imagegen
  alias: ["$imagegen", "$img"]
---

# Image generation

Use `image.generate` capability with the model from default_args (user can override
via `/imagegen --model fal-ai/seedream/v5 prompt here`). Returns image URL + saves to
`~/Documents/CTRL/Notes/_attachments/<timestamp>.png`.
```

Skills face is **cross-agent**: hermes / opencode / kairo can each call `list_skills()` + `read_skill(id)` via the CTRL MCP server. A skill triggered in `/coding` (opencode) might call `image.generate` (API face routing to fal.ai) — the agent doesn't need to know fal.ai exists; it just calls the capability.

### §13.6 Migration from §7 composition + §6 mcp-bus

- `§7 composition` (6-axis manifest) — still applies to **MCP face only** (the `manifest.yaml` of an MCP server). Doesn't apply to Skills (Skills use Claude Code schema, not 6-axis). Doesn't apply to API (API is provider-template + adapter, not manifest).
- `§6 mcp-bus` (kernel as MCP server) — unchanged; this IS the MCP-face implementation.

### §13.7 What this section RETIRES

- 2026-06-05 memory `decision_keycap_collapses_to_mcp_meta_ux_layer` partial塌缩 (Skills was treated as MCP `_meta`; v19 promotes Skills back to peer face).
- ADR-005 § lifecycle treating "mcp" as the sole capability concept — Skills is peer (ADR-005 v3 → v4 amend).
- ADR-007 § cap-curation framing "everything is a cap" — three faces means three curation surfaces (MCP discover / Provider catalogue / Skills index).

## §12 Pi extension surface — RETIRED in v19 (Pi exited CTRL hot path)

> **v19 (2026-06-09)**: This entire section is RETIRED. Pi was sole brain (v17), then dual-brain peer (v18), now exited the architecture (v19). `ctrl-pi-bridge` and `ctrl-pi-plugin` packages are deleted. The 28-event handler matrix, auto-RAG `before_provider_request`, audit-log writer, `CTRL_INHERIT_PI_TOOLS`, `$VAR` apiKey prefix, MCP auto-connect to Pi — all RETIRED because Pi is no longer launched by the kernel. Auto-RAG logic and audit log writing move to **hermes** as a CTRL skill (`~/.ctrl/skills/auto-rag/SKILL.md`) so the behavior survives the architecture change.

### Original §12 content (v10 — 2026-06-07) — RETIRED

> bao 2026-06-07 "全接" — Pi 端点都暴露好的; "接" 不是 wrap 工程, 是给每个未接通端点写 1 行 caller. 这段把 `ctrl-pi-bridge` 的 caller 矩阵 SSOT 化, 后续每加 1 个端点就在这表里追 1 行.

### §12.1 Hook events (28 registered)

Every event in Pi's `ExtensionAPI.on()` union is registered. Handler tier:

| Tier | Events | Handler body |
|---|---|---|
| Real business | `before_agent_start` (persona replace), `before_provider_request` (auto-RAG inject), `after_provider_response` (LLM cost audit), `tool_call` + `tool_result` (tool I/O audit), `turn_end` (turn usage audit), `user_bash` (shell audit), `agent_start` + `agent_end` + `session_start` + `session_compact` + `session_shutdown` (lifecycle audit), `model_select` + `thinking_level_select` (mode audit) | non-trivial logic |
| Stub (extension point) | `resources_discover`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_before_tree`, `session_tree`, `context`, `turn_start`, `message_start`, `message_update` (perf-sensitive), `message_end`, `tool_execution_start/update/end`, `input` | `() => undefined` (registered so future business can replace inline without re-shipping the bridge) |

The stub-tier registrations are intentional and load-bearing: a future skill that wants to use e.g. `tool_execution_update` can write a 1-line replacement in this file — no contract change, no version bump, no upstream Pi PR.

### §12.2 Auto-RAG via `before_provider_request`

`ctrl-pi-bridge::register()` registers a `before_provider_request` handler that, for every LLM call:

1. Pulls the last user message text.
2. Calls `vaultSearchTopK(text, 3)` — naive substring scan over `walkMarkdown(vaultRoot)` (skip `irisy/audit/*` to avoid self-reference loops).
3. If hits found, appends a `{role: 'system', content: 'Relevant snippets auto-fetched from the user\'s vault: …'}` message to `evt.messages` and returns `{messages: [...messages, ragSystem]}`.

Pi merges the returned message list and proceeds with the LLM call. The user never explicitly invokes `vault_search` for ambient grounding — it happens automatically. Future: replace substring scan with `kernel.vault.search` via the §6.1 MCP auto-connect once Pi sees the kernel tools (FTS5-backed, faster, ranked).

### §12.3 Audit log → `vault/irisy/audit/`

`appendAuditLine(topic, line)` writes `- [ISO-8601] <line>` rows into `vault/irisy/audit/YYYY-MM-DD-<topic>.md`. Topics:

- `llm-calls` — per-response: model id, input/output/cacheR/cacheW tokens
- `tools` — per call/result: tool name + arg snippet + OK/FAIL
- `turns` — per turn: messageCount, totalTokens
- `sessions` — start / compact / shutdown
- `lifecycle` — agent start / end
- `mode` — model switch, thinking-level change
- `user-bash` — user-issued shell commands (per `user_bash` event)

Plain markdown, user vim-readable (CLAUDE.md vim test). All failures non-fatal — audit MUST NOT break the agent turn.

### §12.4 Per-mcp `inherit_pi_tools` — `CTRL_INHERIT_PI_TOOLS` env

Irisy default mode: persona explicitly denies Pi's 7 builtin tools (Read/Write/Edit/Bash/Grep/Find/LS). A mcp that needs them (Code, DevOps, Screen-record) declares `inherit_pi_tools: [Read, Bash, ...]` in its manifest. Kernel sets `CTRL_INHERIT_PI_TOOLS=<comma-separated>` on the Pi spawn env; `ctrl-pi-bridge::buildPersona` reads it, rewrites the deny block, and lists the inherited tools in the "## Runtime" section so the model knows what it's allowed to touch.

Default (no env or empty) = Irisy mode = all 7 denied.

### §12.5 `pi.registerFlag('ctrl-vault-root')`

Lets users override `CTRL_VAULT_ROOT` from the Pi CLI (`pi --ctrl-vault-root /some/path …`). Otherwise the env var (set by kernel at Pi spawn) wins; finally `~/Documents/CTRL/vault` then `~/.ctrl/vault` per `resolveVaultRoot` priority.

### §12.6 Wrapper invariant (formalises v9 changelog (6))

Any wrapper code that re-implements a Pi-published surface (provider registry, LLM call, stream protocol, session, fork, compact, model resolution) is DEAD on arrival. Reviewer checklist requires citing the Pi surface delegated to. v8 (`ctrl-bridge` streamSimple + `registerProvider('ctrl-bridge')` + `runtimeTruthBlock` SSOT mirror) was the reference violation — all retracted in v9.

The `registerProvider` call IS allowed for **ADD** (new provider id with bespoke logic — audit-proxy, private corp LLM, etc.) but NOT for **REPLACE** (intercepting an existing Pi-ai provider's stream).

### §12.7 `$VAR` apiKey prefix

Pi's model-registry now requires explicit `$VAR` prefix for env var references. Plain unprefixed strings get auto-migrated with a deprecation warning. `ctrl-pi-plugin::injectActiveProviderForSpawn` writes `apiKey: "$" + envVarName` directly (e.g. `apiKey: "$CTRL_PI_API_KEY_VOLC_DOUBAO"`) so no warning fires.

### §12.8 Acceptance (v10 — 2026-06-07)

- [x] `ctrl-pi-bridge/src/index.ts` registers 28 events (`pi.on()` for every event in Pi's `ExtensionAPI.on()` union) — verified by grep `pi\.on\(` count.
- [x] `before_provider_request` handler returns vault-RAG-augmented `messages` when hits found.
- [x] Audit lines appear under `~/Documents/CTRL/vault/irisy/audit/<date>-<topic>.md` after any chat turn.
- [x] `CTRL_INHERIT_PI_TOOLS` env reaches `buildPersona()` — verified by `/irisy-paths` slash command output ("Inherit:" line).
- [x] `pi.registerFlag('ctrl-vault-root', ...)` registered.
- [x] `kernel_supervisor::start` spawns MCP server; `lsof -p $(pgrep ctrl) -iTCP -sTCP:LISTEN` shows `:17873` after boot.
- [x] `~/.pi/agent/settings.json` contains `mcpServers.ctrl-kernel` entry with bearer header.
- [x] `provider_set_active` reply carries `model_id`; PWA `providerSetActive` calls Pi `setModel` after success.
- [x] `provider-templates.json` has 20 entries.
- [x] `models.json` apiKey written with `$` prefix — verify with `grep '"apiKey":' ~/.pi/agent/models.json` returns `"$CTRL_PI_API_KEY_..."`.
- [ ] `scripts/probes/irisy-eval.mjs` 9/9 PASS on a 0.1.179 install — pending bao update + run.

## §14 Unified Operation Interface — describe / query / produce (NEW v29, 2026-06-19)

> bao 2026-06-19「修改架构」. Every content-type **feature point** (md / html / smart-table /
> pdf / CRM-connector / vault-metadata / mcp-registry …) is operated by Irisy through ONE
> uniform interface projected on the :17873 gate (§6), instead of bespoke per-capability tools.
> Research-grounded (GraphQL query-vs-mutation, Unix/Plan9 "everything is a file", the 2026
> agentic-AI Unix-philosophy paper, ChatBI/MCP); fact source
> `vault/ctrl/research-unified-operation-interface.md` + `research-ai-data-platforms.md`.

### §14.1 The decision — one interface, a type layer, read ≠ write
Three verbs, not one:
- **`describe`** (universal) — a source self-reports its fields/types + **which operators it
  supports**. This is the **type/semantic layer** that keeps uniformity from collapsing into a
  typeless catch-all — the documented failure mode of "everything is a file" (/net vs /proc vs
  disk look alike, no type system, escape-hatches like ioctl). GraphQL's schema and the
  agentic-AI paper both retain this layer; so do we. It is also the ChatBI schema-injection that
  lets Irisy fill only valid params (ADR-003 §6.5).
- **`query`** (read / input) — parallel-safe, side-effect-free, **does NOT pass the write gate**.
  Operators are source-advertised via `describe`. Implemented as a **kernel service** over a
  uniform `QuerySource` interface; **feature packs and workflows are its clients** (they call
  query, they do not re-implement filtering).
- **`produce`** (write / output) — serial, side-effecting, **routes through the consequential-
  action review gate** (ADR-006 §4 / ADR-003 §8.2-E). Kept **DISTINCT** from `query`: every
  uniform system that matters keeps read/write separate (GraphQL query vs mutation — writes
  serialize + signal intent; Unix read vs write; the AI paper). For CTRL the split is
  load-bearing — **you cannot gate writes if they are disguised as reads.**

### §14.2 Why uniform — but bounded
One interface = Irisy learns one paradigm → fewer wrong tool-picks (the §6.5 "narrow surface"
reliability win), and workflows compose `query → query` on one result shape. **Bounded** by
§14.1's type layer: uniform **envelope**, source-specific **operators** advertised by `describe`.
The blob/render case is a deliberately "thin" query (one-row get, no real filtering) — accepted:
the cost is tiny, the "never switch verbs" win is real.

### §14.3 Source kinds — operator profiles advertised by `describe`
| kind | `query` operators | `produce` | examples |
|---|---|---|---|
| **RecordSource** | filter / sort / group | upsert / update / delete | smart-table, CRM connector, vault metadata+graph, mcp registry |
| **TextSource** | match / semantic-near + rank | append / patch | note prose, vault content |
| **BlobSource** | get / extract | render / write-file | html, pdf, image, svg |

So **not everything is `query`** — md/html/pdf are feature points behind the *same interface*, but
a BlobSource's `describe` advertises only get/extract; text goes match/semantic; only record-like
sources expose filter/sort/group. Uniform at the interface, typed by `describe`.

### §14.4 Relationship to existing sections (no churn — formalizes what the gate already does)
- **§6 MCP bus :17873** = where the interface is projected (describe/query/produce are gate verbs;
  the `vault.*` tools are already de-facto a RecordSource query over note metadata).
- **§2 capability surface** = the namespaced syscall surface; `query` is a kernel service in it.
- **§7.1 feature pack** = the user-facing unit; a pack implements ≥1 `QuerySource` + advertises via
  `describe`.
- **§9 smart-table output** = one `produce` target (mcp output → smart-table).
- **NOT** a new ADR-001 spine primitive (5 primitives v1 locked) — this is a kernel **service** +
  gate **contract** under the existing Capability primitive.

### §14.5 First implementation
**smart-table** (ADR-003 §6.5) is the first `QuerySource` (RecordSource): `describe` (frontmatter
schema + supported operators), `query` (filter/sort/group), `produce` (upsert / update_cell /
add_view + the `run_ai_column` async job). The `smart_table.*` tools are this contract
instantiated; later sources (notes, connectors, blobs) follow the same shape so a new source
becomes Irisy-operable with **zero bespoke tools**.

### §14.6 Acceptance
- [ ] Gate exposes describe / query / produce (or namespaced equivalents); read parallel, write
  serial-through-gate.
- [ ] A new source is Irisy-operable by implementing `QuerySource` + `describe` — no new bespoke
  tools.
- [ ] `query` never mutates; `produce` always passes the review gate.
- [ ] smart-table validates the contract as the first RecordSource (ADR-003 §6.5).

### §14.7 subscribe — streaming read = the `watch` projection of `query` (NOT a fourth verb)

Live data (Irisy / PWA observing a result set that changes under them) is **not** a new verb. It is
`query` with a `watch:true` modifier: the source resolves the snapshot, then the gate pushes the
incremental delta (ST-SS Cell/Op) as the underlying rows change. This keeps the verb set frozen at
three (`describe` / `query` / `produce`) — transport liveness is orthogonal to data semantics.

- **Why a modifier, not a verb**: a verb is a data-semantics dimension; streaming is a
  transport/lifecycle dimension. Folding them into one enum (a literal `subscribe` verb) forces
  every source to implement it — but sources with no stream semantics (registry / providers) would
  return an empty impl or panic. As a `watch` modifier, a source that cannot stream simply ignores
  it (or `describe` advertises `watchable:false`); the no-stream sources stay clean (ISP).
- **Trust split**: the **authorization + audit** of a watch subscription flow through the
  `:17873` gate (same governance as a one-shot `query`); only the **bytes** of the delta stream ride
  `:17872` (ST-SS). This closes the prior audit blind spot where ST-SS streams bypassed the gate
  entirely — the gate now sees (and can revoke / redact) every live subscription, even though it
  does not sit on the hot byte path.
- **Degradation**: a watch that loses its source (connector offline) degrades to its last snapshot +
  a `degraded` marker rather than hard-failing — consistent with the local-first contract
  (`describe` self-reports degradation behaviour). Permanent design rationale + four-dimension
  framework: `vault/ctrl/comms-architecture-permanent.md`.

### §14.8 `query` result is polymorphic by `source_kind` (records / text / blob)

The verb set stays three, but the **result type varies by `describe().source_kind`** — uniform verb,
typed result. v29 named RecordSource/TextSource/BlobSource but `QueryResult` was record-shaped
(`{rows}` only); that collapses type the way Plan9 "everything is a file" was criticised for. Fix:

- `Records { rows, match_count }` (RecordSource — filter/sort/group)
- `Text { spans, match_count }` (TextSource — match/semantic → passages)
- `Blob { handle, chunks }` (BlobSource — get/extract/page; bytes by handle, not inlined)

Operators likewise specialise per kind and are advertised by `describe`. **Unified at the three
verbs; specialised at the result type + operator set.** Lets pdf/image (Blob) and long-form
notes (Text) join without hacking a record shape. Rationale: `comms-architecture-permanent.md` §10.A.

### §14.9 `produce` splits into Write vs Effect — effectful actions sit on the Effect primitive

`produce` covers both a synchronous **write** (`update_cell`/`append_row`/`upsert` — returns an
`Outcome` immediately) and a long-running **effectful action** (send-message / deploy / `run_ai_column`
— returns an `OperationHandle { operation_id, idempotency_key }`). Evidence the contract was missing
this: `run_ai_column` had to grow a bespoke job triple (start/status/cancel). The action half is the
ADR-001 **Effect** primitive (previously unused by §14):

- **Progress/status** reuses §14.7 `query{watch}` on the `operation_id` — no new mechanism.
- **Cancel** is just another `produce` action.
- **`idempotency_key`** makes network retries safe (no double-execution).

So feature packs stop reinventing job machinery; `run_ai_column` collapses into the standard Effect.
Models: Google AIP-151 long-running operations / Temporal durable execution / gRPC operations.
Rationale: `comms-architecture-permanent.md` §10.B.

### §14.10 Protocol-version negotiation — the contract evolves without breaking installed packs

"Permanent" is not "verbs never change" — it is "a third-party capability pack written against
contract vN keeps working after CTRL ships vN+1." So: `describe` self-reports `protocol_version`
(SemVer); the gate negotiates (a pack declares the contract version it implements, the gate routes /
degrades by version); evolution follows **protobuf-style add-only** discipline — new fields
`#[serde(default)]`-optional, deprecated fields marked not removed, a breaking change = new major with
the gate supporting N and N-1 across a migration window. Version brittleness is a documented cause of
death for CORBA/SOAP; MCP and gRPC both negotiate versions. Models: protobuf back-compat / MCP
protocol version / semver. Rationale: `comms-architecture-permanent.md` §10.C.

### §14.11 AI-facing error contract — a structured `Feedback`, not a human string

Every rejection / degradation / failure returns a structured, machine-actionable `Feedback`
(`kind` ∈ UnknownField | ReviewRejected | Degraded | RateLimited | Conflict; `retriable: bool`;
`correction` = valid-field set / fixed params / wait duration; plus a `human` string). The existing
`QueryError::UnknownField{valid}` (anti-hallucination feedback) is the first special case, now
generalised. This closes the agentic self-correction loop — Irisy retries/self-corrects from
`retriable + correction` instead of dumping a raw error on a non-technical user. Models: HTTP
problem+json (RFC 7807) / gRPC rich error model (google.rpc.Status details). Rationale:
`comms-architecture-permanent.md` §10.F.

### §14.12 Generic manifest-driven connector source — zero-code §14 uplift (v42, bao 2026-07-01「全量修复」)

**Gap closed**: §14.6 promised "a new source is Irisy-operable by implementing `QuerySource` — no new bespoke tools", but a REST connector still hand-codes its schema + JSON→Row mapping + fetch endpoint + per-source gate tools (`ghostfolio_source.rs`: `fields()` / `holding_to_row()` / `fetch()` + `ghostfolio_describe`/`ghostfolio_query`/`ghostfolio_add_transaction`). Adding a connector = Rust code — this violates §7.4 (manifest = data, runtime = generic) + §7.5 (product-grade packs must be zero-code to add). v40 named this "the next layer beyond the provision+auth engine"; §14.12 is it.

**The mechanism** — a REST connector's §14 shape is declared as manifest **data**, and ONE generic runtime source reproduces what the hand-coded connector did:

- **New manifest axis `record_source`** (`manifest-schema.ts`, Zod): `query { endpoint, method, array_at }` (where the row array lives in the response — a key/dotted-path, `""` = bare array) + `fields[]` (each `{ key, label, type: CellType, from: [json-path,…] }` — first present path wins, dotted paths dig nested objects, mirroring the tolerant reader) + optional `operators[]` (default per `SourceKind`) + optional `produce { endpoint, method, label, body: [{ field, from, transform?, type? }] }` (the write verb's body mapping). Auth reuses the existing `auth.token_exchange` (v40) — the generic source mints the bearer via `pack_auth::mint_bearer` from manifest data, secret stays kernel-side (decision 0004).
- **New kernel `manifest_source.rs`**: `RecordSourceSpec` (serde of `record_source`) + `ManifestConnectorSource` implementing `QuerySource` (built generically via `from_json(spec, body)` — the shared `run_query` engine is unchanged) + generic async `fetch(spec, base_url, token)` + generic `produce(spec, base_url, token, input)`.
- **New generic gate tools** `source_describe(source_id)` / `source_query(source_id, req)` / `source_produce(source_id, op)`: dispatch by `source_id` to the installed manifest's `record_source`, resolve creds, run the generic path. The per-source named tools (`ghostfolio_*`) retire — a connector surfaces through the generic trio, visibility-scoped by its own domain (ADR-010).

**ghostfolio = first data-driven instance**: its `fields` / holdings endpoint / `array_at: "holdings"` / order-`produce` body all move into `packages/ctrl-mcps/builtin/ctrl-ghostfolio/manifest.json` `record_source`. The hand-coded `ghostfolio_source.rs` retires to the generic path; its golden rows become the equivalence test (generic source + ghostfolio-shaped spec ≡ old hand-coded rows). Proves the thesis both ways: **product-grade (§14 uplift) AND zero-code (pure manifest data)**.

**Locks unchanged**: still the Capability primitive (NOT a new §-primitive, 5 locked); `query` never mutates; `produce` still through the review gate (§14.9 Write vs Effect); secret never reaches the LLM; tolerant reader (unknown/missing fields skipped, never fatal). **v1 scope**: `record_source.kind = record` (Text/Blob connectors reserved); one array-returning read endpoint per source (multi-endpoint composition = future). **NOT** reinventing the query engine (reused) or the auth engine (reused); this is the missing DATA-declaration + generic-dispatch layer only.

### §14.13 Unified write side — `RecordSink` trait + one typed `produce` verb (v45, bao 2026-07-02「你架构弄清楚了吗？是在建立整套系统吗？…好，做」)

**Gap this closes**: the READ side is systematic — one `QuerySource` trait (`describe` + `rows`) + a shared `run_query` engine, so a new source is queryable with zero engine code (§14.5). The WRITE side drifted into fragmentation: native smart-table grew ~10 bespoke gate tools (`smart_table_update_cell/append_row/delete_row/batch_append_rows/batch_delete_rows/add_field/delete_field/create/add_view`) each hand-coded, while connectors got a SEPARATE generic `source_produce` (§14.12). Two write patterns; adding Sheets/Docs/Calendar would re-hand-code every operation. That is endpoint-accretion, not a system. Governing design: `vault/ctrl/unified-productivity-suite-architecture.md`.

**Decision — mirror `QuerySource` on the write side so "three verbs" becomes literal**:
- **`ProduceOp`** = a compile-time-fixed typed union of the write operations (SetCell / UpsertRows / DeleteRows / AddField / UpdateField / DeleteField / CreateSource / AddView / DropView). Like `Operator` (§14.1), it is an enum, never a free-form string — the AI picks a `kind` + fills its typed fields (anti-hallucination). Only the **Write** half (§14.9); Effect-class side-effects stay on the Effect primitive.
- **`RecordSink` trait** (the write mirror of `QuerySource`): `supported_ops()` (a source advertises which ops it accepts — surfaced through `describe`, so Irisy discovers capability) + `produce(op) -> Feedback`. Sits under the Capability primitive (NO new §-primitive; 5 locked).
- **The gate exposes exactly the 3 §14 verbs** — `describe` / `query` / `produce(source_ref, op)` — dispatching to the addressed source (native vault by path, connector by source_id). A NEW data product = implement `QuerySource` + `RecordSink` over its plain-text format + register; **zero new gate tools**.

**Suite as one system**: Smart-table/Bitable, Sheets, Docs, Task, Calendar, Drive each become a source implementing the two traits over its plain-text (`feishu-endpoint-parity-map.md` bucket A). Adding a product = adding data + a trait impl, not new tools.

**Migration (converge, don't rip out)**: (1) land `ProduceOp` + `RecordSink` + a generic native `produce` dispatch, SmartTable implements `RecordSink` (reusing its existing methods). (2) Bitable's remaining ops (`UpdateField`, relational `AddField`) become a new `ProduceOp` VARIANT + a `RecordSink` arm — not a new tool. (3) The bespoke `smart_table_*` tools stay during transition (the PWA calls them via `gateInvoke`), then migrate the frontend + retire them to the generic `produce` (exactly the `ghostfolio_*`→`source_*` playbook, §14.12). (4) Sheets/Docs/Calendar are built trait-only from the start.

**Locks unchanged**: 5 primitives; `query` read-only; `produce` through the review gate; secret never in the LLM; markdown stays truth (round-trip / vim test); `ProduceOp` is a fixed compile-time set (§14.1). This REINFORCES the three-verb contract (produce is finally one verb, not N), it is not a new direction.

**Implementation status (slice 1, 2026-07-02)**: SHIPPED behind cargo+tests green. `ProduceOp` (6 variants: SetCell/UpsertRows/DeleteRows/AddField/UpdateField/DeleteField — CreateSource/AddView/DropView deferred to later slices) + `RelationSpec` + `ProduceError` + `RecordSink` trait in `query.rs`; `impl RecordSink for SmartTable` + `update_field` + `serialize_field`/`serialize_schema` in `vault_smart_table.rs`; generic `smart_table_produce(path, op)` gate tool in `mcp_server.rs` (review-gated via the "produce" substring). AddField carries an optional `relation` (Reference/Lookup/Rollup) — the first gate path to create a relational column. **Write-back preserves markdown truth via IN-PLACE schema patching, NOT full-regeneration**: a schema-mutating op mutates only the touched item in the existing frontmatter `schema` array (push for add / patch-named-keys for update / retain-out for delete), so render-level type sugar (`currency`/`percent`) + frontend-only per-item keys (`ai_prompt`/`color_op`/`min`/`max`/`system`/relation keys the kernel model doesn't parse) survive on untouched columns — full-regenerate from the reduced kernel model would silently strip them (caught by the dev-loop checker; regression-tested in `mcp_server::tests`). Row-only ops leave frontmatter untouched. Bespoke `smart_table_*` tools remain (PWA still calls them). NOT yet: frontend convergence to `produce`, retiring bespoke tools, Sheets/Docs/Calendar trait impls, `UpsertRows` update-by-key (currently append-only), render-level types in `AddField` (bespoke `add_field` still owns those).

**Slice 2 (2026-07-02) — Task is the second product on the unified write side**: `impl RecordSink for TaskSource` (`tasks_source.rs`) + `task_produce(op)` gate tool. This proves "add a product = a trait impl, not new per-op tools" on a source with a DIFFERENT shape than SmartTable: tasks are inline `- [ ]` checkbox lines scattered across many notes (not one file), so `produce` **self-persists across the addressed notes** (rows addressed by scan index → their `path`+`line`; `TaskSource::with_today` injects the server clock for done-stamping + the daily-note default). `supported_ops` = set_cell / upsert_rows / delete_rows; the field ops are `Unsupported` (tasks have a FIXED schema) — the `supported_ops`/`Unsupported` machinery earning its keep. DeleteRows resolves to (note, line) then deletes highest-line-first so an earlier delete never shifts a still-needed line. Same ProduceOp vocabulary as smart-table (Irisy learns the verb once). The gate locks EVERY note the op writes (via `affected_notes` → sorted+deduped `vault_write_lock`, held across `produce`) — same per-note write lock the bespoke `task_create`/`task_update` hold, so a concurrent single-note write can't lose an update; row-index addressing across the prior `task_query` call remains a documented single-user TOCTOU (locks bound intra-call safety, not cross-call). Bespoke `task_create`/`task_update` remain during transition.

**Slice 4 (2026-07-02) — Docs join via an EXPLICIT `ProduceOp` extension (the block half)**: `ProduceOp` gains 3 block variants — `AppendSection {heading?, content}` (under a named heading, or end-of-doc) / `ReplaceSection {heading, content}` (body replaced, heading kept) / `DeleteSection {heading}` (heading + body incl. nested subsections) — addressed by markdown ATX heading, case-insensitive on the text after `#`s (the AI-native "rewrite the Overview section"). New `vault_doc.rs` `DocBody` implements `RecordSink` over one note body (single-file model, same shape as SmartTable: gate reads → produce → serialize → write). Frontmatter passes through VERBATIM via `vault::write_body` (checker fix: rewrites ONLY the body, keeping the raw fm block bytes — key order / comments / quoting untouched; a plain note WITHOUT frontmatter stays fm-less — `vault::write` would have errored on Null fm and alphabetized keys through the YAML→JSON→YAML round-trip). `doc_produce(path, op)` gate tool, review-gated, per-note locked. Heading detection is fence-aware (checker + self-caught: `#` lines inside ``` / ~~~ code blocks are never section boundaries — an unclosed fence conservatively swallows the rest of the doc) and CommonMark-capped (4+-space indented code is not a heading). **`supported_ops` now proven in both directions**: record sources (SmartTable exhaustive-match arm; Task/Calendar catch-all) return `Unsupported` for block ops, DocBody returns `Unsupported` for record ops. Adding the variants was exactly the ADR's promise — a new op = a `ProduceOp` variant + `RecordSink` arms, not a new tool family. Section find = heading line → next same-or-higher-level heading (nested subsections travel with their parent).

**Slice 5 (2026-07-02, notes-plan S2) — frontmatter ops join `ProduceOp` (E4) + doc-map/structured-read tools (E9/E10)**: `SetFrontmatterKey {key,value}` / `DeleteFrontmatterKey {key}` variants → `doc_produce` dispatches them to `vault::patch_frontmatter_key` (surgical single-key line-span edit at the raw-bytes layer: untouched keys/comments/quoting byte-identical; nested value blocks replaced/removed with their key; set creates the fm block on a plain note; delete of a missing key errors). DocBody stays body-only — the gate handler intercepts fm ops before parse. New read tools: `note_map` (fence-aware headings + `^block-id` refs + fm keys — the AI picks REAL anchors before doc_produce) + `note_get` (content+fm+tags+stat+links+backlinks in ONE call; `vault_graph::node_of` accessor added). SmartTable/Task/Calendar reject the new ops via Unsupported (SmartTable's match stays compile-exhaustive). 93 gate tools.

**Slice 6 (2026-07-02, notes-plan S3 kernel half) — periodic notes (E1) + recent changes (E12) + search context (E13)**: new `periodic_notes.rs` (`Period` compile-time enum daily/weekly/monthly/quarterly/yearly → `note_path` pure path math; daily = the SAME `daily/YYYY-MM-DD.md` the task source seeds, so "add a task to today" and "open today's note" land on one file; ISO-week year handled at year boundaries) + `note_periodic(period, date?, create?)` gate tool (resolve/read/seed-with-journal-fm, per-note locked). `note_recent_changes(limit, days?)` — mtime-sorted newest-first ("what did I touch lately", the recall the LRA ecosystem worked around via search). `vault_search` gains OPT-IN `with_context`/`context_length` (back-compat: default shape stays plain paths for the PWA; with_context=true → {path, context} with char-boundary-safe snippets). E2 (active note) + E3 (open-in-UI) landed as the second half: new `ui_bridge.rs` on `KernelRuntime` (active-note `RwLock` + open-note broadcast). E2 = PWA reports focus via the `set_active_note` **Tauri command** (deliberately NOT a gate tool — same C3 boundary as `review_resolve`: the brain READS via `note_active_get`, only the UI can set); NotesApp reports on selection change, clears on unmount. E3 = `note_open(path, heading?)` gate tool validates existence → broadcast → supervisor forwards as the `notes:open` Tauri event (same forwarder pattern as the review gate) → NotesApp navigates; returns `delivered:false` when no UI listens. **Checker follow-ups landed in the same slice**: `note_`/`doc_` prefixes classify into the `notes` intent domain + `calendar_` into a new first-party `calendar` domain (they fell through to `mcp`, so a notes-scoped BYO-CLI couldn't see the native note endpoints — visibility.rs prefix table + FIRST_PARTY_DOMAINS + tests); `patch_frontmatter_key` fails CLOSED on a zero-indent comment interleaved inside a value block (surgical = never-corrupt) and preserves CRLF line endings on untouched fm lines. 97 gate tools.

**Slice 3 (2026-07-02) — Calendar is the FIRST product built trait-only from the start (migration point 4 made real)**: new `calendar_source.rs` implements `QuerySource` + `RecordSink` and the gate exposes exactly the 3 verbs (`calendar_describe`/`calendar_query`/`calendar_produce`) — **zero bespoke per-op tools ever existed for it**. Storage = one event per note under `calendar/` with frontmatter `{title, date, start?, end?, location?, tags?}`, filename `<date>-<slug>.md` (deduped `-2/-3…`), free-form body — the Obsidian Full Calendar note-per-event convention (vim test + Obsidian compat by construction). `supported_ops` = set_cell (edit one frontmatter field in place, body + unknown fm keys preserved verbatim; `date` validated YYYY-MM-DD) / upsert_rows (create event notes; title+date required) / delete_rows (delete the notes); field ops `Unsupported` (fixed schema). Gate locks every addressed note (task_produce posture). Sheets ruled OUT as a separate source — same record-grid as smart-table (a second grid source = fragmentation, Bitable is the superset); recorded in the suite design doc.

## Provenance

- §1 Brain ← orig-003 (Brain Pi sole, 2026-05-30, status proposed → accepted here)
- §2 Capability ← orig-004 §Decision + §9 (10 namespaces / 28 methods, frequency ≥3 + category exception, 2026-05-22 → 2026-05-30)
- §3 Provider — NEW (2026-05-31). Synthesizes orig-004 §9.1 lock list + VMark `ai_provider/` literal port (sink/detection/path_resolver/REST adapters, ISC) + Continue `roles[]` routing primitive (Apache-2.0) + LiteLLM typed fallback chain (MIT). Replaces never-shipped orig-021 "Irisy brain switcher" (which was superseded by §1 Pi singleton).
- §4 Crypto ← orig-007 (vodozemac, 2026-05-16, accepted)
- §5 Subprocess ← orig-012 (portable-pty SubprocessActor, 2026-05-19, accepted)
- §6 MCP bus ← orig-013 (kernel as MCP server, 2026-05-22, accepted)
- §7 Composition ← orig-024 (6-axis manifest, 2026-05-30, status proposed → accepted-at-decision here, implementation deferred per "实施时决")
- §8 Vault — NEW v3 (2026-06-01). Driven by bao session "L1 vault button + vault MD management research + sourcing inbox workflow + 整体一次性 ship". Lock decisions in `.olym/brainstorm/vault-md-management-2026-06-01.md` §10. Feature-layer boundary (Daily Note + Sourcing) aligns with memory `feedback_build_system_not_business`; storage philosophy aligns with `decision_ctrl_obsidian_philosophy` (vim test) + `decision_vmark_not_substrate_use_open_stack` (no VMark sidecar). Wiki-link Tiptap extension ports from seahop/kairo (MIT) — see THIRD_PARTY_LICENSES/kairo-MIT.txt.
