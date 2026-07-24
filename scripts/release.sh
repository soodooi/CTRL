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
#   5. The configured macOS code-signing identity is installed and its
#      keychain is unlocked before invoking this release-only script
#
# What it does:
#   1. Verifies a clean committed tree with synchronized release versions
#   2. Audits changes from a source commit proven by prior release metadata
#   3. Builds aarch64-apple-darwin .app + fresh .app.tar.gz + .sig
#   4. Generates latest.json bound to the exact source, version, URL, archive hash, and signature
#   5. Publishes the source tag first, then uploads and re-verifies the signed release pair
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

# A release artifact must be reproducible from exactly one committed tree. The
# version bump is therefore a normal reviewed commit, never a release-script
# mutation. (ADR-004 cap § updater v5)
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
    echo "error: release requires a clean worktree (tracked and untracked)"
    echo "       commit the reviewed version synchronization before running release.sh"
    exit 1
fi
ROOT_VERSION="$(node -p "require('./package.json').version")"
WEB_VERSION="$(node -p "require('./packages/ctrl-web/package.json').version")"
NPM_LOCK_VERSION="$(node -p "require('./package-lock.json').version")"
NPM_LOCK_ROOT_VERSION="$(node -p "require('./package-lock.json').packages[''].version")"
NPM_LOCK_WEB_VERSION="$(node -p "require('./package-lock.json').packages['packages/ctrl-web'].version")"
TAURI_VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
CARGO_VERSION="$(awk '/^\[package\]/{in_package=1; next} in_package && /^version = /{gsub(/.*\"|\".*/, ""); print; exit}' src-tauri/Cargo.toml)"
CARGO_LOCK_VERSION="$(awk '
    /^\[\[package\]\]/{in_package=1; name=""; next}
    in_package && /^name = "ctrl"$/{name="ctrl"; next}
    in_package && name == "ctrl" && /^version = /{gsub(/.*"|".*/, ""); print; exit}
' src-tauri/Cargo.lock)"
# Validate every metadata target managed by bump-version.mjs before building.
# A manifest-only check could publish from stale lockfile inputs.
# (ADR-004 cap § updater v6)
if [[ "$ROOT_VERSION" != "$VERSION" || "$WEB_VERSION" != "$VERSION" ||
      "$NPM_LOCK_VERSION" != "$VERSION" || "$NPM_LOCK_ROOT_VERSION" != "$VERSION" ||
      "$NPM_LOCK_WEB_VERSION" != "$VERSION" || "$TAURI_VERSION" != "$VERSION" ||
      "$CARGO_VERSION" != "$VERSION" || "$CARGO_LOCK_VERSION" != "$VERSION" ]]; then
    echo "error: requested version $VERSION is not committed consistently"
    echo "       root=$ROOT_VERSION web=$WEB_VERSION npm-lock=$NPM_LOCK_VERSION"
    echo "       npm-lock-root=$NPM_LOCK_ROOT_VERSION npm-lock-web=$NPM_LOCK_WEB_VERSION"
    echo "       tauri=$TAURI_VERSION cargo=$CARGO_VERSION cargo-lock=$CARGO_LOCK_VERSION"
    exit 1
fi
if ! command -v minisign >/dev/null 2>&1; then
    echo "error: minisign is required to verify updater archive signatures before publication"
    echo "       install it with: brew install minisign"
    exit 1
fi
UPDATER_PUBKEY_B64="$(node -p "require('./src-tauri/tauri.conf.json').plugins.updater.pubkey")"
UPDATER_MINISIGN_PUBKEY="$(node -e '
  const decoded = Buffer.from(process.argv[1], "base64").toString("utf8").trim().split(/\r?\n/);
  process.stdout.write(decoded[1] || "");
' "$UPDATER_PUBKEY_B64")"
if [[ ! "$UPDATER_MINISIGN_PUBKEY" =~ ^[A-Za-z0-9+/=]+$ ]]; then
    echo "error: updater public key in tauri.conf.json is not a valid minisign key"
    exit 1
fi

# Release governance is measured from a verified previously-published source,
# never @{u}: synchronized main would otherwise produce an empty diff.
# (ADR-004 cap § updater v5)
SOURCE_COMMIT="$(git rev-parse HEAD)"
SOURCE_TAG="v${VERSION}-release"

verify_source_state() {
    local current_commit
    current_commit="$(git rev-parse HEAD)"
    if [[ "$current_commit" != "$SOURCE_COMMIT" ]]; then
        echo "error: HEAD moved during release ($SOURCE_COMMIT -> $current_commit)"
        return 1
    fi
    if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
        echo "error: tracked or untracked source changed during release"
        return 1
    fi
}

semver_lt() {
    local left="$1" right="$2"
    local left_major left_minor left_patch right_major right_minor right_patch
    IFS=. read -r left_major left_minor left_patch <<< "$left"
    IFS=. read -r right_major right_minor right_patch <<< "$right"
    (( left_major < right_major )) ||
        (( left_major == right_major && left_minor < right_minor )) ||
        (( left_major == right_major && left_minor == right_minor && left_patch < right_patch ))
}

release_exists() {
    local release_tag="$1"
    local response
    if response="$(gh api "repos/${REPO_RELEASES}/releases/tags/${release_tag}" \
            --jq '.id' 2>&1)"; then
        return 0
    fi
    if [[ "$response" == *"HTTP 404"* ]]; then
        return 1
    fi
    echo "error: could not determine whether release $release_tag exists" >&2
    echo "       $response" >&2
    exit 1
}

