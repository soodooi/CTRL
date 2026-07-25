#!/usr/bin/env bash
# Restore the tracked macOS signing identity from its encrypted PKCS#12 backup
# without changing the identity epoch or configured Designated Requirement.
# (ADR-004 cap § updater v9)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

POLICY_FILE="$ROOT/scripts/macos-signing-trust.json"
ACCOUNT_HOME="$(python3 -c 'import os,pwd; print(pwd.getpwuid(os.getuid()).pw_dir)')"
if [[ -z "$ACCOUNT_HOME" || "${HOME:-}" != "$ACCOUNT_HOME" ]]; then
    echo "error: HOME does not match the current macOS account home"
    exit 1
fi
LOGIN_KEYCHAIN="$ACCOUNT_HOME/Library/Keychains/login.keychain-db"
FINGERPRINT="$(jq -r '.activeFingerprint' "$POLICY_FILE")"
EPOCH="$(jq -r '.epoch' "$POLICY_FILE")"
if security find-identity -v -p codesigning "$LOGIN_KEYCHAIN" 2>/dev/null | \
        awk -v requested="$FINGERPRINT" 'toupper($2) == requested { found = 1 } END { exit !found }'; then
    echo "error: active macOS signing identity already exists; refusing to overwrite it"
    exit 1
fi

BACKUP_PASSPHRASE="$(security find-generic-password \
    -s ctrl-codesign-backup-passphrase -a ctrl-macos-signing -w 2>/dev/null || true)"
BACKUP_RECEIPT="$(security find-generic-password \
    -s ctrl-codesign-backup-receipt -a ctrl-macos-signing -w 2>/dev/null || true)"
if [[ -z "$BACKUP_PASSPHRASE" || -z "$BACKUP_RECEIPT" ]]; then
    echo "error: macOS signing encrypted-backup evidence is missing"
    exit 1
fi
RECEIPT_BACKUP_FILE="$(jq -r '.path // empty' <<< "$BACKUP_RECEIPT")"
BACKUP_FILE="$ACCOUNT_HOME/Documents/CTRL/.security/codesign/ctrl-macos-signing-epoch-${EPOCH}-${FINGERPRINT}.p12"
EXPECTED_SHA256="$(jq -r '.sha256 // empty' <<< "$BACKUP_RECEIPT")"
RECEIPT_FINGERPRINT="$(jq -r '.fingerprint // empty' <<< "$BACKUP_RECEIPT")"
RECEIPT_EPOCH="$(jq -r '.epoch // empty' <<< "$BACKUP_RECEIPT")"
if [[ "$RECEIPT_BACKUP_FILE" != "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ||
      "$RECEIPT_FINGERPRINT" != "$FINGERPRINT" ||
      "$RECEIPT_EPOCH" != "$EPOCH" ]]; then
    echo "error: macOS signing backup does not match the tracked identity epoch"
    exit 1
fi
if [[ "$(shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')" != "$EXPECTED_SHA256" ]]; then
    echo "error: encrypted macOS signing backup hash does not match its receipt"
    exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ctrl-codesign-restore.XXXXXX")"
chmod 700 "$TMP_DIR"
RESTORED=0
cleanup() {
    local status="$?"
    unset BACKUP_PASSPHRASE
    if [[ "$status" -ne 0 && "$RESTORED" -eq 1 ]]; then
        security delete-identity -Z "$FINGERPRINT" "$LOGIN_KEYCHAIN" >/dev/null 2>&1 || true
    fi
    rm -rf "$TMP_DIR"
    return "$status"
}
trap cleanup EXIT
BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" openssl pkcs12 -in "$BACKUP_FILE" -clcerts -nokeys \
    -passin env:BACKUP_PASSPHRASE -out "$TMP_DIR/certificate.pem" >/dev/null 2>&1
BACKUP_FINGERPRINT="$(openssl x509 -in "$TMP_DIR/certificate.pem" -noout -fingerprint -sha1 | \
    sed 's/.*=//; s/://g' | tr '[:lower:]' '[:upper:]')"
if [[ "$BACKUP_FINGERPRINT" != "$FINGERPRINT" ]]; then
    echo "error: encrypted macOS signing backup certificate does not match the tracked fingerprint"
    exit 1
fi
BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" openssl pkcs12 -in "$BACKUP_FILE" -nocerts -nodes \
    -passin env:BACKUP_PASSPHRASE -out "$TMP_DIR/private-key.pem" >/dev/null 2>&1
chmod 600 "$TMP_DIR/private-key.pem"
openssl pkcs12 -export -name "$(jq -r '.activeLabel' "$POLICY_FILE")" \
    -inkey "$TMP_DIR/private-key.pem" -in "$TMP_DIR/certificate.pem" \
    -out "$TMP_DIR/import-identity.p12" -passout pass: >/dev/null 2>&1
chmod 600 "$TMP_DIR/import-identity.p12"
security import "$TMP_DIR/import-identity.p12" -k "$LOGIN_KEYCHAIN" -P "" \
    -T /usr/bin/codesign >/dev/null
RESTORED=1
security add-trusted-cert -r trustAsRoot -p codeSign -k "$LOGIN_KEYCHAIN" \
    "$TMP_DIR/certificate.pem" >/dev/null
bash scripts/check-macos-signing-identity.sh

echo "macOS signing identity restored: epoch=$EPOCH fingerprint=$FINGERPRINT"
