---
# ADR frontmatter (Architectural Decision Record)
#
# adr_id    — NNN zero-padded sequential (001, 002, ...). Filename = NNN-slug.md.
# title     — Imperative one-liner describing the decision.
# status    — proposed | accepted | rejected | superseded | deprecated
#               proposed   — drafted, awaiting deciders
#               accepted   — agreed and load-bearing (immutable per zeus stewardship)
#               rejected   — drafted but not adopted; kept for audit trail
#               superseded — replaced by a later ADR (record supersedes: NNN)
#               deprecated — no longer load-bearing; do not delete
# date      — YYYY-MM-DD decision date
# deciders  — array of persona / role names who agreed (e.g., [bao, zeus])
# related   — sibling specs / steering / handoffs / decisions
# scope     — optional. "framework" (default, applies to olym framework itself)
#               or "<consumer>-specific" (only applies to one consumer project,
#               kept here for historical context but not load-bearing for new
#               consumers). New consumers fork this template into their own
#               .olym/decisions/ for project-local decisions.
# supersedes      — optional. ADR id(s) this one replaces.
# superseded_by   — optional. ADR id(s) that replaced this one (set when status
#                    flips to superseded).

adr_id: NNN
title: <imperative one-liner>
status: proposed
date: YYYY-MM-DD
deciders: [bao, zeus]
related: []
scope: framework
---

## Context

<What forced the decision? What problem / pressure / constraint?
Include enough background that a future reader (or new fleet member) can
understand why this was on the table without reading the entire repo.>

## Decision

<The decision itself, stated as imperative. One paragraph or short list.
Reader should be able to answer "what changed?" after this section.>

## Alternatives considered

> ADR is mandatory when ≥2 alternatives exist. Record 2-4 rejected options
> with reasons. "We picked X because Y was worse at Z" is the unit.

| # | Alternative | Why rejected |
|---|---|---|
| A1 | <option> | <reason> |
| A2 | <option> | <reason> |
| A3 | <option> | <reason> |

## Consequences

**Positive**:
- <what gets better>

**Negative / cost**:
- <what gets worse or what we pay>

**Reversal cost**:
- <how expensive to undo this decision. cheap / medium / expensive / one-way door>

## Acceptance

- [ ] <criterion — observable change in repo / behavior / artifact>
- [ ] <criterion>
- [ ] Related docs updated (roster / protocol / spec / CLAUDE.md as applicable)

## Changelog

| Date | Change |
|---|---|
| YYYY-MM-DD | Initial draft |
