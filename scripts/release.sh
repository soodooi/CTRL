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

echo "==> [0/8] ADR acceptance audit — block ship if any ADR has open [ ] item"
# bao 2026-05-31 directive: "全量开发 架构都定了, 增加 hook, 要按照 ADR".
# memory feedback_use_adr_acceptance_as_checklist makes this gate
# load-bearing — open ADR acceptance items can't be silently shipped past.
# Use ADR_AUDIT_SOFT=1 to downgrade to a warning (only for emergency hot-fix ships).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "${ADR_AUDIT_SOFT:-0}" = "1" ]]; then
    bash "$SCRIPT_DIR/check-adr-acceptance.sh" --soft || true
else
    if ! bash "$SCRIPT_DIR/check-adr-acceptance.sh"; then
        echo "error: ADR acceptance gate failed — close open items or set ADR_AUDIT_SOFT=1 to override"
        exit 1
    fi
fi

echo "==> [1/8] pull Tauri signing key from Keychain"
KEY=$(security find-generic-password -s tauri-sign -a ctrl-updater -w 2>/dev/null || true)
if [[ -z "$KEY" ]]; then
    echo "error: tauri-sign keychain entry missing — see prereqs at top of this script"
    exit 1
fi
export TAURI_SIGNING_PRIVATE_KEY="$KEY"
# Password may be optional (key generated with empty password); export
# empty string so the signer accepts it without an interactive prompt.
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

# Code-sign CTRL.app with the stable self-signed cert so its macOS
# Designated Requirement stays CONSTANT across releases. Without this the
# build is ad-hoc signed (DR = cdhash, changes every build) and macOS drops
# the Input Monitoring grant on every upgrade — i.e. the Ctrl hotkey dies
# after each update. The cert lives in a dedicated keychain; unlock it so
# codesign can use the identity non-interactively. See memory
# troubleshoot_ctrl_hotkey for the full rationale.
export APPLE_SIGNING_IDENTITY="CTRL Dev Signing"
SIGN_KC="$HOME/Library/Keychains/ctrl-signing.keychain-db"
if [[ -f "$SIGN_KC" ]]; then
    security unlock-keychain -p "ctrl-signing-local" "$SIGN_KC" 2>/dev/null || true
else
    echo "error: signing keychain $SIGN_KC missing — the released app would be"
    echo "       ad-hoc signed and lose Input Monitoring on upgrade. Aborting."
    exit 1
fi

echo "==> [2/6] bump versions in Cargo.toml + tauri.conf.json + workspace package.json files to $VERSION"
sed -i '' "s/^version = \"[0-9.]*\"$/version = \"$VERSION\"/" src-tauri/Cargo.toml
sed -i '' "s/\"version\": \"[0-9.]*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json
# PWA bundle reads `__APP_VERSION__` from packages/ctrl-web/package.json
# (see vite.config.ts). Without bumping these two files the version pill /
# Settings / Irisy footer all show the stale npm-side version even when
# the Rust binary reports the correct one via `app_meta`.
sed -i '' "s/\"version\": \"[0-9.]*\"/\"version\": \"$VERSION\"/" package.json
sed -i '' "s/\"version\": \"[0-9.]*\"/\"version\": \"$VERSION\"/" packages/ctrl-web/package.json
# Sync Cargo.lock so the build doesn't error on lockfile drift.
(cd src-tauri && cargo update -p ctrl --offline 2>/dev/null || cargo update -p ctrl) >/dev/null 2>&1 || true

echo "==> [3/7] build for $TARGET (app-only bundle; DMG step is flaky on this machine)"
# bundle_dmg.sh has intermittently failed on this dev box (rw.NNNNN.dmg
# leftover from a prior aborted run blocks DMG creation). The updater
# only needs .app + .app.tar.gz + .sig, so restrict to `app` bundle —
# DMG is a developer convenience, not a ship artifact.
npm run tauri:build -- --target "$TARGET" --bundles app

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

# ADR-002 substrate § provider v1 lock #4 — trial verify before set_active commits. bao 2026-05-31
# (118-trail rationale): shipped 5+ broken brain integrations because
# `cargo check` proved compile, never proved runtime. This probe spawns Pi
# with the bundled bridge + a stub kernel and asserts Pi prints the expected
# token. Without it, a regression in the bridge ⇄ Pi protocol ships silently.
echo "==> [3a/7] runtime probe — wrapper ⇄ Pi RpcClient ⇄ bridge round-trip"
if ! node --experimental-strip-types scripts/probes/pi-bridge-probe.mjs; then
    echo "error: Pi ⇄ bridge probe failed — refusing to publish ${VERSION}"
    echo "       fix packages/ctrl-pi-bridge/src/index.ts or re-run with"
    echo "       a brain that boots before retrying release.sh."
    exit 1
fi

echo "==> [4/7] build latest.json"
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

echo "==> [5/7] upload to ${REPO_RELEASES} v${VERSION}"
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

echo "==> [6/7] verify release published"
# `gh release create` returns 0 even when the upload silently fails on some
# transient network conditions (0.1.118 / 0.1.119 trail). Re-fetch the
# release and confirm the artifact is actually listed.
sleep 2
if ! gh release view "v${VERSION}" --repo "$REPO_RELEASES" --json assets \
        --jq '.assets[].name' | grep -q "$RENAMED_TARBALL"; then
    echo "error: release v${VERSION} was created but ${RENAMED_TARBALL} is"
    echo "       not in its asset list — upload silently failed."
    exit 1
fi

echo "==> [7/7] done"
echo "Release URL: https://github.com/${REPO_RELEASES}/releases/tag/v${VERSION}"
echo "latest.json: $DOWNLOAD_URL"
echo
echo "In CTRL.app: Settings → About → Check for Updates → installs v${VERSION}"
