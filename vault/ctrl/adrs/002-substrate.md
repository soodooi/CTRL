---
adr_id: 002
module: substrate
title: CTRL substrate — BYO-CLI driver · projection · capability surface · 3-capability-face · provider router · crypto · subprocess · MCP bus · composition
version: 90
status: accepted
last_updated: 2026-08-05
deciders: [bao, zeus]
sections:
  - { id: brain,                source: orig-003, note: "v27 reframed: BYO-CLI driver brain — user-chosen local CLI (Claude Code etc.); CTRL never spawns/supervises a brain. Prior hermes-ACP/Pi/opencode-as-brain content retired, kept in changelog as provenance." }
  - { id: projection,           source: new-2026-06-17, note: "v79: feature-pack OpenCode workspace projection requires explicit manifest projection.coding_workspace=true; data semantics such as record_source never imply actor/surface eligibility. Base asset projection remains type-routed." }
  - { id: agent-channel,        source: new-2026-06-17, note: "§1.8 (v27) demoted: ACP is a future enhancement channel for ACP-aware CLIs, NOT the main path — main path is § projection. ACP code retained as future work. §1.8.6 v75 adds capability-negotiated multi-modal attachment ContentBlocks, shared by Irisy and opencode." }
  - { id: capability-faces,     source: H-2026-06-09-002 conversation, note: "3-face SSOT — MCP / API / Skills 互补不塌缩" }
  - { id: capability,           source: orig-004 }
  - { id: provider,             source: new-2026-05-31, note: "VMark port + role routing + introspection" }
  - { id: crypto,               source: orig-007 }
  - { id: subprocess,           source: orig-012 }
  - { id: mcp-bus,              source: orig-013 }
  - { id: composition,          source: orig-024, note: "v88 §15.4.1: capability availability is user-owned plain-text state; enable/disable are the catalogue Resource's bounded produce operations, disabled stays installed but unselectable and unprojectable, and install/uninstall keep their existing surface. v84 §7/§15.4/§16: FCT is the sole user-facing reusable-capability noun and a normalized selection projection over the existing registry; internal manifest/package/Skill/capability authorities remain unchanged. v73: versioned draft-2020-12 JSON Schema is the sole cross-language manifest authority." }
  - { id: vault,                source: new-2026-06-01, note: "kernel vault primitives + feature-layer boundary; Daily Note + Sourcing are feature-layer (Irisy + frontend)" }
  - { id: smart-table-output,   source: new-2026-06-03, note: "mcp output unification — single SmartTable per mcp, schema in manifest output_capture" }
  - { id: embeddings,           source: new-2026-06-03, note: "local Ollama nomic-embed-text + SQLite vector blob + cosine flat search; hybrid mode on vault.search; 5 new MCP tools" }
  - { id: audit-ledger,         source: new-2026-06-04, note: "kernel-side immutable record of every self-evolution event across the 6 loops (ADR-001 §8). Reuses persistence.rs SQLite event store with a new event kind; replay-able, queryable from PWA settings." }
  - { id: diagnostics-projection, source: new-2026-07-25-v72, note: "Existing ACP, subprocess, vault watcher/index, and gate owners publish content-free lifecycle metadata to ADR-010 diagnostics without transferring execution ownership." }
  - { id: unified-operation-interface, source: new-2026-06-19, note: "§14 — describe/query/produce is the uniform external vocabulary. v83 retires QuerySource/RecordSink as permanent architecture: they are migration adapters behind the sole ResourceOwner contract until removed; descriptor-owned schemas type owner-private payloads." }
  - { id: resource-contract, source: bao-2026-08-05-track-0, note: "§15 v83 sole permanent contract: ResourceRef → one ResourceOwner → describe/query/produce through one ResourceRegistry; descriptor schemas are payload-shape authority; system catalog discovers refs; stable-handle filesystem resolution remains v82. §15.2 v90 extends the write contract from one Markdown note to a note's tasks, one calendar event, and a smart table's cells, each with one bounded field change and one shared stale/unverified reply shape." }
  - { id: local-discovery, source: migrated-adr-007-retired-v3, note: "§16 v84 one hot-scanned local registry with one normalized FCT projection, namespaced refs, canonical selection resolution, anonymous local install, and no second registry." }
  - { id: outcome-contract, source: bao-2026-08-05-verifiable-pipelines, note: "§15.5 v86 typed owner-produced Outcome (target/staged/precondition/provenance/effect/Feedback); boundary error-string flattening is a defect; ReviewGate requests derive from the prepared Outcome without changing who may approve." }
  - { id: capability-registry, source: bao-2026-08-05-single-truth-lists, note: "§17.5 v89 per-source narrowing is implemented and enforced at the gate's single visibility decision; a bare `source` grant authorizes no connector. §17 v85 sole enumerated capability-domain authority; §17.6 v86 requires an executable per-domain pipeline before a domain is `verified`; visibility.rs becomes its implementation; domains are consumed by tool classification AND owner-side capability scope; §17.4 records that always-on verbs mean tool scoping does not bound Resource reach; §17.5 requires per-source narrowing for connectors; ADR-010 owns enforcement placement and ADR-005 §12 maps user intents onto these domains." }
