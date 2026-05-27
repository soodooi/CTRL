# Brainstorm — CTRL 灵活工作台还缺什么

> 类型: brainstorm (开放头脑风暴 + zeus 的判断, 非 spike, 无 PoC, 无时限决策)
> 日期: 2026-05-26
> 作者: zeus
> 触发: bao "你先理解一下整个项目 如何为用户提供灵活的工作台" + "你觉得还缺什么"
> 状态: 待 bao 拍板优先级
> 相关:
> - `.olym/decisions/001-system-architecture.md` (含 4 amendments)
> - `.olym/decisions/004-kernel-capability-surface.md` (proposed 3/7)
> - `.olym/specs/keycap-base-layer/spec.md`
> - `doc/brainstorm-strategy-2026-05-05.md` (类型先例)
> - `doc/keycap-roadmap.md`

---

## 0. 出发点 — 工作台的"灵活"定义

CTRL = **底座 + 装配** 模型, 不是产品。

```
用户 → Ctrl-key → 二维 PWA (左键盘 + 右工作区)
              ↓
        装多少个 keycap, 装哪几个, 怎么调, 都是用户的事
              ↓
        keycap 是 user 自己组装的工具, 不是 CTRL 钦定的功能
```

bao 类比: Cursor for code · Figma for design · Notion for docs。**不是 chat app, 不是 launcher, 不是固定 SaaS。**

"灵活"靠 6 条结构性设计兜底:

| 维度 | 实装手段 | 结果 |
|---|---|---|
| **来源灵活** | 5 keycap sources (MCP / OAuth / 本地 agent / ST-SS / builtin) | 任何工具都能进 |
| **运行时灵活** | manifest `target: mcp-tool \| hermes-skill \| brain` + 3-tier `Config / Patch / Fork` | 同一 keycap 千人千面 |
| **AI 灵活** | Pi sole brain via keycap (ADR-001 amd 2026-05-25) | 不绑死 LLM 提供商 |
| **数据灵活** | `~/Documents/CTRL/` plain-text vault + vim test | 用户走了文件还在 |
| **设备灵活** | ADR-003 mesh | 跨 mac / iOS / Android |
| **视图灵活** | 11 viewer registry (Tiptap/CodeMirror/mermaid/PDF...) | 任意 vault 内容能 render |

## 1. 现状判断 — 骨架在, 肉还薄

✅ **骨架已落 (灵活的基础设施)**
- L1 kernel 5 primitives + MCP server (:17873) + MCP host
- Pi brain via keycap · Irisy 单 brain 路由
- 11 viewer · Code Space (xterm + SubprocessActor + portable-pty)
- Vault (`~/Documents/CTRL/`) + FTS5 index + `ctrl-asset://` scheme
- Manifest schema (target enum / config_schema / patches / upstream)

⚠️ **肉还薄 (用户感知的灵活感)**
- `packages/ctrl-keycaps/` 是 skeleton — **Pool 进去几乎空**
- Irisy creator 单件 UI 有, 端到端 (需求 → 生成 manifest → 装进 `~/.ctrl/keycaps/` → 出现在 Keyboard) 没跑通
- 3-tier adjustment — schema 有字段, runtime/UI 没让 user 真正调
- Auto-update 4 层 (ADR-018) — 仅 Tauri 应用层接通, keycap upstream + smart merge 没

---

## 2. 缺的 10 件事 (按用户"灵活感"杠杆排序)

### 头部 3 件 — 缺了灵活感装不进

#### G1. **Pool 是空的** — 开箱即弃风险最大
- `packages/ctrl-keycaps/` 只有 README + package.json, 没 v1 starter pack
- 用户装完 → 按 Ctrl → Keyboard 上几个键帽? Pool 进去看什么?
- 灵活工作台得有**第一批可装的东西**让 user 感知 "原来这就叫 keycap"
- 即便只 8-10 个 (Clipboard AI / Translate / Quick Ask / OCR / New Note / Search Vault / Open in VMark) 也行, 现在是 0
- **杠杆最大**, 投入最重 — 不补这个其他都白搭

#### G2. **Context 不传** — keycap 不知道用户在干啥
现在 keycap 跑起来是孤立的, 不知道:
- 用户当前在 vault 哪个文件
- 用户当前选中了什么
- 用户上一次 keycap 输出是啥

