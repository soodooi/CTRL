#!/usr/bin/env bash
# Perform the one verified canonical-path replacement required when an older
# installation cannot authenticate a new updater trust epoch. The replacement
# must also match the tracked macOS release-identity epoch.
# (ADR-004 cap § updater v9)

set -euo pipefail
VERSION="${1:-}"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "usage: $0 <version>"
    exit 1
fi
for command in gh jq minisign node shasum codesign tar; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "error: required verified-install command is unavailable: $command"
        exit 1
    fi
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REPO_SRC="soodooi/CTRL"
REPO_RELEASES="soodooi/CTRL-releases"
RELEASE_TAG="v${VERSION}"
SOURCE_TAG="v${VERSION}-release"
ARCHIVE_NAME="CTRL_${VERSION}_aarch64.app.tar.gz"
TARGET_APP="/Applications/CTRL.app"
TRANSACTION_FILE="/Applications/.ctrl-install-transaction.json"

recover_install_transaction() {
    local phase had_target backup stage
    [[ -f "$TRANSACTION_FILE" ]] || return 0
    phase="$(jq -r '.phase // empty' "$TRANSACTION_FILE")"
    had_target="$(jq -r '.hadTarget // false' "$TRANSACTION_FILE")"
    backup="$(jq -r '.backup // empty' "$TRANSACTION_FILE")"
    stage="$(jq -r '.stage // empty' "$TRANSACTION_FILE")"
    if [[ "$had_target" = true && -d "$backup" ]]; then
        rm -rf "$TARGET_APP"
        mv "$backup" "$TARGET_APP"
        echo "recovered previous CTRL.app from interrupted verified install"
    elif [[ "$had_target" = false && "$phase" != prepared ]]; then
        rm -rf "$TARGET_APP"
    fi
    [[ -z "$stage" ]] || rm -rf "$stage"
    rm -f "$TRANSACTION_FILE"
}

write_install_phase() {
    local phase="$1" temp_file
    temp_file="${TRANSACTION_FILE}.tmp.$$"
    jq --arg phase "$phase" '.phase = $phase' "$TRANSACTION_FILE" > "$temp_file"
    mv "$temp_file" "$TRANSACTION_FILE"
}

recover_install_transaction
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ctrl-verified-install.XXXXXX")"
STAGE_DIR=""
BACKUP_APP=""
cleanup() {
    local status="$?"
    rm -rf "$WORK_DIR"
    if [[ "$status" -ne 0 ]]; then
        recover_install_transaction
    fi
    if [[ -n "$STAGE_DIR" ]]; then
        rm -rf "$STAGE_DIR"
    fi
    return "$status"
}
trap cleanup EXIT

gh release download "$RELEASE_TAG" --repo "$REPO_RELEASES" \
    --pattern latest.json --pattern "$ARCHIVE_NAME" --dir "$WORK_DIR"
LATEST="$WORK_DIR/latest.json"
ARCHIVE="$WORK_DIR/$ARCHIVE_NAME"
if ! jq -e 'type == "object"' "$LATEST" >/dev/null; then
    echo "error: published latest.json is invalid"
    exit 1
