#!/usr/bin/env bash
# Prepare a persistent clean release worktree, then delegate all release
# governance, signing, and publication to scripts/release.sh.
# (ADR-004 cap § updater v9)

set -euo pipefail

usage() {
    echo "usage: $0 [--prepare-only]"
}

PREPARE_ONLY="${CTRL_RELEASE_PREPARE_ONLY:-0}"
if [[ $# -gt 1 ]]; then
    usage
    exit 1
fi
if [[ $# -eq 1 ]]; then
    if [[ "$1" != "--prepare-only" ]]; then
        usage
        exit 1
    fi
    PREPARE_ONLY=1
fi
if [[ "$PREPARE_ONLY" != "0" && "$PREPARE_ONLY" != "1" ]]; then
    echo "error: CTRL_RELEASE_PREPARE_ONLY must be 0 or 1"
    exit 1
fi

SOURCE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SOURCE_ROOT"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "error: release source has tracked changes"
    echo "       commit the reviewed changes before preparing a release"
    exit 1
fi

SOURCE_COMMIT="$(git rev-parse HEAD)"
SOURCE_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
VERSION="$(node -p "require('./package.json').version")"
CONFIGURED_WORKTREE="${CTRL_RELEASE_WORKTREE:-$HOME/.cache/ctrl/release-worktree}"
mkdir -p "$(dirname "$CONFIGURED_WORKTREE")"
RELEASE_PARENT="$(cd "$(dirname "$CONFIGURED_WORKTREE")" && pwd -P)"
RELEASE_WORKTREE="$RELEASE_PARENT/$(basename "$CONFIGURED_WORKTREE")"
LOCK_DIR="$RELEASE_WORKTREE.lock"

# One process owns checkout, dependency preparation, and publication for this
# persistent cache at a time. A stale lock is intentionally removed manually.
# (ADR-004 cap § updater v9)
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "error: another release process owns $RELEASE_WORKTREE"
    echo "       if no release is running, remove the stale lock: $LOCK_DIR"
    exit 1
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

if [[ "$RELEASE_WORKTREE" == "$SOURCE_ROOT" ]]; then
    echo "error: CTRL_RELEASE_WORKTREE must not be the source worktree"
    exit 1
fi

EXPECTED_OWNER_MARKER="$SOURCE_COMMON_DIR
$RELEASE_WORKTREE"
if [[ -e "$RELEASE_WORKTREE" ]]; then
    if ! git -C "$RELEASE_WORKTREE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        echo "error: release worktree path exists but is not a Git worktree: $RELEASE_WORKTREE"
        exit 1
    fi
    RELEASE_ROOT="$(git -C "$RELEASE_WORKTREE" rev-parse --show-toplevel)"
    RELEASE_COMMON_DIR="$(git -C "$RELEASE_WORKTREE" rev-parse --path-format=absolute --git-common-dir)"
    RELEASE_GIT_DIR="$(git -C "$RELEASE_WORKTREE" rev-parse --path-format=absolute --git-dir)"
    OWNER_MARKER="$RELEASE_GIT_DIR/ctrl-release-worktree"
    if [[ "$RELEASE_ROOT" != "$RELEASE_WORKTREE" || "$RELEASE_COMMON_DIR" != "$SOURCE_COMMON_DIR" ]]; then
        echo "error: release worktree does not belong to this repository: $RELEASE_WORKTREE"
        exit 1
    fi
    if [[ ! -f "$OWNER_MARKER" || "$(cat "$OWNER_MARKER")" != "$EXPECTED_OWNER_MARKER" ]]; then
        echo "error: existing worktree was not created as this repository's release worktree"
        echo "       choose an unused CTRL_RELEASE_WORKTREE path"
        exit 1
    fi
    if [[ -n "$(git -C "$RELEASE_WORKTREE" status --porcelain --untracked-files=normal)" ]]; then
        echo "error: persistent release worktree contains tracked or untracked changes"
        echo "       inspect and clean it manually: $RELEASE_WORKTREE"
        exit 1
    fi
    echo "release worktree: reusing $RELEASE_WORKTREE"
else
    git worktree add --detach "$RELEASE_WORKTREE" "$SOURCE_COMMIT"
    RELEASE_GIT_DIR="$(git -C "$RELEASE_WORKTREE" rev-parse --path-format=absolute --git-dir)"
    OWNER_MARKER="$RELEASE_GIT_DIR/ctrl-release-worktree"
    printf '%s\n' "$EXPECTED_OWNER_MARKER" > "$OWNER_MARKER"
    echo "release worktree: created $RELEASE_WORKTREE"
fi

# Checkout only after cleanliness and purpose ownership are proven. Ignored
# node_modules and Cargo target content remain available for incremental builds.
# (ADR-004 cap § updater v9)
git -C "$RELEASE_WORKTREE" checkout --detach "$SOURCE_COMMIT"

WORKTREE_COMMIT="$(git -C "$RELEASE_WORKTREE" rev-parse HEAD)"
WORKTREE_VERSION="$(node -p "require('$RELEASE_WORKTREE/package.json').version")"
if [[ "$WORKTREE_COMMIT" != "$SOURCE_COMMIT" || "$WORKTREE_VERSION" != "$VERSION" ]]; then
    echo "error: prepared worktree does not match source commit/version"
    exit 1
fi

LOCK_HASH="$(shasum -a 256 "$RELEASE_WORKTREE/package-lock.json" | awk '{print $1}')"
LOCK_MARKER="$RELEASE_WORKTREE/node_modules/.ctrl-package-lock.sha256"
CACHED_HASH=""
if [[ -f "$LOCK_MARKER" ]]; then
    CACHED_HASH="$(cat "$LOCK_MARKER")"
fi

if [[ ! -d "$RELEASE_WORKTREE/node_modules" || "$CACHED_HASH" != "$LOCK_HASH" ]]; then
    echo "npm dependencies: cache miss; running npm ci"
    (
        cd "$RELEASE_WORKTREE"
        npm ci
    )
    printf '%s\n' "$LOCK_HASH" > "$LOCK_MARKER"
else
    echo "npm dependencies: cache hit ($LOCK_HASH)"
fi

echo "Cargo cache: persistent at $RELEASE_WORKTREE/src-tauri/target"
echo "prepared commit: $SOURCE_COMMIT"
echo "prepared version: $VERSION"

if [[ "$PREPARE_ONLY" == "1" ]]; then
    echo "prepare-only: release publication skipped"
    exit 0
fi

# release.sh remains the sole authority for release gates, complete bundle
# signing, updater archives, publication, and downloaded-pair verification.
# (ADR-004 cap § updater v9)
cd "$RELEASE_WORKTREE"
bash scripts/release.sh "$VERSION"
