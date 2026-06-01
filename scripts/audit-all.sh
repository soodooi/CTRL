#!/usr/bin/env bash
# audit-all — run all olym audits in sequence (zeus EOD trigger)
#
# Usage:
#   bash scripts/audit-all.sh              # default: report mode
#   bash scripts/audit-all.sh --check      # CI mode (exit 1 on FAIL)
#   bash scripts/audit-all.sh --json       # machine-readable
#
# Cadence: zeus EOD + weekly (conduct.md)
#
# Composition (starter ships 2 audits; project may add a 3rd cross-cutting audit):
#   1. audit-olym-ssot-drift.mjs - olym meta SSOT consistency
#   2. audit-olym-dogfood.mjs    - olym self protocol-compliance
#
# Project-specific cross-cutting audit (consistency across business surfaces) is
# project-supplied — write `scripts/audit-cross-cutting.mjs` for your repo and
# uncomment the section below.
#
# All audits emit independent reports. Aggregate verdict = worst of all.

set -e

CHECK_MODE=0
JSON_MODE=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_MODE=1 ;;
    --json)  JSON_MODE=1 ;;
  esac
done

EXIT_CODE=0

echo "=== 1/2 · olym-ssot-drift (meta) ==="
if [ $JSON_MODE -eq 1 ]; then
  node scripts/audit-olym-ssot-drift.mjs --json
else
  node scripts/audit-olym-ssot-drift.mjs $([ $CHECK_MODE -eq 1 ] && echo "--check") || EXIT_CODE=$?
fi
echo ""

# Project-specific cross-cutting audit. Uncomment after writing scripts/audit-cross-cutting.mjs:
# echo "=== 2/3 · cross-cutting (business) ==="
# if [ $JSON_MODE -eq 1 ]; then
#   node scripts/audit-cross-cutting.mjs --json
# else
#   node scripts/audit-cross-cutting.mjs || EXIT_CODE=$?
# fi
# echo ""

echo "=== 2/2 · olym-dogfood (protocol-compliance) ==="
if [ $JSON_MODE -eq 1 ]; then
  node scripts/audit-olym-dogfood.mjs --json
else
  node scripts/audit-olym-dogfood.mjs $([ $CHECK_MODE -eq 1 ] && echo "--check") || EXIT_CODE=$?
fi

if [ $CHECK_MODE -eq 1 ] && [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "[audit-all] FAIL — see above. Exit $EXIT_CODE."
  exit 1
fi

echo ""
echo "[audit-all] done."
