# Cap design v2 — Irisy 规范化器 + 轻量化飞书多维表 (2026-06-04)

**Date**: 2026-06-04
**Trigger**: bao "cap 可以用智能表格的形式展示出来 ... 飞书承接了很多 opc 创建的内容、工具, 我们就是做轻量化的飞书"
**Status**: brainstorm 设计稿, 待落 ADR-002 § keycap-source v2 + ADR-005 § normalize + ADR-007 § cap-table
**Supersedes**: 自创的 bootstrap hook / L2 slot / workspace.list_components 模型 (上次 session compaction 前的草稿)

**校准日志**:
- 2026-06-04 第 1 轮 — Obsidian × Artifacts × 飞书多维表混合, Irisy 规范化, 6 cap source
- 2026-06-04 第 2 轮 — bao 校准 "本质同一: opc 出能力, 别人用, AI 能力", UUMit 升 first-class 第 7 source, 撤 "本质差异" 框架改为 "同一商业本质 + 形态适配独特组合"

---

## TL;DR

CTRL 平台 = **Irisy 规范化器** + **多维表 cap 库** + **Artifacts-style workspace** 三件套。

不是 Raycast (命令网格), 不是 Obsidian (插件市场), 不是 Claude Code (skill 注入), 是这三个的**规范化合体** + **飞书多维表的 OPC 工具承载力**。

**核心断言**: 用户在 CTRL 不是装"插件", 是把外部 skill / MCP / OAuth / agent 通过 Irisy 规范化成**统一 cap record**, 在多维表里管理、调用、分享、评测、付费。

---

## 1 校准锚 (5 个搜索 finding → 4 个撤 + 4 个保留)

### 撤掉 (自创概念, 现实里不需要)

| 自造 | 现实做法 | 撤的理由 |
|---|---|---|
| `bootstrap()` + first-turn hook | Raycast 默认导出 React = 初始 view, Obsidian 二元 enable/disable | 多余 lifecycle |
| `workspace.list_components()` substrate 组件清单 | Cursor Canvas / Artifacts: cap 自己写 React | 不挑预制组件 |
| `keycap.activate()` lifecycle primitive | Obsidian = enable/disable 二元 | 复杂化无收益 |
| Manifest editor UI 给用户 | MCP Desktop Extensions: `.mcpb` 一键装, manifest 用户看不见 | 用户不写 JSON |

### 保留 (现实印证)

- ✅ Cap = manifest 数据驱动 (MCP / Obsidian / Raycast 都这样)
- ✅ Irisy 在右侧 + artifact / cap view 在中央 (Claude Artifacts 验证)
- ✅ 键帽 = 用户装的卡片, 不是 IDE 插件
- ✅ MCP 是工具协议主流, 2300+ server

### 新加 (bao 校准 2 条)

- 🆕 **Irisy 是规范化器, 不是 kernel 硬扫** — 外部 skill / MCP / OAuth 进来, Irisy 读 + 推理 + 写 manifest, kernel 只 watch 目录
- 🆕 **cap 表格化展示 (飞书多维表风格)** — 不是网格卡片, 是 record 行 + 可自定义字段 + 多视图 (grid / kanban / list)

---

## 2 平台核心 — Irisy 规范化器

```
新 SKILL.md / MCP server / OAuth app 出现
  ↓ Irisy 读它, 理解干啥
  ↓ Irisy 推理: 用哪个内置 view? (SkillRunner / McpTool / OAuthApp / Custom)
  ↓ Irisy 推理: 该 cap 需要什么输入? (topic / file / URL ...)
  ↓ Irisy 推理: tag / description / category / risk-level
  ↓ Irisy 写 ~/.ctrl/caps/<id>/manifest.json
  ↓ kernel watch ~/.ctrl/caps/ → cap table 自动出现新行
  ↓ 用户可手动 ★ pin → L1 顶部出现常驻键帽
```

**分工铁律** (memory `feedback_build_system_not_business` 一致):
- **CTRL kernel** = primitives only (view registry / cap registry / 通用 view 组件 / brain · vault · mcp hooks / watch ~/.ctrl/caps/)
- **Irisy** = 智能层, 把外部生态规范化成 cap manifest (写业务规则)
- **Cap 作者** = 写原生格式 (SKILL.md / MCP server / OpenAPI), 不需要懂 CTRL
- **用户** = 装 cap, 在表格里管理 + 调用, 不写代码

