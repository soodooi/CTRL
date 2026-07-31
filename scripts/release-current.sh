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

for command in lsof open osascript pgrep plutil stat; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "error: required canonical-release-acceptance command is unavailable: $command"
        exit 1
    fi
done

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

# Capture the old marker before checkout so the first dependency-fingerprint
# release can migrate a valid whole-lock marker without reinstalling packages.
# A changed dependency graph still fails this comparison and runs npm ci.
# (ADR-004 cap § updater v9)
CACHE_MARKER="$RELEASE_WORKTREE/node_modules/.ctrl-package-lock.sha256"
LEGACY_DEPENDENCY_HASH=""
if [[ -d "$RELEASE_WORKTREE/node_modules" && -f "$CACHE_MARKER" &&
      -f "$RELEASE_WORKTREE/package-lock.json" ]]; then
    PRIOR_CACHED_HASH="$(cat "$CACHE_MARKER")"
    PRIOR_WHOLE_LOCK_HASH="$(shasum -a 256 "$RELEASE_WORKTREE/package-lock.json" | awk '{print $1}')"
    if [[ "$PRIOR_CACHED_HASH" == "$PRIOR_WHOLE_LOCK_HASH" ]]; then
        LEGACY_DEPENDENCY_HASH="$(node "$SOURCE_ROOT/scripts/hash-npm-dependencies.mjs" \
            "$RELEASE_WORKTREE/package-lock.json")"
    fi
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

DEPENDENCY_HASH="$(node "$RELEASE_WORKTREE/scripts/hash-npm-dependencies.mjs" \
    "$RELEASE_WORKTREE/package-lock.json")"
CACHED_HASH=""
if [[ -f "$CACHE_MARKER" ]]; then
    CACHED_HASH="$(cat "$CACHE_MARKER")"
fi

if [[ ! -d "$RELEASE_WORKTREE/node_modules" ||
      ( "$CACHED_HASH" != "$DEPENDENCY_HASH" &&
        "$LEGACY_DEPENDENCY_HASH" != "$DEPENDENCY_HASH" ) ]]; then
    echo "npm dependencies: cache miss; running npm ci"
    (
        cd "$RELEASE_WORKTREE"
        npm ci
    )
else
    echo "npm dependencies: cache hit (dependency graph $DEPENDENCY_HASH)"
fi
printf '%s\n' "$DEPENDENCY_HASH" > "$CACHE_MARKER"

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


# Release publication is incomplete until the canonical bundle has been
# installed, launched, and proven at its canonical executable path.
# (ADR-004 cap §2 v12)
CANONICAL_APP="/Applications/CTRL.app"
CANONICAL_INFO="$CANONICAL_APP/Contents/Info.plist"

canonical_executable_path() {
    local executable
    [[ -f "$CANONICAL_INFO" ]] || return 0
    executable="$(plutil -extract CFBundleExecutable raw "$CANONICAL_INFO" 2>/dev/null || true)"
    if [[ -z "$executable" ]]; then
        echo "error: canonical CTRL.app has no CFBundleExecutable"
        return 1
    fi
    printf '%s/Contents/MacOS/%s\n' "$CANONICAL_APP" "$executable"
}

canonical_process_pids() {
    local expected_identity pid executable metadata process_device process_inode process_identity
    expected_identity="$(stat -f '%d:%i' "$CANONICAL_EXECUTABLE" 2>/dev/null)" || return 1
    [[ -n "$expected_identity" ]] || return 1
    while IFS= read -r pid; do
        metadata="$(lsof -a -p "$pid" -d txt -F nDi 2>/dev/null | awk '
            /^ftxt$/ { if (inside) exit; inside = 1; next }
            inside && /^[Di]/ { print }
            inside && /^n/ { print; exit }
        ')"
        executable="$(printf '%s\n' "$metadata" | sed -n 's/^n//p')"
        process_device="$(printf '%s\n' "$metadata" | sed -n 's/^D//p')"
        process_inode="$(printf '%s\n' "$metadata" | sed -n 's/^i//p')"
        if [[ "$executable" != "$CANONICAL_EXECUTABLE" || -z "$process_device" || -z "$process_inode" ]]; then
            echo "error: could not verify canonical CTRL.app executable identity for PID $pid" >&2
            return 1
        fi
        process_identity="$(printf '%d:%s' "$process_device" "$process_inode")" || return 1
        if [[ "$process_identity" != "$expected_identity" ]]; then
            echo "error: canonical CTRL.app executable identity changed for PID $pid" >&2
            return 1
        fi
        printf '%s\n' "$pid"
    done < <(pgrep -f 'CTRL[.]app/Contents/MacOS/' || true)
}

