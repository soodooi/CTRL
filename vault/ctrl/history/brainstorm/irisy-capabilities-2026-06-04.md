# Irisy capability inventory — 真实可用清单 (2026-06-04)

**Date**: 2026-06-04
**Trigger**: bao "整理两个文档, Irisy 的能力清单和用户 Intents 清单, 细化到每个功能"
**Scope**: 实装清单, 不是设计稿. 每条标 ✅ ready / 🟡 部分 / ❌ 待建.

**校准日志**:
- 2026-06-04 第 1 轮 — 5 分类 (A-E) + 21 待建 (F), 80 项 / 60% Code 层 ready
- 2026-06-04 第 2 轮 — cap-design-v2 引入 (UUMit first-class + Irisy 规范化器 + 多维表), 加 5 分类 (G-K) ~30 项, F18-F20 v1.1+ → v1. 新统计 107 项. 详见末尾 § v2 校准 + [[cap-design-v2-2026-06-04]]

---

## 0 体系架构 (Irisy = Pi brain × 5 类底层能力)

```
Irisy chat surface (PWA)
        ↓
   Pi brain (coding agent loop)
        ↓
   ctrl-pi-bridge (HTTP fetch → kernel)
        ↓
┌────────────────────────────────────────┐
│  A Brain ops    (text.chat / 推理)      │
│  B Vault ops    (21 commands)          │
│  C System ops   (clipboard/screen/file)│
│  D MCP ops      (装/调外部 MCP)         │
│  E Provider ops (路由 / 自检)            │
└────────────────────────────────────────┘
```

---

## A — Brain ops (Pi-driven, 14 项)

| # | 能力 | 状态 | 实装位置 | 备注 |
|---|---|---|---|---|
| A1 | 自然对话 | ✅ | `provider/http_endpoint::text_chat` | Pi → kernel `/text-chat` → provider router |
| A2 | 多轮对话上下文 | ✅ | Pi 自管 | session 内 Pi 维护 history |
| A3 | 翻译 / 转换 / 改写 | ✅ | text.chat 子集 | Pi 自己处理, 不需要专门工具 |
| A4 | 总结 / 摘要 | ✅ | text.chat 子集 | 同上 |
| A5 | 代码生成 | ✅ | Pi coding agent 本职 | Pi 的 raison d'être |
| A6 | 代码理解 / 解释 | ✅ | Pi 自带 | 读文件 + 自然语言输出 |
| A7 | 文件编辑 | ✅ | Pi 自带 (edit tool) | 直接改用户文件 |
| A8 | 命令行执行 | ✅ | Pi 自带 (bash tool) | subprocess |
| A9 | 自动 fallback (Claude → Volc) | ✅ **2026-06-04 ship** | `http_endpoint.rs` M1 first-chunk peek | 见 commit 36d5afd |
| A10 | Cooldown 跳过坏 primary | ✅ **2026-06-04 ship** | `registry.rs` M2 cooldown cache | 5 min 内 skip |
| A11 | 自检 (现在用谁) | ✅ | `commands/provider::brain_status` | brain_status() 返回 primary + fallback |
| A12 | 流式输出 (SSE) | ✅ | `http_endpoint::into_sse_stream` | event=delta/done/error |
| A13 | 错误友好显示 | 🟡 | PWA `irisy_chat.rs` | 现有 SSE error 透传, 但文案改进空间大 |
| A14 | 系统 prompt 注入 ECC plugin skill 列表 | ❌ **缺** | — | Pi 不知 ~/.claude/plugins/ECC 的 frontend-slides 等 skill, 无法主动调用 |

---

## B — Vault ops (kernel 21 commands)

### B.1 基础 CRUD (8 项, 全 ready)

| # | Tauri command / MCP tool | 用户感知 | 状态 |
|---|---|---|---|
| B1 | `vault_write(path, body, frontmatter?)` | "记笔记" / "存草稿" | ✅ |
| B2 | `vault_read(path)` | "看这篇笔记" | ✅ |
| B3 | `vault_list(folder?)` | "列 vault 目录" | ✅ |
| B4 | `vault_search(query)` | **全文 FTS5** "搜 X" | ✅ |
| B5 | `vault_delete(path)` | "删这篇" | ✅ |
| B6 | `vault_write_image(path, bytes)` | "存截屏到 vault" | ✅ |
| B7 | `vault_root_path()` | 内部 — 路径查询 | ✅ |
| B8 | `vault_rebuild_index()` | "重建索引" (用户极少调) | ✅ |

