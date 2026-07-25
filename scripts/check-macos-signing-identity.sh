#!/usr/bin/env bash
# Verify the configured macOS release identity, login-Keychain private key,
# encrypted PKCS#12 recovery copy, and a bounded real codesign operation.
# (ADR-004 cap § updater v9)

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "error: macOS signing identity verification requires macOS"
    exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
for command in node openssl security shasum jq codesign python3; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "error: required macOS signing command is unavailable: $command"
        exit 1
    fi
done

POLICY_FILE="$ROOT/scripts/macos-signing-trust.json"
ACCOUNT_HOME="$(python3 -c 'import os,pwd; print(pwd.getpwuid(os.getuid()).pw_dir)')"
if [[ -z "$ACCOUNT_HOME" || "${HOME:-}" != "$ACCOUNT_HOME" ]]; then
    echo "error: HOME does not match the current macOS account home"
    exit 1
fi
LOGIN_KEYCHAIN="$ACCOUNT_HOME/Library/Keychains/login.keychain-db"
EPOCH="$(jq -r '.epoch' "$POLICY_FILE")"
POLICY_FINGERPRINT="$(jq -r '.activeFingerprint' "$POLICY_FILE")"
POLICY_LABEL="$(jq -r '.activeLabel' "$POLICY_FILE")"
CONFIGURED_FINGERPRINT="$(node -p "require('./src-tauri/tauri.conf.json').bundle.macOS.signingIdentity.toUpperCase()")"
if ! [[ "$EPOCH" =~ ^[1-9][0-9]*$ && "$POLICY_FINGERPRINT" =~ ^[0-9A-F]{40}$ ]] ||
   [[ "$CONFIGURED_FINGERPRINT" != "$POLICY_FINGERPRINT" || -z "$POLICY_LABEL" ]]; then
    echo "error: macOS signing policy does not match the configured release identity"
    exit 1
fi

IDENTITY_MATCH="$(security find-identity -v -p codesigning "$LOGIN_KEYCHAIN" 2>/dev/null | \
    awk -v requested="$POLICY_FINGERPRINT" 'toupper($2) == requested { print $0 }')"
if [[ "$(grep -c . <<< "$IDENTITY_MATCH" || true)" -ne 1 ||
      "$IDENTITY_MATCH" != *"\"$POLICY_LABEL\""* ]]; then
    echo "error: configured macOS signing identity is not uniquely available in the login Keychain with the tracked label"
    exit 1
fi

BACKUP_PASSPHRASE="$(security find-generic-password \
    -s ctrl-codesign-backup-passphrase -a ctrl-macos-signing -w 2>/dev/null || true)"
BACKUP_RECEIPT="$(security find-generic-password \
    -s ctrl-codesign-backup-receipt -a ctrl-macos-signing -w 2>/dev/null || true)"
if [[ -z "$BACKUP_PASSPHRASE" || -z "$BACKUP_RECEIPT" ]]; then
    echo "error: macOS signing encrypted-backup evidence is missing from Keychain"
    exit 1
fi
if ! jq -e 'type == "object" and
    (.path | type == "string" and startswith("/")) and
    (.sha256 | type == "string" and test("^[0-9a-f]{64}$")) and
    (.fingerprint | type == "string" and test("^[0-9A-F]{40}$")) and
    (.epoch | type == "number")' <<< "$BACKUP_RECEIPT" >/dev/null; then
    echo "error: macOS signing backup receipt is malformed"
    exit 1
fi
RECEIPT_BACKUP_FILE="$(jq -r '.path' <<< "$BACKUP_RECEIPT")"
BACKUP_FILE="$ACCOUNT_HOME/Documents/CTRL/.security/codesign/ctrl-macos-signing-epoch-${EPOCH}-${POLICY_FINGERPRINT}.p12"
BACKUP_SHA256="$(jq -r '.sha256' <<< "$BACKUP_RECEIPT")"
RECEIPT_FINGERPRINT="$(jq -r '.fingerprint' <<< "$BACKUP_RECEIPT")"
RECEIPT_EPOCH="$(jq -r '.epoch' <<< "$BACKUP_RECEIPT")"
if [[ "$RECEIPT_BACKUP_FILE" != "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ||
      "$RECEIPT_FINGERPRINT" != "$POLICY_FINGERPRINT" ||
      "$RECEIPT_EPOCH" != "$EPOCH" ]]; then
    echo "error: macOS signing backup receipt does not match the active identity epoch"
    exit 1
fi
ACTUAL_BACKUP_SHA256="$(shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')"
if [[ "$ACTUAL_BACKUP_SHA256" != "$BACKUP_SHA256" ]]; then
    echo "error: encrypted macOS signing backup hash does not match its receipt"
    exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ctrl-codesign-check.XXXXXX")"
chmod 700 "$TMP_DIR"
cleanup() {
    unset BACKUP_PASSPHRASE
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT
BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" openssl pkcs12 -in "$BACKUP_FILE" -clcerts -nokeys \
    -passin env:BACKUP_PASSPHRASE -out "$TMP_DIR/backup-cert.pem" >/dev/null 2>&1
BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" openssl pkcs12 -in "$BACKUP_FILE" -nocerts -nodes \
    -passin env:BACKUP_PASSPHRASE -out "$TMP_DIR/backup-key.pem" >/dev/null 2>&1
chmod 600 "$TMP_DIR/backup-cert.pem" "$TMP_DIR/backup-key.pem"
BACKUP_FINGERPRINT="$(openssl x509 -in "$TMP_DIR/backup-cert.pem" -noout -fingerprint -sha1 | \
    sed 's/.*=//; s/://g' | tr '[:lower:]' '[:upper:]')"
openssl x509 -in "$TMP_DIR/backup-cert.pem" -pubkey -noout > "$TMP_DIR/cert-pub.pem"
openssl pkey -in "$TMP_DIR/backup-key.pem" -pubout > "$TMP_DIR/key-pub.pem" 2>/dev/null
if [[ "$BACKUP_FINGERPRINT" != "$POLICY_FINGERPRINT" ]] ||
   ! cmp -s "$TMP_DIR/cert-pub.pem" "$TMP_DIR/key-pub.pem"; then
    echo "error: encrypted macOS signing backup does not contain the active certificate/private-key pair"
    exit 1
fi

cp /usr/bin/true "$TMP_DIR/codesign-probe"
chmod 700 "$TMP_DIR/codesign-probe"
EXPECTED_REQUIREMENT="=certificate root = H\"$(tr '[:upper:]' '[:lower:]' <<< "$POLICY_FINGERPRINT")\""
python3 - "$POLICY_FINGERPRINT" "$TMP_DIR/codesign-probe" <<'PY'
import subprocess
import sys

fingerprint, probe = sys.argv[1:]
try:
    subprocess.run(
        ["/usr/bin/codesign", "--force", "--sign", fingerprint, "--options", "runtime", probe],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        timeout=20,
    )
except subprocess.TimeoutExpired:
    print("error: macOS signing identity blocked during the bounded codesign probe", file=sys.stderr)
    sys.exit(1)
except subprocess.CalledProcessError as error:
    message = error.stderr.decode("utf-8", errors="replace").strip()
    print(f"error: macOS signing probe failed: {message}", file=sys.stderr)
    sys.exit(1)
PY
codesign --verify --strict -R "$EXPECTED_REQUIREMENT" --verbose=2 "$TMP_DIR/codesign-probe"

echo "macOS signing identity verified: epoch=$EPOCH fingerprint=$POLICY_FINGERPRINT encrypted_backup=ok codesign_probe=ok"