changelog:
  - v90 2026-08-05: **§15.2 write-contract coverage extended from one Markdown note to the three record sources (bao: 完成剩余的改造和测试).** v87 fixed the contract and shipped one vertical, the whole-note replacement. Tasks, calendar events, and smart-table cells stayed on their bespoke §14.13 tools, which answer with a sentence like "updated Inbox.md line 4 field status". That is a fact deficit with real consequences, not a presentation choice: a row or line index addressed from an earlier scan can mean a different record by the time the write lands, and the reply cannot say what the previous value was, whether the source had moved, or whether anything was verified — so a surface either trusted it blindly or reprinted the sentence. Worse, the smart-table viewer implemented a cell edit as a whole-file rewrite with no precondition, so two people editing different cells meant the second write silently discarded the first. Three canonical owners now exist: a note's tasks (`ctrl://local/task/<note>`, addressed by line, which is a task's real identity in Markdown), one calendar event (`ctrl://local/calendar/<event note>`, addressed by note rather than by scan position), and a smart table (`ctrl://local/table/<table note>`, cells by row index in `query` order). Each offers exactly one bounded field change under the full §15.2 contract and returns a §15.5 Outcome, and each delegates validation and rendering to its existing source so there is one writer rather than a second that could disagree with the reader. The stale-precondition reply, the unverified-write reply, and the empty-field rendering are defined once for all record writes on both sides of the boundary, because a surface renders all three through the same decision registry and three copies would diverge into what looks like different failures. Taking the contract literally for a delegated writer surfaced four defects that a reply-shape change alone would have hidden. Verification compared the caller's raw request against the stored value, so every normalization the writer legitimately performs — a comma-separated tag list, a `status` synonym — was written correctly and then rolled back and reported as a failure. The rollback restored through the frontmatter-rendering writer, so an undo dropped frontmatter comments and reordered keys; it now restores the exact bytes that were read. The previous bytes lived only in memory, so clause 3 was cited but not implemented and a failed rollback could not tell the user where their content went; a shared recovery point now lands beneath the kernel derivative state root before the source is touched, and failing to write one aborts the operation. And a "one field" change was reformatting whole files, because the task writer rebuilt the note through the frontmatter-rendering writer and rejoined lines with `\n`: a plain note gained an empty frontmatter block and a CRLF note came back LF throughout, both reported as verified successes because the reread only inspected the changed field. The atomic writer itself then failed its own no-follow discipline: it staged through a PREDICTABLE dot-prefixed sibling opened with a plain create, so a symlink planted at that name redirected a note's bytes outside the vault and the rename installed the link as the note, after which every later write escaped too — and it returned success throughout. `note_resource::commit_atomically` in the same tree already defended exactly this, so the fix is its discipline rather than a new one: a nanosecond-unique staging name, `O_EXCL | O_NOFOLLOW`, cleanup only past a successful create, and a parent directory sync so the rename itself is durable. It also preserves the note's mode, since a rename installs the staging file's permissions and would silently widen a note the user had restricted. Chasing the same fidelity question through the vault reader turned up a latent CRLF defect with repo-wide reach: both `split_frontmatter` and `raw_frontmatter_prefix` recognized a `---\r\n` opening fence and then advanced four bytes past it instead of five, and the body separator was stripped as `\n` then `\r`, which left a CRLF note holding `\n\r\n`. Together those meant every CRLF note read with a frontmatter text that began with a stray newline and a body that began with extra blank lines — so every line index in it was off, and a body rewrite left the closing fence's last `-` at the start of the body. Both are fixed with tests, and line-addressed writes are the reason it mattered. Making clause 4 true for these owners also exposed that it was not true for anyone reusing the vault writer: `vault::write` and `write_body` truncated the target before filling it, so a crash, a full disk, or a killed process left the user holding half a note, and a concurrent reader could observe that truncation. Both now write a flushed temp sibling and rename it over the target, which is the only step a reader can observe — so every vault writer inherits atomic commit rather than only the owners that reimplemented it. Adds no verb, primitive, transport, registry, or authorization axis: record writes reuse the vault grant and the existing three verbs. Column operations on a table stay on the bespoke tool, which owns the in-place frontmatter `schema` patch, until a schema change gets its own staged form. Moves ADR-005 §12 U6's canonical-operation stage to verified for all three sources; the intent itself remains `partial` because the smart-table cell edit has no DOM-driveable UI test (canvas rendering), the calendar has no first-party editing surface yet, and row/column operations still rewrite the whole file without a revision precondition. Pairs ADR-005 §12 v43 U6 and ADR-003 frontend §8.5 v44.
  - v89 2026-08-05: **§17.5 per-source narrowing implemented; §17.5's coarse-authorization gap closed (bao: U8 继续).** The rule was accepted in v85 and unimplemented, which meant a grant for "read my spreadsheet selection" also authorized every other installed connector, including credentialed ones. Enforcement lands at the gate's single visibility decision, not inside each connector verb: the generic verbs stay visible under the `source` domain, but the addressed `source_id` must be named as `source:<id>`. A connector call with an absent or blank `source_id` is denied, because an unaddressed call cannot be narrowed. `source:<id>` parses as narrowing rather than a domain token, so it never opens `mcp`, never grants a sibling or a prefix/suffix relative, and never widens to raw downstream tools; owners can still observe it because `resource_scope()` emits it. An unscoped in-process intent still reaches connectors, having no external caller to narrow. First-party callers are not exempt: the PWA's default scope holds the `source` domain and therefore names nothing, so the gate bridge (`gate_invoke`) gained an optional declared intent and the local-app read now declares `source:<id>` for exactly the connector it reads. Moves ADR-005 §12 U8 to `ready` and removes the standing instruction not to call connector authorization least privilege.
  - v88 2026-08-05: **NEW §15.4.1 capability availability is user-owned state (bao: 逐条管线要通畅，前后端通畅).** Serving ADR-005 §12 U15 ("install or enable") and U18 ("manage what is installed") exposed a missing state, not a missing screen: `installed` was the only state an installed capability could reach, so a user who wanted to stop using one had to uninstall it and throw away its files and configuration. This amendment accepts availability as a third state, owned by the user and stored as plain text at `~/.ctrl/capabilities.toml` as a list of disabled refs, readable and repairable in an ordinary editor. It adds no registry, primitive, identity, or authorization axis; it narrows what the existing catalogue offers. `enable`/`disable` become the catalogue Resource's only bounded `produce` operations, returning §15.5 Outcome facts with availability before/after as the staged change, while install and uninstall keep their existing surface rather than gaining a second one. Binding rules: a disabled capability stays installed and listed with its owner shown, and re-enabling needs no reinstall; the catalogue both reports it unselectable and refuses to project it, so a stale caller-held ref cannot bypass the state; a malformed state file fails closed as owner-unavailable rather than reading as "nothing disabled"; availability is a privilege change, so an external caller's request is review-eligible and the owner stages before committing; the file is rewritten atomically and reread before success is reported, per §15.5.2; and a management surface names what owns each capability so removal is never a guess. Showing a capability's own files is accepted as a Tauri shell/OS command addressed by capability ref rather than by path, so the kernel keeps path authority and refuses any ref that is not a single directory segment beneath its install root. Moves ADR-005 §12 U15 and U18 to `ready`.
  - v87 2026-08-05: **§15.2 accepts the Markdown note write contract — the first governed canonical mutation (bao chose the write vertical over adding four more surfaces).** v83 deliberately left `produce` unsupported for notes until revision/hash preconditions, a write recovery point, atomic commit, post-write reread, partial-failure handling, and rollback evidence were accepted; this amendment accepts exactly that list and nothing wider. The owner may advertise one bounded operation, `replace_content`, requiring the caller's `expected_revision` with the new content. Preconditions, all binding: the change is staged into §15.5 Outcome facts (target, before/after, revision) BEFORE approval is requested, and an unstageable operation is not review-eligible; the revision is rechecked immediately before mutation through a freshly resolved stable handle, and a moved revision writes nothing and returns typed `Feedback` with a precondition code and `retryable: true`; the previous bytes are durably captured beneath the kernel-managed derivative state root — outside the user's content tree — and failure to write that recovery point aborts the operation; the commit is a flushed temporary sibling renamed over the target so no reader sees a partial file; the owner then reopens through a stable handle and compares the actual committed revision, reporting success only from observed state with `effect.verified_by` naming the check; on mismatch the owner restores the recovery point and reports the rollback rather than success, and if restoration also fails the failure is non-retryable and names the recovery location so data stays hand-recoverable. Scope stays one whole-note replacement on one local Markdown file: partial-range writes, multi-file transactions, external application writes, and durable `OperationRef` effects remain unsupported, and every other Resource kind still returns structured unsupported until its owner meets this same list. Two further clauses were added after an independent review found real defects in the first implementation: the write is serialized per resource, because two writers that both passed the recheck could interleave and the loser's rollback would revert content the winner had already verified; and the temporary sibling is created with exclusive no-follow semantics, because a plain create would let a pre-planted link redirect the write outside the authorized root. The same review established that the recovery point must be enforced outside the content tree in every constructor, not only in tests, and that owner-side capability scope is caller-declared, now recorded in §17.4. This moves ADR-005 §12 U6/U10/U11 from `declared` to `partial`; no frontend caller exists yet, so none of them is `verified`.
  - v86 2026-08-05: **NEW §15.5 Outcome + §15.5.3 ReviewGate fact derivation + §17.6 per-domain pipeline (bao: 开始修订，每个清单的逐条意图和能力都得有可验证的管线).** Root cause: the canonical three-verb path returns structured errors, but roughly a hundred remaining tools collapse typed failures with `e.to_string()`, and the accepted §14.11 `Feedback` type has zero production producers — so a caller receives one sentence and can only reprint it. That fact deficit, not a presentation choice, is why consequential surfaces improvised: raw errors were rendered as assistant replies, typed `retryable` was discarded, and the approval surface could not state what would change. §15.5 makes an operation's result a typed owner-produced `Outcome` carrying target, staged before/after, precondition, provenance, committed effect with the owner's post-commit verification, and `Feedback` on failure; it is descriptor-typed and adds no verb, primitive, transport, registry, or authorization axis. Rules (§15.5.1 shape, §15.5.2 rules, §15.5.3 review derivation): reducing a typed failure to a message string at a boundary is a defect in that change and existing cases are declared debt under a non-decreasing ratchet; success requires verified committed state or truthful degradation; a caller may render an Outcome but never synthesize a target/staged/precondition/effect, and prose is never an Outcome fact. §15.5.3 requires a canonical `produce` review request to be built from the prepared Outcome rather than tool name plus argument summary, while the gate-derived, non-caller-prose, and no-self-approval properties remain binding — enriched facts widen what the human sees, never who may decide. §17.6 requires each domain to be `verified` by an executable pipeline (classification, admit, deny at visibility and invocation, owner-side enforcement) generated from real owners, and reported as `declared` until then. First vertical: one Markdown note write. Pairs ADR-005 irisy §12 v43 (per-intent pipelines) and ADR-003 frontend §8.5 v44 (surfaces render Outcome facts).
  - v85 2026-08-05: **NEW §17 capability domain registry — the enumerated capability vocabulary becomes accepted authority (bao: 整理成能力清单和意图清单，唯一真相).** Before this amendment the domain list that authorizes every cross-domain call existed only in `src-tauri/src/kernel/visibility.rs`, so the vocabulary had no owning decision and could drift silently. §17.1 enumerates `system` plus 19 grantable domains with what each authorizes; that code is now an implementation of this table. A domain is an authorization unit, never a product shelf, menu, tool namespace, Resource kind, or FCT. Rules: the registry is amendable but never unilaterally — any add/rename/merge/remove/rescope requires explicit discussion with bao and bao's decision before the amendment, and code may not introduce a domain ahead of that decision; an amendment lands in the same change as the code; a tool classifies into exactly one domain; unclassifiable and downstream-server tools resolve to `mcp` rather than a first-party domain; `net` never enters a default grant and a network-capable domain must be endpoint-restricted; an exact `tool:<name>` grant never implies its domain or a sibling; absent caller scope resolves to a declared default, never the full surface. The agent-facing surface remains exactly the three verbs (§15.2) and FCT still projects a least-privilege subset (§15.4). §17.1 also records that a domain is consumed in two places: tool-name classification and owner-side capability scope. `project` is the owner-side-only case — no tool prefix classifies into it, yet the Project Resource owner denies access without it — so a domain may never be removed on tool-classification evidence alone. §17.4 records that tool-surface scoping never decides which refs are reachable, because the three verbs are always-on and §15.2 owner authorization is the real control for content. §17.5 accepts that a whole-domain `source` grant is insufficient: it authorizes every installed connector at once, so an FCT MUST narrow it to `source:<id>` exact grants reusing §15.4's shape, and the current coarse state must not be described as least privilege until that lands. Pairs ADR-005 irisy §12 v42 (intent→domain mapping) and ADR-003 frontend §8.5 v42 (surface conformance); ADR-010 § trust-domains v14 continues to own where enforcement happens.
  - v84 2026-08-05: **§7/§15.4/§16 product-language and executable-selection amendment — FCT is CTRL's sole user-facing reusable-capability noun (bao confirmed; PRJ cancelled).** FCT is not expanded in product copy and does not create a sixth primitive, owner, registry, runtime, manifest format, or protocol. It is the normalized selectable projection of one namespaced registry entry into Work-preserving appended Resources, optional Skill, enforced least-privilege gate scope, policy facts, and the existing package/install reference. Zero-Resource FCTs are valid only when Skill or enforced scope changes. Stable refs resolve live per turn; invalid selection reports once, returns that session to Auto, and never sends stale/widened context. Create/Manage remains a separate Library mode from composer Use. Skills remain internal plain-text method assets; manifests, MCP, package/pack APIs, disk paths, and `ctrl-<name>` identities remain compatibility and implementation terms.
  - v83 2026-08-05: **§14/§15 convergence amendment — one permanent Resource contract, not a Source-centered substrate (bao confirmed after explicit over-design review).** The end-state is exactly `ResourceRef → ResourceOwner → describe/query/produce`: one owner owns descriptor and behavior, and one ResourceRegistry selects and dispatches all three verbs. Descriptor-owned JSON Schemas are the sole cross-boundary payload-shape authority; the gate validates untrusted JSON against one descriptor snapshot, then the same owner deserializes into private typed models and performs semantic/actual-object authorization. `QuerySource`, `RecordSink`, `ProduceOp`, and namespaced tools become bounded migration adapters, not peer architecture, and retire as owners move. One ref identifies one independently governable logical object; the registry registers `(authority, kind)` owners, never instances. `ctrl://local/system/catalog` discovers refs but is neither dispatch nor authorization. The first canonical vertical is a read-only Markdown file ref such as `ctrl://local/note/daily/2026-08-05.md`, resolved and read through the v82 stable-handle path; its descriptor advertises no produce operation and direct produce returns structured unsupported until a separately accepted revision/rollback contract exists. No collection model, global query/operation enum, rollback framework, or OperationRef implementation is introduced by this slice.
  - v82 2026-08-05: **§15.1 implementation lock — bounded canonical ResourceRef and stable-handle traversal (bao confirmed before code).** A ResourceRef is at most 4096 bytes; `kind` is 1–64 ASCII bytes; `id` has 1–32 segments, each 1–255 UTF-8 bytes after decoding and NFC normalization; optional `rev` is 1–256 bytes and is the only permitted query key. Parsing rejects credentials, fragments, controls, malformed or non-canonical ambiguity, encoded slash/backslash, decoded slash/backslash, and decoded dot segments. Canonical text preserves authority/kind case rules, decodes RFC 3986 unreserved bytes, NFC-normalizes decoded text, then emits uppercase percent escapes. Filesystem owners on macOS/Linux anchor an authorized root directory handle and traverse component-by-component with `openat(..., O_NOFOLLOW)` plus `fstat`; authorization observes the opened handle. Windows returns typed `PlatformPrimitiveUnavailable` in this slice. No platform may fall back to canonicalize-then-open. The implementation adds only the ResourceRef/ResourceDescriptor/OperationRef/Feedback, one-owner registry, and resolver foundation; canonical gate tools remain Track 3.
  - v81 2026-08-05: **NEW §15/§16 authority amendment — typed ResourceRef and one local discovery registry.** ResourceRef grammar, security, registry resolution, ResourceDescriptor ownership, exact agent verbs `describe(ref)` / `query(ref, request)` / `produce(ref, operation)`, OperationRef retry/recovery/retention semantics, and version-windowed compatibility aliases are fixed here. A Skill is method-only and never spawns or owns a session. ADR-007's local discovery/search/install/source policy migrates here as one hot-scanned local registry with normalized provider adapters, anonymous local install, and optional developer PAT in the OS keychain; no second discovery registry is permitted. Five primitives, plain text, ReviewGate, and `:17873` remain unchanged.
  - v80 2026-08-03: **§7 composition amendment — feature-pack Skills converge on one hot-scanned local `SKILL.md` registry instead of a vault-KB shadow system (bao requested full Irisy architecture repair after a pinned Chinese Skill was ignored in favor of hardcoded `stock-analysis-cn`).** The manifest `skills[]` axis resolves bundle-relative SKILL.md assets at install and projects each atomically under CTRL-managed `~/.ctrl/skills`; user `~/.claude/skills` overrides retain first-hit precedence. UI listing, explicit Assistant/Coding pin resolution, and gate `skill_list`/`skill_read` consume that same registry. `knowledge_base` remains Resource context and cannot host a second discoverable Skill authority. Skill text defines method only; feature-pack tools/data remain separate capabilities visible solely through the governed `:17873` gate. A stale explicit pin is an error, never silent Auto fallback. Pairs ADR-005 irisy §11 v39.
  - v79 2026-08-02: **§1B.8 amendment — per-pack OpenCode workspace eligibility is explicit, never inferred from §14 data semantics (bao confirmed the one-dialog/two-agent design and projection boundary).** A manifest projects a Coding/OpenCode workspace only when `projection.coding_workspace` is exactly `true`; the default is false. `record_source`, `knowledge_base`, local MCP backing, and other capability/data fields remain available to Irisy or the gate without granting Coding actor scope. `project_installed_packs` therefore stops using `record_source` as an eligibility proxy and checks the explicit projection flag before calling `project_pack`. Existing eligible packs must opt in; LibreOffice Companion deliberately does not. This supersedes v74's trigger while retaining the same scoped `.mcp.json` + `opencode.json` + `AGENTS.md` mechanism for opted-in packs. Pairs ADR-001 spine §4 v20, ADR-003 frontend §8.5/§8.6 v38, and ADR-005 irisy §8.7/§11 v37.
  - v78 2026-08-02: **§7/§14 amendment — generic local MCP-backed §14 Source, with LibreOffice as the first read-only consumer (bao approved方案 A).** An installed, explicitly enabled pack may declare a local stdio MCP server plus a `record_source.query.mcp_tool`; `source_describe` still derives the type layer from manifest data, while `source_query` invokes that private downstream tool through the existing `McpHost`, converts only its declared row payload, and then runs the shared kernel query engine. The downstream server id/tool names and raw MCP surface never reach Irisy; callers still see only the generic `source_describe/source_query/source_produce` trio through `:17873`. The first LibreOffice slice is Companion/read-only: a user-installed extension is the only future UNO boundary, the TypeScript/JavaScript child reads only explicit Writer/Calc selection, and unavailable/no-selection states fail honestly. `produce` is unsupported until revision/target-hash preconditions, ReviewGate staging, native write, and post-write reread are implemented. Pairs ADR-004 cap § execution v13, ADR-010 communication § transports v12, and ADR-005 §10 v35.
  - v77 2026-07-28: **§14 amendment — sources may expose a governed analytical cache and generic presentation metadata without introducing a second user-data truth or a parallel resource API (bao: resource layer for all feature packs).** User-facing data remains readable local Markdown, structured frontmatter, or another declared portable source format; DuckDB is permitted only as a rebuildable, source-owned analytical cache for columnar/time-series work. Every cross-pack or userland read/write stays on the existing `describe`/`query`/`produce` contract through `:17873`; a cache has one owner and serializes its writes, never becomes a shared writable database. `describe` gains cache/freshness/provenance/presentation facts so a generic frontend viewer can render a source by kind rather than storage engine, with raw-data drill-down. `ctrl-stock-cn` is the first reference implementation, initially limited to its time-series query path and its freshness/provenance descriptor facts. No schema, tool, database, or frontend implementation ships in this amendment.
  - v76 2026-07-27: **§7 Composition amendment — pack authoring research becomes a durable vault note, closing the "source untraceable" gap (bao: "功能包的文件架构需要规范和统一，且要完整…用户需要有创建该功能包的输入").** A user asked what a feature pack's on-disk structure contains, then correctly flagged that neither the installed pack directory (`~/.ctrl/mcps/<id>/`, manifest + optional assets/server code only) nor the manifest schema (§7) carries ANY record of what the pack was researched from — the endpoints verified, the products compared, the user's own words, the reason one pack form was chosen over another. `create-feature-pack` SKILL.md v1.1.0's research step only specified ACTIONS (`discover_packs`/`web_search`/read vault) with no required OUTPUT, so once the authoring conversation ended, the research evaporated — unrecoverable, unauditable, and never checked before a second similar pack repeated the same research from zero. Fix (SKILL.md v1.2.0, deliberately NOT a manifest schema change — that stays §7's cross-language authority, untouched): the research step now requires writing `Research/feature-packs/<pack-id-or-topic-slug>.md` in the vault (via `doc_produce`/`vault_write`, the SAME tools the pack-authoring agent already has under `vault` intent) with five sections (Job / Sources / Comparable products / User signals / Decision), populated only as they apply; check that path for a prior note on a similar pack BEFORE re-researching; and point the user at the note during the confirm step instead of re-explaining findings inline. This is a vault-note convention, not a new storage layer or manifest field — one more Research/ subpath alongside Irisy's own existing `Research/<topic>.html` habit (ADR-005 §9), so the mechanism is not new, only the required-for-pack-authoring discipline is. No gate tool added, no manifest field added, no code changed — the durable link from an installed pack back to its research is a plain-vault backlink/search, not a manifest cross-reference (keeps §7's schema the sole structural authority; this is process, not protocol).
  - v75 2026-07-27: **§1.8.6 NEW — multi-modal prompt attachments via capability-negotiated ACP ContentBlocks, shared by Irisy AND opencode (bao "这个输入协议层，Irisy和opencode是都要用的" + "拖拽要的" + "对标一个产品做").** Researched before building (Cursor's drag-to-Composer, Claude Code's Shift-drag-to-attach, and the official ACP/MCP content spec) rather than inventing a workaround: dropping a file into a chat composer should travel as a protocol-native `Image`/`EmbeddedResource` ContentBlock inlined into the `session/prompt` request (the spec's own "preferred way to include context... such as @-mentions"), not as a workspace-file-plus-text-hint kludge. `AcpClient` gains: (1) capture of the connected engine's negotiated `promptCapabilities` (image / embeddedContext) from its handshake response, exposed via query methods; (2) `prompt()` accepts an attachment list alongside the text turns and constructs the matching ContentBlock only when the engine declared support for it, degrading to a text notice (never a silent drop or a protocol error) when unsupported; (3) a size ceiling on inlined content (image downscale before base64; text truncation with an explicit notice) because base64-in-a-single-JSON-RPC-line-over-stdio (§1.8.1) has no multipart framing to absorb an unbounded attachment. Lives entirely in the protocol layer both Irisy's selectable engine (§brain v38) and Coding's `opencode` (ADR-001 spine §4 v16) already drive through the SAME `AcpClient` code path, so both engines get the capability from one implementation — but this amendment does NOT wire Irisy's own drag-drop UI (a distinct, not-yet-scoped semantic: feeding data to an installed pack, vs opencode's authoring-reference-material use). Pairs ADR-001 spine §4 v18 and ADR-003 frontend §8.5 v35 (the Coding-scene drag-drop UI consuming this).
  - v74 2026-07-26: **§1B.8 amendment — a per-pack projection scope also gets `opencode.json`, not just `.mcp.json` (bao "A" — extend per-pack projection so a feature pack is a real OpenCode launch target; independent review confirmed a pack scope carried the gate but not the file OpenCode itself reads).** v44 (§1B.8) made a feature pack its own projection scope with a pack-scoped `.mcp.json` + `AGENTS.md`, stamped with the pack's OWN intent domain. But ADR-001 §4 v13/ADR-003 §8.5 v27/ADR-005 §8.7 v27 made OpenCode the sole coding engine launched only against a directory carrying `opencode.json` — which `project_pack` never wrote, so every generated pack scope was listed as a workspace with its primary action permanently disabled (confirmed by an independent semantic review). Fix: `projector::project_pack` now also calls `project_opencode_into_dir(dir, port, token, Some(intent))`, so a pack scope carries BOTH gate shapes (Claude-Code-style `.mcp.json` AND OpenCode's `opencode.json`), each stamped with the pack's own intent — same as the base workspace projects both (§1B.1), just scoped. No new mechanism: reuses the existing `project_opencode_into_dir` (v27/v41's OpenCode-shape writer) with the pack's intent instead of the global `OPENCODE_CODING_INTENT` default. Verified: `cargo test --lib projector` 24/24 (new: `per_pack_scope_also_gets_opencode_json_with_its_own_intent` asserts the pack's own intent, not the global default, rides the `opencode.json` entry). Pairs ADR-001 §4 v14, ADR-003 §8.5 v28, ADR-005 §8.7 v28 (coding_launcher discovers + validates pack scopes as launch targets using the same predicate: a direct child of the configured root carrying `opencode.json`).
  - v73 2026-07-25: **§7 manifest authority becomes a versioned draft-2020-12 JSON Schema (bao approved方案 3), retiring TypeScript/Zod as the protocol source.** `packages/ctrl-mcp-sdk/schema/manifest-v2.schema.json` is the only cross-language field-shape, constraint, conditional, default, and legacy-acceptance authority. The SDK consumes it through pinned Ajv; the Rust kernel embeds and consumes the same artifact through pinned `jsonschema`, so Gate validation, publish, legacy Tauri, and `.mcpb` install boundaries fail closed without Node or a duplicate serde rule set. A shared conformance corpus pins shipped Ghostfolio, tolerant minimal/actions-only and pre-v55 server forms, retired ST-SS warnings, and representative invalid constraints. Runtime semantic evals remain separate and may require that a pack does something, resolve a positive `record_source` describe, warn about auth, and enforce environment/security policy, but they may not repeat structural field rules. Schema-declared defaults may be applied by a consumer during normalization; normalization cannot create a second validator. The old PWA `irisy-mcp-zod.ts` dialect and Zod schema exports are retired in favor of a thin compatibility adapter backed only by the shared parser. Pairs ADR-001 §5 v12.
  - v72 2026-07-25: **§brain/§subprocess/§vault/§mcp-bus diagnostics projection.** Existing owners publish content-free lifecycle metadata into the single ADR-010 §diagnostics composer: ACP owns Irisy process/session state, SubprocessActor/CodeSpace owns PTY lifecycle, vault watcher/index owns Notes freshness, and the gate owns authorized read-only projection. Diagnostics never becomes an execution owner and never creates a second ACP loop, PTY, watcher, index, or audit ledger. Module snapshots expose only bounded/redacted metadata and correlation identifiers; raw prompt/tool/terminal/note/path/secret payloads remain inside their owners.
  - v71 2026-07-25: **§3 verification becomes persisted evidence, and every production text completion uses one router.** `~/.ctrl/state/active-providers.json` upgrades in place to v4: role intent and verification evidence are independent maps. Evidence stores only a SHA-256 fingerprint of the behavior-relevant manifest plus the resolved credential; no raw secret is persisted or logged. A provider is verified only when current configuration reproduces that fingerprint after the real production trial. v0/v2/v3 bindings migrate as bound-but-unverified; pre-v3 automatic `irisy.fallback = ollama` is still removed fail-closed. Clearing a role preserves reusable verification evidence, while deleting or replacing configuration invalidates it by removal or fingerprint mismatch. `RouteChain` admits only explicit bindings whose current fingerprint is verified. All production text-chat callers drain the shared router, preserving runtime probe, cooldown, first-chunk validation, failover recording, and explicit fallback semantics; direct primary/fallback adapter selection is retired. Settings displays configuration, runtime, verification, and role bindings as orthogonal facts, so unavailable runtime never hides a bound role. Ordinary configuration Test remains non-mutating and does not create production verification evidence.
  - v70 2026-07-25: **§3 provider state and fallback are runtime facts, not builtin assumptions (bao:「重整」).** Provider catalogue presence, saved configuration, runtime availability, production verification, and role binding are distinct authoritative states. Adapter construction no longer means `Ready`: each adapter may report a typed runtime probe; Ollama specifically probes its configured daemon and requires the selected model tag before it is `available`. First launch binds neither primary nor fallback, and the legacy unconditional `ollama` fallback seed is retired; v2 state carrying that automatic binding migrates once to an unbound fallback. `provider_set_active(role,id)` remains the only binding path and still requires the real 30-second production first-output trial. `irisy.primary` may route only to its explicitly bound primary and then its explicitly bound fallback; the router must consume the same `RouteChain` rather than ignore it, and no unbound/first-ready provider scan is permitted. Settings renders the typed states (`Needs configuration`, `Runtime unavailable`, `Available`, `Configured`, `Primary`, `Fallback`) and exposes both role bindings; no fallback is displayed as `No fallback`. This supersedes §3.5/§3.6 v2/v8/v9 fallback contradictions and pairs ADR-006 v12.
  - v69 2026-07-25: **§3 provider activation trial separates connectivity proof from model reasoning.** The mandatory `"hi"` trial remains a real production-adapter request under the single 30-second setup-to-first-visible-output deadline and still commits no binding on failure. For OpenAI-compatible providers that explicitly support a thinking control, the trial requests reasoning disabled so a tiny verification output budget cannot be consumed entirely by hidden `reasoning_content` before `finish_reason=length`; ordinary chat omits this override and preserves the provider/model's configured or default reasoning behavior. The generic adapter must not send vendor-specific thinking fields to endpoints that do not declare that compatibility. This closes the GLM-5.2 Coding Plan false negative (`stream finished before first output`) without treating hidden chain-of-thought as user-visible output or weakening fail-closed activation.
  - v68 2026-07-25: **§3 provider activation trial uses one realistic first-output budget instead of rejecting valid providers at 5 seconds.** `provider_set_active` still performs the production 1-token `"hi"` round trip and persists nothing unless the first output succeeds, but setup plus first chunk now share one absolute 30-second deadline. The prior 5-second lock rejected a correctly configured Z.AI Coding Plan provider whose production adapter returned `Hello!` at 7.35 seconds, leaving no active binding while the UI still showed the configured manifest. A single absolute budget prevents the former nested 5s+5s ambiguity, keeps failures fail-closed, and preserves the previous binding on timeout/auth/network/model errors. Provider presence, credential readiness, and active binding remain distinct states.
  - v67 2026-07-23: **§3.10 provider/model catalogue becomes complete and refreshable instead of a hand-maintained shortlist (bao:「provider还不完整，譬如z.ai没有全部模型；要做完整的provider和模型」).** CTRL now refreshes [Models.dev](https://models.dev/api.json) on boot and whenever Settings → Providers opens, caches the transformed result under `~/.ctrl/cache/provider-catalog.json`, and keeps the 21 bundled templates as an offline floor plus user overrides as highest precedence. The transform imports every API-key provider representable by CTRL's existing OpenAI-compatible or Anthropic Messages HTTP shapes and every advertised model id; OAuth/profile-only, local-runtime, templated multi-credential, and provider-specific wire shapes remain authoritative in OpenCode `/connect` and are not falsely presented as compatible. Existing CTRL ids are preserved through explicit aliases (`zai` → `zhipu`, etc.). Z.AI's offline floor is corrected to the full current public catalogue (14 general models); Coding Plan remains a separate credential/endpoint and carries its six catalogue models, with `glm-5.2` as default. Live provider `/models` still wins after a key is entered; Models.dev/cache is the no-key and offline model source. No secret enters the catalogue request or cache.
  - v66 2026-07-20: **§3.10 provider catalogue — explicit Z.AI + Z.AI Coding Plan without duplicating OpenCode's provider authority (bao:「z.ai没有在provider内，opencode支持的provider必须都支持，z.ai的coding plan要支持」).** The persisted `zhipu` template id stays stable for existing manifests, credentials, and active bindings, while its user-facing label becomes `Z.AI`; a distinct `zai-coding-plan` template uses the Coding Plan OpenAI endpoint (`https://api.z.ai/api/coding/paas/v4`) because Coding Plan keys are not interchangeable with general Z.AI keys. The catalogue is now 21 entries. OpenCode provider breadth remains owned by OpenCode's native `/connect` + Models.dev surface (OAuth, cloud profiles, local runtimes, and API keys); CTRL does not mirror that heterogeneous catalogue or write its credentials, and `project_opencode_into_dir` continues to preserve the user's `provider` object while only upserting `mcp.ctrl-kernel`.
  - v65 2026-07-13: **§7 composition manifest compatibility makes ST-SS retirement non-breaking for declared v1/v2 data.** `stss-publisher` and Pattern F remain parse-only deprecated values with explicit `parseManifest` warnings so previously valid manifests can be identified and migrated; neither value is a current source nor has a live executor route. New manifests use only the active variant/pattern sets. This preserves the hand-versioned compatibility contract without reviving ST-SS.
  - v64 2026-07-13: **§2/§6/§14.7 transport terminology reconciled with the current event stack.** The live capability candidate is `event.{publish,subscribe}`; the MCP bus is adjacent to the event WebSocket rather than an ST-SS bridge; `query{watch}` emits current event deltas over `event_ws.rs` CBOR-over-WebSocket for browser/mobile and Tauri Channels on desktop. ST-SS wording remains only in explicitly historical changelog/provenance. Pairs ADR-001 v11 and ADR-010's accepted transport retirement.
  - v63 2026-07-13: **Governance/runtime truth reconciliation (no new architecture).** Removed retired Pi paths from binding Acceptance: the historical §12 checklist is now explicitly non-binding, the deleted Pi RPC evaluator is replaced by the source-pinned Hermes ACP release probe, and current brain acceptance points at `agent_installer`/`acp_client` plus the provider-router fallback. Pairs ADR-001 v9 Pi/ST-SS retirement and ADR-005 v23 historical-section labeling.
  - v62 2026-07-11: **§7 composition — builtin-pack 卸载墓碑:boot 自愈不再复活用户已卸载的内置包 (bao 2026-07-11「用户不是可以安装可以卸载吗?你系统如何设计的?」).** Root cause: `shell/builtin_mcps.rs::ensure_builtins_installed` re-seeds every bundled pack (`packages/ctrl-mcps/builtin/` — builtin-irisy + ctrl-ghostfolio) missing from `~/.ctrl/mcps/` on EVERY boot (self-heal for accidental deletion), with zero uninstall awareness — so `uninstall_mcp`/`mcp_pack_uninstall` worked until the next launch, then the pack resurrected; uninstall never bound for bundled builtins (user packs like ctrl-stock-cn were unaffected — nothing re-seeds them). Fix: **uninstall tombstone** `~/.ctrl/state/uninstalled-builtins.json` — `uninstall_from` records the id when it is a bundled builtin (`is_bundled_builtin` checks the bundled source set); the boot seeder skips a tombstoned id that is absent on disk (present dir wins over a stale tombstone); `install_into` clears the tombstone so reinstall-from-Discover heals normally again. Semantics preserved: self-heal stays for accidental deletion; deliberate uninstall now sticks. Verified: end-to-end unit test (seed → uninstall+tombstone → seed must not resurrect → clear → heals) under temp HOME + CTRL_BUILTIN_MCPS_DIR, 13/13 module tests green + live machine check. Not done (deliberate): no per-pack「隐藏 but keep installed」tier — uninstall/reinstall is the whole model (ISP,最小); bundling ghostfolio as a builtin at all is a separate product question (candidate: demote to Discover-installable, keep only builtin-irisy bundled) — not decided here.
  - v61 2026-07-11: **§3 provider — `claude-oauth` subscription provider REMOVED for Anthropic usage-policy compliance (bao 2026-07-11「provider去掉claude订阅,不符合claude的政策」).** Routing chat through the `claude` CLI billed against a Claude Pro/Max subscription violates Anthropic's ToS (subscription OAuth is for Claude apps, not a backend LLM provider — already flagged in vault log 2026-06-11「Anthropic 2026 ToS 禁第三方用订阅」). Removed end-to-end: `adapter/cli/claude_persistent.rs` (~600 LOC bespoke adapter) deleted; `ProviderKind::CliClaudePersistent` variant deleted (a stale user manifest now fails parse with a logged warning — regression test added); detect.rs first-boot CLI fallback tier + `CLI_FALLBACK_MANIFEST_ORDER` deleted (first-boot auto-adopt = BYOK REST keychain scan only; route_chain fallback = seeded `ollama` only); legacy `~/.ctrl/config.toml` `claude_cli`/`claude-code` bridge deleted (stale keys silently ignored); PWA `ProviderKind` union + irisy-render-filter codename map + label examples updated. Anthropic access stays **BYOK API key only** (`anthropic-api` manifest, ADR-006 § byok-no-claude unchanged). NOT affected: BYO-CLI driver projection (ADR-001 spine — user's own Claude Code discovering projected assets is Claude Code used as Claude Code) and the Code Space terminal (user-initiated interactive CLI session; injects only the user's own Settings→Env keys). **Follow-up hard gates (same day, module review「远程窗口/coding助理等」)**: (a) Irisy BYO engine (`irisy_chat.rs` + `acp_client`, ADR-005 §8.7/§8.8) — a BYO engine (claude-code / codex) now REFUSES to start when `byo_engine_auth_env` is empty and falls back to the provider router; previously the wrapped CLI silently used its own stored login (= Claude subscription OAuth) as Irisy's brain. (b) `commands/skills.rs` `run_brain_agentic` (CTRL-initiated headless spawn, gate/remote-reachable) — now strips inherited env then INJECTS the BYOK `anthropic` key from the credential vault; no key → typed error pointing at Settings → Providers. The old behavior (deliberate strip so the CLI「bills the plan」) was itself the policy violation. Notes-ui (Tolaria vendored) `stream_ai_agent` Claude Code integration confirmed DORMANT — kernel implements no such command, nothing bridged; cleanup candidate, not a violation. §3.4 example manifest / §3.5 state examples / §3.9 role-picker prose / Future-work bullets carry strikethrough-style amendment notes rather than history rewrites.
  - v60 2026-07-07: **§provider (+ §composition §7.4 registry, §crypto relay) — cloud-side infra topology for pack management / feedback / sharing decided; AWS scoped to ONE box (bao 2026-07-07「落 vault 基建文档 + ADR-002 §provider 修订」).** bao asked what servers pack management + feedback + sharing need. Decision: **stay on the existing Cloudflare stack (Workers + D1 + R2) for nearly everything; AWS is scoped to a single small box — a China-reachable egress proxy** that CF Workers' geography can't do (the ctrl-stock-cn deep-data gap: `qt.gtimg.cn` / EastMoney `push2his`). Rationale is moat-aligned, not industry-default: reflexively moving the backend to AWS forks the existing CF stack, loses R2's **free egress** (S3+CloudFront charges ~$90/TB), and adds servers to manage — wrong for a local-first, cloud-is-augmentation product (memory `feedback-jump-to-industry-default-not-ctrl-moat`). Component map: **pack registry/search** = Registry Worker + D1 (§7.4 already names Discover registry-pull; this pins the backend); **pack distribution** = R2 (manifest + bundled service code, egress free); **feedback collection** = Feedback Worker + R2 (screenshot/log blobs) + D1 + GitHub API, opt-in with a review gate, and — CTRL-unique — attaches the **gate audit trail** (`event-store.db` `audit_calls`, ground truth vs the brain's narration) so a report carries what actually happened (reuses existing infra); **user sharing of HTML/artifacts** = R2 + Worker short-link, private-by-default revocable token, recipient needs no account/no CTRL install (honors no-account philosophy). The **one AWS piece** = 1× Lightsail nano ($5/mo incl 1TB transfer, Tokyo ap-northeast-1 or HK; NOT EC2 — EC2 egress ~$90/TB) running a token-authed thin HTTP proxy whitelisting CN financial hosts. **Honest gap**: Tokyo/HK→mainland reachability is empirical — probe a real box before committing a region, don't guess (the globally-reachable price/volume + indicator layer via Yahoo/EODHD already works; this box only backfills 换手/资金流/龙虎榜 depth). Locks unchanged (local-is-truth / no-account / secret-not-in-LLM / edge-first / cloud = augmentation). Governing detail + cost table + sharing/feedback flows: `vault/ctrl/plans/infrastructure/infra-plan.md` (+ viz `docs/design/ctrl-infra-plan.html`). Pricing verified 2026-07 (Lightsail nano $5/mo; R2 egress $0; Workers/D1/R2 free tiers). No code shipped — this is the topology decision; slices (registry / share / feedback / CN-proxy) follow.
  - v59 2026-07-07: **§brain — bundled hermes pin upgraded 0.16.0 → 0.18.0 + existing installs now auto-upgrade (bao 2026-07-07「干这三步，升到 0.18.0」).** CTRL "rides hermes upgrades" (v28/v38), but the pin had sat at 0.16.0 (2026-06-06) while upstream shipped 0.17 ("Reach") + 0.18 ("Judgment", 2026-07-01) — notable for CTRL: **completion contracts** (the brain verifies its own work against evidence, not vibes — directly targets Irisy fabricating outcomes), `/learn` auto-skills, no-cron **Automation Blueprints** (maps to the pack cron line). PyPI-verified 2026-07-07: 0.18 `requires-python` still `<3.14,>=3.11` (HERMES_PYTHON=3.12 holds), and `hermes-acp --help/--check` show the ACP stdio interface CTRL embeds is unchanged (no breaking CLI/`/v1`/dashboard change). **Three-step landing**: (1) `HERMES_VERSION`/`HERMES_ACP_SPEC`/`HERMES_ONESHOT_SPEC` bumped to a single-source-of-truth const + `hermes_specs_match_version` test guards drift. (2) **Existing installs never auto-upgraded** — `install(force=false)` returns the cached manifest and both `agent_launcher` + `acp_client` replay the persisted `entry_cmd` (which bakes `==0.16.0`), so a pin bump reached only NEW installs. New `reconcile_hermes_pin()` (mirrors builtin-pack `builtin_is_newer` re-seed) runs at boot in `kernel_supervisor`: manifest version != pin → force-reinstall → manifest `entry_cmd`+`version` rewritten. (3) Smoke on the real machine: `uvx --python 3.12 --with mcp>=1.24 --from hermes-agent[acp]==0.18.0 hermes-acp --check` → `Hermes ACP check OK`; `hermes --version` → `v0.18.0 (2026.7.1)`. **Live proof**: `tauri dev` rebuilt+rebooted the kernel on the edit and reconcile ran for real — `~/.ctrl/agents/hermes/manifest.json` re-seeded 0.16.0 → 0.18.0 (install_at matched the reboot). Verified: cargo `--lib` 442 pass (+ the sync-guard test). **(4) Dashboard self-heal + a latent bug it exposed** (bao 2026-07-07「正的，加 dashboard 循环自愈」): a prior boot's DETACHED `hermes dashboard` (:17890) outlives kernel reboots and squats the port, so a just-upgraded dashboard couldn't bind and the old version served forever. `reconcile_hermes_pin` now returns whether it upgraded; on upgrade the supervisor calls `free_dashboard_port(17890)` (best-effort cross-platform listener-kill: `lsof`/`netstat`, only on a real version change) before relaunching. Live-testing this (arm manifest→0.16 → `tauri dev` reboot → watch) surfaced a PRE-EXISTING latent bug: the dashboard command was built from a hardcoded `entry[1..3]` that assumed `entry_cmd = [uvx, --from, spec, hermes-acp]`, but `install_via_uvx` had since injected `--python/--with` ahead of `--from`, so the slice dropped `--from <spec>` and uvx couldn't resolve hermes — masked all along ONLY because the stale squatter meant a fresh dashboard never had to launch. Fixed to reuse the full uvx prefix (`entry[1..len-1]`, i.e. everything but the trailing `hermes-acp`). **Live-verified end-to-end on the real machine**: reconcile re-seeded 0.16→0.18, `free_dashboard_port` evicted the stale listener, and the kernel (`target/debug/ctrl`) relaunched the dashboard via `uvx …--from hermes-agent[acp]==0.18.0 hermes dashboard --port 17890` which bound the port — one hermes process left, spec `==0.18.0`, zero 0.16 leftovers. Locks unchanged (hermes stays the bundled default, ADR-005 §8.7 selectable engine unaffected).
  - v58 2026-07-06: **§7 pack-code — kline SOLVED on this host: Yahoo Finance is the reachable primary source; full per-stock analysis proven end-to-end (bao 2026-07-06 confirmed this machine can't open EastMoney's quote/kline hosts).** v57 established push2his is unreachable here; the fix is a source that IS reachable. The kernel's `market_quote` already proves Yahoo Finance (`query1/query2.finance.yahoo.com`) works from this network, and Yahoo's chart API returns full daily OHLCV for A-shares via the `.SS`/`.SZ` suffix — so `stock_kline`/`stock_quote` now try **Yahoo FIRST** (adjclose-preferred close for indicators, ×2 mirror hosts, 9s), then akshare (qfq), then EastMoney direct — whichever answers first. This also fixes the latency: Yahoo returns in ~1.4s where akshare's own retries against the blocked hosts hung the turn for minutes. **Ledger + answer verified end-to-end on the real machine**: `stock-cn_stock_kline 000858` → `source: yahoo`, 6 real bars (2026-07-06 close 73.76 +0.75%) in 1.36s; then Irisy (`/debug/irisy/turn`) `skill_read stock-analysis-cn` → `gate_tool_search` → `gate_tool_call stock-cn_stock_quote` + `stock_kline` → computed MA5/10/20/60 (73.80/73.92/76.25/87.14), RSI(14)=31.3, MACD, 量比 → a data-grounded decision (中线偏空 + short-term oversold bounce window, buy triggers + stop 71.50) and wrote an HTML report to the vault — every number sourced, none fabricated. So the 规范 now BITES fully: real per-stock A-share buy/sell analysis works on this host. `_yahoo_kline`/`_yahoo_quote` are live-verified from the machine (not just offline-parsed, unlike the EastMoney path). Locks unchanged (source order is pack config; secret-not-in-LLM holds — Yahoo is keyless). Service in the user's vault (committed there).
  - v57 2026-07-06: **§7 pack-code — real-machine drive of `ctrl-stock-cn` kline: direct-connect needs EastMoney's public `ut` token + beg/end range; push2his confirmed unreachable from THIS machine (bao 2026-07-06「真机上 drive Irisy 分析五粮液 000858 验证 kline 直连」).** Ledger-verified end-to-end on the real SERVICE network (not the dev bash sandbox): Irisy `skill_read stock-analysis-cn` → `gate_tool_search "stock kline"` → `gate_tool_call stock-cn_stock_quote` + `stock_kline` — the 规范 → discover → call chain is followed exactly. Diagnosing the earlier v56 kline timeout showed push2his was ACCEPTING the TCP connection but never sending a body: the request lacked EastMoney's required public data token + a `beg/end` range. Added `_em_ut()` (the fixed shared push2/push2his token every anonymous caller sends — NOT a per-user secret; overridable via `EM_DATA_UT`, stored base64 so the hex doesn't trip secret scanners) + `beg=0&end=20500000` to the kline URL and the `ut` to the quote URL; failover now fails FAST (9s × 2 mirror hosts) so a hung host can't freeze the brain. **Definitive honest finding**: even with the fully-correct request, push2his stays unreachable from this machine's network (read-timeout) — an application-layer block on EastMoney's quote/kline hosts specific to this host's network, while `market_mood`'s EastMoney datacenter host stays reachable (so sentiment/strength/screen work with real data). Separately, akshare (the PRIMARY source, tried before the direct failover) hangs ~1–2 min against the blocked hosts on its own retries, which is what pushes the full Irisy turn past the debug-endpoint timeout here. The code is correct and returns real klines where push2his responds (a normal CN network — bao's real-network / in-app verify); on this host both sources fail and the tool degrades gracefully with an honest multi-source error, never a fabricated number. Follow-up options if kline must work on THIS machine: flip to direct-first (skip akshare's slow retries) and/or add a Tencent/Sina kline source — both need a host this machine can actually reach, an explicit probe not blind-added. Locks unchanged.
  - v56 2026-07-06: **§7 pack-code — closes v55's flagged reliability follow-up: `ctrl-stock-cn` kline/quote fail over to direct EastMoney (bao 2026-07-06「继续做可靠性硬化, kline/quote 加直连 EastMoney 失败降级」).** v55 shipped the pack + gate wiring but left kline/quote depending on akshare alone, which drops on the flaky free A-share hosts (ConnectionError / RemoteDisconnected). The service (`~/Documents/pkm/projects/stock-cn/service/main.py`, Irisy-authored + dev-hardened per the plan) now, when akshare returns None/empty, hits EastMoney's public `push2` endpoints DIRECTLY (stdlib urllib, browser UA, mirror-host rotation `push2his`/`1.push2his`/`7.push2his` for kline, `push2`/`push2delay` for quote): `push2his` daily kline (CSV, already human-scaled) + `push2` realtime (×100 price scale). Pure parsers (`_parse_em_klines` / `_parse_em_quote` / `_secid`) are unit-tested OFFLINE (`main.py --test-parse`) so the field mapping + ×100 scale stay correct where the live hosts are unreachable. Each result tags `source` (`akshare` | `eastmoney-direct`); a total failure returns an honest multi-source error, NEVER a fabricated number — the anti-fabrication rule holds through degradation. Note: the akshare DataFrame columns are inherently Chinese (`最新价`/`涨跌幅`…, akshare's API), so that file legitimately carries CJK string literals — the all-English-code rule is a CTRL-repo invariant; this is Irisy-authored pack content in the user's vault (committed there, not the CTRL repo). Verified: `--test-parse` passes; the failover PATH runs end-to-end (akshare fail → eastmoney-direct attempted → graceful multi-source error). **Honest gap unchanged**: the direct-hit SUCCESS needs a network where `push2his` is reachable — blocked from the dev sandbox (all A-share quote/kline hosts 000/502 here; only EastMoney's datacenter host that `market_mood` uses responds), so the happy path is bao's real-network / in-app verify. Locks unchanged.
  - v55 2026-07-06: **§7 composition + §mcp-bus — the capped brain can now DISCOVER + CALL an installed feature pack's tools; first mcp-server pack (`ctrl-stock-cn`) proven end-to-end (bao 2026-07-06「继续做 EastMoney 封成 ctrl-stock-cn 的 gate 工具」).** Context: Irisy's A-share 规范 (ADR-005 v19) pointed at data the brain couldn't reach — the gate had only `market_quote`/`market_screen` (Yahoo, price-only), so Irisy improvised fundamentals from memory. The fix is NOT to hardcode A-share tools into the kernel (that's the anti-moat industry default) but to run the Irisy-authored pack: `ctrl-stock-cn` = a local `uv run` fastmcp+akshare service (6 tools: `market_mood` sentiment/cycle-stage, `limit_ladder` strength, `sector_strength`, `screen_strong`, `stock_quote`, `stock_kline`) declared in a `server:{type:local}` manifest — the §7 Pattern-D mcp-server variant. **Two kernel gaps this exposed + closed (`mcp_server.rs::gate_tool_search`)**: the capped brain (hermes) sees only the curated `BRAIN_TOOLSET` (visibility.rs), which by design cannot enumerate dynamic pack tools, so the `gate_tool_search`/`gate_tool_call` escape hatch is the ONLY way in — but (1) gate_tool_search searched only the STATIC tool_router, never the downstream pack servers, so `stock-cn_*` was undiscoverable; now it merges each connected server's tools (namespaced `<id>_<tool>`, mirroring list_tools). (2) It matched ALL query terms (AND), so a verbose brain query ("stock analysis market sentiment A-share") returned nothing when one word missed; now ANY-term match ranked by hit-count (most-relevant first under the limit). **Ledger-verified end-to-end** (audit_calls, caller=hermes): Irisy `skill_read stock-analysis-cn` → `gate_tool_search "market mood sentiment stock cn"` → `gate_tool_call stock-cn_market_mood` + `stock-cn_limit_ladder` → answered with REAL numbers (up 1817/down 3278, fried-board 39%, cycle=ebb, top streak 5) + a decision (观望) with concrete re-entry triggers — no fabricated figures. Install is durable: the manifest lands in `~/.ctrl/mcps/ctrl-stock-cn/` and `mcp_host::reconnect_installed_pack_servers` re-spawns it each boot (verified: tools returned to the gate after a kernel restart). Skill updated to route the brain to the `stock-cn_*` gate tools (via the escape hatch) instead of a terminal EastMoney curl recipe it can't run headless. Locks unchanged (manifest=data/runtime=generic §7.4; brain sees pack tools only via the audited gate). **Honest gap**: some free EastMoney quote/kline hosts (`push2his`/`push2`) are network-flaky from this environment right now (`market_mood`'s host works, `stock_kline`'s dropped with ConnectionError) — the service retries + degrades gracefully (returns an error, never fabricates); reliability hardening (direct-HTTP failover for the kline/quote tools) is a pack-code follow-up, not a wiring defect.
  - v54 2026-07-06: **§provider + §mcp-bus — brain runs on more providers (bao 2026-07-06, Irisy 404'd on Claude + rejected by Doubao).** Two independent provider-compat fixes so the Irisy brain (hermes over ACP) isn't stuck on one vendor. **(1) Claude/Anthropic transport (`agents.rs::write_hermes_config_yaml`)**: CTRL projected the active provider into hermes's `config.yaml` (base_url/api_key/model) but NOT the wire PROTOCOL, so hermes defaulted every `providers.ctrl` to `openai_chat` and POSTed OpenAI-format requests to `api.anthropic.com` → HTTP 404 (Anthropic is native `/v1/messages`). Fix: write `providers.ctrl.transport` from the manifest `shape` (`anthropic_messages` | `openai_chat`) — hermes reads a per-provider `transport`/`api_mode`, so Claude Sonnet now drives Irisy (verified via `/debug/irisy/turn`: real `claude-sonnet-4-6` call, no 404). **(2) Strict-provider tool-schema sanitizer (`mcp_server.rs::list_tools`)**: schemars emits union `type` arrays (`["string","null"]` from `Option<T>`), `$ref`/`$defs`, and `oneOf`/`anyOf` — which Volc Doubao's ark API rejects with HTTP 400 "Invalid function format: 'type'" (OpenAI/Anthropic/Zhipu accept them). Added `sanitize_tool_schema` (flatten union types → first non-null; inline `$ref` against root `$defs`; collapse combinators → permissive `{"type":"object"}`; depth-capped for recursive refs) applied to every tool's `input_schema` before the gate returns them — down-levels to the subset strict providers accept, no-op for lenient ones, keeps the gate provider-agnostic. Verified: gate `tools/list` union/`$ref`/`oneOf` count 37→0; `sanitize_tool_schema` 2 tests. **Honest finding (out of scope here)**: even with a clean gate, Doubao STILL 400s — hermes forwards its OWN built-in tools too, whose schemas CTRL can't reach; so Doubao-on-hermes stays blocked upstream. Claude / Zhipu / OpenAI (which accept the rich schemas anyway) are the working brains. Locks unchanged.
  - v53 2026-07-05: **§7.2 follow-through — one-click AUTO-RUN install of the container runtime (bao 2026-07-05「做一键 auto-run 装 runtime」, completing v52's flagged follow-up).** v52 GUIDED the user (shows commands); this adds the "Install it for me" button that RUNS them, streaming live output, then auto-retries Set up on success. **Trust boundary (the key design)**: reached ONLY via a Tauri command (`install_container_runtime`, desktop PWA = the human), NEVER the brain's `:17873` gate — the brain cannot invoke Tauri commands, so this is human-gated by construction; the executed commands are compile-time platform constants, never LLM/manifest input (no injection surface). **Platform scope — auto-run only where sudo-free + scriptable**: macOS (`brew install colima docker docker-compose` — Homebrew is user-owned, no sudo — + `colima start`, a CLI VM). Linux (`sudo apt`, interactive/privileged) + Windows (GUI Docker Desktop) stay GUIDE-ONLY (`install_commands()` empty there → no button, card still shows copy-pasteable commands). This is why auto-run is offered here though the analogous `ollama_install.rs` deliberately does NOT auto-install its runtime (a macOS .app is a GUI gesture; brew colima is not). **Landed**: `shell/runtime_install.rs` (mirrors `ollama_install.rs`: status slot + in-flight flag + background thread tailing merged stdout/stderr, `LOG_TAIL_MAX`-bounded, streaming per-line via callback) + commands `install_container_runtime`/`runtime_install_status` (emit `runtime-install-progress`) + `pack_provision::container_runtime_guidance` gains `auto_installable` (= macOS && `which brew`) + frontend `lib/runtime-install.ts` (Tauri-guarded invoke/listen) + `RuntimeGuidanceCard` grows the button + live log + auto-retry. Locks unchanged. Verified: `runtime_install` 3 tests (platform-scoped commands, bounded log tail) + cargo `--lib` 439 pass, `parseRuntimeGuidance` 4 tests + vitest 195, tsc clean. Honest gap: the real brew/colima run needs bao's desktop app on a Docker-LESS macOS (this machine has Docker) — the command-selection + streaming plumbing is unit-tested, the live install click-through is not reproducible here.
  - v52 2026-07-05: **§7.2 follow-through — no-docker GUIDED install closes the "needs a container runtime" gap (bao 2026-07-05「做无 docker 引导装」).** v40 left an honest gap: `provision.service` runs `docker compose up` on the user's machine, so a user with no container runtime hit a raw deep error (`no container compose found`). Close it as a GUIDE, not a silent auto-installer — a container runtime is a VM-class dependency (multi-package + a `start`), too heavy to `brew install` without consent (design `feature-pack-provision-auth-engine.md` line 34 「无则走 provision.tools 装 / 引导」, line 77 defers heavy auto-install orchestration to a later step; `tool_installer.rs` is scoped to standalone binaries, not VMs, and `ToolInstallVia`'s single via/pkg can't express `brew install colima docker && colima start`). Implementation: `pack_provision::install_pack` PRE-FLIGHTS `detect_compose()` when the manifest declares `provision.service`; on none it returns structured, platform-specific guidance (macOS → Colima, Linux → docker.io/Podman, Windows → Docker Desktop; steps + copy-pasteable commands + docs link) behind the `NEEDS_CONTAINER_RUNTIME` sentinel instead of attempting compose. Frontend `FeaturePackScene` parses the sentinel and renders a friendly `RuntimeGuidanceCard` (copy buttons + install docs) above both faces, replacing the raw error. Zero new gate tools; reuses the existing provision error channel. Locks unchanged (manifest=data/runtime=generic §7.4; secret-not-in-LLM). Verified: `pack_provision` 6 tests (guidance actionable + sentinel round-trips), tsc clean, ghostfolio manifest vitest 3/3. Honest gap: the actual runtime install runs on the user's machine (we guide it); auto-run one-click (execute the shown command with consent) is a natural follow-up.
  - v51 2026-07-04: **§264 review gate amend — the moat covers hermes; PWA modal shipped (bao 「做最正确的架构」, brainstorming skill).** Two changes to the v35 review gate. **(1) Scope (bao chose B):** the gate was scoped to `!is_first_party(caller)`, which exempted hermes (Irisy's default brain) alongside the pwa — so hermes's high-blast writes ran UNREVIEWED (ledger-proven: `vault_write ok`, zero prompts). hermes is an LLM that can be prompt-injected via notes/web/connector data, so the data-sovereignty moat must cover it. New `visibility::is_user_surface {pwa,irisy}` is the narrower predicate the gate uses (`!is_user_surface`): only the human acting DIRECTLY is exempt; hermes + BYO brains (autonomous) now review high-blast writes. `is_first_party` unchanged (still intent-projection + net-allowlist). **(2) Shipped:** the v35 "behind CTRL_REVIEW_GATE=1, default-off until the PWA approval modal lands" is now DONE — `ReviewGate::enforcing()` defaults ON, the supervisor forwards `review:pending`, and `ReviewGateHost` (mounted `app.tsx`) renders the approve/deny modal → `review_resolve`. **(3) Reconcile:** a duplicate ACP-layer approval (built while not yet aware of the existing ReviewGate — the ACP path never fires anyway since hermes doesn't send `session/request_permission`) was removed; kept the official-`agent-client-protocol` SessionUpdate type migration + the reasoning/tool-call trace (ADR-005 §8.6.1). Locks unchanged; verified: `visibility` 12 tests + `review_gate` 5 tests + `acp_client` 5 tests, tsc clean. Honest gap: full approval-card round-trip = bao's desktop app. Governing: `vault/ctrl/history/plans/irisy-write-review-gate-plan.md`.
  - v50 2026-07-03: **§14 follow-through — Univer spreadsheet themed to CTRL + entry point wired (bao 2026-07-03「配色统一到 CTRL」+「把入口做齐」+「ux呢？」).** Completes v49's S1 from "viewer registered but no way in" to a usable surface. **(1) Theme = B (of A-accept-default / B-theme-to-CTRL / C-headless-custom-chrome)**: Univer ships stock-blue; retint to CTRL's teal accent (`#0D9488`) on BOTH render layers — a CSS-var bridge (`--univer-primary-*` remapped on the viewer host, `univer-ctrl-theme.css`) for the DOM chrome + a JS theme (`@univerjs/themes` defaultTheme with a teal primary ramp passed to `createUniver`) for the CANVAS-drawn accents (cell selection border/fill, column highlight) which CSS vars can't reach. Dark mode remaps the low gray steps to CTRL dark surfaces. Verified via Playwright: ribbon + selection + column highlight all render teal, formulas still compute. **(2) Entry point + UX**: the Tables panel becomes ONE tabular-data workspace holding both paradigms — smart-table (database/Bitable) + spreadsheet (Excel/Univer). `+ New` menu gains "Blank spreadsheet" (one-shot create, no blocking prompt, dedupe slug — mirrors the smart-table template create); a "Spreadsheets" section lists `tables/*.sheet.md`; picking one routes by extension to the lazy `UniverSheetViewer` (smart-tables stay on `SmartTableViewer`). `createSheet`/`listSheets` mirror `createSmartTable`/`listSmartTables`; a `.sheet.md` carries no `schema:` block so `listSmartTables` skips it and the two lists never overlap; `onActiveTable` already feeds the open path to Irisy as ambient context, so Irisy sees a sheet the same as a table. Locks unchanged (no new primitive; smart-table remains the spine; Univer community-only + Apache theme pkg, no Pro). Verified: tsc clean, tests 191/191, production build bundles the Univer chunk + PWA green. Remaining honest gap: the in-app click-through (New→create→open, kernel writes vault) needs the Tauri app — Univer render + theme are Playwright-verified, entry wiring is tsc+build-verified.
  - v49 2026-07-03: **§14 amendment — "self-built spine + Univer fills the formula/spreadsheet gap" (bao 2026-07-03「自研为骨 + Univer 补公式」, after a four-way compare pxcharts/Univer/Teable/self-built in `vault/ctrl/plans/tables/plan-univer-formula-augment.md`).** Decision: do NOT swap the smart-table substrate. The self-built smart-table stays the spine (vault-is-truth markdown + `:17873` gate + 8 views + reference/lookup/rollup/formula) because the alternatives each break a lock: Teable (21.4k⭐, strongest) is a full app (Postgres+NestJS) → data leaves the vault → severs `vault_index` FTS5 + Irisy's unified RAG + note↔table backlink = data island; pxcharts (180⭐) is a weaker Next.js app, GPL+commercial-auth; Univer (13.4k⭐, Apache-2.0) is the only EMBEDDABLE + same-stack (React18+Vite+Canvas) option but is an Excel-style SHEET, not a multi-dimensional database — so it augments, never replaces. Two integration roles: **(S1) a standalone Univer spreadsheet viewer** — a `<name>.sheet.md` file (Univer snapshot JSON in the markdown body, round-trips through `vault_write`, vim-test passes) registers as content-type `application/vnd.ctrl.univer-sheet`, lazy-loaded, giving the Excel-style free grid + 400+ functions where heavy formula work belongs; **(S2) smart-table's per-row formula COLUMN stays on the self-built synchronous evaluator, expanded** (~30→~60 functions: math/logical IFS/SWITCH/XOR, text MID/FIND/SUBSTITUTE/PROPER, date YEAR/MONTH/DATEDIF). **KEY SPIKE FINDING (S0, ran headless in node)**: Univer's `@univerjs/engine-formula` loads DOM-free (embeds fine) BUT is NOT usable as a standalone `eval(expr,vars)` library — it needs a full workbook + sheets-plugin + async calc pipeline. So retrofitting it into the grid's synchronous per-cell render path would be a heavy async anti-pattern; range/table functions (SUMIF/VLOOKUP) are the rollup/lookup FIELD types' job anyway. Univer thus fills the gap at the spreadsheet SURFACE, not inside the table cell. Locks unchanged (no new primitive; markdown truth; gate; smart-table is the existing viewer; Univer community-only, no Pro dep). Verified: S0 headless PoC; smart-table-formula tests 10/10; tsc clean.
  - v48 2026-07-03: **§7.5 amendment — the product-grade UI is the pack's SMART-TABLE WORKSPACE (bao 2026-07-03「智能表格应该能跟飞书一样做操作页面」+「用户可以创建功能包,可以上传分享,应该有真实的产品」).** §7.5 property ① named `ui_surface` (on-demand UI) but it was never made concrete — a tools-only pack opened to a blank scene, so a pack was a tool bag, not a real product (unlike an Atoms/Lovable *project*, which is a usable app). Concretize it: **the pack's work surface = smart-tables composed into an operating UI** — CTRL's smart-table already IS the general product-UI builder (8 views grid/kanban/calendar/chart/gallery/form/summary/timeline + full Bitable field types incl. relation/lookup/rollup/formula, ADR §14 v30). A pack declares `workspace` (the smart-tables that ARE its UI; v1 = a `table_prefix` convention `tables/<pack>-*` so Irisy's created tables auto-join, zero maintenance, add-a-table-zero-code); `FeaturePackScene` renders that workspace (tabs per table, each with its multi-view) instead of a blank/intro-only scene. This completes the product loop create(Irisy)→WORK(smart-table UI)→share(publish) — the pack becomes a real product with an operating界面, not just a tool set. Frontend stays ZERO-bespoke (smart-table is the generic builder; no per-pack UI code — a pack that thinks it needs a custom component means the design is wrong). Locks unchanged (manifest=data/runtime=generic §7.4; smart-table is the existing viewer; no new primitive). NOT copying Atoms/Lovable's cloud-hosted-app substance — CTRL packs stay local + integrate-not-rebuild + MIT-commons.
  - v47 2026-07-02: **§1.9 amendment — notes FRONTEND = vendored Tolaria UI; CTRL kernel stays the ONLY backend (bao「前端就用 tolaria」, superseding the v46 build-the-frontend-natively plan for G2/G3/G4/G6/G7 while keeping ALL v46 endpoint work).** Feasibility (deep-read of the cloned repo): Tolaria's 378-component React/TS frontend couples to its backend through only ~49 Tauri commands — ~15 map onto CTRL's existing vault surface, ~10 are its AI/CLI layer (TRIMMED, replaced by Irisy), ~10 app-shell (partial), ~5 gaps CTRL planned anyway (E11 link-aware rename). Decision: vendor the frontend subtree as `packages/ctrl-notes-ui` (AGPL→AGPL, scoped exception ADR-006 §5.1.1 v11) + write an adapter mapping its command surface onto the `:17873` gate + Tauri commands — so its mature editor armor (BlockNote + IME/paste/render-recovery), types-as-lenses, views, git UI, tldraw whiteboard, multi-vault UI arrive whole, while audit/visibility/review/§14 stay CTRL's (sovereignty in the backend). Its Rust backend + CLI-integration layer (claude_cli/codex_cli/hermes_cli/pi_cli…, the parallel brain layer that conflicts with gate/projection) is NOT taken. Editor-stack consequence: the notes module runs BlockNote; the Tiptap lock narrows to the other viewers (ADR-003 pairing). Bundle: notes UI lazy-loads (critical-path shell keeps its budget). Kernel work UNCHANGED and load-bearing: S1 retirement, E1-E13 endpoints, S4 vault_git attribution layer are exactly what the adapter feeds. Fork slices: F1 vendor+license, F2 adapter, F3 mount as the notes workspace, F4 trim+trademark strip+visual QA, F5 cherry-pick playbook.
  - v46 2026-07-02: **§1.9 amendment — Notes goes FULL NATIVE REPLACEMENT; Obsidian connector RETIRED (bao 2026-07-02「替代现在的 note，保持所有功能都有」+「obsidian 应该不要了，参考 obsidian 的端点建立 ctrl 所有 note 相关的端点」).** Supersedes the v24-v28 Obsidian posture in three parts: (1) **§1.9 scope decision reversed** — v26's "stop ADDING PKM parity / Obsidian = preferred editor + escape hatch" is out; CTRL's NotesApp becomes the COMPLETE PKM surface (Tolaria-parity feature set: git layer w/ AI attribution, types-as-lenses + saved-§14-query views, editor completions TOC/math/callouts/collapse, tldraw whiteboard, multi-vault registry — governing plan `vault/ctrl/plans/notes/notes-module-replacement-plan.md`, deep-read of cloned `~/Documents/coding/tolaria-reference`). (2) **§1.9.1 connector RETIRED entirely** — `commands/obsidian.rs` (status/connect/provision/launch + silent app install) deleted, boot auto-provision + bus auto-connect removed from kernel_supervisor; the generic streamable-HTTP MCP client transport in `mcp_host.rs` STAYS (generic infra that outlived its first consumer). Obsidian demotes to "format-compatible neighbor, zero wiring" — the vault stays plain markdown any Obsidian install can open (compat promise unchanged), but CTRL installs nothing, provisions nothing, connects nothing. (3) **Native note endpoints replace what the connector provided** — Obsidian Local REST API surface (16 paths/34 ops, deep-researched 2026-07-02) becomes the REFERENCE CHECKLIST for CTRL-native gate endpoints in CTRL idiom (E1-E13 in the plan: periodic notes, active note, open-in-UI, fm surgical patch via ProduceOp, note_map/note_get, link-aware rename, recent-changes, search-with-context; JsonLogic/DQL free-form query NOT built — §14 typed filters cover it, anti-hallucination). "Ctrl-key is the only entry" is STRENGTHENED (the Obsidian escape hatch is gone). Locks unchanged: plain-text truth / vim test / gate + review / 5 primitives.
  - v45 2026-07-02: **§14.13 NEW — unified write side: `RecordSink` trait + one typed `produce` verb (bao「你架构弄清楚了吗？是在建立整套系统吗？…好，做」).** Reset from endpoint-accretion to system-building. Read side was systematic (one QuerySource trait + shared run_query); write side had fragmented into ~10 bespoke smart_table_* tools + a separate connector source_produce. §14.13 mirrors QuerySource on the write side: `ProduceOp` (compile-time-fixed typed union — SetCell/UpsertRows/DeleteRows/Add|Update|DeleteField/CreateSource/AddView/DropView; anti-hallucination per §14.1; Write half only, Effect stays on Effect primitive) + `RecordSink` trait (supported_ops advertised via describe + produce(op)); gate exposes exactly 3 §14 verbs (describe/query/produce) over any source (native by path, connector by id). Adding a data product (Sheets/Docs/Calendar/Task) = implement QuerySource+RecordSink over plain-text + register = ZERO new gate tools; whole suite becomes one §14 system (governing: unified-productivity-suite-architecture.md). Migration: land ProduceOp+RecordSink+SmartTable impl, keep bespoke smart_table_* during transition (PWA calls them), converge+retire like ghostfolio→source_*. Locks unchanged (5 primitives; RecordSink under Capability; query read-only; produce through review gate; secret-not-LLM; markdown truth) — REINFORCES three-verb contract (produce finally one verb, not N).
  - v44 2026-07-01: **§1B.8 NEW — per-pack scoped projection: a feature pack is a project-scope (bao 2026-07-01「全量修复」P3; realizes §7.5 feature-pack = CTRL's answer to "project").** The base projection (§1B.1) grants the global default intent over one root; §1B.8 makes each pack its own projection scope. `projector::project_pack(pack_id, name, kb, intent, port, token)` materializes a pack-scoped `.mcp.json` (stamps the pack's OWN intent domain — a §14 data pack → `source`, NOT the global default, so a pack grants exactly its domain without widening the base workspace) + a pack-context `AGENTS.md` (name + KB + "scoped to this pack") into `~/Documents/CTRL/<pack_id>/`. Reuses the base machinery via two small refactors (extracted `project_gate_into_dir(dir,port,token,intent)` — `project_into_dir` now a thin wrapper; extracted `project_agents_block(dir,block)` — `project_agents_md` passes `ctrl_agents_block()`), same atomic-write + marker-preserve + idempotent guarantees. Trigger v1: `project_installed_packs` at boot auto-projects a scope for every installed `record_source` pack (action-only packs' scope deferred). NOT a new primitive — uses the ADR-010 intent/visibility machinery as the scope namespace (conceptually the Channel primitive as a per-pack scope), 5 primitives unchanged; does NOT pull in the §1B.6 mesh network (still v1.1) — single-user local per-pack scoping only. Verified: cargo test --lib projector 21/21 (4 new: per-pack gate carries the pack's OWN intent not the global default; pack_agents_block names pack+KB+scope; omits KB line when absent; per-pack AGENTS.md preserves user prose) + all existing green (refactor non-breaking).
  - v43 2026-07-01: **§7.6 NEW — the share-and-be-shared PRODUCER side (pack publish) is v1 (bao 2026-07-01「分享中心是功能包定义属性 + 拉进 v1(含 registry 发布)」).** Discover already CONSUMES registries (§7.3/§7.4 pull); v1 was missing the PRODUCE half — a user could hand-copy a pack's JSON but not publish it to a commons. §7.6 makes create→publish→discover one v1 loop. **Scope-precise**: this is the pack-MARKETPLACE producer (a manifest published to a registry), NOT the §1B.6 mesh-projection network (peer assets projected into a CLI) — §1B.6 stays v1.1 (mesh substrate dependency); publishing a `ctrl-*` manifest is a plain HTTPS producer with no mesh dep, so only that half moves. **Mechanism**: gate tool `mcp_pack_publish(pack_id, registry?)` — read installed manifest → EVALS FIRST (`pack_validate::validate_manifest`, never publish a broken pack) → package (v1 = v2 manifest JSON; `.mcpb` reserved) → POST to the registry endpoint (URL+token from credential store `ctrl:registry:publish_url`/`:publish_token`, never the LLM) → return the published ref. Kernel-internal HTTPS; the REAL public registry (official MCP Registry mcp-publisher namespace ownership / ctrl-market Worker) is the honest external gap, CTRL-side producer verified by mock-HTTP (same posture as ctrl-ghostfolio's live instance). Frontend: a Share/Publish action → mcp_pack_publish → shows the ref; JSON copy-paste stays the zero-infra fallback. Locks: `ctrl-*` MIT commons (ADR-006 §5.1); no self-invented registry protocol (official mcp-publisher + namespace proof); publish gated on evals. NOT pulling the mesh network (§1B.6) into v1; NOT inventing a bundle format (`.mcpb`).
  - v42 2026-07-01: **§14.12 NEW — generic manifest-driven §14 connector source = zero-code product-grade uplift (bao 2026-07-01「全量修复」, serves §7.5 product-grade + §7.4 manifest=data).** Closes the gap §14.6 promised but connectors broke: a REST connector hand-codes schema + JSON→Row map + fetch + per-source gate tools (`ghostfolio_source.rs` fields/holding_to_row/fetch + `ghostfolio_describe/query/add_transaction`) → adding one = Rust code, violating §7.4/§7.5. **New manifest axis `record_source`** (query{endpoint,method,array_at} + fields[]{key,label,type,from:[json-path]} + optional produce{endpoint,method,body-map}; auth reuses v40 `auth.token_exchange`) + **new kernel `manifest_source.rs`** (`RecordSourceSpec` + `ManifestConnectorSource: QuerySource` via generic `from_json(spec,body)` + generic `fetch`/`produce`, shared `run_query` unchanged) + **new generic gate tools** `source_describe/query/produce(source_id,…)` dispatching by source_id to the installed manifest (per-source `ghostfolio_*` retire). ghostfolio = first data-driven instance (fields/holdings-endpoint/array_at/order-produce move into its manifest.json; hand-coded source retires to generic path, golden rows = equivalence test). Locks unchanged (Capability primitive not a new one; query read-only; produce through review gate; secret kernel-side; tolerant reader). v1 scope: kind=record, one array endpoint/source. NOT reinventing query/auth engines (reused) — only the missing data-declaration + generic-dispatch layer. Implementation via dev-loop, slice 1 = manifest_source.rs + equivalence/mock-HTTP tests.
  - v41 2026-07-01: **§7.5 NEW — 功能包 = 产品级单位 = CTRL 对标「project」(bao 2026-07-01「我们的功能包,类比 project 的话,我希望我们的功能包都是产品级别的;也是用户创造中心,分享中心」).** Studied Atoms(MetaGPT, cloned `~/Documents/coding/metagpt-reference/`) + Lovable — both organize by **project** as the top-level unit (MetaGPT `Team.generate_repo(idea)→repo` over an Environment+Role pub/sub kernel that independently mirrors CTRL's locked 5 primitives = spine validation; Lovable Workspace-Knowledge[global]+Project-Knowledge[per-app] = `CLAUDE.md`+`AGENTS.md` isomorph). CTRL's answer = **the feature pack** as the product-grade unit, substance INVERTED vs their builder model (integrate-not-rebuild / MIT-commons-not-hosting / local-not-cloud). **Three locked properties defining a feature pack**: ① product-grade (a whole product, NOT a raw wrapper — hard bar = §14 describe/query/produce uplift + one-shot high-signal atoms, per-pack KB, on-demand UI, per-call gate; "产品级" = user-language for the v39 anti-raw-wrap moat) ② creation center (Irisy `mcp-creator` NL→manifest, §7.4 source 3) ③ sharing center (Discover registry-pull + publish `ctrl-*` MIT commons, §7.3 share-and-be-shared). **读法 A (bao)**: "功能包" means the product-grade unit ONLY = capability-pack-map ①native-modules + ③connectors (Ghostfolio/CRM/PKM/stock/ERP, each a whole product); the ② atomic built-in tools (Clipboard/OCR/Translate Top15) are **ingredients/primitives, NOT feature packs** (nobody "shares a Translate atom") — they stay mcp manifests but off the Discover product shelf. IA collapse: **feature pack = product (create+share unit), tool = ingredient**. Locks unchanged (manifest=data/runtime=generic §7.4, 5 primitives, 3 verbs, :17873 gate, secret-not-LLM, plain-text) — this raises the acceptance BAR + collapses IA, adds no runtime branch. ctrl-ghostfolio seed now accepted only if all three hold (product-grade §14 uplift + Irisy-creatable + MIT-commons-shareable). Syncs `vault/ctrl/plans/feature-packs/capability-pack-map.md` (①③=packs, ②=tools). NOT copying builder's "project as sole top unit" (CTRL stays ambient/capability-centric at the Ctrl→intent layer); NOT touching the 5 primitives.
  - v40 2026-07-01: **§7.2 — generic「一键装 + 静默认证」provision+auth engine (bao 2026-07-01「一键安装不要多余步骤 / 安全静默实现 / 没有好的通用化的方案吗 / 就按这个方向做 / 一次性完成」).** Generalizes the ghostfolio manual config-wizard into a DECLARATIVE, zero-per-pack-code engine (manifest = data, runtime = generic, per §7.4): a self-hosted connector installs one-click and authenticates silently from its manifest, no manual URL/token entry. **New manifest axes** (`manifest-schema.ts`): `provision.service` (declare a container/compose stack + `generated_secrets` + `ports` + `ready`-poll = the one-click-install half) + `auth` (composable `oauth` / `bootstrap` / `token_exchange` / `manual` = the silent-auth half). **New kernel runtime**: `pack_auth.rs` (generic `run_bootstrap` = one-time mint+capture by JSON-pointer; `mint_bearer` = per-call secret→bearer exchange; ghostfolio's authenticate now delegates here) + `pack_provision.rs` (`generate_secret` via uuidv4×2; idempotent `ensure_generated_secrets` → credential store; `render_env`/compose write; `docker`/`podman compose up` + `poll_ready`; `install_pack` orchestration = provision.service → bootstrap) + gate tool `mcp_pack_provision` (read installed manifest → `install_pack`). Generated + bootstrapped secrets land in the credential store (`mcp:<id>:*`, incl. the resolved `_base_url`), never the LLM (decision 0004). **ctrl-ghostfolio is now pure data** (v0.2.0 manifest): declares its app+PG+Redis compose (generated JWT/salt/DB/redis secrets) + `auth.bootstrap` (POST /api/v1/user → capture accessToken) + `auth.token_exchange` (auth/anonymous → JWT); `resolve_ghostfolio_creds` reads the provision-set `_base_url` + bootstrapped token. Frontend: `FeaturePackScene` shows one-click **Set up** (calls `mcp_pack_provision`) when the pack declares provision/auth, the manual **Configure** wizard (`PackConfigModal`) only as the last-resort fallback (`manual`/config_schema-only). **Differentiation (research `ai-native-feature-pack-research.md`)**: Smithery et al. are HOSTED gateways managing auth/session in the cloud; CTRL is local-first declarative self-run (service + data + creds on the user's machine, CTRL is only the engine) — the discovery→provision→silent-auth→§14 uplift→gate chain no single platform unifies. **Verified**: pack_auth + pack_provision pure/HTTP-mock unit tests (bootstrap capture, bearer exchange, secret gen, env render, port template) + manifest Zod vitest asserts full declarativeness. **Honest gap**: the real `docker compose up` + ready-poll runs on the user's machine (needs a container runtime + first-run image pull); CTRL-side render/orchestration/auth verified by unit+mock e2e. NOT hand-coding the long tail; NOT reinventing compose/manifest formats. **Scope of "zero-per-pack-code" (independent-checker precision, PASS)**: the INSTALL + BOOTSTRAP halves are fully generic/data-driven (`provision.service` + `auth.bootstrap` run purely from manifest data) and the auth PRIMITIVES (`run_bootstrap` / `mint_bearer`) are connector-agnostic + reused. What is NOT yet generic: the §14 DATA layer per connector — the gate tools (`ghostfolio_describe/query/add_transaction`) and the per-call `token_exchange` INVOCATION are ghostfolio-specific (ghostfolio = the reference §14 source; `ghostfolio_source::authenticate` calls the generic `mint_bearer` with ghostfolio's params, which mirror — but don't yet READ — its manifest `auth.token_exchange`, a small dual-source). A NEW self-hosted connector today still needs its own §14 source + gate tools; making that data-driven = a future **generic manifest-driven §14 connector source** (reads source shape + endpoints + `auth.token_exchange` from the manifest), the next layer beyond this provision+auth engine. Also v1: `provision.service` supports `compose_inline` only (`compose_ref` reserved). Recorded so the generality claim is precise, not overstated.
  - v39 2026-07-01: **§7 + §14 — first feature-pack seed `ctrl-ghostfolio` = make a self-hosted open-source app AI-native through the gate (bao 2026-07-01「功能包 = 把开源软件/MCP 编程成 AI-native」+「从 ctrl-ghostfolio 端到端跑通」).** Deep research (`vault/ctrl/research/ai-native-feature-pack-research.md`, 25/25 verified) established the reusable-bricks-not-reinvent posture — Agent Skills (SKILL.md) packaging · Anthropic `mcp-builder` four-phase pipeline (incl. evals) · AutoMCP OpenAPI→MCP (bottleneck = spec quality, invest in spec-repair not codegen) · official MCP Registry + Smithery (6.6k) distribution · OpenAI Apps SDK generative UI (structuredContent/content/_meta) · community Ghostfolio/Twenty MCP servers · AWS MCP Gateway == this ADR's `:17873` gate shape (validates gate as industry-standard). **The differentiation/moat (Anthropic "writing tools for agents": raw one-tool-per-endpoint wrapping is NOT agent-native)** = the **§14 AI-native uplift** (lift the app into the uniform describe/query/produce contract) + **per-call gate governance** (audit + intent-visibility, finer than the community MCP's coarse `READ_ONLY_MODE` env toggle) + the end-to-end pipeline (discovery→scaffold→govern→distribute→UI) no single platform unifies. **Landed (kernel):** `ghostfolio_source.rs` = Ghostfolio holdings as a §14 RecordSource (tolerant JSON reader; kernel-internal reqwest to `/api/v1/portfolio/holdings`, bypassing the caller-facing `guard_egress` since a self-hosted connector legitimately targets loopback/LAN + the URL is kernel/user-sourced not LLM-controlled); gate tools `ghostfolio_describe` / `ghostfolio_query` (read, shared `run_query`) + `ghostfolio_add_transaction` (§14 produce = POST /api/v1/order, high-signal "record a trade"); `ghostfolio_`→`ghostfolio` visibility domain + first-party set (NOT in the hermes BRAIN cap — connectors surface via intent-scoped projection, not the hardcoded core); creds (`mcp:ctrl-ghostfolio:ghostfolio_url`/`_token`) resolved kernel-side (`resolve_ghostfolio_creds`, env-override for tests) — token never reaches the LLM (§7.2 / decision 0004). **Seed manifest** `packages/ctrl-mcps/builtin/ctrl-ghostfolio/manifest.json` (config_schema loop-closer, Zod-validated by a ctrl-web vitest). **Verified:** mock-axum HTTP e2e (fetch→§14 query; add_transaction order body) + over-the-wire gate e2e (`ghostfolio_*` reachable through `:17873` + intent-scoped, http_post hidden). **Honest gaps:** live connection to a real Ghostfolio = the user's machine (self-hosted instance + token); frontend config-schema wizard (collect URL+token → keychain) + `FeaturePackScene` binding still to build; review-gate on produce is behind `CTRL_REVIEW_GATE` (v35, default-off until the PWA modal lands). This is the reference the Irisy mcp-creator flow (capability-pack-map ③) generates variations of — the seed proves the substrate + creation-flow, per the "dev hardens the flow, seed = live test" rule. NOT hand-coding the long tail; NOT reinventing manifest/registry/skills formats.
  - v38 2026-06-28: **§brain — generalize Irisy's brain from hermes-only → a CTRL-driven, SELECTABLE ACP engine (pairs ADR-005 §8.7).** bao design pass 2026-06-28 (「Irisy 不是可以选择是 Hermes 或者 Codex 么」). Refines v28 (Irisy brain = Hermes Agent): the **right region** (Irisy assistant) runs on a **selectable engine — Hermes / Codex / Claude Code** — and CTRL **DRIVES** it over **ACP** (JSON-RPC over stdio, the same `shell/acp_client.rs` already drives `hermes-acp`). Engines = ACP adapters: `hermes-acp` (bundled default, uvx) · `@zed-industries/codex-acp` (npx, wraps user's Codex) · `claude-code-acp` (npx, Anthropic SDK adapter). The engine choice is ONE spawn-command parameter; gate tools (`:17873` mcpServers), Irisy persona, loop+context ownership are identical downstream. **hermes stays the bundled default and does NOT retire.** Crucial distinction vs § projection: the **right-region engine is CTRL-DRIVEN** (ACP), while the **left-region (workspace) coding agent is USER-DRIVEN + projected, not supervised** — same product (e.g. Codex) can play both roles independently. This promotes §agent-channel (v27 "ACP = future enhancement channel") to the **concrete mechanism for the right-region Irisy engine** (projection remains the left-region / BYO-CLI-driver mechanism). Full model + acceptance: ADR-005 §8.7. Pairs ADR-001 spine §byo-cli-driver. NOT a return to "CTRL supervises a general brain" — CTRL drives the Irisy ENGINE per chat session (as it already does hermes-acp); it still does not supervise the user's left-region terminal CLI.
  - v37 2026-06-27: **§1 Irisy web search = free-by-default, BYOK upgrade (Pattern D 同构; bao 「默认 ddgs，有 Tavily key 才升 tavily」).** Irisy's live brain is the hermes one-shot (`hermes -z`), which runs hermes's OWN built-in `web_search`; the backend is chosen by `web.backend` in `~/.hermes/config.yaml`. Found via source read (hermes 0.16.0 `tools/web_tools.py`): hermes ships 5 backends — `exa`/`tavily`/`searxng`/`brave-free`/`ddgs` — and **`ddgs` (DuckDuckGo) is the only one gated on package-presence, not an env key** (`_ddgs_package_importable`), i.e. free, no signup, search-only. So CTRL tiers it like LLM Pattern D: **default = `ddgs` (free)**, **`tavily` only when the user supplied a key** (full web + extract). Wired: `write_hermes_web_belt` now pins `web.{backend,search_backend}` = `ddgs`|`tavily` + `extract_backend` = `tavily`|`""` (ddgs has no extract); `run_hermes_oneshot` launches `uvx --from hermes-agent==<pin> --with ddgs …` so the free backend is importable inside the isolated uvx env (ddgs is NOT a hermes dep / lazy-install target). Corrects v36's claim that Irisy web goes through the CTRL-native `web_search` gate tool — in the one-shot path it does NOT reach that tool; the CTRL-native Tavily/Wikipedia `web_search` (`mcp_server.rs`) is a separate gate surface. Real-machine verified end-to-end: keyless `ddgs` returned live results (current Node.js LTS + source URL) where the no-backend path had hallucinated a stale value. NO bundled key, NO CTRL-hosted cost, NO self-built search — pure backend selection over hermes-native capability. Does NOT touch pack creation.
  - v36 2026-06-27: **§2 network = allowlist-bound, now ENFORCED for external callers (closes the v35 "per-pack URL allowlist deferred").** `http_get`/`http_post` (the prime exfil surface) now fail-closed at the gate: a NON-first-party caller (BYO-CLI brain / pack) may only reach hosts its resolved capability declared (`capability_resolver::network_authorizes` host-glob match over HttpGet/HttpPost tokens), on top of the caller-agnostic `guard_egress` SSRF floor. **First-party app surfaces (pwa/irisy/hermes) are deliberately NOT bound** — Irisy's web search + data fetch go through the scoped `web_search` (domain `websearch`, first-party, Tavily/Wikipedia backends), never the raw net tools, so Irisy's network capability is untouched (bao 2026-06-27 "Irisy 需要网络搜索 获取数据能力"). Also wired the file dimension on the gate's exec path: `run_action_blocking` derives the OS sandbox write scope from the pack's declared `file.write_allowlist` (ADR-004 §1 acceptance). Remaining honest limit: downstream-MCP-server packs that do their OWN fetch are opaque to the kernel — CapToken can't bind them (process boundary governs); a pack that wants its network governed must route through the gate. Does NOT touch pack creation.
  - v35 2026-06-26: **Pack-execution security hardening (red-team C1–C5, bao 「对齐的话全量修复」). 2 drift-closes IMPLEMENTED + 2 new-direction amendments PROPOSED (pending bao).** Context: the gate裁剪 (§ visibility, ADR-010) is at *tool* granularity, but a feature pack's executable body (shell step / pack code) lives *below* tool granularity — the gate neither sees nor controls it. Closing that needed execution-layer isolation, not more governance. **IMPLEMENTED (drift-close, no direction change):** ① **§2 network = allowlist-bound floor** — the ADR said `network http (allowlist-bound)` but kernel `http_get`/`http_post` enforced nothing; added `mcp_server.rs::guard_egress` (deny loopback / 169.254 metadata / RFC1918 / `localhost`·`.local`·`.internal`, per-IP + per-redirect-hop) as the caller-agnostic egress deny-floor. (Per-pack URL allowlist binding still deferred — see KNOWN GAP.) Pairs ADR-004 §1 v3 OS sandbox (which network-denies the pack shell entirely). ② **§264 review gate** — "write/delete/command = high blast-radius → ADR-006 §4 ladder, never silent" was unimplemented; added `kernel/review_gate.rs` (human approval, gate-side arg summary = C3 anti-injection, approval via Tauri command surface the external brain can't reach = no caller self-approval) + `call_tool` wiring + `commands/review.rs`. Behind `CTRL_REVIEW_GATE=1` (default-off) until the PWA approval modal lands; mechanism + trust boundary tested. **PROPOSED (new direction, NOT yet built — needs bao):** ③ **C2 secret-broker** — §7.2:679 specifies `{{secret}}`→pack-process env injection; the OS sandbox now denies the pack network so it can't *exfiltrate* an env secret, but a hardened path = kernel holds the secret + proxies the authenticated outbound call, pack never sees plaintext. This CHANGES §7.2 (env injection is the current design), so it is a proposed amendment, not a drift-close. ④ **C5 mcp-bus uds + SO_PEERCRED** — § mcp-bus is loopback TCP + bearer token (per-boot ephemeral); a stolen token = full impersonation (no process binding). Proposed: Unix-domain-socket + peer-credential check so the gate binds the *connecting process*, not just a bearer. Lower priority (token already per-boot ephemeral + within the declared "本机账户可信" residual-risk假设). **KNOWN GAP** (surfaced, not faked): manifest `capabilities` is an object but `capability_resolver::resolve_installed` expects a CapToken array → installed packs resolve to `Capability::empty()` (fail-closed but the declared capability surface is inert); per-pack network allowlist + per-pack sandbox-profile derivation both block on wiring this adapter. Residual risk explicitly OUT of scope: a local account already fully compromised (industry-standard trust floor for all local-first software). Supply-chain pack signing (C1) tracked under ADR-004 §6 (trust-model research in flight).
  - v34 2026-06-25: **§7.4 NEW — 功能包系统化方向锁死 (bao 2026-06-25「加功能包不能改代码,要系统化」+「长期」+「网上找方案」).** manifest = 数据,runtime = 通用引擎,**加一个 pack 零代码**。三个零代码数据源: ① 本地装 `~/.ctrl/mcps` (已数据驱动,`loadInstalledPacks` 读任意 manifest) ② Discover commons = registry 客户端 (拉 MCP Registry `.well-known/mcp.json` + Smithery 2000+;`OFFICIAL_PACKS` 硬编码数组退成临时 stand-in,接 registry 后退役) ③ Irisy 生成 (mcp-creator persona + **复用 Anthropic `mcp-server-dev` 开放 Agent Skills** build-mcp-server/app/mcpb,不重造: discovery→scaffold→MCP-Inspector 校验→gate 装)。通用 runtime 落点已就位: `FeaturePackScene` 读 `actions[]` 渲染 / gate `mcp_pack_run` 执行 (secret 不回 brain) / 通用 `knowledge_base` 字段绑专属 KB (`inKbScope` 裁剪,stocks=助理+`Stocks/`+ghostfolio,非新角色) / gate `mcp_pack_install` = brain 自装回流落点。对齐 ADR-001 § projection (projector 投影开放 skills)、ADR-006 §5 commons、ADR-003 §8.6 + ADR-005 v6 (角色=persona 层,pack+KB 正交,不焊死)。NOT 自造 manifest/bundle 格式;NOT 为每 pack 写分支;NOT 人工维护长尾列表。
  - v33 2026-06-22: **§14 深化 — 批判性自审后补 §14.8-§14.11 (事实源 `vault/ctrl/history/communication/comms-architecture-permanent.md` §10).** 补四项: (1) **§14.8 query 结果随 source_kind 多态** —— 动词仍三个,返回类型随 describe().source_kind 分化 (Records/Text/Blob),修 v29「QueryResult 是 record-shaped {rows}」的类型坍缩,让 pdf/图片 (Blob) + 长文 (Text) 不用 hack 进 record。(2) **§14.9 produce 分 Write vs Effect** —— effectful 长耗时动作返回 OperationHandle{operation_id, idempotency_key},坐到 ADR-001 第五 primitive **Effect** 上;进度复用 §14.7 query{watch}、取消复用 produce、幂等键防重放,run_ai_column 手搓 job 收编成标准 Effect (模型: Google AIP-151 LRO / Temporal / gRPC operations)。(3) **§14.10 协议版本协商** —— describe 自报 protocol_version (SemVer),gate 按版本路由/降级,protobuf 式只增不改,破坏性变更走 major + N/N-1 迁移窗口 (CORBA/SOAP 死于版本脆性)。(4) **§14.11 AI-facing 错误契约** —— 结构化 Feedback{kind, retriable, correction, human},QueryError::UnknownField 收编为特例,闭合 Irisy 自纠回路 (RFC 7807 / gRPC rich error)。NOT 改动词集 (仍三);NOT 改 spine 5 primitive (反而启用 Effect)。配套总纲 D/E/G/H 进 ADR-010 v4。
  - v32 2026-06-22: **§14.7 subscribe — streaming read = query{watch} 投影 (NOT 第四动词).** (此条补记: §14.7 正文在 commit aa990ab 已写入 + frontmatter 已 bump 32,但当时漏记 changelog 行,现补。) Irisy/PWA 订阅 query 结果集,源变 → gate 推增量 (ST-SS Cell/Op);subscribe 不是新动词,是 `query{watch:true}` 传输投影,无流语义的源 (registry/providers) 天然不实现 (ISP);授权+审计经 :17873,字节走 :17872。事实源 `vault/ctrl/history/communication/comms-architecture-permanent.md`。
  - v31 (provenance, no content change): frontmatter version 在 commit 78a3577 从 30 bump 到 31,但未改动 §14 任何内容、亦无 changelog 行 (无意的版本号 bump)。此条仅为补全版本号连续性,无实质决策。
  - v30 2026-06-20: **§14 amendment — smart-table 对标飞书 Bitable:数据层路线 C(SQLite 派生索引,markdown 仍 truth)+ 网格层 glide-data-grid(bao 拍板).** 调研(`vault/ctrl/research/feishu-bitable-parity-assessment.md`,飞书 27 ui_type / 6 视图 / 关系型 + Teable·undb 源码 + glide-data-grid 能力)铁证:飞书 Bitable 灵魂=关系型(关联/Lookup/Rollup/跨表公式),**纯 markdown 做不到**(O(n²) 文件 I/O、无事务双向同步、无外键悬空、数万行不可用)。bao 选**路线 C**:markdown 存 schema/数据/关联(仍是 truth,vim 可读,守 plain-text 哲学),**SQLite 作派生索引**(从 markdown 重建,类比现有 `vault_index.rs` FTS5 + `embeddings` SQLite),关系型/Lookup/Rollup/大规模 `query` 走索引算,写回 markdown。**§14 query 引擎获得 SQLite 索引后端**(RecordSource 可选 index-backed),markdown round-trip 不变。网格层::17873 gate/数据契约不变,PWA 用 **glide-data-grid(MIT, canvas, 百万行, 键盘/复制粘贴/填充/列宽/冻结)** 重做 grid 视图,`getCellContent` 回调直连数据源(契合"本地是 truth")。开源:glide-data-grid 直接用(MIT 可商用),Teable/undb(AGPL)只参考关系型/Lookup/公式/Visitor 设计不搬码。关系型字段(关联/Lookup/Rollup/公式)落地待后续切片;本次先 glide 网格(不碰数据层)。NOT 改 spine 5 primitive。
  - v29 2026-06-19: **NEW §14 Unified Operation Interface — describe / query / produce (bao 「修改架构」).** 把 query 引擎从 smart-table 专属抬成 substrate 级契约:所有 content-type **功能点**(md/html/智能表格/pdf/CRM连接器/笔记元数据/mcp注册表…)经 :17873 gate 用**一个统一接口**操作,不再每能力各造工具。三动词:**`describe`**(普适,自报字段+支持的算子=类型/语义层,防"一切皆文件"丢类型的塌陷)/ **`query`**(读,并行、不过门,kernel service over `QuerySource`,功能包+工作流是 client)/ **`produce`**(写,串行、**过 review gate**,与 query 分开——连 GraphQL 都 query≠mutation,且 CTRL 写不分开就没法门控)。源分 RecordSource(filter/sort/group)/TextSource(match/semantic)/BlobSource(get/extract),算子由 describe 自报 → 统一在接口、分化在 describe(**不是啥都 query**)。NOT 新增 spine primitive(5 锁)——kernel 服务 + gate 契约,挂 Capability primitive 下。smart-table(ADR-003 §6.5)= 首个 RecordSource 实现。研究依据:GraphQL query-vs-mutation / Unix·Plan9 everything-is-a-file / 2026 agentic-AI Unix-philosophy 论文,事实源 `vault/ctrl/research/unified-operation-interface.md`。
  - v28 2026-06-18: **纠正 v27 brain 层 (bao 实查运行真相后钦定) + Obsidian connector 落地验证.** v27 把 brain 写成「BYO-CLI driver 取代内置 brain，hermes 摒弃」——**写过头了**。运行真相：**Irisy 的 brain = Hermes Agent**，CTRL 确实 bundle + 启动 hermes（dashboard :17890，Irisy 嵌入），**hermes 不退役**。**BYO-CLI driver / projection 是「附加」并行路径**（用户自带 CLI 经投影的 `.mcp.json` 也能驱动 CTRL 工具，已落地 `kernel/projector.rs` + 真机验证），不是替代。§1 brain 的「hermes 摒弃」就 brain 层而言 superseded（§ projection / § mcp-bus / Obsidian / plain-text 仍有效）。**Obsidian Local REST API MCP 连接落地**：根因 = `obsidian_connect` 从未被调用（boot 没接线）+ rmcp `auth_header()` 双重 Bearer 前缀 401；修复 = boot best-effort `register_and_connect` + reqwest default-header 带精确 `Bearer <token>`。真机验证：connected to bus，**16 工具**。真相源 `vault/ctrl/history/architecture/architecture-byo-cli-driver.md` 顶部纠正块 governing。
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
  - v17 2026-06-07: **§1 brain — full keycap retirement (word + cap-mode concept), ship 0.1.188.** bao 2026-06-07: "去掉 keycap 概念 你会更加清晰". v12 (2026-06-07) renamed symbols/filenames/packages but left runtime concepts intact; v17 finishes the job. (1) **`SessionMode = 'personal' | 'coding'`** — `cap` mode dropped (`packages/ctrl-web/src/lib/session-state.ts`). The "Pi wears a SKILL.md as a one-shot hat" behaviour was keycap dressed up as a session — skills are now invocable references Irisy reads on demand via `list_skills` / `read_skill`, not pinned via UI state. (2) **store actions** `wearCap` + `removeCap` REMOVED. `currentSkillId` field REMOVED. `sessionLabel()` simplified to 2-mode. (3) **IrisyChat.tsx** — cap banner block deleted, only the coding-mode `Coding · <projectDir>` indicator survives; `skill_id` no longer passed on the wire from this surface (kept as optional per-prompt param in `llm-transport.ts` for a future slash-command flow). (4) **pool.tsx** — skill rows render as documentation; "Wear cap" action button removed. (5) **IrisyCustomMessage `ModeSwitch`** — `cap` case removed; legacy bridge payloads still render via the default `Mode: ${mode}` fallback rather than empty pill. (6) **word scrub** — 5 code files (manifest-schema, vite.config, InfraBar, McpRunView, irisy-prompts) and `docs/design/tokens.json` (visual token rename `keycap*` → `key*`, no CSS refs verified pre-rename). (7) **External SKILL.md** — `~/.claude/skills/irisy-build/SKILL.md` + `~/.claude/skills/irisy-llm-tuning/SKILL.md` patched in v16 prep work (the persona reads these via `read_skill`; stale references were leaking "keycap" framing into Irisy answers). Tsc green. Remaining "keycap" string occurrences in this commit are deliberate retirement-changelog comments documenting what was removed — kept as load-bearing context for future readers (no live concept references).
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
  - v3 2026-06-01: **NEW** §8 Vault — kernel primitive endpoints (21 commands) + explicit feature-layer boundary: Daily Note + Sourcing inbox are **feature-layer** (Irisy + frontend wire them via `vault/.ctrl/*.yaml` + `vault/templates/*.md`), kernel does not know about either concept. Retires frontend O(N) backlink scan + 3-pane VaultBrowser shell. §6 MCP tools list extended from 11 to 28 (kernel exposes vault.{backlinks,tags,notes_by_tag,mentions,orphans,broken_links,graph_data,rename,move,create_folder,set_starred,aliases,watch} on top of existing 8). Wiki-link Tiptap extension cherry-picked from seahop/kairo (MIT, Sean Hopkins 2026) — see `THIRD_PARTY_LICENSES/kairo-MIT.txt`. Decision lock + sourcing workflow design: `vault/ctrl/history/brainstorm/vault-md-management-2026-06-01.md`.
  - v4 2026-06-02: §8.6 shell integration amended — bao realignment "Vault is substrate, Notes is the L1 app". L1 chip relabelled **Notes** (id `notes`, path `/notes`); chip click uses `openSystemTab({kind:'route', path:'/notes'})` matching Pool/Coding. New `routes/notes.tsx` renders `<NotesApp />` (3-pane: NotesActions top bar + NotesTree left + NotesEditor center + NotesBacklinks right). Components live in `packages/ctrl-web/src/components/notes/*` as standalone files for future Irisy-app-system reuse. L2 column reservation kept but **no longer flipped for Notes** — the app composes inside a workspace tab body, not across the shell grid. §8.7 retirements extended: `L2VaultPanel.{tsx,module.css}` deleted, `BacklinksDrawer.{tsx,module.css}` deleted (backlinks live inside NotesApp right column), `routes/vault.tsx` deleted (replaced by `routes/notes.tsx`), Rust `expand_workspace_window_if_collapsed` command deleted. Editor lib forward-compat invariant: `@tiptap/*` + `@uiw/react-codemirror` + `mermaid` + `gray-matter` consumed as npm packages — thin React wrappers, no fork, no vendor.
  - v5 2026-06-03: **NEW §9 smart-table-output** + **NEW §10 embeddings**. §9 unifies mcp output capture as one SmartTable per mcp (markdown table file at `notes/mcp-runs/<mcp_id>.table.md`, schema in mcp manifest `output_capture`); supersedes "1-run-1-file sidecar markdown" idea from `vault/ctrl/history/brainstorm/openclaw-compat-2026-06-03.md` — Notion-style table beats sidecar markdown for browsability and inline edit. P4 product-decision (`vault/ctrl/history/brainstorm/vault-irisy-product-design-2026-06-03.md`) locks "default-on, settings-wide kill-switch, per-mcp manifest opt-out". §10 adds the embeddings substrate the product spec depends on (Layer 3 Connect + Layer 4 Synthesize): local Ollama default with transparent fallback prompt (per product P1), SQLite BLOB storage (no sqlite-vss dep — flat cosine is fine for vault-scale up to ~50K notes), 5 new vault.* MCP tools, hybrid `vault.search` mode. Eight new acceptance items; brainstorm: `vault/ctrl/history/brainstorm/vault-irisy-product-design-2026-06-03.md`.
  - v6 2026-06-04: **NEW §11 audit-ledger** — substrate primitive for self-evolution (ADR-001 §8) across the 6 loops. Reuses `kernel/persistence.rs` SQLite event store with a new event kind `system.self_evolution`; immutable rows record (loop_id, stage, typed_action, evidence, diagnosis, verify_result, autonomy_level). Queryable from Settings → 自我升级 → 最近事件 tab. Prune policy: 7 d high-resolution + 90 d day-level aggregate + month aggregate beyond (bao 2026-06-04 wave Q5). Per bao "整个系统都要自我升级成长 ... 沉, 唯一真相, 要经常整理 ADR".
  - v7 2026-06-04: **§1 brain amendment — §1.1 ctrl-pi-bridge full extension surface** — bridge v1 used only `pi.registerProvider`, leaving Pi with 0 native tools (real-world Pi told user "我没有 skill 系统"). v7 expands bridge to 4 surfaces: `registerProvider` (existing) + `registerTool` × ~10 native tools (BYOK frontier path) + `on('before_agent_start')` chain-injecting ADR-005 §6 capability segments + `on('tool_call')` inspector stub (5-identical-calls loop guard) + `on('resources_discover')` exposing `~/.claude/skills/` as native Pi Skills. ctrl-pi-plugin spawn arg changes `--no-tools` → `--no-builtin-tools` so extension-registered tools stay loaded but Pi's default 7 (read/write/edit/bash/grep/find/ls) are off (kernel substrate stays the gatekeeper for vault writes etc). Provider-aware dispatch in `commands/irisy_chat.rs`: BYOK frontier ⇒ native tools, non-frontier (Volc/Qwen/Llama) ⇒ existing PWA XML loop (Cline operates under same constraint). 0 transitive deps invariant preserved via inline TypeBox mock. Paired with ADR-005 v4 §7. Brainstorm: `vault/ctrl/history/brainstorm/irisy-pipeline-2026-06-04.md` v2.
  - v8 2026-06-06: **§1 + §3 system-level provider redesign — single SSOT, Pi single alias**. Earlier v8 draft (router `last_routed` mirror register + `brain_status.last_routed` field) RETRACTED as patch-style: it added a 4th routing state on top of 3 racing ones (active-providers.json / Pi spawn intent / setModel target / proposed last_routed). Root issue is the 3-state race itself. Locks: (1) **§3.5 SSOT** — `~/.ctrl/state/active-providers.json` is the ONLY truth for routed provider/model. Router reads it per `/text-chat` request (mtime-watched in-memory cache). No mirror state, no `last_routed`, no `brain_status.last_routed`. (2) **§1.2 Pi single alias** — Pi spawns ALWAYS with `--provider ctrl-bridge --model default`. `ctrl-pi-plugin` injects a synthetic `ctrl-bridge` provider into `~/.pi/agent/models.json` at spawn time (baseUrl points at kernel `/text-chat`, apiKey placeholder) so Pi's startup `--provider` validation passes before extensions load. Post-spawn `setModel(active, firstModel)` switch path RETIRED. `PI_PROVIDER` / `PI_MODEL` / `CTRL_TARGET_PROVIDER` env vars RETIRED. Pi has zero visibility into the real provider — it lives entirely in the router via SSOT read. (3) **§3.5 failover is transient override, not state mutation** — on primary call failure router routes the SAME request to fallback + emits Tauri event `provider:routing-override { active, reason, ts }`; on next successful primary call emits `provider:routing-restored`. `active-providers.json` is never written by failover (intent is not stolen). (4) **§3.7 chip + Irisy self-report** — PWA `ChatHeaderControls` + ctrl-pi-bridge `runtimeTruthBlock` read `invoke('get_active_providers')` + subscribe `provider:routing-override` / `active-providers-changed` Tauri events. `Pi.getState` is NEVER consulted for provider/model display. `process.env.PI_PROVIDER` is NEVER read. `brain_status` `last_routed` field RETIRED (added in v8 draft, removed in v8 final). Closes 3-state race that caused v0.1.170-173 chip patches + "Irisy 连真相都不知道" (bao 2026-06-06 "我只要系统, 正确的, 不要修修补补").
  - v11 2026-06-07: **NEW §3.11 — Coding L1 role + on-demand native Pi TUI (0.1.181).** bao 2026-06-07 "把 coding 的 L1 功能完全使用 PI 完成了 L1 都是点击打开和关闭侧工作区" + "Irisy 和 coding 需要使用不一样的 provider". Locks: (1) **`Consumer::CodingPrimary`** enum variant + `coding.primary` SSOT role (parallel to `irisy.primary` / `irisy.fallback`). `route_chain` returns no fallback for this role — Coding errors surface in xterm, never silently fall through to Volc. (2) **On-demand native Pi process** — Coding L1 chip click invokes `coding_resolve_spawn` (new Tauri command) which reads the SSOT binding + resolves the API key from `credential_vault` + returns a `CodingSpawnSpec { command, args, env, provider_id, model_id, provider_label }`. PWA hands the spec to existing `cs_spawn` and navigates to `/code-space/$envId` where xterm.js renders the live PTY stream. No persona override, no Irisy prompt, no wrapper — Pi runs its native coding-agent CLI exactly as the upstream ships it (7 builtin file tools + bash + skills + native function calling all live). Independent process from the kernel-managed Irisy daemon. (3) **L1 click-toggle UX** — Pool / Notes / Coding chip clicks now check whether the chip's tab is already open AND active; if so the chip closes the tab and calls new `collapse_workspace_window` Tauri command. Switching between chips with the workspace open just switches tabs (no collapse). Project-dir prompt removed from Coding chip — Pi's TUI owns cwd. (4) **Settings → Providers** adds the "Coding primary" row alongside the two Irisy rows; provider_set_active accepts the new role unchanged thanks to the `Custom(String)` fallback variant.
  - v10 2026-06-07: **§3 + §6 + NEW §12 — full Pi extension wiring ship (0.1.179).** Locks the 2026-06-07 batch that v9 left as cite-only refs: (1) **NEW §3.9 Switch provider UX** — `provider_set_active` reply carries `model_id` (first model from manifest); PWA `providerSetActive` calls Pi RPC `setModel(provider_id, model_id)` via dynamic import to swap Pi in-place (0 ms, no daemon respawn, session preserved). Formalises v9 changelog item (4). (2) **NEW §3.10 Provider template catalogue** — bundled `provider-templates.json` expanded 10 → 20 entries (added mistral / xai / perplexity / fireworks / azure-openai / vertex / bedrock / cloudflare / zhipu / qwen), each addressable via Settings → Providers add wizard. (3) **§6 amendment — kernel MCP server boot + Pi auto-connect**: `KernelSupervisor::start` now spawns `mcp_server::serve(runtime, None, MCP_SERVER_LISTEN_ADDR)` and publishes the per-boot bearer token via `CTRL_KERNEL_MCP_TOKEN` + `CTRL_KERNEL_MCP_PORT` env vars (Pi child inherits naturally, no `env_clear` in `spawn_brain`). `ctrl-pi-plugin::injectActiveProviderForSpawn` upserts a `ctrl-kernel` entry into `~/.pi/agent/settings.json` mcpServers with `transport: streamable-http` + `Authorization: Bearer <token>` header. Other mcpServer entries are left intact (user-editable). Pi auto-connects on next spawn — kernel's 28 vault.* + kv + llm + mcp.* tools become native Pi tools. (4) **NEW §12 Pi extension surface — full wiring** — see new section. (5) **`$VAR` apiKey prefix** — `models.json` apiKey written as `$<ENV_VAR_NAME>` (Pi's required explicit-env syntax; plain string is now treated as literal with deprecation warning). bao 2026-06-07 "全接" + "真相也要选择吗?" — Pi端点都开好的, 接 = 写 caller, 不是 wrap 工程; 已开的端点要在 ADR 上有 truth.
  - v9 2026-06-06: **§1 + §3 — RETRACT v8 entirely. CTRL wraps Pi via Pi's published extension surface only.** bao 2026-06-06 "我从头一直是让你基于 PI 开发" + memory `feedback_pi_is_core_use_upstream_surfaces` (locked 2026-05-31, IGNORED in v8): wrapper must DELEGATE to Pi-exported surfaces, never reimplement what Pi already does. v8 (Pi single alias + ctrl-bridge streamSimple interception + CTRL-side router fallback + chip reading SSOT mirror) was 4 simultaneous wrapper-side reimplementations of Pi-native facilities. Each `apiKey: ""` / "Unknown provider" / "Connection error." stderr in the v0.1.170-176 series traces to one of those reimplementations. **Retractions**: (1) **§1.2 Pi single alias** RETRACTED. Pi spawns with the user-selected real BYOK provider id (`--provider <ssot-primary-id> --model <ssot-primary-model>`); `ctrl-pi-plugin` writes `~/.pi/agent/models.json` (Pi's designed config file) at spawn time with one entry per user-configured provider, `apiKey` = env var name reference (Pi `ProviderConfig.apiKey` documented as "API key or environment variable name"); CTRL pulls credentials from keychain → injects child env. No plaintext on disk. (2) **§3.5 router fallback chain** RETRACTED. Pi has no public fallback API today; CTRL does not invent a parallel one. The `RouteChain.fallbacks` walking loop, `record_failover`, `RoutingOverride`, `provider:routing-override` / `provider:routing-restored` events, and `ctrl-bridge` `streamSimple` interception are all RETIRED. When Pi exposes a fallback surface (e.g. `setAutoFallback`), CTRL adopts it — until then primary failure surfaces as a Pi error and the user re-picks in Settings. (3) **§3.7 chip data source** — chip reads `pi_rpc('getState')` (Pi's rpc.md-documented authoritative API). With Pi bound to the real provider directly, `getState().model.{provider, id}` IS the truth (matches user intent because Pi was spawned/setModel'd to it). `get_active_providers` Tauri command kept as INTENT projection for Settings UI only; chip uses Pi truth. (4) **Switch provider UX** — `provider_set_active` triggers an in-process Pi RPC `setModel(newProvider, newModelId)` via `/api/pi-rpc` (Pi runtime API, 0 ms, NO daemon respawn, session preserved). New user-added providers register via ctrl-pi-bridge `session_start` so models.json + extension stay in sync. (5) **PWA XML loop** RETIRED. PWA `<call>` parser, `irisy-prompts.ts` XML protocol injection, `irisy-tool-dispatch` artifacts deleted; tool calls flow through Pi-native function calling (`Context.tools` schema → BYOK adapter → `pi.registerTool().execute()`). (6) **Wrapper invariant** locked at substrate level: any wrapper code that re-implements a Pi-published surface (provider registry, LLM call, stream protocol, session, fork, compact, model resolution) is DEAD on arrival. Reviewer checklist requires citing the Pi surface delegated to. bao 2026-06-06 "全部按照 PI 做 能做吗 — 我从头一直是让你基于 PI 开发".
