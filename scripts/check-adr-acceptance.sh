#!/usr/bin/env bash
# Acceptance audit for accepted module ADRs.
# Soft mode reports every unchecked item under headings containing Acceptance
# or 验收, including long-horizon design debt. Strict release mode checks only
# explicit Release Acceptance / 发布验收 scopes.

set -euo pipefail

SOFT=0
if [[ "${1:-}" = "--soft" ]]; then
  SOFT=1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADR_DIR="$ROOT/vault/ctrl/adrs"
FAILURES=0
CHECKED=0

while IFS= read -r file; do
  if ! grep -q '^status: accepted' "$file"; then
    continue
  fi
  CHECKED=$((CHECKED + 1))
  OPEN_ITEMS="$(awk -v soft="$SOFT" '
    /^#{2,6}[[:space:]]/ {
      heading = $0
      sub(/[[:space:]].*$/, "", heading)
      level = length(heading)
      title = $0
      sub(/^#{2,6}[[:space:]]+/, "", title)
      normalized = tolower(title)

      # A heading closes scopes at its own level and below while preserving an
      # enclosing qualifying scope. Soft mode qualifies all Acceptance debt;
      # strict mode qualifies only the explicit release contract.
      for (i = level; i <= 6; i++) acceptance_scope[i] = 0
      if (soft == 1) {
        qualifies = (normalized ~ /acceptance/ || title ~ /验收/)
      } else {
        qualifies = (normalized ~ /release[[:space:]-]+acceptance/ || title ~ /发布验收/)
      }
      if (qualifies) acceptance_scope[level] = 1

      in_acceptance = 0
      for (i = 2; i <= 6; i++) {
        if (acceptance_scope[i]) in_acceptance = 1
      }
      next
    }
    in_acceptance && /^[[:space:]]*-[[:space:]]*\[[[:space:]]\]/ { print FNR ":" $0 }
  ' "$file")"
  if [[ -n "$OPEN_ITEMS" ]]; then
    FAILURES=$((FAILURES + 1))
    echo "[OPEN] ${file#$ROOT/}"
    while IFS= read -r item; do
      echo "  $item"
    done <<< "$OPEN_ITEMS"
  fi
done < <(find "$ADR_DIR" -maxdepth 1 -type f -name '[0-9][0-9][0-9]-*.md' | sort)

if [[ "$FAILURES" -eq 0 ]]; then
  if [[ "$SOFT" -eq 1 ]]; then
    echo "[OK] ADR design + release Acceptance audit found no open items in $CHECKED accepted module ADR(s)."
  else
    echo "[OK] ADR Release Acceptance audit passed for $CHECKED accepted module ADR(s)."
  fi
  exit 0
fi

if [[ "$SOFT" -eq 1 ]]; then
  echo "[WARN] $FAILURES accepted ADR(s) contain open design or release Acceptance items (soft audit)."
  exit 0
fi

echo "[BLOCKED] $FAILURES accepted ADR(s) contain open Release Acceptance items."
echo "Close the release-scoped items before shipping, or use ADR_AUDIT_SOFT=1 only for an approved emergency hotfix."
exit 1