release_body_has_provenance() {
    local body="$1"
    [[ "$body" =~ (^|$'\n')Source\ commit: ||
       "$body" =~ (^|$'\n')Source\ tag: ]]
}

release_body_matches_source() {
    local body="$1" expected_commit="$2" expected_tag="$3"
    local commit_count tag_count body_commit body_tag
    commit_count="$(awk '/^Source commit:/{count++} END{print count+0}' <<< "$body")"
    tag_count="$(awk '/^Source tag:/{count++} END{print count+0}' <<< "$body")"
    [[ "$commit_count" -eq 1 && "$tag_count" -eq 1 ]] || return 1
    body_commit="$(awk '/^Source commit:/{sub(/^Source commit:[[:space:]]*/, ""); print}' <<< "$body")"
    body_tag="$(awk '/^Source tag:/{sub(/^Source tag:[[:space:]]*/, ""); print}' <<< "$body")"
    [[ "$body_commit" = "$expected_commit" && "$body_tag" = "$expected_tag" ]]
}

git fetch --tags origin

published_source_commit() {
    local tag="$1"
    local local_commit remote_commit release_version release_tag release_body
    local metadata_commit sidecar_commit
    local_commit="$(git rev-parse --verify "${tag}^{commit}" 2>/dev/null)" || return 1
    remote_commit="$(git ls-remote --tags --refs origin "refs/tags/${tag}" | awk 'NR == 1 { print $1 }')"
    [[ -n "$remote_commit" && "$remote_commit" = "$local_commit" ]] || return 1
    release_version="${tag#v}"
    release_version="${release_version%-release}"
    release_tag="v${release_version}"
    release_exists "$release_tag" || return 1
    release_body="$(gh release view "$release_tag" --repo "$REPO_RELEASES" \
        --json body --jq '.body')" || return 1
    if release_body_has_provenance "$release_body" &&
       ! release_body_matches_source "$release_body" "$local_commit" "$tag"; then
        return 1
    fi
    metadata_commit="$(published_release_source_commit "$release_tag" "$tag")" || return 1
    [[ "$metadata_commit" = "$local_commit" ]] || return 1
    if release_has_asset "$release_tag" source-provenance.json; then
        sidecar_commit="$(published_release_source_commit \
            "$release_tag" "$tag" source-provenance.json)" || return 1
        [[ "$sidecar_commit" = "$local_commit" ]] || return 1
    fi
    printf '%s' "$local_commit"
}

