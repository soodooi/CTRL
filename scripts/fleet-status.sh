#!/usr/bin/env bash
# fleet-status — at-a-glance dashboard for the multi-agent fleet
#
# Usage:
#   bash scripts/fleet-status.sh
#
# Shows:
#   - Main tree (zeus) state: branch, ahead/behind origin, uncommitted
#   - Each worker worktree: lane, branch, dirty count, ahead count
#   - Active handoffs grouped by status (open / claimed / in_progress / done)
#   - Migration ledger summary (if D-05 timestamp scheme detected)
#
# No write side-effects. Safe to run any time.
#
# Spec: .olym/specs/multi-agent-fleet/spec.md §12

set -uo pipefail

# REPO_ROOT: prefer git toplevel (cwd-aware, supports PATH-installed usage);
# fall back to script-relative dirname when not in a git repo (legacy in-repo usage).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi
WORKTREE_BASE="$REPO_ROOT/.worktrees"

bold()  { printf '\033[1m%s\033[0m' "$1"; }
green() { printf '\033[32m%s\033[0m' "$1"; }
yellow(){ printf '\033[33m%s\033[0m' "$1"; }
dim()   { printf '\033[2m%s\033[0m' "$1"; }

# ── Section: trees ─────────────────────────────────────────

echo
bold "Trees"
echo

print_tree() {
  local label="$1" dir="$2"
  if [[ ! -d "$dir/.git" && ! -f "$dir/.git" ]]; then
    echo "  $(dim "$label  → $dir (not a git tree)")"
    return
  fi
  local branch dirty ahead behind
  branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
  dirty=$(git -C "$dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if upstream=$(git -C "$dir" rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null); then
    ahead=$(git -C "$dir" rev-list --count "$upstream..HEAD" 2>/dev/null || echo 0)
    behind=$(git -C "$dir" rev-list --count "HEAD..$upstream" 2>/dev/null || echo 0)
  else
    ahead='?'; behind='?'
  fi
  printf "  %-12s  %-40s  dirty=%-3s ahead=%-3s behind=%-3s\n" \
    "$label" "$branch" "$dirty" "$ahead" "$behind"
}

print_tree "zeus" "$REPO_ROOT"

if [[ -d "$WORKTREE_BASE" ]]; then
  for d in "$WORKTREE_BASE"/*/; do
    [[ -d "$d" ]] || continue
    lane=$(basename "$d")
    if [[ -f "$d/.lane" ]]; then
      lane_in_file=$(cat "$d/.lane" 2>/dev/null | tr -d '[:space:]')
      print_tree "$lane_in_file" "$d"
    else
      print_tree "$lane (no .lane!)" "$d"
    fi
  done
else
  echo "  $(dim '(no .worktrees/ directory yet — run scripts/worktree-new.sh)')"
fi

# ── Section: handoffs ──────────────────────────────────────

echo
bold "Handoffs"
echo

handoffs_dir="$REPO_ROOT/.olym/handoffs"
if [[ -d "$handoffs_dir" ]]; then
  # Note: bash 3.2 (macOS default) does not support `declare -A` — use plain counters.
  count_open=0; count_claimed=0; count_in_progress=0; count_done=0; count_verified=0; count_wontfix=0; count_unknown=0
  for f in "$handoffs_dir"/H-*.md; do
    [[ -f "$f" ]] || continue
    status=$(grep -E '^status:' "$f" | head -1 | sed -E 's/^status:[[:space:]]*//' | tr -d '"' | tr -d "'" | tr -d ' ')
    [[ -z "$status" ]] && status="unknown"
    case "$status" in
      open)        count_open=$((count_open + 1)) ;;
      claimed)     count_claimed=$((count_claimed + 1)) ;;
      in_progress) count_in_progress=$((count_in_progress + 1)) ;;
      done)        count_done=$((count_done + 1)) ;;
      verified)    count_verified=$((count_verified + 1)) ;;
      wontfix)     count_wontfix=$((count_wontfix + 1)) ;;
      *)           count_unknown=$((count_unknown + 1)) ;;
    esac
  done

  for s in open claimed in_progress done verified wontfix; do
    n=0
    case "$s" in
      open)        n=$count_open ;;
      claimed)     n=$count_claimed ;;
      in_progress) n=$count_in_progress ;;
      done)        n=$count_done ;;
      verified)    n=$count_verified ;;
      wontfix)     n=$count_wontfix ;;
    esac
    if [[ "$n" -gt 0 ]]; then
      printf "  %-12s  %d\n" "$s" "$n"
    fi
  done

  active_count=$((count_open + count_claimed + count_in_progress))
  if [[ "$active_count" -gt 0 ]]; then
    echo
    echo "  $(yellow 'Active (open/claimed/in_progress):')"
    for f in "$handoffs_dir"/H-*.md; do
      [[ -f "$f" ]] || continue
      status=$(grep -E '^status:' "$f" | head -1 | sed -E 's/^status:[[:space:]]*//' | tr -d '"' | tr -d "'" | tr -d ' ')
      case "$status" in
        open|claimed|in_progress) ;;
        *) continue ;;
      esac
      id=$(grep -E '^id:' "$f" | head -1 | sed -E 's/^id:[[:space:]]*//' | tr -d '"' | tr -d "'")
      title=$(grep -E '^title:' "$f" | head -1 | sed -E 's/^title:[[:space:]]*//' | tr -d '"' | tr -d "'" | head -c 60)
      assigned=$(grep -E '^assigned_to:' "$f" | head -1 | sed -E 's/^assigned_to:[[:space:]]*//' | tr -d '"' | tr -d "'" | tr -d ' ')
      severity=$(grep -E '^severity:' "$f" | head -1 | sed -E 's/^severity:[[:space:]]*//' | tr -d '"' | tr -d "'" | tr -d ' ')
      printf "    %s  [%s]  %-12s  %s\n" "$id" "$severity" "→$assigned" "$title"
    done
  fi
