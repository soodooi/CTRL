#!/usr/bin/env bash
# scratch-new — bootstrap a scratch worktree + research stub
#
# Usage:
#   bash scripts/scratch-new.sh <type> <topic> [persona]
#
# Example:
#   bash scripts/scratch-new.sh spike hono-drizzle
#   bash scripts/scratch-new.sh poc langfuse-adapter apollo
#
# 起 scratch 工作树, 跟 .olym/protocols/evolution.md §5 research lifecycle 对齐.
#
# 创建:
#   1. Worktree: .worktrees/scratch/<type>-<topic>/ (branch scratch/<type>-<topic>, off main)
#   2. Research stub: .olym/research/<type>s/<topic>-<YYYY-MM-DD>/README.md
#   3. .lane file (内容 = "scratch") 在 worktree root
#
# 不 commit, 不 npm install (scratch 不污染 lane, 不预装依赖).
#
# Spec: .olym/protocols/evolution.md §5

set -euo pipefail

TYPE="${1:-}"
TOPIC="${2:-}"
PERSONA="${3:-zeus}"

usage() {
  cat >&2 <<USAGE
用法: bash scripts/scratch-new.sh <type> <topic> [persona]

  type     研究单元类型, 必填: spike | proposal | poc | hotfix
  topic    kebab-case 主题描述 (e.g., hono-drizzle, langfuse-adapter)
  persona  可选, 默认 zeus

示例:
  bash scripts/scratch-new.sh spike    hono-drizzle
  bash scripts/scratch-new.sh proposal monorepo-split  zeus
  bash scripts/scratch-new.sh poc      langfuse-adapter apollo
  bash scripts/scratch-new.sh hotfix   d1-binding-leak  athena

产物:
  - .worktrees/scratch/<type>-<topic>/  (branch scratch/<type>-<topic>)
  - .olym/research/<type>s/<topic>-<YYYY-MM-DD>/README.md
  - .lane 文件 (内容 = scratch)
USAGE
}

if [[ -z "$TYPE" || -z "$TOPIC" ]]; then
  usage
  exit 1
fi

# 验证 type
case "$TYPE" in
  spike|proposal|poc|hotfix) ;;
  *)
    echo "[err] 无效 type: '$TYPE' — 必须是 spike | proposal | poc | hotfix" >&2
    usage
    exit 1
    ;;
esac

# 验证 topic 是 kebab-case
if [[ ! "$TOPIC" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "[err] topic '$TOPIC' 不是 kebab-case — 只允许 [a-z0-9-], 必须字母数字开头" >&2
  exit 1
fi

# REPO_ROOT: prefer git toplevel (cwd-aware, supports PATH-installed usage);
# fall back to script-relative dirname when not in a git repo (legacy in-repo usage).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi
TODAY="$(date +%Y-%m-%d)"
BRANCH="scratch/${TYPE}-${TOPIC}"
WORKTREE_BASE="$(cd "$REPO_ROOT/.." && pwd)/.worktrees/scratch"
WORKTREE_PATH="$WORKTREE_BASE/${TYPE}-${TOPIC}"
RESEARCH_DIR="$REPO_ROOT/.olym/research/${TYPE}s/${TOPIC}-${TODAY}"

# 撞名检查
if [[ -e "$WORKTREE_PATH" ]]; then
  echo "[err] worktree 已存在: $WORKTREE_PATH" >&2
  exit 1
fi

if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "[err] branch 已存在: $BRANCH" >&2
  exit 1
fi

if [[ -e "$RESEARCH_DIR" ]]; then
  echo "[err] research stub 已存在: $RESEARCH_DIR" >&2
  exit 1
fi

# 同日 NNN 计数 (跨该 type 当天目录数 + 1, 3 位补零)
SAME_DAY_COUNT=0
TYPE_PLURAL_DIR="$REPO_ROOT/.olym/research/${TYPE}s"
if [[ -d "$TYPE_PLURAL_DIR" ]]; then
  SAME_DAY_COUNT=$(find "$TYPE_PLURAL_DIR" -maxdepth 1 -mindepth 1 -type d -name "*-${TODAY}" 2>/dev/null | wc -l | tr -d '[:space:]')
fi
NNN=$(printf "%03d" $((SAME_DAY_COUNT + 1)))
TYPE_UPPER=$(echo "$TYPE" | tr '[:lower:]' '[:upper:]')
RESEARCH_ID="${TYPE_UPPER}-${TODAY}-${NNN}"

# 默认 timebox (per evolution.md §5)
case "$TYPE" in
  spike)    TIMEBOX="1-3 day" ;;
  proposal) TIMEBOX="1-2 day" ;;
  poc)      TIMEBOX="1-5 day" ;;
  hotfix)   TIMEBOX="TBD" ;;
esac

# Title Case 转换 (kebab → Title Case)
TOPIC_TITLE=$(echo "$TOPIC" | awk -F'-' '{for(i=1;i<=NF;i++)$i=toupper(substr($i,1,1)) substr($i,2)}1' OFS=' ')
TYPE_TITLE=$(echo "$TYPE" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')

echo "[info] sync main 准备 branch off"
git -C "$REPO_ROOT" fetch --quiet origin main 2>/dev/null || true

echo "[info] 创建 worktree: $WORKTREE_PATH (branch $BRANCH)"
mkdir -p "$WORKTREE_BASE"
git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE_PATH" main

# 写 .lane = scratch
echo "scratch" > "$WORKTREE_PATH/.lane"
if command -v attrib &>/dev/null; then
  attrib +R "$WORKTREE_PATH/.lane" 2>/dev/null || true
fi

# 创建 research stub
echo "[info] 创建 research stub: $RESEARCH_DIR/README.md"
mkdir -p "$RESEARCH_DIR"
cat > "$RESEARCH_DIR/README.md" <<EOF
---
id: ${RESEARCH_ID}
type: ${TYPE}
status: draft
reporter: zeus
assigned_to: ${PERSONA}
timebox: ${TIMEBOX}
worktree: scratch/${TYPE}-${TOPIC}
goal: TBD
created: ${TODAY}
---

# ${TYPE_TITLE}: ${TOPIC_TITLE}

## Goal
(TBD — per #0 元规则, 必答此问题: "这跑完后我能做什么决策?")

## Plan
(TBD)

## Result
(填后)
EOF

# Summary
cat <<DONE

[done] Scratch 工作单元已起.

  Type:      $TYPE
  Topic:     $TOPIC
  Persona:   @$PERSONA
  Branch:    $BRANCH
  Worktree:  $WORKTREE_PATH
  Research:  $RESEARCH_DIR/README.md
  ID:        $RESEARCH_ID
  Timebox:   $TIMEBOX

下一步:
  1. 填 frontmatter 的 goal: 必答 "跑完后能做什么决策?" (#0 元规则)
  2. bao ack → status: draft → approved
  3. cd $WORKTREE_PATH 开干
  4. 跑完写 Result 段, 入 main, status → done | killed

清理 (跑完后):
  git worktree remove $WORKTREE_PATH
  git branch -D $BRANCH
DONE
