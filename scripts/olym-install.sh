#!/usr/bin/env bash
# olym-install.sh — Bootstrap a new consumer project onto the olym framework.
#
# Usage:
#   bash scripts/olym-install.sh [consumer-name]
#
# What it does:
#   1. Pre-flight: git repo + .olym/ + packages/olym-* present
#   2. Interactive prompts (consumer name + fleet persona mapping)
#   3. Generate consumer-specific config (NOT framework files):
#        - .olym/steering/lane-ownership.yaml
#        - CLAUDE.md
#        - MEMORY.md
#        - docs/personas/<persona>-<consumer>.md × 5
#   4. Verify gates (audit script + protocols + yaml syntax)
#   5. Print onboard summary + next steps
#
# Non-goals: deploy / commit / mutate framework files / install npm deps.
#
# POSIX-bash compatible (Git Bash on Windows OK).

set -euo pipefail

# ───────────────────────────────────────────────────────────────────────────
# Color helpers (work in Git Bash + Unix terminals; fall back gracefully)
# ───────────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'
  C_CYN=$'\033[36m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YEL=""; C_CYN=""; C_BLD=""; C_RST=""
fi

info()  { echo "${C_CYN}ℹ${C_RST}  $*"; }
ok()    { echo "${C_GRN}✓${C_RST}  $*"; }
warn()  { echo "${C_YEL}⚠${C_RST}  $*" >&2; }
err()   { echo "${C_RED}✗${C_RST}  $*" >&2; }
die()   { err "$*"; exit 1; }

# ───────────────────────────────────────────────────────────────────────────
# Step 1: Pre-flight
# ───────────────────────────────────────────────────────────────────────────
info "Step 1/5 ─ Pre-flight check"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || die "当前目录不是 git repo. 先 'git init' 或 cd 到项目根."

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

[[ -d .olym ]] \
  || die ".olym/ 不存在.\n   先从 olym source repo 复制 .olym/ 进来:\n   cp -r /path/to/olym-source/.olym ./"

# packages/olym-core — optional. Stack-dependent (Drizzle + Zod + MCP + Hono + CF Workers).
# Non-monorepo / different-stack projects can skip; .olym/ + scripts/ still install.
USE_OLYM_CORE=0
USE_OLYM_RUNTIME=0

if [[ -d packages/olym-core ]]; then
  printf "%s\n" "检测到 packages/olym-core/."
  printf "%s\n" "  Hint: skip if your stack is different (e.g., not using Drizzle / Hono / CF Workers)."
  printf "%s" "  Use @manidala/olym-core (Drizzle+Zod+MCP+Hono+CF Workers)? [Y/n]: "
  read -r USE_CORE_ANS
  USE_CORE_ANS="${USE_CORE_ANS:-Y}"
  if [[ "$USE_CORE_ANS" =~ ^[Nn]$ ]]; then
    info "skip packages/olym-core (只 install .olym/ + scripts/)"
  else
    USE_OLYM_CORE=1
    ok "packages/olym-core 启用"
  fi
else
  warn "packages/olym-core/ 不存在 (non-monorepo OK; 单 worker / 异构 stack 项目可跳过)."
fi

if [[ -d packages/olym-runtime ]]; then
  printf "%s\n" "检测到 packages/olym-runtime/."
  printf "%s\n" "  Hint: skip if your stack is different (e.g., not using Drizzle / Hono / CF Workers)."
  printf "%s" "  Use @manidala/olym-runtime (Hono router + 5 ports + RBAC)? [Y/n]: "
  read -r USE_RUNTIME_ANS
  USE_RUNTIME_ANS="${USE_RUNTIME_ANS:-Y}"
  if [[ "$USE_RUNTIME_ANS" =~ ^[Nn]$ ]]; then
    info "skip packages/olym-runtime (只 install .olym/ + scripts/)"
  else
    USE_OLYM_RUNTIME=1
    ok "packages/olym-runtime 启用"
  fi
else
  warn "packages/olym-runtime/ 不存在 (non-monorepo OK; 单 worker / 异构 stack 项目可跳过)."
fi

ok "git repo + .olym/ 就位 (olym-core=$USE_OLYM_CORE, olym-runtime=$USE_OLYM_RUNTIME)"