类比: Cursor 灵活在哪? AI 知道你 cursor 在哪一行, knows context. CTRL 现在没设计 "current context" primitive — kernel capability surface (ADR-004 还 proposed 3/7) 也没覆盖。

**建议补法**: workspace 维度的 `current_context` capability (active vault path / selection / clipboard / last_output), keycap manifest 声明需要哪些 → kernel 注入。

#### G3. **Workspace state 不持久** — 每次开都从零
- 关了 CTRL → 上次开的 Code Space session / 看的 vault 文件 / 打开的 keycap 全没了?
- `packages/ctrl-web/src/lib/workspace-store.ts` 有内存态, 但 sessionStorage / kernel persistence 接没接通不清晰
- Cursor / VSCode 灵活感大半来自 workspace restoration
- 现在 user 每次"重新铺工作"= 灵活感被反复推平

### 中部 3 件 — 缺了 user 觉得"不像我的"

#### G4. **Keyboard 不可个性化**
- 左 rail keycap 顺序 / 分组 / 钉顶 / 快捷键绑定 — UI 没看到
- "我的工作台" 的直接来源就在这一栏
- 不让 user 改 = Raycast 没装命令

#### G5. **Keycap composition 机制空白**
- ADR-001 第 4 校准明说 "composition 在 brain 或 user-authored skill, 不在 kernel" — 对的, 反 Coze workflow editor 也对
- 但 user-facing 来说: keycap A 输出怎么喂给 B? `@mention`? 拖拽? Irisy chat 调度?
- 单 keycap 是 atom, 工作流 = 多 keycap 协作, 现在 0 设计
- 大概率落点是 **Irisy 用 MCP tools 自动编排** (Pi brain 在 chat 里调多个 keycap), 但需要 UX 设计 + Irisy 角色明确

#### G6. **Vault 创建路径不清**
- 11 viewer 都是看, 但 user 怎么**创建**新 markdown? new folder? new asset?
- 通过 keycap (New Note keycap) 是一种, 通过 PWA file system 直接 new file 是另一种
- 现在没有第一类入口, Obsidian / Notion 都有

### 尾部 4 件 — 缺了不致命, 但灵活体验有顶

#### G7. **Transparency UI**
- 哲学 #6 写了 "by drill-down 看 raw", 现在 keycap 失败 user 看不到为啥
- 长按 / hover 看 raw 数据 — UI 实装了吗? 需 audit

#### G8. **Onboarding / first-run**
- 第一次启动应该带 user 造他第一个 keycap (Irisy 引导), 不是丢空 Pool
- ADR-001 第 2 校准 E9 有 "first-run vault init 三选一 wizard" daedalus owns, 但 keycap 维度没

#### G9. **离线 LLM 降级**
- 默认 CF Workers AI, Ollama 已 drop 出 default chain (对的, 不主推本机模型)
- 但飞机上 / CF 挂时, BYOK / 本机模型可选路径 UI 没

#### G10. **Mesh 跨设备**
- ADR-003 在 hephaestus lane in flight, 不算缺, 是排期问题
- mobile / Apple Watch / iPad 怎么进 workbench 还未设计 mobile-side UX

---

## 3. 核心判断

骨架像个**装修好但空着的厨房** — 灶台水龙头通风都过验收, 但没刀没锅没食材。

**真正缺的是: "Keycap 这种东西具体是什么 / 长什么样 / 怎么用 / 怎么变成我的"** — 这 4 个问题, 用户从 install 到 daily use 全程在追问, 现在每一步都答不上。

## 4. 我会先动的 3 件 (待 bao 拍)

1. **Pool starter pack** (10 个 keycap, 哪怕做工糙) — 让 user 看到东西
2. **Context primitive** (`active_vault_path` / `selection` / `last_output` 进 kernel capability surface) — 让 keycap 不再瞎跑
3. **Workspace persistence** — 让 user 不用每次重铺

补完这 3 件, 灵活感会跳一个台阶。后 7 条之后再决定。

---

## 5. 不在范围 (避免漩涡)

- **不**重新讨论 ADR-001 spine (5 primitives / 4 layers immutable)
- **不**讨论 Pi vs hermes brain (已 2026-05-25 拍板)
- **不**讨论 VMark substrate (已 2026-05-25 拍板)
- **不**做 phasing / 排期 (灵活开发模式: ADR + 代码 + PR, 不做 phase delivery)
- 本文档**只** identify gap + 建议优先级, 不写实施方案 — 各 gap 真要做时各开 worktree, lane owner 自驱