CANONICAL_EXECUTABLE="$(canonical_executable_path)" || exit 1
CANONICAL_RUNNING_PIDS=""
if [[ -n "$CANONICAL_EXECUTABLE" ]]; then
    CANONICAL_RUNNING_PIDS="$(canonical_process_pids)" || {
        echo "error: could not verify a candidate canonical CTRL.app process before replacement"
        exit 1
    }
fi
if [[ -n "$CANONICAL_EXECUTABLE" && -n "$CANONICAL_RUNNING_PIDS" ]]; then
    osascript -e 'tell application id "app.ctrl.spike" to quit' >/dev/null 2>&1 || true
    for _ in {1..30}; do
        CANONICAL_RUNNING_PIDS="$(canonical_process_pids)" || {
            echo "error: could not verify a candidate canonical CTRL.app process while waiting to quit"
            exit 1
        }
        [[ -z "$CANONICAL_RUNNING_PIDS" ]] && break
        sleep 1
    done
    if [[ -n "$CANONICAL_RUNNING_PIDS" ]]; then
        echo "error: canonical CTRL.app did not quit within 30 seconds; refusing replacement"
        exit 1
    fi
fi

bash scripts/install-verified-release.sh "$VERSION"

if [[ ! -f "$CANONICAL_INFO" ]]; then
    echo "error: verified install did not create $CANONICAL_INFO"
    exit 1
fi
INSTALLED_VERSION="$(plutil -extract CFBundleShortVersionString raw "$CANONICAL_INFO")"
if [[ "$INSTALLED_VERSION" != "$VERSION" ]]; then
    echo "error: canonical CTRL.app version is $INSTALLED_VERSION, expected $VERSION"
    exit 1
fi
EXPECTED_ID="$(node -p "require('./src-tauri/tauri.conf.json').identifier")"
POLICY_FINGERPRINT="$(jq -r '.activeFingerprint' scripts/macos-signing-trust.json)"
if ! [[ "$POLICY_FINGERPRINT" =~ ^[0-9A-F]{40}$ ]]; then
    echo "error: macOS signing policy has an invalid active fingerprint"
    exit 1
fi
EXPECTED_FINGERPRINT="$(tr '[:upper:]' '[:lower:]' <<< "$POLICY_FINGERPRINT")"
EXPECTED_REQUIREMENT="=identifier \"${EXPECTED_ID}\" and certificate root = H\"${EXPECTED_FINGERPRINT}\""
codesign --verify --deep --strict -R "$EXPECTED_REQUIREMENT" "$CANONICAL_APP"
CANONICAL_EXECUTABLE="$(canonical_executable_path)" || exit 1
if [[ -z "$CANONICAL_EXECUTABLE" ]]; then
    echo "error: canonical CTRL.app executable path is unavailable after install"
    exit 1
fi
open "$CANONICAL_APP"
for _ in {1..30}; do
    CANONICAL_PID="$(canonical_process_pids)" || {
        echo "error: could not verify a candidate canonical CTRL.app process after launch"
        exit 1
    }
    if [[ -n "$CANONICAL_PID" && "$CANONICAL_PID" != *$'\n'* ]]; then
        echo "canonical release acceptance passed: version=$VERSION executable=$CANONICAL_EXECUTABLE pid=$CANONICAL_PID"
        exit 0
    fi
    sleep 1
done
echo "error: canonical CTRL.app did not launch from $CANONICAL_EXECUTABLE"
exit 1
