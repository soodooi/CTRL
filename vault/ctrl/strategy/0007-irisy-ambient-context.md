---
title: 0007 — Irisy = 读取整个工作区的 ambient 助手（含隐私例外）
tags: [strategy, irisy, context, privacy, framework]
updated: 2026-06-13
---

# 0007 — Irisy 是读取整个工作区的 ambient 助手

> bao 2026-06-13 框架校准。这是后续写逻辑的主框架。
> 锚点：[[0005-kb-architecture-locked]] · [[0002-north-star-anti-trae]] · [[0006-kb-theory]]

## 主框架（bao 原话）

- **CTRL = 一个总入口。**
- **左边 = 工作区**，工作区可以打开很多东西（笔记 / 网页 / CRM / 代码 / 日记…）。详细需求见已落 vault 的 [[0003-notes-kb-design]] / [[0005-kb-architecture-locked]]。
- **右边 = Irisy 窗口**，宽度可调，但**不能小于一个固定最小值**（当前实装：可拖 320–820px，min 320）。
- **Irisy 能读取整个 CTRL 工作区** —— 知道你在写什么、浏览什么、在干什么 → 因为它知道你的工作状态,所以能当一个很好的助手（ambient context）。
- **隐私例外**：**处理过的隐私信息除外**。因为用户会用 CTRL 写日记、浏览网页等 —— 这些标记为隐私的内容,Irisy 不读取/不带入上下文。

## 关键设计原则（后续逻辑遵守）

1. **Irisy = ambient context-aware**：默认能感知工作区当前状态（打开了什么、在编辑什么），无需用户重复解释（呼应 [[0001-why-users-love-ctrl]] 的「不用 re-explain」）。
2. **隐私边界是一等公民**：工作区内容分两类 —— 普通（Irisy 可读）vs 隐私/已处理（Irisy 不读）。用户能标记某个工作区项为隐私（日记、私密浏览…）。这必须在写「Irisy 读工作区」逻辑时同步设计,不能事后补。
3. **本地是 truth**：工作区上下文的读取在本地完成（vault-is-truth），隐私内容连云/模型都不经过（对齐 [[0005-kb-architecture-locked]] 信任哲学 + decision 0004 secrets-never-touch-irisy）。
4. **不破坏现有逻辑**：bao 明确 —— 写这套「Irisy 读工作区」逻辑前要全面检查,不破坏现状。

## 实装现状（布局已就位，逻辑待写）

- ✅ 布局：工作区(左) | L1(中) | Irisy(右,可调宽,min 320) —— ADR-003 §7。
- ✗ 待写逻辑：Irisy 读取工作区当前状态（打开的笔记/网页/etc）作为上下文；隐私标记 + 过滤；ambient context 注入对话。

> 写逻辑时回这条 + [[0005-kb-architecture-locked]]，先全面检查现状再动手（bao 2026-06-13）。