## 6. 后续动作

- bao 在此文档底部 batch 拍板优先级 (G1-G10 各打 P0 / P1 / 暂搁)
- 拍板后, zeus 据此开 worktree (`feat/<gap-name>`)
- 各 lane owner 自驱 PR 给 zeus
- 文档进入历史, 不持续维护 — 是 snapshot, 不是 living doc

---

## bao 拍板区 (待填)

```yaml
G1_pool_starter_pack:       # P? — 
G2_context_primitive:       # P? — 
G3_workspace_persistence:   # P? — 
G4_keyboard_personalization:# P? — 
G5_keycap_composition:      # P? — 
G6_vault_create_paths:      # P? — 
G7_transparency_ui:         # P? — 
G8_onboarding_first_run:    # P? — 
G9_offline_llm_fallback:    # P? — 
G10_mesh_mobile_ux:         # P? — 
```

---

## 7. Mobile 维度 — 不是 edge case, 是"灵活"维度本身 (⏸ defer, PC 后)

> **状态: 2026-05-26 bao 拍 "先 pc 端功能" — Mobile M1-M5 全部 defer, 不进 4-lane 当前范围**. 本节保留作为后续 roadmap reference; PC 灵活感稳了再回头取 M1-M5.
>
> 触发: bao 2026-05-26 "支持移动端使用, 包括 coding 安排工作, 现在有很多产品已经实现". zeus 原 G10 排尾部是误判 — 重新归入独立 section.

### 7.0 架构上 mobile 早是 first-class (实装 ≈ 0)

| ADR / 决策 | 写了啥 | 实装状态 |
|---|---|---|
| ADR-002 PWA pivot | 单 PWA codebase, mobile 一等公民 (非 React Native, 非 Capacitor) | 桌面 webview 用着, 手机浏览器 cold path |
| ADR-003 mesh | Automerge CRDT + vodozemac, 手机本就是同等节点 | hephaestus lane in flight, 0 端到端 |
| `decision_pc_mirrors_mobile_layout` (2026-05-19) | **PC 学 mobile UX**, 不是反过来 | PWA 2-panel 已学, 手机栅格本身没单独做 |
| `decision_pwa_two_panel_layout` (2026-05-22) | 学手机小屏高密度, BottomTab 切右区 | 已实装 (PC 形态) |
| `project_remote_co_view_is_irisy` | 远端 viewer 落 Irisy 4 项能力 | 0 |
| min platform | iOS 16.4+ PWA / Android Chrome PWA / WASM vodozemac + Automerge | 0 端到端验证 |

### 7.1 Mobile 5 件 gap (M1-M5)

**M1 · Mobile-shaped PWA layout** — 当前 PWA 跑 920×560 desktop floating shell, 没专门手机栅格. iPhone SE 375×667 / 16 Pro 393×852 / iPad mini / Android 中低端该长啥样, 没设计. BottomTab + 抽屉 + 手势 (滑切 workspace) 需求未接.

**M2 · 跨设备 handoff 闭环** (mesh 通后) — 桌面看 Code Space → 锁屏 → 手机继续看 same session 输出 / 桌面写 markdown 切手机继续写, 光标位置保留 / Apple Continuity 那种邻近设备自动发现.

**M3 · Mobile-only keycap source** — 桌面学不来的杠杆:
- Camera → OCR → vault asset
- 录音 → 转写 → vault note
- 分享 sheet 接入 (Safari/微信内分享到 CTRL vault / 喂给 keycap)
- 拍照定位 (会议照片 + 时间 + GPS 进 vault)

**M4 · 远端 coding on mobile** — kernel + SubprocessActor 留桌面, mesh 推 stdout 到手机 xterm.js / 手机 voice → text → stdin / 长任务挂着手机随时看进度.

**M5 · Mobile 工作安排** — vault markdown 作 todo source (- [ ] checkbox), mobile route 专门做 inbox + today task + capture; 不是把桌面 workspace 缩到手机, 是 mobile-shaped 新 surface (Things 3 / Notion mobile 范式).

### 7.2 业界已实现, 可学

