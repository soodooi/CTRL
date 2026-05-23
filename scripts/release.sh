#!/usr/bin/env bash
# One-shot release for the dev machine. Builds + signs CTRL.app, uploads
# the .app.tar.gz + latest.json to the public soodooi/CTRL-releases sibling
# repo so Tauri's auto-updater finds them.
#
# Usage:   scripts/release.sh <version>    e.g.  scripts/release.sh 0.1.1
#
# Prereqs (one-time per machine):
#   1. Tauri signing key in ~/.tauri/ctrl.key (generated via
#      `npx tauri signer generate -w ~/.tauri/ctrl.key --ci --password ""`)
#   2. Private key copied into macOS Keychain:
#        security add-generic-password -s tauri-sign -a ctrl-updater \
#          -w "$(cat ~/.tauri/ctrl.key)" -U
#   3. `gh` CLI authenticated (`gh auth login`)
#   4. Public release repo: `gh repo create soodooi/CTRL-releases --public`
#      (run once; the script doesn't create it)
#
# What it does:
#   1. Pulls the Tauri private key from Keychain → env var
#   2. Bumps Cargo.toml + tauri.conf.json `version` to the requested value
#   3. Builds aarch64-apple-darwin .app + .app.tar.gz + .sig
#   4. Generates latest.json with the embedded signature + download URL
#   5. Uploads everything to soodooi/CTRL-releases as a release tag
#
# After running: bao clicks "Check for Updates" in CTRL → finds new
# version → downloads + replaces /Applications/CTRL.app silently.

set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
    echo "usage: $0 <version>      e.g.  $0 0.1.1"
    exit 1
fi
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "error: version must be semver MAJOR.MINOR.PATCH (got: $VERSION)"
    exit 1
fi

REPO_SRC="soodooi/CTRL"
REPO_RELEASES="soodooi/CTRL-releases"
TARGET="aarch64-apple-darwin"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> [1/6] pull Tauri signing key from Keychain"
KEY=$(security find-generic-password -s tauri-sign -a ctrl-updater -w 2>/dev/null || true)
if [[ -z "$KEY" ]]; then
    echo "error: tauri-sign keychain entry missing — see prereqs at top of this script"
    exit 1
fi
export TAURI_SIGNING_PRIVATE_KEY="$KEY"
# Password may be optional (key generated with empty password); export
# empty string so the signer accepts it without an interactive prompt.
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

echo "==> [2/6] bump versions in Cargo.toml + tauri.conf.json to $VERSION"
sed -i '' "s/^version = \"[0-9.]*\"$/version = \"$VERSION\"/" src-tauri/Cargo.toml
sed -i '' "s/\"version\": \"[0-9.]*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json
# Sync Cargo.lock so the build doesn't error on lockfile drift.
(cd src-tauri && cargo update -p ctrl --offline 2>/dev/null || cargo update -p ctrl) >/dev/null 2>&1 || true

echo "==> [3/6] build for $TARGET"
npm run tauri:build -- --target "$TARGET"

BUNDLE_DIR="src-tauri/target/$TARGET/release/bundle/macos"
TARBALL="$BUNDLE_DIR/CTRL.app.tar.gz"
SIGFILE="$TARBALL.sig"
if [[ ! -f "$TARBALL" || ! -f "$SIGFILE" ]]; then
    echo "error: updater artifacts missing — check tauri.conf.json bundle.createUpdaterArtifacts: true"
    echo "       expected: $TARBALL + $SIGFILE"
    exit 1
fi

RENAMED_TARBALL="CTRL_${VERSION}_aarch64.app.tar.gz"
WORK=$(mktemp -d)
cp "$TARBALL" "$WORK/$RENAMED_TARBALL"

echo "==> [4/6] build latest.json"
SIGNATURE_CONTENT="$(cat "$SIGFILE")"
PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMMIT_SUBJECT="$(git log -1 --pretty=%s)"
DOWNLOAD_URL="https://github.com/${REPO_RELEASES}/releases/download/v${VERSION}/${RENAMED_TARBALL}"

# jq for safe escaping of the multiline signature content.
jq -n \
    --arg version "$VERSION" \
    --arg notes "$COMMIT_SUBJECT" \
    --arg pub_date "$PUB_DATE" \
    --arg signature "$SIGNATURE_CONTENT" \
    --arg url "$DOWNLOAD_URL" \
    '{
        version: $version,
        notes: $notes,
        pub_date: $pub_date,
        platforms: {
            "darwin-aarch64": { signature: $signature, url: $url }
        }
    }' > "$WORK/latest.json"

echo "==> [5/6] upload to ${REPO_RELEASES} v${VERSION}"
# Delete an existing tag of the same name first so re-runs of the same
# version don't error. Idempotent on first run (release absent → noop).
gh release delete "v${VERSION}" --repo "$REPO_RELEASES" --yes 2>/dev/null || true
git push --delete origin "v${VERSION}-release" 2>/dev/null || true

gh release create "v${VERSION}" \
    --repo "$REPO_RELEASES" \
    --title "CTRL ${VERSION}" \
    --notes "$COMMIT_SUBJECT" \
    "$WORK/$RENAMED_TARBALL" \
    "$WORK/latest.json"

echo "==> [6/6] done"
echo "Release URL: https://github.com/${REPO_RELEASES}/releases/tag/v${VERSION}"
echo "latest.json: $DOWNLOAD_URL"
echo
echo "In CTRL.app: Settings → About → Check for Updates → installs v${VERSION}"
