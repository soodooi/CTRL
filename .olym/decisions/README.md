# Decisions (ADR)

> Architectural Decision Records — module-organized, version-controlled. Single source of truth.

## Layout

```
.olym/decisions/NNN-<module>.md   # 001-spine.md ... 007-workbench.md (7 module ADRs)
.olym/decisions/INDEX.md          # module map + provenance from original 22 numbered ADRs
.olym/decisions/PROCESS.md        # governance: version-control rules + § Acceptance gate
.olym/decisions/_template.md      # template for the (rare) case a new module is created
```

## How to use

1. **Reading**: open `INDEX.md` for the 7-row module map. Click through to the module ADR for the load-bearing section.
2. **Amending**: edit a section in place, bump `version:` in frontmatter, append a `changelog:` row, update `last_updated:`. Don't open a new numbered file.
3. **Citing in code**: use `(ADR-NNN <module> § <section> v<N>)` format in comments. The `scripts/check-adr-acceptance.sh` gate enforces § Acceptance close-out before ship.

## When a new ADR is needed

Only when a genuinely new **module** appears (new architectural domain not covered by spine / substrate / frontend / cap / irisy / cross-cutting / workbench). Otherwise: amend the existing module ADR.

See `PROCESS.md` for the full version-control + acceptance gate rules.
