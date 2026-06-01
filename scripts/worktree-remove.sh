#!/usr/bin/env bash
# worktree-remove — tear down a worker worktree
#
# Usage:
#   bash scripts/worktree-remove.sh <lane>
#
# Example:
#   bash scripts/worktree-remove.sh auth
#
# Refuses to remove if:
#   - worktree has uncommitted changes (dirty tree)
#   - worktree branch is ahead of origin (unpushed commits)
#
# Use --force to override both guards.
#
# Does NOT delete the feature branch (use `git branch -D` separately
# after merging the PR).
#
# Spec: .olym/specs/multi-agent-fleet/spec.md §12

set -euo pipefail

LANE="${1:-}"
FORCE="${2:-}"

if [[ -z "$LANE" || "$LANE" == "--help" ]]; then
  echo "Usage: bash scripts/worktree-remove.sh <lane> [--force]"
  exit 1
fi

# REPO_ROOT: prefer git toplevel (cwd-aware, supports PATH-installed usage);
# fall back to script-relative dirname when not in a git repo (legacy in-repo usage).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi
WORKTREE_BASE="$REPO_ROOT/.worktrees"
WORKTREE_PATH="$WORKTREE_BASE/$LANE"

if [[ ! -d "$WORKTREE_PATH" ]]; then
  echo "[err] worktree not found: $WORKTREE_PATH" >&2
  exit 1
fi

# Guard 1: uncommitted changes
if [[ "$FORCE" != "--force" ]]; then
  if ! git -C "$WORKTREE_PATH" diff --quiet || ! git -C "$WORKTREE_PATH" diff --cached --quiet; then
    echo "[err] worktree has uncommitted changes:" >&2
    git -C "$WORKTREE_PATH" status --short >&2
    echo "      commit / stash, or pass --force to discard" >&2
    exit 1
  fi
fi

# Guard 2: unpushed commits
if [[ "$FORCE" != "--force" ]]; then
  branch=$(git -C "$WORKTREE_PATH" rev-parse --abbrev-ref HEAD)
  upstream=$(git -C "$WORKTREE_PATH" rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null || true)
  if [[ -n "$upstream" ]]; then
    ahead=$(git -C "$WORKTREE_PATH" rev-list --count "$upstream..HEAD" 2>/dev/null || echo 0)
    if [[ "$ahead" -gt 0 ]]; then
      echo "[err] branch $branch is $ahead commit(s) ahead of $upstream" >&2
      echo "      push first, or pass --force to discard" >&2
      exit 1
    fi
  fi
fi

echo "[info] removing worktree $WORKTREE_PATH"
git -C "$REPO_ROOT" worktree remove "$WORKTREE_PATH" ${FORCE:+--force}

echo ""
echo "[done] Worktree removed."
echo ""
echo "Branch '$branch' still exists. Delete with:"
echo "  git -C $REPO_ROOT branch -D $branch   (after PR merged)"
