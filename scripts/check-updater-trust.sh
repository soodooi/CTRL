#!/usr/bin/env bash
# Verify the active updater key, pinned public key, trust epoch, and encrypted
# recovery copy without printing any credential material.
# (ADR-004 cap § updater v8)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
for command in node npm openssl security shasum jq minisign; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "error: required updater trust command is unavailable: $command"
        exit 1
    fi
done

TRUST_FILE="$ROOT/scripts/updater-trust.json"
CONFIG_FILE="$ROOT/src-tauri/tauri.conf.json"
EPOCH="$(jq -r '.epoch' "$TRUST_FILE")"
POLICY_KEY_ID="$(jq -r '.activeKeyId' "$TRUST_FILE")"
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
if ! [[ "$EPOCH" =~ ^[1-9][0-9]*$ && "$POLICY_KEY_ID" =~ ^[0-9A-F]{16}$ &&
        "$PINNED_KEY_ID" = "$POLICY_KEY_ID" ]]; then
    echo "error: updater trust policy does not match the pinned Tauri public key"
    exit 1
fi

if [[ -n "${CTRL_UPDATER_PRIVATE_KEY_FILE:-}" ]]; then
    if [[ ! -f "$CTRL_UPDATER_PRIVATE_KEY_FILE" ]]; then
        echo "error: supplied updater private-key file does not exist"
        exit 1
    fi
    PRIVATE_KEY="$(cat "$CTRL_UPDATER_PRIVATE_KEY_FILE")"
else
    PRIVATE_KEY="$(security find-generic-password -s tauri-sign -a ctrl-updater -w 2>/dev/null || true)"
fi
BACKUP_PASSPHRASE="$(security find-generic-password \
    -s tauri-sign-backup-passphrase -a ctrl-updater -w 2>/dev/null || true)"
BACKUP_RECEIPT="$(security find-generic-password \
    -s tauri-sign-backup-receipt -a ctrl-updater -w 2>/dev/null || true)"
if [[ -z "$PRIVATE_KEY" || -z "$BACKUP_PASSPHRASE" || -z "$BACKUP_RECEIPT" ]]; then
    echo "error: updater active key or encrypted-backup evidence is missing from Keychain"
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
BACKUP_SHA256="$(jq -r '.sha256' <<< "$BACKUP_RECEIPT")"
RECEIPT_KEY_ID="$(jq -r '.key_id' <<< "$BACKUP_RECEIPT")"
RECEIPT_EPOCH="$(jq -r '.epoch' <<< "$BACKUP_RECEIPT")"
if [[ "$RECEIPT_KEY_ID" != "$POLICY_KEY_ID" || "$RECEIPT_EPOCH" != "$EPOCH" ||
      ! -f "$BACKUP_FILE" ]]; then
    echo "error: updater backup receipt does not match the active trust epoch"
    exit 1
fi
ACTUAL_BACKUP_SHA256="$(shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')"
if [[ "$ACTUAL_BACKUP_SHA256" != "$BACKUP_SHA256" ]]; then
    echo "error: encrypted updater backup hash does not match its receipt"
    exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ctrl-updater-check.XXXXXX")"
chmod 700 "$TMP_DIR"
cleanup() {
    unset PRIVATE_KEY BACKUP_PASSPHRASE
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT
export BACKUP_PASSPHRASE
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -in "$BACKUP_FILE" -out "$TMP_DIR/backup.key" \
    -pass env:BACKUP_PASSPHRASE
chmod 600 "$TMP_DIR/backup.key"
printf '%s' "$PRIVATE_KEY" > "$TMP_DIR/active.key"
chmod 600 "$TMP_DIR/active.key"
cmp -s "$TMP_DIR/active.key" "$TMP_DIR/backup.key" || {
    echo "error: encrypted updater backup is not the active private key"
    exit 1
}

printf 'CTRL updater trust preflight epoch %s\n' "$EPOCH" > "$TMP_DIR/probe"
TAURI_SIGNING_PRIVATE_KEY="$PRIVATE_KEY" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
    npm run tauri -- signer sign "$TMP_DIR/probe" >/dev/null
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[2], Buffer.from(fs.readFileSync(process.argv[1], "utf8").trim(), "base64"));
' "$TMP_DIR/probe.sig" "$TMP_DIR/probe.minisig"
if ! minisign -Vm "$TMP_DIR/probe" -P "$PINNED_MINISIGN_KEY" \
        -x "$TMP_DIR/probe.minisig" -q >/dev/null 2>&1; then
    echo "error: active updater private key cannot be verified by the pinned public key"
    exit 1
fi

echo "updater trust verified: epoch=$EPOCH key_id=$POLICY_KEY_ID encrypted_backup=ok"
