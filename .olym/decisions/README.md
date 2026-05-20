# Decisions (ADR)

> Architectural Decision Records. Once-off decisions with alternatives + rationale + reversal cost.

## Format

```
.olym/decisions/NNN-slug.md      # NNN zero-padded sequential, slug kebab-case
```

## What goes in ADR

- Once-off architectural decision (frame choice, vendor lock-in, data shape choice)
- Includes 2-4 rejected alternatives with reasons
- Documents reversal cost
- Used as historical log — **immutable** once merged (zeus stewardship denylist)

## When ADR is mandatory

- ≥3 simultaneous fleet retirements (per `olympus-roster.md` "退役 SOP")
- Cross-lane architectural decision (multi-lane impact)
- Any decision needing alternatives recorded for future reference

## When ADR is optional

- Single retirement / lane move
- Project-internal product decision (use spec instead)

详 `.olym/steering/protocol/spec-discipline.md` §6 决策树.

## Lint (advised)

`scripts/adr-check.py` — config-driven ADR governance lint, validates 10 errors + 2 warnings against the advised olym format:

| Rule | What it checks |
|---|---|
| E1 | Parseable YAML frontmatter |
| E2 | Required fields present (`adr_id`, `title`, `status`, `date`, `deciders`, `scope`) |
| E3 | `status` in `{proposed, accepted, rejected, superseded, deprecated}` |
| E4-E7 | Cross-ref integrity (supersedes / superseded_by / partially_superseded_by / amended_by) |
| E8-E9 | `INDEX.md` row count + ordering match ADR files |
| E10 | `## Alternatives considered` table has ≥2 data rows |
| E11 | `## Consequences` includes `**Reversal cost**:` line |
| E12 | `## Acceptance` has at least one `- [ ]` checkbox item |
| E13 | `## Changelog` table has ≥1 data row |
| W1 | Two accepted ADRs share scope + title similarity >0.70 |
| W2 | `deciders` has only 1 entry (low-quorum decision) |

Run from any olym consumer:

```bash
python3 scripts/adr-check.py            # all checks
python3 scripts/adr-check.py --strict   # warnings become errors (release prep)
```

Consumer-specific overrides (filename pattern, status casing, id field name) go in `.olym/decisions/adr-check.config.yaml`. Built-in defaults match this README's advised format. iris-mro-camo is the first dogfood consumer; its config preserves a legacy `ADR-NNN-` filename prefix during transition.
