#!/bin/bash
set -euo pipefail

# Control one-shot faults recognized only by updater-debug-channel binaries.
# (ADR-004 cap § updater v11)

FAULT_FILE="${HOME}/.ctrl/state/updater-debug-fault"
VALID_FAULTS="launch_failure health_timeout rollback_interrupt"
ACTION="${1:-show}"

validate_fault() {
    local requested="$1" valid
    for valid in $VALID_FAULTS; do
        if [[ "$requested" == "$valid" ]]; then
            return 0
        fi
    done
    echo "error: unknown updater fault: $requested" >&2
    echo "valid faults: $VALID_FAULTS" >&2
    return 1
}

case "$ACTION" in
    set)
        shift
        if [[ "$#" -eq 0 ]]; then
            echo "error: set requires at least one fault" >&2
            exit 1
        fi
        seen_faults=""
        for fault in "$@"; do
            validate_fault "$fault"
            case " $seen_faults " in
                *" $fault "*)
                    echo "error: duplicate updater fault: $fault" >&2
                    exit 1
                    ;;
            esac
            seen_faults="$seen_faults $fault"
        done
        mkdir -p "$(dirname "$FAULT_FILE")"
        chmod 700 "$(dirname "$FAULT_FILE")"
        temporary="${FAULT_FILE}.$$"
        umask 077
        printf '%s\n' "$@" > "$temporary"
        mv "$temporary" "$FAULT_FILE"
        chmod 600 "$FAULT_FILE"
        printf 'armed updater faults:'
        printf ' %s' "$@"
        printf '\n'
        ;;
    clear)
        rm -f "$FAULT_FILE"
        echo "updater faults cleared"
        ;;
    show)
        if [[ -f "$FAULT_FILE" ]]; then
            echo "armed updater faults:"
            cat "$FAULT_FILE"
        else
            echo "no updater faults armed"
        fi
        ;;
    *)
        echo "usage: $0 [show|clear|set FAULT...]" >&2
        echo "valid faults: $VALID_FAULTS" >&2
        exit 1
        ;;
esac