related:
  - vault/ctrl/adrs/001-spine.md
  - vault/ctrl/adrs/004-cap.md
  - vault/ctrl/adrs/006-cross-cutting.md
---

## §1 Brain — 2 parallel paths: Irisy=Hermes (bundled) + BYO-CLI driver (projection) — v28

> ⚠️ **v28 (2026-06-18, bao 实查运行真相后钦定 — 此块 GOVERNING, 与下方 v27 正文冲突时以此为准. 真相源 `vault/ctrl/history/architecture/architecture-byo-cli-driver.md` 顶部纠正块).** v27 把 brain 写成「BYO-CLI driver 取代内置 brain, hermes 摒弃」——**就 brain 层写过头了**. 运行真相 = **2 条并行 brain 路, 都经 `:17873` gate**:
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
| **hermes** | Assistant (long-term memory, skills, dialog) | `uvx --from 'hermes-agent[acp]==0.18.0'` (NousResearch, PyPI, MIT — npm "hermes-agent" is an unofficial 3rd-party shim, banned) | **ACP single door** (`hermes-acp`, see §1.8) — TUI-gateway / OpenAI-server NOT adopted; `hermes -z` one-shot retired as a routing path | `/assistant` |
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
3. **Contract probe** — `scripts/probes/hermes-acp-probe.mjs` (mirrors ADR-005 §7.7 `pi-bridge-probe`): ACP handshake + proto-version + streamed prompt + tool-call event + permission request + **MCP-bus passthrough** + `/model` swap + skills-dir read. All green → bump. Red → stay pinned, log the broken surface in `vault/ctrl/adrs/DRIFT.md` as an upgrade-blocker.
4. **L3 gate** — a brain swap is high-blast-radius → default autonomy L3 suggest-only (ADR-006 §4): probe runs auto, pin bump is user-approved (patch-level + N consecutive green probes may earn L4). Rollout tier under ADR-004 §updater (external-agent tier).