| 产品 | 学什么 |
|---|---|
| Cursor mobile (规划中) | desktop kernel + mobile viewer, 不试图本机跑 LLM |
| Replit Mobile | full IDE on phone, 容器在云, 手机是 viewer |
| Working Copy (iOS) | Git client + 文件编辑, 离线优先 |
| Telegram bot 作 agent 界面 | mobile = thin client 调远端 agent |
| Universal Clipboard / Continuity | start 在手机 → finish 桌面, 跨设备 handoff |
| Notion mobile / Things 3 | capture-first (拍照/语音/快速 input), 不是 full editor |

---

## 8. 按 4 lane 重组 — bao 的 4 个清晰 lane (**PC only, mobile defer**)

> 触发: bao 2026-05-26 "目前我比较清楚的是前端, cap, 底座, Irisy; 我们等会要输出这几个 lane 的开发需求" + "先 pc 端功能". 把 §2 (G1-G10) 共 10 件 PC gap 映射到 4 个 lane 容器, 给后续 lane dev requirements 用. **§7 Mobile (M1-M5) 全 defer, 不进当前 lane**.

> **注意**: 1 个 gap 可能横跨多个 lane (e.g. G2 context primitive 同时碰 cap + 底座 + Irisy 三个). 这里只标主 owner lane, 协作 lane 用括号备注.

### Lane: 底座 (substrate) — 给所有上面的东西铺地基

| Gap | 该 lane 做啥 |
|---|---|
| **G2 Context primitive** | kernel capability surface 加 `current_context` (active vault path / selection / clipboard / last_output); ADR-004 推到 accepted; manifest 加 `consumes_context: [...]` 声明 |
| **G3 Workspace persistence** | kernel 侧 sessionStorage + 持久化 schema; PWA `workspace-store.ts` 接通 (cap 前端协作) |
| **G9 Offline LLM fallback** | llm_adapters 多 provider 路由 + 失败降级链; BYOK Anthropic / OpenAI / 本机 Ollama 路径 (Ollama 不在 default, 但可选) |
| (相关) ADR-004 闭门 3/7 → 7/7 | kernel capability surface lock, 给其他 lane 拿稳定契约 |

### Lane: cap (keycap mechanism + Pool)

