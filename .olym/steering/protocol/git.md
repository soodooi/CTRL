# Protocol / Git Protocol

> Git workflow + branch / commit / squash-verify / pre-push / worktree / lane-guard 6 步.
> Parent: [olympus-protocol.md](../olympus-protocol.md)

---

## 1. Commit message 格式

```
<type>(<scope>): [<H-id>] <description>

<optional body>
```

**Type**: feat / fix / refactor / docs / test / chore / perf / ci / style

**Scope**: lane 名 (admin/marketing/creator/recommendation/maya/...) 或 worker 名 (workers/admin / workers/customer / etc) 或专门标签 (handoff/spec/zeus-eod)

**[H-id]**: 关联 handoff (e.g., `[H-2026-04-26-007]`). 完成 handoff 时**必加**.

**例**:
- `fix(admin): [H-2026-04-19-006] env.DB → db.products wrapper`
- `chore(zeus-eod-2026-04-26): Olympus 系统建立 + fleet 13 位入册`
- `feat(creator): [H-029] dispatch coordinator (Phase 5)`

**禁止**:
- 中文 commit message (pre-push hook 检测会拦)
- 无 prefix 的 zeus-attribution (.claude/settings.json 全局禁)

---

## 2. Branch 命名

```
<type>/<scope>-<short-name>
```

**Type**:
- `feat/` — 新功能
- `fix/` — bug 修复
- `chore/` — 维护 / handoff / docs
- `qa/` — audit / test
- `docs/` — 纯文档
- `refactor/` — 重构

**Scope**: lane 名 / worker 名 / 专门标签

**例**:
- `feat/creator-dialog-v07` (creator lane, dialog v0.7)
- `fix/h020-pr51-binding-hotfix` (H-020 PR-51 hotfix)
- `chore/zeus-eod-2026-04-26` (zeus 当日收尾)
- `qa/h007-metis-bootstrap` (metis lane bootstrap)

---

## 3. 开新 branch — 必走 git-new.sh

**必须先 sync main**, 避免基于过时本地 main 起步:

```bash
bash scripts/git-new.sh feat/<name>     # sync main + 开 branch + 切过去
```

**禁止** 直接 `git switch -c` / `git checkout -b` 在未 sync 的本地 main 上开 branch.

**Why**: 本地 main 可能落后 origin/main 多 commit, 直接开 branch 会基于 stale base, rebase 时撞死.

---

## 4. PR squash-merged 后清理

GitHub PR 用 squash merge → 本地 feature branch 多个 commit → origin/main 上变一个新 hash.

```bash
git switch main && git pull --rebase
git branch -D <feat-branch>             # squash-merged 必须 -D, git cherry 看不出
```

**`.husky/post-merge`** 会软提示哪些 local branch 已合可清.

---

## 5. Squash-verify 必须

**`git cherry` 看到 `+` 不一定 unmerged** — 用 `gh pr list --state merged --head <branch>` 才权威:

```bash
gh pr list --state merged --head feat/creator-dialog-v07
# 有输出 = 已 squash-merged, 即使本地 ahead=N
```

**Why**: PR 用 squash merge → 本地 commit hash ≠ main 上的 squash hash → `git cherry` / `git log --not main` 都显示 ahead. 误判后果: ping fleet "你没 push" 错前提.

---

## 6. Pre-push hook (中文检测 + V3.2 legacy)

`.husky/pre-push` 自动跑 `scripts/pre-push-check.js`:

- **中文检测**: code 文件 (`.js` / `.ts` / `.vue` / `.tsx` / `.jsx`) 含中文 → block push
- **V3.2 legacy token**: 旧版 token / API 命名 → block push
- **共享层 import**: worker 内部不能定义 `jsonResponse` / `getCorsHeaders` 等 (必须从 `<@your-org>/platform` import) → block push

**禁止**: `git push --no-verify` 跳过 hook (CLAUDE.md Rules 段写明).

如 hook 失败: 修代码, 不要 bypass.

---

## 7. Commit policy

- **永远 NEW commit, 不 amend** (除非 bao 显式让 amend)
- **永远不 force push 到 main / master**
- **永远不 git reset --hard 跨 commit** (只 reset 当前 branch HEAD)
- **永远不删除 hooks** (.husky/, .claude/hooks/)
- 合 PR 用 squash merge (single commit 进 main)

