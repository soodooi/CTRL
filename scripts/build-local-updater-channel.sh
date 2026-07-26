#!/bin/bash
set -euo pipefail

# Build a signed localhost-only A/B updater channel without invoking any public
# release mutation. Output lives under src-tauri/target and is never published.
# (ADR-004 cap § updater v11)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="aarch64-apple-darwin"
LOCAL_PORT="${CTRL_UPDATER_DEBUG_PORT:-17874}"
ENDPOINT="http://127.0.0.1:${LOCAL_PORT}/latest.json"
SOURCE_VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
A_VERSION="${1:-$SOURCE_VERSION}"
B_VERSION="${2:-$(node -e 'const [a,b,c]=process.argv[1].split(".").map(Number); process.stdout.write(`${a}.${b}.${c + 1}`)' "$A_VERSION")}"
OUTPUT_ROOT="$ROOT/src-tauri/target/updater-debug-channel"
BUNDLE_DIR="$ROOT/src-tauri/target/$TARGET/release/bundle/macos"
APP_BUNDLE="$BUNDLE_DIR/CTRL.app"
TARBALL="$APP_BUNDLE.tar.gz"
SIGFILE="$TARBALL.sig"
FORMAL_ENDPOINT="$(node -p "require('./src-tauri/tauri.conf.json').plugins.updater.endpoints[0]")"

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "error: the signed local updater channel can only be built on macOS"
    exit 1
fi
if [[ ! "$LOCAL_PORT" =~ ^[0-9]+$ ]] || (( LOCAL_PORT < 1024 || LOCAL_PORT > 65535 )); then
    echo "error: CTRL_UPDATER_DEBUG_PORT must be an unprivileged TCP port"
    exit 1
