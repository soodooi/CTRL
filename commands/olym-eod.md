---
description: Run the Olym EOD (end-of-day) wrap-up sequence — fleet status, cross-cutting audit, dike self-audit, handoff archive, and EOD PR.
---

# /olym-eod

Run the zeus EOD wrap-up sequence per `.olym/steering/protocol/conduct.md` §3.

## The 9 EOD steps

```
1. Scan fleet state          → bash scripts/fleet-status.sh + gh pr list --state open
2. Cross-cutting audit       → bash scripts/audit-all.sh
3. Ping dirty / ahead-behind / silent fleet members (with signature)
4. Wait for bao forwards + fleet replies
5. Drive every in-flight handoff into one of: pausable / done / blocked-with-context
6. Switch zeus tree back to main, clean dirty, archive memory
7. Commit + push EOD PR
8. Dike audit (invoke @dike subagent) — write docs/audits/zeus-quality/eod-YYYY-MM-DD.md
9. Close the window
```

## What this slash command does

It walks you through steps 1, 2, 8 (the scriptable ones) and prompts you on steps 3–7 (require human judgement / forwarding):

1. Run `bash scripts/fleet-status.sh` → tree state + handoff counts + dike phase
2. Run `gh pr list --state open` → outstanding PRs
3. Run `grep "^status: (open|claimed|in_progress)" .olym/handoffs/*.md` → in-flight handoffs
4. Run `bash scripts/audit-all.sh` → SSOT drift (5 dim) + cross-cutting audit (6 dim)
5. Surface dirty worktrees and ask which need a ping forward block
6. Invoke `@dike` subagent (in background) to audit today's dispatches
7. After all-clear, draft the EOD commit message and push command (do NOT push automatically — bao confirms)

## Hard rules (do not violate)

- **Daily cadence, not weekly** — per `conduct.md §3` and `MEMORY.md`, Olym uses day-based dispatch, never week-based mechanisms.
- **Zeus collects in-flight first, then closes** — bao's rule: "宙斯的收尾要先回收外发的任务, 正好好后才能收尾". Do not close the window with silent in-flight handoffs.
- **Ping online fleet only** — offline fleet (no active worktree, not in conversation) stays alone until they return; do not leave handoff body pings (handoffs are fleet comms, not single-side memos).
- **No `--no-verify`** — never bypass pre-push hooks even at EOD.

## Output you should expect

By the end of the command:
- 1 audit file in `docs/audits/zeus-quality/eod-YYYY-MM-DD.md` (written by dike)
- 0 in-flight handoffs without an explicit pause / done / blocked status
- 0 dirty worktrees on main without a documented reason
- 1 EOD commit ready to push (you confirm push)

## When NOT to use this

- Mid-day check-ins → use `bash scripts/fleet-status.sh` directly, not full EOD
- Hot incident in progress → run `.olym/steering/protocol/incident.md` Phase 4 retro first; EOD after
- bao explicitly says "skip EOD today" → skip, but archive a `## EOD skipped: <reason>` note in MEMORY.md

## Reference

- Conduct protocol: `.olym/steering/protocol/conduct.md` §3 (Zeus 收尾 sequence)
- Dike audit: `.olym/skills/dike/SKILL.md`
- Cross-cutting audit dimensions: `scripts/audit-cross-cutting.mjs` (logo / auth / envelope / db_wrapper / vi_tokens / spec_status)
