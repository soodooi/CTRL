#!/usr/bin/env bash
# check-adr-acceptance — ADR § Acceptance auditor.
#
# Grep every `.olym/decisions/*.md` ADR for its `## Acceptance` section
# and surface every checkbox still in `[ ]` state. Used by release.sh
# (pre-publish gate) and runnable standalone for inline audit.
#
# bao 2026-05-31 (123-trail directive: "全量开发 架构都定了 增加 hook, 要按照 ADR"):
# the same root cause kept recurring — ADR acceptance written but never
# treated as a checklist. This hook makes "open acceptance items" a
# first-class machine-readable signal so they can't be hand-waved away.
#
# Exit codes:
#   0 = no open acceptance items (or only items in --ignore list)
#   1 = at least one open `[ ]` in a non-superseded ADR
#
# Flags:
#   --soft       Warn but don't fail (for pre-push / inline use)
#   --adr <id>   Only audit a specific ADR (e.g. `--adr 003`)
#
# Output format (per open item):
#   ADR-<id> §<section> — <unchecked item text>

set -euo pipefail

SOFT=0
ONLY_ADR=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --soft) SOFT=1 ; shift ;;
        --adr) ONLY_ADR="$2" ; shift 2 ;;
        *) echo "unknown flag: $1" >&2 ; exit 2 ;;
    esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DECISIONS_DIR="$ROOT/.olym/decisions"

if [[ ! -d "$DECISIONS_DIR" ]]; then
    echo "no .olym/decisions/ — nothing to audit"
    exit 0
fi

OPEN_COUNT=0
declare -a OPEN_LINES=()

shopt -s nullglob
for adr in "$DECISIONS_DIR"/*.md; do
    base="$(basename "$adr" .md)"
    # Skip the ADR template (placeholder `[ ]` markers are intentional).
    if [[ "$base" == "_template" ]]; then
        continue
    fi
    # Extract numeric prefix (e.g. "003" from "003-brain-pi-core")
    adr_id="${base%%-*}"
    if [[ -n "$ONLY_ADR" && "$adr_id" != "$ONLY_ADR" ]]; then
        continue
    fi

    # Skip superseded ADRs — their acceptance no longer applies.
    if grep -qE '^status: superseded' "$adr" 2>/dev/null; then
        continue
    fi

    # Find lines that look like unchecked acceptance items. Scope to the
    # `## Acceptance` section only — don't catch unrelated `[ ]` markers
    # elsewhere in the doc.
    in_acceptance=0
    while IFS= read -r line; do
        # Section boundary detection. `## Acceptance` opens it; the next
        # `## ` (any other H2) closes it.
        if [[ "$line" =~ ^##[[:space:]]+Acceptance ]]; then
            in_acceptance=1
            continue
        fi
        if [[ $in_acceptance -eq 1 && "$line" =~ ^##[[:space:]] ]]; then
            in_acceptance=0
            continue
        fi
        if [[ $in_acceptance -eq 1 && "$line" =~ ^[[:space:]]*-[[:space:]]+\[[[:space:]]\] ]]; then
            # Strip "- [ ] " prefix for display
            item="${line#*[ ] }"
            OPEN_LINES+=("ADR-${adr_id}  ${item}")
            OPEN_COUNT=$((OPEN_COUNT + 1))
        fi
    done < "$adr"
done

if [[ $OPEN_COUNT -eq 0 ]]; then
    echo "✓ ADR acceptance audit: all items closed"
    exit 0
fi

echo "✗ ADR acceptance audit: $OPEN_COUNT open item(s)"
echo ""
for line in "${OPEN_LINES[@]}"; do
    echo "  $line"
done
echo ""
echo "Close each item by:"
echo "  1. implementing the acceptance criterion in code, with a comment"
echo "     citing the ADR § + date (see memory feedback_adr_code_comments_are_truth)"
echo "  2. flipping \`[ ]\` to \`[x]\` in the ADR \`## Acceptance\` section"
echo ""

if [[ $SOFT -eq 1 ]]; then
    echo "(soft mode — not blocking)"
    exit 0
fi
exit 1