fi
SOURCE_COMMIT="$(jq -r '.source_commit // empty' "$LATEST")"
METADATA_SOURCE_TAG="$(jq -r '.source_tag // empty' "$LATEST")"
METADATA_VERSION="$(jq -r '.version // empty' "$LATEST")"
METADATA_URL="$(jq -r '.platforms["darwin-aarch64"].url // empty' "$LATEST")"
METADATA_SIGNATURE="$(jq -r '.platforms["darwin-aarch64"].signature // empty' "$LATEST")"
EXPECTED_SHA256="$(jq -r '.archive_sha256 // empty' "$LATEST")"
EXPECTED_URL="https://github.com/${REPO_RELEASES}/releases/download/${RELEASE_TAG}/${ARCHIVE_NAME}"
if ! [[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] ||
   [[ "$METADATA_SOURCE_TAG" != "$SOURCE_TAG" || "$METADATA_VERSION" != "$VERSION" ||
      "$METADATA_URL" != "$EXPECTED_URL" || ! "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
    echo "error: published updater metadata is not bound to the requested release"
    exit 1
fi
REMOTE_SOURCE_COMMIT="$(git ls-remote --tags --refs "https://github.com/${REPO_SRC}.git" \
    "refs/tags/${SOURCE_TAG}" | awk 'NR == 1 {print $1}')"
RELEASE_BODY="$(gh release view "$RELEASE_TAG" --repo "$REPO_RELEASES" --json body --jq '.body')"
BODY_COMMIT="$(awk '/^Source commit:/{sub(/^Source commit:[[:space:]]*/, ""); print}' <<< "$RELEASE_BODY")"
BODY_TAG="$(awk '/^Source tag:/{sub(/^Source tag:[[:space:]]*/, ""); print}' <<< "$RELEASE_BODY")"
if [[ "$REMOTE_SOURCE_COMMIT" != "$SOURCE_COMMIT" || "$BODY_COMMIT" != "$SOURCE_COMMIT" ||
      "$BODY_TAG" != "$SOURCE_TAG" ]]; then
    echo "error: release body, source tag, and updater metadata provenance disagree"
    exit 1
fi
ACTUAL_SHA256="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
    echo "error: downloaded updater archive hash mismatch"
    exit 1
fi
PINNED_PUBLIC_KEY="$(node -p "require('./src-tauri/tauri.conf.json').plugins.updater.pubkey")"
PINNED_MINISIGN_KEY="$(node -e '
  const decoded = Buffer.from(process.argv[1], "base64").toString("utf8").trim().split(/\r?\n/);
  process.stdout.write(decoded[1] || "");
' "$PINNED_PUBLIC_KEY")"
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[2], Buffer.from(process.argv[1], "base64"));
' "$METADATA_SIGNATURE" "$WORK_DIR/archive.minisig"
if ! minisign -Vm "$ARCHIVE" -P "$PINNED_MINISIGN_KEY" \
        -x "$WORK_DIR/archive.minisig" -q >/dev/null 2>&1; then
    echo "error: downloaded updater archive signature is invalid for the active trust epoch"
    exit 1
fi

STAGE_DIR="$(mktemp -d "/Applications/.ctrl-install-${VERSION}.XXXXXX")"
tar -xzf "$ARCHIVE" -C "$STAGE_DIR"
STAGED_APP="$STAGE_DIR/CTRL.app"
if [[ ! -d "$STAGED_APP" ]]; then
    echo "error: updater archive does not contain CTRL.app at its canonical root"
    exit 1
fi
EXPECTED_ID="$(node -p "require('./src-tauri/tauri.conf.json').identifier")"
CONFIGURED_FINGERPRINT="$(node -p "require('./src-tauri/tauri.conf.json').bundle.macOS.signingIdentity.toUpperCase()")"
POLICY_FINGERPRINT="$(jq -r '.activeFingerprint' scripts/macos-signing-trust.json)"
if [[ ! "$POLICY_FINGERPRINT" =~ ^[0-9A-F]{40}$ ||
      "$CONFIGURED_FINGERPRINT" != "$POLICY_FINGERPRINT" ]]; then
    echo "error: configured macOS signing identity does not match the tracked identity epoch"
    exit 1
fi
EXPECTED_FINGERPRINT="$(tr '[:upper:]' '[:lower:]' <<< "$POLICY_FINGERPRINT")"
# Verify independently constructed identifier + certificate-root requirements;
# never trust signer-controlled embedded requirement text. (ADR-004 cap § updater v9)
verify_app_identity() {
    local app="$1" details requirement normalized_requirement expected_requirement
    expected_requirement="=identifier \"${EXPECTED_ID}\" and certificate root = H\"${EXPECTED_FINGERPRINT}\""
    codesign --verify --deep --strict -R "$expected_requirement" --verbose=4 "$app"
    details="$(codesign -dv --verbose=4 "$app" 2>&1)"
    requirement="$(codesign -d -r- "$app" 2>&1)"
    normalized_requirement="$(tr '[:upper:]' '[:lower:]' <<< "$requirement")"
    if [[ "$details" == *"Signature=adhoc"* || "$details" != *"Authority="* ||
          "$normalized_requirement" == *"cdhash"* ]]; then
        echo "error: CTRL.app does not preserve the configured certificate-bound identity"
        return 1
    fi
}
verify_app_identity "$STAGED_APP"

if pgrep -f '^/Applications/CTRL\.app/Contents/MacOS/ctrl$' >/dev/null 2>&1; then
    echo "error: quit the canonical CTRL.app before verified replacement"
    exit 1
fi
HAD_TARGET=false
if [[ -d "$TARGET_APP" ]]; then
    HAD_TARGET=true
    BACKUP_APP="/Applications/CTRL.app.rollback-$(date -u +%Y%m%dT%H%M%SZ)"
    if [[ -e "$BACKUP_APP" ]]; then
        echo "error: rollback path already exists: $BACKUP_APP"
        exit 1
    fi
fi
jq -n \
    --arg phase prepared \
    --arg target "$TARGET_APP" \
    --arg backup "$BACKUP_APP" \
    --arg stage "$STAGE_DIR" \
    --arg version "$VERSION" \
    --arg source_commit "$SOURCE_COMMIT" \
    --argjson had_target "$HAD_TARGET" \
    '{phase: $phase, target: $target, backup: $backup, stage: $stage,
      version: $version, sourceCommit: $source_commit, hadTarget: $had_target}' \
    > "$TRANSACTION_FILE"
chmod 600 "$TRANSACTION_FILE"
if [[ "$HAD_TARGET" = true ]]; then
    mv "$TARGET_APP" "$BACKUP_APP"
fi
write_install_phase old-backed-up
write_install_phase installing
mv "$STAGED_APP" "$TARGET_APP"
write_install_phase new-installed
verify_app_identity "$TARGET_APP"
INSTALLED_VERSION="$(defaults read "$TARGET_APP/Contents/Info" CFBundleShortVersionString)"
INSTALLED_ID="$(defaults read "$TARGET_APP/Contents/Info" CFBundleIdentifier)"
if [[ "$INSTALLED_VERSION" != "$VERSION" || "$INSTALLED_ID" != "$EXPECTED_ID" ]]; then
    echo "error: installed CTRL.app metadata does not match the verified release"
    exit 1
fi
rm -rf "$STAGE_DIR"
STAGE_DIR=""
rm -f "$TRANSACTION_FILE"
echo "verified canonical install complete: version=$VERSION source=$SOURCE_COMMIT"
[[ -z "$BACKUP_APP" ]] || echo "rollback backup retained: $BACKUP_APP"
