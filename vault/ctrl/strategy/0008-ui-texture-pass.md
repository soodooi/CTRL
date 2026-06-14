---
title: 0008 — UI 质感统一 pass（2026-06-13 夜）+ 一个待 bao 决策的架构点
tags: [strategy, ui, ux, design-system, texture, decision-needed]
updated: 2026-06-13
---

# 0008 — UI 质感统一 pass

> bao 睡前指令：「把 ui ux 搞好…现在的布局太丑了 没有质感 多多调试 多看看人家的设计 你最好用 git 提交多个版本 这样我可以选择最好的」+「不要停 今天不休息」。
> 锚点：[[0007-irisy-ambient-context]] · ADR-003 §7（4 列布局锁）

## 这轮修了什么（branch `ui/v1-editorial`，5 个 commit）

1. **「旧 UI 反复出现 + 拖不动」根因 = webview 缓存旧 bundle**。我这晚频繁切分支 + 改文件 + bump 把 dev server / webview 缓存搞乱了，webview 一直 serve 没有 divider 的旧版本。修法：杀全部进程 + 清 `.vite`/`dist` 缓存 + 彻底重启 tauri dev。代码本身一直是对的。
2. **版本号在 dev 下「骗人」** —— `__APP_VERSION__` 是 vite `define`，构建时冻结，HMR 永不更新。每次 bump 后 UI 热更了但版本号没动，看起来像「build 没变 / 旧 UI」。这是 bao 困惑的真正根源之一。修法：`app-meta.ts` 在 dev 改为实时读 `package.json`（prod 仍用 define）。已验证 bump → 窗口版本号秒变。
3. **divider 精致化**：默认 1px 极淡 hairline（7px 命中区好抓），hover/拖动才点亮 teal —— 不再是实心重条。
4. **设计系统断连全清**：shell 里所有 hardcoded 蓝紫（#4f46e5 / #3b5bdb / #eef0fd）+ 冷灰（#f7f7f8 / #6b7280）fallback 全换成 teal/paper token。
5. **coding 视图并入设计系统**：OpencodeChat 原本整块 #0066cc 蓝 + 冷灰（prototype 遗留），CodingArtifactPane 用未定义的 `--surface-*` token fallback 到白+冷灰。改：teal 气泡 + paper 底 + mono 代码块；`--surface-*` 一族在 global.css 统一映射到 paper+ink。

六个视图截图验证质感一致：home / discover / notes / model-picker / coding / settings —— paper 暖底 + walnut ink + teal 主色 + 衬线 hero + mono labels，零蓝紫冷灰。

## 窗口信息架构（整体规划锚点，所有组件对齐这张图）

> bao 2026-06-13 点出「L1 还保留了 C 和版本号 = 没有整体规划」。根因是之前逐组件调样式、没有一张统管「谁承载什么」的图。定下如下，避免再漂移：

```
┌──────────────────────────────────────────────────────────────┐
│ CTRL  0.1.x · HOME                                 ● Irisy     │ ← 第一行 status bar
│ 品牌(唯一) 版本(meta) 定位                          AI 一级名    │
├───────────────────────────────┬──────┬────┬─────────────────┤
│ 工作区 (左, flex 最大)         │  L2  │ L1 │ Irisy (右, 可调) │
│ 打开的东西, 由 viewer registry │ file │图标│ 常驻 ambient 助手 │
│ render: notes/discover/web/    │ tree │ 条 │ 读工作区(隐私除外)│
│ code/diary…                    │(折叠)│    │                 │
└───────────────────────────────┴──────┴────┴─────────────────┘
```

**每个区的唯一职责（不串台）**：
- **第一行**：品牌 `CTRL`（**全窗口唯一一次**）+ 版本号（meta 小字，glanceable fresh 标记）+ context（当前在哪）+ `Irisy`（AI 一级名，对齐右栏）+ model/actions。
- **工作区（左）**：viewer registry by content-type render 所有打开的东西。最大、flex。
- **L2**：file tree，默认折叠。
- **L1**：**纯 capability 图标条**——只切换 Irisy/Notes/Coding/Discover/Settings/Model。**不承载品牌、不承载 meta**。
- **Irisy（右）**：常驻 ambient 助手，宽度可拖（320–820），读工作区当前状态（隐私除外，见上）。

规则：**品牌只第一行一次；版本号只第一行一次；L1 只放功能图标。** 任何组件想再放品牌/版本 = 违反，回这张图。

## ⬜ 待 bao 决策：route 页面 vs 4 列 shell

`home / discover / notes` 在 4 列 shell 里（CTRL/Irisy 第一行 + Irisy 常驻右栏）。
但 **`coding` 和 `settings` 是独立全屏 route**（左上「← Irisy」返回，**没有 Irisy 常驻**）。

这跟 [[0007-irisy-ambient-context]] 的框架有张力：bao 说过「首页也是 Irisy 常驻」「Irisy 能读取整个工作区」。按那个框架，coding 也该在工作区（左）里渲染、右边 Irisy 常驻能看到你在写什么代码。

**两个方向，bao 选**：
- **A**：coding/settings 也收进 4 列 shell（工作区左 + Irisy 右常驻）——最贴合 0007 框架，Irisy 能读 coding 上下文。改动较大（route → 工作区内 viewer）。
- **B**：coding/settings 保持独立全屏 route（当前），只有内容类视图（notes/discover/web…）走 shell。settings 这种系统页全屏可接受，但 coding 失去 Irisy 旁观。

> 这是逻辑/架构层，bao 明确「后面写逻辑」，所以这轮只统一了颜色质感，没动架构归属。写「Irisy 读工作区」逻辑（0007）时一并定。

## 另：还有个并行版本可选

`ui/v2-dark-rail` 分支 = L1 图标条暗色（warm charcoal）方案，跟当前 `ui/v1-editorial`（亮色 rail）二选一。v2 还没同步这轮的 5 个修复 —— 若 bao 倾向 v2，再 cherry-pick。
