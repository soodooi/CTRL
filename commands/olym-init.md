---
description: Bootstrap a new consumer project onto the Olym framework — generates .olym/ skeleton, CLAUDE.md, MEMORY.md, lane-ownership.yaml, and persona ledgers.
argument-hint: <consumer-name-kebab-case>
---

# /olym-init

Bootstrap the current repo into an Olym-managed project.

Argument: `$1` = consumer name (kebab-case, e.g. `my-store`, `panda-gooo`). Required.

## What this does

Runs the equivalent of `bash scripts/olym-install.sh <consumer-name>` but adapted for plugin context:

1. **Pre-flight** — verify current directory is a git repo and `.olym/` already exists (must be copied or vendored from the olym source repo first).
2. **Generate consumer config**:
   - `.olym/steering/lane-ownership.yaml` — 4-lane default matrix (athena/daedalus/apollo/hephaestus) over (admin/creator/marketing/infra)
   - `CLAUDE.md` — placeholder with framework reference
   - `MEMORY.md` — single-file memory (≤180 lines hard cap)
   - `docs/personas/<persona>-<consumer>.md` × 5 — per-persona project ledger
3. **Verify** — protocols present, yaml lint, optional cross-cutting audit
4. **Summary** — print created vs skipped files + next steps

## Workflow

```bash
# Use the project-local olym-install.sh if present (canonical path),
# otherwise fall back to a manual generate using the same templates.
if [ -f scripts/olym-install.sh ]; then
  bash scripts/olym-install.sh "$1"
else
  echo "scripts/olym-install.sh not found in this project."
  echo "Either:"
  echo "  (a) copy it from the olym source repo, or"
  echo "  (b) ask Claude to run the generate steps inline using the templates in .olym/templates/olympus-fleet-bootstrap/"
fi
```

## When NOT to use this

- Repo is not git-initialized (run `git init` first)
- `.olym/` is missing — copy from source repo or template first
- Project is already onboard (idempotent generator will skip existing files, but verify with `bash scripts/fleet-status.sh` first)

## Reference

- Source script: `scripts/olym-install.sh`
- Bootstrap template: `.olym/templates/olympus-fleet-bootstrap/`
- Framework intro: `.olym/CLAUDE.md` + `.olym/olym-handbook.md`

## Known limits

- `scripts/olym-install.sh` treats `packages/olym-core` as optional — `.olym/` + `scripts/` still install on non-monorepo / different-stack projects
- Generated config uses Greek persona names (athena/daedalus/apollo/hephaestus) — edit `lane-ownership.yaml` if your team prefers role-based names
- `bao` is preserved as the operator codename across framework files — replace if it does not fit your team's vocabulary
