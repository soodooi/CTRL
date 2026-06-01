#!/usr/bin/env bash
# worktree-new — bootstrap a worker worktree for the multi-agent fleet
#
# Usage:
#   bash scripts/worktree-new.sh <persona> <lane> <branch>
#
# Example:
#   bash scripts/worktree-new.sh athena admin feat/admin-rbac-cleanup
#
# Creates:
#   <repo>/.worktrees/<lane>/   (in-repo, gitignored)
#     ├── .lane                        (single line: <lane>, attrib +R on Win)
#     └── (full repo checkout on <branch>)
#
# Then runs `npm install` to populate per-worktree node_modules (per §11).
#
# After this script:
#   - Worker opens their Claude harness with cwd = the new worktree
#   - SessionStart hook will see .lane file and inject worker-mode context
#   - lane-guard hook will use .lane to decide write authorization
#
# Persona vs Lane:
#   - Persona is an informational label (vulcan / apollo / athena / ...).
#     Accepted free-form; the runtime identity is resolved from the `.lane`
#     file, not from this parameter. `zeus` is rejected because zeus lives
#     in the main tree, not a worktree.
#   - Lane must exist as a top-level key in lane-ownership.yaml.
#
# Memory (per D-08): worker does NOT write MEMORY.md. Worker reads
# CLAUDE.md + SessionStart injection + handoff body for context.
# Learnings flow back to zeus via handoff body.
#
# Spec: .olym/specs/multi-agent-fleet/spec.md §12

set -euo pipefail

PERSONA="${1:-}"
LANE="${2:-}"
BRANCH="${3:-}"

if [[ -z "$PERSONA" || -z "$LANE" || -z "$BRANCH" ]]; then
  cat <<USAGE >&2
Usage: bash scripts/worktree-new.sh <persona> <lane> <branch>

  persona  Fleet persona name (e.g. zeus | athena | apollo | hephaestus | daedalus)
  lane     One of the keys defined in .olym/steering/lane-ownership.yaml
           (project-specific — see your project's lane-ownership.yaml)
  branch   Feature branch to create (will be created off main)

Examples (substitute your own lane names):
  bash scripts/worktree-new.sh athena      <lane-A>  feat/some-feature
  bash scripts/worktree-new.sh apollo      <lane-B>  feat/another-feature
  bash scripts/worktree-new.sh hephaestus  <lane-C>  feat/infra-thing

After this script:
  cd $(git rev-parse --show-toplevel)/.worktrees/$LANE
  # open your Claude harness here
USAGE
  exit 1
fi

# zeus is orchestrator-only; lives in main tree, never a worktree
if [[ "$PERSONA" == "zeus" ]]; then
  echo "[err] zeus lives in main tree, not a worktree" >&2
  exit 1
fi

# Validate lane against ownership.yaml
# REPO_ROOT: prefer git toplevel (cwd-aware, supports PATH-installed usage);
# fall back to script-relative dirname when not in a git repo (legacy in-repo usage).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi
OWNERSHIP="$REPO_ROOT/.olym/steering/lane-ownership.yaml"
if [[ ! -f "$OWNERSHIP" ]]; then
  echo "[err] lane-ownership.yaml not found at $OWNERSHIP" >&2
  exit 1
fi

# Crude grep — yaml lib not assumed. Lanes are top-level keys under `lanes:`
# indented exactly 2 spaces. Pattern: `  <lane>:`
if ! grep -qE "^  ${LANE}:" "$OWNERSHIP"; then
  echo "[err] lane '$LANE' not in lane-ownership.yaml" >&2
  echo "      Open $OWNERSHIP to see valid lanes" >&2
  exit 1
fi

# Resolve worktree root: <repo>/.worktrees/<lane>/
# (in-repo .worktrees keeps multiple sibling repos isolated. .gitignore covers
# the dir.)
WORKTREE_BASE="$REPO_ROOT/.worktrees"
WORKTREE_PATH="$WORKTREE_BASE/$LANE"

if [[ -e "$WORKTREE_PATH" ]]; then
  echo "[err] worktree path already exists: $WORKTREE_PATH" >&2
  echo "      Use scripts/worktree-remove.sh first if you want to recreate" >&2
  exit 1
fi

mkdir -p "$WORKTREE_BASE"

# Sync main before branching off (per CLAUDE.md git workflow)
echo "[info] syncing main before branching"
git -C "$REPO_ROOT" switch main
git -C "$REPO_ROOT" pull --rebase

# Create worktree on a new branch off main
echo "[info] creating worktree at $WORKTREE_PATH on branch $BRANCH"
git -C "$REPO_ROOT" worktree add "$WORKTREE_PATH" -b "$BRANCH"

# Write .lane (single line, no trailing newline meaningful)
echo "$LANE" > "$WORKTREE_PATH/.lane"

# Make .lane read-only on Windows (cosmetic; lane-guard hook is the real defense)
if command -v attrib &>/dev/null; then
  attrib +R "$WORKTREE_PATH/.lane" 2>/dev/null || true
fi

# Install dependencies inside the worktree (per §11, no symlinking)
# Auto-detect package manager from lockfile so consumers using pnpm / yarn / bun
# don't break (e.g. pnpm workspace:* deps cannot be resolved by npm install).
if [[ -f "$WORKTREE_PATH/pnpm-lock.yaml" ]]; then
  PKG_MGR="pnpm"
elif [[ -f "$WORKTREE_PATH/yarn.lock" ]]; then
  PKG_MGR="yarn"
elif [[ -f "$WORKTREE_PATH/bun.lockb" ]] || [[ -f "$WORKTREE_PATH/bun.lock" ]]; then
  PKG_MGR="bun"
elif [[ -f "$WORKTREE_PATH/package-lock.json" ]]; then
  PKG_MGR="npm"
elif [[ -f "$WORKTREE_PATH/package.json" ]]; then
  # package.json exists but no lockfile — fall back to npm (consumer can re-run with preferred manager)
  PKG_MGR="npm"
else
  PKG_MGR=""
fi

if [[ -n "$PKG_MGR" ]]; then
  if command -v "$PKG_MGR" &>/dev/null; then
    echo "[info] running $PKG_MGR install in $WORKTREE_PATH"
    ( cd "$WORKTREE_PATH" && "$PKG_MGR" install )
  else
    echo "[warn] $PKG_MGR not found on PATH; skipping install. Run manually inside worktree."
  fi
else
  echo "[info] no package.json detected; skipping install"
fi

# Friendly summary
cat <<NEXT

[done] Worktree ready.

  Persona:  $PERSONA
  Lane:     $LANE
  Branch:   $BRANCH
  Path:     $WORKTREE_PATH

Next steps for @$PERSONA:
  1. Open Claude harness with cwd = $WORKTREE_PATH
  2. SessionStart will inject:
       - Active handoffs assigned to '$LANE'
       - Forbidden files (other lanes)
       - Messages awaiting your response
  3. Memory: per D-08, you do NOT write MEMORY.md.
     Read CLAUDE.md + SessionStart context + handoff bodies.
     Push learnings back to zeus via handoff body
     ("@zeus: please record in memory: ...").

When done: bash scripts/worktree-remove.sh $LANE
NEXT