fi
if [[ ! "$A_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || ! "$B_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "error: A and B versions must be plain semantic versions"
    exit 1
fi
if ! node -e '
  const [a, b] = process.argv.slice(1).map(value => value.split(".").map(Number));
  const newer = b.some((value, index) => value > a[index] && b.slice(0, index).every((part, i) => part === a[i]));
  process.exit(newer ? 0 : 1);
' "$A_VERSION" "$B_VERSION"; then
    echo "error: B version must be newer than A version"
    exit 1
fi
if [[ "$FORMAL_ENDPOINT" == "$ENDPOINT" || "$ENDPOINT" != http://127.0.0.1:*'/latest.json' ]]; then
    echo "error: local updater endpoint isolation check failed"
    exit 1
fi
if [[ "$OUTPUT_ROOT" != "$ROOT/src-tauri/target/"* ]]; then
    echo "error: local updater output escaped src-tauri/target"
    exit 1
fi
for command in node npm jq minisign codesign security plutil ditto shasum; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "error: required command is unavailable: $command"
        exit 1
    fi
done

bash scripts/check-updater-trust.sh
bash scripts/check-macos-signing-identity.sh

UPDATER_PUBKEY_B64="$(node -p "require('./src-tauri/tauri.conf.json').plugins.updater.pubkey")"
UPDATER_MINISIGN_PUBKEY="$(node -e '
  const lines = Buffer.from(process.argv[1], "base64").toString("utf8").trim().split(/\r?\n/);
  process.stdout.write(lines[1] || "");
' "$UPDATER_PUBKEY_B64")"
if [[ ! "$UPDATER_MINISIGN_PUBKEY" =~ ^[A-Za-z0-9+/=]+$ ]]; then
    echo "error: updater public key in tauri.conf.json is invalid"
    exit 1
fi

KEY_DIR="$(mktemp -d)"
chmod 700 "$KEY_DIR"
KEY_FILE="$KEY_DIR/private.key"
: > "$KEY_FILE"
chmod 600 "$KEY_FILE"
cleanup() {
    unset BUILD_KEY
    rm -rf "$KEY_DIR"
}
trap cleanup EXIT
security find-generic-password -s tauri-sign -a ctrl-updater -w > "$KEY_FILE" 2>/dev/null
if [[ ! -s "$KEY_FILE" ]]; then
    echo "error: updater signing key is unavailable"
    exit 1
fi
CTRL_UPDATER_PRIVATE_KEY_FILE="$KEY_FILE" bash scripts/check-updater-trust.sh

APPLE_SIGNING_IDENTITY="$(node -p "require('./src-tauri/tauri.conf.json').bundle.macOS.signingIdentity")"
BUNDLE_IDENTIFIER="$(node -p "require('./src-tauri/tauri.conf.json').identifier")"
SIGNING_MATCH="$(security find-identity -p codesigning 2>/dev/null | awk -v requested="$APPLE_SIGNING_IDENTITY" '
    BEGIN { requested = tolower(requested) }
    /Valid identities only/ { exit }
    {
        fingerprint = tolower($2)
        label = $0
        sub(/^[[:space:]]*[0-9]+\)[[:space:]]+[0-9A-Fa-f]+[[:space:]]+"/, "", label)
        sub(/"[[:space:]]*$/, "", label)
        if (fingerprint == requested || tolower(label) == requested) print $0
    }
')"
if [[ "$(wc -l <<< "$SIGNING_MATCH" | tr -d ' ')" -ne 1 || -z "$SIGNING_MATCH" ]]; then
    echo "error: configured macOS signing identity is unavailable or ambiguous"
    exit 1
fi
SIGNING_FINGERPRINT="$(awk '{print tolower($2)}' <<< "$SIGNING_MATCH")"
SIGNING_LABEL="$(sed -E 's/^[^"]*"([^"]+)".*$/\1/' <<< "$SIGNING_MATCH")"
export APPLE_SIGNING_IDENTITY

verify_app() {
    local app_bundle="$1" expected_version="$2" details requirement normalized_requirement actual_version
    codesign --verify --deep --strict --verbose=4 "$app_bundle"
    details="$(codesign -dv --verbose=4 "$app_bundle" 2>&1)"
    if [[ "$details" != *"Authority=${SIGNING_LABEL}"* || "$details" == *"Signature=adhoc"* ]]; then
        echo "error: local updater app is not signed by the active identity"
        return 1
    fi
    requirement="$(codesign -d -r- "$app_bundle" 2>&1)"
    normalized_requirement="$(tr '[:upper:]' '[:lower:]' <<< "$requirement")"
    if [[ "$normalized_requirement" != *"identifier \"${BUNDLE_IDENTIFIER}\""* ||
          "$normalized_requirement" != *"certificate root = h\"${SIGNING_FINGERPRINT}\""* ||
          "$normalized_requirement" == *"cdhash"* ]]; then
        echo "error: local updater app has an unstable or unexpected Designated Requirement"
        return 1
    fi
    actual_version="$(plutil -extract CFBundleShortVersionString raw -o - "$app_bundle/Contents/Info.plist")"
    if [[ "$actual_version" != "$expected_version" ]]; then
        echo "error: local updater app version mismatch: expected $expected_version, found $actual_version"
        return 1
    fi
}

build_version() {
    local version="$1" destination="$2" local_config
    rm -rf "$APP_BUNDLE"
    rm -f "$TARBALL" "$SIGFILE"
    # Keep the static plugin endpoint on its governed HTTPS URL so plugin
    # initialization never deserializes a localhost endpoint. Only this signed
    # debug build opts into insecure transport, allowing the feature-gated
    # native updater builder to replace the request list with loopback HTTP.
    # The tracked production config remains fail-closed.
    local_config="$(jq -cn --arg version "$version" '{
        version: $version,
        plugins: {
            updater: {
                dangerousInsecureTransportProtocol: true
            }
        }
    }')"
    BUILD_KEY="$(cat "$KEY_FILE")"
    if ! CTRL_UPDATER_DEBUG_VERSION="$version" \
         CTRL_UPDATER_DEBUG_ENDPOINT="$ENDPOINT" \
         TAURI_SIGNING_PRIVATE_KEY="$BUILD_KEY" \
         TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
         npm run tauri -- build --target "$TARGET" --bundles app \
             --features updater-debug-channel --config "$local_config"; then
        unset BUILD_KEY
        return 1
    fi
    unset BUILD_KEY
    verify_app "$APP_BUNDLE" "$version"
    if [[ ! -f "$TARBALL" || ! -f "$SIGFILE" ]]; then
        echo "error: Tauri did not produce the updater archive and signature"
        return 1
    fi
    mkdir -p "$destination"
    ditto "$APP_BUNDLE" "$destination/CTRL.app"
    python3 - "$destination/CTRL.app/Contents/MacOS/ctrl" "$ENDPOINT" <<'PY'
import pathlib
import sys

binary = pathlib.Path(sys.argv[1]).read_bytes()
local_endpoint = sys.argv[2].encode()
if local_endpoint not in binary:
    raise SystemExit("error: local endpoint is absent from updater debug binary")
PY
}

rm -rf "$OUTPUT_ROOT"
mkdir -p "$OUTPUT_ROOT/A" "$OUTPUT_ROOT/B"
chmod 700 "$OUTPUT_ROOT" "$OUTPUT_ROOT/A" "$OUTPUT_ROOT/B"

echo "==> build signed local baseline A $A_VERSION"
build_version "$A_VERSION" "$OUTPUT_ROOT/A"

echo "==> build signed local candidate B $B_VERSION"
build_version "$B_VERSION" "$OUTPUT_ROOT/B"
cp "$TARBALL" "$OUTPUT_ROOT/B/CTRL_${B_VERSION}_aarch64.app.tar.gz"
cp "$SIGFILE" "$OUTPUT_ROOT/B/CTRL_${B_VERSION}_aarch64.app.tar.gz.sig"

ARCHIVE="$OUTPUT_ROOT/B/CTRL_${B_VERSION}_aarch64.app.tar.gz"
ARCHIVE_SIG="$ARCHIVE.sig"
SIGNATURE_DIR="$(mktemp -d)"
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[2], Buffer.from(fs.readFileSync(process.argv[1], "utf8").trim(), "base64"));
' "$ARCHIVE_SIG" "$SIGNATURE_DIR/archive.minisig"
if ! minisign -Vm "$ARCHIVE" -P "$UPDATER_MINISIGN_PUBKEY" \
        -x "$SIGNATURE_DIR/archive.minisig" -q >/dev/null 2>&1; then
    rm -rf "$SIGNATURE_DIR"
    echo "error: local B archive is not signed by the pinned updater key"
    exit 1