### B.2 知识图谱 (13 项, ADR-002 v3 §8 新加, 2026-06-01 ship)

| # | command | 用户感知 | 状态 |
|---|---|---|---|
| B9 | `vault_backlinks(path)` | "X 在哪儿被引用" | ✅ |
| B10 | `vault_tags()` | "我有哪些 tag" | ✅ |
| B11 | `vault_notes_by_tag(tag)` | "tag=X 的所有笔记" | ✅ |
| B12 | `vault_mentions(target)` | "提到 X 的笔记" | ✅ |
| B13 | `vault_orphans()` | "没人引用的孤儿笔记" | ✅ |
| B14 | `vault_broken_links()` | "断链笔记" | ✅ |
| B15 | `vault_graph_data()` | 给 react-force-graph 渲染图谱 | ✅ |
| B16 | `vault_rename(old, new)` | "重命名 X 到 Y" | ✅ |
| B17 | `vault_move(old, new)` | "把 X 移到 folder Y" | ✅ |
| B18 | `vault_create_folder(path)` | "建一个 folder X" | ✅ |
| B19 | `vault_set_starred(path, true)` | "星标 X" | ✅ |
| B20 | `vault_aliases(path, [...])` | "X 也叫做 Y" | ✅ |
| B21 | `vault_watch()` | 监听 vault 变化 (PWA 即时 refresh) | ✅ |

---

## C — System / OS ops (14 项, 全 ready 但 Pi 不主动调)

| # | command | 用户感知 | 状态 | Pi 主动调? |
|---|---|---|---|---|
| C1 | `clipboard.read` | "读剪贴板" | ✅ | 🟡 需 system prompt 提示 |
| C2 | `clipboard.write` | "存到剪贴板" | ✅ | 🟡 |
| C3 | `screen.capture` | "截屏" | ✅ | 🟡 |
| C4 | `file.read(path)` | "读 ~/Documents/X" (vault 外) | ✅ | ✅ (Pi 本职) |
| C5 | `file.write(path, content)` | "写到 ~/Desktop/X.txt" | ✅ | ✅ |
| C6 | `network.http(url)` | "GET https://..." | ✅ | 🟡 |
| C7 | `network.open_url(url)` | "打开浏览器到 X" | ✅ | 🟡 |
| C8 | `platform.notify(title, body)` | 系统通知弹窗 | ✅ | 🟡 |
| C9 | `platform.hotkey(...)` | 注册全局快捷键 | ✅ | ❌ Pi 不该自己注册 |
| C10 | `platform.window_list()` | "我开了哪些 app" | ✅ | 🟡 |
| C11 | `platform.window_focus(id)` | "切到 X 窗口" | ✅ | 🟡 |
| C12 | `platform.os_filter()` | "你跑在啥 OS 上" | ✅ | 🟡 |
| C13 | `keyring.read(account)` | 读 API key (内部用) | ✅ | ❌ Pi 不该直接读 |
| C14 | `keyring.write(account, value)` | 写 API key | ✅ | ❌ Pi 不该直接写 |

**Pi "主动调" 标 🟡 的根因**: kernel 28 tool 物理上暴露了, 但 Pi system prompt 没列 tool description 给 Pi, Pi 不知"我有这个工具可调"。**P-1 卡点本质**。

---

## D — MCP / Tool ops (4 项 + 1 状态)

| # | command | 用户感知 | 状态 |
|---|---|---|---|
| D1 | `mcp.spawn(server_id, config)` | 启动一个 MCP server | ✅ (kernel 实装) |
| D2 | `mcp.invoke_tool(server, tool, args)` | 调外部 MCP 工具 | ✅ |
| D3 | `mcp.list_tools(server)` | 列 server 暴露的工具 | ✅ |
| D4 | `mcp.notifications` | 接 MCP 协议 notifications | ✅ |
| D5 | `mcp.proxy_list_tools` | kernel 自己作 MCP server (kernel-as-MCP) | ✅ |

