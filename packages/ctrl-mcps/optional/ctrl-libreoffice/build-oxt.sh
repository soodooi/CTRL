#!/bin/sh
# Application-owned extension packaging remains outside the JS MCP runtime lock.
# (ADR-004 cap §1 v13; ADR-010 communication § transports v13)
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE="$ROOT/extension"
DIST="$ROOT/dist"
OUTPUT="$DIST/ctrl-libreoffice-companion.oxt"

mkdir -p "$DIST"
rm -f "$OUTPUT"
(
  cd "$SOURCE"
  /usr/bin/zip -X -q -r "$OUTPUT" \
    description.xml description.txt Addons.xcu META-INF ctrl_companion.py LICENSE
)
printf '%s\n' "$OUTPUT"
