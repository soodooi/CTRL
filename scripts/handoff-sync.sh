#!/usr/bin/env bash
# handoff-sync — discover handoffs assigned to me that live on other branches
#
# Usage:
#   bash scripts/handoff-sync.sh             # report only (no merge)
#   bash scripts/handoff-sync.sh --pull      # cherry-pick new handoffs into current branch
#   bash scripts/handoff-sync.sh --counts    # machine-readable count summary (used by fleet-status)
#
# Workflow problem: a worker creates a handoff on `feat/marketing-foo`, pushes,
# but zeus on main can't see it without `git fetch origin` + scanning every branch.
# This script does that scan.
#
# Identity:
#   - If `.lane` exists → my-lane = its content (worker mode)
#   - Else → my-lane = "zeus" (orchestrator mode), match also matches zeus.
#
# What counts as "new":
#   - File present on origin/<branch> but absent in this working tree
#   - frontmatter `assigned_to:` equals my-lane (worker) OR equals "zeus" (orchestrator)
#
# Spec: .olym/specs/multi-agent-fleet/spec.md §13 (Phase 3 follow-up)

set -uo pipefail

# REPO_ROOT: prefer git toplevel (cwd-aware, supports PATH-installed usage);
# fall back to script-relative dirname when not in a git repo (legacy in-repo usage).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi
cd "$REPO_ROOT"

MODE="report"
for arg in "$@"; do
  case "$arg" in
    --pull)   MODE="pull" ;;
    --counts) MODE="counts" ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed -E 's/^# ?//'
      exit 0
      ;;
  esac
done

# Detect identity
if [[ -f .lane ]]; then
  MY_LANE="$(tr -d '[:space:]' < .lane)"
  AM_ZEUS=0
else
  MY_LANE="zeus"
  AM_ZEUS=1
fi

# Quiet fetch — workers don't need to see the whole bandwidth
git fetch --quiet --prune origin 2>/dev/null || {
  echo "[handoff-sync] git fetch failed (offline?)" >&2
  [[ "$MODE" == "counts" ]] && echo 0
  exit 0
}

# Local handoff filenames (basename only) — present in this tree
LOCAL_FILES="$(ls .olym/handoffs/H-*.md 2>/dev/null | xargs -n1 -I{} basename {} 2>/dev/null || true)"

# All remote branches except HEAD
REMOTE_BRANCHES="$(git for-each-ref --format='%(refname:short)' refs/remotes/origin/ 2>/dev/null | grep -v 'origin/HEAD' || true)"

declare -a NEW_REPORTS=()
declare -a NEW_FILES=()
declare -a NEW_BRANCHES=()

assigned_for_blob() {
  # Read frontmatter `assigned_to:` from a `git show` blob (no checkout)
  local ref="$1"
  git show "$ref" 2>/dev/null | awk '
    /^---/ { in_fm = !in_fm; next }
    in_fm && /^assigned_to:/ {
      sub(/^assigned_to:[[:space:]]*/, "")
      gsub(/["'\''[:space:]]/, "")
      print
      exit
    }
  '
}

title_for_blob() {
  local ref="$1"
  git show "$ref" 2>/dev/null | awk '
    /^---/ { in_fm = !in_fm; next }
    in_fm && /^title:/ {
      sub(/^title:[[:space:]]*/, "")
      gsub(/^["'\'']|["'\'']$/, "")
      print
      exit
    }
  '
}

for branch in $REMOTE_BRANCHES; do
  # Skip if branch == origin/main; it's the merge target, not a worker channel
  [[ "$branch" == "origin/main" ]] && continue

  # List all handoff files in that branch
  remote_files="$(git ls-tree -r --name-only "$branch" -- '.olym/handoffs/H-*.md' 2>/dev/null || true)"
  [[ -z "$remote_files" ]] && continue

  while IFS= read -r remote_path; do
    [[ -z "$remote_path" ]] && continue
    bn="$(basename "$remote_path")"
    # Skip if I already have this file locally
    echo "$LOCAL_FILES" | grep -qx "$bn" && continue
    # Resolve assigned_to from the blob
    assigned="$(assigned_for_blob "$branch:$remote_path" || true)"
    [[ -z "$assigned" ]] && continue
    # Match my-lane, plus "zeus" always interesting to zeus
    if [[ "$assigned" == "$MY_LANE" ]] || { [[ "$AM_ZEUS" == "1" ]] && [[ "$assigned" == "zeus" ]]; }; then
      title="$(title_for_blob "$branch:$remote_path" || true)"
      NEW_REPORTS+=("$bn  ($branch)  →$assigned  $title")
      NEW_FILES+=("$remote_path")
      NEW_BRANCHES+=("$branch")
    fi
  done <<< "$remote_files"
done

count="${#NEW_REPORTS[@]}"

if [[ "$MODE" == "counts" ]]; then
  echo "$count"
  exit 0
fi

if [[ "$count" == "0" ]]; then
  echo "[handoff-sync] no new handoffs assigned to '$MY_LANE'"
  exit 0
fi

echo "[handoff-sync] found $count new handoff(s) assigned to '$MY_LANE':"
for r in "${NEW_REPORTS[@]}"; do
  echo "  - $r"
done

if [[ "$MODE" != "pull" ]]; then
  echo
  echo "Re-run with --pull to checkout the files into this tree (no commit)."
  exit 0
fi

# --pull: copy each blob into the working tree (no cherry-pick — avoids merge conflicts on unrelated changes)
echo
echo "[handoff-sync] copying handoff files into working tree (no commit) ..."
for i in "${!NEW_FILES[@]}"; do
  ref="${NEW_BRANCHES[$i]}:${NEW_FILES[$i]}"
  out="${NEW_FILES[$i]}"
  mkdir -p "$(dirname "$out")"
  if git show "$ref" > "$out" 2>/dev/null; then
    echo "  + $out"
  else
    echo "  ! failed to read $ref" >&2
  fi
done

echo
echo "[handoff-sync] regenerating INDEX.md"
node scripts/handoffs-index.js

echo
echo "Files staged in working tree but NOT committed. Review then:"
echo "  git add .olym/handoffs/  && git commit -m 'chore(handoffs): pull from worker branches'"
