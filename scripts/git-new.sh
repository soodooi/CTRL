#!/usr/bin/env bash
# Open a new feature branch synced from origin/main.
#
# Usage: bash scripts/git-new.sh <branch-name>
# Example: bash scripts/git-new.sh feat/admin-rbac-presets
#
# Why this exists:
#   GitHub squash-merges produce a new commit hash on origin/main, leaving
#   the local feature branch's individual commits unrecognized as "merged"
#   by `git cherry`. If you open a new branch from a stale local main, the
#   new branch inherits N "ghost" commits that look ahead but are already
#   upstream — confusing diffs and PR reviews.
#
#   This script enforces the only safe pattern:
#     1. switch to main
#     2. fetch + rebase from origin (idempotent if already synced)
#     3. open the new branch from the now-current main
#
#   Refuses to run if the working tree is dirty (commit / stash / discard first).

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: bash scripts/git-new.sh <branch-name>" >&2
  echo "example: bash scripts/git-new.sh feat/admin-rbac-presets" >&2
  exit 1
fi

NEW_BRANCH="$1"

# Reject reserved / typo-prone names
case "$NEW_BRANCH" in
  main|master|HEAD|"")
    echo "error: refusing to create branch named '$NEW_BRANCH'" >&2
    exit 1
    ;;
esac

# Refuse to overwrite an existing branch
if git show-ref --verify --quiet "refs/heads/$NEW_BRANCH"; then
  echo "error: branch '$NEW_BRANCH' already exists locally" >&2
  echo "       switch with: git switch $NEW_BRANCH" >&2
  exit 1
fi

# Refuse if working tree dirty (tracked OR untracked)
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree has uncommitted changes — commit, stash, or discard first" >&2
  git status --short >&2
  exit 1
fi

echo "→ git switch main"
git switch main

echo "→ git fetch origin --prune"
git fetch origin --prune

# Use rebase so the local main fast-forwards (or rebases its own commits onto upstream)
echo "→ git pull --rebase origin main"
git pull --rebase origin main

echo "→ git switch -c $NEW_BRANCH"
git switch -c "$NEW_BRANCH"

echo ""
echo "✓ on $NEW_BRANCH (synced from origin/main @ $(git rev-parse --short HEAD))"