published_release_source_commit() {
    local release_tag="$1"
    local expected_source_tag="${2:-}"
    local required_asset="${3:-}"
    local metadata_dir metadata_file published_commit published_tag resolved_commit
    local has_commit has_tag asset
    metadata_dir="$(mktemp -d)"
    asset="${required_asset:-latest.json}"
    metadata_file="$metadata_dir/$asset"

    if ! gh release download "$release_tag" --repo "$REPO_RELEASES" \
            --pattern "$asset" --dir "$metadata_dir" >/dev/null 2>&1 ||
       ! jq -e 'type == "object"' "$metadata_file" >/dev/null 2>&1; then
        rm -rf "$metadata_dir"
        return 1
    fi
    has_commit="$(jq -r 'has("source_commit")' "$metadata_file")"
    has_tag="$(jq -r 'has("source_tag")' "$metadata_file")"

    if [[ "$has_commit" = false && "$has_tag" = false &&
          -z "$required_asset" && "$asset" = latest.json ]]; then
        # The sidecar is valid fallback only for a successfully downloaded,
        # valid legacy latest.json that demonstrably has neither field.
        rm -f "$metadata_file"
        asset=source-provenance.json
        metadata_file="$metadata_dir/$asset"
        if ! gh release download "$release_tag" --repo "$REPO_RELEASES" \
                --pattern "$asset" --dir "$metadata_dir" >/dev/null 2>&1 ||
           ! jq -e 'type == "object"' "$metadata_file" >/dev/null 2>&1; then
            rm -rf "$metadata_dir"
            return 1
        fi
        has_commit="$(jq -r 'has("source_commit")' "$metadata_file")"
        has_tag="$(jq -r 'has("source_tag")' "$metadata_file")"
    fi

    if [[ "$has_commit" != true || "$has_tag" != true ]]; then
        rm -rf "$metadata_dir"
        return 1
    fi
    published_commit="$(jq -r '.source_commit // empty' "$metadata_file")"
    published_tag="$(jq -r '.source_tag // empty' "$metadata_file")"
    rm -rf "$metadata_dir"
    [[ "$published_commit" =~ ^[0-9a-fA-F]{40}$ ]] || return 1
    [[ "$published_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-release$ ]] || return 1
    if [[ -n "$expected_source_tag" && "$published_tag" != "$expected_source_tag" ]]; then
        return 1
    fi
    resolved_commit="$(git rev-parse --verify "${published_commit}^{commit}" 2>/dev/null)" || return 1
    printf '%s' "$resolved_commit"
}

release_has_asset() {
    local release_tag="$1"
    local asset_name="$2"
    local assets
    if ! assets="$(gh release view "$release_tag" --repo "$REPO_RELEASES" --json assets \
            --jq '.assets[].name')"; then
        echo "error: could not read asset list for release $release_tag" >&2
        exit 1
    fi
    grep -Fxq "$asset_name" <<< "$assets"
}

published_release_pair_matches() {
    local release_tag="$1"
    local archive_name="$2"
    local expected_commit="$3"
    local expected_tag="$4"
    local expected_version="$5"
    local expected_url="$6"
    local pair_dir metadata_commit metadata_tag metadata_version metadata_url
    local metadata_signature expected_sha actual_sha signature_ok
    pair_dir="$(mktemp -d)"
    if ! gh release download "$release_tag" --repo "$REPO_RELEASES" \
            --pattern latest.json --dir "$pair_dir" >/dev/null 2>&1 ||
       ! gh release download "$release_tag" --repo "$REPO_RELEASES" \
            --pattern "$archive_name" --dir "$pair_dir" >/dev/null 2>&1 ||
       ! jq -e 'type == "object"' "$pair_dir/latest.json" >/dev/null 2>&1; then
        rm -rf "$pair_dir"
        return 1
    fi
    metadata_commit="$(jq -r '.source_commit // empty' "$pair_dir/latest.json")"
    metadata_tag="$(jq -r '.source_tag // empty' "$pair_dir/latest.json")"
    metadata_version="$(jq -r '.version // empty' "$pair_dir/latest.json")"
    metadata_url="$(jq -r '.platforms["darwin-aarch64"].url // empty' "$pair_dir/latest.json")"
    metadata_signature="$(jq -r '.platforms["darwin-aarch64"].signature // empty' "$pair_dir/latest.json")"
    expected_sha="$(jq -r '.archive_sha256 // empty' "$pair_dir/latest.json")"
    actual_sha="$(shasum -a 256 "$pair_dir/$archive_name" | awk '{print $1}')"
    signature_ok=0
    if node -e '
      const fs = require("fs");
      fs.writeFileSync(process.argv[2], Buffer.from(process.argv[1], "base64"));
    ' "$metadata_signature" "$pair_dir/archive.minisig" &&
       minisign -Vm "$pair_dir/$archive_name" -P "$UPDATER_MINISIGN_PUBKEY" \
            -x "$pair_dir/archive.minisig" -q >/dev/null 2>&1; then
        signature_ok=1
    fi
    rm -rf "$pair_dir"
    [[ "$metadata_commit" = "$expected_commit" &&
       "$metadata_tag" = "$expected_tag" &&
       "$metadata_version" = "$expected_version" &&
       "$metadata_url" = "$expected_url" &&
       "$expected_sha" =~ ^[0-9a-f]{64}$ &&
       "$actual_sha" = "$expected_sha" &&
       "$signature_ok" -eq 1 ]]
}

PREVIOUS_SOURCE_TAG=""
GOVERNANCE_BASE_COMMIT=""
for candidate in $(git tag --merged "$SOURCE_COMMIT" --list 'v*-release' --sort=-version:refname); do
    # The current version's pending source tag is retry state, never the prior
    # governance baseline for the artifact being resumed. Higher-version tags
    # are likewise ineligible even if their commits happen to be ancestors.
    [[ "$candidate" = "$SOURCE_TAG" ]] && continue
    [[ "$candidate" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-release$ ]] || continue
    candidate_version="${candidate#v}"
    candidate_version="${candidate_version%-release}"
    if ! semver_lt "$candidate_version" "$VERSION"; then
        continue
    fi
    if candidate_commit="$(published_source_commit "$candidate")"; then
        PREVIOUS_SOURCE_TAG="$candidate"
        GOVERNANCE_BASE_COMMIT="$candidate_commit"
        break
    fi
done

if [[ -n "${GOVERNANCE_BASE:-}" ]]; then
    if [[ "$GOVERNANCE_BASE" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-release$ ]]; then
        GOVERNANCE_BASE_VERSION="${GOVERNANCE_BASE#v}"
        GOVERNANCE_BASE_VERSION="${GOVERNANCE_BASE_VERSION%-release}"
        if ! semver_lt "$GOVERNANCE_BASE_VERSION" "$VERSION"; then
            echo "error: governance tag $GOVERNANCE_BASE must be earlier than v${VERSION}"
            exit 1
        fi
        if ! GOVERNANCE_BASE_COMMIT="$(published_source_commit "$GOVERNANCE_BASE")"; then
            echo "error: governance tag $GOVERNANCE_BASE is not both remote and published"
            exit 1
        fi
    elif [[ "$GOVERNANCE_BASE" =~ ^[0-9a-fA-F]{40}$ ]]; then
        if [[ -n "$PREVIOUS_SOURCE_TAG" ]]; then
            echo "error: raw SHA override is bootstrap-only; use a verified v*-release tag"
            exit 1
        fi
        if [[ ! "${GOVERNANCE_BOOTSTRAP_RELEASE:-}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "error: first-tag bootstrap requires GOVERNANCE_BOOTSTRAP_RELEASE=vX.Y.Z"
            exit 1
        fi
        if [[ "${GOVERNANCE_BOOTSTRAP_APPROVED:-}" != "I_UNDERSTAND" ]]; then
            echo "error: first-tag bootstrap mutates historical public provenance"
            echo "       set GOVERNANCE_BOOTSTRAP_APPROVED=I_UNDERSTAND after reviewing the release/SHA pair"
            exit 1
        fi
        GOVERNANCE_BASE_COMMIT="$(git rev-parse --verify "${GOVERNANCE_BASE}^{commit}" 2>/dev/null)" || {
            echo "error: bootstrap governance SHA does not resolve to a commit"
            exit 1
        }
        BOOTSTRAP_VERSION="${GOVERNANCE_BOOTSTRAP_RELEASE#v}"
        if ! semver_lt "$BOOTSTRAP_VERSION" "$VERSION"; then
            echo "error: bootstrap release $GOVERNANCE_BOOTSTRAP_RELEASE must be earlier than v${VERSION}"
            exit 1
        fi
        if [[ "$GOVERNANCE_BASE_COMMIT" = "$SOURCE_COMMIT" ]]; then
            echo "error: bootstrap governance base resolves to HEAD"
            exit 1
        fi
        if ! git merge-base --is-ancestor "$GOVERNANCE_BASE_COMMIT" "$SOURCE_COMMIT"; then
            echo "error: bootstrap governance base is not an ancestor of $SOURCE_COMMIT"
            exit 1
        fi
        if ! release_exists "$GOVERNANCE_BOOTSTRAP_RELEASE"; then
            echo "error: bootstrap release $GOVERNANCE_BOOTSTRAP_RELEASE does not exist publicly"
            exit 1
        fi
        if ! BOOTSTRAP_RELEASE_BODY="$(gh release view "$GOVERNANCE_BOOTSTRAP_RELEASE" \
                --repo "$REPO_RELEASES" --json body --jq '.body')"; then
            echo "error: bootstrap release body could not be read"
            exit 1
        fi
        if release_body_has_provenance "$BOOTSTRAP_RELEASE_BODY" &&
           ! release_body_matches_source "$BOOTSTRAP_RELEASE_BODY" \
                "$GOVERNANCE_BASE_COMMIT" "${GOVERNANCE_BOOTSTRAP_RELEASE}-release"; then
            echo "error: bootstrap release body has partial or conflicting source provenance"
            exit 1
        fi

        # A legacy public release predates latest.json source fields. One
        # explicitly-approved migration creates its immutable source tag and a
        # public provenance sidecar, then re-reads both before using the SHA.
        # (ADR-004 cap § updater v5)
        BOOTSTRAP_SOURCE_TAG="${GOVERNANCE_BOOTSTRAP_RELEASE}-release"
        BOOTSTRAP_LOCAL_COMMIT="$(git rev-parse --verify "${BOOTSTRAP_SOURCE_TAG}^{commit}" 2>/dev/null || true)"
        BOOTSTRAP_REMOTE_COMMIT="$(git ls-remote --tags --refs origin "refs/tags/${BOOTSTRAP_SOURCE_TAG}" | awk 'NR == 1 { print $1 }')"

        # Inspect all existing public provenance before mutating the immutable
        # source-tag namespace. A valid latest.json is authoritative and must
        # already identify the approved pair; a legacy one with no source fields
        # may be supplemented by the sidecar.
        BOOTSTRAP_HAS_PROVENANCE=0
        if ! release_has_asset "$GOVERNANCE_BOOTSTRAP_RELEASE" latest.json; then
            echo "error: bootstrap release has no latest.json to prove legacy provenance state"
            exit 1
        fi
        BOOTSTRAP_LATEST_DIR="$(mktemp -d)"
            if ! gh release download "$GOVERNANCE_BOOTSTRAP_RELEASE" --repo "$REPO_RELEASES" \
                    --pattern latest.json --dir "$BOOTSTRAP_LATEST_DIR" >/dev/null 2>&1; then
                rm -rf "$BOOTSTRAP_LATEST_DIR"
                echo "error: existing bootstrap latest.json could not be downloaded"
                exit 1
            fi
            if ! jq -e 'type == "object"' "$BOOTSTRAP_LATEST_DIR/latest.json" >/dev/null 2>&1; then
                rm -rf "$BOOTSTRAP_LATEST_DIR"
                echo "error: existing bootstrap latest.json is not valid JSON metadata"
                exit 1
            fi
            BOOTSTRAP_LATEST_HAS_COMMIT="$(jq -r 'has("source_commit")' "$BOOTSTRAP_LATEST_DIR/latest.json")"
            BOOTSTRAP_LATEST_HAS_TAG="$(jq -r 'has("source_tag")' "$BOOTSTRAP_LATEST_DIR/latest.json")"
            BOOTSTRAP_LATEST_COMMIT="$(jq -r '.source_commit // empty' "$BOOTSTRAP_LATEST_DIR/latest.json")"
            BOOTSTRAP_LATEST_TAG="$(jq -r '.source_tag // empty' "$BOOTSTRAP_LATEST_DIR/latest.json")"
            rm -rf "$BOOTSTRAP_LATEST_DIR"

            if [[ "$BOOTSTRAP_LATEST_HAS_COMMIT" = false && "$BOOTSTRAP_LATEST_HAS_TAG" = false ]]; then
                : # Demonstrably legacy: neither provenance field exists.
            elif [[ "$BOOTSTRAP_LATEST_HAS_COMMIT" = true &&
                    "$BOOTSTRAP_LATEST_HAS_TAG" = true &&
                    "$BOOTSTRAP_LATEST_COMMIT" =~ ^[0-9a-fA-F]{40}$ &&
                    "$BOOTSTRAP_LATEST_TAG" = "$BOOTSTRAP_SOURCE_TAG" ]]; then
                BOOTSTRAP_LATEST_RESOLVED="$(git rev-parse --verify \
                    "${BOOTSTRAP_LATEST_COMMIT}^{commit}" 2>/dev/null || true)"
                if [[ "$BOOTSTRAP_LATEST_RESOLVED" != "$GOVERNANCE_BASE_COMMIT" ]]; then
                    echo "error: bootstrap latest.json conflicts with the approved release/SHA pair"
                    exit 1
                fi
            else
                echo "error: bootstrap latest.json has partial, malformed, or conflicting provenance"
                exit 1
            fi
        if release_has_asset "$GOVERNANCE_BOOTSTRAP_RELEASE" source-provenance.json; then
            BOOTSTRAP_HAS_PROVENANCE=1
            if ! BOOTSTRAP_PUBLISHED_COMMIT="$(published_release_source_commit \
                    "$GOVERNANCE_BOOTSTRAP_RELEASE" "$BOOTSTRAP_SOURCE_TAG" source-provenance.json)" ||
               [[ "$BOOTSTRAP_PUBLISHED_COMMIT" != "$GOVERNANCE_BASE_COMMIT" ]]; then
                echo "error: existing source-provenance.json conflicts with the approved bootstrap pair"
                exit 1
            fi
        fi

        if [[ -n "$BOOTSTRAP_LOCAL_COMMIT" && "$BOOTSTRAP_LOCAL_COMMIT" != "$GOVERNANCE_BASE_COMMIT" ]]; then
            echo "error: local bootstrap tag $BOOTSTRAP_SOURCE_TAG conflicts with $GOVERNANCE_BASE_COMMIT"
            exit 1
        fi
        if [[ -n "$BOOTSTRAP_REMOTE_COMMIT" && "$BOOTSTRAP_REMOTE_COMMIT" != "$GOVERNANCE_BASE_COMMIT" ]]; then
            echo "error: remote bootstrap tag $BOOTSTRAP_SOURCE_TAG conflicts with $GOVERNANCE_BASE_COMMIT"
            exit 1
        fi
        if [[ -z "$BOOTSTRAP_LOCAL_COMMIT" ]]; then
            git tag "$BOOTSTRAP_SOURCE_TAG" "$GOVERNANCE_BASE_COMMIT"
        fi
        if [[ -z "$BOOTSTRAP_REMOTE_COMMIT" ]]; then
            git push origin "$BOOTSTRAP_SOURCE_TAG"
        fi
        BOOTSTRAP_REMOTE_COMMIT="$(git ls-remote --tags --refs origin "refs/tags/${BOOTSTRAP_SOURCE_TAG}" | awk 'NR == 1 { print $1 }')"
        if [[ "$BOOTSTRAP_REMOTE_COMMIT" != "$GOVERNANCE_BASE_COMMIT" ]]; then
            echo "error: remote bootstrap tag $BOOTSTRAP_SOURCE_TAG was not published at $GOVERNANCE_BASE_COMMIT"
            exit 1
        fi

        if [[ "$BOOTSTRAP_HAS_PROVENANCE" -eq 0 ]]; then
            BOOTSTRAP_DIR="$(mktemp -d)"
            jq -n \
                --arg source_commit "$GOVERNANCE_BASE_COMMIT" \
                --arg source_tag "$BOOTSTRAP_SOURCE_TAG" \
                '{source_commit: $source_commit, source_tag: $source_tag}' \
                > "$BOOTSTRAP_DIR/source-provenance.json"
            gh release upload "$GOVERNANCE_BOOTSTRAP_RELEASE" --repo "$REPO_RELEASES" \
                "$BOOTSTRAP_DIR/source-provenance.json"
            rm -rf "$BOOTSTRAP_DIR"
        fi
        if ! BOOTSTRAP_PUBLISHED_COMMIT="$(published_release_source_commit \
                "$GOVERNANCE_BOOTSTRAP_RELEASE" "$BOOTSTRAP_SOURCE_TAG" source-provenance.json)" ||
           [[ "$BOOTSTRAP_PUBLISHED_COMMIT" != "$GOVERNANCE_BASE_COMMIT" ]]; then
            echo "error: bootstrap provenance could not be read back from $GOVERNANCE_BOOTSTRAP_RELEASE"
            exit 1
        fi
    else
        echo "error: GOVERNANCE_BASE must be a full 40-char commit SHA or vX.Y.Z-release tag"
        exit 1
    fi
elif [[ -z "$GOVERNANCE_BASE_COMMIT" ]]; then
    echo "error: no remote source tag backed by a public release exists"
    echo "       bootstrap once with GOVERNANCE_BASE=<40-char-sha>, GOVERNANCE_BOOTSTRAP_RELEASE=vX.Y.Z,"
    echo "       and GOVERNANCE_BOOTSTRAP_APPROVED=I_UNDERSTAND after reviewing that historical pair"
    exit 1
fi

if [[ "$GOVERNANCE_BASE_COMMIT" = "$SOURCE_COMMIT" ]]; then
    echo "error: governance base resolves to HEAD; refusing an empty release range"
    exit 1
fi
if ! git merge-base --is-ancestor "$GOVERNANCE_BASE_COMMIT" "$SOURCE_COMMIT"; then
    echo "error: governance base $GOVERNANCE_BASE_COMMIT is not an ancestor of $SOURCE_COMMIT"
    exit 1
fi

SOURCE_TAG_PENDING=0
RELEASE_RESUME=0
if tag_commit="$(git rev-parse --verify "${SOURCE_TAG}^{commit}" 2>/dev/null)"; then
    remote_tag_commit="$(git ls-remote --tags --refs origin "refs/tags/${SOURCE_TAG}" | awk 'NR == 1 { print $1 }')"
    if [[ "$tag_commit" != "$SOURCE_COMMIT" || "$remote_tag_commit" != "$SOURCE_COMMIT" ]]; then
        echo "error: existing source tag $SOURCE_TAG does not identify this exact source commit"
        exit 1
    fi
    SOURCE_TAG_PENDING=1

    if release_exists "v${VERSION}"; then
        existing_body="$(gh release view "v${VERSION}" --repo "$REPO_RELEASES" --json body --jq '.body')"
        if ! release_body_matches_source "$existing_body" "$SOURCE_COMMIT" "$SOURCE_TAG"; then
            echo "error: existing release body is not bound exactly to $SOURCE_COMMIT / $SOURCE_TAG"
            exit 1
        fi
        if release_has_asset "v${VERSION}" source-provenance.json; then
            if ! existing_sidecar_commit="$(published_release_source_commit \
                    "v${VERSION}" "$SOURCE_TAG" source-provenance.json)" ||
               [[ "$existing_sidecar_commit" != "$SOURCE_COMMIT" ]]; then
                echo "error: existing provenance sidecar conflicts with release body/latest.json"
                exit 1
            fi
        fi
        # Exact body + remote source tag establish retry ownership. A sidecar,
        # if present, must agree; latest.json/archive validity is repaired later
        # by the signed pair-state logic rather than blocking repair here.
        RELEASE_RESUME=1
    fi
elif release_exists "v${VERSION}"; then
    echo "error: release v${VERSION} exists without the required remote source tag $SOURCE_TAG"
    exit 1
fi

echo "==> [0/9] ADR Release Acceptance audit — block ship on open release-scoped [ ] items"
# Strict mode enforces only bounded Release Acceptance / 发布验收 contracts;
# long-horizon design debt remains visible through the soft CI/development audit.
# ADR_AUDIT_SOFT=1 is reserved for an approved emergency hotfix override.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "${ADR_AUDIT_SOFT:-0}" = "1" ]]; then
    bash "$SCRIPT_DIR/check-adr-acceptance.sh" --soft || true
else
    if ! bash "$SCRIPT_DIR/check-adr-acceptance.sh"; then
        echo "error: ADR acceptance gate failed — close open items or set ADR_AUDIT_SOFT=1 to override"
        exit 1
    fi
fi

echo "==> [1/9] deterministic governance + compiler/test evidence"
# Check the immutable previously-published → current source range, then any
# local edits that the build would consume. (ADR-004 cap § updater v5)
node scripts/check-governance.mjs --base "$GOVERNANCE_BASE_COMMIT" --head "$SOURCE_COMMIT"
node scripts/check-governance.mjs --worktree
npm run typecheck
cargo test --lib --manifest-path src-tauri/Cargo.toml

echo "==> [2/9] pull Tauri signing key from Keychain"
KEY=$(security find-generic-password -s tauri-sign -a ctrl-updater -w 2>/dev/null || true)
if [[ -z "$KEY" ]]; then
    echo "error: tauri-sign keychain entry missing — see prereqs at top of this script"
    exit 1
fi
export TAURI_SIGNING_PRIVATE_KEY="$KEY"
# Password may be optional (key generated with empty password); export
# empty string so the signer accepts it without an interactive prompt.
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

# Code-sign release artifacts with one stable identity so the macOS
# Designated Requirement remains constant across updates. Daily developer
# bundles use `npm run tauri:build` and explicitly skip signing; only this
# release path requires the provisioned identity. The release operator unlocks
# its keychain before running this script; no keychain password belongs in the
# repository. (ADR-004 cap § updater v6)
export APPLE_SIGNING_IDENTITY="$(node -p "require('./src-tauri/tauri.conf.json').bundle.macOS.signingIdentity")"
BUNDLE_IDENTIFIER="$(node -p "require('./src-tauri/tauri.conf.json').identifier")"
if [[ -z "$APPLE_SIGNING_IDENTITY" || -z "$BUNDLE_IDENTIFIER" ]]; then
    echo "error: bundle.macOS.signingIdentity and identifier are required for release builds"
    exit 1
fi
SIGNING_MATCH="$(security find-identity -v -p codesigning 2>/dev/null | awk -v requested="$APPLE_SIGNING_IDENTITY" '
    BEGIN { requested = tolower(requested) }
    {
        fingerprint = tolower($2)
        label = $0
        sub(/^[[:space:]]*[0-9]+\)[[:space:]]+[0-9A-Fa-f]+[[:space:]]+"/, "", label)
        sub(/"[[:space:]]*$/, "", label)
        if (fingerprint == requested || tolower(label) == requested) print $0
    }
')"
if [[ "$(wc -l <<< "$SIGNING_MATCH" | tr -d ' ')" -ne 1 || -z "$SIGNING_MATCH" ]]; then
    echo "error: configured macOS signing identity is unavailable or ambiguous: $APPLE_SIGNING_IDENTITY"
    exit 1
fi
SIGNING_FINGERPRINT="$(awk '{print tolower($2)}' <<< "$SIGNING_MATCH")"
SIGNING_LABEL="$(sed -E 's/^[[:space:]]*[0-9]+\)[[:space:]]+[0-9A-Fa-f]+[[:space:]]+"(.*)"[[:space:]]*$/\1/' <<< "$SIGNING_MATCH")"

verify_macos_code_signature() {
    local app_bundle="$1" details requirement normalized_requirement normalized_identifier
    if [[ ! -d "$app_bundle" ]]; then
        echo "error: expected signed app bundle was not produced: $app_bundle"
        return 1
    fi
    codesign --verify --deep --strict --verbose=4 "$app_bundle"
    details="$(codesign -dv --verbose=4 "$app_bundle" 2>&1)"
    if [[ "$details" != *"Authority=${SIGNING_LABEL}"* || "$details" == *"Signature=adhoc"* ]]; then
        echo "error: built app is not signed by $SIGNING_LABEL"
        return 1
    fi
    requirement="$(codesign -d -r- "$app_bundle" 2>&1)"
    normalized_requirement="$(tr '[:upper:]' '[:lower:]' <<< "$requirement")"
    normalized_identifier="$(tr '[:upper:]' '[:lower:]' <<< "$BUNDLE_IDENTIFIER")"
    if [[ "$normalized_requirement" != *"identifier \"${normalized_identifier}\""* ||
          "$normalized_requirement" != *"certificate root = h\"${SIGNING_FINGERPRINT}\""* ||
          "$normalized_requirement" == *"cdhash"* ]]; then
        echo "error: built app Designated Requirement is not stable or does not match the configured identity"
        echo "$requirement"
        return 1
    fi
    echo "macOS signing verified: $SIGNING_LABEL; stable Designated Requirement"
}

echo "==> [3/9] committed version metadata verified at $VERSION"
# The source tree remains byte-for-byte identical to SOURCE_COMMIT through the
# build; release.sh never edits version files or Cargo.lock.
# (ADR-004 cap § updater v5)

echo "==> [4/9] build for $TARGET (app-only bundle; DMG step is flaky on this machine)"
# Remove prior updater outputs first so a successful release can never reuse a
# stale tarball/signature pair from another source commit.
# (ADR-004 cap § updater v5)
BUNDLE_DIR="src-tauri/target/$TARGET/release/bundle/macos"
APP_BUNDLE="$BUNDLE_DIR/CTRL.app"
TARBALL="$APP_BUNDLE.tar.gz"
SIGFILE="$TARBALL.sig"
rm -rf "$APP_BUNDLE"
rm -f "$TARBALL" "$SIGFILE"

# bundle_dmg.sh has intermittently failed on this dev box (rw.NNNNN.dmg
# leftover from a prior aborted run blocks DMG creation). The updater
# only needs .app + .app.tar.gz + .sig, so restrict to `app` bundle —
# DMG is a developer convenience, not a ship artifact.
npm run tauri -- build --target "$TARGET" --bundles app
verify_macos_code_signature "$APP_BUNDLE"

if [[ ! -f "$TARBALL" || ! -f "$SIGFILE" ]]; then
    echo "error: updater artifacts missing — check tauri.conf.json bundle.createUpdaterArtifacts: true"
    echo "       expected: $TARBALL + $SIGFILE"
    exit 1
fi

RENAMED_TARBALL="CTRL_${VERSION}_aarch64.app.tar.gz"
WORK=$(mktemp -d)
cp "$TARBALL" "$WORK/$RENAMED_TARBALL"
ARCHIVE_SHA256="$(shasum -a 256 "$WORK/$RENAMED_TARBALL" | awk '{print $1}')"

# Current brain runtime probe: verify the bundled Hermes ACP contract before
# publishing. A release must prove the active brain can initialize, create a
# session, and stream a response; compilation alone is insufficient.
# (ADR-004 cap § updater v5)
echo "==> [5/9] runtime probe — Hermes ACP handshake + streaming"
if ! node scripts/probes/hermes-acp-probe.mjs "Reply with exactly: ACP OK"; then
    echo "error: Hermes ACP runtime probe failed — refusing to publish ${VERSION}"
    echo "       configure the bundled Hermes runtime/provider, then retry."
    exit 1
fi

echo "==> [6/9] build latest.json"
# Bind updater metadata to the immutable source provenance for this artifact.
# (ADR-004 cap § updater v5)
SIGNATURE_CONTENT="$(cat "$SIGFILE")"
PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMMIT_SUBJECT="$(git log -1 --pretty=%s)"
RELEASE_NOTES="$(printf '%s\n\nSource commit: %s\nSource tag: %s' \
    "$COMMIT_SUBJECT" "$SOURCE_COMMIT" "$SOURCE_TAG")"
DOWNLOAD_URL="https://github.com/${REPO_RELEASES}/releases/download/v${VERSION}/${RENAMED_TARBALL}"

# jq for safe escaping of the multiline signature content.
# (ADR-004 cap § updater v5)
jq -n \
    --arg version "$VERSION" \
    --arg notes "$COMMIT_SUBJECT" \
    --arg pub_date "$PUB_DATE" \
    --arg signature "$SIGNATURE_CONTENT" \
    --arg url "$DOWNLOAD_URL" \
    --arg source_commit "$SOURCE_COMMIT" \
    --arg source_tag "$SOURCE_TAG" \
    --arg archive_sha256 "$ARCHIVE_SHA256" \
    '{
        version: $version,
        notes: $notes,
        pub_date: $pub_date,
        source_commit: $source_commit,
        source_tag: $source_tag,
        archive_sha256: $archive_sha256,
        platforms: {
            "darwin-aarch64": { signature: $signature, url: $url }
        }
    }' > "$WORK/latest.json"

echo "==> [7/9] publish source provenance, then immutable release v${VERSION}"
# Re-verify after build/probe/metadata generation: the artifact must correspond
# to the same clean committed tree captured in SOURCE_COMMIT, and HEAD must not
# have moved while the release was running.
# (ADR-004 cap § updater v5)
if ! verify_source_state; then
    echo "error: refusing to tag or publish artifacts from a changed source tree"
    exit 1
fi

# The remote source tag must exist and resolve to the exact clean build commit
# before latest.json is exposed. A pending tag from a failed artifact upload may
# be reused only when it already identifies this same commit.
# (ADR-004 cap § updater v5)
if [[ "$SOURCE_TAG_PENDING" -eq 0 ]]; then
    git tag "$SOURCE_TAG" "$SOURCE_COMMIT"
    if ! git push origin "$SOURCE_TAG"; then
        git tag -d "$SOURCE_TAG" >/dev/null
        echo "error: source provenance tag ${SOURCE_TAG} could not be published"
        exit 1
    fi
fi
PUBLISHED_SOURCE_COMMIT="$(git ls-remote --tags --refs origin "refs/tags/${SOURCE_TAG}" | awk 'NR == 1 { print $1 }')"
if [[ "$PUBLISHED_SOURCE_COMMIT" != "$SOURCE_COMMIT" ]]; then
    echo "error: remote source tag ${SOURCE_TAG} does not resolve to ${SOURCE_COMMIT}"
    exit 1
fi

# Create a provenance-bearing release shell first. A retry can prove ownership
# from the shell body even if the first asset upload failed; the pair-state
# logic below reuses a complete pair or replaces any one-sided state.
# (ADR-004 cap § updater v5)
if [[ "$RELEASE_RESUME" -eq 0 ]]; then
    gh release create "v${VERSION}" \
        --repo "$REPO_RELEASES" \
        --title "CTRL ${VERSION}" \
        --notes "$RELEASE_NOTES"
fi

# Treat the updater archive and latest.json as one build pair. Existing
# metadata must match this source before reuse; a one-sided retry state is
# discarded so both assets come from this invocation's fresh build.
# (ADR-004 cap § updater v5)
HAS_METADATA=0
HAS_TARBALL=0
if release_has_asset "v${VERSION}" latest.json; then
    HAS_METADATA=1
fi
if release_has_asset "v${VERSION}" "$RENAMED_TARBALL"; then
    HAS_TARBALL=1
fi

if [[ "$HAS_METADATA" -eq 1 && "$HAS_TARBALL" -eq 1 ]]; then
    if ! published_release_pair_matches "v${VERSION}" "$RENAMED_TARBALL" \
            "$SOURCE_COMMIT" "$SOURCE_TAG" "$VERSION" "$DOWNLOAD_URL"; then
        echo "==> updater assets fail signed version/URL/hash verification; replacing both"
        gh release delete-asset "v${VERSION}" latest.json --repo "$REPO_RELEASES" --yes
        gh release delete-asset "v${VERSION}" "$RENAMED_TARBALL" --repo "$REPO_RELEASES" --yes
        HAS_METADATA=0
        HAS_TARBALL=0
    fi
elif [[ "$HAS_METADATA" -ne "$HAS_TARBALL" ]]; then
    echo "==> incomplete updater asset pair detected; replacing both from the current build"
    if [[ "$HAS_METADATA" -eq 1 ]]; then
        gh release delete-asset "v${VERSION}" latest.json --repo "$REPO_RELEASES" --yes
    fi
    if [[ "$HAS_TARBALL" -eq 1 ]]; then
        gh release delete-asset "v${VERSION}" "$RENAMED_TARBALL" --repo "$REPO_RELEASES" --yes
    fi
    HAS_METADATA=0
    HAS_TARBALL=0
fi

if [[ "$HAS_METADATA" -eq 0 ]]; then
    # Publish the archive first and its digest-bearing updater pointer last. A
    # failure between uploads leaves a one-sided state that retry replaces.
    gh release upload "v${VERSION}" --repo "$REPO_RELEASES" "$WORK/$RENAMED_TARBALL"
    gh release upload "v${VERSION}" --repo "$REPO_RELEASES" "$WORK/latest.json"
fi

echo "==> [8/9] verify release published"
# Re-fetch both updater assets and metadata. A zero exit from create/upload is
# not itself publication evidence on transient network failures.
# (ADR-004 cap § updater v5)
sleep 2
if ! release_has_asset "v${VERSION}" latest.json ||
   ! release_has_asset "v${VERSION}" "$RENAMED_TARBALL"; then
    echo "error: release v${VERSION} is missing latest.json or ${RENAMED_TARBALL}"
    exit 1
fi
if ! published_release_pair_matches "v${VERSION}" "$RENAMED_TARBALL" \
        "$SOURCE_COMMIT" "$SOURCE_TAG" "$VERSION" "$DOWNLOAD_URL"; then
    echo "error: published updater pair fails source/version/URL/SHA-256/signature verification"
    exit 1
fi

# Successful completion means the public metadata and downloaded archive were
# re-read as one digest-bound pair for the immutable source commit/tag.
# (ADR-004 cap § updater v5)
echo "==> [9/9] done"
echo "Release URL: https://github.com/${REPO_RELEASES}/releases/tag/v${VERSION}"
echo "latest.json: $DOWNLOAD_URL"
echo
echo "In CTRL.app: Settings → About → Check for Updates → installs v${VERSION}"
