---
name: olym-eod-wrapup
description: Run the Olym zeus EOD (end-of-day) wrap-up sequence. Use when the user says "EOD", "收尾", "关窗", "结束今天", or otherwise wants to close out the work day cleanly. Walks 9 steps including fleet status scan, cross-cutting audit, fleet ping (online only), in-flight handoff close-out, EOD commit, and dike self-audit. Daily cadence — NOT weekly.
---

# Olym EOD — Zeus 收尾 Sequence

Close out the work day per `.olym/steering/protocol/conduct.md §3`. This sequence is **daily** (bao's rule: "进度节奏不是每周, 要每天有进步"), not weekly.

## When to activate

- User says "EOD" / "收尾" / "关窗" / "结束今天" / "今天到这里"
- Approaching end of work session and there are open handoffs or dirty worktrees
- Asked to "总结今天" or "做今天的 audit"

## The 9 steps (run in order, do not parallelize)

### Step 1 — Scan fleet state

```bash
bash scripts/fleet-status.sh        # tree state + handoff counts + dike phase + EOD audit status
gh pr list --state open             # outstanding PRs
grep "^status: (open|claimed|in_progress)" .olym/handoffs/*.md   # in-flight handoffs
```

Note: if your project does not have `scripts/fleet-status.sh`, the script is in `.olym/templates/olympus-fleet-bootstrap/scripts/` — copy it.

### Step 2 — Cross-cutting audit (must run, do not skip)

```bash
bash scripts/audit-all.sh
```

Runs two audits in series:
- `audit-olym-ssot-drift.mjs` — 5 SSOT dimensions (G-013)
- `audit-cross-cutting.mjs` — 6 business dimensions: logo / auth / envelope / db_wrapper / vi_tokens / spec_status (G-012)

If any drift surfaces → open `H-YYYY-MM-DD-NNN` immediately and dispatch to the owning lane (1-day SLA).

### Step 3 — Ping dirty / silent fleet (online only, with signature)

For each fleet member with:
- a dirty worktree, OR
- ahead-behind imbalance vs origin/main, OR
- an in-flight handoff with no update >24h, OR
- silent (no commits today but assigned to active handoff)

…draft a forward block with proper signature:

```
@<persona>: <issue + ask> — from @zeus
```

**Hard rule**: ping ONLY online fleet (active worktree + present in conversation). Offline fleet stays alone — handoffs are fleet comms, not single-side memos. Record offline state in a private inventory note instead.

### Step 4 — Wait for bao forwards + fleet replies

Pause here. bao forwards your pings to offline machines. Fleet members reply. You DO NOT close until you have a state for each in-flight handoff.

### Step 5 — Drive every in-flight handoff into one of 3 states

| State | Meaning | What to record |
|---|---|---|
| **pausable** | Worker can stop now, resume tomorrow | handoff body: "pause at <step N>, resume by reading <context refs>" |
| **done** | Worker finished but not yet zeus-verified | Status `done`; zeus will verify next session |
| **blocked-with-context** | Worker hit a real blocker | handoff body: "blocked by <specific cause>, need <specific input>"; status `claimed` or `in_progress` |

No handoff exits the day silent / partial / state-unknown.

### Step 6 — Switch zeus tree back to main, clean dirty, archive memory

```bash
git switch main
git pull --rebase origin main
git status                  # MUST be clean
```

If MEMORY.md changed today, verify it stayed under the 180-line hard cap (`wc -l MEMORY.md`). If over, abstract long sections to `.olym/steering/protocol/` or persona memory.

### Step 7 — Commit + push EOD PR

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(eod): YYYY-MM-DD wrap-up — <summary>

- N handoffs closed (...)
- N audit findings opened (...)
- N PRs reviewed (...)
EOF
)"
git push
```

Use the PR template — DO NOT pass `--body` to `gh pr create`; it auto-loads `.github/PULL_REQUEST_TEMPLATE.md` per G-021.

### Step 8 — Dike audit (zeus self-audit)

Invoke `@dike` subagent in **background**:

> Audit all dispatches from today against the 5 dispatch-quality dimensions. Write findings to `docs/audits/zeus-quality/eod-YYYY-MM-DD.md`. Background mode — do not block.

After dike returns:
- If `overall_severity: P0` → add a forward block to bao
- If `bao_notify_required: yes` → surface in the EOD PR description
- If today is Sunday → also run weekly synthesis + 3 improvement proposals

### Step 9 — Close the window

State explicitly: "EOD complete for YYYY-MM-DD. <N> in-flight handoffs paused/blocked, <N> done. <N> audit findings open. Next session resumes by reading SessionStart hook injection."

## Anti-patterns

- **Skipping Step 2 audit** — bao's hard rule: "我们不停走回头路是很大的问题". Audit is non-negotiable.
- **Closing window with silent in-flight handoffs** — every handoff exits the day with explicit state. No exceptions.
- **Pinging offline fleet** — leaves stale forward blocks no one will see; pollutes context. Wait for them online.
- **Weekly cadence** — Olym is day-based. Do not write "Week N" or batch a week's audits.
- **`git commit --no-verify`** — pre-push hook failure is a real signal; investigate, do not bypass.

## Reference

- Source: `.olym/steering/protocol/conduct.md §3` (Zeus 收尾 sequence, full 9 steps)
- Dike scope: `.olym/skills/dike/SKILL.md` + `agents/dike.md` in this plugin
- Audit scripts: `scripts/audit-all.sh`, `scripts/audit-cross-cutting.mjs`, `scripts/audit-olym-ssot-drift.mjs`
- PR template: `.github/PULL_REQUEST_TEMPLATE.md` (G-021)
