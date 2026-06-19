---
name: goal
description: Establish and track CTRL's single active development goal. Use when the user says set / show / update / finish a goal, asks "what is the goal" or "你的目标是什么", when work feels directionless, or before starting any non-trivial work to anchor it. Reads and writes vault/ctrl/GOAL.md.
---

# goal — 目标驱动开发模式

保持**唯一一个**显式、写下来的目标,锚定每次工作,让进程永不漂移。
真相源:`vault/ctrl/GOAL.md`(plain markdown,bao 拥有)。一次只一个目标。

## 命令

- `/goal` —— 读 `vault/ctrl/GOAL.md`,显示当前目标 + status + 成功标准;检查「现在手上的工作还在服务这个目标吗」。没设目标就提示用户去设(**不自己编目标**)。
- `/goal set <目标>` —— 替换当前目标。写清:目标 / 成功标准(可验证)/ 非目标。status 置 ACTIVE,进展日志加一行。
- `/goal done` —— 标记达成,进展日志 append,status 回 NOT SET,提示设下一个目标。

## 锚定规则(这才是「模式」本身)

开始任何**非平凡工作**(改代码 / 写 ADR / 多步任务)前:

1. 读 `vault/ctrl/GOAL.md`。
2. 一句话说明:**这件事服务哪个目标**。
3. 没设目标 → **停下,请用户设**(绝不自己发明目标 —— 这正是上次「不知道目标是什么」的根因)。
4. 这件事**不服务**当前目标 → 明说,问过用户再做(防 scope creep)。

目标要**小且可验证**;达成就 `/goal done` 设下一个。
