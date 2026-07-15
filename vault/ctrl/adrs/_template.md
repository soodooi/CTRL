---
# Module ADR template. New files are exceptional: use this only when a
# genuinely new architectural module is not owned by 001-007 or 010.
adr_id: NNN
module: <module-slug>
title: CTRL <module> — <load-bearing scope>
version: 1
status: proposed
last_updated: YYYY-MM-DD
deciders: [bao, zeus]
sections:
  - { id: <section-id>, source: new-YYYY-MM-DD }
changelog:
  - v1 YYYY-MM-DD: initial module decision.
related:
  - vault/ctrl/adrs/<related-module>.md
---

# CTRL <module> — <title>

> State the module boundary and why no existing owning ADR can contain it.

## §1 <Decision section>

### Context

<What constraint or observed failure forced this module-level decision?>

### Decision

<The binding architecture, including ownership boundaries and invariants.>

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| <option> | <reason tied to CTRL constraints> |

### Consequences

- **Positive:** <what becomes simpler or safer>
- **Cost:** <what complexity or limitation is accepted>
- **Reversal:** <how this can be retired through an in-place versioned amendment>

## Release Acceptance

- [ ] <bounded criterion that must be true for every release touching this module>
- [ ] INDEX module map, version, status, and date match this ADR.
- [ ] Architecture-critical code cites `(ADR-NNN module § section v1)`.

## Design Acceptance (non-release)

- [ ] <long-horizon implementation or platform criterion surfaced by soft audit>

## Amendment checklist

For every accepted-ADR amendment: edit the owning section in place, increment
integer `version`, update `last_updated`, prepend one `changelog` entry, keep
retired `sections` provenance marked `retired-vN`, update INDEX, then run the
soft Acceptance audit plus relevant compiler/test evidence. Strict release
checks only explicit Release Acceptance / 发布验收 scopes; ordinary design debt
remains visible in soft mode without permanently blocking release.
