# CTRL Development Contract

## Goal and Authority

CTRL is an AI-native ambient workbench and creator substrate. The active goal is `vault/ctrl/GOAL.md`.

Before evaluating, designing, or changing a module, read:

1. `vault/ctrl/adrs/INDEX.md` and `vault/ctrl/adrs/001-spine.md`.
2. The owning module ADR.
3. Relevant strategy or research documents only as non-authoritative context.

The module ADR corpus is the sole architectural authority. If ADRs conflict, implementation drifts, or a decision is absent, ask bao. Never silently promote a strategy note over an accepted ADR or invent or downgrade a decision.

## Hard Rules

- All source code, comments, UI copy, errors, API responses, and configuration literals are English. Chinese is allowed in Markdown documentation and conversation.
- CTRL core follows AGPL-3.0 open-core policy; shareable `ctrl-<name>` capability packs use MIT.
- Never run local `wrangler dev`, bypass hooks with `--no-verify`, perform cross-D1 joins, or hardcode or log secrets.
- Preserve `Cargo.lock` and `package-lock.json` when inputs change.
- Five kernel primitives—Actor, Capability, Event, Channel, Effect—are architecture locks.
- Non-trivial code must cite its governing decision as `(ADR-NNN module § section vN)`.
- Keep one source of truth per concept. When a replacement becomes authoritative, retire or clearly archive its predecessor in the same change; never leave two live authorities.
- ADRs and implementation must not drift: stop and ask bao before amending a lock point, and amend an accepted decision before implementing a conflicting design.
- If an instruction or governing decision is ambiguous, ask bao rather than guessing.
- After every write, confirm the file changed using Git status, diff, grep, or reread.

## Design Philosophy

- **System design first.** Establish boundaries, responsibilities, state flow, or layout grid before implementation. Debugging, logs, tests, and screenshots verify a design; they do not create it.
- **Plain text first.** Local files are truth and cloud data is a mirror. User content remains readable Markdown/YAML/TOML/JSON with structured frontmatter and no export lock-in. VMark and Obsidian are compatibility commitments, not dependencies.
- **Vim test.** If ordinary tools cannot recover a capability's core value from local files, redesign it.

Derived rules for product and code:

1. **Local is truth; cloud is mirror.** Read locally, make local writes immediately visible, and synchronize asynchronously. Cloud unavailability must degrade gracefully rather than hard-fail.
2. **Endpoint-first.** OAuth uses a local loopback callback, credentials stay in the OS keychain, and local indexing/processing is preferred. `ctrl-cloud` augments the product; it is not a runtime dependency.
3. **Ctrl-key is the primary entry.** Render content by type, not source platform.
4. **One-shot, not flows.** One MCP is one atomic action, not a wizard or workflow editor.
5. **AI is a pipe, not a sidebar.** Apply AI inline where useful rather than making chat the product shell.
6. **Transparency by drill-down.** Preserve access to raw input, transformed content, and local output.
7. **Two brain paths, one gate.** Irisy uses bundled Hermes; BYO-CLI projects assets to a user-selected CLI. Both return tool calls through `:17873`; CTRL does not duplicate or supervise the BYO-CLI agent loop. Skills currently use gate tools, while direct skill projection remains future work.

MCP, API, and Skills are complementary capability faces. We sell tools and platform, not models.

## Product Boundaries

CTRL is not a workflow editor, hardware project, hardcoded long-tail connector collection, Quicker clone, ChatGPT-GPT integration, shared mamamiya data plane, or multi-tenant SaaS. Prefer generic capability mechanisms and the user's existing applications over rebuilding them inside CTRL.

## Minimal Development Loop

Only durable outputs matter: ADR, code, and PR. Do not revive Olym fleet, lane, handoff, persona orchestration, or intermediate governance churn.

For non-trivial work:

1. Read `vault/ctrl/GOAL.md`; do not invent a missing goal.
2. Read the owning ADR before assessment or implementation.
3. Establish the global plan, then make the smallest coherent change.
4. Debug from evidence and root cause; do not stack speculative fixes.
5. Verify the affected compiler/type check, targeted tests, runtime smoke, and UI behavior as applicable.
6. Use an independent reviewer for non-trivial changes.
7. Review final Git status/diff before any completion claim.

No completion, commit, push, or PR claim without fresh evidence for the concrete acceptance criteria.

## Git

Use focused `feat/...`, `fix/...`, or `chore/...` branches, Conventional Commits, reviewed PRs, and squash merge to `main`. Never force-push `main`. Do not create commits unless the user explicitly requests one.
