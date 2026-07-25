#!/usr/bin/env bash
# Restore a missing active updater key from the encrypted recovery copy without
# rotating the trust epoch or changing the pinned public key.
# (ADR-004 cap § updater v8)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if security find-generic-password -s tauri-sign -a ctrl-updater >/dev/null 2>&1; then
    echo "error: active updater key already exists; refusing to overwrite it"
    exit 1
fi
BACKUP_PASSPHRASE="$(security find-generic-password \
    -s tauri-sign-backup-passphrase -a ctrl-updater -w 2>/dev/null || true)"
BACKUP_RECEIPT="$(security find-generic-password \
    -s tauri-sign-backup-receipt -a ctrl-updater -w 2>/dev/null || true)"
if [[ -z "$BACKUP_PASSPHRASE" || -z "$BACKUP_RECEIPT" ]]; then
    echo "error: updater encrypted-backup credential or receipt is missing"
    exit 1
fi
if ! jq -e 'type == "object" and
    (.path | type == "string" and startswith("/")) and
    (.sha256 | type == "string" and test("^[0-9a-f]{64}$")) and
    (.key_id | type == "string" and test("^[0-9A-F]{16}$")) and
    (.epoch | type == "number")' <<< "$BACKUP_RECEIPT" >/dev/null; then
    echo "error: updater backup receipt is malformed"
    exit 1
fi
BACKUP_FILE="$(jq -r '.path' <<< "$BACKUP_RECEIPT")"
EXPECTED_SHA256="$(jq -r '.sha256' <<< "$BACKUP_RECEIPT")"
EXPECTED_KEY_ID="$(jq -r '.key_id' <<< "$BACKUP_RECEIPT")"
EXPECTED_EPOCH="$(jq -r '.epoch' <<< "$BACKUP_RECEIPT")"
POLICY_KEY_ID="$(jq -r '.activeKeyId' scripts/updater-trust.json)"
POLICY_EPOCH="$(jq -r '.epoch' scripts/updater-trust.json)"
if [[ ! -f "$BACKUP_FILE" || "$EXPECTED_KEY_ID" != "$POLICY_KEY_ID" ||
      "$EXPECTED_EPOCH" != "$POLICY_EPOCH" ]]; then
    echo "error: updater backup does not match the tracked trust epoch"
    exit 1
fi
ACTUAL_SHA256="$(shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]]; then
    echo "error: encrypted updater backup hash does not match its receipt"
    exit 1
fi

PINNED_PUBLIC_KEY="$(node -p "require('./src-tauri/tauri.conf.json').plugins.updater.pubkey")"
PINNED_MINISIGN_KEY="$(node -e '
  const decoded = Buffer.from(process.argv[1], "base64").toString("utf8").trim().split(/\r?\n/);
  process.stdout.write(decoded[1] || "");
' "$PINNED_PUBLIC_KEY")"
PINNED_KEY_ID="$(node -e '
  const raw = Buffer.from(process.argv[1], "base64");
  if (raw.length !== 42) process.exit(1);
  process.stdout.write(Buffer.from(raw.subarray(2, 10)).reverse().toString("hex").toUpperCase());
' "$PINNED_MINISIGN_KEY")"
if [[ "$PINNED_KEY_ID" != "$POLICY_KEY_ID" ]]; then
    echo "error: pinned updater public key does not match the tracked trust epoch"
    exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ctrl-updater-restore.XXXXXX")"
chmod 700 "$TMP_DIR"
RESTORED=0
cleanup() {
    local status="$?"
    unset BACKUP_PASSPHRASE PRIVATE_KEY
    if [[ "$status" -ne 0 && "$RESTORED" -eq 1 ]]; then
        security delete-generic-password -s tauri-sign -a ctrl-updater >/dev/null 2>&1 || true
    fi
    rm -rf "$TMP_DIR"
    return "$status"
}
trap cleanup EXIT
export BACKUP_PASSPHRASE
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -in "$BACKUP_FILE" -out "$TMP_DIR/restored.key" \
    -pass env:BACKUP_PASSPHRASE
chmod 600 "$TMP_DIR/restored.key"
printf 'CTRL updater recovery epoch %s\n' "$POLICY_EPOCH" > "$TMP_DIR/probe"
TAURI_SIGNING_PRIVATE_KEY_PATH="$TMP_DIR/restored.key" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
    npm run tauri -- signer sign "$TMP_DIR/probe" >/dev/null
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[2], Buffer.from(fs.readFileSync(process.argv[1], "utf8").trim(), "base64"));
' "$TMP_DIR/probe.sig" "$TMP_DIR/probe.minisig"
if ! minisign -Vm "$TMP_DIR/probe" -P "$PINNED_MINISIGN_KEY" \
        -x "$TMP_DIR/probe.minisig" -q >/dev/null 2>&1; then
    echo "error: encrypted updater backup does not match the pinned public key"
    exit 1
fi
PRIVATE_KEY="$(cat "$TMP_DIR/restored.key")"
printf '%s' "$PRIVATE_KEY" | scripts/keychain-secret.swift add tauri-sign ctrl-updater >/dev/null
RESTORED=1
CTRL_UPDATER_PRIVATE_KEY_FILE="$TMP_DIR/restored.key" bash scripts/check-updater-trust.sh

echo "updater active key restored: epoch=$POLICY_EPOCH key_id=$POLICY_KEY_ID"
