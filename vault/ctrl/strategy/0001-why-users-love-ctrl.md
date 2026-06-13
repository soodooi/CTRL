---
title: 0001 — 让用户更想用 CTRL 的增长战略
tags: [strategy, growth, retention]
updated: 2026-06-12
---

# 0001 — 让用户更想用 CTRL

> 联网深度调研（习惯/留存框架 + 用户热爱的工具拆解 + onboarding/网络效应）收敛而成。
> 决策锚点：[[0006-converged-architecture]] · [[0003-ctrl-is-modular-intent-platform]] · [[0005-feature-pack]]

## 最危险的那条数据 = 生死线

AI 套壳产品 **90 天流失 65%**、年留存 GRR 仅 **23%**（<$50/月档）。用户用 20 分钟就发现「我付的钱去 ChatGPT 写个好 prompt 就行」。

活下来的产品（Obsidian 狂热社区 / Cursor 160% 净留存 / ChatGPT 第12月50%留存）做对同一件事：

**护城河绑在用户的数据 + 工作流积累上，绝不绑在模型上。**

CTRL 哲学（本地是 truth、AI 是 pipe、vault-is-truth、卖工具不卖模型）已经站在正确一边。战略任务不是改方向，是把这些「架构内幕」升级成**用户第一眼能感知、且会自发安利的产品决策**。

### 关键反转

本地优先 = 放弃了「云端扣数据」这种最廉价的粘性。Obsidian「无 lock-in」反而是卖点 —— 留人的唯一理由必须是「我攒的上下文在这里最好用」。所以护城河只能来自**结构化积累 + 召回**，不能来自「数据出不去」。

## 核心飞轮：三层护城河

| 层 | 作用 | 对标验证 | CTRL 现有资产 | 差距 |
|---|---|---|---|---|
| ① 手感层（入场） | 零延迟 aha，让人「哇」 | Raycast clipboard 截图即转化 | 按 Ctrl 唤起 ephemeral workspace | 唤起未做到零闪烁；L1 首次打开是空的 |
| ② 复利层（留存） | 越用越厚、越走不掉 | Cursor 160% 净留存 / Obsidian vault 效应 | vault-is-truth + Irisy capture/recall | 召回仍是 FTS；AI 未「越用越懂你的项目」 |
| ③ 网络层（增长） | 创造即传播 | Figma Community fork/remix / Notion 模板飞轮 | mcp manifest = md+JSON，可 git diff | 无 fork/remix + 创作者 profile |

飞轮：手感层勾人 → 复利层让 vault 越攒越厚、AI 越懂你 → 用户搭出贴合自己大脑的 mcp → fork/remix 分享带来新用户 → 回到手感层。

## quicker 引流定位（bao 2026-06-12 校准）

quicker 式高频功能（剪贴板 / 截图 OCR / 翻译 / 快捷动作）= **引流层**，战略角色不是「又一个工具」，而是把打开频率拉过 Eyal「每周至少一次」习惯门槛的钩子。

- Top 15 里 P0 的 Clipboard / OCR / Translate / Text / Chat 就是用户每天用 N 次的高频微动作。
- 这些必须**常驻 L1**（Raycast 式持久入口），而不是埋在 home 一次性卡片里 —— 持久钩子才能提升打开频率。
- 用高频钩子养习惯（频率），再用 vault 复利留人（留存），最后用可分享 mcp 传播（增长）。

## 三个钉死的判断

1. **别卖「ambient OS 中枢」，卖一个能截图的高频微动作。** 低频工作台必须把单次效用做到「别处给不了」。先用高频钩子产品入场（coding-module = KOL beachhead；quicker 式高频功能 = 大众引流），再用 OS 愿景扩展。
2. **定义并埋点找 CTRL 的 magic number。** 假设那条线 = **「第一次 AI 用了你本地 vault 的上下文，给出 ChatGPT 给不了的答案」**，因为它一次性证明全部差异化。上线即埋点，用免费额度主动把新用户推过去。
3. **用 M3/M12 而非 D1/D7 看留存。** AI tourists 注册试用两月即走会污染早期 cohort；盯熬过 tourist churn 后那条是否拉平的水平线。

## 分阶段落地

### 阶段一 · 保命（入场 + 首次价值）
1. **首次启动零配置预装高频种子功能包** → L1 一打开就有一排 quicker 式钩子（用 CF Workers AI 默认额度，无需 key）。← 当前最高杠杆，正在做
2. BYOK 彻底后置为 Settings 可选项，定位「省钱 + 数据主权」。
3. 空状态改成被引导的起点（状态 + 视觉 + 单一 CTA）。
4. 唤起零闪烁零空白帧（抄 Raycast 工程：WebView 预保持尺寸 + 呈现同步 + 原生 resize）。

### 阶段二 · 护城河（复利层）
5. 召回从 FTS 升级到真 RAG（嵌入检索）。
6. AI 越用越懂你的项目：vault 自动喂上下文（vault-is-truth 派生 AGENTS.md 永不过时）。

### 阶段三 · 增长（网络层）
7. mcp 市场走 Figma Community（fork/remix 活 artifact + 创作者 profile），不走买卖。
8. 冷启动 = build-in-public + Reddit/HN/Discord（Reddit signup 是 PH 的 3-8 倍）+ 每月精选 mcp 飞轮；头 1000 早投 SEO。

## 一句话

用一个能截图安利的高频零延迟动作把人勾进来，用「vault 越用越厚 + AI 越用越懂你的项目」造出套壳产品抄不走的切换成本，再用可 fork 的 mcp 把用户变成传播者。

## 现状缺口（2026-06-12 探查）

- 高频能力底座已就绪：clipboard 读写 / ai-translate / ai-text / ctrl-chat 的 seed dispatch 都可跑（`src-tauri/src/commands/kernel.rs:830-847`）。
- **缺**：首次启动「预装推荐高频包」机制 —— vault 种子系统（`kernel/vault.rs`）只铺笔记，不铺 mcp。新用户 L1 的 packs 为空、Discover 为空。
- OCR 零实现；4 个 OFFICIAL_PACKS 都是 shell 命令包，无高频 GUI 钩子。
