---
name: dev-loop
description: Run CTRL's goal-anchored development loop — explore, plan, implement the smallest step, verify three layers (compile + kernel smoke + visual), have an independent checker confirm, commit, re-check against the goal, repeat. Use when the user asks to make progress on the goal, run the dev loop, keep building, or "继续干 / 推进".
---

# dev-loop — 项目开发 harness / 循环模式

CTRL 的可复用 build 循环。锚定当前目标(`goal` skill),严守 CLAUDE.md「灵活开发」:
**只做 ADR + 代码 + PR**,小 commit,绿了才提交。

## 一次迭代

1. **目标检查** —— 读 `vault/ctrl/GOAL.md`。没设 → 停,先走 `goal` skill。一句话说出**朝目标的下一最小步**。
2. **Explore** —— 用 Explore subagent(只读)在**归属模块**内勘察这一步。不重造,找最小 in-module 改动。先读 `.olym/decisions/INDEX.md` 确认哪个模块拥有它。
3. **Plan** —— diff 能一句话描述 → 跳过 plan。战略改动 → 先写/改 ADR(bump version + changelog,**不开新 ADR**)。
4. **Implement** —— 最小正确改动。**全英文代码**,无硬编码 secret,模棱两可问 bao。
5. **Verify(保命线,绝不跳;三层,按改动面取)** ——
   - **编译绿(总是)**: Rust `cargo check`/`cargo test`,TS `npm run typecheck`。
   - **运行绿(动到 kernel/provider)**: `curl http://127.0.0.1:17873/...` 打 gate 做 smoke —— 创作者钦定「agent 能不能真把东西跑起来」,不止编译过。
   - **视觉绿(动到 UI)**: Playwright 起 dev server `:5173` 截图,**真眼看渲染再下结论**(memory `verify-ui-visually`: 绝不盲改 UI;tsc/build 抓不到布局/主题/流程 bug)。
   - **贴出输出**;没验证不许声称完成。
6. **Checker(独立核验,非平凡改动)** —— spawn `code-reviewer` subagent 独立对照 `GOAL.md` + 归属 ADR § acceptance + diff,出 **PASS / FAIL**。**maker ≠ checker**(创作者钦定:造代码的和验代码的分开,独立的眼睛才抓得到自评漏掉的)。FAIL → 回第 4 步修,别带病 commit。
7. **Commit** —— conventional message + 目标引用 + `Co-Authored-By`。**绝不 `--no-verify`**。
8. **回检** —— 这步是否关闭了目标?更新 `GOAL.md` 进展日志。没完 → 回第 1 步。

## 停止条件

- 目标达成 → `/goal done`,停。
- 卡在只有 bao 能拍的决策 → 停下问,不自作主张。
- Verify / Checker 失败且修法不明显 → 停,贴输出,**不糊弄过去**。
- 偏离当前目标 → 停,确认(防 scope creep)。
- **预算(自治/长任务)** → 成功条件先一句话写死(写不出=任务太大,先拆);设硬上限(`--max-turns` 15–20 起,有数据再加);到顶=停下汇报,不硬撑烧 token。
