---
name: olym-research-spike
description: Start an Olym research spike / proposal / poc (timeboxed 1-5 day investigation). Use when the user says "起 spike", "调研", "做个 poc", "先验证", "可不可行" — anything that asks a research question before committing to an implementation. Enforces timebox + goal-must-translate-to-decision + RESULT.md exit + anti-orphan check.
---

# Olym Research Spike / Proposal / PoC

Three lightweight research units that answer ONE question each, timeboxed. They are lighter-weight than handoffs (which are for execution).

## When to activate

- User says "起 spike" / "spike a thing" / "我想调研一下" / "可不可行" / "做个 poc" / "先验证"
- A spec has hit an unknown that blocks ADR — need evidence first
- An audit finding suggests a pattern but it's not clear if/how to systematize — investigate before codifying

## The three types

| Type | Asks | Output | Timebox |
|---|---|---|---|
| **Spike** | "Is X feasible?" | RESULT.md with decision evidence | 1-3 days |
| **Proposal** | "Of options A/B/C, which?" | Comparative analysis + recommendation | 1-2 days |
| **PoC** | "Can the chosen approach actually run end-to-end?" | demo + verification report | 1-5 days |

If you don't know which → start with **spike**. If feasibility known but path is unclear → **proposal**. If path chosen but execution uncertain → **poc**.

## Before you start — hard filter

You MUST be able to answer YES to all three:

1. **Can this `goal` translate to a concrete decision?** Frontmatter `goal:` must be one sentence in the form "answer ___ decision". If not → don't start; it's vague exploration, not research.
2. **Is this not already done?** Check `.olym/research/{spikes,proposals,pocs}/` for an existing topic. Duplicate spike = anti-pattern (per `evolution.md`).
3. **Will this finish inside the timebox?** Spike 1-3d, proposal 1-2d, poc 1-5d. If you suspect longer, this is a handoff, not a spike.

If any answer is NO → STOP, push back on the framing first.

## Workflow

### 1. Start the worktree + stub

Use the project's script (canonical entry):

```bash
bash scripts/scratch-new.sh <type> <topic> [persona]

# Example
bash scripts/scratch-new.sh spike hono-drizzle
bash scripts/scratch-new.sh poc langfuse-adapter apollo
```

This creates:
- `.worktrees/scratch/<type>-<topic>/` (branch `scratch/<type>-<topic>`, off main)
- `.olym/research/<type>s/<topic>-<YYYY-MM-DD>/README.md` (frontmatter stub)
- `.lane` file in worktree root (content = `scratch`)

If the script is not in the project, copy from `.olym/templates/olympus-fleet-bootstrap/scripts/` OR ask Claude to manually create the structure.

### 2. Frontmatter (unified across all three types)

```yaml
---
id: SPIKE-YYYY-MM-DD-NNN     # OR PROP-... OR POC-...
type: spike | proposal | poc
status: draft | approved | in_progress | done | killed
reporter: zeus | bao | <persona>
assigned_to: zeus | <persona>
timebox: 1-3 day              # required, must match type
worktree: scratch/<type>-<topic>   # optional, omit for main-inline spikes
goal: "answer <X> decision"   # required, must be a decision question
parent_adr: <path>            # optional, link to driving ADR
created: YYYY-MM-DD
---
```

### 3. Dispatch path — pick one

| Path | When | Where |
|---|---|---|
| **Main-inline** | timebox <1 day AND topic weakly related to any lane | zeus's main tree, no worktree |
| **Scratch worktree** | independent short investigation, doesn't pollute a lane | `.worktrees/scratch/<type>-<topic>/` |
| **Lane worktree** | tightly coupled to an existing lane's code | the lane's persistent worktree |

### 4. Inside the worktree — research

Standard cycle:
- Read related code / specs / vendor docs
- Try the smallest experiment that produces decision-grade evidence
- Capture **what worked AND what didn't** (failed spike with documented "won't work" is a success — it saved future churn)
- Do NOT polish — research code is throwaway. No tests, no error handling beyond what reveals the answer.

### 5. RESULT.md exit (mandatory)

Before flipping status to `done` or `killed`, write `.olym/research/<type>s/<topic>-<YYYY-MM-DD>/RESULT.md`:

```markdown
# RESULT — <topic>

## Decision evidence
<1-3 paragraphs: what did we learn that answers the `goal` question?>

## Recommendation
<one sentence: do X / don't do Y / proceed with Z>

## Next steps
- [ ] Open ADR <NNN>-<slug> citing this RESULT
- [ ] Open handoff to <lane> for implementation
- (etc.)

## Cost
- Wall time: <hours/days vs timebox>
- Failed approaches: <bullet list>
```

`killed` is a valid exit — a spike that proves "X won't work" is a successful spike.

### 6. Anti-orphan check

After RESULT.md, ensure ONE of the following lands within 7 days:
- An ADR cites this RESULT, OR
- A handoff cites this RESULT, OR
- A skill / protocol cites this RESULT, OR
- An archive entry explicitly says "killed — won't pursue"

Orphan spikes (no downstream reference) = quarterly prune target (per `evolution.md §7 anti-pattern`). Don't accumulate.

## Anti-patterns

- **Unbounded research loop** — symptom: spike day-3 has no RESULT and "just need a bit more". Hard stop at timebox. If a decision isn't clear, write what you know + recommend next-step research.
- **`goal: "explore X"`** — vague. Rewrite as "answer should-we-use-X decision" or kill.
- **Repeat spike on already-decided topic** — search `.olym/research/` first.
- **"Looks complex" → spike for mature pattern** — industry-standard pattern (e.g., 5-year-old tech) doesn't need a spike. Ship directly.
- **Polish research code** — research code is for evidence, not for prod. Don't add tests / error handling beyond what reveals the answer.
- **Skip RESULT.md** — kills the whole point of timeboxed research.

## Reference

- Source: `.olym/protocols/evolution.md §5` (research lifecycle, mini 4-stage)
- Anti-patterns: `evolution.md §7`
- Script: `scripts/scratch-new.sh`
- Linkage to ADR/handoff: `evolution.md §1` (contribution sources) + §2 (channels)