---

## 3 Cap 7 来源 (ADR-002 § keycap-source v1 → v2)

```
1. builtin       CTRL 自带, 编译时          (clipboard / screen / file)
2. mcp           MCP server tool 包装        (github-mcp / notion-mcp / 2300+)
3. oauth         OAuth app 预制操作          (Notion / GitHub / 飞书 / Linear)
4. local_agent   本地 agent                  (Pi coding agent)
5. stss          跨设备共享 cap              (ST-SS bridge)
6. skill         Claude Code SKILL.md       ← v2 新加
7. uumit         UUMit market capability    ← v2 新加 (first-class, AI 原生能力网络)
```

每个 source 进 Irisy 规范化管道 → 统一 cap manifest 出来. 用户在表格里看到的都是"cap 行", source 只是 `source_type` 字段.

**第 7 源 `uumit` 的特殊性** (bao 2026-06-04 校准 — UUMit 升 first-class):
- UUMit (uumit.com, 脱胎自 UU 跑腿) = AI 原生全球能力网络, 双轨 (Skill / Capability) + UT 代币结算 + MCP/A2A 协议
- 社区代号 = OpenClaw (memory `decision_openclaw_compat_layer` 已锚) — UUMit = OpenClaw 上游
- CTRL 不重做撮合层, 接 UUMit market 作能力供给; 反向 opc 用 CTRL 创 cap 一键 push 到 UUMit market 卖 UT
- 用户 UUMit API key 存 macOS Keychain (跟 BYOK 模型一致), 撮合 / 结算走 UUMit cloud, **manifest + 调用结果仍落本机 vault** (vim test 守住)

---

## 4 4 个内置通用 view (CTRL 编译时自带, Irisy 选用)

Cap 作者不必写 React. Irisy 推理给 cap 选 view:

### SkillRunnerView (覆盖 80% SKILL.md)
```tsx
<SkillRunnerView skill="frontend-slides" />
```
- 输入框 (manifest.inputs 定义, 比如 topic / file / URL)
- "Run" 按钮 → Pi (prompt = SKILL.md + 用户输入) → 输出
- 输出 panel: text / HTML iframe / image / markdown 自动渲染
- 自动写 vault (`artifacts/<cap-id>/<timestamp>.<ext>`)

### McpToolView (覆盖 MCP server tool 调用)
```tsx
<McpToolView server="github-mcp" />
```
- Tool list (左侧, mcp.list_tools 拉)
- 参数表单 (右侧, 选中 tool 后 Zod schema 渲染)
- 调用结果展示 (下方, JSON / table / 自动适配)

### OAuthAppView (覆盖 Notion / GitHub / 飞书预制操作)
```tsx
<OAuthAppView app="notion" />
```
- 预制操作快捷按钮 (manifest.actions 定义, "新建笔记" / "搜索" / "插入到当前 vault note")
- 当前认证状态 + reauth 入口
- 操作历史 (最近 10 次)

### CustomView (cap 作者写 React, 高级)
```tsx
~/.ctrl/caps/slide-maker/index.tsx
```
- cap 作者完全控制 (iframe slide preview / canvas 编辑器 / 复杂表单)
- 通过 `@ctrl/cap-sdk` 调 hook (useVault / useBrain / useIrisy / useMCP)
- 受 manifest.permissions 约束

**Irisy 选哪个 view 的启发式**:
- 有 SKILL.md → SkillRunnerView (默认)
- 有 mcp_server + N tools → McpToolView
- 有 oauth + 预制 actions → OAuthAppView
- 用户从 Discover 装的高级 cap (有 index.tsx) → CustomView

---

## 5 L1 两层 + 多维表 workspace

```
PWA shell 三栏 (沿用 Artifacts-style):
┌──────────┬──────────────────────────────┬──────────────┐
│ L1       │ workspace 中央                │ Irisy 右栏    │
│          │                              │              │
│ ★ ★ ★ ★ │ ┌──────────────────────────┐ │ 全局 chat    │
│ ★ ★ ★   │ │ default = <CapTable />    │ │ 跨 cap 持久  │
│          │ │                          │ │              │
│ [All]    │ │ on cap row click:        │ │ ↕ Irisy 可在 │
│          │ │   <SkillRunnerView />    │ │   表格中     │
│          │ │   <McpToolView />        │ │   highlight  │
│          │ │   <OAuthAppView />       │ │   filter     │
│          │ │   <CustomView />         │ │              │
│          │ └──────────────────────────┘ │              │
└──────────┴──────────────────────────────┴──────────────┘
```

