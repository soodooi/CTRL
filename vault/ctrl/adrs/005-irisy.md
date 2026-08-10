---
adr_id: 005
module: irisy
title: CTRL Irisy — one fixed identity + explicit context + sole live transcript + capability integration
version: 45
status: accepted
last_updated: 2026-08-10
deciders: [bao, zeus, hephaestus]
sections:
  - { id: lifecycle,                  source: orig-016 — RETIRED in v5 (mcp lifecycle moves to ADR-004); intent column retired-v42 (superseded by §12 user intent registry) }
  - { id: user-intents,               source: bao-2026-08-05-single-truth-lists, note: "§12 v42 sole user-intent registry and product-scope authority; §12.3 v43 requires one executable pipeline per intent with generated verified/partial/declared status; §12 v45 records U6 partial status and three open gaps; ADR-002 §17 owns capability domains and ADR-003 §8.5 owns surface conformance." }
  - { id: remote-view,                source: orig-017 — preserved (still Irisy's UX surface) }
  - { id: persona-shell,              source: retired-v40, note: "Role/persona registry and selectable identity authority retired; one fixed Irisy identity." }
  - { id: soul-md-compat,             source: new-2026-06-03 — RETIRED in v5 (SOUL.md spec applies to hermes agent memory, not Irisy) }
  - { id: self-reflection-loop,       source: new-2026-06-04 — MIGRATED to hermes via SKILL.md (Irisy is no longer an agent) }
  - { id: capability-decomposition,   source: new-2026-06-04 — RETIRED in v5 (no Irisy system prompt — agents own their prompts) }
  - { id: pi-extension-integration,   source: new-2026-06-04 — RETIRED in v5 (Pi exited CTRL hot path, ctrl-pi-bridge deleted) }
  - { id: capability-integration,     source: bao-2026-08-02, note: "Normative contract for every Irisy capability or external-application integration; project review records are evidence, never a second authority." }
  - { id: role-boundary,              source: bao-2026-08-05-one-fixed-irisy, note: "One fixed Irisy identity; §11 v41 keeps the canonical tuple and resolves selected FCT into existing Resource/optional-Skill/capability/policy facts before turn assembly; §11.2 v44 moves transcript truth to a kernel-owned plain-text Resource with the frontend store as its projection." }
  - { id: byo-managed-install,        source: retired-v40, note: "Former §8.8 body removed; managed-engine install history retained in changelog/git provenance only." }
changelog:
  - v45 2026-08-10: **§12 U6 status clarification — canonical-operation stage verified, intent partial (bao: ADR and conformance must not drift).** ADR-002 v90 said "moves U6's canonical-operation stage to complete for all three sources", which is accurate for the kernel contract but was misread as "U6 verified". The generated conformance report correctly shows `partial` because three gaps remain open: the smart-table cell edit has no DOM-driveable UI test (the grid renders to a canvas), the calendar has no first-party editing surface (the canonical write is exercised but reached through the assistant only), and smart-table row/column operations still rewrite the whole file through the bespoke path with no revision precondition. ADR-002 v90 now reads "canonical-operation stage verified" rather than "complete". No scope change; no code change; no intent rescoping. The three gaps belong in the pipeline declaration and are already there; they are not a v1-scope defect because the kernel-side write contract for all three sources is the acceptance criterion bao named. The remaining gaps are UI-layer and bespoke-path work that will close in their own slices.
  - v44 2026-08-05: **§11.2 amendment — the transcript is a kernel-owned plain-text Resource, and the frontend store is its projection (bao: U13 做).** v40 named the persisted frontend session store the sole live and recovery transcript authority. That store is browser storage: the one thing a user most needs to keep was the one thing ordinary tools could not read, which fails the plain-text invariant and the vim test outright, and made U13 recovery unverifiable because there was no artifact to verify against. A conversation is user content, so it now lives as one readable Markdown file per session — YAML frontmatter for metadata, `## <role>` per turn — owned by the kernel as the canonical Resource `ctrl://local/session/<id>`; the transcript directory is the session list, with no second index. The parse is deliberately tolerant: missing frontmatter, unknown keys, an unclosed block, and an ordinary `## Heading` inside a reply are all handled, because refusing to read a hand-edited file would lose history over a typo. The owner offers exactly one write, `append_message`, under the §15.2 write contract (revision recheck, atomic commit, post-write reread, typed Outcome); rewriting and deleting history are absent by design, and a fork narrows the view, never the record. The frontend store is rebuilt from the transcript on open and writes only settled turns, so a streaming or empty placeholder never reaches the file. Browser-held transcripts are migrated turn by turn before the projection is rebuilt, a partial migration leaves what landed readable and retries without deleting its source, and an unreachable kernel keeps the existing local view and says so instead of blanking it. Adds no verb, primitive, transport, or authorization axis: transcripts reuse the vault/notes grant and the existing three verbs. Pairs ADR-002 substrate §15.2/§15.5 v87 and ADR-005 §12 v43 U13.
  - v43 2026-08-05: **NEW §12.3 — every intent needs one executable pipeline, and its status is generated rather than asserted (bao: 每个清单的逐条意图和能力都得有可验证的管线).** A surface existing or a capability being installed is not evidence that a job can be done; a user-angle review of the shipped shell found intents whose surfaces existed while the path failed, including raw errors rendered as Irisy's own replies. Each `v1` intent now declares exactly one pipeline `entry surface → resolved context → capability domains → canonical operation → Outcome → rendering → evidence`, where every stage is checkable: the entry stage asserts reachability without naming a tool/package/Skill/MCP server/ResourceRef/domain, the domain stage exposes over-broad grants, the Outcome stage names the facts the owner must return so a missing target/staged/retryability is correctly blamed on the fact owner rather than presentation, and the evidence stage is runnable plus real UI verification where behavior is visual. Status is exactly `verified`, `partial` (with the failing stage named), or `declared`, reported from generated evidence; `partial`/`declared` must not be shown to users as available, a completion claim naming an intent requires that intent's current evidence, and an intent cannot be `verified` while any domain in its pipeline is `declared` under ADR-002 §17.6. This adds no per-intent endpoint, route, or runtime branch — a pipeline is an evidence path over the existing shell, registry, gate, owners, and rendering registries. Pairs ADR-002 substrate §15.5/§17.6 v86 and ADR-003 frontend §8.5 v44.
  - v42 2026-08-05: **NEW §12 user intent registry; §1's intent column retired (bao: 整理成能力清单和意图清单，唯一真相，所有设计都得符合清单需求).** CTRL had no live user-intent authority: the only enumeration (68 intents) retired with ADR-008 and was never inherited, and §1's 8-stage table is a pre-fixed-identity pack lifecycle naming retired Pool/keycap/persona surfaces. Every design round therefore re-derived scope from architecture, which repeatedly produced controls that expose internal inventory instead of serving a job. §12.1 enumerates 25 intents (U1–U25) as complete user jobs in the user's terms, each mapped to ADR-002 §17 v85 capability domains and marked `v1` or `later`; an intent is never a tool, endpoint, domain, FCT, Resource kind, or screen. U23 (save a verified behavior for reuse) is `v1` on bao's decision because without it the only reuse path is choose-a-capability-before-working, the exact failure mode this registry exists to prevent; its scope excludes transcripts, step sequences, replayed parameters, and triggers, and saving never activates the result. U22 write stays `later` because none of its write-safety preconditions has real evidence yet. §12.1.1 refuses rather than defers scheduling/event-triggers/conditions/branching, BYO-CLI loop supervision, and any job whose primary affordance is browsing internal inventory. Rules: the registry is amendable but never unilaterally — any add/split/merge/retire/rescope, including moving an intent between `v1` and `later`, requires explicit discussion with bao and bao's decision before the amendment, and an uncovered real user need must be raised rather than served silently, stretched into an existing entry, or blocked without record; every product decision names the intents it serves; an intent must be reachable without the user naming a tool, package, Skill, MCP server, ResourceRef, or capability domain; an intent needing a nonexistent domain is a substrate amendment first; U6/U19/U22 writes cross ReviewGate under §10.3; U10 approval, U11 provenance, and U12 truthful failure/recovery are first-class intents rather than modal details; capability selection (U17) is an override, never a precondition, so Auto alone must serve U1–U9; `later` intents must not be presented as available. §11 v41 still owns identity, the six-fact tuple, and session/transcript authority. Pairs ADR-002 substrate §17 v85 and ADR-003 frontend §8.5 v42.
  - v41 2026-08-05: **§9.1/§11 FCT context amendment (bao confirmed; PRJ cancelled).** Irisy may resolve or accept one selected FCT for a turn. FCT is a product projection, not an identity, session, transcript, Resource, Skill, capability, operation, or ReviewGate owner. Resolution happens live before runtime assembly: preserve Work Resources, append/dedupe dependency Resources, optionally select an internal Skill, and enforce least-privilege gate scope/policy. Zero-Resource is valid only when Skill or enforced scope changes. Selection persists per canonical session; stale/removed selection reports once, returns to Auto, resets, and does not send. Create/Manage remains in Library while Use belongs to the composer.
  - v40 2026-08-05: **§8.7/§11 authority amendment; §8.8 retired.** CTRL has one fixed Irisy identity, no Assistant/Coding identity split and no role/persona registry. Turn context is exactly `session_id + explicit Resources + optional pinned Skill + capability scope + policy + task`. The Assistant transcript store becomes the sole live Irisy transcript authority; former Coding project history and Hermes history are read-only import material that create new canonical Irisy sessions. Project coding is a Resource/Skill scope. Skills never own sessions. Live dependency on `irisy-architecture.md` is removed; historical changelog/provenance references remain. The conflicting §8.8 body is removed and retained only as retired-v40 provenance.
  - v39 2026-08-03: **§11.2/§11.3 amendment — one Skill registry and one transcript authority close the visible-control/runtime gap (bao: selected “炒股养家” was ignored while Irisy searched a hardcoded `stock-analysis-cn`; requested full architectural repair).** UI discovery, explicit pinning, and gate `skill_list`/`skill_read` resolve the same hot-scanned local `SKILL.md` registry. A pinned Skill is immutable fresh-session input, takes precedence over generic Auto-discovery hints, and fails visibly if stale or unreadable; it can prescribe method but cannot imply that a required feature pack or gate tool is installed. Feature packs provide capabilities through `:17873`, Resources provide context, and Skills provide playbooks; these axes compose but never masquerade as one another. Assistant session tabs and their persisted transcript store are the sole live/recovery transcript authority; Hermes history is read-only import material that creates a new tab and never overwrites an active transcript. Coding retains its separate workspace-keyed transcript authority. Pairs ADR-002 substrate §7 v80 and ADR-003 frontend §8.5/§8.6 v39.
  - v38 2026-08-03: **§8.7 + §11 amendment — Irisy is the sole user-visible AI brand with two identities, Assistant and Coding; runtime names are not product actors (bao confirmed).** The identity selector, real Resource scope, and Auto/explicit Skill control live under the one composer. Assistant resources are current content, explicit application selection, knowledge, or active pack; Coding resources are eligible projects, auto-bound when only one exists. A pinned skill is loaded from the existing local SKILL.md authority and injected into that identity's fresh ACP session; an installed-but-unused skill is never shown as active. Identity/resource/skill changes reset only the affected owner before the next turn. Beneath the brand, Assistant and Coding still own separate ACP singleton, cancellation/drain, durable transcript/session, resource scope, capabilities, credentials, and approvals; no context transfer is implied. Pairs ADR-001 spine §4 v21 and ADR-003 frontend §8.5/§8.6 v39.
  - v37 2026-08-02: **§8.7 + §11 amendment — presentation converges from LEFT Coding / RIGHT Irisy into one persistent dialog shell with an explicit Irisy/Coding actor selector, without merging agent authority (bao confirmed).** The selected mode owns the visible transcript and mode chrome; Irisy keeps its own selectable ACP engine, roles, Companions, packs, transcript, and context, while Coding keeps the separate `coding_singleton()`, OpenCode command/cancellation owner, workspace-keyed sessions, projected coding skills, attachments, and workspace scope. Shared React renderer/composer components are presentation reuse only. Switching actors never shares session, context, credentials, pending tool calls, cancellation, or approval. The standalone Coding chat authority is retired. `record_source` remains a data contract and cannot imply Coding workspace eligibility; projection requires explicit actor/surface metadata. Pairs ADR-001 spine §4 v20 and ADR-003 frontend §8.5/§8.6 v38.
  - v36 2026-08-02: **NEW §11 App AI Assistant Role Boundary — Irisy, the left-region Coding agent, and the repository development agent are three distinct actors.** Irisy is the shipped, user-facing App AI assistant: it completes user jobs through installed capabilities and the gate, but it is not the CTRL repository maintainer or an architecture authority. Coding is the separate user-owned OpenCode agent for code and feature-pack work in the selected workspace; sharing ACP and gate infrastructure does not make it Irisy. Kiro or another repository development agent works outside the shipped product, follows GOAL + owning ADRs, and changes CTRL itself; it must never be presented as Irisy. Handoffs preserve explicit identity, scope, session, and approval boundaries. This section is the sole role definition; `irisy-roles.md` and `irisy-coding-companion.md` are retired as live design sources. Pairs ADR-001 spine §4 v19 and ADR-005 irisy §8.7 v36.
  - v35 2026-08-02: **NEW §10 Irisy Capability Integration Contract — every capability or external-application project must review the same contract before implementation and again after real validation.** Irisy has exactly three reusable forms: Workspace (expanded work area + right Irisy), Companion (the same Irisy surface with the workspace collapsed), and Artifact (a produced native result). Companion is NOT a second native window, shell, or transport: it reuses ADR-003's single NSPanel and existing Irisy session. Each integration declares its job, chosen form, explicit context boundary, local truth source, capability mapping, write/review boundary, credential and identity boundary, visible scope, degradation behavior, and evidence. The gate remains the sole cross-domain control plane; data operations use §14 describe/query/produce, mutations cross ReviewGate, and external applications retain their own collaboration and permission authority. Each project writes a non-authoritative review record under `vault/ctrl/research/irisy-integrations/<slug>.md`; its preflight and post-validation reviews yield only Conforms, Clarification, or Contract delta. A Contract delta requires bao approval and an in-place ADR-005 amendment before implementation, so accumulated evidence evolves one contract rather than leaving project-specific architectures. First record: LibreOffice Companion. Pairs ADR-003 frontend §1.1 v37, ADR-002 substrate §14 v77, and ADR-010 communication § waist v11.
  - v34 2026-07-28: **§8.3.1 scope correction — ACP cancellation is a caller-owned opt-in, not a claimed Irisy UI feature.** Only a surface that registers an active request owner and invokes `prompt_cancellable` may send `session/cancel` and drain the original response. Coding is the current such surface. Irisy does not yet expose an ACP cancellation command; its reset discards the singleton and must not be represented as safe cancellation or reuse. Any future Irisy Stop control must adopt the same owner/cancel/drain contract before it is enabled.
  - v33 2026-07-28: **§8.3 amendment — ACP prompt cancellation is request-owned and stdout-safe.** A UI stop sends `session/cancel` only for the active ACP session, then the owning client drains the terminal response for that original prompt while it exclusively owns the stream; late thought/message/tool updates are discarded and never reach a later UI turn. A client is reusable only after that terminal response is drained and the child remains alive. Cancellation-write, drain, EOF, or timeout failure marks it non-reusable; the caller drops the singleton and creates a fresh session re-hydrated only from the durable local transcript. A clean cancel does not kill the live engine. Coding's independent ACP client follows the same rule; reset/workspace replacement first cancels active owners and waits for their drain. This preserves engine-owned loop/context while preventing stale stdout attribution.
  - v32 2026-07-27: **§8.7 the RIGHT-region Irisy surface gains Kiro-parity Session and Attachments modules, closing v31's "not wired to any Irisy UI" gap for attachments and adding multi-session tabs (bao "Irisy的页面，清修改成跟kiro一样...session，model，attachments等等模块都要"; explicitly out of scope this round: token/credit usage stats and checkpoint/restore).** Before this amendment `IrisyChat.tsx` persisted exactly ONE conversation per mode under a single localStorage key — there was no way to hold multiple parallel conversations the way Kiro's screenshot shows (a row of session tabs across the top). New `lib/irisy-sessions.ts` (zustand + persist, same convention as `workspace-store.ts`) replaces that with a LIST of sessions the user creates/switches/closes/renames, rendered by a new `SessionTabs.tsx` tab bar mounted just below `ChatHeaderControls`; a one-time `migrateLegacySingleSession` folds an upgrading user's existing single conversation into the first new session rather than dropping it. Session tabs auto-title from the first user message (`deriveSessionLabel`, truncated) exactly as Kiro's own tabs do, and stay user-renamable via double-click. Attachments (v31's gap): `IrisyChat`'s composer now shares the SAME native-drop mechanism Coding uses — the underlying Tauri drag-drop hook was extracted to `lib/native-file-drop.ts` (`coding-drop.ts` becomes a thin re-export so `CodingScene.tsx` needed no change) — and the disk-reading/ContentBlock-classification logic (`ChatAttachmentWire`/`read_from_disk`, formerly private to `coding_chat.rs`) moved to a new shared `commands/chat_attachment.rs` both `coding_chat.rs` and `irisy_chat.rs` now call, so `irisy_chat_stream`'s ACP path (only the ACP path — the provider-router fallback has no attachment support) resolves a dropped file into an `Image`/`EmbeddedResource` ContentBlock via the SAME `AcpClient::prompt` capability negotiation Coding already exercises (ADR-002 substrate §1.8.6 v75). Model module: the existing `AgentSelector` (unchanged logic) moves from a row above the composer to a bottom toolbar row below it, matching Kiro's bottom bar position — position/styling only, no new engine-selection behavior. Deliberately NOT built, per bao's explicit scope cut: Kiro's credit/token usage counter (no CTRL-side token metering exists to back it — a real number, not a placeholder, or nothing) and the checkpoint/restore timeline (a distinct, separately-scoped message-snapshot-rollback feature). Coding mode (`forceMode==='coding'`) keeps its dormant legacy single-conversation code path untouched — CodingScene.tsx already owns Coding's own workspace-keyed conversations, so this redesign only touches the Personal ("assistant") surface. Verified: `cargo test --lib` 523/523 (chat_attachment.rs's disk-reading tests relocated + a new `read_all` test); `vitest run` 243/243 (22 new: `irisy-sessions.test.ts` covering create/close-fallback-ordering/rename/label-derivation/legacy-migration); `npm run typecheck` clean. Pairs ADR-003 frontend §8.6 v36 (SessionTabs/AgentSelector placement) and ADR-002 substrate §1.8.6 v75 (the attachment capability this consumes).
  - v31 2026-07-27: **§8.7 the shared `AcpClient` gains capability-negotiated multi-modal attachments (ADR-002 substrate §1.8.6 v75), available to Irisy's right-region engine but NOT wired to any Irisy UI by this amendment.** This turn only touched the protocol layer both engines drive; Irisy's own drag-drop semantic (attaching data to feed an *installed* feature pack, distinct from Coding's authoring-reference-material use) remains unscoped and unbuilt — recorded here so the capability's availability doesn't get mistaken for it being wired. Pairs ADR-001 spine §4 v18 (the Coding side that DOES consume it this turn).
  - v30 2026-07-27: **§8.7 left-region Coding drives opencode over ACP instead of an embedded PTY (v29, same session) — the LEFT/RIGHT shape is unchanged, only the mechanism inside LEFT changes (pairs ADR-001 §4 v16, ADR-003 §8.5 v32).** v29's embedded PTY hit a real, reproducible rendering failure on the actual machine (a black terminal area despite a confirmed-alive `opencode` process) — root-caused via a direct capability probe against the installed binary rather than patched again: `opencode acp` speaks genuine Agent Client Protocol, the SAME protocol CTRL already drives Irisy's own engine (hermes/codex/claude-code) with over `shell/acp_client.rs`. Coding now reuses that exact machinery through a second, independent `AcpClient` singleton (`coding_singleton()`) rooted at the selected workspace, so switching Irisy's engine can never evict a live Coding session and vice versa. The LEFT work area renders the engine's structured events (answer/reasoning/tool-call/tool-result) as native React — no PTY, no xterm, no terminal emulation anywhere in the Coding module — while the RIGHT Irisy column remains completely untouched: no fold, no collapse, no narrowing, exactly as v29 already established and v28/v27 before it. The v27/v28/v29 external-launch mechanism is retained as a secondary "Open externally instead" action, not deleted.
  - v29 2026-07-27: **§8.7 left-region Coding returns to an embedded PTY, restoring product cohesion with every other module's [LEFT work area | RIGHT Irisy] shape (bao: Coding is not exempt from that shape; pairs ADR-001 §4 v15, ADR-003 §8.5 v31).** v27/v28's external-terminal launcher solved a real problem (v18's embedded PTY had unfixed stability bugs) but created a worse one bao flagged directly: the launched OpenCode window floats outside CTRL, visually overlapping the always-on-top launcher panel (§1.1), with Irisy nowhere near it. `CodingTerminal` is now mounted directly in the LEFT work area running `opencode`, with the RIGHT Irisy column completely unchanged — no fold, no collapse, no narrowing; Irisy is always-resident, and this amendment does not touch that. The v27/v28 external-launch mechanism is retained as a secondary "Open externally instead" action, not deleted. The v18 PTY stability bugs are fixed this time (PTY effect keyed by value not array reference; confirm-before-kill on workspace switch) rather than ducked by going external again.
  - v28 2026-07-26: **§8.7 left-region Coding gains multi-workspace launch — installed feature-pack scopes join the configured root, correcting v27's "not advertised as OpenCode workspaces" (bao "A").** An independent review of the shipped v27 launcher confirmed the prior restriction was a dead end: a feature pack (§7.5's product-grade project unit) had its own projection scope (ADR-002 §1B.8) but no `opencode.json`, so it could never be an OpenCode target even though the launcher's own discovery could be extended to list it. Fix: `projector::project_pack` (ADR-002 §1B.8 v74) now writes `opencode.json` into each pack scope; the left-region launcher discovers + validates the configured root plus every such pack scope as separate, independently selected workspaces (ADR-003 §8.5 v30). CTRL still opens an allowlisted external terminal only after a user click for whichever workspace is selected, then hands process/TUI/error/recovery/agent-loop ownership to the user's OpenCode; nothing about supervision changes. RIGHT-region ACP engine behavior is unchanged. Pairs ADR-001 §4 v14 and ADR-003 §8.5 v30.
  - v27 2026-07-25: **§8.7 left-region Coding becomes an explicit external-terminal-first launcher (bao approved option A), superseding v18's PTY-first presentation.** The configured CTRL root is the sole OpenCode launch scope and carries `opencode.json`, `AGENTS.md`, the create-feature-pack Skill, and the `:17873` gate. CTRL opens an allowlisted external terminal only after a user click, then hands process/TUI/error/recovery/agent-loop ownership to the user's OpenCode. Feature-pack directories remain generic projected scopes and are not advertised as OpenCode workspaces. The embedded `CodingTerminal` remains a click-to-mount Quick Terminal fallback, never auto-starts, and remounts on cwd changes. RIGHT-region ACP engine behavior is unchanged. Pairs ADR-001 §4 v13 and ADR-003 §8.5 v27.
  - v26 2026-07-25: **§8.6.1 diagnostics projection for the live Irisy engine.** Irisy exposes content-free ACP owner metadata and lifecycle breadcrumbs to the single ADR-010 §diagnostics composer: engine/session identity, startup/live/ready state, phase/outcome/duration, and gate reachability. It never exports prompts, completions, thoughts, tool arguments/results, credentials, absolute paths, or raw ACP/InternalMsg payloads. Smoke checks the existing owner/transport without sending a model prompt; diagnostics cannot create, reset, replay, or supervise a second engine loop.
  - v25 2026-07-23: **§9 authority boundary reconciled with module ADR governance.** `irisy-architecture.md` remains a non-authoritative research/planning map for the accepted mission, knowledge-system detail, and the new five-capability planning lens; this ADR and the other owning module ADRs are the sole architectural authority. The lens may organize cross-module review but cannot create, override, or downgrade a decision; implementation still requires an in-place amendment to each owning module ADR. This supersedes v11's delegated "Governing SSOT" wording without changing the locked operator mission.
  - v24 2026-07-13: **§8 operational authority corrected to existing build-owned sources.** The nonexistent `.kiro/skills/hermes/SKILL.md` pointer is removed; engine pin/install truth is `shell/agent_installer.rs`, runtime ACP behavior is `shell/acp_client.rs`, and release evidence is `scripts/probes/hermes-acp-probe.mjs`. No runtime architecture change.
  - v23 2026-07-13: **Retired Pi-era §5-§7 governance is made explicitly non-binding (no new architecture).** Their prose remains as provenance, but headings/checklists now say retired and use `[~]`; live runtime verification is Hermes ACP plus the current §8/§9 model. Removes deleted `ctrl-pi-bridge`/Pi RPC work from accepted release debt and pairs ADR-002 v63.
  - v22 2026-07-08: **§2 mobile = describe-driven SDUI (generic, not stock) + Irisy conversation over the tunnel.** bao 2026-07-08「我们不仅仅是股票,不能拘泥于股票」+「对话没有了,这是个问题」+「通讯协议要抽象化通用化」. Researched server-driven-UI (Airbnb Ghost / OpenAI Apps SDK / MCP-UI / Shopify remote-dom, cross-verified): the right protocol = **describe-driven SDUI over the gate** — a pack `describe`s its mobile surface as a flat list of typed PARTS (kind + data + actions), the phone renders them through ONE registry with zero per-pack code; borrow the industry's *contract shape* (typed kind → registered renderer + declarative action + version + unknown-kind fallback), reject its heavyweight *transport* (iframes / remote-dom / AG-UI event stream) — matches local-first + gate-governed + JSON-semantic + the existing PartKind registry. **As-built (`feat/mobile-sdui`)**: `SurfaceRenderer` = domain-agnostic primitives (gauge/metrics/barlist/tiers/table/record/list + json fallback) — **no `stock` kind**, stock is just one composition; `Surface{v,pack,title,parts[]}` + `Action{verb:query|produce,source,op}`. Phone `RemoteApp` fetches each pack's Surface via `remote_surface` (describe) + renders generically + rounds actions back over the tunnel (deleted the `if(pack===stock)` hardcode). Desktop `RemoteHost` builds the Surface — the stock→parts mapping is a TRANSITIONAL desktop shim (real design: the pack describes its own surface via §14; every other pack flows through unchanged, the phone never knows a pack is "stock"). **Conversation**: `ChatSheet` slides in from the right edge / an Irisy button (maps the desktop's right chat column onto the phone); `sendChat` tunnels to the desktop, `RemoteHost` streams the engine reply (`engineTransport`, same assistant) back as chat_chunk/chat_done. Desktop Mobile (L1) page embeds a live phone preview (`MobilePreview`) beside the config so you see the app without a phone; "Mobile" is now a first-class L1 entry (not a settings-corner route). Verified: tsc + generic renderer render (2 packs, one renderer) + chat-tunnel protocol sim (send→stream→accumulate→done) + AES-GCM/passcode/surface sims. Honest gaps: move the stock shim into the pack (§14 describe); live phone↔desktop round-trip (engine stream + real data) = desktop+phone. Plan `vault/ctrl/plans/remote/plan-remote-window.md`.
  - v21 2026-07-07: **§2 remote window — persistent device model (RustDesk/ToDesk parity) + hosted PWA + relay deployed.** bao「是todesk的最佳实践吗」→ researched RustDesk (open-source authority) / ToDesk / TeamViewer connection models (multi-source). Verdict: the relay-only + E2E + dial-out transport is RIGHT and deliberately simpler than the reference products for JSON (P2P/hole-punching is their most-complained subsystem — #6689 — and still relays on mobile/CGNAT; adopting it = over-engineering for JSON; do NOT). BUT the ephemeral "Start session → one-time link" pairing was the ATTENDED-support model, wrong for the main use case ("reach my OWN desktop from my OWN phone" = UNATTENDED, which all three ship as persistent device-id + password + always-registered). **As-built (`chore/remote-pages-base`)**: `remote-identity` (stable device id + E2E key + 6-digit passcode, persisted; Keychain migration is the noted hardening) ; "Stay reachable" keeps the outbound relay link alive with backoff (RustDesk's registration-heartbeat posture, still 0 listening ports) ; a durable connect link the phone bookmarks ; the passcode verified AFTER the E2E channel is up (relay never sees it — RustDesk's `SHA256(pw)`-inside-encrypted-channel shape) ; passcode Reset = soft-revoke remembered phones ; one-time "Share once" link kept for the attended/share case ; phone remembers the passcode for silent reconnect. Also: PWA now HOSTED (a phone can't reach the desktop's local Tauri origin) at **app.ctrlapplab.com** (Cloudflare Pages, `ctrl-app` project; pairing link points there, data still flows peer-to-peer over the relay so the host serves only the static shell) ; **ctrl-relay deployed + live-verified** (`wss://ctrl-relay.soodooi2018.workers.dev` — two peers through the real worker, E2E round-trip). Multi-tenant needs zero per-user setup: shared host + relay, each session isolated by device-id + E2E key (like HA's Nabu Casa / RustDesk's ID registry). Honest gap: DNS CNAME for app.ctrlapplab.com (token lacks dns:edit) + real phone↔desktop round-trip. Verified: tsc + AES-GCM round-trip/tamper/wrong-key + host↔relay↔client protocol sim + passcode-auth sim (no/wrong/right) + card renders. Plan `vault/ctrl/plans/remote/plan-remote-window.md`.
  - v20 2026-07-07: **§2 remote co-view SHIPPED — semantic "remote window" (option B), relay-only + E2E; NOT pixel remote-desktop (that = ADR-010 ⑧).** bao 2026-07-07「远程桌面和远程窗口…L1 配置页管手机显示/功能」→ evaluated the prior work (a `feat/remote-window-share-spike` worktree = a RustDesk-style PIXEL remote-desktop: screen_capture/H.264/WebRTC/input_inject) and the ADRs, and bao chose **B (semantic remote / phone-native PWA)** over A (pixel). Two research rounds (transport best-practice + Home Assistant Companion benchmark, multi-source cross-verified) locked the transport: **relay-only, NO WebRTC (JSON not video → Syncthing proves data tools don't need it), zero-knowledge relay with E2E frames** (beats HA-Cloud's disclosed "cloud owns the trust root, could MITM" hole by anchoring the E2E key in the phone↔desktop pairing exchange). **bao chose strict 0-listening-ports = relay-only** (LAN also hairpins the relay; offline-LAN-direct deliberately dropped — deletes HA's two most-complained subsystems: SSID local/cloud switching + blocking connection-lost wall). **As-built (`feat/remote-window`, frontend-only, no kernel/Rust — the running desktop PWA is the host peer)**: L1 `/remote` config page = per-device deny-by-default allowlist (function visible + view/act) ; mobile bottom-nav shell rendering allowed functions NATIVELY (stock cockpit renders as-is) ; `worker/ctrl-relay` (zero-knowledge CF Worker, reused from the spike) ; `remote-crypto` (AES-256-GCM frames, verified round-trip/tamper/wrong-key) ; `RemoteHost`/`RemoteConnection` (desktop dials the room + serves allowlist + proxies gate-calls ↔ phone joins via `?remote=<room>#k=<key>` link, tunnels gate invokes E2E). Verified: tsc + crypto + a full host↔relay↔client protocol sim (hello→allow→invoke→result E2E). **Honest gaps (bao's)**: relay deploy (CF account) + real phone↔desktop round-trip. Governing plan = `vault/ctrl/plans/remote/plan-remote-window.md`. Supersedes §2's "not in v1 scope / on mesh" framing for the SEMANTIC path; the spike's `ADR-002 §remote-control v1` (pixel) references collapse into ADR-010 ⑧ (independent pixel-remote-desktop module, not built).
  - v19 2026-07-06: **§9 knowledge — Irisy now CONSULTS a matching skill before a domain analysis (not just when it feels like it), + a data-grounding ban on memory-sourced market numbers; the A-share buy/sell 规范 (`stock-analysis-cn`) ships as a shareable skill (bao 2026-07-06「你应该是给 Irisy 一个规范呀」+「重启验证 + 提交 + 硬化 skill 热发现」).** Context: the stock pack's core = 选股/盯盘/止损 = data-grounded buy/sell decision analysis (NOT ledger tracking); guiding Irisy turn-by-turn doesn't scale, so the playbook becomes a SKILL Irisy self-serves. Three landed pieces: **(1) 规范** = `share/skills/stock-analysis-cn/SKILL.md` (铁律 data-grounded/no-fabrication/decision-not-荐股 · EastMoney keyless recipes secid+kline+realtime · 4 tasks 个股/选股/止损/盯盘 · output format · anti-patterns incl. "no ledger"). **(2) Brief reflex (`CTRL_CAPABILITY_BRIEF` in `acp_client.rs`, where hermes reads it turn-1)**: "WHEN A SKILL MATCHES THE TASK, skill_read it and FOLLOW it BEFORE you answer; for any A-share buy/sell / 选股 / 止损 / 盯盘 request FIRST skill_list + skill_read the matching skill; NEVER state a price/PE/revenue/fund-flow/MA from memory — pull it live per the skill, or say you can't." **(3) Hot-discovery LOCKED** — the "skills need a restart to be found" fear was FALSE: `list_local_skills` re-scans `~/.claude/skills` on every call (live `read_dir`, no boot cache), proven by driving the running gate's `skill_list` (found the just-created skill with no restart); added regression test `newly_created_skill_is_found_on_next_scan_no_cache` so nobody introduces a cache later. **Ledger-verified (audit_calls, caller=hermes)**: pre-brief Irisy only `skill_list`ed then answered from memory; post-brief it `skill_read stock-analysis-cn` AND, when it couldn't find a kline tool, `gate_tool_search`ed "stock kline history price" — i.e. the reflex now drives it toward the skill's data. **HONEST GAP (the real next slice, surfaced by this verify)**: the skill's data recipe (EastMoney kline/fund-flow via terminal) is NOT reachable through the gate headless — the gate has only `market_quote` (price) + `market_screen`, no A-share kline/fundamental/fund-flow tool and no generic terminal tool (only `mcp_pack_run`), so Irisy still falls back to `web_search`/memory for fundamentals. Making the 规范 fully BITE requires exposing A-share kline/fund-flow/fundamentals as one-shot GATE TOOLS via the `ctrl-stock-cn` pack (the AI-native uplift layer the GOAL is about) — separate slice. In the real app Irisy also has the terminal companion (CodingScene), so full data-pull is bao's in-app verify. Locks unchanged (hermes = assistant brain; skills = on-demand playbooks).
  - v18 2026-07-06: **§8.7 — the CODING engine = OpenCode (open-source, model-agnostic), run as a BYO-CLI driver in the workspace; NOT hermes, NOT a wrapped commercial CLI (bao 2026-07-06「coding 模块规范得做…不是所有人有 claude…claude/codex 成熟产品不能直接用」).** Decisions, each bao-driven: **(a) not hermes** — hermes is an assistant harness (memory/RAG), weak at raw coding (verified: loses to Claude Code on coding chops; strength is cross-session memory); it stays the ASSISTANT brain, coding gets a dedicated agent. **(b) not Claude Code / Codex** — mature COMMERCIAL products; wrapping one makes CTRL a thin shell, adds a vendor dependency + ToS gray area (Anthropic 2026 cut third-party tools off Pro/Max subscriptions), and requires an account not everyone has. **(c) = OpenCode** (MIT, 160K★, 75+ providers incl. local Ollama, native `opencode acp`, MCP client, LSP): CTRL OWNS the integration, the user brings ANY model (free/local floor → BYOK upgrade) — aligns byok-no-Claude + sell-tools-not-models. **(d) integration mode = BYO-CLI driver, not the ACP-engine slot** (after a plan review found it simpler + fuller + de-risked): run `opencode`'s full TUI in the projected workspace (Coding scene's existing PTY, cwd = the configured vault root via `vault_root_path`, NOT a hardcoded `~/Documents/CTRL`), where the projector already writes the gate — no ACP-driving wiring, no model-injection, opencode keeps its full experience, and it matches spine §4 (user's own CLI, gate projected, CTRL doesn't supervise). **Landed (trial "B", bao「试试B…terminal 也保留」)**: Coding scene = tabs `[OpenCode | Terminal]` (both in the vault root) with Irisy chat pinned in the right column; `projector.rs` now also writes `opencode.json` (OpenCode's `mcp`/`type:remote` shape, vs Claude Code's `.mcp.json`) with a CODING intent (`source,discover,skill,mcp` for pack-building, `net` still excluded). Verified: on boot the projector writes `opencode.json` to the vault root with the live token; `opencode mcp list` there → `✓ ctrl-kernel connected`. Trial ALSO surfaced that the coding workspace must follow the CONFIGURED vault root (my first cut hardcoded `~/Documents/CTRL` and read a stale leftover from before the vault moved to `~/Documents/pkm`). Plan + full slice map: `vault/ctrl/history/plans/plan-opencode-coding-engine.md`. Honest gap: pack-building end-to-end IN opencode (ask it to build a pack via the gate tools) is the user's in-app verify; one-click lazy-install of opencode + un-retiring the ACP-engine path (optional, for chat-integrated coding) are follow-ups. Locks unchanged (hermes = assistant; opencode = BYO-CLI driver, projection not supervision).
  - v17 2026-07-06: **§persona + capability-brief — Irisy knows how to USE an installed connector pack + greets completely (bao 2026-07-06, ledger-verified).** Two fixes, both landing where hermes actually reads them (the compiled `CTRL_CAPABILITY_BRIEF` in `acp_client.rs` + the seeded `hermes-soul.md` — NOT the per-turn frontend ambient, which the hermes ACP path only sends on the SESSION'S FIRST turn, so a mid-conversation edit never reaches it; ledger-diagnosed root cause of "my brief edits didn't change Irisy"). **(1) Connector-pack usage rule (`CTRL_CAPABILITY_BRIEF`)**: asked "can you use ghostfolio?", Irisy searched for a product-named tool, found none (a §14 connector's data is reached via the GENERIC `source_describe/query/produce` + `source_id`, not a `ghostfolio_*` tool), and fell back to the industry-default "give me a URL + token." New brief section: an installed connector pack = generic `source_*` + `source_id`; a `not configured` error means SET IT UP (`mcp_pack_provision`), never demand a manual token. Verified on Claude: Irisy now calls `source_describe ctrl-ghostfolio` + reads the field shape (vs the old bare deflection). **(2) Greeting (`hermes-soul.md`)**: the soul said "terse, don't recite a feature list," so "你好" got a one-line deflection; changed to give ONE complete concrete intro on a greeting / "what can you do" (grounded in real tools), then stay terse for task work. Locks unchanged (hermes stays the assistant brain; §9 mission/knowledge unaffected). Honest note: takes effect on a FRESH hermes session (the brief primes turn-1 only), so an ongoing conversation must start a new turn/session to pick it up.
  - v11 2026-06-29: **NEW §9 mission + knowledge system (root-fix for "Irisy isn't smart").** bao 2026-06-29 钦定: 「Irisy 要做什么他不清楚 → 得有一个整体架构和 Irisy 的整体知识体系」+「你还是做个调研吧」→ 3 路调研 (knowledge/context-engineering · proactive-operator · China-OPC) 合成。**魂 LOCKED** = Irisy = 一人公司的数字员工/运营官 (按角色把整件事做完 / 本地记住你的生意 / 缺工具就造 / 经 gate)。病根 = ①没使命 ②知识散 5 摊无 SSOT。§9.2 = 8 层知识栈 (每层一 SSOT, 注入 vs 召回, **能力意识从 gate 注册表派生不手写**, 记忆存 vault markdown 写时对账)。§9.3 = 操作循环 Sense→Anticipate→Plan→Act(经gate)→Produce→Persist + 4 条主动性护栏 (可逆性=ask 边界)。定位红线: 不抢免费超级框 / 不做陪伴 / 隐私=商业数据主权。Governing SSOT = `vault/ctrl/irisy-architecture.md` v2 + [[irisy-roles.md]]。配 §3 persona-shell (§9 在 persona 之上 = Irisy 是为了什么)。实施走 dev-loop 分步。**+ §9.5 实施路径校准 (bao「hermes 已做了一些, 你要综合考虑」)= 驯化非造**: hermes 已是完整 agent 引擎 (记忆/循环/技能/cron/kanban), Irisy 三件 = 给魂 + 把记忆引流回 vault + 藏黑话 (减法非加法)。审计: CTRL 早把三件设计在 `vault_seed/irisy-soul.md` (记忆体系 episodes/playbook/curator + privacy + 藏黑话规则) + `CTRL_CAPABILITY_BRIEF` (已命令 hermes 把记忆写 vault SOUL 不写私有库) 里, 只是魂旧 (co-pilot/passenger/Pi/keycap) + 散两处会漂 + 引流没收口 (hermes 双写) + `vault/irisy/SOUL.md` 从未 seed。本刀已: 换魂 (seed about/identity → operator/back-office-of-one-person-company, 擦 Pi/keycap/co-pilot) + PWA spine 注入使命 (irisy-prompts v13→v14)。待做: 收口引流 (hermes 启动同步 vault SOUL + 停私有 MEMORY 双写) + 合并两源成单 spine。
  - v1 2026-05-31: module reorg — merged orig-016 (8-stage mcp lifecycle) + orig-017 (remote co-view = Irisy primitives) + lifted orig-024 §7 persona rule into this ADR + amended persona rule with prompt v5 (brain self-awareness with brand labels).
  - v2 2026-06-03: NEW §4 soul-md-compat — Irisy persistent memory adopts the SOUL.md spec (github.com/aaronjmars/soul.md) verbatim, ecosystem-aligned with OpenClaw (350k stars, 2,999+ ClawHub skills, WorkBuddy compat) and Claude Code. CTRL-only extensions land in an `x-ctrl:` frontmatter namespace so vanilla SOUL.md readers stay forward-compatible. Driven by bao 2026-06-03 competitive research summarised in `vault/ctrl/history/brainstorm/openclaw-compat-2026-06-03.md`.
  - v3 2026-06-04: **NEW §5 self-reflection-loop** — Irisy implements Loop 1 of ADR-001 §8 self-evolution. Three layers: client-side rule-based **Detect** (failure signals → episodes), Pi background subagent **Reflect** (Letta-code stateless mode, idle-30min trigger), playbook **Improve** (injected into next IrisyChat system prompt). Reuses ADR-002 §11 audit-ledger for cross-loop accountability. Per bao "不仅仅 Irisy LLM, 整个系统都要自我升级成长 — Irisy 自己有自我成长的能力". Brainstorm: `vault/ctrl/history/brainstorm/irisy-self-reflection-loop-2026-06-04.md` + `vault/ctrl/history/brainstorm/system-self-evolution-2026-06-04.md` §3.1.
  - v4 2026-06-04: **NEW §6 capability-decomposition + §7 pi-extension-integration** — root-cause fix for "Pi 一切动词都 install_mcp" + "Pi 说我没 skill 系统" 实测 fail. ctrl-pi-bridge 升级从 provider-only → registerTool + 3 hook (before_agent_start chain / tool_call inspector / resources_discover skills 贡献), Pi `--no-tools` → `--no-builtin-tools` (撤 7 个 built-in 但保 extension 注册的). System prompt 从 monolithic 200 行 → thin base (~30 行) + 8 capability segment, 通过 `before_agent_start` hook 按关键词动态注入 (token cache 友好). PWA `<call>` XML loop 保留作 Volc Qwen/Llama 弱模型 fallback. 调研: `vault/ctrl/history/brainstorm/irisy-pipeline-2026-06-04.md` v2 §3 (Pi/Letta/Cline/Goose/Cursor 对标) + §8 (background agent 深拉源码).
  - v5 2026-06-09: **Irisy reframed as PWA persona shell (H-2026-06-09-002).** bao 2026-06-09 校准: "Irisy 是表象". Irisy is **no longer a brain / agent runtime** — the brain role belongs to 3 external agents (hermes / opencode / kairo per ADR-002 §1 v19). Irisy is now the PWA UX persona layer: (1) **Avatar + branding** — Irisy character, voice, blink animation (Lottie). (2) **System-prompt injection** — wraps user message with CTRL substrate context (active provider info, Notes folder path, OS hint) before routing to whichever agent matches active L1 chip (default `/assistant` → hermes). (3) **Sycophancy filter** — `packages/ctrl-web/src/lib/persona-filter/patterns.md` (relocated from retired `packages/ctrl-pi-bridge/data/persona-patterns.md`). (4) **Drill-down** — long-press / Alt-click reveals raw agent output before filter. RETIRED sections: lifecycle (moves to ADR-004 § mcp execution), soul-md-compat (applies to hermes memory, not Irisy), self-reflection-loop (migrates to hermes as `~/.ctrl/skills/auto-reflect/SKILL.md`), capability-decomposition (no Irisy system prompt — agents own theirs), pi-extension-integration (Pi exited, ctrl-pi-bridge deleted). Per memory `feedback_no_redundancy_one_ssot` 🔒: hermes is the sole substrate-level agent memory primitive — Irisy doesn't duplicate.
  - v16 2026-07-04: **§8.6.1/§8.6.2 SHIPPED — the terminal frontend, built + verified.** bao 「继续做…」 across a long build. Delivered (each a commit): §8.6.1 work-trace (reasoning + tool-call steps, ACP `SessionUpdate` types adopted); the **review-gate moat** — NOT a new ACP-layer approval card as §8.6.2 planned but a RECONCILE to CTRL's EXISTING red-team-reviewed kernel `ReviewGate` (already wired to dispatch + mounted `ReviewGateHost` modal); the only fix was scope `is_first_party`→`is_user_surface` so it covers hermes (ADR-002 §264 v51, bao chose B) + reverting the duplicate ACP-layer approval I built before finding it (lesson: grep existing infra first); the **command surface, registry-driven** (`/` = `/new` + installed packs' actions; `:` jump = modules + packs; `@` vault notes/tables; `↑`/`↓` history — bao corrected my hardcoded capability list: CTRL is create/share/download, entries come from the registry); status line; session resume + **fork/checkpoint** (`irisy_reset_engine` + engine re-hydrate §8.4, also fixing a latent engine-memory-drift bug on switch); Blocks (re-run + fork-from-here); output-routing (auto-open a note Irisy writes). Status markers updated in the §8.6.1 table + §8.6.2 priority. Honest gap: real-data + engine round-trip verify on desktop (browser can't reach the kernel).
  - v15 2026-07-04: **§8.6.2 amend — verified build kit + detailed capability/resource plan.** 3 more research agents verified the reference SOURCE CODE + licenses (live from repos): official ACP SDKs moved to `agentclientprotocol` org and are **Apache-2.0** (crate `agent-client-protocol` + `@agentclientprotocol/sdk` + codegen `schema.json`) — adopt, retire hand-rolled `acp_client.rs` parsing; UI kit all MIT/Apache and 4/6 extend CTRL's existing Tiptap/CM6: `cmdk` + `@tiptap/suggestion`/`extension-mention` + `@codemirror/merge` (built-in per-hunk accept/reject) + `assistant-ui`(MIT) or AI Elements(Apache) chat shell + `agent-inbox` 4-flag approval (approve/deny/edit-args); Zed's UI = GPL, read-only reference. Avoid `@nlux/react` (MPL+AI-training clause), Open WebUI (branding). Detailed slash-set/modes/keyboard/approval/status/blocks plan → `vault/ctrl/history/plans/irisy-terminal-frontend-plan.md`.
  - v14 2026-07-04: **NEW §8.6.2 — terminal FRONTEND advantages + the reference to copy (5-facet web research).** bao 「前端也有不一样，发挥 terminal 前端优势 / 全网调研」. 5 parallel research agents (9 agentic CLIs · terminal renaissance · agent transparency/approval · REPL HCI primitives · keyboard-first consumer apps), cross-verified, full synthesis + primary sources in `vault/ctrl/research/terminal-frontend.md`. Decision: **Irisy's frontend = an ACP-contract-driven friendly GUI review client** (render ACP wire types as dialog + cards + approval + status; keep terminal SEMANTICS, GUI the delivery, drop the raw shell per §8.1). References to copy: contract → **ACP (Zed)**; form → **Zed + Warp**; write-gate moat → **LangGraph HITL + Copilot approval card** (approve/deny/edit-args, gated after-pick-before-execute, deferred write — CTRL today auto-allows via `select_allow_outcome`, the top gap); keyboard/command → **Raycast + GitHub/VS Code sigil palette**. Priority: ①✅ trace → ②★ inline approval → ③ command surface → ④ status line → ⑤ session fork/checkpoint → ⑥ Blocks.
  - v13 2026-07-04: **NEW §8.6.1 — the terminal-essence advantage map + surface the first three.** bao 「对比 terminal 本质和对话框本质的优势，将这些优势发挥出来」. A dialog box = one stateless Q→A (context rebuilt per turn, tool use hidden, no session object); terminal-essence (engine owns loop+context) is strictly more powerful, and each advantage is a moat vs the default chatbot. Shipped the live WORK-TRACE (advantages #1–3): a per-turn **reasoning trace** (`chat-stream-thought` ← `agent_thought_chunk`, collapsible "Thinking") + **tool-step chips** (`chat-stream-tool` ← `tool_call`/`tool_call_update`, drill-down to raw I/O §6). Kernel now maps ALL of the engine's session/update kinds (`acp_client.rs` `AcpEvent` + `parse_session_update`) instead of dropping everything but the answer text. Roadmap in §8.6.1: #4 session resume/list/fork (engine-advertised), #5 mid-loop steering, #6 slash/@-mention, #7 usage chip. Rule: surface the ESSENCE, keep the friendly dialog FORM (§8.1 "not a raw shell"). Empirical basis captured 2026-07-04.
  - v12 2026-07-04: **§8.5 acceptance verified — terminal-essence is REAL (not just designed).** bao 「验证 terminal 本质」. All three §8.5 criteria confirmed: (#1 routing) `irisy_chat.rs` `use_agent = !coding_mode && !force_direct && engine_ready` sends EVERY non-coding turn to the single persistent engine — `turn_needs_agent` no longer gates it (comment §8.3, tests-only now); (#2 no-nuke) on a prompt error CTRL keeps the LIVE session and resets only when `!c.is_alive()` (process genuinely dead) → re-hydrate, never per-turn amnesia; (#3 continuity) **runtime-proven** — a controlled 2-turn ACP test drove a fresh `hermes-acp` (same spawn as `acp_client.rs`) on ONE session: turn 1 stated codeword `sky-anchor-7731`, turn 2 recalled it verbatim without restating (`acp_continuity_test.py`, 29s). Engine = single long-lived process per app-session (verified PID). `primed` flag confirms §8.4 re-hydration (first turn = system + brief + prior-turn replay; continuing turns = last_user only). Form stays a friendly dialog (§8.1/§8.6 lock: "not a raw shell") — the terminal is the ESSENCE (engine owns loop+context), not the look. No decision change; records verification per dev-loop.
  - v7 2026-06-28: **NEW §8 terminal-essence dialog — the engine owns the loop + context (continuity root-fix).** bao 2026-06-28 钦定: Irisy 的对话「**对话框形态, terminal 本质**」—— 友好对话 UI 罩在一个**持久 REPL 引擎**上, 引擎自持 agent loop + 对话上下文 (Claude Code / Codex 同模型), 正是 ADR-001 spine §byo-cli-driver + ADR-002 §brain 早已钦定的「调度权在 CLI/引擎手里, CTRL 不 supervise/编排 loop」。根治 §8.2 三条失忆 (每轮只发 last_user / 一出错就 nuke session / 路径切换两后端不共享记忆) —— 把实装拉回架构本位: CTRL 停止「半管」一个它不该拥有的 loop+context, 回到 projection+gate。「先不用管 provider」(bao): 引擎单元就用现有 hermes, 暂不动 provider/模型层; provider-direct 降为「引擎缺席/离线」纯 fallback, 不再参与正常对话记忆。Supersedes §1「对话持续」intent 的脆弱实装。
  - v9 2026-06-28: **§8 amend — NEW §8.7 consolidation: left/right regions + the right-region pluggable ACP engine.** bao design pass 2026-06-28 (「你分开一下,左边区域和右边区域」+「Irisy 不是可以选择是 Hermes 或者 Codex 么」). **左区** = workspace/输出 (per-L1; coding 模块的工作区是真终端 PTY, 跑用户**自驱**的 coding agent — Claude/Codex/shell, CTRL 只投影不 supervise)。**右区** = Irisy (单一品牌 persona), **引擎可选 Hermes/Codex/Claude**, CTRL **经 ACP 驱动**之。机制 = ACP (JSON-RPC over stdio): `hermes-acp` (已驱动) / `@zed-industries/codex-acp` / `claude-code-acp` 同协议, `acp_client.rs` 参数化 spawn 即可。**driven(右) vs projected(左)** 区分: 同一 Codex 两区不同角色 (右=被 CTRL 当脑驱动, 左=被用户当 driver), 「不 supervise BYO」只管左区。纠正 §8.6 两处过度声明 (并非所有 surface 同引擎 — 左区 coding 终端不是 Irisy 引擎, `coding_mode` 绕开引擎是对的; BYO 选中不是「死路 handoff」而是 ACP 真驱动流式作答)。坐实 §8.4 真修法 (transcript 回灌 fresh session, 否则只是 UI 记得引擎忘了)。配对 **ADR-002 §brain amend** (hermes→「CTRL 驱动的可选 ACP 引擎」, hermes 仍默认不退役)。§8.7 与 §8.6 冲突时以 §8.7 为准。
  - v10 2026-06-29: **§8 amend — NEW §8.8 one-click managed install for right-region BYO engines (replaces the copy-command-into-terminal hand-off).** bao 2026-06-29 钦定: 「你希望普通用户这么安装配置吗?普通用户只会一键安装」。§8.7 把 Codex/Claude 当右区引擎驱动了, 但 InstallAgentModal 还在让用户「复制 `npm i -g` 进终端」—— 那是开发者工具的默认装法, 不是 CTRL 模型。**校准**: ① 普通用户**零安装**停在 hermes (CTRL bundle + uvx 自启, 默认引擎, 用户啥都不用动)。② 真要用 Codex/Claude 的人走 **CTRL 一键托管安装** —— 装进 CTRL 自管的 `~/.ctrl/agents/<id>/` (本地 npm `--prefix`, **不全局、不 sudo、不开终端**), 运行时 (Node) 像 `ensure_uvx` 一样**自举** (`ensure_node`, 零前置依赖, 沿用 ADR-002 §1.2 v20「kernel bootstraps what it needs」)。③ 装完只剩一次性 provider 认证 —— 尽量复用用户已在 CTRL 配的 BYOK key (Keychain, 注入 adapter 子进程 env), 否则引导式登录; key 永不入 Irisy/LLM。**driven(右)= CTRL 装+驱动** 与 §8.7「不 supervise BYO」(只管左区 projection) 不冲突 —— 右区引擎本就是 CTRL 拥有的。InstallAgentModal 从「复制命令」改成**一键 Install 按钮 + 进度 + ready**。开放点 (codex-acp↔托管 codex 的 PATH 接线 / Node·codex release asset 名 / claude-code-acp 包名) 真机验证, ADR 内诚实标注 pending。
  - v8 2026-06-28: **§8 amend — NEW §8.6 unified terminal-essence frontend + selectable agent on every surface.** bao 2026-06-28 钦定: 「前端都是 terminal 实质的, 统一, 可选 agent」。§8.1 的「对话框形态, terminal 本质」**不局限于 Irisy ambient chat —— 它是整个前端的统一交互模型**: 每个 surface (ambient chat / coding L1 / per-L1 workspace / 任何 agent 面) 底下是同一个东西 = §8.3 terminal-essence session (引擎自持 loop+上下文) + **可换的 agent = "shell"** (hermes 内嵌 / Codex / Claude Code BYO, `list_byo_drivers` agent 轴)。统一 = 一套模型 + 一个共享 `active-agent` 选择器贯穿所有 surface (不是 N 个各自为政的 chat/terminal 部件); 切 agent = 换 shell, 不重置 persona/功能包 (正交轴)。embedded vs BYO 诚实性逐 surface 成立。配对 ADR-003 § frontend。
  - v6 2026-06-25: **§persona-shell + §3 amend — 单一品牌声音 → 可灵活配置的功能角色 (bao 理念「每个功能配 persona + 功能包,灵活配置不焊死」).** Amends `decision_one_persona_irisy`: Irisy 仍是**单一品牌/声音/形象** (绝不分裂成 Janus/Talos 多重人格),但新增**可切换的功能角色** = 每个 L1 一份 `(persona, 功能包[])` 的**灵活配置**。persona 池与功能包池**解耦**、可组合、可跨 L1 复用 —— 换 persona / 加功能包 = 改配置,不动代码 (✗ 不是焊成一个不可分单元)。当前角色显示 + 切换在**对话框上方**;切角色时对话流持续 (不重置)。Supersedes §3「no global persona library」:现在有一个小的策展角色池 + 每-L1 配置,但仍是**扁平配置**不是 brain-self-aware indirection mesh。**L1 ≠ 角色** (L1 = 功能模块含数据/workspace;角色 = 其 persona 配置面)。设计 SSOT = `vault/ctrl/irisy-roles.md`。开放点 (L1↔角色联动 / 初始角色集 / 用户自建角色 v1) 在该文档跟踪。配对 ADR-003 § home (角色切换器 UI)。不动 sycophancy filter / drill-down / 单一品牌声音锁。
related:
  - vault/ctrl/adrs/002-substrate.md
  - vault/ctrl/adrs/003-frontend.md
---

## §1 8-stage mcp lifecycle — retired-v42 intent provenance

> **RETIRED as an intent authority in v42.** The "User intent" column below is historical provenance only. It predates the fixed-identity model and still names retired Pool/keycap/persona surfaces. §12 is the sole user-intent registry; this table must not be cited for product scope, UI conformance, or capability mapping.

Irisy = vertically-cross-cutting companion. **8 stages**, each with explicit role + UI surface.

| # | Stage | User intent | Irisy role | UI surface |
|---|---|---|---|---|
| 1 | Discovery | "what tools exist for X?" | Recommend mcps by use-case query; surface MCP marketplace + agentskills.io results | Pool overlay, Irisy as filter/rank layer |
| 2 | Creation | "I need a mcp that does X" | Co-author manifest + tool code | Creator drawer (chat / manifest / code preview) |
| 3 | Config | "set up this mcp for me" | Walk through `config_schema`; suggest defaults | Inline Irisy bubble on first invocation OR Settings |
| 4 | Invoke | "do this" | Disambiguate vague intent → mcp selection; pre-fill args; explain expected result | Keyboard tile long-press / quick-action overlay |
| 5 | Collab | "explain what just happened" / iterate | Annotate output; chain to next mcp; co-edit | Workspace tab side-panel (drawer adjacent to active tab) |
| 6 | Debug | "didn't work — why?" | Read stderr / ST-SS error cells; suggest fix; offer to amend manifest | Workspace tab inline error overlay |
| 7 | Improvement | "this could be better at X" | Capture as Patch-tier amendment (ADR-004 §4); offer upstream PR when applicable | Bubble after repeat use; long-press → "improve this mcp" |
| 8 | Retire | "I don't use this anymore" | Help uninstall / archive; preserve vault data; reset keychain tokens | Settings drawer when usage falls below threshold |

**Companion ≠ in-your-face**:
- Default visibility = bubble (collapsed); user click → drawer
- **Single brand voice, switchable functional roles** (amends `decision_one_persona_irisy` 🔒, v6 2026-06-25) — Irisy stays ONE character / voice / brand (never splits into Janus/Talos multi-personalities), but exposes **switchable functional roles** = a flexibly-configured `(persona + toolset)` per L1, shown + switched **above the chat box**, conversation persisting across switches. Switching a role ≠ splitting the persona. Persona pool ⊥ toolset pool (decoupled, composable, cross-L1 reusable; swap/add = config not code). **L1 ≠ role** (L1 = module incl. data/workspace; role = its persona facet). The authoritative actor and role boundary is §11; the retired `irisy-roles.md` file is historical provenance only.
- **First-class PWA page**, not a mcp (memory `decision_irisy_is_pwa_native_not_keycap` 🔒)
- Drawer slides from bottom or right; never full-screen takeover (ADR-003 § nav-keyboard)

Stage 7 → 2 loopback (Improvement feeds new Creation) is the creator-economy flywheel.

**v1 ship**: stage 1 (Chat / Assistant) only via `IrisyChat.tsx`. Stages 2-7 = v1.1+ per memory `feedback_no_planning_no_phasing`.

## §2 Remote co-view — semantic "remote window" (SHIPPED v20, option B)

> **v20 status (2026-07-07): SHIPPED as "remote window" — option B (semantic / phone-native PWA), relay-only + E2E.** The phone runs the SAME CTRL PWA, joins the desktop over a zero-knowledge relay, and renders the desktop's allowlisted functions NATIVELY (JSON semantic surfaces — e.g. the stock cockpit — NOT pixels). This SUPERSEDES the original "on mesh / not in v1 scope" framing below for the semantic path. **A vs B**: pixel remote-desktop (screen mirror + input inject, ToDesk/RustDesk-style) is the SEPARATE, unbuilt **ADR-010 ⑧** module — the `feat/remote-window-share-spike` worktree explored it and was NOT taken. Governing plan + research + HA-Companion benchmark: `vault/ctrl/plans/remote/plan-remote-window.md`.
>
> **As-built (`feat/remote-window`)** — frontend-only, no kernel/Rust (the running desktop PWA is the host peer):
> - **L1 `/remote` config page** — per-device, deny-by-default allowlist: each function (built-in face + installed pack) toggles visible-on-phone + view-only vs can-act. Out-designs HA's leaky per-user dashboard visibility.
> - **Mobile shell** — bottom-nav that switches the allowlisted functions, each rendered natively (the built-in bottom-nav HA users have long requested and HA still lacks).
> - **Transport = relay-only + E2E** (researched best practice, ngrok/VS-Code-Tunnels/HA-Cloud shape; NO WebRTC — JSON not video). `worker/ctrl-relay` = zero-knowledge CF Worker (opaque 2-peer forward, reused from the spike). `remote-crypto` = AES-256-GCM frames sealed with a key carried in the pairing link's fragment — the relay (and CTRL) only ever forward ciphertext, anchoring trust in the phone↔desktop pairing (beats HA-Cloud's cloud-owns-trust-root MITM hole). `RemoteHost` (desktop) dials the room + serves allowlist + proxies gate-calls to the local `:17873` gate; `RemoteConnection` (phone) joins via `?remote=<room>#k=<key>` and tunnels gate invokes.
> - **bao's decision — strict 0-listening-ports = relay-only**: LAN also hairpins the relay; offline-LAN-direct deliberately DROPPED (would reintroduce HA's two most-complained subsystems — SSID local/cloud switching + the blocking connection-lost wall).
> - **Honest gaps**: relay deploy (CF account) + real phone↔desktop round-trip = bao's device.

The original design intent (historical — the semantic path is now shipped relay-only, NOT on mesh):

Memory `project_remote_co_view_is_irisy` 🔒 — 远程同屏 / mirror / 跨设备 viewer / session 接管 are Irisy primitives layered ON mesh (ADR-002 § crypto), not mesh itself. Mesh = CRDT state sync; co-view = live observability + interaction over a session.

**4 primitives** (zeus owns kernel substrate, daedalus owns Irisy UI):

1. **`session.observe`** — viewer-side Irisy subscribes to host-side kernel's ST-SS workspace cell stream (filtered by allow-list of cell kinds). Read-only by default.
2. **`session.share`** — host-side Irisy generates ephemeral share URL (`ctrl://session/<id>?token=<...>`). Token authenticates viewer kernel to host kernel's MCP wire (ADR-002 § mcp-bus, port 17873 OR relay-traversed equivalent for cross-device).
3. **`session.takeover`** — viewer can send Op events back to host (clipboard write / mcp invoke / Irisy say). Requires explicit allow-list in `share` token (capability-scoped per ADR-004 §1).
4. **`session.narrate`** — viewer's Irisy renders narration overlay: "your phone Irisy is observing your PC; current mcp = X; recent action = Y". Generated client-side from cell stream.

**Wire**:
- Same-LAN (mDNS-discovered): direct WebRTC peer via vodozemac Olm (same Olm session that mesh uses)
- Cross-NAT: `ctrl-relay` Worker (STUN/TURN-like NAT traversal); payload E2E encrypted (relay sees only encrypted blobs)
- Underlying = ST-SS cell stream subset over WebRTC data channel
- NOT a separate transport — same stack as mesh; difference is what flows through

**NOT promised**:
- Not a remote desktop tool — CTRL streams workspace cells (semantic events), not pixel buffers
- Not in v1 scope — primitives roadmapped to v1.1 once mesh + Irisy 8-stage stable

## §3 Persona rule — retired-v40 provenance

The former binding persona pool, per-L1 role composition, and switcher rules are removed from live authority. They were introduced before the fixed-identity model and remain traceable through changelog/git history. Irisy now has one fixed identity; method variation comes from an optional pinned Skill and capability scope under §11 v40. Prompt implementation may define one fixed Irisy voice but cannot expose a role/persona registry.

## §4 SOUL.md compat — Irisy persistent memory is the SOUL.md spec (NEW v2, 2026-06-03)

**Why this section exists**: bao 2026-06-03 competitive research locked
the ecosystem-alignment call. OpenClaw passed 350k GitHub stars in 60
days, ClawHub holds 2,999+ community-built skills, Tencent WorkBuddy
already ships OpenClaw compat. **SOUL.md**
(github.com/aaronjmars/soul.md) is the persona/memory config file
recognised by *both* OpenClaw and Claude Code — crossed from "single
project" to "protocol standard", the same way MCP did for tool
calling. CTRL standing outside this standard while building a
parallel manifest = creators have to pick one to invest in, and they
already picked SOUL.md.

Full strategic analysis: `vault/ctrl/history/brainstorm/openclaw-compat-2026-06-03.md`.

### §4.1 Lock — SOUL.md is the canonical Irisy memory format

Irisy persistent memory at `vault/irisy/SOUL.md` (single file) plus
`vault/irisy/.irisy-memory/` (sub-files referenced from SOUL.md) **MUST**
conform to the SOUL.md spec at github.com/aaronjmars/soul.md. Spec
version pinned per the latest reviewed upstream commit; pin recorded
in `vault/irisy/.soul-md-version` so a future spec churn is auditable.

memory `decision_pi_is_sole_brain_hermes_is_keycap` already mentioned
the file by name but the *format* was unlocked; this section closes
that gap.

### §4.2 CTRL extensions — the `x-ctrl:` frontmatter namespace

CTRL-only fields (Pi provider routing hints, mcp activation rules,
vault layout overrides, etc.) live under an `x-ctrl:` frontmatter
key. Vanilla SOUL.md readers (OpenClaw, Claude Code, future
implementations) ignore unknown keys, so the file stays
forward-compatible.

Example shape:

```markdown
---
# Standard SOUL.md fields — read by OpenClaw, Claude Code, CTRL.
name: bao
voice:
  tone: direct
tools:
  - id: clipboard
    surface: mcp
memory:
  long_term: ".irisy-memory/long-term.md"
  episodes:  ".irisy-memory/episodes/"

# CTRL-only — never required by upstream readers.
x-ctrl:
  provider_routing:
    primary: claude-oauth
    fallback: volc
  mcp_activation:
    auto_invoke_on_paste: false
  vault_layout:
    review_queue: ".ctrl/review-queue/"
---

# About me

I am bao. I build CTRL — an ambient Ctrl-hotkey workbench …
```

The body (after frontmatter) is free-form markdown per the SOUL.md
spec — Irisy reads it verbatim, additional structure (Headings as
section pointers) is documented at the spec, not in this ADR.

### §4.3 Read / write surface

Three call surfaces, all SOUL.md-aware:

| Surface | Read | Write |
|---|---|---|
| **Pi brain** (Irisy agent loop) | At every turn via kernel-injected `<soul>` block | Asks user before mutating frontmatter; episodic notes append to `.irisy-memory/episodes/<date>.md` directly |
| **Settings → Irisy panel** (PWA) | Structured form over the frontmatter + body sections | Direct edit; saves through `vault_write` with frontmatter preserved |
| **MCP** (`irisy.soul_get` / `irisy.soul_set`) | Available to external agents (Cursor, Claude Code itself) so they can read CTRL's soul | Auth-gated; mutations emit an event so the user sees a notification |

Implementation deferred to the next code session (next chunk after
the kairo parity Notes app).

### §4.4 Bridge to OpenClaw skills (forward reference)

CTRL mcp manifests and OpenClaw skill manifests are bidirectionally
convertible per the "marketplace bridge" move recorded in the
brainstorm doc. The schema bridge will land in **ADR-002 substrate
§7 composition v1 amendment** in a follow-up session (paired with the
`packages/ctrl-mcp-sdk/src/openclaw-bridge.ts` transformer). This
section asserts the intent; the schema lock lives in ADR-002.

### §4.5 First-boot seed

`src-tauri/src/kernel/vault.rs::seed_vault_feature_layer` extends to
write a starter `vault/irisy/SOUL.md` on first launch when the file is
absent — same idempotent policy as the existing sourcing.yaml /
daily-notes.yaml seeds (§8 vault feature-layer). The seed template
ships SOUL.md-compliant scaffolding plus a commented `x-ctrl:` block
the user can uncomment to opt into the extensions.

### §4.6 Spec churn policy

SOUL.md is young. Each upstream tag we pin to gets recorded in
`vault/irisy/.soul-md-version`; bumping the pin requires:

1. Review of upstream changes for compatibility with the `x-ctrl:`
   namespace (no key collisions).
2. Update of the seeded template in `vault_seed/`.
3. Migration note in this section's changelog if existing user soul
   files need transformation.

The spec is maintained by aaronjmars (separate project), not
Steinberger, so even if OpenClaw the runtime forks / vendor-pivots,
SOUL.md as a format has independent governance.

## §5 Self-reflection loop v1 — Irisy grows itself (NEW v3, 2026-06-04)

bao 2026-06-04: "Irisy 应该有自我反思 / 自己提升的过程; 整个系统都要自我升级成长 — Irisy 自己有自我成长的能力". This section is Irisy's slice of ADR-001 §8 self-evolution (Loop 1).

### §5.1 Three-layer architecture (Detect / Reflect / Improve)

bao chose **in-session granularity** but per-turn LLM reflection is not viable (Reflexion / Self-Refine warn "over-reflection degrades agents"). Resolution: **detect every turn (zero LLM cost), reflect on-demand (one LLM call), improve via next-turn prompt injection**.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  Detect (per turn, 0 LLM)                                               │
│    • client-side rule scanner in IrisyChat.tsx after stream completes   │
│    • signals: user_rephrase / negative_feedback / banned_preamble /     │
│      tool_call_fail                                                     │
│    • hit → append vault/.irisy-memory/episodes/<date>.md                │
│                                                                         │
│  Reflect (on-demand, 1 LLM call via Pi background subagent)             │
│    • trigger: idle 30 min OR ≥5 negative episodes OR user-asked         │
│    • subagent mode: stateless, mode=stateless (Letta-code pattern)      │
│    • reads recent episodes → emits do-list / don't-list /               │
│      SOUL.md `x-ctrl:lessons` updates                                   │
│    • writes vault/.irisy-memory/reflections/<date>-<HHmm>.md            │
│                                                                         │
│  Improve (next turn, prompt injection)                                  │
│    • buildSystemPrompt appends playbook ## Do + ## Don't sections       │
│    • cap at 1500 chars; LLM consolidates when exceeded (Mem0 pattern)   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### §5.2 Detect rules (client-side, no LLM)

| Signal | Rule | Severity |
|---|---|---|
| `user_rephrase` | Levenshtein(prev_user, cur_user) > 0.6 AND contains rephrase hint (`重新` / `不是` / `重来` / `我意思`) | high |
| `negative_feedback` | cur_user contains negative word (`错了` / `不对` / `wrong` / `nope`) | high |
| `banned_preamble` | assistant message starts with banned phrase (`Sure!` / `我来分析` — prompt v5 already forbids these but they leak) | low |
| `tool_call_fail` | any tool call in turn returns success=false | high |

Implementation: `packages/ctrl-web/src/lib/irisy-reflection.ts` (new file). Pure function, no Tauri call needed for detect itself.

### §5.3 Reflect — Pi sleep-time subagent

Pattern: **Letta-code reflection subagent** (`letta-ai/letta-code/src/agent/subagents/builtin/reflection.md`).

- **Stateless** — receives full context as input, returns single report, no persistent memory between runs
- **Background** — runs while main IrisyChat is idle; does not block user
- **Sleep-time consolidation** — analogy to human sleep; main agent unaffected during processing
- **Read-write to vault only** — uses Pi's built-in Read / Write / Edit tools; no other tool surface

Trigger conditions (OR, any one fires):
1. App idle ≥ 30 min AND there are unprocessed episodes
2. ≥ 5 negative episodes accumulated since last reflection
3. User explicitly asks ("复盘一下" / "what should I change" / "你最近怎么样")

Reflection prompt template lives at `vault/.irisy-prompts/irisy-reflect.md` (managed alongside system prompt, not hard-coded — user can read & override).

After reflection completes, episodes are moved to `.irisy-memory/episodes/_archived/<date>/` so the next reflection trigger does not redundantly process them.

### §5.4 Improve — playbook injection

After every reflection, write the do/don't rules to `vault/.irisy-memory/playbook.md`:

```markdown
# Irisy Playbook — auto-curated from reflections

> Auto-maintained by Irisy. Edit / delete freely. Mark "keep" to lock against auto-removal.

## Do
- Give the conclusion in the first sentence on technical questions (2026-06-04 reflection)
- Match the user's language: Chinese in, Chinese out (2026-06-03 reflection)

## Don't
- Do not narrate the tool-call process to the user (prompt v5 lock, leaked 2 times)
- Do not fabricate code when uncertain; grep first (2026-06-04 reflection)

## Keep (user-pinned — Irisy must not auto-remove)
- User prefers YAML over JSON for cap manifests
```

`buildSystemPrompt()` in `IrisyChat.tsx` adds a §5 segment after the existing §1 brain state / §2 core memory / §3 SOUL.md long-term / §4 memory index segments. Only `## Do` + `## Don't` reach the prompt; `## Keep` is for user reference and prevents auto-deletion by future consolidations.

### §5.5 SOUL.md `x-ctrl:lessons` field

High-priority cross-session lessons (≤3 per reflection) escalate from playbook into SOUL.md `x-ctrl:lessons` array. The `x-ctrl:` namespace is CTRL-only (§4.3) so this auto-write does not need to ask the user (unlike standard SOUL.md frontmatter mutations, which do). UI signals the write with a non-blocking red dot in Settings → Irisy that links to the diff.

### §5.6 Audit ledger integration

Every Detect / Reflect / Improve event writes a row to the audit ledger (ADR-002 §11) with:
- `loop_id` = `irisy_reflection`
- `stage` = one of `detect` / `diagnose` / `plan` / `execute` / `verify` / `learn`
- `evidence` = the offending turn snippet (Detect) or reflection report path (Reflect/Improve)
- `correlation_id` = ties all 6 stages of one reflection cycle together

Users can query "show me last week's Irisy self-corrections" via Settings → 自我升级 → Loop 1 filter.

### §5.7 Verification — did reflection actually help?

Three objective signals:
1. **negative_episode_rate / 100 turns** must trend down month-over-month
2. **same-rule re-hit rate** (hash of rule signature) must trend → 0
3. **user-initiated 复盘 frequency** should drop (user not having to ask = Irisy is fixing itself)

If signal 1 or 2 trends *up* over a 14-day window, audit ledger fires a meta-signal that triggers Loop 5 (system self-healing) — the reflection mechanism itself is broken.

### §5.8 Retired Pi upstream tracking (historical provenance)

> **Retired in v7/v23.** The following paragraph records the former Pi implementation constraint; it is not a current runtime or follow-up plan.

Pi 0.73.1 declares `./hooks` package.json export but the dist directory is empty — upstream hooks aren't shipped. CTRL implements §5 by intercepting `transport.stream()` completion in IrisyChat.tsx (PWA-side, no Pi mod). When Pi ships `on('turn-end')` hooks upstream, the detect code moves into a Pi extension (`@ctrl/pi-bridge`); the detect functions themselves are reusable since they're pure data → signal mappings. Per memory `feedback_pi_is_core_use_upstream_surfaces`: use upstream surface when available, this is the temporary path.

### §5.9 Historical acceptance (retired v7; non-binding)

- [~] Pi-era Irisy reflection/playbook implementation criteria below were retired with the Pi-owned loop; current self-evolution work must be re-specified under the Hermes/gate architecture before becoming binding.
- [~] Former `irisy_reflect` Pi background-subagent, Pi prompt assembly, and Pi-era UI/manual checks are preserved only in this section's provenance.

## §6 Capability decomposition (NEW v4 — 2026-06-04; RETIRED v7, historical provenance)

### §6.1 Why decompose

Pre-v4 Irisy ran one monolithic `IRISY_SYSTEM_DEFAULT` block (~200 行, 8 topics interleaved). Real-world failure mode: Pi anchored on the most repeated rule ("install_mcp for any wish") and ignored the antecedent ("only when user said 键帽/key/shortcut"). bao 2026-06-04 实测: "创建一个 md" → Pi went straight to install_mcp with frontend-slide skill instead of vault_write. **Root cause** = no decomposition: Pi can't down-weight the wrong path because every rule is in scope every turn.

Industry consensus (`vault/ctrl/history/brainstorm/irisy-pipeline-2026-06-04.md` §3): Letta uses per-agent-type prompt templates (`letta/prompts/system_prompts/*.py`); Cline uses `TemplateEngine.resolve(template, context, vars)` with `components/` + `variants/`. Both decompose by **task context**, not by topic.

### §6.2 8 capabilities

Each capability has: trigger words / scenes, owned kernel tools (Tauri command names), output format, and a dedicated prompt segment (15-25 行 each). The base persona segment (~30 行) is always injected; capability segments are picked by keyword pre-screen in `before_agent_start` hook (§7.2).

| # | Capability | Triggers (CN / EN) | Tools | Output |
|---|---|---|---|---|
| **C1** | **Note Writer** | "写笔记 / 草稿 X / 帮我写 md / draft a note / save this" | `vault_write` | one-line ack + path link |
| **C2** | **Cap Builder** | "做个键帽 / 键 / 按钮 / 一键 X / 我经常 X / a key for / a shortcut" | `list_local_skills` + `install_mcp` | one-line confirm new cap |
| **C3** | **Cap Invoker** | "用 frontend-slide / 跑那个键 / run X cap / 触发 X" | `mcp_run` (new Tauri command) | streamed cap output + status |
| **C4** | **Knowledge Retriever** | "我前几天写啥 / 关于 X 的笔记 / 搜下 vault / find my notes on X" | `vault_search` + `vault_read` + `vault_tags` + `vault_backlinks` | cited extracts with `path:line` |
| **C5** | **Memory Curator** | bg trigger (every N=5 turn OR idle 30min OR user-asked) | `vault.read SOUL.md` + `vault.write` (x-ctrl:lessons frontmatter) | silent — sleep-time subagent (§5) |
| **C6** | **System Doctor** | "切 provider / 我用什么 model / Irisy 慢 / 怎么登录 / where's my key" | `brain_status` (read-only) | one-line指引 to Settings → Providers |
| **C7** | **Coding Companion** | session.mode == 'coding' OR project_dir set OR "code this / fix bug / 改下代码" | Pi 自带 read/write/edit/bash/grep/find/ls + `vault_write` | unified-diff style change report |
| **C8** | **Conversation** | "你是谁 / 哈喽 / Irisy 怎么样 / 你能做什么" | none | natural language, 1-2 sentences |

**Trigger discipline** (the lock that fixes the install_mcp bug):
- C2 fires ONLY when user used 键帽/键/按钮/一键/key/shortcut/button/tool I can reuse. **Default = C1 (one-shot write) or C8 (chat)**, NEVER C2.
- When user's intent is ambiguous, the assistant asks ONE short question: "做完这一次就行,还是想以后一键再来?" Then routes accordingly.
- C3 fires when user names a known mcp by id or display name; routes to `mcp_run` (Tauri command, ADR-007 § cap-run v1 referenced below).

### §6.3 Segment storage

Capability segments live in `packages/ctrl-web/src/lib/irisy-prompts.ts` as named exports:
- `IRISY_BASE_PERSONA` — always injected (~30 行: persona, brand-label, reply style, identity lock)
- `IRISY_CAPABILITY_SEGMENTS: Record<CapabilityId, string>` — 8 segments per §6.2
- `pickCapabilitySegments(userText: string, mode: SessionMode): CapabilityId[]` — keyword pre-screen returning 1-3 most relevant segments

The vault override path (`vault/.irisy-prompts/<segment>.md`) is preserved per §3 — users can override individual segments without forking the whole persona.

### §6.4 Historical acceptance (retired v7; non-binding)

- [~] The Pi/PWA prompt-decomposition implementation and its manual tests were retired with the Pi-owned loop. Any current prompt segmentation must be specified under §8's selected engine contract before becoming binding.

---

## §7 Pi extension integration (NEW v4 — 2026-06-04; RETIRED v7, historical provenance)

### §7.1 Why expand ctrl-pi-bridge

Pre-v4 `ctrl-pi-bridge` only called `pi.registerProvider('ctrl-bridge', {streamSimple})` — a single seam routing LLM calls back to the kernel provider chain. This is correct but incomplete. Three failure modes traced 2026-06-04:

- **B1 (Pi 0 tool)** — `ctrl-pi-plugin/pi-bridge.ts:242` spawns Pi with `--no-tools`; bridge doesn't `registerTool`. Pi has zero functions to call, so it falls back to text-only output. Test transcript: Pi explicitly told user "我没有 skill 系统" because, from Pi's perspective, it really didn't.
- **B2 (XML-only protocol)** — System prompt teaches `<call name="X">{...}</call>` to fake a tool interface. Frontier models (Anthropic / OpenAI) prefer native function calling; XML is leftover ReAct convention. The PWA `irisy-tool-dispatch.ts` loop is the only thing keeping it working.
- **B3 (monolithic prompt — §6 fixes this from the prompt side)**

### §7.2 Pi extension API used (verified against `~/.ctrl/pi/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts`)

```ts
// All 4 surfaces ctrl-pi-bridge will call:
pi.registerProvider(name, {streamSimple})                          // existing v3
pi.registerTool<TParams>({name, label, description, parameters,    // NEW v4 — ~10 tools
                          execute, promptSnippet?, promptGuidelines?})
pi.on('before_agent_start', (evt, ctx) => {                        // NEW v4 — chain hook
  // return { systemPrompt: '...' } — Pi chains across extensions
})
pi.on('tool_call', (evt, ctx) => {                                 // NEW v4 — inspector stub
  // return { block: true, reason: '...' } to veto dangerous calls
})
pi.on('resources_discover', (evt) => {                             // NEW v4 — skills bridge
  // return { skillPaths: ['~/.claude/skills/.../SKILL.md', ...] }
})
```

Pi ToolDefinition is TypeBox-shaped (TParams extends TSchema). ctrl-pi-bridge **cannot import @sinclair/typebox** because Pi loads the extension from `<.app>/Resources/pi-bridge/index.ts` where Node module resolution can't reach Pi's node_modules. Resolution: inline a 30-LOC mock (`T.Object` / `T.String` / `T.Optional`) producing the same JSON Schema shape at runtime; cast via `as unknown as TSchema` to satisfy TS.

### §7.3 Tools registered

10 tools, each is a thin HTTP-fetch wrapper to kernel provider port (`CTRL_PROVIDER_PORT` env, same path already used for `streamSimple`):

| Tool name | Capability | Wraps Tauri command |
|---|---|---|
| `vault_write` | C1 (Note Writer) | `vault_write` |
| `vault_read` | C4 (Knowledge Retriever) | `vault_read` |
| `vault_search` | C4 | `vault_search` |
| `vault_tags` | C4 | `vault_tags` |
| `vault_backlinks` | C4 | `vault_backlinks` |
| `list_local_skills` | C2 (Cap Builder) | `list_local_skills` |
| `install_mcp` | C2 | `install_mcp` |
| `list_mcps` | C2/C3 | `list_mcps` |
| `mcp_run` | C3 (Cap Invoker) | NEW Tauri command per §7.5 |
| `brain_status` | C6 (System Doctor) | `brain_status` |

C7 (Coding Companion) uses Pi's own `read` / `write` / `edit` / `bash` / `grep` / `find` / `ls` — kept enabled by switching `--no-tools` → `--no-builtin-tools` (negates only the built-in default; extension-registered tools still load).

### §7.4 Hook responsibilities

**`before_agent_start`**: examine `evt.prompt` (raw user text) + session state, call `pickCapabilitySegments()` (§6.3), return `{systemPrompt: <base + selected segments>}`. If multiple extensions register, Pi chains — ctrl-pi-bridge runs first, others append after.

**`tool_call`**: stub that always passes today; documented hook point for ADR-006 §4 policy-envelope (autonomy ladder). v1 watches for repeated identical calls (5+ in a row → block as "tool loop detected") so a runaway Pi can't loop forever on the same broken vault path.

**`resources_discover`**: scan `~/.claude/skills/*/SKILL.md` + `~/.ctrl/plugins/cache/**/SKILL.md` and return them as `skillPaths`. Pi auto-loads as native Skills, exposing `/skill:<name>` slash commands. CTRL's own `list_local_skills` Tauri command keeps the same discovery code (§7.3) so both surfaces share one source of truth (`feedback_no_redundancy_one_ssot`).

### §7.5 New Tauri command — `mcp_run` (for C3)

Tauri command `mcp_run({mcp_id: string, args: Record<string, unknown>}) → McpInvocation`. Locates the manifest in `~/.ctrl/mcps/<mcp_id>/`, spawns its runtime (MCP server / built-in handler / local agent per ADR-004 §1), pipes args, streams result back through the same `chat-stream-delta` Tauri event (so ctrl-pi-bridge can render output inline). When the mcp is a SKILL-derived one, the args dict is the skill's `{{var}}` placeholders.

### §7.6 PWA XML fallback retention

`packages/ctrl-web/src/lib/irisy-tool-dispatch.ts` (the XML loop I added 2026-06-04) **stays as fallback** for the Volc / CF Workers AI / Qwen-3 / Llama-3.3 path — these models JSON-format inconsistently, and Cline runs into the same constraint (`apps/vscode/src/core/prompts/system-prompt/components/tool_use/formatting.ts`). Selection logic in `irisy_chat_stream`:

```
if active provider is BYOK frontier (anthropic-* / openai-* / claude-* / gpt-*):
  use native Pi tools (via registerTool)
else:
  use PWA XML dispatch loop + prompt teaches <call> protocol
```

The XML segment is added to the system prompt only when the fallback path is active, so frontier turns stay clean (`feedback_no_redundancy_one_ssot` — one mode active per turn, not both).

### §7.7 Historical acceptance (retired v7; non-binding)

- [~] `ctrl-pi-bridge`, Pi extension hooks/tools, `pi-bridge-probe`, Pi-native/XML routing, and their manual checks were retired when Pi exited the hot path. Current engine integration and release evidence are governed by §8 plus the source-pinned Hermes ACP probe.

## §8 Terminal-essence dialog — the engine owns the loop + context (NEW v7, 2026-06-28)

> Authoritative architecture for this section: ADR-001 spine §byo-cli-driver +
> ADR-002 §brain as indexed by `vault/ctrl/adrs/INDEX.md`. The former
> `architecture-byo-cli-driver.md` is historical strategy provenance, not an
> authority. Operational engine truth is build-owned: the version/install pin lives
> in `src-tauri/src/shell/agent_installer.rs`, ACP runtime behavior lives in
> `src-tauri/src/shell/acp_client.rs`, and release evidence comes from
> `scripts/probes/hermes-acp-probe.mjs` reading that pin.
> §5/§6/§7 above are Pi-era and retired; §8 is the current interface model.

### §8.1 Decision

Irisy's chat is **dialog in form, terminal in essence**. The conversational UI
stays friendly (non-technical users — the ambient workbench), but underneath it
is a **persistent REPL-style engine that owns BOTH the agent loop AND the whole
conversation context** — the same model Claude Code / Codex / Gemini CLI use, and
exactly what ADR-001 §byo-cli-driver + ADR-002 §brain already mandate: *调度权在
CLI/引擎手里; CTRL 不 supervise / 不编排 agent loop* (定案5). CTRL stays its proper
layer — **projection + `:17873` gate** — and stops reconstructing context per turn.

`先不用管 provider` (bao 2026-06-28): the **engine** is the unit of this decision,
whatever model backs it. v1 engine = the bundled Hermes Agent (ADR-002 §brain) run
as ONE persistent session per conversation. The provider/model layer is out of
scope here; the tool-less **provider-direct path is demoted to a pure fallback**
(engine absent / offline) and, when used, does NOT become the conversation's
memory of record.

### §8.2 Root cause this fixes (code-verified 2026-06-28)

Three amnesia mechanisms in the pre-v7 implementation, all from CTRL wrongly
half-owning a loop it should not own:
1. the agent path sent the engine **only the latest user message** (`last_user`);
   continuity relied entirely on the engine's ACP session surviving.
2. on **ANY** engine prompt error CTRL set the client singleton to `None`
   (`irisy_chat.rs`) → next turn `session/new` → total amnesia; since only
   `last_user` is ever sent, a fresh session = zero history.
3. routing (`turn_needs_agent`) **split turns** between the engine and the
   tool-less provider-direct path; the two never shared memory.

Ledger truth: across a whole session `caller='hermes'` showed only research tools
and never `vault_write` — the brain also failed to act, compounding the symptom.

### §8.3 The model (v7 lock)

- **ONE persistent engine session ≡ ONE conversation.** Every turn (tool or chat)
  goes to that engine; the engine accumulates context. Normal conversation is NOT
  split to provider-direct.
- The engine session is **not reset on transient / recoverable errors** — only on a
  genuine unrecoverable crash (process dead / stdout closed), and then it is
  re-hydrated (§8.4), never silently dropped into amnesia.
- The system brief / persona is part of the engine's **standing context** (primed
  once per session); a re-hydration re-primes it.
- **Continuity is the ENGINE's responsibility, not CTRL's per-turn reconstruction**
  — consistent with ADR-001/002 (the engine owns the loop).

### §8.3.1 ACP cancellation contract for opted-in callers (v33; clarified v34)

ACP cancellation is owned by the request caller. A surface that exposes Stop
registers its active request owner, sends `session/cancel` only for that
client's active `sessionId`, retains exclusive ownership of stdout, and drains
the terminal response for the original request before another request may
consume the stream. Any late thought, message, or tool update observed during
that drain establishes the terminal boundary but is discarded rather than
delivered to the expired callback or a later UI turn.

A client is reusable only when its child remains alive **and** that original
terminal response was drained. Failure to write cancellation, drain before the
bounded recovery deadline, observe terminal EOF, or match the original response
marks the client non-reusable; callers discard the singleton and re-create it
from the durable local transcript. A confirmed cancellation does not kill a
healthy engine.

Coding's independent ACP client implements this contract. Irisy currently does
not expose an ACP cancellation command; its reset discards the singleton and is
not safe session reuse. A future Irisy Stop control must register the active
request owner and use this same cancellation/drain boundary before it is
advertised.

### §8.4 Durable transcript (vault-is-truth backstop)

Per plain-text philosophy (本地是 truth), the conversation transcript is persisted
locally so it survives app restart / engine crash and can **re-hydrate a fresh
engine session**. The transcript is the recovery source of truth; the live engine
session is the working context. (Minimal v7 ships the no-reset + single-engine
routing fixes; durable-transcript re-hydration is the immediately-following
increment, not a separate ADR.)

### §8.5 Acceptance / implementation

- [x] All non-coding turns route to the single persistent engine; the
  `turn_needs_agent` split of normal conversation to provider-direct is removed —
  provider-direct becomes an explicit engine-absent / offline fallback only.
  *(v12 2026-07-04: `irisy_chat.rs` `use_agent = !coding_mode && !force_direct &&
  engine_ready`; `turn_needs_agent` no longer gates the engine — tests only.)*
- [x] The engine session is NOT dropped on a transient prompt error; it is reset
  only when the engine process is genuinely dead, followed by re-hydration.
  *(v12: keeps live session; `if dead { *guard = None }` where `dead = !c.is_alive()`.)*
- [x] The session survives across turns for one conversation — verified: a fact
  stated in turn 1 is recalled in turn N (real run / ledger).
  *(v12 2026-07-04 RUNTIME: 2-turn ACP test on ONE session — turn 1 stated
  `sky-anchor-7731`, turn 2 recalled it verbatim without restating.)*

### §8.6 Selectable-agent/persona frontend — retired-v40 provenance

The complete retained text in this subsection is historical and non-binding. It records the terminal-essence/selectable-agent evolution before v40; it does not authorize an agent selector, persona axis, per-surface session owner, or second transcript. Current authority is §8.7 and §11 v40.

<details>
<summary>Historical v8–v39 design and implementation evidence (non-binding)</summary>

bao 2026-06-28: **「前端都是 terminal 实质的, 统一, 可选 agent」**. §8.1's "dialog in
form, terminal in essence" is **not scoped to the Irisy ambient chat** — it is the
**unified interaction model for the WHOLE frontend**. Every interaction surface
(Irisy ambient chat, the coding L1, per-L1 workspaces, any future agent surface)
is the SAME thing underneath.

**The model (terminal analogy):**
- A surface ≡ a **terminal session**: a persistent engine (§8.3 — owns loop +
  context), a durable transcript (§8.4), never-blocked input, and a **selectable
  agent** = the session's **"shell"**. The shells are the agent axis
  (`list_byo_drivers`): **hermes** (embedded — answers in-surface) / **Codex** /
  **Claude Code** (BYO-CLI — projected via gate + AGENTS.md, driven from the user's
  terminal). Switching agent = switching shell.
- **统一 = ONE model + ONE shared agent selector** (`packages/ctrl-web/src/lib/
  active-agent.ts`) across surfaces — NOT N bespoke chat/terminal widgets. The
  selector built for the ambient chat is the universal control; it appears on
  every surface.
- **terminal 实质 = §8.3 engine semantics everywhere** (persistent session, no
  reset on transient error, continuity is the engine's), under the friendly dialog
  skin — non-technical users still see a conversation, not a shell prompt.
- **Axis orthogonality holds per surface** (ADR-005 §8 三轴): agent (engine/shell)
  ⊥ persona (role dropdown) ⊥ feature-packs. Switching the agent does NOT reset the
  conversation, persona, or packs.
- **Embedded vs BYO honesty holds per surface** (the agent axis lock): an embedded
  agent answers in-surface; a BYO-CLI agent is projected + driven from the user's
  terminal — the surface shows that honestly, never fakes a streamed answer.

**Why:** one mental model for the user (consistency), and architectural correctness
— CTRL is projection + gate; the engine/shell owns the loop. True for EVERY surface,
not just one. Avoids N divergent half-owned loops (the §8.2 amnesia bug, multiplied
per surface).

**Acceptance:**
- [ ] The agent selector (`active-agent` store + `list_byo_drivers`) is present on
  every interaction surface, not only the ambient chat.
- [ ] Every surface routes through the §8.3 terminal-essence engine model honoring
  the selected agent (embedded answers in-surface; BYO-CLI = projected + honest
  hand-off, never a faked stream).
- [ ] One shared session/transcript abstraction backs the surfaces (no bespoke
  per-surface loop); persona + feature-packs remain orthogonal axes layered on top.
- [ ] Non-technical-user skin preserved: the unification is under the hood; the
  surface still reads as a friendly dialog, not a raw shell.
- [x] durable transcript persisted (`transcript-store`) + replayed to re-hydrate
  a fresh engine after restart/crash (`AcpClient::prompt` on `!primed`) — done
  v0.1.684 per §8.7.
- [ ] CTRL remains projection + gate; it does not reconstruct context per turn
  (ADR-001/002 §brain). The fragile pre-v7 path (§8.2) is superseded.

#### §8.6.1 Why terminal-essence beats a dialog box — the advantages, and surfacing them (NEW v13, 2026-07-04)

bao 「对比 terminal 本质和对话框本质有哪些优势，将这些优势发挥出来」. A dialog box is
one stateless Q→A: the app reconstructs context per turn, the model answers, tool
use (if any) is hidden, there is no session object. Terminal-essence (the engine
owns the loop + context, §8.1) is strictly more powerful — and every advantage is
a moat vs the industry-default chatbot. The governing surfacing plan:

| # | Terminal-essence advantage (a dialog box can't) | Surface it as | Status |
|---|---|---|---|
| 1 | **Agentic multi-step**: plans → calls tools → observes → continues until done, in ONE turn | a live work-trace (below), not a single answer | ✅ visible via 2+3 |
| 2 | **See it think**: the reasoning stream (`agent_thought_chunk`) | collapsible "Thinking" trace per turn | ✅ v13 (`chat-stream-thought`) |
| 3 | **See it work**: each tool call + result (`tool_call`/`tool_call_update`) | step chips w/ drill-down to raw I/O (§6) | ✅ v13 (`chat-stream-tool`) |
| 4 | **Session is an object**: `resume`/`list`/`fork`/`loadSession` (engine-advertised) | conversation history + resume + branch | ✅ v16 (resume + fork/checkpoint via `irisy_reset_engine` §8.4) |
| 5 | **Steerable mid-loop**: it's a running process, not a fired request | inject a correction while it works (beyond Stop) | ⧗ next |
| 6 | **Command surface**: `available_commands_update` (slash) | slash / quick-actions + @-mention vault | ✅ v16 (`/` registry-driven + `@` mention + `:` jump + `↑` history) |
| 7 | **Cost/usage visible**: `usage_update` | per-turn token/cost chip | ⧗ later |
| 8 | **Persistent continuity**: no per-turn amnesia | one engine session ≡ one conversation | ✅ §8.5 (v12) |

Rule: surface the ESSENCE, keep the friendly dialog FORM (§8.1 lock "not a raw
shell") — every advantage lands under the approachable skin, drill-down optional.
Empirical basis: hermes-acp 0.16.0 `initialize` advertises `{fork,list,resume,
loadSession, image}` + emits all of `agent_thought_chunk`/`tool_call`/`tool_call_
update`/`available_commands_update`/`usage_update` (captured 2026-07-04).

#### §8.6.1a Live diagnostics projection (NEW v26, 2026-07-25)

The live ACP owner emits content-free lifecycle metadata into ADR-010 § diagnostics: engine/session opaque identifiers, startup/live/ready state, request phase, outcome, duration, and Gate reachability. This is an observation of the same singleton and session described by §8.3; it is not another client or replay path. Irisy smoke checks the current process/session/transport without sending a model prompt and cannot create, reset, or supervise a session.

The projection never includes prompts, completions, thoughts, tool arguments/results, credentials, subprocess environment, absolute paths, or raw ACP/InternalMsg payloads. A time-boxed enhanced capture may add lifecycle phases only; the content prohibition cannot be disabled.

#### §8.6.2 The terminal FRONTEND advantages + the reference to copy (NEW v14, 2026-07-04)

bao 「前端也有不一样，发挥 terminal 前端优势 / 全网调研」. 5-facet web research (9 agentic
CLIs + terminal renaissance + agent transparency/approval + REPL HCI primitives +
keyboard-first consumer apps) — full cross-verified synthesis + primary sources in
`vault/ctrl/research/terminal-frontend.md` (governing reference). Meta-thesis (all 5
converge): **terminal-frontend power decouples from shell syntax** — keep the
semantics (nameable/repeatable actions, addressable output, keyboard-first flow,
ambient context, plan-then-approve, reversibility), GUI the delivery, drop the raw
shell. This is exactly what Zed ACP + Warp did, and what §8.1 ("not a raw shell")
already mandates.

**THE PLAN (best): Irisy's frontend = an ACP-contract-driven friendly GUI review
client.** Not a shell — render ACP's wire types as dialog + cards + approval + status.

**WHAT TO COPY (references, decided):**
- **Frontend↔brain contract → ACP (Zed).** The one tool that publishes the
  client↔agent frontend contract as a spec, ~1:1 onto CTRL's `:17873` gate; CTRL
  already drives hermes over it. Its `session/update` (8 variants), `request_permission`
  (4-value enum), `tool_call` (kind/status/**diff** content/locations), `plan`, session
  modes, `usage_update` = the ready-made schema for the WHOLE terminal frontend. Extend
  along ACP; do not invent a protocol.
- **Friendly-GUI-over-terminal-agent form → Zed + Warp** (buttons not raw scrollback;
  Blocks = addressable turn/result cards; rich plan editor; per-hunk diff review).
- **Write-review gate (the moat) → LangGraph HITL + Copilot approval dialog** — the
  inline approve/deny/**edit-args** card, gated AFTER the model picks a write and BEFORE
  execution, write deferred until resume, scope once/session/always. CTRL today
  AUTO-ALLOWS this (`select_allow_outcome`) — the single highest-leverage gap.
- **Keyboard/command surface → Raycast** (menu teaches its own shortcut, Action Panel,
  Quicklinks) + GitHub/VS Code sigil palette (`>`/`@`/`#`/`/`/`:`).

**Detailed capability + resource plan** (Irisy slash set, conversation modes, keyboard,
approval card, status line, sessions, blocks — each mapped to a verified open-source
code reference + license + where it plugs into CTRL): `vault/ctrl/history/plans/irisy-terminal-frontend-plan.md`.
Build kit (all licenses verified 2026-07-04): kernel/PWA **adopt the official Apache-2.0
ACP SDKs** (`agent-client-protocol` crate + `@agentclientprotocol/sdk`) + codegen from
`schema.json`; UI = `cmdk` (palette, MIT) + `@tiptap/suggestion`+`@tiptap/extension-mention`
(slash/@ on CTRL's existing Tiptap, MIT) + `@codemirror/merge` (per-hunk diff on CTRL's
existing CM6, MIT) + `assistant-ui` (MIT) **or** Vercel AI Elements (Apache-2.0) for the
chat shell + approval card, with `agent-inbox`'s 4-flag model for approve/deny/edit-args.
Avoid `@nlux/react` (MPL + AI-training clause) and Open WebUI (branding clause).

**Surfacing priority — SHIPPED v16 (2026-07-04):** ① ✅ thinking + tool-step trace
(§8.6.1) → ② ✅ **review gate** (the moat — NOT a new ACP-layer card as planned:
CTRL already had a red-team-reviewed kernel `ReviewGate` wired to dispatch + a
mounted `ReviewGateHost` modal; the fix was `is_first_party`→`is_user_surface` so
it covers hermes, ADR-002 §264 v51) → ③ ✅ **command surface, REGISTRY-DRIVEN**
(`/` = core `/new` + installed feature packs' actions; `:` jump = core modules +
installed packs; `@` mention vault notes/tables; `↑`/`↓` history — bao: CTRL is a
create/share/download platform, entries come from the registry not a hardcoded
list) → ④ ✅ status line (engine · model · state · version) → ⑤ ✅ session
resume + fork/checkpoint (`irisy_reset_engine`, engine re-hydrates from the
transcript §8.4) → ⑥ ✅ Blocks (re-run + fork-from-here per turn). Also ✅ output-
routing (auto-open a note Irisy writes) + ACP crate `SessionUpdate` types adopted
(retired hand-rolled parsing). **Remaining ⧗:** #5 steering mid-loop, #7 usage
chip, full ACP-schema codegen, diff-review via `@codemirror/merge`, richer @-mention
(inject resolved path/content). **Skip (raw-shell, §8.1):** alt-screen mechanics,
permission DSLs, --yolo, leader/chord/vim-as-default, raw token math, two-axis flags.
Honest gap: much is tsc/Playwright-verified (render + client logic); real-data +
engine round-trip (approval modal, auto-open, fork re-hydrate) verify on desktop.

</details>

### §8.7 Consolidation — one fixed Irisy identity (v40)

§11 v40 is the sole live identity/session authority and governs this section on conflict. The product has one mounted Irisy surface and one fixed Irisy identity. Project coding is represented by an explicit Project Resource plus optional pinned Skill, capability scope, policy, and task; there is no Assistant/Coding actor selector or separate live project transcript owner.

Irisy's managed engine remains implementation machinery. Any user-owned BYO CLI is outside Irisy and connects only as an external `:17873` client under ADR-001 v22. Runtime history from Hermes or the former Coding path may be imported read-only into a new canonical Irisy session; it cannot remain a second live session authority.

Continuity and reset use the sole canonical Irisy transcript described in §11. Resource, Skill, capability scope, and policy changes must affect the next turn, while a Skill never owns or spawns a session.

### §8.8 Managed BYO-engine install — retired-v40 provenance

The former §8.8 live body is removed. It described a historical managed-install design for alternate right-region engines and its implementation evidence. v40 retires that identity/runtime framing; details remain in changelog and git history only. Current authority is one fixed Irisy identity (§11) plus an external BYO CLI gate-client path (ADR-001 v22).

## Acceptance

### Lifecycle (§1)
- [x] ADR locks 8-stage model + invisible internal mode routing. v1 ships stage-1 (Chat) via `IrisyChat.tsx`. Closed.
- [x] No mode-switcher UI in shipped code; `decision_one_persona_irisy` honored. Verified.

### Remote co-view (§2)
- [x] ADR direction recorded; v1 ships none of these (v1.1+ scope). Closed at "decision recorded".

### Persona + prompt v5 (§3)
- [x] Persona is per-mcp `cap_asset.files/persona.md`; vault override path declared. ADR-002 § composition axis 6 closes the schema side.

### SOUL.md compat (§4 — NEW v2)
- [x] Strategic lock recorded — SOUL.md spec adopted verbatim, `x-ctrl:` namespace reserved for CTRL extensions, ecosystem stance documented in `vault/ctrl/history/brainstorm/openclaw-compat-2026-06-03.md` and memory `decision_openclaw_compat_layer`. Code follow-up tracked in **Future work** below (deferred batch, not a blocker for ongoing P0 fixes).
## §9 Mission + knowledge system (NEW v11, 2026-06-29)

> Architectural authority = this accepted module ADR plus the other owning module ADRs. This § records the mission and knowledge decision; §11 is the sole identity, context, session, and transcript boundary. Historical planning maps are non-authoritative and are not live dependencies.

### §9.1 The mission (LOCKED, bao 2026-06-29)

bao picked the research-backed frame: **Irisy = the 数字员工 / operator for a one-person company** — by **role** (sales follow-up / customer service / docs / bookkeeping) it **completes the whole job**, on the user's **own local data** it **remembers the business** (customers, context), it **self-extends** (builds a feature pack when a capability is missing), all **through the `:17873` gate**.

Root-fix for "Irisy isn't smart" (bao 2026-06-29): not the model — two structural gaps. ① **No mission** — the system prompt had identity + voice + a tool list + guardrails but no *purpose*, so Irisy always "waits to be asked → answers shallow." ② **Knowledge scattered across 5 sources** with no SSOT (`irisy-prompts.ts` + `acp_client.rs::CTRL_CAPABILITY_BRIEF` + hermes SOUL/config + vault + skills) → drift (brief over-claimed capabilities, SOUL went unread). Three research tracks (knowledge/context-engineering · proactive-operator · China-OPC market) converge: leading assistants make the mission a model-external persistent scaffold and the knowledge a layered, single-SSOT, injected-vs-retrieved system.

Three differentiators (all three required): **completes the whole job** (not answers) · **remembers your business — locally** (rivals all park the customer book in their cloud; Irisy gives the agent that context WITHOUT exporting = vault-is-truth, the sharpest seam) · **self-extends** (creates or selects an FCT when a reusable capability is missing). Positioning red lines: NOT the free all-in-one super-box (Doubao/Quark/Yuanbao own that via free + IM distribution — undistributable for us) → owner-role colleague; NOT a companion (shallow market, >50% churn, regulatory exposure) → warm-but-reliable colleague, trust from accuracy+consistency+drill-down; privacy framed as **business data sovereignty** (PIPL/DSL + leak/lockout avoidance, e.g. cross-app automation getting banned), NOT abstract consumer privacy.

### §9.2 Knowledge system — 8 layers, single SSOT each, injected-vs-retrieved

Principle (Anthropic context-engineering et al.): keep the static prompt small at the "right altitude", route dynamic knowledge through tools just-in-time, one SSOT per layer, **capability-awareness DERIVED not hand-written**.

| # | Layer | SSOT | Injected per-turn vs retrieved on-demand |
|---|---|---|---|
| 1 | Identity / mission | `irisy-prompts.ts` (versioned) | injected, tiny — who + OPC mission + operating loop |
| 2 | fixed voice/style | one versioned Irisy prompt source | injected, tiny; not user-selectable and not a role registry |
| 3 | **Capability awareness** | **live gate registry** (MCP `tools/list` / `visibility.rs`) | injected, **generated per-turn from the registry** ← honesty fix |
| 4 | Durable user/business facts (customer-profile core) | `vault/irisy/` markdown (md+YAML) | injected, **bounded** (Letta core-block style), reconcile-on-write (ADD/UPDATE/DELETE, mem0 style) |
| 5 | Skill metadata | `SKILL.md` frontmatter | injected, name+desc only (progressive disclosure) |
| 6 | Inferred prefs / soft context | derived index over past sessions | retrieved top-k |
| 7 | Vault project-brain / customer book | user markdown vault (vault-is-truth) | retrieved just-in-time — agentic file-read > chunked RAG at personal scale (<1M tok); FTS5+sqlite-vec+RRF when it grows |
| 8 | Archival / session memory | out-of-window files (memory-tool dir) | retrieved; flush before compaction |

Three iron rules: **one SSOT per layer** (merge the two drifting prompts; fold `CTRL_CAPABILITY_BRIEF` into a single assembly point) · **capability-awareness derived not hand-written** (kills both fake-capability claims and missed-tool blindness) · **brain and chat share ONE knowledge source** (hermes sees what the chat path assembles — kills the unread-SOUL bug).

local-first / BYOK fit + traps: memory stored as vault markdown (passes vim test, no lock-in); on-demand file-read IS vault-is-truth; capability-derivation IS the existing gate. Traps to avoid: mem0/Letta are hosted — borrow the patterns (memory blocks, reconcile-on-write, sleep-time tidy) on vault files, don't use their cloud; under BYOK an embedder can leak the vault to a cloud — default a LOCAL embedder, cloud-embed needs explicit consent + gate audit, FTS5/BM25 always-local fallback; route all memory writes through the gate (auditable, reversible).

### §9.3 Operating loop + proactivity guardrails

The system prompt teaches the LOOP (a "right-altitude" heuristic), not a tool list: **Sense → Anticipate (idle pre-stage; present-now/save/hold) → Plan (answer / act / build-a-pack) → Act (through `:17873` gate — read/reversible = automatic, write/spend/send/delete = confirm first) → Produce (answer in chat; documents/pages routed into the owning module's workspace) → Persist (write decisions/results back to vault → smarter next turn)**.

Proactivity guardrails (research: unsolicited help can hurt competence): ① reversibility = the ask boundary (= the gate's job) · ② only trigger-born + goal-relevant nudges, batched into ONE brief not a stream · ③ one-tap suggestions the user can ignore (don't usurp autonomy) · ④ transparency + sovereignty (drill-down to raw, runs on local vault, NEVER block the input box, any proactive routine is switch-off-able).

### §9.5 Implementation path — TAME hermes, don't build (bao 2026-06-29: "有些 hermes 应该都做了一些了,你要综合考虑")

Critical calibration after auditing hermes + the existing code. **hermes is already a complete agent engine** — it has its own memory, an agent loop that runs to task-completion (max_turns 90, task_completion_guidance), skills, cron (proactivity), a kanban task board, web search, a terminal. The execution substrate is THERE. So Irisy's job is NOT to build capabilities (that re-invents what hermes has — the exact mistake bao corrected 3×). Irisy's job is to **tame** a generic, raw engine whose data lives in its own private store:

> **hermes is the engine; Irisy is the car. The user must never perceive the engine.** CTRL adds the three things hermes structurally lacks, each of which IS the user experience: ① **give it a soul** (the OPC operator mission — hermes can't grow one) · ② **drain its memory back into the user's vault** (hermes defaults to a private DB → violates the vim test; CTRL lands it as the user's own markdown) · ③ **a one-Ctrl-key warm entry that hides all the jargon** (toolsets / cron / providers vanish behind one trustworthy colleague). This is subtraction + taming, not addition + wheel-building.

Audit finding: CTRL already DESIGNED all three, scattered + stale. `vault_seed/irisy-soul.md` (a ~200-line soul seed) already carries the whole memory system (episodes / playbook / curator reconcile-on-write), the privacy locks, the output-routing-to-vault, and the hide-jargon rules. `acp_client.rs::CTRL_CAPABILITY_BRIEF` already commands hermes "your long-term memory is the user's SOUL.md — persist durable facts THERE via the ctrl soul/memory tools, not your private store, so the chat and agent paths share one memory and never drift." So the DRAIN MECHANISM exists. What was actually wrong: (a) the soul was stale (`co-pilot` / `passenger-seat` + retired `Pi`/`keycap` jargon), (b) two sources (seed + brief) drift = the §9.2 "scattered knowledge" disease, (c) the drain isn't closed (hermes still double-writes its own private MEMORY.md), (d) `vault/irisy/SOUL.md` was NEVER seeded into the user's vault, so the rich soul never reached anyone.

### §9.4 Acceptance (§9)

- [x] Mission LOCKED by bao 2026-06-29 (数字员工/operator frame) — recorded here + reflected in planning map §一.
- [x] Module ADR authority reconciled: this ADR owns the accepted Irisy mission/knowledge decisions; §11 owns identity, context, session, and transcript boundaries; historical planning and role documents are non-authoritative provenance only.
- [x] **Soul re-souled (§9.5 ③ + ②-jargon)**: `vault_seed/irisy-soul.md` `about` + `x-ctrl.identity` rewritten co-pilot/passenger → operator/back-office-of-your-one-person-company; retired jargon (`Pi`/`keycap`/`co-pilot`/`servant`) wiped. Seeds into `vault/irisy/SOUL.md` on next launch (`write_if_missing`, currently absent → writes the new soul). PWA chat path reads it via `irisy_soul_get`.
- [x] **Mission in the PWA spine**: `irisy-prompts.ts` v13→v14 prepends mission + operating loop (layer 1).
- [ ] **Close the drain (§9.5 ②)**: on hermes launch, sync `vault/irisy/SOUL.md` → `~/.hermes/SOUL.md` (or point hermes at the vault) so the engine path reads the SAME re-souled file as the PWA path; stop hermes double-writing its private `~/.hermes/memories/MEMORY.md` (land durable facts in the vault instead). ← needs on-device hermes verification.
- [~] **One spine + capability from registry (§9.2 iron-rules, in progress)**. **一脉 = CTRL real functions are the capability backbone** (bao 2026-06-29 chose this over hermes built-ins): Irisy stands on TWO toolsets — hermes's own (browser/subagent/image/kanban/sessions/its-own-memory) + the CTRL gate (:17873: vault/market/feature-packs/smart-table/soul-memory). A live probe (`hermes -z`) proved Irisy was reciting the hermes built-in list while the CTRL real functions stayed invisible — the "no single spine" disease, live. Landed: (a) `CTRL_CAPABILITY_BRIEF` no longer hand-lists tools — it pins the `ctrl` tool list (tools/list) as the SINGLE source of truth + the PRIMARY toolset, demotes built-ins to "fill gaps only (image/browse)", tells Irisy to answer capability questions from ctrl tools not a built-in list (cargo check green). (b) SOUL widened to **personal assistant** (not one-person-company) + capabilities-come-from-the-tool-list, persona-talk removed. Remaining: disable hermes's DUPLICATE built-in toolsets (its memory/sessions/kanban — needs `hermes tools` granularity, interactive-only); behavior verify in-app (oneshot can't reach the gated ctrl tools). Do NOT re-implement hermes's loop/memory.
- [ ] **Close the orphan-soul drain (treblesoul → one owner)**: `~/.hermes/SOUL.md` is an orphan runtime file (no code owned it → held a stale co-pilot persona). Re-souled by hand for now; still needs code to re-pin it from a repo seed on every hermes launch (`acp_client::start`, alongside `write_hermes_dotenv`) so it can't drift back.
- [ ] China-OPC hero feature: local customer-profile memory (drained from hermes into per-customer vault markdown) + cross-IM (WeChat) ingestion → next-up after the drain is closed.

## Future work

- Irisy prompt v5 — bumps `PROMPT_VERSION` 4 → 5 in `packages/ctrl-web/src/lib/irisy-prompts.ts`; replaces v4 "no codenames" hard-ban with "brand labels only + self-aware via brain_status + failover transition + Settings deflect". Lands with ADR-002 § provider §3.7 introspection wiring.
- Stages 2-7 (Creation / Config / Invoke / Collab / Debug / Improvement) UI surfaces — v1.1+ scope (memory `feedback_no_planning_no_phasing`)
- Stage 8 (Retire) Settings drawer for low-usage mcps
- Cross-stage conversation history via `LocalStorage` namespace `irisy:<stage>:<mcp_id>`
- Remote co-view § 4 primitives (session.observe / share / takeover / narrate) — v1.1+ scope
- §4 SOUL.md compat — code follow-up batch (deferred to next session, not a release blocker):
  - `vault/irisy/SOUL.md` first-boot seed via `seed_vault_feature_layer` (template at `vault_seed/irisy-soul.md`)
  - `vault/irisy/.soul-md-version` pin file recording upstream commit/tag
  - Kernel commands `irisy_soul_read` / `irisy_soul_write` surfacing `{frontmatter, body}`
  - MCP tools `irisy.soul_get` / `irisy.soul_set` on :17873 — external agents (Cursor, Claude Code) can read+write CTRL's soul; write emits `platform.notify`
  - Seeded SOUL.md template demonstrates `x-ctrl:` namespace with provider routing + mcp activation example
  - Pi brain prompt v5 (or v6) injects SOUL.md body verbatim per turn
  - CLAUDE.md "Design Philosophy" cross-link to §4
- §4.4 mcp manifest ↔ OpenClaw skill bridge — schema lock lands in **ADR-002 § composition v1 amendment** (next session, paired with `packages/ctrl-mcp-sdk/src/openclaw-bridge.ts` transformer and Pool import flow). Independent of the §4 SOUL.md compat acceptance items.

## Provenance

- §1 ← orig-016 (Irisy 8-stage mcp lifecycle, 2026-05-22, accepted)
- §2 ← orig-017 (Remote co-view = Irisy primitives, 2026-05-22, accepted, v1.1+ scope)
- §3 ← orig-024 §7 (Irisy persona rule, 2026-05-30) + amendment 2026-05-31 (prompt v5 replaces v4 "no codenames" with brand-label + self-aware policy; closes bao 2026-05-31 root issue "Irisy doesn't know its own stack")
- §4 ← NEW 2026-06-03. Driven by bao competitive research dump (OpenClaw 350k stars / WorkBuddy compat / SOUL.md cross-tool recognition); locks ecosystem alignment that memory `decision_pi_is_sole_brain_hermes_is_keycap` half-committed to. Full strategic analysis at `vault/ctrl/history/brainstorm/openclaw-compat-2026-06-03.md`.

## §10 Irisy Capability Integration Contract (v35)

This section is the sole architectural contract for attaching any capability or
external application to Irisy. It complements, but does not replace, the owning
contracts: ADR-003 owns the single shell and layout, ADR-002 owns the gate and
§14 data contract, and ADR-010 owns cross-domain transport. A project review
record is evidence and a proposal source; it is never a second architectural
authority.

### §10.1 Forms

Every integration declares exactly one primary Irisy form:

| Form | User experience | Boundary |
|---|---|---|
| Workspace | The work area is expanded beside the resident Irisy surface. | The module owns its work area; Irisy remains the assistant surface. |
| Companion | The work area is collapsed and Irisy assists an external application. | This is the existing Irisy surface in a compact state, not a second window, shell, process, or transport. |
| Artifact | Irisy produces a native result in a registered viewer or workspace. | The artifact remains inspectable and routes back to its source data. |

Companion reuses the single CTRL NSPanel and its existing Irisy session. An
integration must not create a product-specific chat popup, duplicate assistant,
or bypass the shell presentation path. A future shell change remains owned by
ADR-003 and requires its own accepted amendment.

### §10.2 Required integration declaration

Before implementation, the project review record must declare all of the
following:

1. **Job** — the complete user job Irisy helps finish, not a list of raw API calls.
2. **Form** — Workspace, Companion, or Artifact and the reason that form is
   necessary.
3. **Context boundary** — the minimum explicit context Irisy may read, such as
   an active document, user-selected range, attached file, or declared source.
   Implicit scraping of an application's UI, clipboard, or private state is not
   an integration contract.
4. **Truth and provenance** — the local file, portable source, or external
   application that remains authoritative, plus the raw-input and transformed-
   output drill-down path.
5. **Capability mapping** — the existing MCP, Skill, API, §14
   `describe`/`query`/`produce`, or Effect surface used. New raw endpoint
   mirrors require justification; an adapter must not invent a parallel data
   contract.
6. **Write boundary** — the exact mutations, preview or staged representation,
   ReviewGate requirement, and any application-native safe write mechanism.
7. **Credential and identity boundary** — the user or application authority
   that authenticates the action. Credentials remain in the OS keychain or the
   declared application boundary and never enter Irisy or an LLM payload.
8. **Visibility and least privilege** — the intent-scoped capability subset
   visible to Irisy; external applications retain their own authorization and
   collaboration rules.
9. **Degradation** — honest behavior when the application, selection,
   connection, credential, or feature is unavailable. CTRL must not fabricate
   context or claim a mutation occurred.
10. **Evidence** — preflight and post-validation evidence for the real context,
    read path, write/review path when applicable, and a failure or recovery
    path.

### §10.3 Gate and mutation rules

Every cross-domain capability invocation travels through `:17873` as the
governed operation gate. This governs capability operations, not the transport
selection owned by ADR-010. Readable data products use ADR-002 §14 `describe`
and `query`; writes use `produce` or the existing explicit Effect surface. A
mutating integration crosses ReviewGate before execution unless it is a direct
user-surface action already governed by the existing gate policy. Neither a
local extension nor a downstream MCP server may self-approve a write.

An external application's own concurrency, collaboration, permissions, and
format rules remain authoritative. CTRL may offer a staged change, native diff,
or native revision mechanism, but must not emulate or replace that application's
transaction model.

### §10.4 Review lifecycle

Each integration creates one record at
`vault/ctrl/research/irisy-integrations/<slug>.md`. The record is plain Markdown
and has the following required sections:

```text
# <Name> — Irisy integration review

## Job and form
## Context and truth
## Capability and gate mapping
## Write, identity, and review boundary
## Degradation and transparency
## Preflight evidence
## Post-validation evidence
## Review outcome
## Proposed contract delta (only when needed)
```

The project has two mandatory reviews:

1. **Preflight review** — before code, confirm every §10.2 declaration and
   reject an integration that requires a new window, a parallel transport, a
   duplicate truth source, or an ungoverned mutation.
2. **Post-validation review** — after real interaction evidence, compare the
   observed behavior with the declaration and record failures, recovery, and
   user-visible behavior.

A review outcome is exactly one of:

- **Conforms** — the project fits this contract; no architecture change.
- **Clarification** — the contract already decides the issue; improve the
  record, tests, or reference implementation without changing architecture.
- **Contract delta** — evidence reveals a missing or conflicting rule. Stop
  implementation at that boundary, obtain bao approval, and amend this section
  in place before continuing.

This lifecycle turns every project into evidence for one evolving Irisy
contract. It does not permit project-specific architecture to become a de facto
standard.

### §10.5 LibreOffice Companion reference review

`research/irisy-integrations/libreoffice-companion.md` is the first review
record. It evaluates a Companion form only: the workspace is collapsed, the
existing Irisy panel is reused, and a future local UNO adapter must be governed
by the gate. It is a research and contract review, not an implementation
commitment for a LibreOffice extension, MCP server, or new native window.

### Design Acceptance (non-release)

- [ ] Every new Irisy capability or external-application integration has a
  preflight review record before implementation.
- [ ] Every implemented integration has post-validation evidence and one
  recorded review outcome.
- [ ] A Contract delta is accepted through an ADR-005 amendment before code
  relies on it.

## §11 Irisy role boundary — one fixed identity and FCT-resolved context authority (v44)

This section is the sole live authority for Irisy's identity, context, session, and transcript boundaries. Product, planning, research, and historical documents may link here but cannot define another role/persona/identity registry.

### §11.1 Identity and context

CTRL exposes one fixed identity: **Irisy**. Assistant, Coding, engine names, personas, and project modes are not alternate product identities. Project coding is an explicit Project Resource combined with Skill/capability scope; it does not create a second agent, transcript owner, or session type.

Every turn's complete runtime context remains exactly:

```text
session_id + explicit Resources + optional pinned Skill + capability scope + policy + task
```

A user selection may name one FCT, but FCT is resolved live before this tuple is assembled and does not add a seventh context field. The canonical resolver preserves the session's Work-owned explicit Resources, appends and canonical-ref-deduplicates any FCT dependency Resources, and maps the selected FCT to an optional internal Skill plus an enforceable least-privilege gate scope and policy facts. Auto means Irisy may choose through the same registry under current policy. A zero-Resource FCT is valid only when it changes Skill or enforced scope. An unresolved selection reports the failure, returns that session to Auto, resets the runtime owner, and cannot send or retain stale context.

- `session_id` addresses one canonical Irisy session.
- `explicit Resources` are canonical ADR-002 ResourceRefs selected by the user or owning Work surface; implicit project, application, clipboard, or hidden-history scraping is forbidden.
- `optional pinned Skill` is one resolved local `SKILL.md` playbook. It contributes method only and never spawns, owns, resumes, forks, or persists a session.
- `capability scope` is the authorized `:17873` projection available for this task; installed does not mean visible or active.
- `policy` contains gate visibility, ReviewGate, credential, privacy, and mutation rules.
- `task` is the current user request plus explicit operation state references.

Changing Resources, pinned Skill, capability scope, or policy changes the next runtime projection for the same Irisy identity. No control may be decorative.

### §11.2 Sole live transcript authority — a kernel-owned plain-text transcript (v44)

A conversation is user content. The **transcript file is the truth**: one readable Markdown file per session, owned by the kernel as the canonical Resource `ctrl://local/session/<id>` with YAML frontmatter for session metadata and a `## <role>` heading per turn. The transcript directory is the session list; there is no separate index. Ordinary tools must be able to read, grep, diff, and edit a transcript, and a hand-edited transcript must still open and still accept new turns — a parse that refuses would lose the user's history over a typo.

The frontend session store is a **projection** of that Resource, not a second authority. It is rebuilt from the transcript on open, and every turn it shows is written through the canonical `produce` write contract. Persistence writes only settled turns: a streaming or empty placeholder turn is not a record, so it never reaches the file. Appending is the only write the owner offers; rewriting or deleting history is deliberately absent, because the file is the record and the user already has an editor for it. A fork narrows the view, never the record.

Creating, closing, renaming, switching, forking, importing, and continuing sessions derive from the transcript. A runtime engine may hold transient loop state, but after reset/restart it is rehydrated from the canonical transcript and cannot become a second transcript manager. Browser-held transcripts from an earlier build are migrated into transcript files before the projection is rebuilt, so upgrading cannot lose a conversation; a partial migration leaves the turns that landed readable on disk and retries, and never deletes its source. When the kernel is unreachable the existing local view is retained and reported as such rather than blanked — unavailability degrades, it does not erase.

Hermes history and former Coding workspace/project history are read-only import material. Import creates a new Irisy session with provenance and explicit Project Resource when applicable; it never overwrites an active session, resumes the historical engine owner, or remains live in parallel. After import, all new turns and recovery use the canonical Irisy transcript store.

A BYO CLI remains an external `:17873` client with its own user-owned history outside Irisy. CTRL may project scoped Resources/Skills/capabilities to it, but that history is not an Irisy transcript and CTRL does not own its loop.

### §11.3 Runtime and capability boundaries

Irisy's managed runtime owner holds current cancellation/drain state and transient operation correlation for one canonical session. Resources own content; Skills own method text; package/manifest owners retain capabilities and descriptors; OperationRef owners own durable effects; ReviewGate owns mutation approval. FCT owns none of these: it is the pre-turn product projection that selects an authorized combination of them. None may claim session or transcript ownership.

The out-of-product CTRL development agent remains distinct from shipped Irisy and is governed by GOAL plus module ADRs. This distinction does not create a product identity selector.

### §11.4 Documentation authority and retired provenance

- §8.7 is historical runtime evolution; this §11 v41 governs on conflict.
- §8.8 is retired-v40 and has no live body.
- §9 owns mission and knowledge behavior but does not own identity/session topology.
- §10 owns integration forms and context declarations.
- ADR-001 v22 owns the managed-Irisy versus external-BYO-CLI projection relationship.
- `irisy-roles.md`, `irisy-coding-companion.md`, and `irisy-architecture.md` are not live dependencies or authorities. Historical changelog/provenance references may remain for traceability only.

## §12 User intent registry — the sole product-scope authority (v42)

This section is the sole accepted enumeration of the user intents CTRL serves. The former 68-intent inventory retired with ADR-008 and was never inherited, and §1's lifecycle table is provenance only. Without one registry every design round re-derived scope from architecture, which repeatedly produced controls that expose internal inventory instead of serving a job.

An intent is a complete user job stated in the user's terms. It is not a tool, endpoint, capability domain, FCT, Resource kind, or screen. Intents are stable product scope; the surfaces that serve them are not.

### §12.1 The registry

Capability domains reference ADR-002 §17 v85. `Scope` is `v1` for intents CTRL commits to serving now, and `later` for accepted-but-deferred scope.

| ID | User intent | Primary domains | Scope |
|---|---|---|---|
| U1 | Ask about what I have open or selected | `system`, `vault`, `notes` | v1 |
| U2 | Rewrite, summarize, or translate this content | `notes`, `vault`, `llm` | v1 |
| U3 | Answer from my own local knowledge | `vault`, `notes`, `memory` | v1 |
| U4 | Find something in my local content | `vault`, `notes` | v1 |
| U5 | Turn this into structured records | `smart_table`, `tasks`, `calendar` | v1 |
| U6 | Change my local content for me | `vault`, `notes`, `smart_table`, `tasks`, `calendar` | v1 |

> **U6 status: `partial`.** The canonical-operation stage is verified for all three record sources (note, task/calendar/table field). Three gaps keep the intent partial: (1) smart-table cell edit has no DOM-driveable UI test — the grid renders to a canvas; (2) calendar has no first-party editing surface — the write is exercised through the assistant only; (3) smart-table row/column operations still rewrite the whole file through the bespoke path with no revision precondition, so a concurrent cell write can be overwritten. These gaps are declared in the pipeline and tracked there; they do not block the kernel write contract acceptance.
| U7 | Look something up outside my machine | `websearch`, `market` | v1 |
| U8 | Use data from an application or service I already use | `source`, `mcp` | v1 |
| U9 | Work on a specific project | `project`, `vault` | v1 |
| U10 | Approve or reject a consequential action | `system` | v1 |
| U11 | See exactly what happened and where it came from | `system`, `diagnostics` | v1 |
| U12 | Recover when something is unavailable or stale | `system` | v1 |
| U13 | Continue, revisit, or branch earlier work | `system` | v1 |
| U14 | Find a capability for something I cannot do yet | `discover`, `registry` | v1 |
| U15 | Install or enable a capability | `mcp`, `registry` | v1 |
| U16 | Create a capability I need | `mcp`, `discover`, `skill`, `vault` | v1 |
| U17 | Use a specific capability for this session | `registry`, `skill` | v1 |
| U18 | Review, disable, or remove what I installed | `mcp`, `registry`, `skill` | v1 |
| U19 | Connect an application or credential | `source`, `mcp`, `providers` | v1 |
| U20 | Configure how CTRL behaves | `providers`, `system` | v1 |
| U21 | Diagnose CTRL when it misbehaves | `diagnostics` | v1 |
| U22 | Operate a local application's explicit selection | `source`, `mcp` | v1 read; write `later` |
| U23 | Save a behavior that worked so I can reuse it | `mcp`, `registry` | v1 |
| U24 | Run a long operation and check on it | `system` | later |
| U25 | Reach my own machine from another device | `system` | later |

U23 is the intent that keeps CTRL task-first. Without it the only reuse path is choose-a-capability-before-working, which is the failure mode this registry exists to prevent. Its scope is deliberately narrow: it captures a reusable job description, the required capability shape, and policy. It never records the transcript, a step sequence, replayed parameters, or a trigger, and saving never activates the result.

### §12.1.1 Explicit non-intents

These are not deferred; they are refused. They must not be added without an amendment that also revisits CTRL's product boundary.

- Scheduling, event triggers, conditions, and branching. Triggers plus conditions become a workflow editor, which CTRL is not. U23 stops at reusable capability, not automation.
- Supervising a BYO CLI's agent loop.
- Any job whose primary affordance is browsing internal inventory.

### §12.2 Rules

This registry is amendable, never frozen, but it is not amendable unilaterally. Adding, splitting, merging, retiring, or rescoping an intent — including moving one between `v1` and `later` — requires explicit discussion with bao and bao's decision first; only then is the section amended. An agent, design review, user-research finding, or implementation constraint may propose a change and must present the evidence for it, but may not enact one. When a real user need appears that no entry covers, the correct action is to raise it for discussion rather than to serve it silently, stretch an existing entry to cover it, or block the user without recording the gap.

Every product decision must name the intents it serves. Adding, splitting, retiring, or rescoping an intent requires an amendment to this section; a design may not introduce a new user-facing job that no registry entry covers.

An intent must be reachable without the user naming a tool, package, Skill, MCP server, ResourceRef, or capability domain. Those remain drill-down facts. Each intent maps to at least one domain in ADR-002 §17; an intent needing a domain that does not exist is a substrate amendment first.

U6, U19, and U22 writes cross ReviewGate under §10.3. U10 is a first-class intent, not a modal detail: its surface must show the exact target and staged change. U11 and U12 are also first-class; a design that serves an action intent but omits its provenance or failure path is incomplete, and truthful failure always outranks apparent completion.

Selecting a capability (U17) is an override, not a precondition. Auto must serve U1–U9 without any selection. `later` intents must not be presented as available.

### §12.3 Every intent needs a verifiable pipeline (v43)

An intent is not served because a surface exists or a capability is installed. It is served when one named, executable pipeline proves the whole path end to end. Each `v1` intent declares exactly one such pipeline:

```text
entry surface → resolved context → capability domains (ADR-002 §17)
   → canonical operation (§15) → Outcome (§15.5) → rendering
   → evidence
```

Each stage is checkable rather than narrative. `entry surface` names where the user starts and asserts the intent is reachable without naming a tool, package, Skill, MCP server, ResourceRef, or capability domain. `capability domains` are the exact grant the turn projects, so an over-broad grant is visible. `Outcome` names the facts the owner must return for this intent; an intent that needs a target, staged change, or retryability the owner does not produce is blocked on a fact-owner amendment, not on presentation. `rendering` names the viewer or decision kind. `evidence` is a runnable check plus, where behavior is visual, real UI verification.

Each intent therefore carries exactly one status:

- **verified** — the pipeline runs and its evidence is current.
- **partial** — the pipeline is defined and some stage passes, with the failing stage named.
- **declared** — accepted scope with no passing pipeline yet.

Status is reported from generated evidence, never asserted in prose. `partial` and `declared` must not be presented to users as available, and a completion claim naming an intent requires that intent's current evidence. An intent whose pipeline depends on a `declared` capability domain (ADR-002 §17.6) cannot itself be `verified`.

This does not create a per-intent endpoint, route, or runtime branch. A pipeline is an evidence path over the existing shell, registry, gate, owners, and rendering registries.

### §12.4 Relationship to other authority

This section owns which jobs exist and each intent's pipeline status; ADR-002 §17 owns the authorization vocabulary and its per-domain evidence, and §15 owns the operation and Outcome contract; ADR-003 §8.5 owns which surface serves an intent and must cite intent IDs rather than define scope; §11 v41 still owns identity, the six-fact tuple, and session/transcript authority. The retired ADR-008 inventory, `irisy-architecture.md`, and §1's table are provenance and cannot reintroduce scope.

## Design Acceptance (non-release, v44 transcript)

- [x] A transcript is one readable Markdown file per session with YAML frontmatter and `## <role>` turns, round-tripping without loss (`src-tauri/src/kernel/transcript_format.rs`, 12 tests).
- [x] A hand-edited transcript still opens and still accepts a new turn without losing its existing history (`transcript_format.rs`, `session_resource.rs`).
- [x] `append_message` is the only write, executes the §15.2 recheck/atomic-commit/reread contract, and reports a stale revision as recoverable `precondition_failed` without writing (`src-tauri/src/kernel/session_resource.rs`, 13 tests).
- [x] The transcript directory is the session list, including a file placed there by hand, and excludes interrupted-write temp siblings (`session_resource.rs`).
- [x] The frontend store is rebuilt from the transcript on open and writes only settled turns, so a streaming or empty placeholder never reaches the file (`packages/ctrl-web/src/lib/session-transcript.test.ts`, 25 tests).
- [x] An unverified or failed append is reported rather than read as saved (`session-transcript.test.ts`).
- [ ] Prove the migration path on a real profile carrying browser-held transcripts, including a mid-migration failure leaving the landed turns readable and the source intact. Covered by unit evidence; not yet exercised against a user profile.
- [ ] Render the transcript viewer from the descriptor's `presentation.viewer = "transcript"` hint rather than the session store's own list rendering.

## Design Acceptance (non-release, v43 migration)

- [ ] Declare one §12.3 pipeline for every `v1` intent, including its exact domains, required Outcome facts, and rendering.
- [ ] Generate each intent's status from real evidence and prove no `partial` or `declared` intent is presented to users as available.
- [ ] Prove no intent is reported `verified` while any domain in its pipeline remains `declared` under ADR-002 §17.6.
- [ ] Prove U10, U11, and U12 pipelines consume §15.5 Outcome facts rather than reprinted message strings.

## Design Acceptance (non-release, v42 migration)

- [ ] Prove every shipped user-facing surface serves at least one §12.1 `v1` intent, and that no surface exists for an intent absent from the registry.
- [ ] Prove each `v1` intent is reachable without the user naming a tool, package, Skill, MCP server, ResourceRef, or capability domain.
- [ ] Prove U10, U11, and U12 have real surfaces showing exact target/staged change, provenance drill-down, and truthful failure with a recovery path.
- [ ] Prove no `later` intent is presented as available.

## Design Acceptance (non-release, v41 migration)

- [ ] Ordinary UI and runtime routing expose one fixed Irisy identity with no Assistant/Coding or persona/role registry.
- [ ] Runtime assembly can show the exact context tuple for a turn and contains only explicit ResourceRefs.
- [ ] The canonical Irisy transcript store recovers every live Irisy session after reset/restart; no engine or project store continues as another live owner.
- [ ] Hermes and former Coding history imports create new canonical sessions without overwriting active transcripts or resuming historical owners.
- [ ] A selected FCT resolves live before turn assembly, preserves Work ResourceRefs, appends/deduplicates dependency ResourceRefs, and supplies optional internal Skill plus enforced least-privilege gate scope; unavailable projection reports once, returns the session to Auto, resets, and never sends stale context.
- [ ] A pinned internal Skill can alter method projection but cannot create or own a session.

These are migration criteria and do not mark implementation acceptance complete.
