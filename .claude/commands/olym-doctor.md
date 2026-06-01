---
description: Diagnose Olym install — check .olym/VERSION lockfile, manifest consistency, version skew across plugin / marketplace / npm packages, hook install path
---

Run `bash scripts/olym-doctor.sh` from the repo root.

Show the output verbatim. If any line is `FAIL` or `WARN`, name the single most concrete next action the user should take (e.g. "re-run `/olym-init`", "rebase to pick up upstream 0.3.1-alpha", "fix marketplace.json version drift").

Do NOT auto-fix — wait for user confirmation. `--fix` flag is reserved for 0.4.0-alpha.
