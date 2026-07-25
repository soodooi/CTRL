#!/usr/bin/env bash
# Rotate an irrecoverable macOS release-signing identity while preserving the
# bundle identifier. The new identity is backed up before it becomes active.
# (ADR-004 cap § updater v9)

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "error: macOS signing identity reset requires macOS"
    exit 1
fi
if [[ "${CTRL_MACOS_SIGNING_RESET:-}" != "I_UNDERSTAND_MACOS_PERMISSIONS_REQUIRE_REAUTHORIZATION" ]]; then
    echo "error: identity reset requires CTRL_MACOS_SIGNING_RESET=I_UNDERSTAND_MACOS_PERMISSIONS_REQUIRE_REAUTHORIZATION"
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
CONFIG_FILE="$ROOT/src-tauri/tauri.conf.json"
ACCOUNT_HOME="$(python3 -c 'import os,pwd; print(pwd.getpwuid(os.getuid()).pw_dir)')"
if [[ -z "$ACCOUNT_HOME" || "${HOME:-}" != "$ACCOUNT_HOME" ]]; then
    echo "error: HOME does not match the current macOS account home"
    exit 1
fi
LOGIN_KEYCHAIN="$ACCOUNT_HOME/Library/Keychains/login.keychain-db"
BACKUP_DIR="$ACCOUNT_HOME/Documents/CTRL/.security/codesign"
TRANSACTION_FILE="$BACKUP_DIR/.macos-signing-reset-transaction.json"

# Install tracked or transaction state with file + containing-directory fsync so
# a power loss cannot expose a Keychain mutation without its recovery journal.
# (ADR-004 cap § updater v9)
durable_install() {
    local source="$1" destination="$2" mode="$3"
    python3 - "$source" "$destination" "$mode" <<'PY'
import os
import pathlib
import sys

source, destination, mode = sys.argv[1:]
destination_path = pathlib.Path(destination)
destination_path.parent.mkdir(parents=True, exist_ok=True)
temporary = destination_path.with_name(f".{destination_path.name}.tmp.{os.getpid()}")
data = pathlib.Path(source).read_bytes()
fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, int(mode, 8))
try:
    with os.fdopen(fd, "wb", closefd=False) as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
finally:
    os.close(fd)
os.replace(temporary, destination_path)
os.chmod(destination_path, int(mode, 8))
directory_fd = os.open(destination_path.parent, os.O_RDONLY)
try:
    os.fsync(directory_fd)
finally:
    os.close(directory_fd)
PY
}

durable_remove() {
    local path="$1"
    python3 - "$path" <<'PY'
import os
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
if path.exists():
    path.unlink()
    directory_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
PY
}

apply_signing_identity() {
    local fingerprint="$1" output
    output="$(mktemp "${TMPDIR:-/tmp}/ctrl-tauri-conf.XXXXXX")"
    node - "$CONFIG_FILE" "$fingerprint" "$output" <<'NODE'
const fs = require("fs");
const [input, fingerprint, output] = process.argv.slice(2);
const source = fs.readFileSync(input, "utf8");
const config = JSON.parse(source);
const needle = `"signingIdentity": ${JSON.stringify(config.bundle.macOS.signingIdentity)}`;
if (source.split(needle).length !== 2) process.exit(1);
fs.writeFileSync(output, source.replace(needle, `"signingIdentity": ${JSON.stringify(fingerprint)}`));
NODE
    durable_install "$output" "$CONFIG_FILE" 644
    rm -f "$output"
}