#### §1.8.5 Provenance — ACP is real + adopted

Zed Industries (2025-08, Apache-2.0, JSON-RPC over stdio); JetBrains official partnership (2025-10, native ACP in IntelliJ/PyCharm AI Assistant); Gemini CLI = reference impl; Zed ACP Registry live. **Clients** (CTRL's role): Zed · JetBrains · Neovim (CodeCompanion / avante / agentic.nvim) · Emacs · Kiro. **Agents** (CTRL aggregates via the one client): hermes · opencode · Claude Code · Codex · Gemini CLI · Copilot CLI · Goose · Cline · Cursor · OpenHands · … — so the ACP client doubles as CTRL's universal agent-aggregation surface (ADR-006 §5 通用化). Sources: zed.dev/acp · zed.dev/docs/ai/external-agents · jetbrains.com/acp · agentclientprotocol.com · github.com/NousResearch/hermes-agent#569.

#### §1.8.6 Multi-modal prompt attachments — capability-negotiated ContentBlocks (NEW v75)

> **v75 (2026-07-27, bao "opencode是接前端…这个输入协议层，Irisy和opencode是都要用的").** Drag-and-drop attachments (images/reference documents dropped into a chat composer) are a **client capability of the ACP protocol layer** (`shell/acp_client.rs`), shared by BOTH ACP-driven engines — Irisy's selectable engine (§brain v38) and Coding's `opencode` (ADR-001 §4 v16) — because both drive the same `AcpClient`. This is a protocol-layer addition, not a business-logic one: the two callers still attach files for different reasons (opencode = authoring reference material; Irisy = not wired this amendment, reserved for a future, separately-scoped data-import semantic) and this amendment does not blur that boundary.

**Why not a workspace-file / gate-tool workaround**: ACP's `ContentBlock` union (shared with MCP, per the [ACP content spec](https://agentclientprotocol.com/protocol/v1/content)) already defines `Image` (base64) and `EmbeddedResource` (complete text/blob resource inlined in the request) as the **standard** way to carry prompt attachments — the spec calls embedded-resource inlining "the preferred way to include context in prompts, such as when using @-mentions to reference files." Verified against real products before committing (Cursor's drag-to-Composer, Claude Code's Shift-drag-to-attach) — both inline the attachment into the request rather than dropping it on disk for the agent to `ls` and hope it notices. CTRL's prior `acp_client.rs` only ever sent a single `Text` block (`block_text()` returned an empty string for every other `ContentBlock` variant), so an attachment had no protocol-native path in.

**Capability negotiation is load-bearing, not optional**: `session/new`'s (or `initialize`'s) response advertises `promptCapabilities` — whether the connected engine accepts `image` / `embeddedContext` blocks at all. Sending an unsupported block type is a protocol violation the engine may reject the whole turn over. `AcpClient` now records the negotiated capabilities per session and `prompt()` only emits an `Image`/`EmbeddedResource` block when the connected engine declared it; otherwise the attachment degrades to a text notice ("user attached <name>, this engine does not accept inline attachments") rather than erroring the turn or silently dropping the file.

