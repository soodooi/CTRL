---
name: olym-rfc-flow
description: Walk a change through the Olym RFC 5-step flow (OPEN → IMPLEMENT → REVIEW → MERGE → SEDIMENT). MUST BE USED when a change touches any of the 8 zeus-stewardship classes (CLAUDE.md, MEMORY.md, .olym/specs/olympus/, .olym/specs/olym-*, .olym/steering/**, .olym/decisions/**, .olym/skills/**, .olym/best-practice/**, .claude/settings.json, .claude/hooks/**, .olym/settings/mcp.json, .husky/**). Emergency carve-out allowed for production page+ incidents only — backfill spec/handoff/ADR within 24h.
---

# Olym RFC Flow — Mandatory 5 Steps

If you're changing one of Olym's **8 zeus-stewardship classes**, you MUST walk through the 5-step RFC flow. No emergency carve-out except a production page+ incident.

## Trigger — am I in stewardship territory?

The 8 classes (per `.olym/steering/protocol/conduct.md §8.1`):

| # | Class | Path |
|---|---|---|
| 1 | Entry rules | `CLAUDE.md` |
| 2 | Memory | `MEMORY.md` + `~/.claude/projects/<project>/memory/` |
| 3 | Olym main architecture | `.olym/specs/olympus/`, `.olym/specs/multi-agent-fleet/`, `.olym/specs/olym-*/` |
| 4 | Steering | `.olym/steering/**` |
| 5 | Decisions | `.olym/decisions/**` |
| 6 | Audits | `docs/audits/**` |
| 7 | Cross-cutting skills | `.olym/skills/**`, `.olym/best-practice/**` |
| 8 | MCP / Tooling | `.olym/settings/mcp.json`, `.claude/hooks/**`, `.claude/settings.json`, `.husky/**`, certain `.github/workflows/*.yml` |

If your change touches ANY of these, RFC mandatory. If your change is routine sync (CLAUDE.md fact update, MEMORY.md append, archive routine), the decision tree in `conduct.md §13` may allow direct edit — read that section first.

## The 5 steps

### Step 1 — OPEN

Create:
- `git switch -c feat/<slug>` (or use `bash scripts/git-new.sh feat/<slug>` to sync main first)
- A handoff at `.olym/handoffs/H-YYYY-MM-DD-NNN-<slug>.md` (use the `olym-handoff-new` skill)
- An optional ADR at `.olym/decisions/<NNN>-<slug>.md` if the decision has alternatives worth recording

State frontmatter `status: proposed`. Get bao's verbal-go before moving to Step 2.

### Step 2 — IMPLEMENT

Edit the stewardship files on your feature branch. Rules:
- Each commit: `<type>(<scope>): [H-YYYY-MM-DD-NNN] <description>`
- Body in English (chinese OK in commit body if explaining context)
- Never `git commit --no-verify` to bypass pre-push
- Push the branch to remote when ready for review

### Step 3 — REVIEW (Themis tier)

Invoke the `@themis` subagent. Themis decides tier A/B/C and dispatches the right specialists.

For Olym stewardship changes the default tier is **B** (lane-scoped). Bump to **A** if:
- Cross-lane (≥2 lanes affected)
- Protocol change (handoff/review/git/conduct/knowledge/discipline)
- Persona retirement or new appointment (touches roster)
- >500 LOC of meta-doc churn

Themis specialists must APPROVE before Step 4. CHANGE_REQUEST = back to Step 2.

### Step 4 — MERGE

```bash
gh pr create   # auto-loads PULL_REQUEST_TEMPLATE.md
# ... themis APPROVE ...
gh pr merge --squash --delete-branch

# Squash-verify (squash creates a NEW commit hash on main):
gh pr list --state merged --head <branch>   # MUST return the PR

# Local cleanup:
git switch main && git pull --rebase
git branch -D <feat-branch>   # squash-merged requires -D
```

### Step 5 — SEDIMENT

After merge:
1. **Dike audit** — invoke `@dike` subagent in background to audit the dispatch quality
2. **Roadmap mark** — if this closes a roadmap goal (e.g., `G-NNN P1 done`), update `.olym/specs/olym-v3-roadmap/spec.md`
3. **Handoff verified** — flip status `done → verified` AND backfill the 3-row chronology in `## bao approval` (verbal-go / merge-go / verify-go)
4. **Best-practice** — if you learned something non-obvious, append a short note to `.olym/best-practice/<topic>.md` (zeus stewardship — only zeus writes)
5. **Cross-cutting audit** — `bash scripts/audit-all.sh` to ensure no SSOT drift introduced

## Emergency carve-out — production page+ incident only

If a production page+ tier incident is in progress:
- Commit-first IS allowed (skip Steps 1–3)
- Within **24 hours** you MUST backfill: spec/handoff/ADR + retroactive themis review
- Add `## bao approval: emergency` block + 1-line incident reference

Anything that is not a production page+ incident does NOT qualify. "Quick fix" / "small typo" / "I just need to push" is not an emergency.

## Anti-patterns

- **Skipping RFC for "small steering edit"** — there is no "small steering edit". If touches `.olym/steering/**`, RFC mandatory.
- **commit-first + amend later** — pre-commit hook fails ≠ amend prior commit. Always create a new commit (per Claude Code git safety).
- **Themis tier C on a protocol change** — tier C is for docs/typo/<200 LOC mechanical change. Protocol semantic changes are always B+.
- **Forgetting Step 5 sediment** — most common skip. Add dike audit + roadmap mark to your EOD checklist.

## Reference

- Conduct §8: `.olym/steering/protocol/conduct.md` (8 stewardship classes + decision tree §13)
- Spec discipline §7: `.olym/steering/protocol/spec-discipline.md` (RFC full rules)
- Spec: `.olym/specs/olym-rfc-mandatory/spec.md`
- Tier rules: `.olym/steering/protocol/review.md`
- Git protocol: `.olym/steering/protocol/git.md`
