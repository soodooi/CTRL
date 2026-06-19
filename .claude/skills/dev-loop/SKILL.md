---
name: dev-loop
description: Run CTRL's goal-anchored development loop — explore, plan, implement the smallest step, verify cargo + tsc green, commit, re-check against the goal, repeat. Use when the user asks to make progress on the goal, run the dev loop, keep building, or "继续干 / 推进".
---

# dev-loop — 项目开发 harness / 循环模式

CTRL 的可复用 build 循环。锚定当前目标(`goal` skill),严守 CLAUDE.md「灵活开发」:
**只做 ADR + 代码 + PR**,小 commit,双绿(cargo + tsc)才提交。

## 一次迭代

1. **目标检查** —— 读 `vault/ctrl/GOAL.md`。没设 → 停,先走 `goal` skill。一句话说出**朝目标的下一最小步**。
2. **Explore** —— 用 Explore subagent(只读)在**归属模块**内勘察这一步。不重造,找最小 in-module 改动。先读 `.olym/decisions/INDEX.md` 确认哪个模块拥有它。
3. **Plan** —— diff 能一句话描述 → 跳过 plan。战略改动 → 先写/改 ADR(bump version + changelog,**不开新 ADR**)。
4. **Implement** —— 最小正确改动。**全英文代码**,无硬编码 secret,模棱两可问 bao。
5. **Verify(保命线,绝不跳)** —— 跑对应绿检:Rust `cargo check`/`cargo test`,TS `npm run typecheck`。**贴出输出**;没验证不许声称完成。
6. **Commit** —— conventional message + 目标/handoff 引用 + `Co-Authored-By`。**绝不 `--no-verify`**。
7. **回检** —— 这步是否关闭了目标?更新 `GOAL.md` 进展日志。没完 → 回第 1 步。

## 停止条件

- 目标达成 → `/goal done`,停。
- 卡在只有 bao 能拍的决策 → 停下问,不自作主张。
- Verify 失败且修法不明显 → 停,贴输出,**不糊弄过去**。
- 偏离当前目标 → 停,确认(防 scope creep —— 本 session 的教训)。