**所有都 ready**, 但 **Pi 不知有这些** — 同 C 问题, system prompt 没注入。

---

## E — Provider ops (5 项)

| # | command | 用户感知 | 状态 |
|---|---|---|---|
| E1 | `provider_brain_status()` | "Irisy 现在用什么 brain" | ✅ |
| E2 | `provider_list()` | "我有哪些 brain 可选" | ✅ |
| E3 | `provider_set_active(id, consumer)` | "切到 X brain" | ✅ |
| E4 | `provider_failover_record()` | "上次 Claude 挂了多久" | ✅ (2026-06-04 ship) |
| E5 | `provider_health_state` (内部) | cooldown 缓存 | ✅ (2026-06-04 ship M2) |

---

## F — 待建能力 (0 → ❌, 是 v1 P0 backlog)

### F.1 集成全网工具 (P0-1 + P0-2 + P0-3)

| # | 能力 | 缺什么 | 优先 |
|---|---|---|---|
| F1 | Discover 找 MCP/Skill/App | `ctrl-cloud/aggregator/` backend + client `aggregator_cache` | P0 |
| F2 | Trust 静态分 | 接 mpak MTF / ToolBench 公开分 | P0 |
| F3 | 装 MCP | `kernel/installer/mcp.rs` (复用 mcp_host) | P0 |
| F4 | 装 Skill (SKILL.md) | `kernel/installer/skill.rs` + symlink ~/.claude/skills/ | P0 |
| F5 | 装 App (brew/winget/npm) | `kernel/installer/app.rs` 调 package manager subprocess | P0 |
| F6 | 装 API (OpenAPI → MCP 桥) | swagger-mcp wrap | P0 |
| F7 | 一键 deep link 唤起装 | `ctrl://install?source=...&name=...` URL scheme handler | P0 |

### F.2 创建工具 (P0-1 + Pi 能力)

| # | 能力 | 缺什么 | 优先 |
|---|---|---|---|
| F8 | Irisy 写新 MCP server | vault/.ctrl/specs/mcp-server-spec.md 落 + Pi prompt ref | P0 |
| F9 | Irisy 写新 SKILL.md | vault/.ctrl/specs/skill-md-schema.md 落 + Pi prompt ref | P0 |
| F10 | Irisy 写 OpenAPI MCP wrap | vault/.ctrl/specs/openapi-cheatsheet.md 落 | P0 |
| F11 | Irisy 测自写工具 (subprocess) | 已有 subprocess actor, 缺 prompt 指导 | P0 |

### F.3 组合工具 (P0-4)

| # | 能力 | 缺什么 | 优先 |
|---|---|---|---|
| F12 | Composition canvas (拼微型系统) | PWA `routes/workbench.tsx` (React Flow + dnd-kit) | P0 |
| F13 | Composer (manifest 拼装 + lint + 持久化) | `kernel/composer/` | P0 |
| F14 | 自动化触发 (定时 / 事件) | 走 OS launchd / Win Task Scheduler 作 keycap, **不进 kernel** | P0-后 |

### F.4 跨 agent 协作 (推 v1.1+)

| # | 能力 | 缺什么 | 优先 |
|---|---|---|---|
| F15 | A2A protocol (跨 agent) | Google A2A 早期, 需服务发现 + auth | v1.1+ |
| F16 | Irisy → Claude Code agent 交活 | 同上 | v1.1+ |
| F17 | 别的 agent 调 Irisy | 同上 | v1.1+ |

### F.5 商业层 (推 v1.1+)

| # | 能力 | 缺什么 | 优先 |
|---|---|---|---|
| F18 | 评测 / rating | 网页端 (ctrl.app/discover) + 简单账号 | v1.1+ |
| F19 | 创作者付费 cap | Stripe Connect + 抽 20% | v1.1+ |
| F20 | Telemetry 真实使用数据 | opt-in, 影响 ranking | v1.1+ |
| F21 | Enterprise (SSO / 审计) | on-prem aggregator + SAML | v1.1+ |

