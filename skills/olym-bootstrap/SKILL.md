---
name: olym-bootstrap
description: Install Olym into a fresh consumer project. Use when the user says "olym init", "在新项目装 olym", "bootstrap olym for this repo", or starts a new project that should adopt the Olym fleet protocol. Pre-flight checks + generate consumer config + verify gates + print onboard summary. Does NOT mutate framework files (.olym/ stays vendored).
---

# Olym Bootstrap — Install Into a Fresh Consumer

Onboard a new project onto the Olym dev OS. This skill walks the same path as `scripts/olym-install.sh` but works without that script being already present.

## When to activate

- User says "olym init [name]" / "在新项目装 olym" / "bootstrap olym" / "start a new project with olym"
- A repo has `.olym/` vendored but no `CLAUDE.md` / `MEMORY.md` / `lane-ownership.yaml` yet
- The `/olym-init` slash command was invoked

## Pre-flight checks (all must pass before anything is written)

```bash
git rev-parse --is-inside-work-tree    # MUST be a git repo
ls .olym                                # MUST exist (vendor from olym source first)
```

If `.olym/` is missing → STOP. The user needs to:
- Copy from olym source repo: `cp -r /path/to/olym-source/.olym ./`
- OR copy the template: `cp -r /path/to/olym-source/.olym/templates/olympus-fleet-bootstrap/ .olym/templates/olympus-fleet-bootstrap/` and tell Claude to bootstrap from the template

For non-monorepo projects (no `packages/olym-core/`), proceed anyway — that hard-die in `olym-install.sh:54` is a known limitation; the framework's protocol layer works fine without the npm packages.

## Configuration interview

Ask the user (1-2 questions, not 10):

1. **Consumer project name** (kebab-case, e.g. `my-store`, `panda-gooo`) — required
2. **Use default 4-lane fleet (athena/daedalus/apollo/hephaestus over admin/creator/marketing/infra)?**
   - **Yes** → use defaults, proceed
   - **No** → ask 4 quick questions: for each lane, persona name + business domain + tech specialty

If the user is solo + AI-driven (typical Olym setup), default 4-lane is fine — they can edit `lane-ownership.yaml` later.

## Files to generate (idempotent — skip if exists)

### 1. `.olym/steering/lane-ownership.yaml`

```yaml
consumer: <name>
generated_at: <ISO timestamp>
fleet:
  - persona: zeus
    role: orchestrator
    lane: cross-cutting
    tech: identity/knowledge/protocol
  - persona: athena       # OR custom
    role: owner-1
    lane: admin           # OR custom
    tech: backend         # OR custom
  - persona: daedalus
    role: owner-2
    lane: creator
    tech: frontend
  - persona: apollo
    role: owner-3
    lane: marketing
    tech: database
  - persona: hephaestus
    role: owner-4
    lane: infra
    tech: infra
reserved_slots:
  - owner-5
  - owner-6
```

### 2. `CLAUDE.md` (project root)

```markdown
# <consumer-name>

> Framework: see [.olym/CLAUDE.md](./.olym/CLAUDE.md) for shared conventions.
> Dev guide: `.olym/skills/dev-env/SKILL.md` (if present)

## Rules
<!-- TODO: project-specific hard rules -->

## Design Philosophy
<!-- TODO: project-specific philosophy. Conflict order: hard rules > philosophy > implementation -->

## Olympus (Multi-agent Fleet)
- @zeus — orchestrator + cross-cutting
- @<persona-1> — (<lane>, <tech>)
- @<persona-2> — (<lane>, <tech>)
- @<persona-3> — (<lane>, <tech>)
- @<persona-4> — (<lane>, <tech>)

## Architecture
<!-- TODO -->

## Key Standards
<!-- TODO -->
```

### 3. `MEMORY.md` (project root)

```markdown
# Memory · <consumer-name>

> Quick-context memory. Auto-injected each session. **Hard cap ≤180 lines.**
> Long rules belong in `.olym/steering/protocol/` or `.olym/specs/`.

## User
<!-- TODO: stack / OS / communication language / decision preferences -->

## Project — <name> current state
<!-- TODO: single-paragraph project state. Don't duplicate CLAUDE.md numbers. -->

## Project — lessons (append-only, newest on top)
<!-- corrections / repeated pitfalls / cross-session must-remember — date descending -->
```

### 4. `docs/personas/<persona>-<consumer>.md` × 5 (one per fleet member)

```markdown
# @<persona> · <consumer> ledger

> Project-specific ledger. Framework-level persona definition: `.olym/personas/<persona>.md` (if exists)

## Scope in <consumer>
<!-- TODO: this persona's lane / tech boundary in this project -->

## Active handoffs
<!-- current handoff links -->

## Decisions log (append-only)
<!-- important decisions + date + rationale -->

## Open questions
<!-- pending bao / zeus decisions -->
```

## Verify gates

After generation:

1. **Protocols present** — `.olym/protocols/evolution.md` AND (`.olym/protocols/main-loop.md` OR `.olym/steering/olympus-protocol.md`) must exist
2. **YAML syntax** — try parsing `lane-ownership.yaml` with node or python
3. **Cross-cutting audit** (optional) — run `node scripts/audit-cross-cutting.mjs` if available; non-blocking warning if findings surface

## Onboard summary

Print:

```
═══════════════════════════════════════════════════
  olym onboard complete — <consumer-name>
═══════════════════════════════════════════════════

Created N files:
  + .olym/steering/lane-ownership.yaml
  + CLAUDE.md
  + MEMORY.md
  + docs/personas/zeus-<consumer>.md
  + docs/personas/<persona-1>-<consumer>.md
  + docs/personas/<persona-2>-<consumer>.md
  + docs/personas/<persona-3>-<consumer>.md
  + docs/personas/<persona-4>-<consumer>.md

Skipped N existing files (idempotent — not overwritten):
  - <list>

Next steps:
  1. Fill CLAUDE.md: ## Rules / ## Architecture / ## Key Standards
  2. Fill MEMORY.md: ## User / ## Project current state
  3. Edit .olym/steering/lane-ownership.yaml — adjust fleet as needed
  4. Fill docs/personas/*-<consumer>.md ledgers
  5. Dispatch first handoff — use `olym-handoff-new` skill
  6. (If npm/pnpm/yarn workspace) install olym-core + olym-runtime
  7. DO NOT commit framework files (.olym/ stays vendored, treat as read-only)

Dry-run only: nothing committed / deployed / framework-mutated.
```

## Anti-patterns

- **Mutate framework files** — `.olym/` is vendored read-only. Bootstrap writes ONLY consumer-specific config (lane-ownership.yaml, CLAUDE.md, MEMORY.md, persona ledgers).
- **Overwrite existing files** — idempotent only. If `CLAUDE.md` exists, skip with a warning. Let the user merge manually.
- **Commit during bootstrap** — bootstrap is a generator, not a git workflow. User reviews + commits manually.
- **Hard-fail on missing `packages/olym-core/`** — the install script treats it as optional; protocol layer works without npm packages on different-stack projects.
- **Use Greek persona names blindly for B2B or non-Western teams** — names are customizable. Ask the user.

## Reference

- Source script (canonical): `scripts/olym-install.sh` in olym source repo
- Bootstrap template: `.olym/templates/olympus-fleet-bootstrap/BOOTSTRAP.md` (530-line full guide for fresh Claude session)
- Framework intro: `.olym/CLAUDE.md` + `.olym/olym-handbook.md`
- Known gaps: `.olym/CHANGELOG.md` (0.1.0-alpha, dogfood-only)