**Size discipline**: base64-inlined content travels inside a single newline-delimited JSON-RPC line over stdio (§1.8.1) — unlike a multipart HTTP upload, there is no framing that tolerates an arbitrarily large line cheaply. Images are capped (client-side downscale before encoding, matching the general chat-attachment industry ceiling of a few MB — see Viva Engage's stated 10MB image ceiling — rather than inventing a bespoke number) and embedded text resources are capped by character count with an explicit truncation notice, never a silent cut.

**Scope of this amendment**: `acp_client.rs`'s `ContentBlock` construction + capability negotiation only. The Coding-scene drag-drop UI that calls it is ADR-003 §8.5 (frontend). Irisy's own drag-drop UI is explicitly NOT built by this amendment — it is a distinct product semantic (feeding data to an *installed* feature pack, not authoring material for a pack under construction) and needs its own scoping before UI work begins.

### §1.9 Notes architecture — post-Obsidian (NEW v25, 2026-06-17)

> **⚠️ v46 (2026-07-02) SUPERSEDES the Obsidian posture below**: NotesApp = FULL native PKM replacement (v26's "stop adding PKM parity" reversed); §1.9.1 connector + provision RETIRED (code deleted); Obsidian = format-compatible neighbor, zero wiring. Native note endpoints (Obsidian-LRA-referenced, CTRL idiom) replace the connector's capabilities. Governing: `vault/ctrl/plans/notes/notes-module-replacement-plan.md`. The five-layer table + §1.9.1 below are kept as provenance.

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

**"apps" (Feishu / Notion / OAuth / OPC connectors)** are MCP **sources** (ADR-001 §3) → they project through the Tool→MCP row (they enter the CLI as MCP tools on :17873), not as a 5th asset type.

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

### §1B.8 Per-pack scoped projection — explicit Coding workspace eligibility (v44/v74 mechanism; v79 trigger)

The base workspace projection (§1B.1) grants the global default intent over ONE root (`~/Documents/CTRL/`). But §7.5 makes a **feature pack the product-grade unit = CTRL's answer to "project"** — so a pack should also be a **projection scope**: a driver launched in a pack's context should see exactly that pack's capability + context, not the whole workbench. §1B.8 realizes it (studying Atoms/Lovable, both organize the driver's world by *project* — CTRL's project = the pack).

**Mechanism** (`projector::project_pack`): materialize a **pack-scoped** `.mcp.json` + `opencode.json` + `AGENTS.md` into `~/Documents/CTRL/<pack_id>/` —
- `.mcp.json` **and** `opencode.json` (v74) both stamp the pack's **OWN** intent domain (a §14 data pack → the `source` domain), **not** the global default. Elegant consequence: a pack grants exactly its own domain **without widening the base workspace** (e.g. `source` is deliberately absent from the global BYO default; per-pack scope is how a connector reaches a driver, contained). **Both gate shapes are required, not just one**: ADR-001 §4 makes OpenCode the sole coding engine, and a driver is only launched against a directory carrying `opencode.json` — a pack scope with `.mcp.json` alone (v44's original shape) is a Claude-Code-compatible scope that OpenCode itself cannot launch into, which is exactly the dead-end an independent review confirmed (every pack scope listed as a workspace with "Launch OpenCode" permanently disabled).
- `AGENTS.md` carries the pack's context block (`pack_agents_block`): the pack name, its dedicated KB subpath (`knowledge_base`), and that the gate here is scoped to this pack — so the driver knows what it is working in.
- Reuses the base machinery unchanged (`project_gate_into_dir` + `project_opencode_into_dir`, both with an explicit intent; `project_agents_block` with the pack block; same atomic-write + marker-preserve + upsert-idempotent guarantees).

**Trigger (v79, governing)**: at boot, `project_installed_packs` auto-projects a scope only when the installed manifest declares `projection.coding_workspace: true`. This actor/surface grant is independent of capability shape: `record_source`, `knowledge_base`, or a local MCP child never implies OpenCode eligibility. The default is false, so an Irisy Companion such as LibreOffice remains discoverable through the gate without becoming a Coding workspace. For an explicitly eligible pack, the existing v74 mechanism still scopes `.mcp.json`, `opencode.json`, and `AGENTS.md` to the pack's intent and KB. Manifest scan remains best-effort; an unreadable manifest is skipped. (ADR-002 substrate § projection v79)

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

v1.1 promotion candidates (mcp-local until 2nd consumer): `process.spawn`, `network.local_rpc`, `oauth.broker`, `event.{publish,subscribe}`.

**Implementation**: `src-tauri/src/kernel/capability.rs` + `commands/mod.rs` registry. Hand-written Rust + `packages/ctrl-kernel-sdk` TS type-gen.

## §3 Provider router — role-aware routing + PATH detect + introspection (NEW v1)

> **v71 governing state model (2026-07-25):** The provider subsystem reports five separate facts: **catalogued** (manifest known), **configured** (credentials/config can construct the adapter), **runtime availability** (adapter-specific probe; `unknown | available | unavailable`), **verified** (persisted production-trial evidence matches the current behavior manifest and resolved credential), and **bound** (`irisy.primary` or `irisy.fallback`). No earlier fact implies a later one, and binding does not imply verification. Builtin Ollama means only catalogued; it is available only when its configured daemon answers and contains the selected model. First launch binds no role. `provider_set_active` is the binding path and commits both exact verification evidence and role intent only after the v69 real trial. Primary routing consumes exactly the verified explicit primary followed by the verified explicit fallback; no hardcoded provider id, automatic seed, ignored fallback chain, direct adapter bypass, or first-ready scan is permitted. Legacy v0/v2/v3 bindings remain intent but migrate unverified; pre-v3 state whose fallback was automatically seeded to Ollama migrates once to an unbound fallback. Settings exposes both roles and renders configuration, runtime, verification, and bindings as orthogonal facts. This paragraph supersedes conflicting v2/v8/v9/v70 prose below; historical text remains provenance. (ADR-002 substrate § provider v71)

> **v61 amendment (2026-07-11): `claude-oauth` (Claude subscription via `claude` CLI) is REMOVED as a provider** — Anthropic's usage policy forbids backing an LLM provider with Claude Pro/Max subscription OAuth. Anthropic = BYOK API key only (`anthropic-api`). Every `claude-oauth` / `cli_claude_persistent` reference below is historical. BYO-CLI driver projection (ADR-001 spine) is unaffected — that is the user's own Claude Code being Claude Code, not a provider.

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
- ~~`cli/claude_persistent.rs`~~ REMOVED v61 (2026-07-11, Anthropic policy — see §3 amendment note)
- `rest/http_api.rs` (openai-shape, manifest-driven, ~400 LOC)
- `rest/{anthropic,openai,google,ollama}.rs` (4 thin wrappers — ported verbatim from VMark `ai_provider/rest_providers.rs`, ISC)

### §3.3 PATH resolution (ports VMark `login_shell_path` + `augmented_path`)

Tauri inherits sparse PATH `/usr/bin:/bin:/usr/sbin:/sbin`. CLI providers live at `/opt/homebrew/bin/`, `/usr/local/bin/`, `~/.npm-global/bin/`, `~/.local/bin/`, `~/.cargo/bin/`. `resolve_binary_path()` scans these; `augmented_path()` prepends to child PATH so spawned CLI can find its own `node` shim.

Same trap fixed in 3 spawn sites (`claude_persistent.rs`, `brain_supervisor.rs`, `pi_install.rs`). New providers MUST use the shared resolver.

### §3.4 Manifest schema (TOML, drop-in extensible)

```toml
id = "anthropic-api"
label = "Anthropic Claude (BYOK)"
kind = "http_api"                # cli_one_shot | http_api | rest_openai | rest_anthropic (cli_claude_persistent removed v61)
binary = "codex"                 # CLI only
endpoint = "https://api..."      # REST only
auth = "keychain:anthropic"      # none | keychain:<key> | env:<var> | config:<key>
env_strip = []
models = ["claude-sonnet-4-6"]
capabilities = ["text.chat"]
```

6 builtin presets shipped Day-1: ~~`claude-oauth`~~ (removed v61), `anthropic-api`, `openai-api`, `volc`, `kimi`, `deepseek`. (bao 2026-06-05 later slimmed builtins to `ollama` only; users add BYOK providers via Settings.) User additions go to `~/.ctrl/providers/<id>.toml`. CN Anthropic-shape endpoints (api.moonshot.cn/anthropic, api.deepseek.com/anthropic) supported via preset.

### §3.5 Explicit role routing

`Consumer` has two first-class text-chat roles: `irisy.primary` and `irisy.fallback`. Both are unset on first launch. A role enters versioned active state only through `provider_set_active(role, provider_id)` after the production first-output trial succeeds; clearing a role removes only routing intent and leaves provider configuration intact.

```rust
pub enum Consumer { IrisyPrimary, IrisyFallback, Custom(String) }

pub struct RouteChain {
    primary: Option<ProviderId>,
    fallbacks: Vec<ProviderId>,
}
```

For `irisy.primary`, `RouteChain` contains the explicitly bound primary followed by the separately and explicitly bound fallback, excluding a duplicate id. For `irisy.fallback`, the chain contains only that role's binding and never recurses. An empty chain returns a typed unbound-provider error. Runtime routing probes adapter-owned availability, skips `Unavailable`, then uses the existing first-output stream check; `Unknown` remains eligible for the production call because remote availability cannot be proven cheaply. Catalogue entries, configured adapters, and arbitrary first-ready scans never create candidates.

Persisted state is versioned v4 and keeps role intent separate from verification evidence:

```json
{
  "version": 4,
  "roles": {
    "irisy.primary": "zhipu",
    "irisy.fallback": "ollama"
  },
  "verifications": {
    "zhipu": { "fingerprint": "<sha256>" },
    "ollama": { "fingerprint": "<sha256>" }
  }
}
```

A fingerprint covers the serialized behavior-relevant manifest and the resolved credential. Only the digest is persisted; raw credentials never enter this file or logs. A provider is verified iff its stored digest equals the digest recomputed from the current manifest and credential. Successful `provider_set_active` and a successful transactional edit of an already active provider record evidence after the persisted manifest and credential are reloaded. Ordinary Test is non-mutating. Clearing a role preserves evidence; deleting a provider removes it; any configuration replacement naturally invalidates stale evidence by fingerprint mismatch.

The example fallback exists only because the user explicitly activated it. Migration from v0/v2/v3 preserves role intent as bound-but-unverified, removes the pre-v3 automatically seeded `irisy.fallback = "ollama"` once, and persists v4. Transient failover records what happened but never mutates role bindings or verification evidence. Production routing accepts only explicit bindings with matching current evidence, and every text-chat caller uses the shared router. (ADR-002 substrate § provider v71)

### §3.6 Catalogue, configuration, runtime, verification, and binding UX

`provider_list` reports independent facts for every manifest: `configured`, `runtime_status`, `runtime_detail`, `verified`, and `active_roles`. `provider_detect` may report system discovery but does not bind a role. Opening Settings performs bounded adapter-owned probes; Ollama calls its configured `/api/tags` endpoint with a two-second timeout and is `available` only when the exact selected model tag exists. Remote providers normally remain runtime `unknown` until the user activates one through the real trial.

Settings renders four orthogonal badge groups for each provider: configuration (`Needs configuration` or `Configured`), runtime (`Runtime unavailable`, `Available`, or `Runtime unknown`), verification (`Verified` or `Not verified`), and zero or more roles (`Primary`, `Fallback`). A bound role remains visible when runtime is unavailable. It provides separate `Use primary` and `Use fallback` actions plus `Clear fallback`; an unbound fallback is displayed as `No fallback`. No row displays composite `Ready`, and deleting a bound provider leaves its role unassigned rather than selecting another provider. (ADR-002 substrate § provider v71; ADR-003 frontend § pwa v25)

### §3.7 Introspection

`brain_status` keeps engine process health separate from provider facts. Each explicitly bound role reports provider identity plus `configured` and `verified`; verification is queried from current fingerprint evidence and is never inferred from the binding. Introspection surfaces may report whether a verified primary binding exists, but must not choose an adapter. `providers.describe/query` exposes the same typed dimensions through the §14 RecordSource schema. `get_active_providers` remains the projection of explicit role intent used by chips and Settings. None of these surfaces may infer routing intent, verification, or runtime availability from manifest presence. (ADR-002 substrate § provider v71)

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

`IRISY_ROLES` list extended to 3 rows: `irisy.primary` / `irisy.fallback` / `coding.primary`. The existing `ProviderRoleRow` component handles the new row unchanged because `providerSetActive({role, provider_id})` already accepts any role string. Users get a single Providers tab in Settings where they bind 3 roles to 3 (possibly different) providers — e.g. Volc → Irisy primary, CTRL Cloud → Irisy fallback, Claude (BYOK API key) → Coding primary.

**Why on-demand process (not RPC)**

Pi's RPC mode (used by Irisy) wraps the agent loop and exposes 38 RpcClient methods, which is great for embedding chat in a PWA bubble — but it costs the native TUI affordances (live status line, slash commands rendering in-place, terminal-native scrollback, real PTY signals). Coding is a power-user surface; bao explicitly asked for "完全使用 PI" = the native Pi CLI experience. xterm + cs_spawn gives that for ~0 new code. Two Pi processes coexist cleanly because each has its own session dir under `~/.pi/agent/sessions/` and reads `~/.pi/agent/{models,settings}.json` for config.

### §3.10 Provider/model catalogue — bundled floor + Models.dev refresh (v67 — 2026-07-23)

`src-tauri/src/kernel/provider/provider-templates.json` ships a 21-entry offline floor: volc · openai · anthropic · deepseek · kimi · google · openrouter · groq · together · mistral · xai · perplexity · fireworks · azure-openai · vertex · bedrock · cloudflare · **Z.AI** (stable persisted id `zhipu`) · **Z.AI Coding Plan** (`zai-coding-plan`) · qwen · custom. Z.AI Coding Plan remains separate because its endpoint and credentials are not interchangeable with the general API. Settings → Providers renders catalogue data rather than provider-specific UI logic; user overrides at `~/.ctrl/provider-templates.json` remain highest precedence.

Completeness does **not** come from expanding that snapshot forever. On boot and when the provider surface opens, CTRL fetches the public [Models.dev API](https://models.dev/api.json), transforms every provider representable by the existing API-key form and runtime wire (`@ai-sdk/openai-compatible`, `@ai-sdk/openai`, or `@ai-sdk/anthropic` with a concrete HTTPS endpoint), imports its complete advertised model-id set, and caches the result. The bundled floor renders immediately and remains available offline; a successful refresh replaces it in-place without changing persisted CTRL ids. Once a user enters a key, the provider's own `/models` response remains the strongest live truth, with Models.dev/cache as fallback. Catalogue refresh sends no credential or user data.

**OpenCode boundary:** OpenCode remains authoritative for provider shapes CTRL's API-key HTTP form cannot honestly represent: OAuth/cloud profiles, local runtimes, templated multi-credential endpoints, and provider-specific wire/auth behavior. CTRL consumes the same public catalogue for its supported subset rather than duplicating OpenCode's private state, never writes OpenCode credentials, and projection only upserts `mcp.ctrl-kernel` while preserving the user's `provider` configuration.

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

- **Bind**: `127.0.0.1:17873` (one above the browser/mobile event WebSocket on 17872). Never `0.0.0.0` — cross-device goes through mesh (§4), not MCP.
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
| 4 | `skills` | bundle-relative SKILL.md refs installed atomically into the one hot-scanned local registry (`~/.claude/skills` user override > `~/.ctrl/skills` CTRL-managed projection); UI pinning and gate discovery consume the same files, no merge and no vault-KB shadow registry |
| 5 | `ui_surface` | 9-enum (none/notification/modal/clipboard/html-output/chat-stream/picker/form/canvas) |
| 6 | `cap_asset` | install-time provisioning: `cap_asset.files` (immutable bundle) + `cap_asset.vault` (user-facing folder + seed) |
| 7 | `provision` | install-time toolchain + env (v21): `tools[]` (id + check + install hints) resolved built-in-downloader-first → system pkg-mgr fallback; `env` values pull `{{secret:<key>}}` from keychain at inject time |

**Persona lives inside `cap_asset.files`** as per-mcp markdown — not a separate axis. Vault override `vault/mcps/<id>/persona.md` wins; single lookup, no global persona library.

**Manifest protocol authority (v73):** `packages/ctrl-mcp-sdk/schema/manifest-v2.schema.json` is the sole structural contract and uses JSON Schema draft 2020-12. It owns field shapes, enums, numeric/string constraints, conditionals, declared defaults, and which legacy v1/pre-v55 inputs remain readable. TypeScript/Ajv and Rust/jsonschema compile that exact shipped file; generated or handwritten TypeScript types and Rust serde models are consumers only and cannot reject structurally valid schema input. No runtime may shell out to another language to validate.

Validation is deliberately two-layered. The shared schema runs first at every validate, publish, and install boundary. Rust then applies only product/install semantics that are not field grammar: a pack must expose actions, a server, or a `record_source`; a `record_source` must produce a positive generic describe; missing connector auth may warn; environment and security policy may still block installation. Those checks cannot duplicate id/version/email/server/step/record-source shape rules. Schema defaults and consumer normalization are distinct from validation and cannot become another rejection authority.

Compatibility is explicit rather than accidental: omitted `manifest_version` means legacy v1; omitted legacy `server.type` means local; pre-v55 code-backed `mcp-server` packs may omit `server`, while current `manifest_version: 2` `mcp-server` packs require it; `stss-publisher` and Pattern F remain parseable only with migration warnings and never regain an executor. A shared conformance corpus is run by both language consumers and includes shipped manifests plus these legacy and rejection cases. (ADR-002 substrate § composition v73)

**Builtin vs user mcp** = one metadata flag. `manifest.builtin = true` → ships from `packages/ctrl-mcps/builtin/<id>/`, re-seeds on every launch (self-repairs deletion). `builtin = false` → `~/.ctrl/mcps/<id>/`, uninstallable.

**Multi-modal category exception** to §2 frequency ≥3 rule: image.generate / image.edit / image.understand / audio.stt enter v1 even with 1 consumer each — "做海报得有 image 大模型, 我们是双重 brain" (bao 2026-05-30). Frequency rule still governs non-brain namespaces.

### §7.1 FCT — the sole user-facing reusable-capability unit (v84, bao 2026-08-05)

**FCT is CTRL's sole product-facing noun for an installable or locally available reusable-capability unit.** It is written exactly as `FCT`, is not expanded in UI copy, and pluralizes as `FCTs`. Users create, find, install, remove, select, and use FCTs. `Feature Pack`, `pack`, `Skill`, `capability`, `Resource`, `MCP`, manifest, bundle, and package remain internal architecture, compatibility, or transparency terms; none is a parallel user shelf noun.

FCT is a normalized projection, not a new runtime object. A canonical namespaced FCT ref (`pack:<id>` or `skill:<name>` during compatibility) resolves through the one §16 registry into:

```text
explicit Resources + optional skill_id + capability_scope + policy facts + install reference
```

The resolver must return exact facts before selection is committed. A stale, unavailable, ambiguous, or non-projectable entry fails visibly; it never falls back to a decorative label. Namespaced refs prevent package/Skill name collisions. The projection does not own a Resource, Skill, capability, session, transcript, operation, credential, or ReviewGate decision and does not become a sixth kernel primitive.

The existing manifest/package shell remains the systematic implementation mechanism for product-grade FCTs: one schema can connect APIs/services, declare capabilities and UI descriptors, and install atomically. The runtime stays generic and source-neutral. In §§7.2–7.6, legacy `pack`/`feature-pack` names identify that internal manifest/package compatibility boundary only; product UI and current product prose use FCT.

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

**校验** = 先由 §7 v73 的共享 JSON Schema 在 Gate/发布/安装边界执行结构校验，再由 MCP-Inspector 式产品语义 smoke（经 gate `mcp_pack_list` / `mcp_pack_run`）确认 action 或 server 真能运行。语义 eval 不得复制 schema 字段规则。

**对齐**: 数据源 3 的开放 skills 由 ADR-001 spine § projection 的 projector 投影给 driver CLI (不重造,骑 Anthropic 升级);commons 分享 = ADR-006 §5 share-and-be-shared;角色 = persona 层 only,pack + KB 是正交 config (ADR-003 §8.6 + ADR-005 v6,**不焊死**)。

**不做**: 不为每个 pack 写 .ts / Rust 分支;不把 Discover 做成人工维护的长尾列表;不自造 manifest/bundle 格式 (沿用 v2 manifest + Anthropic `.mcpb` + mcp-server-dev skills)。

**v1 落地序** (方向已锁,实施分步): ① OFFICIAL_PACKS 退成纯数据 / 接第一个 registry 作 Discover 数据源;② 投影 Anthropic `mcp-server-dev` skills 给 Irisy + hermes;③ mcp-creator 端到端: NL → manifest → gate 安装 → smoke 绿。

### §7.5 Feature pack = the product-grade unit — CTRL's answer to "project" (v41, bao 2026-07-01)

**bao 2026-07-01**: 「我们的功能包,类比 project 的话,我希望我们的功能包都是**产品级别**的;也是**用户创造中心,分享中心**。」

**定位对照**: Atoms(MetaGPT) / Lovable 都以 **project** 为顶层组织单位 (一个 project = 一个完整产品 + 其 knowledge + 分享落点; MetaGPT 的 `Team.generate_repo(idea)→repo`、Lovable 的 Workspace-Knowledge[全局]+Project-Knowledge[单 app] = `CLAUDE.md`+`AGENTS.md` 同构)。**CTRL 的对应单位 = 功能包**,但 substance 相反 —— 不是从零造一个独占 app (云托管、卖托管),而是**产品级 AI-native 能力,长在已有开源软件/MCP 上、Irisy 造、当 MIT commons 分享、经 `:17873` gate 治理**。同样是「产品级单位」的抬升,substance 是反默认的护城河 (整合非重造 / commons 非托管 / 本地非云)。

**三条属性锁 (功能包的定义)**:
1. **产品级 (product-grade)** — 一个功能包 = 一个**完整产品**,不是 raw wrapper。硬 bar = **§14 AI-native 提升层** (describe/query/produce 三动词 + one-shot 高信号原子,**不是一 endpoint 一 tool 镜像**) + 专属 KB (`knowledge_base`) + **工作界面 (`workspace` = 智能表格操作界面, v48)** + per-call gate 治理。「产品级」= 这条 uplift bar 的用户语言版。**工作界面具体化 (v48, bao 2026-07-03)**: 按需 UI 不是空 scene —— 是**该包的智能表格拼成的操作界面** (飞书 Bitable 式)。smart-table 就是通用产品-UI 构建器 (8 视图 + 全字段类型, §14 v30)。manifest 声明 `workspace` (哪些智能表格是它的 UI; v1 = `table_prefix: tables/<pack>-*` 约定, Irisy 建表自动入区, 加表零代码); `FeaturePackScene` 渲染这个工作区 (每表一 Tab, 各自多视图), 而非空白/仅 intro。前端零 bespoke (smart-table 是通用构建器, 不为任何包写 UI 代码)。对齐 v39 moat + `vault/ctrl/research/ai-native-feature-pack-research.md`。
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

> Spec: `vault/ctrl/history/brainstorm/vault-irisy-product-design-2026-06-03.md` §5.6 + product decision P4
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

Considered (`FreeSQL` / Turso / Supabase) and rejected — see `vault/ctrl/history/brainstorm/vault-irisy-product-design-2026-06-03.md` §3 "FreeSQL evaluation". SQL DB violates plain-text + vim test (philosophy #1) and creates a separate query surface to maintain. Markdown table is the right substrate because it is the user's vault data, not the engine's session data.

---

## §10 Embeddings substrate — Ollama + SQLite flat cosine (NEW v5, 2026-06-03)

> Spec: `vault/ctrl/history/brainstorm/vault-irisy-product-design-2026-06-03.md` §5.1, §5.5, §5.8, product decisions P1
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
- Product spec §5.11 remote co-view — the former ST-SS proposal is retired; current cross-device transport is owned by ADR-010 and ADR-005.
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

## §12 Diagnostics projection — existing owners, one observer (NEW v72, 2026-07-25)

This substrate publishes only content-free lifecycle metadata from the existing owners into ADR-010 § diagnostics: `acp_client` owns Irisy engine/session state; `SubprocessActor` and `CodeSpaceRegistry` own Coding process lifecycle; `vault_watch` and the derivative FTS index own Notes watcher/freshness state; `mcp_server` owns the authorized read-only gate projection. The diagnostics composer may aggregate snapshots and bounded breadcrumbs, but it cannot spawn, reset, supervise, replay, or replace any owner. It creates no second ACP loop, PTY, watcher, index, or persistent audit store.

Owner adapters publish phase, outcome, duration, counts, stable opaque identifiers, and recursively redacted attributes only. They never publish credentials, environment variables, raw ACP prompts/completions/thoughts, raw tool arguments/results, PTY input/output, note bodies, absolute paths, or `InternalMsg`/raw Event payloads. Status and smoke read current owner state; smoke is non-mutating and cannot issue a model turn, spawn a process, or rebuild the index. Retention, capture, export, and external projection are governed solely by ADR-010 § diagnostics v11.

## Acceptance

### Brain (§1)
- [~] Historical Pi bridge / supervisor / lazy-install / every-turn routing criteria below shipped in v0.1.124-126 but were retired atomically in v19; they are provenance, not current release requirements.
- [x] Hermes install command, version, ACP spec, and Python pin share one build-owned SSOT in `shell/agent_installer.rs`; existing manifests reconcile to that pin at boot.
- [x] Irisy drives Hermes through `shell/acp_client.rs`, while provider-router fallback remains available when the selected engine cannot start.
- [x] `scripts/probes/hermes-acp-probe.mjs` reads the build SSOT and proves initialize → session/new → streamed session/prompt before release.

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
- [x] ADR locks 6-axis substrate law. Implementation deferred to "bao calls execution" per .kiro/steering/development-philosophy.md 灵活开发. Closed at "decision recorded".

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
- [~] Historical Pi-turn SOUL injection retired with Pi in v19. Current Hermes SOUL ownership/drain acceptance is tracked in ADR-005 §9.5.

### Layer 4 synthesize (product brainstorm §5.3 / §5.5 / §5.10 — satisfied here)
- [x] `commands/irisy_synth.rs` — 3 Tauri synthesis commands (`irisy_question_vault`, `irisy_synthesize_notes`, `irisy_daily_summarize`) now drain the shared explicit+verified provider router; the former direct `provider_registry.primary_text_chat` path is retired under §3 v71. Originally shipped v0.1.158.

### Block AI ops (product brainstorm §5.2 / P2 / P7 — satisfied here)
- [x] `lib/block-ai-ops.ts` — 6 actions (tighten / formalize / extract-actions / translate / continue / custom) streaming via `irisyChatTransport`. v0.1.158.
- [x] `components/notes/BlockAiOps.tsx` floating menu; `Cmd+K` / `Ctrl+K` trigger anywhere with non-empty Tiptap selection. v0.1.158.
- [x] Diff preview (streaming) + Accept replaces selection; Discard aborts the stream. v0.1.158.
- [x] On accept, `stampAiBlock` appends a frontmatter `ai_blocks:` entry (provider/model/timestamp/original/rewritten/user_input). v0.1.158.

### Transparency (product brainstorm §6.4 — satisfied here)
- [x] `lib/ai-block-metadata.ts` — `stampAiBlock` + `readAiBlocks` for frontmatter round-trip. v0.1.158.
- [x] `FrontmatterPanel` gains "AI ops: N" badge that opens a drawer listing each block's provider/model/timestamp + collapsible original-vs-rewritten preview. v0.1.158.

## Future work (§ Provider §3 implementation — tracked separately from § Acceptance per .kiro/steering/development-philosophy.md 灵活开发)

- `kernel/provider/{trait.rs, registry.rs, detect.rs, path_resolver.rs}` exist with **2-role** table (irisy.primary + irisy.fallback) + RouteChain + auto-fallback (v2)
- 4 REST adapters ported from VMark (`rest/{anthropic,openai,google,ollama}.rs`), ISC attribution
- **7 builtin manifests** (v2, ~~`claude-oauth`~~ removed v61): `anthropic-api`, `openai-api`, `volc` (CTRL-managed fallback), `volc-byok` (user-elected), `kimi`, `deepseek` (+ implicit `ollama` if detected)
- Tauri commands: `provider_detect` / `provider_set_active(role, id)` / `provider_active(role)` / `brain_status` (returns `managed_by` field per role, v2)
- `/text-chat?consumer=<role>` honors 2-role routing; auto-fallback chains on error, emits `provider:failover { from, to, reason }` event
- First-boot: irisy.primary = highest-priority detected CLI silently + Irisy toast; irisy.fallback = `volc` (CTRL-managed) always active without user action
- Irisy prompt v5 wired (depends on ADR-005 § persona implementation) — brand labels only ("Anthropic API" / "CTRL Cloud"), never codenames
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

### §12.8 Historical acceptance (retired v19; non-binding)

- [~] `ctrl-pi-bridge/src/index.ts` registered 28 events — historical v10 evidence; package deleted in v19.
- [~] `before_provider_request` auto-RAG hook — historical Pi implementation, retired in v19.
- [~] Pi audit-line, inherited-tool, flag, MCP auto-connect, provider/model and `$VAR` criteria — historical implementation evidence only.
- [~] The Pi RPC evaluator was deleted; current release evidence is `scripts/probes/hermes-acp-probe.mjs`, source-pinned to `shell/agent_installer.rs`.

## §14 Unified Operation Interface — describe / query / produce (NEW v29, 2026-06-19)

> **v83 status:** This section is migration history and adapter guidance only. Its
> Source profiles, `QuerySource`, `RecordSink`, global `ProduceOp`, and namespaced
> endpoint examples do not define the permanent substrate. §15 is authoritative:
> `ResourceRef → ResourceOwner → describe/query/produce` through one registry.
> New Resource kinds implement §15 and do not extend the legacy Source contracts.

> bao 2026-06-19「修改架构」. Every content-type **feature point** (md / html / smart-table /
> pdf / CRM-connector / vault-metadata / mcp-registry …) is operated by Irisy through ONE
> uniform interface projected on the :17873 gate (§6), instead of bespoke per-capability tools.
> Research-grounded (GraphQL query-vs-mutation, Unix/Plan9 "everything is a file", the 2026
> agentic-AI Unix-philosophy paper, ChatBI/MCP); fact source
> `vault/ctrl/research/unified-operation-interface.md` + `research-ai-data-platforms.md`.

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

### §14.6 Historical migration acceptance (superseded by §15 v83)

The former Source-centered acceptance list is retired. It is retained by the
surrounding section only as migration provenance; current design acceptance is
owned by §15 and does not permit namespaced equivalents or new `QuerySource`
extension points.

### §14.7 subscribe — streaming read = the `watch` projection of `query` (NOT a fourth verb)

Live data (Irisy / PWA observing a result set that changes under them) is **not** a new verb. It is
`query` with a `watch:true` modifier: the source resolves the snapshot, then the gate pushes a
current event delta as the underlying rows change. This keeps the verb set frozen at
three (`describe` / `query` / `produce`) — transport liveness is orthogonal to data semantics.

- **Why a modifier, not a verb**: a verb is a data-semantics dimension; streaming is a
  transport/lifecycle dimension. Folding them into one enum (a literal `subscribe` verb) forces
  every source to implement it — but sources with no stream semantics (registry / providers) would
  return an empty impl or panic. As a `watch` modifier, a source that cannot stream simply ignores
  it (or `describe` advertises `watchable:false`); the no-stream sources stay clean (ISP).
- **Trust split**: the **authorization + audit** of a watch subscription flow through the
  `:17873` gate (same governance as a one-shot `query`); the delta bytes use the current
  transport: `event_ws.rs` CBOR-over-WebSocket for browser/mobile and Tauri Channels on desktop.
  This closes the prior audit blind spot where legacy event streams bypassed the gate entirely —
  the gate now sees (and can revoke / redact) every live subscription, even though it does not sit
  on every hot byte path.
- **Degradation**: a watch that loses its source (connector offline) degrades to its last snapshot +
  a `degraded` marker rather than hard-failing — consistent with the local-first contract
  (`describe` self-reports degradation behaviour). Permanent design rationale + four-dimension
  framework: `vault/ctrl/history/communication/comms-architecture-permanent.md`.

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

> **v83 convergence:** This section records the migration mechanism that reduced bespoke record tools; it is no longer the permanent substrate contract. `QuerySource`, `RecordSink`, and the global `ProduceOp` union may remain only behind migrating owners. The sole end-state behavioral interface is §15 `ResourceOwner::describe/query/produce`, whose descriptor schemas type owner-private payloads. New Resource kinds do not extend these legacy traits or enums.

**Gap this closes**: the READ side is systematic — one `QuerySource` trait (`describe` + `rows`) + a shared `run_query` engine, so a new source is queryable with zero engine code (§14.5). The WRITE side drifted into fragmentation: native smart-table grew ~10 bespoke gate tools (`smart_table_update_cell/append_row/delete_row/batch_append_rows/batch_delete_rows/add_field/delete_field/create/add_view`) each hand-coded, while connectors got a SEPARATE generic `source_produce` (§14.12). Two write patterns; adding Sheets/Docs/Calendar would re-hand-code every operation. That is endpoint-accretion, not a system. Governing design: `vault/ctrl/history/architecture/unified-productivity-suite-architecture.md`.

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

**Slice 7 (2026-07-02, notes-plan S4) — the vault git audit layer (E6, Tolaria git-as-AI-audit-trail)**: new `vault_git.rs`. WRITE half: every SUCCESSFUL mutating gate call on a vault-backed domain (`vault`/`notes`/`smart_table`/`tasks`/`calendar` × the review-gate mutating-verb classifier) schedules a COALESCED auto-commit (20s quiet window / 120s cap, flushed early when the author changes so attribution never blends) authored as the caller — `user <user@ctrl.local>` for the PWA, `<caller> <caller@ctrl.local>` for agents (irisy/hermes/claude-code…) — hooked ONCE in `call_tool` after the audit-ledger write (file-layer attribution complementing the call-layer ledger; transparency-by-drill-down). Opt-in by construction: no `.git` in the vault → no-op (user initializes via the existing git_init / Notes UI). READ half (gate tools): `note_history(path)` (`git log --follow`), `note_diff(path, rev)` (hex-guarded rev — argv-injection safe), `vault_pulse(days?)` (per-day counts split user-vs-agents + recent commits — Tolaria Pulse parity). Tested end-to-end against a real tempdir git repo (two authors → history/diff/pulse read the attribution back). 100 gate tools.

**Slice 3 (2026-07-02) — Calendar is the FIRST product built trait-only from the start (migration point 4 made real)**: new `calendar_source.rs` implements `QuerySource` + `RecordSink` and the gate exposes exactly the 3 verbs (`calendar_describe`/`calendar_query`/`calendar_produce`) — **zero bespoke per-op tools ever existed for it**. Storage = one event per note under `calendar/` with frontmatter `{title, date, start?, end?, location?, tags?}`, filename `<date>-<slug>.md` (deduped `-2/-3…`), free-form body — the Obsidian Full Calendar note-per-event convention (vim test + Obsidian compat by construction). `supported_ops` = set_cell (edit one frontmatter field in place, body + unknown fm keys preserved verbatim; `date` validated YYYY-MM-DD) / upsert_rows (create event notes; title+date required) / delete_rows (delete the notes); field ops `Unsupported` (fixed schema). Gate locks every addressed note (task_produce posture). Sheets ruled OUT as a separate source — same record-grid as smart-table (a second grid source = fragmentation, Bitable is the superset); recorded in the suite design doc.

### §14.14 Governed analytical caches and generic presentation (v77)

A §14 source may use an internal analytical cache when its declared query workload needs it. This is an implementation detail of `QuerySource`/`RecordSink`, not a new resource primitive, a fourth verb, or a parallel cross-pack API.

**Truth and cache.** User content remains the source's readable, portable local form: Markdown and structured frontmatter for vault-backed sources; the source's declared import or connector representation for external data. A DuckDB file is allowed only for derived, rebuildable analytical state such as large record sets, time-series scans, window functions, and aggregates. It MUST NOT be the canonical store for user-authored content, a pack manifest, credentials, review state, or any data that fails the vim test. If it is deleted or becomes incompatible, the source rebuilds it from already-local portable/raw truth rather than losing user data. Any external acquisition or refresh is a separately advertised, review-governed `produce` operation and is outside the first reference slice.

**Ownership and access.** Each cache belongs to exactly one source owner, which serializes schema changes and writes. Packs, workflows, the PWA, and external agents do not open or mutate a shared `.duckdb` path. They use `describe`, `query`, and `produce` through the `:17873` gate; the owner translates those operations to its truth and optional cache. This preserves one schema/migration owner, capability visibility, audit, review-gated writes, and provenance. Cache placement is kernel-managed beneath the derivative `~/.ctrl/state/` root, with source/domain-separated files when isolation is useful; it is never a pack-owned universal writable database under the user's content tree.

**Descriptor facts.** `describe` is extended, additively and version-negotiated per §14.10, with source-owned facts rather than storage-engine controls:

- `freshness`: observed-at, source-updated-at when available, refresh policy, and stale/degraded state;
- `provenance`: source identity, acquisition or transform summary, and the raw local or connector reference required for drill-down;
- `presentation`: source kind plus generic hints such as records, time series, metric, document, and allowed views;
- `capabilities`: the existing supported operators and `ProduceOp` set, never arbitrary SQL or cache-file access.

The frontend consumes only these facts to select a generic viewer by kind and presentation. A viewer provides freshness and provenance status, filters supported by `describe`, and raw-data drill-down; it does not expose database/table/SQL management or create a pack-specific dashboard. Any future refresh that acquires data or mutates a cache MUST be an explicitly advertised, review-governed `produce` operation; a download is a representation of an existing `query` result, not a new endpoint. Storage stays invisible to the user unless it is needed for a transparency drill-down.

**Reference implementation.** The first implementation slice is `ctrl-stock-cn` only: one source-owned, rebuildable DuckDB cache for its time-series query path, `describe` freshness/provenance facts, and query parity with its portable/raw representation. Record, metric, and document presentation hints, generic viewer selection, refresh, export, and any shared cache infrastructure remain deferred until that vertical proves the contract.

**Locks unchanged.** The five primitives, the three verbs, `:17873` as the cross-boundary gate, local plain-text user truth, and review-gated `produce` remain authoritative. SQLite stays suitable for existing small derived indexes such as FTS and embeddings; this decision selects DuckDB only where a source's analytical workload merits its columnar engine.

### §14.15 Local MCP-backed sources and LibreOffice read-only reference (v78)

A manifest `record_source.query` may select exactly one transport: the existing HTTP `endpoint`, or a private downstream `mcp_tool` supplied by the same installed pack's local server. The latter does not create another gate surface. `McpHost` invokes the tool internally, extracts only the declared row payload, and passes those rows through the same `QuerySource` validation/filter/sort/group engine. `source_describe`, `source_query`, and later `source_produce` remain the only caller-visible operations. The child tool name, bridge address, credentials, and raw application API are never included in `describe` or projected to Irisy.

LibreOffice is the first reference consumer and remains an ADR-005 Companion. Its pack is optional and user-enabled, not a boot-seeded builtin. The v1 child runtime is TypeScript/JavaScript over stdio MCP. A user-installed LibreOffice extension is the only UNO boundary; direct Irisy/HTTP/UNO access and Python MCP bridges are forbidden. The first slice supports only an explicit Writer selection or Calc range. Each returned row carries document identity/type, revision, selection kind, target coordinates, selected content or values/formulas, and a content/range hash. No eligible selection, missing app/extension, incompatible bridge, or lost connection returns a typed unavailable error and no document content.

`produce` is deliberately absent from this slice. A later write amendment must stage exact before/after content, pass ReviewGate, recheck document identity/revision/target/hash immediately before UNO mutation, reject stale state, and reread the native document before reporting success. The LibreOffice document remains truth; CTRL persists no second writable office database.

#### Design Acceptance (non-release)

- [x] The manifest schema can declare one local MCP read tool without exposing a new caller-visible gate tool.
- [x] The generic gate path invokes the downstream tool through the existing `McpHost` and applies the shared query engine to its rows.
- [x] The LibreOffice reference child returns only explicit selected context and fails honestly when its private bridge is unavailable.
- [ ] A real user-installed extension proves Writer or Calc selection reaches the gate with document identity/revision/target/hash and no unrelated content.
- [ ] Writer/Calc writes prove ReviewGate staging, stale-precondition rejection, native mutation, and post-write reread before `produce` is enabled.

## Provenance

- §1 Brain ← orig-003 (Brain Pi sole, 2026-05-30, status proposed → accepted here)
- §2 Capability ← orig-004 §Decision + §9 (10 namespaces / 28 methods, frequency ≥3 + category exception, 2026-05-22 → 2026-05-30)
- §3 Provider — NEW (2026-05-31). Synthesizes orig-004 §9.1 lock list + VMark `ai_provider/` literal port (sink/detection/path_resolver/REST adapters, ISC) + Continue `roles[]` routing primitive (Apache-2.0) + LiteLLM typed fallback chain (MIT). Replaces never-shipped orig-021 "Irisy brain switcher" (which was superseded by §1 Pi singleton).
- §4 Crypto ← orig-007 (vodozemac, 2026-05-16, accepted)
- §5 Subprocess ← orig-012 (portable-pty SubprocessActor, 2026-05-19, accepted)
- §6 MCP bus ← orig-013 (kernel as MCP server, 2026-05-22, accepted)
- §7 Composition ← orig-024 (6-axis manifest, 2026-05-30, status proposed → accepted-at-decision here, implementation deferred per "实施时决")
- §8 Vault — NEW v3 (2026-06-01). Driven by bao session "L1 vault button + vault MD management research + sourcing inbox workflow + 整体一次性 ship". Lock decisions in `vault/ctrl/history/brainstorm/vault-md-management-2026-06-01.md` §10. Feature-layer boundary (Daily Note + Sourcing) aligns with memory `feedback_build_system_not_business`; storage philosophy aligns with `decision_ctrl_obsidian_philosophy` (vim test) + `decision_vmark_not_substrate_use_open_stack` (no VMark sidecar). Wiki-link Tiptap extension ports from seahop/kairo (MIT) — see THIRD_PARTY_LICENSES/kairo-MIT.txt.

## §15 Resource authority — ResourceRef, descriptors, and canonical operations (v83)

### §15.1 ResourceRef grammar and security

`ResourceRef` is the sole cross-module address for a Resource. Its canonical text grammar is:

```text
resource-ref = "ctrl://" authority "/" kind "/" id ["?" revision]
authority    = "local" | "app" | "pack" | "connector"
kind         = 1*( ALPHA | DIGIT | "-" | "_" )
id           = pct-encoded-segment *("/" pct-encoded-segment)
revision     = "rev=" pct-encoded-token
```

The complete UTF-8 text is at most 4096 bytes. `kind` is 1–64 ASCII bytes. `id` contains 1–32 segments; each decoded, NFC-normalized segment is 1–255 UTF-8 bytes. `rev`, when present, is 1–256 UTF-8 bytes after decoding and NFC normalization. Exactly zero or one `?rev=...` query is permitted. Authorities are the four exact lowercase literals above; `kind` remains case-preserving.

Parsing is fail-closed. It rejects empty segments, credentials, unknown authorities, any other or repeated query key, fragments, raw non-ASCII text, controls including NUL, malformed percent escapes, percent-encoded `/` or `\`, decoded `/` or `\`, and decoded `.` or `..` segments. Percent-decoding occurs to bytes before UTF-8 validation. The canonical form decodes RFC 3986 unreserved bytes, NFC-normalizes decoded text, leaves only unreserved bytes literal, and percent-encodes every other UTF-8 byte with uppercase hexadecimal. Consequently canonically equivalent Unicode input has one identity even when the accepted input used a different normalization form or lowercase percent hex.

A ref is an opaque logical address, never an ambient filesystem path or network URL. Resolution occurs only through the one local registry owner for `(authority, kind)`, which applies caller/capability scope and returns typed unavailable or denied errors without leaking hidden paths. Untrusted manifests cannot register `local` or overwrite an existing owner.

Filesystem-backed resolution MUST be race-free from resolve through use. On macOS and Linux, an owner opens its already-authorized root as a directory handle with `O_NOFOLLOW`, traverses each component relative to the current handle with `openat(..., O_NOFOLLOW)` (`O_DIRECTORY` for intermediate components), and checks the actually opened object with `fstat`. Authorization consumes that opened-handle identity and metadata, and subsequent use retains the resulting owned handle; it never reconstructs and reopens a path. On Windows, this implementation slice returns typed `ResourceUnavailable { reason: PlatformPrimitiveUnavailable }` until an equivalent root-relative, no-follow primitive is accepted. No platform may fall back to lexical checks or canonicalize-then-open. Rename, symlink-swap, directory-entry replacement, mount/reparse-point, and root-replacement races must not escape the anchored root or substitute a different object after authorization.

A temporary compatibility alias may map a legacy id to one canonical ResourceRef only when the alias is explicit, collision-free, audited, and bounded to a documented N/N-1 migration window. Aliases never weaken authorization, never appear as a second descriptor owner, and are not accepted for new persisted references. Outside the window the result is typed `ResourceUnavailable { reason: ExpiredAlias }`.

### §15.2 One owner contract, descriptor authority, and registry dispatch

The sole permanent behavioral path is `ResourceRef → ResourceOwner → describe/query/produce`. There is one Resource registry, keyed by `(authority, kind)`; it registers owners, never resource instances. The same selected owner owns identity, revision, provenance, freshness/degradation, presentation, query and produce schemas, secure logical-to-actual resolution, semantic validation, and execution. Production callers invoke `registry.describe/query/produce`; extracting a raw owner is not a normal application path.

A descriptor's JSON Schemas are the sole cross-boundary payload-shape authority. For each invocation the registry binds one owner and one descriptor snapshot, verifies descriptor identity, applies coarse caller/capability policy, validates the untrusted request or operation against that snapshot, and dispatches to the same owner. The owner then deserializes the validated value into its private typed model, authorizes the actual resolved object, and executes. Schema validation never replaces capability or actual-handle authorization. A changed descriptor/schema revision yields typed conflict and retry rather than execution under mixed semantics. Descriptors contain references and schemas, never secrets or raw private content.

`QuerySource`, `RecordSink`, `ProduceOp`, source profiles, and namespaced tools are migration adapters only. They may be called inside a migrating ResourceOwner but are not parallel registries, public kernel contracts, or extension points; new Resource kinds do not extend them, and each retires when its owners migrate. `ctrl://local/system/catalog` is an ordinary system Resource used to discover canonical refs. It is neither the owner registry nor an authorization prerequisite; a caller that already holds a ref addresses it directly.

The first canonical vertical is one Markdown note such as `ctrl://local/note/daily/2026-08-05.md`. The note owner resolves and reads it through §15.1 stable handles and describes `text/markdown` plus revision and schemas.

**Markdown note write contract (v87).** That owner may now advertise exactly one bounded produce operation, `replace_content`, whose input requires the caller's `expected_revision` alongside the new content. Every clause below is a precondition of the write, not advice:

1. **Staging before authorization.** The owner stages the change and returns §15.5 Outcome facts — target, before/after, and the revision precondition — before any approval is requested. An operation that cannot be staged is not eligible for review.
2. **Revision precondition, rechecked at commit.** The staged revision is verified again immediately before mutation through a freshly resolved stable handle. A moved revision returns typed `Feedback` with a precondition code and `retryable: true`; nothing is written.
3. **Write recovery point.** The previous bytes are durably captured outside the user's content tree, beneath the kernel-managed derivative state root, before the file is modified. A recovery point that cannot be written aborts the operation.
4. **Atomic commit.** The new content is written to a temporary sibling, flushed, and renamed over the target so a reader never observes a partial file.
5. **Post-write reread.** The owner reopens the note through a stable handle and compares the actual committed revision against the expected one. Success is reported only from that observed state; `effect.verified_by` names the check performed.
6. **Partial failure and rollback.** If the reread does not match, the owner restores the recovery point, reports typed `Feedback` describing the rollback, and does not claim success. If restoration itself fails, the failure is reported as non-retryable with the recovery point's location so the data is recoverable by hand.

7. **Serialized per resource.** The recheck, commit, reread, and any rollback are one critical section for that ref. Two writers that both passed the recheck would otherwise interleave, and the loser's rollback would revert content the winner already reported as verified.
8. **No-follow staging.** The temporary sibling uses a unique name and is created with exclusive, no-follow semantics, so a pre-planted link or file cannot redirect the write outside the authorized root or be shared with another writer. Every staging failure unlinks the temporary file, so one interrupted write cannot leave a leftover that blocks all later writes to that note.

Clause 7's serialization registry is process-wide and keyed by vault-relative file identity, not by ResourceRef text: a revision-pinned and an unpinned ref address the same file, and a legacy bespoke vault write must serialize against a canonical `produce` on that file rather than holding a separate lock.

Scope is deliberately narrow: one whole-note replacement on one local Markdown file. Partial-range writes, multi-file transactions, external application writes, and durable `OperationRef` effects remain out of scope and unsupported. Other Resource kinds continue to return structured unsupported until their own owners meet this same list.

The exact agent-facing surface is:

```text
describe(ref)
query(ref, request)
produce(ref, operation)
```

These signatures are canonical. MCP is a thin transport binding; it cannot rename the verbs, add per-kind equivalents, or expose a parallel raw downstream surface. `query` is read-only. Every supported mutation/effect goes through `produce` and ReviewGate according to policy. All cross-domain calls pass through `:17873`; internal execution remains on the five locked primitives.

### §15.3 OperationRef lifecycle

A non-immediate `produce` returns an `OperationRef` containing an opaque operation id, canonical ResourceRef, operation kind, idempotency key, created time, state, and descriptor-declared retention/expiry facts. The owner persists enough state to provide these guarantees:

- **Idempotency:** the same authorized idempotency key and semantically identical request resolves to the same operation/result; conflicting reuse fails typed and never executes twice.
- **Response-loss retry:** after timeout or lost response, the caller retries with the same idempotency key and receives the existing OperationRef or terminal result.
- **Retention/expiry:** terminal results remain queryable for the descriptor-declared bounded retention window. After expiry, lookup returns typed `OperationUnavailable { reason: Expired, operation_id, retryable: false }`, never a fabricated unknown result.
- **Restart recovery:** in-flight durable operations are recovered from owner state after restart and continue or reach a truthful terminal state. If the operation is intrinsically non-recoverable, the descriptor declares that before execution and restart yields typed `OperationUnavailable { reason: RestartRecoveryUnsupported, ... }`.
- **Unavailable owner:** missing pack, disconnected application, revoked capability, or incompatible operation version returns typed unavailable with reason and retryability. It does not silently create a replacement operation.

Operation status and progress are queried through the addressed Resource contract (including `query(..., { watch: true })` when supported); there is no bespoke job API.

### §15.4 FCT projection and Skill boundary

A Skill is a local plain-text `SKILL.md` playbook and remains an internal method authority. It may be returned as the optional `skill_id` of a selected FCT projection and guide how canonical operations are chosen. It is not a parallel user-facing reusable-unit noun or Library shelf. A Skill never spawns, owns, resumes, forks, or persists a session; never owns a transcript, Resource, capability, credential, operation, or ReviewGate decision; and never implies that a required package is installed. Session ownership remains ADR-005.

A selected FCT is resolved before turn assembly through the canonical system catalog Resource, `query(ctrl://local/system/catalog, { ref, operation: "selection-projection" })`, or its exact in-process ResourceOwner equivalent. Stable FCT refs are unversioned and resolve against current local truth on every turn. The result contains canonical dependency ResourceRefs, optional `skill_id`, an enforceable gate scope, policy facts, and install state/reference. Work/session-owned explicit Resources always remain; FCT dependency Resources append in deterministic order and deduplicate by canonical ref, and an FCT can never replace the user's current content. A zero-Resource projection is valid only when it changes the optional Skill or enforceable gate scope.

The projected gate scope is authorization input, not prompt-only metadata: it constrains both `:17873` tool visibility and invocation for that turn, derived least-privilege from existing manifest capability/tool facts and current policy. Resolution is read-only and does not bypass registry or gate authorization. The catalog remains discovery, not dispatch or authorization.

Selection is persisted as one stable FCT ref on the canonical Irisy session, never as duplicated expanded facts. The obsolete global raw-Skill pin is discarded during migration; sessions start at Auto rather than guessing ownership. Package updates are observed by live resolution. If a selected FCT is removed, stale, or no longer authorized, the UI reports that failure once, clears that session to Auto, resets the runtime owner, and does not send the turn under stale or silently widened context.

#### §15.4.1 Capability availability is user-owned state (v88)

`installed` was the only state an installed capability could reach, so the only way to stop one being offered was to uninstall it — discarding its files and local configuration to express a preference. Availability is therefore accepted as a third state distinct from installed and uninstalled.

The state is a per-ref enable flag owned by the user and stored as plain text at `~/.ctrl/capabilities.toml` as a list of disabled refs. It is not a new registry, primitive, identity, or authorization axis: it narrows what the existing catalogue offers. Plain text is binding rather than incidental — the user must be able to read why a capability stopped appearing and re-enable it with an ordinary editor when the app will not start.

Rules, all binding:

1. **The catalogue Resource owns it.** `enable` and `disable` are bounded `produce` operations on `ctrl://local/system/catalog`, returning §15.5 Outcome facts with the availability before/after as the staged change. Install and uninstall keep their existing surface; adding them here would create a second surface for the same act.
2. **Disabled is still installed.** A disabled capability remains listed with its owner shown, so it can be found and re-enabled. Disabling never deletes files, configuration, or credentials, and re-enabling requires no reinstall.
3. **Disabled is not selectable.** The catalogue reports it as unselectable AND refuses to project it, so a stale caller-held ref cannot bypass the state.
4. **Unreadable state fails closed.** A present but malformed state file is reported as owner-unavailable rather than treated as "nothing disabled", because silently re-offering a capability the user turned off is the worse failure.
5. **Availability is a privilege change.** An external caller's request is review-eligible, and the owner stages before committing so the reviewer sees which capability and which direction.
6. **Verified, not assumed.** The state file is rewritten atomically and reread before the Outcome reports success, per §15.5.2.
7. **Ownership is stated, not implied.** A management surface names what owns each capability (installed package, local Skill) so removal is never a guess about what will be deleted.

8. **Ownership is reachable, by ref.** Showing a capability's own files in the OS file manager is a Tauri shell/OS command, not a gate tool, because it is a user action on their own machine rather than a capability an agent should hold. It is addressed by capability ref, never by path: the kernel resolves `pack:<id>` and `skill:<name>` beneath their install roots, refuses a ref that is not a single directory segment, and refuses a target that canonicalizes outside its root.

## §15.5 Outcome — owners return typed results, not strings (v86)

An operation's result is a typed, owner-produced `Outcome`. This closes the gap that made every consequential surface improvise: the canonical three-verb path already returns structured errors, while roughly a hundred remaining tools collapse typed failures with `e.to_string()`, so a caller receives one human sentence and can only reprint it. `Feedback` has been accepted since §14.11 and defined in code with `code`/`severity`/`field`/`retryable`/`details`, yet it has no production producer. Presentation cannot be richer than the facts it is given, so this is a fact-owner obligation, not a frontend concern.

### §15.5.1 Shape

An Outcome carries, as applicable to the addressed Resource and operation:

- **target** — the exact object acted on, expressed as a canonical ref plus owner-meaningful coordinates. Never a filesystem path or owner internal.
- **staged** — the proposed `before`/`after` representation when a mutation is proposed but not yet committed.
- **precondition** — the revision, hash, or equivalent identity the operation depends on.
- **provenance** — source identity plus the raw-input and transformed-output references required for drill-down.
- **effect** — for a committed mutation, what became true, plus the post-commit verification the owner performed.
- **feedback** — on rejection, degradation, or failure, the existing `Feedback` including `retryable` and any correction.

An Outcome is descriptor-typed like any other payload: the owner declares its schema, and the registry validates against one descriptor snapshot. It introduces no new verb, primitive, transport, registry, or authorization axis.

### §15.5.2 Rules

An owner MUST NOT reduce a typed failure to a message string at a boundary. Converting an owner error into a transport error message discards `code`, `retryable`, `reason`, field identity, and correction, and is a defect in the change that introduces it. Existing string-flattened tools are declared debt and are tracked by a non-decreasing ratchet.

Success requires evidence. A mutation Outcome may report success only after the owner has verified the committed state; an owner that cannot verify reports degradation truthfully rather than optimistically.

A caller may render an Outcome, but never invent one. No surface may synthesize a target, staged change, precondition, or effect the owner did not supply, and no surface may present a caller's or model's prose as an Outcome fact.

### §15.5.3 ReviewGate requests derive from the prepared Outcome

A review request for a canonical `produce` MUST be built from the prepared operation's Outcome facts — target, staged before/after, and precondition — not from the tool name plus an argument summary. The current request carries only caller, tool, and argument summary, which is why an approval surface cannot state what will change; that is a fact deficit here, not a presentation choice.

The existing security properties are unchanged and remain binding: the request is gate-derived, never caller or model prose; approval travels a surface the requesting caller cannot reach; and no downstream server, extension, or Skill may self-approve. Enriched facts widen what the human sees, never who may decide.

The first implementation vertical is one Markdown note write: staged before/after, revision precondition, review, commit, and post-write reread carried in one Outcome. Broader migration follows per owner.

## §17.6 Every domain needs a verifiable pipeline (v86)

A capability domain is claimed only when an executable pipeline proves it. For each domain in §17.1 the evidence is a named, runnable path establishing: which tools classify into it, that a scope granting it admits exactly those and no others, that a scope omitting it denies them at both visibility and invocation, and that any owner requiring it as capability scope enforces that requirement. Domains consumed owner-side rather than by tool classification, such as `project`, are proven through their owner's authorization path.

A domain without such evidence is `declared`, not `verified`, and must be reported that way rather than assumed. The evidence set is generated from the real owners, never hand-maintained in parallel.

## §16 One local FCT discovery registry (migrated from ADR-007 v3; amended v84)

CTRL has one hot-scanned local registry for the existing installed package manifests, local Skills, capability descriptors, provider results, and install references. The registry exposes one normalized product projection:

```text
FctItem {
  ref: "pack:<id>" | "skill:<name>",
  name,
  summary,
  source_kind,
  install_state,
  selection_kind
}
```

This is an in-memory/adapted view of the existing authorities, never a second persisted registry or cache. Filesystem changes become visible on the next scan without a restart. Library, Irisy conversational discovery, gate discovery tools, FCT resolution, and internal Skill pin resolution consume this same registry. No shadow knowledge-base index, provider-specific search store, raw-Skill shelf, pack shelf, or second discovery registry is permitted.

External sources enter through normalized provider adapters. Every adapter maps provider data into the bounded FCT envelope while preserving internal source identity/kind, name, summary, provenance URL, install reference, compatibility facts, and availability. Raw provider JSON and provider credentials never become the registry contract. Deduplication resolves aliases to one canonical namespaced FCT ref while retaining source provenance; package/Skill name collisions cannot collapse because their ref namespaces differ.

Public local install is anonymous: the kernel fetches a user-selected public install reference, validates redirects/scheme/size/integrity/manifest policy, stages it, validates it, and atomically installs into the owner directory. A GitHub account or cloud service is not required. An optional developer GitHub PAT may enable direct code-search during development or advanced use; it is stored only in the OS keychain, never in manifests, logs, prompts, registry records, or install URLs. Install execution always remains local even when search results came from cloud augmentation.

`ctrl-cloud` is an optional normalized search adapter governed by ADR-006 v13. If unavailable, the hot-scanned local registry, installed descriptors, explicit public install references, and anonymous local install continue to work.

## §17 Capability domain registry — the sole enumerated capability authority (v85)

This section is the sole accepted enumeration of CTRL's capability domains. Before v85 the enumeration existed only in `src-tauri/src/kernel/visibility.rs`, so the vocabulary that authorizes every cross-domain call had no owning decision. That code is now an implementation of this registry, not its authority.

A capability domain is an authorization unit, not a product shelf, a user-visible menu, a tool namespace, a Resource kind, or an FCT. It answers exactly one question: which existing capability surface may a caller see and invoke for this turn.

### §17.1 The registry

`system` is always visible and cannot be scoped away. The remaining domains are grants.

A domain is consumed in two distinct places, and both are load-bearing. Most domains gate the visible/callable tool surface by classifying tool names. A domain may also be consumed owner-side: it is passed to the selected ResourceOwner as capability scope, and that owner may require it before resolving a ref. `project` is the current owner-side-only case — no tool name classifies into it, yet the Project Resource owner denies access without it. Absence of a tool prefix therefore does not mean a domain is dead, and a domain may not be removed on tool-classification evidence alone.

| Domain | Authorizes | Notes |
|---|---|---|
| `system` | kernel status, vault root, and the three canonical verbs | always on; never scoped away |
| `vault` | vault file read/write/search/index/graph surface | largest domain; per-Resource authorization still applies |
| `notes` | note map/get/periodic/history/open and doc block/frontmatter operations | includes `note_`, `notes_`, `doc_` |
| `smart_table` | record grid describe/query/produce surface | |
| `tasks` | inline checkbox task records | |
| `calendar` | note-per-event calendar records | |
| `source` | generic installed-connector describe/query/produce | grant must be narrowed per source; see §17.5 |
| `project` | explicit Project Resource operations | owner-side scope only; no tool prefix classifies into it |
| `providers` | provider catalogue and binding reads | credentials never included |
| `registry` | installed capability descriptor reads | |
| `kv` | small internal key/value state | not a user data store |
| `llm` | direct completion calls | |
| `memory` | Irisy persistent-memory read/write | |
| `mcp` | installed package lifecycle and every downstream `<server>_<tool>` | source-aware classification is mandatory |
| `market` | fixed market-data endpoints | cannot reach an arbitrary URL |
| `websearch` | fixed search backends | exact-match only; never a raw fetch |
| `discover` | fixed capability-catalog backends | |
| `skill` | read-only local `SKILL.md` listing and reading | method text only |
| `diagnostics` | read-only metadata diagnostics | capture/export stay off the agent surface |
| `net` | raw outbound HTTP | excluded from every default grant |

### §17.2 Rules

This registry is amendable, never frozen, but it is not amendable unilaterally. Adding, renaming, merging, removing, or rescoping a domain requires explicit discussion with bao and bao's decision first; only then is the section amended. An agent, reviewer, implementation convenience, or code-side refactor may propose a change and must present the evidence for it, but may not enact one, and may not introduce a domain in code ahead of the decision. Silent divergence between this table and the implementation is a defect in the change, not an acceptable interim state.

Adding, renaming, merging, or removing a domain requires an amendment to this section in the same change as the code. A tool must classify into exactly one domain, and a tool whose name cannot be classified defaults to `mcp` rather than to a first-party domain. Any tool reachable through an installed downstream server is `mcp` regardless of name collision.

`net` must never enter a default grant. A domain that reaches the network must either be restricted to fixed, non-user-supplied endpoints or remain in `net`. An exact `tool:<name>` grant authorizes one tool and never implies its domain or a sibling tool.

Absent caller scope resolves to a declared default, never to the full surface. First-party in-app callers receive the first-party default set; every other caller receives `system` only.

### §17.3 Relationship to other authority

Domains authorize; they do not enumerate product capability. The agent-facing surface remains exactly `describe`, `query`, and `produce` (§15.2). FCT selection projects a least-privilege subset of this registry plus exact tool grants (§15.4). ADR-010 § trust-domains owns where enforcement happens; this section owns what the vocabulary is. ADR-005 owns which user intents CTRL serves and maps each intent to domains from this table.

### §17.4 Declared limits

Domain grants do not by themselves bound Resource-level reach. `describe`, `query`, and `produce` are always-on `system` tools by construction, so tool-surface scoping never decides which refs a caller may address. Domain scope bounds which *tool surface* is visible and callable, and additionally supplies owner-side capability scope; §15.2 descriptor binding plus the selected owner's actual-object authorization is the real control for Resource content, and §15.4 exact `tool:<name>` grants narrow a specific downstream capability. An owner that requires a domain (such as the Project owner requiring `project`) enforces it itself; an owner that requires none is reachable through the always-on verbs alone. Reading §17.2 as complete least-privilege for user data would be wrong.

Owner-side capability scope is currently **caller-declared**: a caller's `X-Ctrl-Intent` supplies the scope the gate forwards to the selected owner, and its `X-Ctrl-Caller` decides whether the review path applies at all. On loopback behind a per-boot bearer that is the accepted trust model, with domain scoping as defense in depth rather than the primary control. It is recorded here because that model now gates a real mutation (§15.2 v87): an owner MUST NOT treat declared scope as proof of user intent, and any future non-loopback or multi-principal caller requires an accepted binding of scope to an authenticated principal before it may write.

### §17.5 Per-source authorization is required for `source`

A whole-domain `source` grant is insufficient. Granting `source` today authorizes every installed connector at once, so authorizing one application silently authorizes all of them. That contradicts least privilege and contradicts the product promise that connecting one application has a bounded scope.

A `source` grant MUST therefore be narrowed to explicit source identities. The mechanism is the existing exact-grant shape from §15.4, not a new registry or a second authorization axis: an FCT projection emits `source:<id>` entries, the gate authorizes a connector operation only when the addressed `source_id` is named, and a bare `source` domain grant authorizes no connector. `source:<id>` never implies a sibling source, never implies `mcp`, and never widens to raw downstream tools.

**Implemented (v89).** The narrowing is enforced at the gate's single visibility decision rather than inside each connector verb: a scoped caller reaches `source_describe`/`source_query`/`source_produce` under the `source` domain, but the ADDRESSED `source_id` must be named as `source:<id>` or the call is denied. A connector verb whose `source_id` is absent or blank is denied too, because an unaddressed call cannot be narrowed and allowing it would reopen the whole-domain hole. `source:<id>` is parsed as narrowing, not as a domain token, so it never opens `mcp` and never grants a sibling, prefix, or suffix relative. An unscoped in-process intent still reaches connectors, since it has no external caller to narrow. First-party callers are not exempt: the PWA's default scope holds the `source` domain and therefore names no connector, so its own connector reads declare `source:<id>` through the gate bridge's intent argument.

## Design Acceptance (non-release, v90 record writes)

- [x] A note's tasks, one calendar event, and a smart table's cells are each a canonical Resource whose only write is one bounded field change. (`src-tauri/src/kernel/task_resource.rs` 12 tests; `calendar_resource.rs` 11 tests; `table_resource.rs` 10 tests)
- [x] Each write stages the real before/after of the field it changes, so a review request never has to name a tool instead. (`staging_reports_the_field_before_and_after_without_writing` in all three)
- [x] A stale revision writes nothing and reports both revisions as a retryable conflict, which is what catches a task line or table row that has moved. (`a_stale_revision_writes_nothing_and_reports_the_current_one` in all three)
- [x] Success is reported only from a post-write reread; a write that does not read back as asked is undone and reported as a rollback, and a rollback that itself failed is reported as not retryable and names its recovery point. (`record_write.rs` — `a_rollback_distinguishes_restored_from_not_restored`; `task_resource.rs` — `a_write_that_does_not_read_back_is_rolled_back_and_reported`)
- [x] The previous bytes are captured beneath the kernel derivative state root before the source is touched, and a recovery point that cannot be written aborts the operation. Its key includes the content root, since a ResourceRef names a note relative to one and the capture truncates. It is discarded once the write verifies, so copies of user content do not accumulate outside the content tree. (`record_write::RecoveryPoint`; `two_roots_holding_the_same_relative_note_get_separate_recovery_points`, `a_discarded_recovery_point_leaves_nothing_behind`)
- [x] The undo restores the exact bytes that were read, so a rollback does not reformat frontmatter comments or key order. (`kernel::vault::restore_raw`; `task_resource.rs` — `a_rollback_restores_a_note_with_frontmatter_byte_for_byte`)
- [x] Verification compares the reread against the value the source stores, not against the caller's raw request, so a write the source legitimately normalizes is not reported as a failure. That operand is computed by actually storing the value — apply, render, parse back — rather than by restating the normalization rules, which is what makes it unable to drift from the store. (`tasks_source::normalized_field_value`, `calendar_source::normalized_field_value`, `SmartTable::normalized_cell_value`; `the_normalized_value_is_what_update_actually_stores`, `a_multi_tag_write_verifies_instead_of_rolling_back`, `a_status_synonym_verifies_instead_of_rolling_back`)
- [x] A value the format cannot hold is refused before anything is written, rather than written and rolled back. A checkbox line and a table row are both single lines with delimited parts, so a value carrying a delimiter or a newline would silently land in a neighbouring field. (`a_value_that_cannot_be_stored_is_refused_before_anything_is_written`, `a_value_that_would_break_the_row_is_refused_before_anything_is_written`)
- [x] Staging shows the value as it will be stored, so a reviewer approves what actually lands. (`staging_shows_the_value_as_it_will_be_stored`, `a_padded_value_stages_and_verifies_as_its_stored_form`)
- [x] A one-field change touches one line: `tasks_source` writes through `vault::write_body` and edits the addressed line in place rather than splitting and rejoining the body, so the frontmatter keeps its bytes, a plain note gains no block, and every untouched line keeps its own terminator — including in a note that mixes them. (`a_field_change_leaves_the_frontmatter_bytes_untouched`, `a_plain_note_does_not_gain_a_frontmatter_block`, `a_crlf_note_with_frontmatter_changes_only_the_addressed_line`, `a_note_with_mixed_line_endings_keeps_each_line_as_it_was`)
- [x] A note that is not there is reported as missing rather than as a retryable outage, so a caller is not told to keep asking for something that does not exist. (`task_resource::read`)
- [x] The operation schema states the shapes each field accepts, so a plausible value does not have to be discovered through a conflict. (`value.description` in the task and calendar descriptors)
- [x] The stale-precondition reply, the unverified reply, and the empty-field rendering are defined once for all record writes rather than copied per owner. (`src-tauri/src/kernel/record_write.rs`; `packages/ctrl-web/src/lib/record-write.ts`)
- [x] Each owner reuses its source's existing validator and writer rather than adding a second one that could disagree with what the reader reads back. (`tasks_source::update`; `CalendarSource::produce`; `SmartTable::produce`)
- [x] Every vault note write is a rename over a flushed temp sibling, so clause 4 holds for each of those reused writers instead of only for the owners that reimplement it. The staging name is unique and opened `O_EXCL | O_NOFOLLOW`, so a planted symlink cannot capture the write, and the note's permissions survive the replace. (`kernel::vault::write_atomically`; `a_write_leaves_no_temporary_sibling_and_never_lists_one`, `a_planted_link_at_the_staging_name_cannot_capture_the_write`, `a_replace_preserves_the_notes_permissions`)
- [x] A revision-pinned ref verifies its own write. The reread goes through an unpinned ref, since the write moves the revision off the caller's pin by definition and rereading through it would report a landed write as unverified. (`task_resource.rs` — `a_revision_pinned_ref_still_verifies_its_own_write`)
- [x] A commit that fails is reported as a retryable owner outage rather than as a bad argument, and leaves no recovery copy, since the source was never modified. The copy's lifetime is enforced by `Drop` rather than by each path remembering, because the paths that must clean up are the error paths. (`a_commit_failure_is_reported_as_unavailable_and_leaves_no_copy`; `record_write::RecoveryPoint`)
- [ ] Exercise the branch where the post-write reread itself fails. It reports written-but-unverified, keeps the recovery point, and names it; forcing the failure needs filesystem injection the owners do not have.
- [x] A surface reads the typed Outcome and distinguishes verified, conflict, and failed. (`packages/ctrl-web/e2e/today.spec.ts` — conflict shows both revisions and the task stays open)
- [ ] Cover the smart-table cell edit at the UI level. Its wire contract is verified (`packages/ctrl-web/src/lib/record-write.test.ts`) but the grid renders to a canvas, so there is no DOM cell for a browser test to drive; a record-card view harness is the likely route.
- [ ] Give an event a first-party editing surface. The canonical write exists and is exercised, but today an event field is changed through the assistant rather than from the schedule.
- [ ] Bring smart-table column operations (add, retype, drop) onto the canonical verb. They still use the bespoke tool, which owns the in-place frontmatter `schema` patch; a canonical form needs its own staged shape for a schema change.

## Design Acceptance (non-release, v88 availability state)

- [x] Prove a disabled capability stays installed and listed, is refused by `selection-projection`, and re-enables without reinstalling. (`src-tauri/src/kernel/fct_catalog.rs` — `disabling_reports_a_verified_state_change_and_stops_selection`, `enabling_restores_selection_without_reinstalling`)
- [x] Prove the state file is plain text, atomically rewritten, and that a malformed file fails closed instead of reading as "nothing disabled". (`src-tauri/src/kernel/capability_state.rs`; `an_unreadable_state_file_fails_closed_rather_than_re_enabling`)
- [x] Prove `enable`/`disable` stage before committing and report success only from a reread. (`a_staged_change_carries_the_facts_a_reviewer_needs`; `effect.verified_by` assertions)
- [x] Prove the management surface states each capability's owner and offers disable for Skills, which have no removal path. (`packages/ctrl-web/e2e/capability-manage.spec.ts`)
- [x] Prove reveal is ref-addressed and refuses traversal or an out-of-root target. (`src-tauri/src/commands/system.rs` — `a_traversing_ref_is_refused_before_any_filesystem_use`; `ownership can be opened, addressed by ref rather than by path`)
- [ ] Exercise the availability change over the wire as an external caller so the review-eligible path is covered, not only the in-process owner. Blocked by `ReviewGate::enforcing()` returning false under `cfg!(test)`.

## Design Acceptance (non-release, v85 migration)

- [ ] Prove the implemented domain vocabulary equals §17.1 with no code-only domain and no unclassifiable first-party tool.
- [ ] Prove `net` is absent from every default grant and that each network-capable domain is endpoint-restricted.
- [ ] Implement §17.5 `source:<id>` narrowing and prove a grant for one connector authorizes no other installed connector, no sibling source, and no raw downstream tool.
- [ ] Land the §15.5 Outcome envelope on one real mutation vertical with staged/precondition/effect and post-commit verification evidence.
- [ ] Prove a ReviewGate request for canonical `produce` carries §15.5.3 target, staged before/after, and precondition, with the existing gate-derived and non-self-approval properties intact.
- [ ] Publish the §17.6 per-domain pipeline evidence, generated from real owners, and mark each domain `verified` or `declared`.
- [ ] Establish a non-decreasing ratchet over boundary error-string flattening and reduce it as owners adopt `Feedback`.

## Design Acceptance (non-release, v84 migration)

- [ ] Inventory every live bespoke resource/job endpoint and map it to a canonical ResourceRef owner plus `describe(ref)` / `query(ref, request)` / `produce(ref, operation)`.
- [ ] Publish conformance fixtures for ResourceRef parse rejection, canonicalization, alias expiry, owner collision, scope-preserving resolution, and stable-handle/no-follow race faults (symlink swap, rename, entry/root replacement).
- [ ] Demonstrate response-loss retry, idempotency conflict, retention expiry, restart recovery, and typed unavailable behavior for at least one durable Effect owner.
- [ ] Prove Library, Irisy, gate discovery, FCT selection resolution, and internal pinned-Skill resolution observe the same hot-scanned local registry projection with no second index.
- [ ] Prove anonymous public install works with `ctrl-cloud` disabled and no developer PAT.

These are migration/design acceptance criteria, not release-completion claims. Existing implementations may drift until Track implementation work closes them with fresh evidence.