---

## 总计 (实装状态 stats)

| 类 | ✅ ready | 🟡 部分 | ❌ 待建 | 合计 |
|---|---|---|---|---|
| A Brain | 12 | 1 (错误友好) | 1 (skill 注入) | 14 |
| B Vault | 21 | 0 | 0 | 21 |
| C System | 5 (Pi 本职) | 9 (要 prompt 提示) | 0 | 14 |
| D MCP | 5 | 0 | 0 | 5 |
| E Provider | 5 | 0 | 0 | 5 |
| F 待建 | — | — | 21 | 21 |
| **合计** | **48** | **10** | **22** | **80** |

→ 已实装能力 = 48/80 = **60% Code 层 ready**, 但 Pi 不主动用 (C 类大部分 🟡) → **真实可感知能力 < 30%**, 这是 P-1 卡点根因。

---

## 下一步 — 拉真实可感知能力到 60%+

1. **P-1 立即可做**: 改 Pi system prompt (注入 28 kernel MCP tool description + 触发词), 让 C/D 类工具从 🟡 转 ✅
2. **F1-F7 集成全网**: 装 MCP/Skill/App 走通, Discover 联动
3. **F8-F11 创建工具**: vault/.ctrl/specs/ 落 6 份规范文档, Pi 学会按规范写
4. **F12-F13 组合**: composition canvas + composer

```
P-1 (Pi prompt 注入)  →  Irisy "用" 60% → 80%
F1-F7 (集成)         →  Irisy "装" 0 → 100%
F8-F11 (创建)         →  Irisy "写" 0 → 60%
F12-F13 (组合)        →  Irisy "拼" 0 → 100%
```

---

## v2 校准 — cap-design-v2 引入后 (2026-06-04 第 2 轮)

> bao 校准: 本质同一 = opc 出能力, 别人用, AI 能力. UUMit (脱胎 UU 跑腿) 升 first-class cap source, CTRL = UUMit 生态桌面入口 + 飞书多维表风格 cap 管理. 详 [[cap-design-v2-2026-06-04]].

### v2.1 新增 5 分类 ~30 项

#### G — Cap registry + Irisy 规范化 (10 项, 全 ❌)

| # | 能力 | 实装位置 | 备注 |
|---|---|---|---|
| G1 | Scan skill source (`~/.claude/plugins/*/skills/`) | `kernel/irisy/normalizer.rs` | watch + auto scan |
| G2 | Scan MCP server registry | `kernel/irisy/normalizer.rs` | 已装 MCP list |
| G3 | Scan OAuth app config | `kernel/irisy/normalizer.rs` | keychain accounts |
| G4 | Poll UUMit market | `kernel/irisy/normalizer.rs` | ★ v2 first-class |
| G5 | Irisy LLM 推理生成 manifest | Pi + `vault/.ctrl/specs/cap-manifest-spec.md` | 核心智能层 |
| G6 | 推理 description / tags / view_type | 同 G5 | 启发式 + LLM |
| G7 | cap_pin / cap_unpin | `commands/cap.rs` | L1 顶部 |
| G8 | cap_enable / cap_disable | `commands/cap.rs` | 3 态 lifecycle |
| G9 | cap_uninstall | `commands/cap.rs` | 删 `~/.ctrl/caps/<id>/` |
| G10 | Watch + auto re-normalize | `kernel/cap_registry.rs` | source 改变, manifest 重生成 |

#### H — UUMit 接入 ★ v2 first-class (10 项, 全 ❌)