# ───────────────────────────────────────────────────────────────────────────
# Step 2: Interactive prompts
# ───────────────────────────────────────────────────────────────────────────
info "Step 2/5 ─ 配置项目"

CONSUMER_NAME="${1:-}"

if [[ -z "$CONSUMER_NAME" ]]; then
  printf "%s" "Consumer project name (kebab-case, e.g. my-store): "
  read -r CONSUMER_NAME
fi

# Validate kebab-case: lowercase letters + digits + single hyphens, no leading/trailing -
if [[ ! "$CONSUMER_NAME" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]]; then
  die "consumer-name '$CONSUMER_NAME' 不是合法 kebab-case (示例: my-store, panda-gooo)."
fi

ok "consumer name = ${C_BLD}${CONSUMER_NAME}${C_RST}"

# Fleet personas — default 4-lane matrix
declare -a P_NAMES=("athena" "daedalus" "apollo" "hephaestus")
declare -a P_LANES=("admin"  "creator"  "marketing" "infra")
declare -a P_TECH=("backend" "frontend" "database"  "infra")

printf "%s" "使用默认 4 fleet personas (athena/daedalus/apollo/hephaestus)? [Y/n]: "
read -r USE_DEFAULT
USE_DEFAULT="${USE_DEFAULT:-Y}"

if [[ "$USE_DEFAULT" =~ ^[Nn]$ ]]; then
  info "自定义 fleet 配置 (回车 = 用默认值)"
  for i in 0 1 2 3; do
    printf "  Lane %d default=(%s, %s/%s) — persona name: " \
      $((i+1)) "${P_NAMES[$i]}" "${P_LANES[$i]}" "${P_TECH[$i]}"
    read -r tmp
    [[ -n "$tmp" ]] && P_NAMES[$i]="$tmp"
    printf "  Lane %d business domain: " $((i+1))
    read -r tmp
    [[ -n "$tmp" ]] && P_LANES[$i]="$tmp"
    printf "  Lane %d tech specialty: " $((i+1))
    read -r tmp
    [[ -n "$tmp" ]] && P_TECH[$i]="$tmp"
  done
fi

# Always include zeus as orchestrator (5th persona ledger)
ALL_PERSONAS=("zeus" "${P_NAMES[@]}")

ok "fleet = zeus(orchestrator) + ${P_NAMES[*]}"

# Sniff package manager (don't assume)
PKG_MGR="none"
if [[ -f pnpm-lock.yaml ]];      then PKG_MGR="pnpm"
elif [[ -f yarn.lock ]];         then PKG_MGR="yarn"
elif [[ -f package-lock.json ]]; then PKG_MGR="npm"
elif [[ -f package.json ]];      then PKG_MGR="npm"
fi
info "package manager 检测: ${PKG_MGR}"

# ───────────────────────────────────────────────────────────────────────────
# Step 3: Generate consumer-specific config (idempotent; skip if exists)
# ───────────────────────────────────────────────────────────────────────────
info "Step 3/5 ─ 生成 consumer-specific config"

CREATED=()
SKIPPED=()

write_if_absent() {
  local path="$1"
  if [[ -e "$path" ]]; then
    SKIPPED+=("$path")
    return 1
  fi
  mkdir -p "$(dirname "$path")"
  cat > "$path"
  CREATED+=("$path")
  return 0
}

# 3a. lane-ownership.yaml
LANE_YAML=".olym/steering/lane-ownership.yaml"
write_if_absent "$LANE_YAML" <<EOF || true
# Lane ownership for ${CONSUMER_NAME}.
# Generated by olym-install.sh on $(date -u +%Y-%m-%d). Edit freely.
consumer: ${CONSUMER_NAME}
generated_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
fleet:
  - persona: zeus
    role: orchestrator
    lane: cross-cutting
    tech: identity/knowledge/protocol
  - persona: ${P_NAMES[0]}
    role: owner-1
    lane: ${P_LANES[0]}
    tech: ${P_TECH[0]}
  - persona: ${P_NAMES[1]}
    role: owner-2
    lane: ${P_LANES[1]}
    tech: ${P_TECH[1]}
  - persona: ${P_NAMES[2]}
    role: owner-3
    lane: ${P_LANES[2]}
    tech: ${P_TECH[2]}
  - persona: ${P_NAMES[3]}
    role: owner-4
    lane: ${P_LANES[3]}
    tech: ${P_TECH[3]}
