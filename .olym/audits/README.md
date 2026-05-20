# Audits

> Zeus quality audit outputs (dike / cross-cutting / EOD). **Immutable** once written.

## Structure

```
.olym/audits/
├── zeus-quality/
│   └── YYYY-MM-DD-eod-quality.md     # zeus self-audit per protocol/verification.md §8
├── ssot-drift/
│   └── YYYY-MM-DD-drift.md           # SSOT consistency check output
└── cross-cutting/
    └── YYYY-MM-DD-audit.md           # dimensional consistency audit (auth / API / DB / etc.)
```

## What goes here

- Audit script outputs (machine-generated reports)
- Zeus EOD quality audits (dike)
- SSOT drift detection results
- Cross-cutting consistency reports

## Why immutable

- Tamper-proof historical record — zeus cannot erase a past audit finding
- Tracks improvement over time (compare YYYY-MM-DD reports)
- Denylist_explicit (`lane-ownership.yaml`) blocks fleet writes (security fix from past audit-tampering attempt)

## Writer responsibility

- Audit scripts write (zeus runs scripts, scripts produce files)
- Zeus reviews + adds analysis section ("forward block")
- No fleet writes, no manual zeus edits to past audits (only forward blocks)

详 `.olym/steering/protocol/verification.md` §8.