| # | 能力 | 实装位置 | 备注 |
|---|---|---|---|
| H1 | UUMit OAuth 绑定 | `commands/uumit::auth` + Keychain | api_key + user_id 存 keychain |
| H2 | 接收 UUMit callback (作 producer) | `kernel/uumit/callback.rs` | HMAC 签名验证 |
| H3 | 调用 UUMit capability (作 consumer) | `kernel/uumit/client.rs` | 触发 UT 结算 |
| H4 | UUMit webhook (order.* events) | `kernel/uumit/webhook.rs` | 订单状态通知 |
| H5 | UT 余额查询 | `kernel/uumit/balance.rs` | 显示在 cap 表格顶部 |
| H6 | UT 充值入口 (open browser) | `commands/uumit::topup_url` | 不在 CTRL 内做支付 |
| H7 | 注册 cap 到 UUMit market | `kernel/uumit/publish.rs` | POST /api/v1/skills 或 capabilities |
| H8 | Agent Card 注册 (7×24 自动接单) | `kernel/uumit/agent_card.rs` | 高级用户 |
| H9 | AI-Assisted skill create (SSE) | `kernel/uumit/ai_create.rs` | 借 POST /skills/ai-create |
| H10 | L3-L5 自治等级控制 (UUMit 标准) | `kernel/autonomy/level.rs` | 跟 K 类协同 |

#### I — Composition canvas (5 项, F12-F13 具体化)

| # | 能力 | 实装位置 | 备注 |
|---|---|---|---|
| I1 | Canvas node 添加 / 删除 | `routes/workbench.tsx` | React Flow + dnd-kit |
| I2 | Edge 连线 (cap 输出 → cap 输入) | 同上 | Zod schema 校验匹配 |
| I3 | Schema lint (类型不匹配禁止连接) | `kernel/composer/lint.rs` | 实时反馈 |
| I4 | 持久化为 composite cap | `kernel/composer/persist.rs` | 符合 cap manifest schema |
| I5 | 一键 push composite cap 到 UUMit | `kernel/composer/publish.rs` | 复用 H7 |

#### J — Cap 多维表 (5 项, 全 ❌)

| # | 能力 | 实装位置 | 备注 |
|---|---|---|---|
| J1 | 视图状态持久化 (排序/筛选/列宽) | `vault/.ctrl/caps-table-state.yaml` | 跟 cap 数据分离 |
| J2 | Kanban / List / Calendar / Gallery 视图切换 | `components/CapTable.tsx` | TanStack Table v8 |
| J3 | Irisy chat → 表格行 highlight | `components/CapTable.tsx` + Irisy bridge | 自然语言筛选 |
| J4 | Formula 字段计算 (revenue_ytd / cost_ytd) | `components/CapTable/formula.ts` | 类飞书 formula |
| J5 | 用户自定义字段 add / remove / type | `components/CapTable/customColumn.ts` | 飞书风字段类型 |

#### K — Autonomy + risk (5 项, 全 ❌, UUMit L3-L5 引入后)

| # | 能力 | 实装位置 | 备注 |
|---|---|---|---|
| K1 | 用户全局自治等级设置 (L3/L4/L5) | `routes/settings/autonomy.tsx` | 默认 L4 |
| K2 | Cap 单独自治覆盖 (manifest 声明) | `cap-sdk/manifest.ts` | 优先级 cap > 全局 |
| K3 | Risk-based floor 判定 | `kernel/autonomy/risk.rs` | vault.write / network 出站 / OAuth scope / 大额 UT → 强制 L3 floor |
| K4 | 操作 confirm UI (L3/L4 触发时弹) | `components/AutonomyConfirm.tsx` | 显示 cap / args / cost |
| K5 | 操作历史 (vault/.ctrl/autonomy-log.md) | `kernel/autonomy/log.rs` | 可审计, markdown |

### v2.2 现清单升级 (3 项 v1.1+ → v1, UUMit 提供该层)