write_transaction_phase() {
    local phase="$1" output
    output="$(mktemp "${TMPDIR:-/tmp}/ctrl-codesign-transaction.XXXXXX")"
    jq --arg phase "$phase" '.phase = $phase' "$TRANSACTION_FILE" > "$output"
    durable_install "$output" "$TRANSACTION_FILE" 600
    rm -f "$output"
}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
ROOT_REAL="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$ROOT")"
BACKUP_REAL="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$BACKUP_DIR")"
case "$BACKUP_REAL/" in
    "$ROOT_REAL"/*|/tmp/*|/private/tmp/*)
        echo "error: macOS signing backup directory must be durable and outside the source/temp trees"
        exit 1
        ;;
esac

# A complete new epoch is finalized after full cryptographic checking; any
# partial journaled state is rolled back. Journal fields are validated before
# they can name an identity or path for cleanup. (ADR-004 cap § updater v9)
if [[ -f "$TRANSACTION_FILE" ]]; then
    echo "==> recovering interrupted macOS signing identity reset"
    if ! jq -e '
        (.phase | type == "string") and
        (.newFingerprint | type == "string" and test("^[0-9A-F]{40}$")) and
        (.receipt.sha256 | type == "string" and test("^[0-9a-f]{64}$")) and
        (.receipt.fingerprint == .newFingerprint) and
        (.oldPolicy.activeFingerprint | type == "string" and test("^[0-9A-F]{40}$")) and
        (.newPolicy.activeFingerprint == .newFingerprint) and
        (.newPolicy.epoch == (.oldPolicy.epoch + 1))' "$TRANSACTION_FILE" >/dev/null; then
        echo "error: macOS signing reset transaction is malformed; refusing destructive recovery"
        exit 1
    fi
    RECOVERY_NEW_FINGERPRINT="$(jq -r '.newFingerprint' "$TRANSACTION_FILE")"
    RECOVERY_NEW_EPOCH="$(jq -r '.newPolicy.epoch' "$TRANSACTION_FILE")"
    RECOVERY_BACKUP_FILE="$BACKUP_REAL/ctrl-macos-signing-epoch-${RECOVERY_NEW_EPOCH}-${RECOVERY_NEW_FINGERPRINT}.p12"
    if [[ "$(jq -r '.receipt.path // empty' "$TRANSACTION_FILE")" != "$RECOVERY_BACKUP_FILE" ]]; then
        echo "error: macOS signing reset transaction backup path is not the derived epoch path"
        exit 1
    fi
    RECOVERY_OLD_FINGERPRINT="$(jq -r '.oldPolicy.activeFingerprint' "$TRANSACTION_FILE")"
    RECOVERY_TMP="$(mktemp "${TMPDIR:-/tmp}/ctrl-codesign-policy.XXXXXX")"
    if [[ -f "$RECOVERY_BACKUP_FILE" ]] &&
       security find-generic-password -s ctrl-codesign-backup-passphrase -a ctrl-macos-signing >/dev/null 2>&1 &&
       security find-generic-password -s ctrl-codesign-backup-receipt -a ctrl-macos-signing >/dev/null 2>&1 &&
       security find-identity -v -p codesigning "$LOGIN_KEYCHAIN" 2>/dev/null | \
           awk -v requested="$RECOVERY_NEW_FINGERPRINT" 'toupper($2) == requested { found = 1 } END { exit !found }'; then
        apply_signing_identity "$RECOVERY_NEW_FINGERPRINT"
        jq '.newPolicy' "$TRANSACTION_FILE" > "$RECOVERY_TMP"
        durable_install "$RECOVERY_TMP" "$POLICY_FILE" 644
        if bash scripts/check-macos-signing-identity.sh; then
            durable_remove "$TRANSACTION_FILE"
            rm -f "$RECOVERY_TMP"
            echo "interrupted macOS signing identity reset completed"
            exit 0
        fi
    fi
    apply_signing_identity "$RECOVERY_OLD_FINGERPRINT"
    jq '.oldPolicy' "$TRANSACTION_FILE" > "$RECOVERY_TMP"
    durable_install "$RECOVERY_TMP" "$POLICY_FILE" 644
    security delete-identity -Z "$RECOVERY_NEW_FINGERPRINT" "$LOGIN_KEYCHAIN" >/dev/null 2>&1 || true
    for service in ctrl-codesign-backup-passphrase ctrl-codesign-backup-receipt; do
        security delete-generic-password -s "$service" -a ctrl-macos-signing >/dev/null 2>&1 || true
    done
    durable_remove "$RECOVERY_BACKUP_FILE"
    durable_remove "$TRANSACTION_FILE"
    rm -f "$RECOVERY_TMP"
    echo "error: interrupted macOS signing identity reset was incomplete and has been rolled back; rerun the command"
    exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
    echo "error: macOS signing identity reset must start from a clean worktree"
    exit 1
fi
OLD_EPOCH="$(jq -r '.epoch' "$POLICY_FILE")"
OLD_FINGERPRINT="$(jq -r '.activeFingerprint' "$POLICY_FILE")"
if ! [[ "$OLD_EPOCH" =~ ^[1-9][0-9]*$ && "$OLD_FINGERPRINT" =~ ^[0-9A-F]{40}$ ]]; then
    echo "error: macOS signing trust policy is malformed"
    exit 1
fi
NEW_EPOCH="$((OLD_EPOCH + 1))"
NEW_LABEL="CTRL Dev Signing Epoch $NEW_EPOCH"
for service in ctrl-codesign-backup-passphrase ctrl-codesign-backup-receipt; do
    if security find-generic-password -s "$service" -a ctrl-macos-signing >/dev/null 2>&1; then
        echo "error: macOS signing backup state is not empty ($service); restore the recoverable identity instead of rotating it"
        exit 1
    fi
done

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ctrl-codesign-reset.XXXXXX")"
chmod 700 "$TMP_DIR"
BACKUP_FILE=""
NEW_FINGERPRINT=""
ROLLBACK_ARMED=0
cleanup() {
    local status="$?"
    unset BACKUP_PASSPHRASE
    if [[ "$status" -ne 0 && "$ROLLBACK_ARMED" -eq 1 ]]; then
        set +e
        durable_install "$TMP_DIR/original-tauri.conf.json" "$CONFIG_FILE" 644
        durable_install "$TMP_DIR/original-macos-signing-trust.json" "$POLICY_FILE" 644
        [[ -z "$NEW_FINGERPRINT" ]] || security delete-identity -Z "$NEW_FINGERPRINT" "$LOGIN_KEYCHAIN" >/dev/null 2>&1
        for service in ctrl-codesign-backup-passphrase ctrl-codesign-backup-receipt; do
            security delete-generic-password -s "$service" -a ctrl-macos-signing >/dev/null 2>&1
        done
        [[ -z "$BACKUP_FILE" ]] || durable_remove "$BACKUP_FILE"
        durable_remove "$TRANSACTION_FILE"
        set -e
    fi
    rm -rf "$TMP_DIR"
    return "$status"
}
trap cleanup EXIT
cp "$CONFIG_FILE" "$TMP_DIR/original-tauri.conf.json"
cp "$POLICY_FILE" "$TMP_DIR/original-macos-signing-trust.json"

cat > "$TMP_DIR/openssl.cnf" <<EOF
[req]
distinguished_name = subject
prompt = no
x509_extensions = codesign

[subject]
CN = $NEW_LABEL
O = CTRL Development

[codesign]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
EOF
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$TMP_DIR/private-key.pem" >/dev/null 2>&1
chmod 600 "$TMP_DIR/private-key.pem"
openssl req -new -x509 -sha256 -days 3650 \
    -key "$TMP_DIR/private-key.pem" -out "$TMP_DIR/certificate.pem" \
    -config "$TMP_DIR/openssl.cnf" -extensions codesign >/dev/null 2>&1
NEW_FINGERPRINT="$(openssl x509 -in "$TMP_DIR/certificate.pem" -noout -fingerprint -sha1 | \
    sed 's/.*=//; s/://g' | tr '[:lower:]' '[:upper:]')"
if ! [[ "$NEW_FINGERPRINT" =~ ^[0-9A-F]{40}$ ]] || [[ "$NEW_FINGERPRINT" = "$OLD_FINGERPRINT" ]]; then
    echo "error: generated macOS signing certificate is invalid or did not rotate"
    exit 1
fi

BACKUP_PASSPHRASE="$(openssl rand -base64 48)"
BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" openssl pkcs12 -export -name "$NEW_LABEL" \
    -inkey "$TMP_DIR/private-key.pem" -in "$TMP_DIR/certificate.pem" \
    -out "$TMP_DIR/identity.p12" -passout env:BACKUP_PASSPHRASE >/dev/null 2>&1
chmod 600 "$TMP_DIR/identity.p12"
BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" openssl pkcs12 -in "$TMP_DIR/identity.p12" -clcerts -nokeys \
    -passin env:BACKUP_PASSPHRASE -out "$TMP_DIR/verified-cert.pem" >/dev/null 2>&1
VERIFIED_FINGERPRINT="$(openssl x509 -in "$TMP_DIR/verified-cert.pem" -noout -fingerprint -sha1 | \
    sed 's/.*=//; s/://g' | tr '[:lower:]' '[:upper:]')"
if [[ "$VERIFIED_FINGERPRINT" != "$NEW_FINGERPRINT" ]]; then
    echo "error: encrypted PKCS#12 backup verification failed"
    exit 1
fi

BACKUP_FILE="$BACKUP_DIR/ctrl-macos-signing-epoch-${NEW_EPOCH}-${NEW_FINGERPRINT}.p12"
if [[ -e "$BACKUP_FILE" ]]; then
    echo "error: macOS signing backup target already exists: $BACKUP_FILE"
    exit 1
fi
BACKUP_SHA256="$(shasum -a 256 "$TMP_DIR/identity.p12" | awk '{print $1}')"
BACKUP_RECEIPT="$(jq -cn \
    --arg path "$BACKUP_FILE" --arg sha256 "$BACKUP_SHA256" \
    --arg fingerprint "$NEW_FINGERPRINT" --argjson epoch "$NEW_EPOCH" \
    '{path: $path, sha256: $sha256, fingerprint: $fingerprint, epoch: $epoch}')"

node - "$CONFIG_FILE" "$NEW_FINGERPRINT" "$TMP_DIR/new-tauri.conf.json" <<'NODE'
const fs = require("fs");
const [input, fingerprint, output] = process.argv.slice(2);
const source = fs.readFileSync(input, "utf8");
const config = JSON.parse(source);
const needle = `"signingIdentity": ${JSON.stringify(config.bundle.macOS.signingIdentity)}`;
if (source.split(needle).length !== 2) process.exit(1);
fs.writeFileSync(output, source.replace(needle, `"signingIdentity": ${JSON.stringify(fingerprint)}`));
NODE
jq \
    --argjson epoch "$NEW_EPOCH" --arg active "$NEW_FINGERPRINT" \
    --arg label "$NEW_LABEL" --arg previous "$OLD_FINGERPRINT" \
    --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '.epoch = $epoch | .activeFingerprint = $active | .activeLabel = $label |
     .previousFingerprint = $previous | .resetReason = "private-key-inaccessible" |
     .resetAt = $date' "$POLICY_FILE" > "$TMP_DIR/new-macos-signing-trust.json"
jq -n \
    --arg newFingerprint "$NEW_FINGERPRINT" --argjson receipt "$BACKUP_RECEIPT" \
    --slurpfile oldPolicy "$POLICY_FILE" --slurpfile newPolicy "$TMP_DIR/new-macos-signing-trust.json" \
    '{phase: "prepared", newFingerprint: $newFingerprint, receipt: $receipt,
      oldPolicy: $oldPolicy[0], newPolicy: $newPolicy[0]}' > "$TMP_DIR/reset-transaction.json"
durable_install "$TMP_DIR/reset-transaction.json" "$TRANSACTION_FILE" 600
ROLLBACK_ARMED=1

durable_install "$TMP_DIR/identity.p12" "$BACKUP_FILE" 600
write_transaction_phase backup-written
printf '%s' "$BACKUP_PASSPHRASE" | scripts/keychain-secret.swift add \
    ctrl-codesign-backup-passphrase ctrl-macos-signing >/dev/null
printf '%s' "$BACKUP_RECEIPT" | scripts/keychain-secret.swift add \
    ctrl-codesign-backup-receipt ctrl-macos-signing >/dev/null
write_transaction_phase backup-evidence-written

# Import a temporary mode-0600 PKCS#12 with a non-secret compatibility password
# so no recovery secret appears in argv. The temporary container is deleted;
# only the encrypted durable backup uses the independent random secret.
# (ADR-004 cap § updater v9)
openssl pkcs12 -export -name "$NEW_LABEL" \
    -inkey "$TMP_DIR/private-key.pem" -in "$TMP_DIR/certificate.pem" \
    -out "$TMP_DIR/import-identity.p12" -passout pass:ctrl-transient-import-v1 >/dev/null 2>&1
chmod 600 "$TMP_DIR/import-identity.p12"
security import "$TMP_DIR/import-identity.p12" -k "$LOGIN_KEYCHAIN" -P "ctrl-transient-import-v1" \
    -T /usr/bin/codesign >/dev/null
security add-trusted-cert -r trustRoot -p codeSign -k "$LOGIN_KEYCHAIN" \
    "$TMP_DIR/certificate.pem" >/dev/null
write_transaction_phase identity-imported

durable_install "$TMP_DIR/new-tauri.conf.json" "$CONFIG_FILE" 644
durable_install "$TMP_DIR/new-macos-signing-trust.json" "$POLICY_FILE" 644
write_transaction_phase source-updated
if [[ -n "$(git status --porcelain --untracked-files=normal | grep -vE '^( M|M ) (scripts/macos-signing-trust.json|src-tauri/tauri.conf.json)$' || true)" ]]; then
    echo "error: unexpected source changed during macOS signing reset"
    exit 1
fi
bash scripts/check-macos-signing-identity.sh
write_transaction_phase verified
durable_remove "$TRANSACTION_FILE"
ROLLBACK_ARMED=0
printf 'macOS signing identity reset prepared: epoch=%s fingerprint=%s\n' "$NEW_EPOCH" "$NEW_FINGERPRINT"
printf 'encrypted PKCS#12 backup: %s\n' "$BACKUP_FILE"
printf 'next: review and commit tauri.conf.json plus scripts/macos-signing-trust.json before release\n'
