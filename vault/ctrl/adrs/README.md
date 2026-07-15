# Decisions (ADR)

> Architectural Decision Records — module-organized, version-controlled. Single source of truth.

## Layout

```
vault/ctrl/adrs/NNN-<module>.md   # 001-spine.md ... 007-workbench.md + 010-communication.md (8 active; 008-009 retired)
vault/ctrl/adrs/INDEX.md          # module map + provenance from original 22 numbered ADRs
vault/ctrl/adrs/PROCESS.md        # governance: version-control rules + § Acceptance gate
vault/ctrl/adrs/_template.md      # template for the (rare) case a new module is created
```

## How to use

1. **Reading**: open `INDEX.md` for the 8-row active module map (plus 2 retired provenance rows). Click through to the owning module ADR for the load-bearing section.
2. **Amending**: edit a section in place, bump `version:` in frontmatter, prepend the newest `changelog:` row, update `last_updated:`. Don't open a new numbered file.
3. **Citing in code**: use `(ADR-NNN <module> § <section> v<N>)` format in comments. The `scripts/check-adr-acceptance.sh` gate enforces § Acceptance close-out before ship.

## When a new ADR is needed

Only when a genuinely new **module** appears (new architectural domain not covered by spine / substrate / frontend / cap / irisy / cross-cutting / workbench / communication). Otherwise: amend the existing module ADR.

See `PROCESS.md` for the full version-control + acceptance gate rules.