reserved_slots:
  - owner-5
  - owner-6
EOF

# 3b. CLAUDE.md
write_if_absent "CLAUDE.md" <<EOF || true
# ${CONSUMER_NAME}

> Framework: see [.olym/CLAUDE.md](./.olym/CLAUDE.md) (or upstream olym docs) for shared framework conventions.
> Dev guide: \`.olym/skills/dev-env/SKILL.md\`

## Rules

<!-- TODO: fill in project-specific hard rules (code language, secret storage, db wrappers, …) -->

## Design Philosophy

<!-- TODO: project-specific philosophy. Conflict resolution: hard rules > philosophy > implementation. -->

## Olympus (Multi-agent Fleet System)

Fleet roster generated by olym-install.sh. Edit \`.olym/steering/lane-ownership.yaml\` to evolve.

- @zeus — orchestrator + cross-cutting + Identity/Knowledge/Protocol stewardship
- @${P_NAMES[0]} — (${P_LANES[0]}, ${P_TECH[0]})
- @${P_NAMES[1]} — (${P_LANES[1]}, ${P_TECH[1]})
- @${P_NAMES[2]} — (${P_LANES[2]}, ${P_TECH[2]})
- @${P_NAMES[3]} — (${P_LANES[3]}, ${P_TECH[3]})

## Architecture

<!-- TODO: 描述目录结构 (apps/ workers/ packages/ database/ etc.) -->

## Key Standards

<!-- TODO: 项目特定标准 -->
EOF

# 3c. MEMORY.md
write_if_absent "MEMORY.md" <<EOF || true
# Memory · ${CONSUMER_NAME}

> Quick-context memory for ${CONSUMER_NAME}. Auto-injected every session.
> **Hard limit ≤ 180 lines.** Long rules (>10 lines) belong in \`.olym/steering/protocol/\` or \`.olym/specs/\`.

## Discipline (索引)

- 行为协议 → \`.olym/steering/protocol/conduct.md\`
- Spec 写作 → \`.olym/steering/protocol/spec-discipline.md\`
- 项目 lessons → 本文件

## User

<!-- TODO: stack / OS / 沟通语言 / 决策偏好 -->

## Project — ${CONSUMER_NAME} current state

<!-- TODO: 单段项目状态. 不重复维护数字, 引 CLAUDE.md / docs/. -->

## Project — lessons (append-only, newest on top)

<!-- bao 纠正 / 反复掉坑 / 跨 session 必记 — 按日期倒序 -->
EOF

# 3d. Persona ledgers — docs/personas/<persona>-<consumer>.md
for persona in "${ALL_PERSONAS[@]}"; do
  ledger="docs/personas/${persona}-${CONSUMER_NAME}.md"
  write_if_absent "$ledger" <<EOF || true
# @${persona} · ${CONSUMER_NAME} ledger

> 项目特定 ledger. 框架级 persona 定义见 \`.olym/personas/${persona}.md\` (if exists).

## Scope in ${CONSUMER_NAME}

<!-- TODO: 此 persona 在本项目的 lane / tech 边界 -->

## Active handoffs

<!-- 当前进行的 handoff 链接 -->

## Decisions log (append-only)

<!-- 重要决策 + 日期 + rationale -->

## Open questions

<!-- 待 bao / zeus 决的事 -->
EOF
done

if [[ ${#CREATED[@]} -gt 0 ]]; then
  ok "创建 ${#CREATED[@]} 个 consumer file"
fi
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  warn "跳过 ${#SKIPPED[@]} 个已存在 file (idempotent, 未覆盖)"
fi

# ───────────────────────────────────────────────────────────────────────────
# Step 4: Verify gates
# ───────────────────────────────────────────────────────────────────────────
info "Step 4/5 ─ Verify"

# 4a. Protocols sanity
if [[ -f .olym/protocols/evolution.md ]]; then
  ok ".olym/protocols/evolution.md 存在"
else
  warn ".olym/protocols/evolution.md 缺失 (framework 可能不完整)"
fi

if [[ -f .olym/protocols/main-loop.md ]]; then
  ok ".olym/protocols/main-loop.md 存在"
elif [[ -f .olym/steering/olympus-protocol.md ]]; then
  ok ".olym/steering/olympus-protocol.md 存在 (main-loop 替代)"
else
  warn "main-loop / olympus-protocol 都缺失"
fi

# 4b. YAML syntax — try node, python, or skip with warning
yaml_ok=0
if command -v node >/dev/null 2>&1; then
  if node -e "
    const fs=require('fs');
    const t=fs.readFileSync('$LANE_YAML','utf8');
    // minimal YAML lint: no tabs, balanced colons
    if (/\t/.test(t)) { console.error('tab char found'); process.exit(1); }
    if (!/^consumer:\s+/m.test(t)) { console.error('missing consumer key'); process.exit(1); }
    if (!/^fleet:/m.test(t)) { console.error('missing fleet key'); process.exit(1); }
  " 2>/dev/null; then
    yaml_ok=1
  fi
elif command -v python3 >/dev/null 2>&1; then
  if python3 -c "import yaml,sys; yaml.safe_load(open('$LANE_YAML'))" 2>/dev/null; then
    yaml_ok=1
  fi
elif command -v python >/dev/null 2>&1; then
  if python -c "import yaml,sys; yaml.safe_load(open('$LANE_YAML'))" 2>/dev/null; then
    yaml_ok=1
  fi
fi

if [[ $yaml_ok -eq 1 ]]; then
  ok "lane-ownership.yaml syntax OK"
else
  warn "lane-ownership.yaml 未做 syntax 验证 (node/python 缺失或 lint 跳过)"
fi

# 4c. Cross-cutting audit if available
if [[ -f scripts/audit-cross-cutting.mjs ]] && command -v node >/dev/null 2>&1; then
  info "运行 audit-cross-cutting.mjs ..."
  if node scripts/audit-cross-cutting.mjs >/dev/null 2>&1; then
    ok "cross-cutting audit pass"
  else
    warn "cross-cutting audit 报告 issue (非阻塞, 后续修)"
  fi
else
  info "scripts/audit-cross-cutting.mjs 不存在或 node 缺失 (跳过)"
fi

# ───────────────────────────────────────────────────────────────────────────
# Step 5: Summary
# ───────────────────────────────────────────────────────────────────────────
info "Step 5/5 ─ Summary"

echo ""
echo "${C_BLD}═══════════════════════════════════════════════════${C_RST}"
echo "${C_BLD}  olym onboard 完成 — ${CONSUMER_NAME}${C_RST}"
echo "${C_BLD}═══════════════════════════════════════════════════${C_RST}"
echo ""

if [[ ${#CREATED[@]} -gt 0 ]]; then
  echo "${C_GRN}已创建:${C_RST}"
  for f in "${CREATED[@]}"; do echo "  + $f"; done
fi
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  echo ""
  echo "${C_YEL}已存在 (未覆盖):${C_RST}"
  for f in "${SKIPPED[@]}"; do echo "  - $f"; done
fi

cat <<EOF

${C_BLD}Next steps:${C_RST}
  1. 填 CLAUDE.md ## Rules / ## Architecture / ## Key Standards 段
  2. 填 MEMORY.md ## User / ## Project current state 段
  3. 编辑 .olym/steering/lane-ownership.yaml 调整 fleet (如需)
  4. 完善 docs/personas/*-${CONSUMER_NAME}.md ledgers
  5. 派第一个 handoff: 参考 .olym/steering/protocol/handoff.md
  6. $( if [[ $USE_OLYM_CORE -eq 1 || $USE_OLYM_RUNTIME -eq 1 ]]; then
         echo "(若有 npm/pnpm/yarn workspace) 跑 ${PKG_MGR} install 装 olym-core + olym-runtime"
       else
         echo "(skipped olym-core/runtime — 异构 stack; 只 vendored .olym/ + scripts/)"
       fi )
  7. 不要 commit framework file (.olym/ 已 vendored 应保持只读)

${C_BLD}Dry-run only:${C_RST} 此 script 未 commit / 未 deploy / 未改 framework file.
EOF

exit 0