else
  echo "  $(dim 'no .olym/handoffs/ — fleet not initialised')"
fi

# ── Section: migrations ────────────────────────────────────

echo
bold "Migrations"
echo

mig_dir="$REPO_ROOT/database/migrations"
if [[ -d "$mig_dir" ]]; then
  total=$(find "$mig_dir" -name '*.sql' -type f 2>/dev/null | wc -l | tr -d ' ')
  ts_count=$(find "$mig_dir" -name '20*-*.sql' -type f 2>/dev/null | wc -l | tr -d ' ')
  echo "  total .sql files:  $total"
  if [[ "$ts_count" -gt 0 ]]; then
    echo "  timestamp-named:   $ts_count   $(green '(D-05 = B in flight)')"
  else
    echo "  timestamp-named:   0           $(dim '(D-05 = B not yet rolled out)')"
  fi
  if [[ -f "$mig_dir/.reserved.json" ]]; then
    echo "  ledger present     $(yellow '(unexpected — D-05 chose timestamp, not ledger)')"
  fi
fi

# ── Section: dike (zeus quality tracker) ───────────────────

echo
bold "Dike (zeus quality)"
echo

audits_dir="$REPO_ROOT/.olym/audits/zeus-quality"
if [[ -d "$audits_dir" ]]; then
  # P0 #3 fix: surface bao_notify_required:yes findings (independent of zeus forward)
  pending_notify=$(grep -lr "^bao_notify_required: yes" "$audits_dir" 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$pending_notify" -gt 0 ]]; then
    echo "  $(yellow "$pending_notify") audit(s) flagged $(yellow 'bao_notify_required: yes')"
    grep -l "^bao_notify_required: yes" "$audits_dir"/*.md 2>/dev/null | while read -r f; do
      echo "  $(dim "  → $(basename "$f")")"
    done
  fi

  # P0 #4 fix: detect missing EOD audit files
  # Convention: $today-eod*.md (e.g., 2026-05-06-eod-quality.md or 2026-05-06-eod-incident.md)
  today=$(date +%Y-%m-%d)
  if ! ls "$audits_dir/$today-eod"*.md >/dev/null 2>&1; then
    echo "  $(yellow 'today EOD audit MISSING') — run dike audit before close"
  fi

  # P0 #5 fix: phase transition trigger
  # Window per .olym/audits/zeus-quality/README.md + baseline-2026-05-31.md:
  # startup 2026-05-31 -> 2026-06-30, then weekly cadence + >=3 threshold.
  startup_end="2026-06-30"
  today_epoch=$(date +%s)
  if [[ "$(uname)" == "Darwin" ]]; then
    end_epoch=$(date -j -f "%Y-%m-%d" "$startup_end" +%s 2>/dev/null || echo 0)
  else
    end_epoch=$(date -d "$startup_end" +%s 2>/dev/null || echo 0)
  fi
  if [[ "$end_epoch" != "0" ]]; then
    if [[ "$today_epoch" -lt "$end_epoch" ]]; then
      days_left=$(( (end_epoch - today_epoch) / 86400 ))
      echo "  startup phase active — $(green "$days_left days") until maturity (≥3 threshold + weekly cadence)"
    else
      echo "  $(yellow 'maturity phase due') — switch dike to weekly cadence + ≥3 threshold per SKILL.md"
    fi
  fi
else
  echo "  $(dim 'no .olym/audits/zeus-quality/ — dike not initialised')"
fi

# ── Section: pending sync ──────────────────────────────────

if [[ -x "$REPO_ROOT/scripts/handoff-sync.sh" ]]; then
  echo
  bold "Pending Sync"
  echo
  pending=$(bash "$REPO_ROOT/scripts/handoff-sync.sh" --counts 2>/dev/null || echo 0)
  if [[ "$pending" -gt 0 ]]; then
    echo "  $(yellow "$pending") new handoff(s) on origin branches assigned to me"
    echo "  $(dim 'run `bash scripts/handoff-sync.sh` for detail, `--pull` to import')"
  else
    echo "  $(green '0') new handoffs on origin branches"
  fi
fi

echo
