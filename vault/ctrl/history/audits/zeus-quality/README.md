# dike audit log — zeus quality

> Owned by `@dike` (Olym zeus self-audit specialist). Output of `.claude-plugin/agents/dike.md`.
> Consumed by `scripts/fleet-status.sh` (dike phase) + `.claude/hooks/session-handoff-snapshot.js` (EOD digest).

## Status (2026-05-31)

- **Initialised**: 2026-05-31 (this directory created)
- **Startup-period**: 2026-05-31 → 2026-06-30 (first 30 days — dike MUST run after every dispatch)
- **Post-startup cadence**: weekly aggregate
- **Current mode**: `flexible-dev` (per `.olym/steering/lane-ownership.yaml`) — bao 2026-05-25 校准 only ADR + 代码 + PR, no handoff dispatch in flight, so no dispatch-trigger audit will fire until multi-persona fleet reactivates
- **Baseline file**: `baseline-2026-05-31.md` (dimension scoring template, no real handoff scored yet)

## File naming

| Pattern | When written |
|---|---|
| `<H-id>-quality.md` | After each dispatch (background) |
| `YYYY-MM-DD-eod-quality.md` | EOD aggregate (zeus foreground at day end; pattern consumed by `fleet-status.sh` `$today-eod*.md` glob) |
| `<date>-incident.md` | Incident post-mortem (P1 audit) |
| `<date>-rollback.md` | Post-rollback audit |

## 5 dimensions (per dike agent definition)

1. Pre-dispatch specialist review actually run?
2. Trigger machine-judge accuracy (touches / downstream_of / cross-lane)?
3. Archive frontmatter completeness (8 mandatory fields)?
4. Verification template real (end-to-end scenario, pass criteria, demo artifact)?
5. `## bao approval` trace correct (verbal-go / proposal / emergency)?

Each scored ✓ / ⚠ / ✗.