| # | 原推 | 新推 | 理由 |
|---|---|---|---|
| F18 评测 / rating | v1.1+ | **v1** | UUMit market 自带 rating, CTRL 拉显示 |
| F19 创作者付费 cap | v1.1+ | **v1** | UUMit UT 经济提供 (CTRL 不抽佣, 见 cap-design-v2 §14 #7) |
| F20 Telemetry 真实使用 | v1.1+ | **v1** | UUMit 撮合天然有调用统计, CTRL 拉 |
| F21 Enterprise SSO | v1.1+ | v1.1+ | UUMit 无企业 SSO, 仍后置 |

### v2.3 现清单路径变化 (4 项重定位, 不算新加)

| # | 原描述 | 新描述 |
|---|---|---|
| F1 Discover | `ctrl-cloud/aggregator/` 自维 | + UUMit market 作主源, aggregator 定时 pull |
| F4 装 Skill | `installer/skill.rs` 专 installer | Irisy 自动规范化 (scan + LLM manifest), 不再单独 installer |
| F5 装 App | brew/winget/npm | 不变 + UUMit "agent capability" 作平行选项 |
| F7 deep link | `ctrl://install?source=...` | source 枚举加 `uumit` |

### v2.4 新统计

| 类 | ✅ ready | 🟡 部分 | ❌ 待建 | 合计 |
|---|---|---|---|---|
| A Brain | 12 | 1 | 1 | 14 |
| B Vault | 21 | 0 | 0 | 21 |
| C System | 5 | 9 | 0 | 14 |
| D MCP | 5 | 0 | 0 | 5 |
| E Provider | 5 | 0 | 0 | 5 |
| F (原 21, 含升级 3 项 v1.1→v1) | 0 | 0 | 21 | 21 |
| **G Cap registry + 规范化** ★ v2 | 0 | 0 | 10 | 10 |
| **H UUMit 接入** ★ v2 | 0 | 0 | 10 | 10 |
| **I Composition** (具体化 F12-F13) | 0 | 0 | 5 | 5 |
| **J Cap 多维表** ★ v2 | 0 | 0 | 5 | 5 |
| **K Autonomy + risk** ★ v2 | 0 | 0 | 5 | 5 |
| **合计 v2** | **48** | **10** | **57** | **115** |

→ 已实装 = 48/115 = **42% Code 层 ready** (v1 60% 因分母扩大降到 42%), 真实可感知能力降到 ~25%. 工程量翻倍 (22 → 57 待建), 但都跟 UUMit 撮合 + 多维表管理 + 自治等级三条主线绑定, 不是散点.

### v2.5 优先级 (P0 跑通最小端到端闭环)

```
P0 v1 最小闭环 (跑通 1 个 UUMit cap 端到端用上):
  A14   (skill 注入 Pi prompt — 卡点根因)
+ G1-G6 (规范化 4 source 扫描 + LLM manifest)
+ H1-H3 (UUMit OAuth + 调用 capability)
+ J1-J3 (表格基础 + Irisy highlight)
+ K1,K3 (自治框架 + risk floor)
= ~12 项, 跑通 "装 UUMit cap → 表格出现行 → Irisy 推荐 → 调用付 UT → 写 vault" 全链路

P1 v1 体验完整:
+ G7-G10 (pin/enable/watch + auto re-normalize)
+ H4-H6 (webhook + UT 余额 + 充值入口)
+ K2,K4-K5 (cap autonomy override + 审 UI + 历史)
+ I1-I3 (composition canvas 基础)

P2 创作者侧 v1:
+ H7-H9 (注册 cap / Agent Card / AI-Assisted create)
+ I4-I5 (push composite cap 回 UUMit)
+ F18-F20 (升级到 v1: rating / 创作者付费 / telemetry — 拉 UUMit 数据)

v1.1+:
+ J4-J5 (formula + custom column)
+ F15-F17 (A2A 跨 agent)
+ F21 (Enterprise SSO)
```

### v2.6 风险 / 未决 (链 cap-design-v2 §14)

- **#7 UUMit 抽佣 + CTRL 抽佣共存** — 倾向 CTRL 不抽, 收订阅费 (Pro tier). 待跟 UUMit 沟通确认实际抽佣率.
- **#8 L3-L5 自治范围** — 倾向两层 (全局默认 L4 + cap manifest 声明 + risk-based floor 强制).
- **#9 Discover ↔ UUMit market 分工** — 倾向 ctrl-cloud aggregator 定时 pull UUMit, 统一 Discover 不分 tab.
- **新增**: UUMit API 稳定性 (脱胎 UU 跑腿, AI 业务 ~1 年, 协议可能演进) — CTRL 端 adapter 层留足 versioning 空间, 不硬编码 API path.

---

**相关 doc**:
- 用户 intents → [[user-intents-2026-06-04]]
- 战略定位 → `aggregator-positioning-2026-06-03.md`
- v1 架构 lock → memory `decision_ctrl_v1_architecture_lockdown`