---

## 8. 处理 dirty 不绕

碰到 git 状态问题 (e.g., main 被 worktree 占用 / dirty 拦阻 switch / stash conflict), **不绕开**:

1. 找根因 (谁占 main / 哪 worktree dirty / stash 内容是什么)
2. 协调 (ping owner / 让 worktree 切回别的 branch / discard stash)
3. 才动手

**反例**: 看到 main 被 creator worktree 占用 → 直接 `git switch -c branch origin/main` 绕开. 这是错的. 正确是 ping creator owner (@daedalus) 切回 + 才 zeus 切 main.

详细 conduct 规则: [conduct.md](conduct.md) "面对问题不绕".

---

## 9. Worktree workflow

### 9.1 新开 worktree

```bash
bash scripts/worktree-new.sh <persona> <lane> <branch>
```

会自动:
- 创建 `D:/code-space/.worktrees/<lane>/`
- 写 `.lane` 文件 (内容 = lane 名), `attrib +R` 只读
- checkout `<branch>`

### 9.2 Worktree retire

```bash
git worktree remove D:/code-space/.worktrees/<lane>
```

**前置**: 确认 worktree 内 branch 已 push + 没 dirty.

### 9.3 Main tree 唯一性

`main` branch 只能在**一个** worktree checkout. 如 worker tree 占了 main, zeus tree 不能再切 main.

**应对**: 切到独立 branch (`chore/zeus-eod-YYYY-MM-DD`) 基于 `origin/main`.

---

## 10. Lane-guard 6 步判定 (协议视角)

`.claude/hooks/pretool-lane-guard.js` PreToolUse 钩子按以下顺序判定写权限. **协议视角 6 步** (hook 内部实际 8 步, 含 2 前置: (i) "Not a write tool → defer to other hooks"; (ii) "cwd no .lane → zeus all-pass". 这 2 步是 hook execution 元数据, 不属于 lane 协议判定):

```
1. denylist_explicit 命中 → BLOCK
   (CLAUDE.md / .claude/hooks/** / .olym/steering/** / .olym/specs/multi-agent-fleet/** / .lane)

2. allowlist 命中 → APPROVE
   (.olym/handoffs/*.md 永远放行)

3. 当前 lane 的 files[] 命中 → APPROVE

4. 自家 active handoff 的 touches[] 命中 → APPROVE
   (跨 lane 协调已授权)

5. warnlist 命中 → WARN + APPROVE
   (package.json / tsconfig.json / 等共享文件)

6. fall-through → WARN (观察期, 待来日改 BLOCK)
```

**关键**:
- step 1 (denylist) zeus 也不能写 (除了 zeus tree, 因为 zeus tree 无 .lane = orchestrator 全权限)
- step 4 是 cross-lane 协调机制 — 开 handoff 写明 touches[], 自家 lane 也能临时摸别的 lane 文件

---

## 11. .lane 文件

- 单文件位于每个 worktree 根: `D:/code-space/.worktrees/<lane>/.lane`
- 内容**单行文本**, 就是 lane 名 (`creator` / `marketing` / `admin` / etc)
- `attrib +R` 只读 (不可手动改)
- `main tree` (`D:/code-space/<project>_store/`) **不存在 .lane** → hook 识别为 zeus, 全 lane 可写

---

## 12. CODEOWNERS / git config

- `~/.claude/settings.json` (用户全局, 非 project 内) 禁用 commit attribution (`Co-Authored-By: Claude` 不会自动加)
- 不维护 CODEOWNERS 文件 (lane-ownership.yaml 是 SoT)
- 不修改 `.gitconfig` 全局配置 (zeus 不动 git config)

---

## 13. Dev velocity mode (临时)

bao 2026-04-19: "开发阶段就用快速开发的方式". Pre-launch 期允许:

- defer CI 阻塞检查
- defer lint/typecheck gates
- defer format-check
- defer CODEOWNERS
- defer 凭证 rotation (含已知泄露凭证 — 详见 bao 私人备忘, 不在公共 doc 暴露具体 IP / 密码)
- defer git-history cleanup

**仅当 hard-constraint issue 会破坏数据/部署时一句话提示**, 不开 mitigation plan.

dead 文件 / .gitignore / stale docs 删除欢迎.
