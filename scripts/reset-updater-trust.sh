#!/usr/bin/env bash
# Reset the updater trust epoch only when the active private key is irrecoverably
# lost. Existing installations require one verified reinstall after this action;
# builds from the new epoch can then use normal in-place updates.
# (ADR-004 cap § updater v8)

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "error: updater trust reset currently requires macOS Keychain"
    exit 1
fi
if [[ "${CTRL_UPDATER_TRUST_RESET:-}" != "I_UNDERSTAND_OLD_CLIENTS_REQUIRE_REINSTALL" ]]; then
    echo "error: trust reset requires CTRL_UPDATER_TRUST_RESET=I_UNDERSTAND_OLD_CLIENTS_REQUIRE_REINSTALL"
    exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

for command in node npm openssl security shasum jq minisign swift; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "error: required command is unavailable: $command"
        exit 1
    fi
done

TRUST_FILE="$ROOT/scripts/updater-trust.json"
CONFIG_FILE="$ROOT/src-tauri/tauri.conf.json"
BACKUP_DIR="${CTRL_UPDATER_BACKUP_DIR:-$HOME/Documents/CTRL/.security/updater}"
TRANSACTION_FILE="$BACKUP_DIR/.updater-reset-transaction.json"

apply_public_key() {
    local public_key="$1"
    node -e '
      const fs = require("fs");
      const path = process.argv[1];
      const publicKey = process.argv[2];
      const config = JSON.parse(fs.readFileSync(path, "utf8"));
      config.plugins.updater.pubkey = publicKey;
      fs.writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
    ' "$CONFIG_FILE" "$public_key"
}

rollback_transaction() {
    local backup_file old_public
    backup_file="$(jq -r '.receipt.path // empty' "$TRANSACTION_FILE")"
    old_public="$(jq -r '.oldPublicKey' "$TRANSACTION_FILE")"
    apply_public_key "$old_public"
    jq '.oldPolicy' "$TRANSACTION_FILE" > "$TRUST_FILE"
    for service in tauri-sign tauri-sign-backup-passphrase tauri-sign-backup-receipt; do
        security delete-generic-password -s "$service" -a ctrl-updater >/dev/null 2>&1 || true
    done
    [[ -z "$backup_file" ]] || rm -f "$backup_file"
    rm -f "$TRANSACTION_FILE"
}

if [[ -f "$TRANSACTION_FILE" ]]; then
    echo "==> recovering interrupted updater trust reset"
    RECEIPT_PATH="$(jq -r '.receipt.path // empty' "$TRANSACTION_FILE")"
    if [[ -f "$RECEIPT_PATH" ]] &&
       security find-generic-password -s tauri-sign -a ctrl-updater >/dev/null 2>&1 &&
       security find-generic-password -s tauri-sign-backup-passphrase -a ctrl-updater >/dev/null 2>&1 &&
       security find-generic-password -s tauri-sign-backup-receipt -a ctrl-updater >/dev/null 2>&1; then
        apply_public_key "$(jq -r '.newPublicKey' "$TRANSACTION_FILE")"
        jq '.newPolicy' "$TRANSACTION_FILE" > "$TRUST_FILE"
        if bash scripts/check-updater-trust.sh; then
            rm -f "$TRANSACTION_FILE"
            echo "interrupted updater trust reset completed"
            exit 0
        fi
    fi
    rollback_transaction
    echo "error: interrupted updater trust reset was incomplete and has been rolled back; rerun the command"
    exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
    echo "error: trust reset must start from a clean worktree"
    exit 1
fi
for service in tauri-sign tauri-sign-backup-passphrase tauri-sign-backup-receipt; do
    if security find-generic-password -s "$service" -a ctrl-updater >/dev/null 2>&1; then
        echo "error: updater trust Keychain state is not empty ($service); use restore-updater-key.sh when backup evidence exists"
        exit 1
    fi
done

OLD_EPOCH="$(jq -r '.epoch' "$TRUST_FILE")"
OLD_KEY_ID="$(jq -r '.activeKeyId' "$TRUST_FILE")"
if ! [[ "$OLD_EPOCH" =~ ^[1-9][0-9]*$ && "$OLD_KEY_ID" =~ ^[0-9A-F]{16}$ ]]; then
    echo "error: updater trust policy is malformed"
    exit 1
fi
NEW_EPOCH="$((OLD_EPOCH + 1))"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ctrl-updater-reset.XXXXXX")"
chmod 700 "$TMP_DIR"
cp "$CONFIG_FILE" "$TMP_DIR/original-tauri.conf.json"
cp "$TRUST_FILE" "$TMP_DIR/original-updater-trust.json"
SOURCE_CHANGED=0
BACKUP_FILE=""
cleanup() {
    local status="$?"
    unset PRIVATE_KEY BACKUP_PASSPHRASE
    if [[ "$status" -ne 0 ]]; then
        if [[ "$SOURCE_CHANGED" -eq 1 ]]; then
            cp "$TMP_DIR/original-tauri.conf.json" "$CONFIG_FILE"
            cp "$TMP_DIR/original-updater-trust.json" "$TRUST_FILE"
        fi
        for service in tauri-sign tauri-sign-backup-passphrase tauri-sign-backup-receipt; do
            security delete-generic-password -s "$service" -a ctrl-updater >/dev/null 2>&1 || true
        done
        if [[ -n "$BACKUP_FILE" ]]; then
            rm -f "$BACKUP_FILE"
        fi
        rm -f "$TRANSACTION_FILE"
    fi
    rm -rf "$TMP_DIR"
    return "$status"
}
trap cleanup EXIT