**L1 顶部 = 3-8 个 ★ pinned 键帽** (用户高频常驻)
**L1 底部 = "All caps" 入口** → 中央打开 `<CapTable />` 多维表

---

## 6 Cap 多维表字段 (auto-fill from manifest + user-customizable)

### Auto fields (Irisy 写, 用户可改)

| 字段 | 类型 | 例 |
|---|---|---|
| `id` | string (内部) | `frontend-slides` |
| `icon` | image / emoji | 📊 / icon.svg |
| `name` | text | "Frontend Slides" |
| `source_type` | single-select | skill / mcp / oauth / builtin / stss / local_agent |
| `description` | text | "5 页 HTML 演示 + 配色 + 动画" |
| `original_link` | URL | `~/.claude/plugins/ECC/skills/frontend-slides/SKILL.md` |
| `author` | text | "obra" |
| `version` | text | "1.0.0" |
| `installed_at` | date | 2026-06-04 |
| `last_used` | datetime | 2h ago |
| `usage_count` | number | 12 |
| `rating` | number (1-5) | 4.6 (从 ctrl.app/discover 拉) |
| `view_type` | single-select | SkillRunner / McpTool / OAuthApp / Custom |
| `permissions` | multi-select | vault.write / brain.chat / network.http |
| `enabled` | boolean | true |
| `pinned` | boolean | true (★) |
| `auto_tags` | multi-select | 演示 / dev / writing (Irisy 推断) |

### Commerce fields (UUMit 经济层, v2 新加 — bao 2026-06-04 校准)

| 字段 | 类型 | 例 |
|---|---|---|
| `paid` | boolean | true (需要 UT 付费) / false (免费 / 本地 cap) |
| `ut_price` | number | 5 (单次调用 UT, 1 UT ≈ 0.01 元) |
| `pricing_model` | single-select | per_query / per_hour / per_day / fixed / subscription / free / negotiable |
| `provenance` | single-select | uumit / openclaw / local-only / private |
| `creator_id` | text | UUMit user id (该 cap 作者, 全网唯一) |
| `creator_handle` | text | UUMit handle (@username, 显示用) |
| `revenue_ytd` | formula | 用户作创作者的累计收入 (UT, 仅 cap 是自己创建的) |
| `cost_ytd` | formula | 用户作消费者的累计花费 (UT) |
| `autonomy_level` | single-select | L3 (≤ 1000 UT 自动) / L4 (≤ 10000 UT, 默认) / L5 (完全自主) |

### User custom fields (用户加, 飞书风格)

- `my_rating` (number) — 用户自己打分
- `my_notes` (text) — 用户笔记
- `category` (single-select) — 用户自分类 (work / personal / hobby)
- `cost_estimate` (formula) — 用户跟踪每次调用花的 token / $
- `client_link` (URL) — 用户接的客户项目链接
- `priority` (single-select) — high / medium / low

**字段类型** (跟飞书多维表对齐):
text / number / single-select / multi-select / date / datetime / boolean / URL / formula / lookup / attachment

---

## 7 多视图切换 (跟飞书一致)

```
┌────────────────────────────────────────────────────────────┐
│ My Caps   [Grid] [Kanban] [List] [Calendar] [Gallery]   🔍 │
└────────────────────────────────────────────────────────────┘
```

- **Grid (default)** — 飞书多维表风格, 全字段可见, 排序 / 筛选 / 列宽自定义
- **Kanban** — 按 source_type / category / priority 分列, drag-drop 改字段
- **List** — 单列简洁, last_used 倒序, 适合搜索后窄结果
- **Calendar** — 按 installed_at / last_used 日历可视化
- **Gallery** — 按 icon 大图展示 (像 Raycast Store 卡片), 适合 Discover

**视图共享逻辑**: 同一份 cap 数据, 不同 view 看法. 用户改字段任一视图都同步.

