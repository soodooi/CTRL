#!/usr/bin/env bash
# keycap → mcp full rename — string + file + import.
#
# bao 2026-06-07 directive: unify terminology to "mcp" only. Extends
# memory `decision_keycap_collapses_to_mcp_meta_ux_layer` (2026-06-05)
# from doc-level to symbols + filenames.
#
# DRY-RUN BY DEFAULT — emits the rename plan to stdout, touches nothing.
# Pass `--apply` to actually mutate the tree. Always run from a clean
# git status so you can `git diff` / `git checkout -- .` to revert.
#
# Three passes:
#   1. String replace inside source files
#         keycap -> mcp     | Keycap -> Mcp     | KEYCAP -> MCP
#      Limited to .ts / .tsx / .rs / .css / .toml / .json / .md
#      Excludes:
#        - node_modules, target, dist, .git
#   2. File rename
#         Keycap* -> Mcp*   | keycap* -> mcp*
#      Uses `git mv` so history follows.
#   3. Verification — cargo check + tsc on the result.
#
# The script does NOT touch:
#   - .olym/  (ADR / memory — those are doc-rewritten by hand for
#     contextual accuracy, not blind regex)
#   - CHANGELOG.md / README.md history mentions
#
# Re-running with --apply on an already-renamed tree is a no-op (sed
# only matches the old strings).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APPLY=0
if [[ "${1:-}" == "--apply" ]]; then
    APPLY=1
fi

CYAN="\033[36m"; YELLOW="\033[33m"; GREEN="\033[32m"; RED="\033[31m"; RESET="\033[0m"

if [[ "$APPLY" -eq 0 ]]; then
    echo -e "${CYAN}=== DRY RUN (no changes will be written) ===${RESET}"
    echo -e "Pass ${YELLOW}--apply${RESET} to actually rename."
    echo
else
    if [[ -n "$(git status --porcelain)" ]]; then
        echo -e "${RED}x git status not clean - commit or stash first so this rename is atomic.${RESET}"
        git status --short
        exit 1
    fi
    echo -e "${CYAN}=== APPLY MODE (mutating tree) ===${RESET}"
    echo
fi

# Pass 1: discover string-replace targets
INCLUDE_PATHS=(packages src-tauri)
INCLUDE_EXTS=(ts tsx rs css toml json md)

echo -e "${CYAN}[1/3] string-replace pass (keycap -> mcp / Keycap -> Mcp / KEYCAP -> MCP)${RESET}"

MATCH_FILES=()
while IFS= read -r f; do
    MATCH_FILES+=("$f")
done < <(
    {
        for p in "${INCLUDE_PATHS[@]}"; do
            for ext in "${INCLUDE_EXTS[@]}"; do
                find "$p" -type f -name "*.${ext}" \
                    -not -path '*/node_modules/*' \
                    -not -path '*/target/*' \
                    -not -path '*/dist/*' \
                    -not -path '*/.git/*'
            done
        done
    } | xargs grep -l -E '\b[Kk]eycap\b|KEYCAP' 2>/dev/null | sort -u
)

echo "    will touch ${#MATCH_FILES[@]} source files"

if [[ "${#MATCH_FILES[@]}" -gt 0 && "$APPLY" -eq 0 ]]; then
    echo -e "${YELLOW}    sample (first 10):${RESET}"
    printf '      %s\n' "${MATCH_FILES[@]:0:10}"
    if [[ "${#MATCH_FILES[@]}" -gt 10 ]]; then
        echo "      ... and $((${#MATCH_FILES[@]} - 10)) more"
    fi
fi

if [[ "$APPLY" -eq 1 ]]; then
    for f in "${MATCH_FILES[@]}"; do
        # macOS sed needs `-i ''`. Linux uses `-i`. Detect.
        if sed --version 2>/dev/null | grep -q GNU; then
            # No \b — must catch KeycapCard (no word boundary between
            # Keycap and Card). Blind replace is safe here: no other
            # identifier in the tree contains the literal "keycap" /
            # "Keycap" / "KEYCAP" that should survive.
            sed -i \
                -e 's/keycap/mcp/g' \
                -e 's/Keycap/Mcp/g' \
                -e 's/KEYCAP/MCP/g' \
                "$f"
        else
            sed -i '' \
                -e 's/keycap/mcp/g' \
                -e 's/Keycap/Mcp/g' \
                -e 's/KEYCAP/MCP/g' \
                "$f"
        fi
    done
    echo -e "${GREEN}    ok string-replace done in ${#MATCH_FILES[@]} files${RESET}"
fi

echo

# Pass 2: file rename
echo -e "${CYAN}[2/3] file rename pass (Keycap* / keycap* in basenames)${RESET}"

RENAME_PLAN=()
while IFS= read -r f; do
    base=$(basename "$f")
    dir=$(dirname "$f")
    newbase=$(echo "$base" | sed -e 's/Keycap/Mcp/g' -e 's/keycap/mcp/g')
    if [[ "$base" != "$newbase" ]]; then
        RENAME_PLAN+=("$f -> $dir/$newbase")
    fi
done < <(
    find "${INCLUDE_PATHS[@]}" -type f \
        \( -name 'Keycap*' -o -name 'keycap*' \) \
        -not -path '*/node_modules/*' \
        -not -path '*/target/*' \
        -not -path '*/dist/*' \
        -not -path '*/.git/*' \
        | sort
)

echo "    will rename ${#RENAME_PLAN[@]} files"

if [[ "${#RENAME_PLAN[@]}" -gt 0 && "$APPLY" -eq 0 ]]; then
    echo -e "${YELLOW}    plan:${RESET}"
    printf '      %s\n' "${RENAME_PLAN[@]:0:15}"
    if [[ "${#RENAME_PLAN[@]}" -gt 15 ]]; then
        echo "      ... and $((${#RENAME_PLAN[@]} - 15)) more"
    fi
fi

if [[ "$APPLY" -eq 1 ]]; then
    for entry in "${RENAME_PLAN[@]}"; do
        from="${entry% -> *}"
        to="${entry#* -> }"
        git mv "$from" "$to"
    done
    echo -e "${GREEN}    ok ${#RENAME_PLAN[@]} files renamed via git mv${RESET}"
fi

echo

# Pass 3: verify
echo -e "${CYAN}[3/3] verify${RESET}"
if [[ "$APPLY" -eq 0 ]]; then
    echo "    skipped in dry-run; pass --apply to run cargo check + tsc"
    echo
    echo -e "${CYAN}=== summary ===${RESET}"
    echo "    pass 1: ${#MATCH_FILES[@]} files would get keycap->mcp string replace"
    echo "    pass 2: ${#RENAME_PLAN[@]} files would be renamed (git mv)"
    echo
    echo -e "    Re-run with ${YELLOW}--apply${RESET} when ready."
    exit 0
fi

echo "    running cargo check..."
( cd src-tauri && cargo check 2>&1 | tail -3 )
echo "    running tsc..."
npm --workspace @ctrl/web run typecheck 2>&1 | tail -3
echo
echo -e "${GREEN}=== rename complete ===${RESET}"
echo "    Review with: git diff --stat"
echo "    Revert with: git checkout -- . && git clean -fd"