| Gap | 该 lane 做啥 |
|---|---|
| **G1 Pool starter pack** | 10-15 个 v1 starter keycap (Clipboard AI / Translate / Quick Ask / OCR / New Note / Search Vault / Open in VMark / Speak / Transcribe / Mermaid 等 PC 场景); 装到 `packages/ctrl-keycaps/` + bundle 进 `CTRL.app/Contents/Resources/keycaps/` (协作 底座: ADR-001 amd #3 first-run 复制策略) |
| **G4 Keyboard 个性化** | Keyboard 顺序 / 分组 / 钉顶 / 快捷键绑定 (协作 前端) |
| **G5 Keycap composition** | manifest 加 `inputs_from: [...]` / `@mention` 语法; Irisy 用 MCP tools 自动编排 (协作 Irisy) |
| (相关) 3-tier adjustment runtime | Config / Patch / Fork UI + 后端 (manifest schema 已有字段) |

### Lane: Irisy (单 brain + 8-stage lifecycle + chat companion)

| Gap | 该 lane 做啥 |
|---|---|
| **Irisy creator 端到端** | 需求 → 生成 manifest → 装进 `~/.ctrl/keycaps/` → 出现在 Keyboard 全链路 (ChatPane / CreatorShell / ManifestPreview / InstallBar 单件已有, 联接没通) |
| **G5 keycap composition** (UX 侧) | Irisy chat 里 Pi brain 用 MCP tools 调多个 keycap; 用户用自然语言编排 (不是 workflow editor) |
| **G8 Onboarding / first-run** | 第一次启动 Irisy 引导 user 造他第一个 keycap |
| **Irisy spec re-spec** | `.olym/specs/irisy/spec.md` 仍写 hermes-as-brain, 已被 ADR-001 2026-05-25 amd 推翻为 Pi; 改 spec + 删过期内容 |
| (相关) Pi brain 真实跑通 | ctrl-pi-plugin 已 ship, irisy_chat 路由已通, 但端到端 chat 体验 audit 没做 |

### Lane: 前端 (PWA UI/UX 实施)

| Gap | 该 lane 做啥 |
|---|---|
| **G6 Vault 创建路径** | New note / new folder / new asset 入口 (PWA route 或 keycap-driven) |
| **G7 Transparency UI** | keycap 失败 / drill-down 看 raw 数据 UI (哲学 #6) |
| (相关) G4 Keyboard 个性化 UI | 拖排序 / 钉顶 / 绑快捷键交互 (cap lane 出契约, 前端实施) |
| (相关) G3 Workspace persistence UI | 重启恢复 session / 打开过的 keycap (底座出契约, 前端实施) |

### 4-lane 一图 (PC only)

```
         ┌──────────── 底座 (substrate) ────────────┐
         │ G2 context · G3 persistence · G9 LLM ·   │
         │ ADR-004 capability surface               │
         └────────────────────┬─────────────────────┘
                              │
         ┌────────────────────┼─────────────────────┐
         │                    │                     │
    ┌────┴────┐         ┌─────┴─────┐         ┌─────┴─────┐
    │  cap    │         │   Irisy   │         │  前端     │
    │ G1 G4 G5│         │ creator   │         │ G6 G7     │
    │ 3-tier  │◄────────┤ G5 UX G8  │────────►│ +G3/G4 UI │
    └─────────┘         │ spec      │         └───────────┘
                        └───────────┘
```

### 下一步 (bao 拍后)

bao 看过 §8 4-lane 切分确认 OK → zeus 出 4 个 lane 的 "开发需求" 写到这份 doc 的 §10 (各 lane 一节, 含: 目标 / 范围 / 不在范围 / 既有可复用 / ADR 漂移点 / 退出条件). lane owner 据此 PR 给 zeus.

---

## 9. 终端定位 — "得终端者得天下"

> 触发: bao 2026-05-26 "别人怎么接入飞书? 飞书提供了哪些? 我们其中一个功能要能承接用户的产出, 做用户的终端, 得终端者得天下, 你要有这个概念".

### 9.1 战略意思

**终端 = 用户输入输出的统一收口**。历史先例:
- 手机 → iPhone (个人计算终端) 占了 = Apple 占 mobile
- 社交 → 微信 (国民社交终端) 占了 = Tencent 占国民关系链
- 编辑器 → VSCode/Cursor (开发者终端) 在占 = MS/Cursor 占 dev
- 文档 → Notion/飞书 (知识工作终端) 在占 = 卡位中

**CTRL 的终端切入点 = ambient AI workbench**:
- 用户在飞书 / 微信 / Notion / 邮件 / 浏览器 / 剪贴板 / 屏幕 / 录音 各处产出
- CTRL 用 Ctrl-key 收口 → 全部 ingest 到本地 vault (plain-text truth)
- 用户日常打开的不是飞书, 是 CTRL; 飞书是 source, CTRL 是 destination

这跟 ADR-015 (plain-text 哲学) 一致: 第三方 backend = sync provider, 本地 vault = truth, 本地永远赢冲突.

### 9.2 飞书提供啥 (Open Platform 接入面)

飞书 Open Platform (https://open.feishu.cn) 给 3 类东西:

**A. 认证 / 应用**
- OAuth 2.0 (user_access_token / tenant_access_token / app_access_token)
- 自建应用 (单租户) vs 应用商店应用 (多租户)
- 加密 / 签名 / 鉴权 完整链

**B. 资源 API (REST + WebSocket)**
- **消息 (im)** — 发收文本/卡片/交互消息, 群管理, 机器人发消息
- **云文档 (docs/docx/sheet/bitable)** — Doc / 表格 / Bitable 多维表 CRUD, 导出 markdown 可行
- **云盘 (drive)** — 上传下载文件, 权限管理
- **日历 (calendar)** — 事件 / 参与人 / 会议室
- **知识库 (wiki)** — 空间 / 节点 / 搜索
- **会议 (vc)** — 会议室预订, 录制下载, 转写
- **审批 (approval)** — 触发审批 / 读单据
- **通讯录 (contact)** — 部门 / 用户 / 群组
- **机器人 (bot)** — 群机器人 / 应用机器人, 主动推送

**C. 事件 / 推送 (event-driven)**
- **事件订阅 (event subscription)** — 飞书侧事件主动 push 到开发者 webhook (新消息 / @机器人 / 文档更新 / 审批通过)
- **长连接 (WebSocket)** — 替代 webhook, 用 SDK 长连
- **卡片回调** — 用户点交互卡片按钮 → 开发者 callback

### 9.3 别人怎么接入

| 接入方 | 模式 | 关键技术 |
|---|---|---|
| **Coze** (字节亲儿子) | 原生集成 — bot 直接发布到飞书 / 飞书事件直接进 Coze | 内部通道, 不走 Open API |
| **Notion / Slack / Linear-like** | OAuth + REST API + webhook 双向 | 标准 Open API |
| **MCP server** (社区 `feishu-mcp` / `lark-mcp`) | 把飞书 API 封成 MCP tools, agent 通过 MCP 用 | rmcp / @modelcontextprotocol/sdk |
| **集简云 / Zapier / Make** | 低代码自动化, 飞书作 trigger / action | 平台中间层, 拖拽编排 |
| **n8n / Hermes-style agent** | self-hosted automation, 用 OAuth + webhook 接 | 用户自托管 |
| **企业自建** | 内部应用 + 单租户 | tenant_access_token + 内部 API |

### 9.4 CTRL 怎么接 — 终端定位的具体落点

5 keycap sources 里 **Big-platform OAuth** 这类专门给这种用. 飞书是头号样板:

**最小可用 (v1)**:
- **飞书 sync keycap** (OAuth + REST + 事件订阅)
  - 装上 → OAuth 登陆 → 一键导入指定 wiki 空间 / docs / messenger 历史到 vault
  - 后续增量同步 (事件订阅 webhook 或长连)
  - vault 里 `flomo/` `feishu/wiki/` 等子目录, 文件名带 lark_token, frontmatter 含原链接
  - 这是 G1 starter pack 一个 keycap, 但是 **战略级最重要的**

**承接产出 (终端动作)**:
- **快速 clip 到飞书 → vault** (用户在飞书选段右键 → CTRL keycap → 进 vault)
- **飞书消息 → CTRL inbox** (我 @ 某机器人 → 消息进 CTRL today inbox)
- **CTRL 反向写 → 飞书** (vault note 一键发到飞书 doc / 群)
- **飞书会议转写 → vault meeting note** (vc 录制 + 转写 拉进来)

**架构落点**:
- keycap source: `oauth` (5 sources 之一, ADR-001)
- manifest schema 已有 `auth` 字段 (Zod 校验)
- OAuth loopback 本机 callback (ADR-015 哲学 #2 端侧化)
- token 存 macOS Keychain (`shell/keychain.rs` 已实装)
- 增量同步走 kernel `current_context` capability + scheduler

### 9.5 跟 ADR-014 (global English first) 的张力

ADR-014 + memory `decision_ctrl_is_global_english_first` 把飞书优先级降到了"i18n 后置". 但 bao 这条 "得终端者得天下" 是**战略框架**, 不是"加飞书 keycap" — 框架适用于:

- 海外 = Slack / Notion / Google Workspace / Linear / GitHub
- 国内 = 飞书 / 微信 / 钉钉 / Notion 中国版

终端定位 = **所有这些都是 source, CTRL vault 是 destination**. 飞书是国内最早接的, 海外可能先接 Notion + Slack + GitHub Issues.

→ ADR-014 不需要 supersede, 但要 amend: "global English first" 不等于 "海外平台优先", 而是 "CTRL 自身英文化". 终端能力 (ingest 所有平台输出) 是跨语种的, 飞书 / Notion 同等优先, 看用户在哪个平台产出多。

待 bao 确认是否要 ADR-014 amend.

### 9.6 加进 4-lane

**cap lane G1 starter pack 加一类 keycap: "platform sync"**, 含:
- 飞书 sync (wiki / docs / messenger / inbox)
- Notion sync (page / database)
- GitHub Issues sync (issue / PR / comment)
- Slack sync (channel / DM)
- 邮件 sync (IMAP / Gmail / Outlook)

每个独立 keycap, 都走 oauth source + `current_context` capability.

**底座 lane 加**:
- OAuth loopback callback handler (`shell/lifecycle.rs` 第一次启动 prompt 拉起本机 server, callback 后存 Keychain)
- Sync scheduler (kernel `scheduler.rs` 已有基础, 加 platform sync 注册接口)
- Webhook receiver (本机 server 接 platform 推送) — 端侧化 → 不走 ctrl-cloud relay 时, 可选 `ctrl-cloud/workers/ctrl-relay` 中转