---

## 8 同一商业本质, 不同形态适配 (bao 2026-06-04 校准 — 撤"本质差异"框架)

### 8.1 核心抽象 (跨平台共享)

```
opc → AI 助力 → 产出能力 (工具 / skill / mcp / 模板 / 数据)
                ↓
              平台规范化 (manifest / API / 多维表 record)
                ↓
              别人发现 + 使用 (装 / 调 / 订阅)
                ↓
              结算 (UT / 抽佣 / 订阅 / 免费)
```

飞书 / UUMit / Raycast / Obsidian / CTRL **同一抽象, 不同形态适配**:

| 平台 | 适配的用户场景 | 形态特征 |
|---|---|---|
| 飞书 | 企业团队管 OPC 内容 / 工具 | SaaS, 多人协作, 中心化账号 |
| UUMit | Agent 经济云端撮合 | API + UT 代币, 全云, 双轨 (human / agent) |
| Raycast | mac 命令行用户 | native, 命令网格, 主打效率 |
| Obsidian | 知识工作者 | local-first, plugin + vault, 单人 |
| **CTRL** | **个人创作者 + native 桌面 + ambient AI 入口 + 跨设备** | **Ctrl 唤起 + 本地 + mesh sync + 飞书风多维表 + UUMit 经济层** |

→ CTRL 不是"本质差异化", 是 **形态适配独特组合** — 没有其他平台同时给 native + ambient + 多维表管理 + 创作者经济 + 跨设备 mesh.

### 8.2 CTRL 在 opc 经济中的位置

CTRL 不是"跟 UUMit 区分", 是 **UUMit 生态的桌面入口 + 飞书多维表风格的本机 cap 管理**:

1. **桌面入口** — UUMit 自己没桌面客户端 (Cursor / Claude Desktop 是 IDE 不是 ambient OS, Web 不能按 Ctrl 唤起). CTRL 作 UUMit 生态的 native 桌面承载, 填这个真空.
2. **创作侧** — opc 用 CTRL 创 cap → 一键 push 到 UUMit market → 全网 7×24 调用赚 UT → 本机 vault 落运行记录
3. **消费侧** — opc 装 UUMit skill → CTRL Irisy 自动规范化为本地 cap → 多维表管理 + L1 键帽 + 跨设备 sync
4. **沉淀侧** — 所有 cap 调用结果落本机 vault (markdown), 跟 vim test 一致. UUMit cloud 只做撮合 / 结算, 不流走用户数据.

### 8.3 飞书映射 (CTRL 吸收的管理形态)

| 飞书功能 | CTRL 对应 |
|---|---|
| 多维表 (bitable) | cap 表格 (CapTable) |
| 表单 | cap 配置面板 (manifest fields editor) |
| 评论 | cap 评测 (ctrl.app/discover 拉 + 本地 my_notes) |
| 机器人 | Irisy (内置, 跨 cap 全局) |
| 云盘 | vault (本机 markdown) |
| 自动化 (低代码工作流) | Composition canvas (P0-4, ADR-007 § composition) |
| 应用市场 (飞书 App) | Discover (ctrl.app/discover) + UUMit market 双接入 |

**吸收 / 拒绝**:
- ✅ 吸收: 多维表管理形态 (字段类型 / 视图切换 / formula / 用户自定义列)
- ✅ 吸收 (走 UUMit, 不自建): 创作者经济模型 (抽佣 / 评分 / 排行榜)
- ❌ 拒绝: SaaS 形态 (中心化账号 / 数据流过云 / 多人协作锁定)
- ❌ 拒绝: 企业付费偏置 (CTRL 优先单人创作者, 企业层后置 v1.x)

---

## 9 Irisy 在表格视图的角色 (4 个交互模式)

### 9.1 自动规范化 (后台)
新装 SKILL.md / MCP server / OAuth app → Irisy 读 + 推 → 写 manifest → 表格出现新行. 用户可见 toast "Irisy 添加了 frontend-slides, 标签: 演示".

### 9.2 自然语言筛选 (主交互)
用户在 Irisy 右栏说 "我要做演示" → Irisy 在 CapTable 高亮 (visual highlight + scroll into view) 相关 cap (frontend-slides, slide-maker, deck-generator). 用户点其中一个 → 中央 mount view.

