---
name: olym-main-loop
description: Walk a feature through the Olym 10-stage main loop (TRIGGER → RESEARCH → ADR → SPEC → HANDOFF → LANE → PR → MERGE → VERIFY → LEARN). Use when the user says "开始做 feature X", "ship this feature", or starts a non-trivial multi-step initiative. Each stage has a quality gate; the #0 meta-rule (every stage answers "what ship value does this advance?") prevents drift into sub-goal self-loops.
---

# Olym Main Loop — 10-Stage Dev Cycle

A feature's full path from idea to ship-and-learn. Every stage has an exit gate. Skipping stages = the "named done but actually broken" anti-pattern (see ADR-002 retrospective).

## When to activate

- User says "开始做 feature X" / "ship this" / "do this initiative" — and it's clearly multi-step
- A new TRIGGER source has surfaced (audit finding / consumer feedback / spike result / postmortem)
- Mid-flight check — confirm which stage you're in and what gate must close before advancing

## The 10 stages

```
TRIGGER → RESEARCH → ADR → SPEC → HANDOFF → LANE → PR(REVIEW) → MERGE → VERIFY → LEARN
   ↑                                                                                  │
   └──────────────────── feedback loop ────────────────────────────────────────────────┘
```

### #0 meta-rule (precedes all 10)

**Every stage entry answers**: "What concrete ship value does this advance?"

- Ship value examples: consumer-project online ship / capability live / revenue / fleet unblocked / bao decision panel clearer
- If you can't answer in one sentence — STOP the stage. Cut / fold / defer.
- "Right" < "advancing". Phase 1 ugly-but-works > Phase 0 elegant-but-stuck.

### Stage 1 — TRIGGER

- Source: directive / audit finding / consumer feedback / postmortem / spike result
- Artifact: none (fleet awareness)
- Exit gate: one-sentence ship value stated

### Stage 2 — RESEARCH

- Use the `olym-research-spike` skill — spike (feasibility?) / proposal (how?) / poc (does it run?)
- Timeboxed: spike 1-3d, proposal 1-2d, poc 1-5d
- Artifact: `.olym/research/{spikes,proposals,pocs}/<topic>-<date>/RESULT.md`
- Exit gate: RESULT.md has decision evidence
- Anti-pattern: orphan spike (no ADR cites it)

### Stage 3 — ADR

- MADR template, status `proposed` → `accepted`
- Artifact: `.olym/decisions/<NNN>-<slug>.md`
- Owner: zeus (framework) / lane owner (lane-scoped)
- Approval: decider approves; cross-project ADRs need cross-consumer co-review
- Exit gate: `status: accepted` + clear ship value

### Stage 4 — SPEC

- Use the `olym-spec-decision` skill first — most cases bump existing spec, only some open new
- Artifact: `.olym/specs/<topic>/spec.md` (framework) OR `docs/specs/<topic>/` (consumer business)
- Owner: zeus (framework spec) / lane owner (lane spec)
- Exit gate: spec frozen, no major changes pending implementation

### Stage 5 — HANDOFF

- Use the `olym-handoff-new` skill
- Frontmatter required (per `handoff.md §2`). Body MUST include `## bao approval` (G-048)
- Exit gate: `status: open` + `assigned_to` set + lane owner pulls

### Stage 6 — LANE execution

- Lane owner works in their worktree following the spec
- Three-axis decoupling: persona × lane × business (lane-A/B/C/...)
- Worktree: `.worktrees/<lane>/` (long-lived) OR `.worktrees/scratch/<topic>/` (short)
- Lane-guard hook enforces scope (per `lane-ownership.yaml`)
- Exit gate: code commits ready for PR

### Stage 7 — PR + REVIEW

- Create PR (per `git.md`). Auto-load PULL_REQUEST_TEMPLATE.md (do NOT pass `--body`)
- Invoke `@themis` subagent — themis tiers A/B/C and dispatches specialists
- CI: pre-push hooks run (English-only check / shared-layer / v3.2 tokens / dike-skill trailer)
- Exit gate: themis APPROVE + CI green

### Stage 8 — MERGE

- Squash-merge to main: `gh pr merge --squash --delete-branch`
- Squash-verify: `gh pr list --state merged --head <branch>` (NOT `git cherry` — see `git.md`)
- Branch cleanup: `git branch -D <feat>` (squash requires `-D`)
- Exit gate: main synced, branch deleted

### Stage 9 — VERIFY (post-ship)

- Smoke: `curl /health` or relevant endpoint, walk the UI flow
- Audit: `bash scripts/audit-all.sh` — finding count must not regress
- 3-row chronology (per handoff): verbal-go (Stage 0) / merge-go (Stage 8) / verify-go (Stage 9) backfilled in `## bao approval`
- Dike audit: EOD aggregate
- Exit gate: handoff status `in_progress → done → verified` AND no restore PR within 7 days
- Anti-pattern: "named done, actually broken" — see ADR-002 monolithic refactor retrospective

### Stage 10 — LEARN ↑ (closes back to TRIGGER)

- Growth-log: each persona updates `.olym/personas/<name>/growth-log.md`
- ADR retrospective: if you hit a wall, open a retro ADR
- Cross-project: cross-project lesson enters zeus cross-project memory (`personas/zeus/memory.md`)
- Cadence: persona EOD / zeus weekly synthesize / bao monthly cross-project review
- Trigger new TRIGGER: recurring pattern → escalate to framework ADR

## Cross-cutting gates (fire at any stage)

| Gate | Triggered at | Tool |
|---|---|---|
| Dike audit | EOD / handoff close / monthly | `@dike` subagent |
| Themis review | Stage 7 mandatory | `@themis` subagent (tiers A/B/C) |
| Cross-cutting audit | EOD / PR pre-merge / weekly | `scripts/audit-cross-cutting.mjs` |
| #0 meta-rule check | Every stage entry | One-sentence ship value test |
| Zeus stewardship | Any cross-lane / framework change | zeus main tree only, denylist enforced |

## Anti-patterns (lesson catalog)

| Anti-pattern | Stage skipped | Lesson |
|---|---|---|
| Atomic single-PR cutover | Stage 2 PoC | ADR-002 retrospective — monolithic refactor restore-PR pain |
| "Named done, actually broken" | Stage 9 VERIFY | done = "no restore PR within 7 days" |
| Orphan spike / proposal | Stage 3 ADR | If no ADR cites it, kill (bloat) |
| AI propose → ship | Stage 7 REVIEW | #1 strong philosophy: AI propose ≠ AI execute; destructive requires bao |
| Lane scope creep | Stage 6 guard | Lane-guard hook blocks; if hook is bypassed, dike flags at EOD |

## Reference

- Source: `.olym/protocols/main-loop.md` (full 10 stages + cross-cutting gates)
- Meta-rule #0: `.olym/CLAUDE.md` (Design Philosophy)
- Research lifecycle: `.olym/protocols/evolution.md §5` + `olym-research-spike` skill
- Spec decision: `.olym/steering/protocol/spec-discipline.md §6` + `olym-spec-decision` skill
- Handoff format: `.olym/steering/protocol/handoff.md` + `olym-handoff-new` skill
- Review tier: `.olym/steering/protocol/review.md` + `agents/themis.md`
- Git workflow: `.olym/steering/protocol/git.md`
- Verify standard: `.olym/steering/protocol/verification.md`
- Learn loop: `.olym/steering/protocol/knowledge.md` (KM three layers + daily iteration)