fi
rm -rf "$SIGNATURE_DIR"

SIGNATURE_CONTENT="$(cat "$ARCHIVE_SIG")"
ARCHIVE_SHA256="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
ARCHIVE_NAME="$(basename "$ARCHIVE")"
DOWNLOAD_URL="http://127.0.0.1:${LOCAL_PORT}/B/${ARCHIVE_NAME}"
PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SOURCE_COMMIT="$(git rev-parse HEAD)"
SOURCE_DIRTY="$(if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then printf true; else printf false; fi)"

jq -n \
    --arg version "$B_VERSION" \
    --arg notes "Local signed updater A/B debug candidate" \
    --arg pub_date "$PUB_DATE" \
    --arg signature "$SIGNATURE_CONTENT" \
    --arg url "$DOWNLOAD_URL" \
    --arg source_commit "$SOURCE_COMMIT" \
    --arg archive_sha256 "$ARCHIVE_SHA256" \
    --argjson source_dirty "$SOURCE_DIRTY" \
    '{
        version: $version,
        notes: $notes,
        pub_date: $pub_date,
        source_commit: $source_commit,
        source_dirty: $source_dirty,
        archive_sha256: $archive_sha256,
        platforms: {
            "darwin-aarch64": { signature: $signature, url: $url }
        }
    }' > "$OUTPUT_ROOT/latest.json"
chmod 600 "$OUTPUT_ROOT/latest.json"

jq -n \
    --arg endpoint "$ENDPOINT" \
    --arg a_version "$A_VERSION" \
    --arg b_version "$B_VERSION" \
    --arg a_bundle "$OUTPUT_ROOT/A/CTRL.app" \
    --arg b_bundle "$OUTPUT_ROOT/B/CTRL.app" \
    --arg archive "$ARCHIVE" \
    '{endpoint: $endpoint, a: {version: $a_version, bundle: $a_bundle}, b: {version: $b_version, bundle: $b_bundle, archive: $archive}}' \
    > "$OUTPUT_ROOT/channel.json"
chmod 600 "$OUTPUT_ROOT/channel.json"

# Prove the tracked production endpoint was not replaced by this local channel.
if [[ "$(node -p "require('./src-tauri/tauri.conf.json').plugins.updater.endpoints[0]")" != "$FORMAL_ENDPOINT" ]]; then
    echo "error: production updater endpoint changed during local build"
    exit 1
fi
verify_app "$OUTPUT_ROOT/A/CTRL.app" "$A_VERSION"
verify_app "$OUTPUT_ROOT/B/CTRL.app" "$B_VERSION"

echo "Local updater channel ready: $OUTPUT_ROOT"
echo "Serve it manually with: python3 -m http.server $LOCAL_PORT --bind 127.0.0.1 --directory \"$OUTPUT_ROOT\""
echo "No tag, push, GitHub release, or production latest.json was created or modified."