npm run tauri -- signer generate --ci -w "$TMP_DIR/ctrl.key" --password "" >/dev/null
chmod 600 "$TMP_DIR/ctrl.key" "$TMP_DIR/ctrl.key.pub"
NEW_KEY_ID="$(node -e '
  const fs = require("fs");
  const wrapped = fs.readFileSync(process.argv[1], "utf8").trim();
  const lines = Buffer.from(wrapped, "base64").toString("utf8").trim().split(/\r?\n/);
  const raw = Buffer.from(lines[1] || "", "base64");
  if (raw.length !== 42) process.exit(1);
  process.stdout.write(Buffer.from(raw.subarray(2, 10)).reverse().toString("hex").toUpperCase());
' "$TMP_DIR/ctrl.key.pub")"
if ! [[ "$NEW_KEY_ID" =~ ^[0-9A-F]{16}$ ]] || [[ "$NEW_KEY_ID" = "$OLD_KEY_ID" ]]; then
    echo "error: generated updater public key is invalid or did not rotate"
    exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/ctrl-updater-epoch-${NEW_EPOCH}-${NEW_KEY_ID}.key.enc"
if [[ -e "$BACKUP_FILE" ]]; then
    echo "error: backup target already exists: $BACKUP_FILE"
    exit 1
fi
BACKUP_PASSPHRASE="$(openssl rand -base64 48)"
export BACKUP_PASSPHRASE
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
    -in "$TMP_DIR/ctrl.key" -out "$TMP_DIR/ctrl.key.enc" \
    -pass env:BACKUP_PASSPHRASE
chmod 600 "$TMP_DIR/ctrl.key.enc"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -in "$TMP_DIR/ctrl.key.enc" -out "$TMP_DIR/verified.key" \
    -pass env:BACKUP_PASSPHRASE
cmp -s "$TMP_DIR/ctrl.key" "$TMP_DIR/verified.key" || {
    echo "error: encrypted updater backup did not decrypt byte-for-byte"
    exit 1
}

node -e '
  const fs = require("fs");
  const configPath = process.argv[1];
  const publicPath = process.argv[2];
  const outputPath = process.argv[3];
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const publicKey = fs.readFileSync(publicPath, "utf8").trim();
  config.plugins.updater.pubkey = publicKey;
  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2) + "\n");
' "$CONFIG_FILE" "$TMP_DIR/ctrl.key.pub" "$TMP_DIR/new-tauri.conf.json"
jq \
    --argjson epoch "$NEW_EPOCH" \
    --arg active "$NEW_KEY_ID" \
    --arg previous "$OLD_KEY_ID" \
    --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '.epoch = $epoch |
     .activeKeyId = $active |
     .previousKeyId = $previous |
     .resetReason = "private-key-loss" |
     .resetAt = $date' \
    "$TRUST_FILE" > "$TMP_DIR/new-updater-trust.json"

BACKUP_SHA256="$(shasum -a 256 "$TMP_DIR/ctrl.key.enc" | awk '{print $1}')"
BACKUP_RECEIPT="$(jq -cn \
    --arg path "$BACKUP_FILE" \
    --arg sha256 "$BACKUP_SHA256" \
    --arg key_id "$NEW_KEY_ID" \
    --argjson epoch "$NEW_EPOCH" \
    '{path: $path, sha256: $sha256, key_id: $key_id, epoch: $epoch}')"
NEW_PUBLIC_KEY="$(cat "$TMP_DIR/ctrl.key.pub")"
jq -n \
    --arg old_public "$(node -p "require('./src-tauri/tauri.conf.json').plugins.updater.pubkey")" \
    --arg new_public "$NEW_PUBLIC_KEY" \
    --slurpfile old_policy "$TRUST_FILE" \
    --slurpfile new_policy "$TMP_DIR/new-updater-trust.json" \
    --argjson receipt "$BACKUP_RECEIPT" \
    '{oldPublicKey: $old_public, newPublicKey: $new_public,
      oldPolicy: $old_policy[0], newPolicy: $new_policy[0], receipt: $receipt}' \
    > "$TMP_DIR/reset-transaction.json"
mv "$TMP_DIR/reset-transaction.json" "$TRANSACTION_FILE"
chmod 600 "$TRANSACTION_FILE"

PRIVATE_KEY="$(cat "$TMP_DIR/ctrl.key")"
printf '%s' "$PRIVATE_KEY" | scripts/keychain-secret.swift add tauri-sign ctrl-updater >/dev/null
printf '%s' "$BACKUP_PASSPHRASE" | scripts/keychain-secret.swift add \
    tauri-sign-backup-passphrase ctrl-updater >/dev/null
mv "$TMP_DIR/ctrl.key.enc" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"
printf '%s' "$BACKUP_RECEIPT" | scripts/keychain-secret.swift add \
    tauri-sign-backup-receipt ctrl-updater >/dev/null

mv "$TMP_DIR/new-tauri.conf.json" "$CONFIG_FILE"
mv "$TMP_DIR/new-updater-trust.json" "$TRUST_FILE"
SOURCE_CHANGED=1
bash scripts/check-updater-trust.sh
rm -f "$TRANSACTION_FILE"
printf 'updater trust reset prepared: epoch=%s key_id=%s\n' "$NEW_EPOCH" "$NEW_KEY_ID"
printf 'encrypted backup: %s\n' "$BACKUP_FILE"
printf 'next: review and commit tauri.conf.json plus scripts/updater-trust.json before release\n'