### 9.3 右键 cap 行 → Irisy 操作菜单
```
Right-click on cap row:
  ├ "Run this cap" → mount view in workspace center
  ├ "Explain this cap" → Irisy 在右栏给该 cap 详解
  ├ "Suggest similar caps" → Irisy 在表格中 highlight 同 tag / source / use case
  ├ "Edit tags / description" → Irisy 协助改 manifest
  ├ "Write a note" → 写到 my_notes 字段
  ├ "Disable" → enabled = false
  └ "Uninstall" → 删 ~/.ctrl/caps/<id>/
```

### 9.4 跨 cap 推荐 (chain)
用户用完 cap A (比如 OCR), Irisy 自动建议 cap B ("OCR 后要不要 → 翻译? → 总结? → 写笔记?"). 表格中 highlight cap B + 一键链式调用. 这是 P0-4 composition 的轻量入口.

---

## 10 Lifecycle 3 态 (Obsidian-style, 无 hook)

```
removed                         ← uninstall
   │ install (Irisy auto / 用户主动)
   ▼
installed-disabled              ← disable
   │ enable (default after install)
   ▼
enabled                         ← 在 CapTable + L1 可见 / 可调
```

**enabled** = 表格行 + (如果 pinned) L1 键帽 + Irisy 可推荐
**installed-disabled** = 表格行灰显 (用户不想删但暂停用)
**removed** = `~/.ctrl/caps/<id>/` 不存在, 表格不显示

**无 bootstrap / activate hook** — view mount 即初始化, unmount 即清理. cap 作者写的 React 组件按标准 React lifecycle 跑.

---

## 11 frontend-slides 完整链路 (e2e)

```
Step 1: 用户装 ECC plugin (Claude Code)
  ~/.claude/plugins/ECC/skills/frontend-slides/SKILL.md 出现

Step 2: CTRL 启动时 / Irisy 后台 scan
  Irisy 读 SKILL.md frontmatter + body
  推理: "这是个 slide 生成 skill, 需要 topic 输入, 输出 HTML"
  推理: view = SkillRunnerView (无 custom UI 需要)
  推理: tags = ["演示", "HTML", "creator"]
  推理: permissions = ["vault.write", "brain.chat"]

Step 3: Irisy 写 manifest
  ~/.ctrl/caps/frontend-slides/manifest.json
  {
    "id": "frontend-slides",
    "name": "Frontend Slides",
    "source_type": "skill",
    "source_ref": "~/.claude/plugins/ECC/skills/frontend-slides/SKILL.md",
    "description": "5 页 HTML 演示, 配色 + 动画 + 真图",
    "view_type": "SkillRunner",
    "inputs": [{ "name": "topic", "type": "text", "required": true }],
    "permissions": ["vault.write", "brain.chat"],
    "auto_tags": ["演示", "HTML", "creator"]
  }

Step 4: kernel watch 触发
  ~/.ctrl/caps/frontend-slides/ 出现 → kernel emit cap_added event
  PWA CapTable 自动新增行

Step 5: 用户在 CapTable 看到新行
  Irisy 右栏 toast: "添加了 frontend-slides (演示 / HTML / creator)"

Step 6: 用户操作 (任一)
  (a) 表格里点行 name → workspace 中央 mount <SkillRunnerView skill="frontend-slides" />
  (b) 用户 ★ pin → L1 顶部出现键帽 → 后续点键帽直接 mount view
  (c) 用户在 Irisy 说 "做演示" → Irisy 高亮该行 → 用户点

Step 7: view 内交互
  SkillRunnerView 渲染:
    [Input: topic         ]  ← manifest.inputs 自动渲染
    [Run]
  用户填 "CTRL v1 路线图", click Run
    ↓
  CTRL kernel: brain.chat(prompt = SKILL.md body + "topic: CTRL v1 路线图")
    ↓
  Pi 流式输出 HTML (5 页)
    ↓
  CTRL kernel: vault.write("artifacts/frontend-slides/2026-06-04-ctrl-v1.html", html)
    ↓
  SkillRunnerView 渲染 <iframe srcDoc={html} /> in 输出 panel

Step 8: usage 统计
  manifest.usage_count++, last_used = now
  CapTable 行实时更新
```

