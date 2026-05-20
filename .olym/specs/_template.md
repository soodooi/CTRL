---
# Spec frontmatter (per protocol/spec-discipline.md)
#
# 6 mandatory fields:
#   type             — Always "spec".
#   spec_id          — kebab-case unique slug (matches dir name in specs/).
#   status           — alpha → beta → GA → deprecated → superseded
#   version          — semver. Track spec doc itself, NOT the product version
#                       (a 1.0.0 spec doc can describe a v0.1 product).
#   owner            — fleet persona who owns this spec (zeus / athena / ...)
#   created          — YYYY-MM-DD
#   updated          — YYYY-MM-DD (bump on every body change)
#
# 1 mandatory field added by spec-discipline:
#   superseded_check — Annual review reminder: "YYYY-MM-DD + 12mo".
#                       At anniversary, owner reviews if spec still load-bearing.
#
# Optional:
#   lifecycle        — alpha | beta | GA | deprecated | superseded
#                       (decoupled from version semver. GA ≠ 1.0.0)
#   related          — sibling specs / steering / handoffs / decisions
#   audit_dimension  — for olym SSOT drift detection

type: spec
spec_id: <kebab-case-slug>
status: alpha
version: 0.1.0
owner: <persona>
created: YYYY-MM-DD
updated: YYYY-MM-DD
superseded_check: YYYY-MM-DD + 12mo
lifecycle: alpha
related: []
---

# <Spec Title>

## 1. Why

<motivation — what problem does this spec solve? Why now? What changes if we don't?>

## 2. Scope

**In scope**:
- <bullet>

**Out of scope**:
- <bullet>

## 3. Design

<core technical design — schema / API / state machine / decision tree>

## 4. Phases

| Phase | Deliverable | Effort | Owner |
|---|---|---|---|
| 1 | <X> | <S/M/L> | <persona> |
| 2 | <Y> | <S/M/L> | <persona> |

## 5. Acceptance

- [ ] <criteria>
- [ ] <criteria>

## 6. Open Questions

| Q# | Question | Owner | Resolution |
|---|---|---|---|
| Q1 | <question> | bao | _(pending)_ |

## 7. Counter-evidence (此 spec 可能输的方式)

- <failure mode>: <how to detect + how to recover>

## 8. Changelog

| Version | Date | Change |
|---|---|---|
| 0.1.0 | YYYY-MM-DD | Initial draft |
