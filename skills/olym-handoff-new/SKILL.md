---
name: olym-handoff-new
description: Create a new Olym handoff (H-YYYY-MM-DD-NNN). Use when the user says "开 handoff", "派给 X", "dispatch this", or otherwise wants to formally hand off work to a lane owner. Enforces frontmatter completeness, the mandatory `## bao approval` section (G-048), and lane-guard pre-check.
---

# Olym Handoff — New

Create a single-file markdown handoff under `.olym/handoffs/H-YYYY-MM-DD-NNN-<slug>.md`. Handoffs are the Olym fleet's **primary communication channel** — git-based, not chat-based.

## When to activate

- User says "开 handoff" / "派给 athena / daedalus / apollo / hephaestus" / "dispatch this" / "把这件事正式 hand off"
- A verbal-go from bao exists but Stage 0 has no documented trace yet
- A spike result has produced an actionable next step requiring a lane owner

## Before you write

Run these checks (the user can do them too — but you should not skip):

1. **bao approval source** — is there:
   - (a) a verbal-go quote you can quote verbatim, OR
   - (b) an approved proposal at `.olym/proposals/P-YYYY-MM-DD-NNN-*.md`, OR
   - (c) an emergency (production page+ tier) where retroactive 24h backfill is OK?
   - If none of the three → STOP and ask bao for verbal-go first. Do not create a handoff without an approval trace.

2. **Lane sanity** — is the target `assigned_to` lane present and non-frozen in `.olym/steering/lane-ownership.yaml`?
   - Frozen lanes (`status: frozen`) reject new handoffs via lane-guard hook.
   - If the lane doesn't exist, ask bao before inventing one.

3. **Today's NNN** — `ls .olym/handoffs/H-YYYY-MM-DD-*` to find the next free serial.

4. **ID collision check** — `git log --all --oneline -- .olym/handoffs/` to verify the proposed ID isn't taken on another branch (this has bit zeus before — see `MEMORY.md`).

## Workflow

### 1. Write the handoff file

Path: `.olym/handoffs/H-YYYY-MM-DD-NNN-<slug>.md` (slug = short kebab-case description, e.g. `vulcan-to-daedalus`).

Required frontmatter (9 fields):

```yaml
---
id: H-YYYY-MM-DD-NNN
title: <one-line title>
severity: P0 | P1 | P2 | P3
status: open
reporter: <persona, usually zeus>
assigned_to: <lane name from lane-ownership.yaml>
from: <sender persona>
to: <receiver persona>
lane: <lane>
touches:
  - <file glob 1>
  - <file glob 2>
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Optional (fill when applicable):
- `related: [H-YYYY-MM-DD-NNN, ...]` — sibling/parent handoffs
- `project_id: <kebab-id>` — group multiple handoffs into a project rollup
- `category: feature | bugfix | refactor | docs | chore` — work nature (separate from severity = urgency)
- `downstream_of: H-...` — if this is downstream of a lane-yaml/roster change (triggers mandatory pre-review)
- `pre_dispatch_review: <archive path | "skipped (trivial)">`
- `demo_artifact: <path | URL | "not_applicable" | "pending">`

### 2. Body structure

```markdown
# <Title>

## bao approval

[ONE of three forms, mandatory per G-048]

Form A (verbal-go):
- bao verbal-go: YYYY-MM-DD: "<verbatim quote>"

Form B (proposal):
- proposal: [P-YYYY-MM-DD-NNN](../proposals/P-...md)
- bao approved: YYYY-MM-DD via "ack"
- effort: S (1-2h) | M (1-3d) | L (4-7d)

Form C (emergency):
- emergency: <production /api/<endpoint> 5xx OR similar P0>, retroactive 24h to backfill

## Outcome
<what result is expected, in 1-3 bullets — outcome-focused, NOT step-by-step instructions>

## Critical constraint
- Lane: stay in <lane> scope
- Commit policy: each commit prefixed with [H-YYYY-MM-DD-NNN]
- Denylist: do not touch <list of zeus-stewardship files>
- <other lane/scope-specific guards>

## Blocker
- If blocked, open a handoff back to zeus OR ping zeus directly via forward block
- Do NOT mark in_progress → done with unresolved blockers
```

### 3. Commit + push

```bash
git add .olym/handoffs/H-YYYY-MM-DD-NNN-<slug>.md
git commit -m "$(cat <<'EOF'
chore(handoff): [H-YYYY-MM-DD-NNN] <title>

<short body explaining why>
EOF
)"
git push
```

After push, the receiver's SessionStart hook will inject the handoff into their next session via `.claude/hooks/session-handoff-snapshot.js`.

## Anti-patterns (do not do these)

- **Skip `## bao approval`** — dike will flag as P0 at EOD. Backfill is allowed (with explicit `2026-MM-DD backfill note:`) but never skip entirely.
- **Inline `## bao approval: <field>` in frontmatter** — yaml parses break on inline comments. Body section only.
- **Write step-by-step instructions in body** — bao's rule: "你安排任务的时候, 不用太具体, 不然实操会受很多限制". Give outcome + constraint, let the worker pick the path.
- **Create handoff for offline fleet member** — handoff is fleet comms, not single-side memo. If the target is offline, write a private inventory note and wait for them to come online.
- **Reuse an in_progress handoff ID for a new task** — always new NNN.

## Status lifecycle

```
open → claimed → in_progress → done → verified
                              ↓
                        superseded (cancelled / replaced)
```

`done → verified` is **zeus-only** stewardship — lane owner cannot self-flip to verified. When flipping verified, expand `## bao approval` to the 3-row chronology (verbal-go / merge-go / verify-go) per `handoff.md §3.5.1`.

## Reference

- Protocol source: `.olym/steering/protocol/handoff.md` (287 lines, full rules)
- bao approval spec: `.olym/specs/olym-proposal-sop/spec.md` (G-048)
- Verified-state chronology: `handoff.md §3.5.1`
- Collision protocol: `handoff.md §10` (4 options: A/B1/B2/B3)
- Handover protocol: `handoff.md §11` (A → B 4-step)

Read these when an edge case appears. Do not invent rules.
