#!/usr/bin/env bash
# olym doctor — diagnose Olym install provenance and version consistency.
# Pattern: (name, status[success|warning|error], message) — flutter/wp-cli style.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

if [[ -t 1 ]]; then
  G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; B=$'\033[1m'; N=$'\033[0m'
else
  G=''; Y=''; R=''; B=''; N=''
fi

EXIT=0
check() {
  local status=$1 name=$2 msg=$3
  case $status in
    success) printf "  ${G}OK${N}    %-28s %s\n" "$name" "$msg" ;;
    warning) printf "  ${Y}WARN${N}  %-28s %s\n" "$name" "$msg" ;;
    error)   printf "  ${R}FAIL${N}  %-28s %s\n" "$name" "$msg" ; EXIT=1 ;;
  esac
}

json_get() {
  node -e "try{console.log(require('$1')$2)}catch(e){console.log('(parse-error)')}" 2>/dev/null || echo "(no-node)"
}

printf "${B}Olym Doctor${N} — %s\n\n" "$REPO_ROOT"

# 1. .olym/VERSION lockfile
if [[ -f .olym/VERSION ]]; then
  OLYM_V=$(grep -E '^olym_version:' .olym/VERSION | awk '{print $2}' || echo "")
  PLUGIN_SHA=$(grep -E '^plugin_sha:' .olym/VERSION | sed 's/.*: *"\?\([^"]*\)"\?$/\1/' || echo "")
  check success "lockfile (.olym/VERSION)" "olym_version=$OLYM_V sha=${PLUGIN_SHA:-<self-host>}"
else
  check error "lockfile (.olym/VERSION)" "missing — run /olym-init or copy from hello-olym"
  OLYM_V="(unknown)"
fi

# 2. plugin.json
if [[ -f .claude-plugin/plugin.json ]]; then
  PLUGIN_V=$(json_get "$REPO_ROOT/.claude-plugin/plugin.json" ".version")
  check success "plugin.json" "version=$PLUGIN_V"
else
  PLUGIN_V=""
  check warning "plugin.json" "not present (consumer project — plugin lives in ~/.claude/plugins/)"
fi

# 3. marketplace.json internal consistency
if [[ -f .claude-plugin/marketplace.json ]]; then
  MP_TOP=$(json_get "$REPO_ROOT/.claude-plugin/marketplace.json" ".metadata.version")
  MP_ENTRY=$(json_get "$REPO_ROOT/.claude-plugin/marketplace.json" ".plugins[0].version")
  if [[ "$MP_TOP" == "$MP_ENTRY" ]] && [[ "$MP_TOP" == "$PLUGIN_V" ]]; then
    check success "marketplace.json" "top=$MP_TOP entry=$MP_ENTRY (consistent)"
  else
    check error "marketplace.json" "drift: metadata=$MP_TOP plugins[0]=$MP_ENTRY plugin.json=$PLUGIN_V"
  fi
fi

# 4. npm packages — single-version policy
if [[ -f packages/olym-core/package.json ]]; then
  CORE_V=$(json_get "$REPO_ROOT/packages/olym-core/package.json" ".version")
  RT_V=$(json_get "$REPO_ROOT/packages/olym-runtime/package.json" ".version")
  if [[ "$CORE_V" == "$RT_V" ]] && [[ "$CORE_V" == "$PLUGIN_V" ]]; then
    check success "npm packages" "core=$CORE_V runtime=$RT_V (fixed mode OK)"
  else
    check error "npm packages" "fixed-mode drift: core=$CORE_V runtime=$RT_V plugin=$PLUGIN_V"
  fi
fi

# 5. lockfile vs plugin.json
if [[ -n "$PLUGIN_V" ]] && [[ "$OLYM_V" != "(unknown)" ]]; then
  if [[ "$OLYM_V" == "$PLUGIN_V" ]]; then
    check success "lockfile sync" ".olym/VERSION == plugin.json ($OLYM_V)"
  else
    check warning "lockfile sync" ".olym/VERSION=$OLYM_V vs plugin.json=$PLUGIN_V — re-run /olym-init"
  fi
fi

# 6. Git tree
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [[ "$DIRTY" == "0" ]]; then
  check success "git tree" "clean"
else
  check warning "git tree" "$DIRTY uncommitted file(s)"
fi

# 7. Plugin install path (consumer side)
if [[ -d "$HOME/.claude/plugins/hello-olym" ]]; then
  INSTALLED_V=$(json_get "$HOME/.claude/plugins/hello-olym/.claude-plugin/plugin.json" ".version")
  INSTALLED_SHA=$(cd "$HOME/.claude/plugins/hello-olym" && git rev-parse --short HEAD 2>/dev/null || echo "(no-git)")
  check success "~/.claude/plugins/hello-olym" "version=$INSTALLED_V sha=$INSTALLED_SHA"
  if [[ -n "$PLUGIN_SHA" ]] && [[ "$INSTALLED_SHA" != "$PLUGIN_SHA"* ]]; then
    check warning "install vs lockfile" "installed=$INSTALLED_SHA but lockfile=$PLUGIN_SHA"
  fi
fi

printf "\n"
if [[ $EXIT -eq 0 ]]; then
  printf "${G}${B}All checks passed.${N}\n"
else
  printf "${R}${B}One or more checks failed.${N} See above.\n"
fi
exit $EXIT