---

## 12 实施清单 (~14 文件改, ADR + code 并行)

### Kernel (Rust) — 3 文件

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src-tauri/src/kernel/cap_registry.rs` (新) | watch `~/.ctrl/caps/`, emit cap_added/removed/changed events |
| 2 | `src-tauri/src/kernel/cap_index.rs` (新) | SQLite 表 `caps` (id / source_type / manifest_json / installed_at / last_used / pinned / enabled), 索引 + query API |
| 3 | `src-tauri/src/commands/cap.rs` (新) | Tauri commands: `cap_list / cap_get / cap_pin / cap_unpin / cap_enable / cap_disable / cap_uninstall / cap_set_custom_field` |

### Cap SDK (TypeScript) — 2 文件

| # | 文件 | 改动 |
|---|---|---|
| 4 | `packages/ctrl-cap-sdk/src/manifest.ts` (新) | Zod schema for cap manifest (id / name / source_type / view_type / inputs / permissions / auto_tags) |
| 5 | `packages/ctrl-cap-sdk/src/hooks/{useVault,useBrain,useIrisy,useMCP}.ts` (新) | React hooks for cap authors (CustomView 用) |

### PWA — 6 文件

| # | 文件 | 改动 |
|---|---|---|
| 6 | `packages/ctrl-web/src/routes/caps.tsx` (新) | workspace 中央默认页 = `<CapTable />` |
| 7 | `packages/ctrl-web/src/components/CapTable.tsx` (新) | TanStack Table v8 实现, 多视图 (grid / kanban / list), 字段编辑, custom fields |
| 8 | `packages/ctrl-web/src/components/views/{SkillRunnerView,McpToolView,OAuthAppView}.tsx` (新) | 3 个内置通用 view |
| 9 | `packages/ctrl-web/src/runtime/cap-loader.ts` (新) | dynamic import for CustomView (`~/.ctrl/caps/<id>/index.tsx` via Vite) |
| 10 | `packages/ctrl-web/src/components/L1PinnedRail.tsx` (新) | L1 顶部 ★ pinned 键帽栏 (从 cap_list where pinned=true) |
| 11 | `packages/ctrl-web/src/components/L1.tsx` (改) | L1 改两层: pinned rail + "All caps" 入口 |

### Irisy 规范化器 — 2 文件 (Pi 角度)

| # | 文件 | 改动 |
|---|---|---|
| 12 | `src-tauri/src/kernel/irisy/normalizer.rs` (新) | scan `~/.claude/plugins/*/skills/` + MCP registry + OAuth apps, 触发 Irisy LLM 推理生成 manifest |
| 13 | `vault/.ctrl/specs/cap-manifest-spec.md` (新) | Irisy 写 manifest 时参考的规范 (跟 ADR-004 v2 锁同步) |

### ADR amend — 3 处

| # | 文件 | 改动 |
|---|---|---|
| 14a | `vault/ctrl/adrs/002-substrate.md` | § keycap-source v1 → v2, 加第 6 源 `skill`, 加 view registration 规范 |
| 14b | `vault/ctrl/adrs/005-irisy.md` | 加 § normalize v1, 定义 Irisy 作为 cap manifest 写者的职责 + 启发式 |
| 14c | `vault/ctrl/adrs/007-workbench.md` | 加 § cap-table v1, 锁多维表为 workspace 默认页 + 字段类型 + 多视图切换 |

---

## 13 与现有 memory / ADR 的一致性核对

| memory / ADR | 一致性 | 说明 |
|---|---|---|
| `feedback_build_system_not_business` | ✅ | kernel 只 primitives, Irisy 写业务 manifest, cap 是 Irisy/用户建 |
| `decision_ctrl_repositioned_as_aggregator` | ✅ | 多维表 + 评测 + 创作者经济 跟 aggregator 定位完全对齐. **修正**: aggregator 不是自建市场, 是接 UUMit market + ctrl.app/discover SSOT |
| `decision_ctrl_obsidian_philosophy` | ✅ | 本机 vault 是 truth, cap manifest 落 `~/.ctrl/caps/` 本机, vim 可读. UUMit cloud 只做撮合/结算, 不流走用户数据 — vim test 守住 |
| `decision_openclaw_compat_layer` | ✅ | OpenClaw = UUMit 社区代号 (500+ 开发者). 本设计 §3 第 7 源 `uumit` first-class = OpenClaw bridge 的上层 — keycap ↔ ClawHub skill 双向桥仍有效, 现在多了 cap ↔ UUMit market 直通路径 |
| `decision_keycap_protocol_is_mcp` | 🟡 | MCP 仍是工具协议, 但 cap ≠ MCP — cap 是平台抽象, 一个 cap 可包 N 个 MCP tool. UUMit 也走 MCP/A2A 标准, 兼容路径自然. 需 ADR-002 amend 澄清 |
| `decision_ctrl_v1_architecture_lockdown` | 🟡 | "4 L1 = Irisy/Vault/Workspace/Discover" — 此设计下 Discover 在 ctrl.app + UUMit market 双源, 本地 L1 = pinned + CapTable. 需 ADR-007 amend |
| `decision_keycap_workbench_composition_model` | ✅ | composition canvas 仍存在 (P0-4), 这里只是 cap 单元的承载形式. UUMit cap 也可拼入 canvas (拼出来的复合 cap 也可 push 回 UUMit 卖) |
| `decision_pi_is_sole_brain_hermes_is_keycap` | ✅ | Pi 仍是唯一 brain, Irisy 调 Pi 做规范化推理 + UUMit cap 调用. UUMit L3-L5 自治等级 (§14 #8) 由 Pi 执行 |
| `decision_irisy_fallback_is_ctrl_paid_volc_now` | ✅ | UUMit 是 cap 来源, 不是 LLM provider. provider 层 (CTRL volc 兜底 + BYOK) 跟 cap 层 (本地 + uumit 等 7 源) 正交不打架 |
| `decision_ctrl_repositioned_as_aggregator` § 4 收入线 | 🟡 | 原 4 收入线 = 订阅 + 创作者抽 20% + 企业 + B2B. **新加**: UT 经济引入后, 创作者抽 20% 的执行路径变了 (走 UUMit 撮合, 不自建). 见 §14 #7 |

---

## 14 未决问题 (待 bao 拍)

1. **Cap 数据持久化** — 用户的 custom field / pinned 顺序存哪?
   - 候选 A: `~/.ctrl/caps/<id>/manifest.json` 直接改 (跟 auto field 混)
   - 候选 B: `vault/.ctrl/caps-overrides.yaml` (用户字段单独, 跟 auto 分离, 升级 cap 时 override 不丢)
   - **倾向 B** — 升级 cap 不覆盖用户笔记

2. **跨设备同步 pinned 状态** — 跨设备 ★ 一致吗?
   - 候选 A: ★ 状态本机各自 (跨设备不同)
   - 候选 B: ★ 状态走 ST-SS / Automerge sync
   - **倾向 A** — 不同设备使用频率不一样, 一致没意义

3. **Irisy 自动规范化的准度** — 装 100 个 cap, Irisy 推 tag / description 错率不容忽视
   - 候选 A: 装时 Irisy 直接写, 用户回头自己改
   - 候选 B: 装时 Irisy 出 draft, 用户审一遍 ("是这意思吗?") 再确认入库
   - **倾向 A + 局部 B** — 默认 A (体验丝滑), 高 risk cap (oauth / network) 走 B (审一遍)

4. **高频 vs 低频 cap 排序** — pinned / last_used / Discover ranking 三个排序源, 默认怎么定?
   - **倾向**: L1 pinned rail = 用户 ★ 顺序; CapTable default = last_used DESC; Discover (网页) = 全网 ranking. 三者各自不打架.

5. **Cap 作者写 CustomView 的安全边界** — `index.tsx` 跑在 PWA 进程内 (XSS / 数据泄漏风险)
   - 候选 A: iframe sandbox 隔离 (限制能调的 hook)
   - 候选 B: 跑在主 PWA 进程, 信任 cap 作者 (Discover 审核 + permissions 限)
   - **倾向 B + Discover 审核 + manifest permissions 严格 enforce**

6. **多维表数据规模** — 用户装 500+ cap 时 CapTable 性能?
   - TanStack Table v8 + virtualization 跑 5000 行无压力, 但字段筛选 / formula 计算需要异步
   - **不预先优化**, 先跑 v1, 用户实际超 200 cap 再加 virtualization

7. **UUMit 抽佣 + CTRL 抽 20% 共存模型** (bao 2026-06-04 新加未决)
   同一 cap 在 UUMit 市场卖, UUMit 已抽佣 (推测 ~10-15%, 待确认), CTRL 还要不要再抽 20%?
   - 候选 A: **CTRL 不抽** (UUMit 已抽), 用户走 CTRL 装更划算, CTRL 收订阅费 (Pro 解锁高级 cap / 跨设备 sync / vault 云备份)
   - 候选 B: CTRL 抽 5% (作 native client 服务费), UUMit 抽 15%, 双方瓜分 = 创作者拿 80%
   - 候选 C: 双轨 cap — UUMit cap 走 UUMit 抽佣 (CTRL 不抽), CTRL 自建市场的 cap 走 CTRL 抽 20% (用户可选发到哪个市场)
   - **倾向 A** — 简化, 用户体验丝滑, 借 UUMit 撮合机器干活. CTRL 收订阅费 (Pro tier) 作主营收
   - 待 bao 跟 UUMit 沟通后确认实际抽佣率 + 探索 native client 服务费空间

8. **L3-L5 自治等级引入 Irisy 的范围** (bao 2026-06-04 新加未决)
   UUMit 已有 L3 (≤ 1000 UT 自动) / **L4 默认** (≤ 10000 UT) / L5 (零参与) 自治模型. CTRL Irisy 引入范围?
   - 候选 A: **全局 Irisy 自治等级** — 用户设 L4, 所有 cap 调用都按此, 简单一致
   - 候选 B: **per-cap 自治** — manifest 声明该 cap 默认 L 级, 用户可改, 颗粒度细
   - 候选 C: **两层** — 全局默认 L4, manifest 可声明 cap 特定要求 (高 risk cap 强制 L3, 不允许 L5), 覆盖优先级 cap > 全局
   - **倾向 C** — 全局默认 + cap 特定 override + risk-based 强制 floor (vault 写 / network 出站 / OAuth scope 扩展默认 L3)
   - 跟 §14 #3 (Irisy 自动规范化准度) 协同: 高 risk cap 装时 Irisy 出 draft + 用户审 + 设 L3 floor

9. **第 7 源 `uumit` 跟 ctrl.app/discover 的分工** (bao 2026-06-04 新加未决)
   两套发现入口怎么协调?
   - UUMit market = AI 原生能力, 主要是 API / Agent / Capability (云端调用为主)
   - ctrl.app/discover = CTRL 自维 SSOT, 含 Skill / MCP / OAuth / RPA 工具评测 (本机调用为主)
   - 候选 A: **CTRL Discover 聚合 UUMit market** (CTRL 端拉 UUMit API + 加 native 评测), 用户只看一个发现页
   - 候选 B: 两个并列页 (Tab: Discover / UUMit), 用户切换
   - **倾向 A** — 用户只看一个统一 Discover, source 字段标 uumit/builtin/community, 不让用户切 tab
   - 实施要点: ctrl-cloud aggregator backend 主动定时 pull UUMit market, 合并到 Discover SSOT

---

## 15 链接

- 上游决策: memory `decision_ctrl_repositioned_as_aggregator` + `decision_ctrl_v1_architecture_lockdown` + `feedback_build_system_not_business`
- 平行 brainstorm: [[irisy-capabilities-2026-06-04]] (现有 capability 清单), [[user-intents-2026-06-04]] (用户场景), [[rpa-vs-api-vs-mcp-2026-06-04]] (集成层对比)
- ADR 待 amend: `vault/ctrl/adrs/002-substrate.md` § keycap-source v2, `vault/ctrl/adrs/005-irisy.md` § normalize v1, `vault/ctrl/adrs/007-workbench.md` § cap-table v1
- 参考: 飞书多维表 (bitable), TanStack Table v8, Obsidian plugin manifest, Claude Artifacts canvas, MCP Desktop Extensions (.mcpb)

---

**下一步**: bao 审 §14 未决, 拍板后并行动 ADR-002/005/007 amend + kernel/SDK/PWA 14 文件实施. 不分期, 不简版完整版, 同 branch 累积 commit, 一次 PR 整体 ship.
