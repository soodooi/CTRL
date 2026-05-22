#!/usr/bin/env bash
# Fleet status overview — handoff counts, PR / worktree state, ADR drift.
#
# Minimum-viable shim until the full hello-olym version lands.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "── CTRL fleet status · $(date '+%Y-%m-%d %H:%M:%S') ──"
echo

if command -v node >/dev/null 2>&1 && [ -f scripts/handoffs-index.js ]; then
  node scripts/handoffs-index.js >/dev/null
  echo "✔ handoffs INDEX.md regenerated"
fi

echo
echo "── Handoffs ──"
counts_line=$(grep -E '^\> \*\*Counts\*\*' .olym/handoffs/INDEX.md 2>/dev/null || true)
if [ -n "$counts_line" ]; then
  echo "$counts_line"
fi

echo
echo "── Open handoffs ──"
awk '/^## Open$/,/^## /{ if ($0 !~ /^## /) print; else if ($0 != "## Open") exit }' \
  .olym/handoffs/INDEX.md | sed 's/^/  /'

echo
echo "── In Progress ──"
awk '/^## In Progress/,/^## /{ if ($0 !~ /^## /) print; else if ($0 !~ /^## In Progress/) exit }' \
  .olym/handoffs/INDEX.md | sed 's/^/  /'

echo
echo "── Done (awaiting verify) ──"
awk '/^## Done /,/^## /{ if ($0 !~ /^## /) print; else if ($0 !~ /^## Done /) exit }' \
  .olym/handoffs/INDEX.md | sed 's/^/  /'

echo
echo "── Open PRs ──"
if command -v gh >/dev/null 2>&1; then
  gh pr list --state open --limit 30 --json number,title,headRefName,updatedAt \
    --jq '.[] | "  #\(.number)  \(.title)  (\(.headRefName), updated \(.updatedAt[:10]))"' \
    2>/dev/null || echo "  (gh not authenticated)"
else
  echo "  (gh not installed)"
fi

echo
echo "── Local worktrees ──"
if [ -d .worktrees ]; then
  for d in .worktrees/*/; do
    [ -d "$d" ] || continue
    name=$(basename "$d")
    branch=$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
    echo "  $name → $branch"
  done
else
  echo "  (no .worktrees/ dir)"
fi

echo
echo "── ADR registry ──"
if [ -f .olym/decisions/INDEX.md ]; then
  grep -E '^\| \[?[0-9]{3}' .olym/decisions/INDEX.md | sed 's/^/  /'
fi

echo
echo "── Workspace typecheck (quick) ──"
if [ -f package.json ]; then
  if npm --workspaces --if-present run typecheck >/tmp/ctrl-fleet-typecheck.log 2>&1; then
    echo "  ✔ all workspaces pass"
  else
    echo "  ✗ failures — see /tmp/ctrl-fleet-typecheck.log"
    tail -20 /tmp/ctrl-fleet-typecheck.log | sed 's/^/    /'
  fi
fi
