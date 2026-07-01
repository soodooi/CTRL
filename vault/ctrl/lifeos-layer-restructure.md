# LifeOS layer 重构 — 规划图 + 竞品拆解 + Aino→CTRL 逐条映射

> Governing design for the active goal (`GOAL.md`). bao 2026-06-30「根据 aino lifeos 重构 ctrl 前后端,仔细认真」。
> 系统设计先行(硬门):先有这张统管全局的图,再动代码。局部对齐它,不 debug 式凑。

---

## 1. 定盘发现:「Aino」是两个产品(别再搞混)

`deep-research` skill 多源网调(102 agent / 20 一手源 / 83 主张 / 25 对抗验证,17 confirmed 8 killed):

| | **Aino LifeOS** (`aino.md`) | **LifeOS for Obsidian** (`lifeos.vip`, GitHub `quanru/obsidian-lifeos`) |
|---|---|---|
| 形态 | 真·独立 app(mac 11+/Win 10+/Ubuntu 20.04+/iOS App Store/Android APK),本地 markdown,能开 Obsidian vault 互操作 | **Obsidian 社区插件**(官方目录 `periodic-para`,URL 全在 `/plugin/` 下) |
| 编辑器 | WYSIWYG(CommonMark/GFM/math/`[[wikilinks]]`/Excalidraw),**壳(Electron/Tauri)+ 引擎(Tiptap/CM/PM)未公开** | **无自带编辑器**,骑 Obsidian 内置 CodeMirror 6 Live Preview(changelog v3.0.32 实证) |
| **bao 贴的付费分层** | ❌ 不是它 | ✅ 全是这个插件的(见 §2) |
| DeepAsk 接 Claude Code/Codex | — | **把 Obsidian 上下文(当前笔记+网页+标签页)直接管道喂给本地 CLI 子进程**("local coding-agent modes",changelog v2.0.0/v2.0.22),**不走 MCP**;另跑内嵌 `DeepAsk HTTP Server (MCP)` Koa server 供普通聊天 + 外部 MCP client |

同一开发者线(宜丙林/Yibing Lin ~ quanru/林乐扬,身份关系是 openQuestion),但**两套架构**:独立 app vs Obsidian 插件。

**一手来源**:`aino.md` · `aino.md/download` · `github.com/quanru/obsidian-lifeos` · `community.obsidian.md/plugins/periodic-para` · `lifeos.vip/plugin/pricing.html` · `lifeos.vip/news/deepask-changelog.html` · `lifeos.vip/news/lifeos-pro-changelog.html` · `quanruzhuoxiu.gumroad.com/l/lifeos`。

**对 CTRL 的意义(load-bearing)**:要抄的那套付费功能,本质是**一个没有自带编辑器、没有权限/审计闸、靠 raw 子进程管道缝 AI 的 Obsidian 插件包**。CTRL 现有地基(独立 Tauri app + 自带 Tiptap/CM6/mermaid 编辑器 + `:17873` gate + projection)**比它更强**。所以重构 = **把 LifeOS 功能面嫁接到 CTRL 更强地基上 + 补远程**,不推倒、不变插件。护城河(gate 治理 + projection + 数据主权)全留。

**验证到对 CTRL 有利的两条**:`usememos sync` = 自托管开源 Memos(usememos/memos)REST,非私有云(对齐 CTRL 主权叙事);`remote calendar` = ICS/CalDAV 订阅,「双向同步」宣传**未被证实**(正反两向都被 0-3 驳回)。

---

## 2. LifeOS-for-Obsidian 付费分层(要嫁接的功能面)

- **Community(免费)**:visual note creation · knowledge management · **periodic notes** · **task / goal / time management** · usememos sync
- **Calendar Pro $29.90 lifetime**:sidebar 任务 · big-calendar 排期 · **四象限 / Kanban / Timeline 视图** · remote calendar 拉取 + 双向同步(方向存疑)
- **LifeOS Pro $49.90 lifetime**(= Basic + Calendar Pro + 以下):advanced list(搜索/排序/过滤)· workflow · **habit statistics** · flash roaming(闪念漫游)· theme notes(自定义系统)· portable features 6+
- **DeepAsk AI $29.90 lifetime**:多模型(BYOK,Anthropic/OpenAI-compatible)· 实时内容对话 · **Codex CLI + Claude Code CLI** · Chrome 扩展 · tag 集成 · 文件附件 · **LifeOS Skill**(bundled markdown agent skill,`lifeos skill install`,`.AI.md` 维护 workflow)
- 商业模式:lifetime 大版本买断分层(另有 $24.90/yr 订阅可升 lifetime);目标用户 = Obsidian 存量 PKM / 一人公司。

---

## 3. CTRL 现状(内部 4 路调查已确认)

**已有(≈ Aino 功能面的一半)**:
- **Notes**:完整 vault 笔记 app(`NotesApp.tsx`:Tiptap WYSIWYG + 文件树 + tags + backlinks + frontmatter 编辑 + 模板 + vault health)。
- **SmartTable**:`SmartTableViews.tsx` 已有 kanban / **calendar** / timeline / gallery / form / summary / chart 多视图;§14 relational(Reference/Lookup/Rollup/Formula)经 gate 可用。
- **Gate 治理**:`:17873` 审计 ledger(`audit.rs`/`persistence.rs`)+ intent 可见性裁剪(`visibility.rs`)+ 信任域类型脊(`InternalMsg ⊥ GateRequest`),SC1/2/3 完成。
- **Projection**:`projector.rs` 把工具/skill/memory/workflow 物化进 BYO-CLI 原生落点。
- **Provider**:fal.ai + Anthropic/OpenAI/Ollama/Hunyuan/DeepSeek/Volc BYOK(`provider/registry.rs`)。

**缺(Aino 有、CTRL 没有)**:
- 一级的 **Task/Goal/Habit/TimeBlock/PARA/periodic-notes** 数据模型与 UI(现在只散在 SmartTable / vault markdown)。
- **DeepAsk 式「一键把当前上下文喂给 CLI/Irisy」** 的顺手(CTRL 方向相反:projection,可做得更干净)。
- **远程**(记录在案、从没开工,见 §5)。

---

## 4. Aino → CTRL 逐条映射(6 块)

| # | 建什么(前+后) | 落在 CTRL 哪 | ADR |
|---|---|---|---|
| 1 | **Life 数据模型**:Task/Goal/Habit/TimeBlock 作 §14 Source(describe/query/produce),明文 md+frontmatter,SQLite 派生索引,gate 暴露 | 复用 `vault_smart_table.rs`/`query.rs`/`smart_table_index.rs` 范式 | amend ADR-002 §14 |
| 2 | **PARA + Periodic Notes**:vault 布局策略 + 日/周/月/季/年模板 + 复盘 dashboard | `vault.rs` + Notes 前端 | 锁内 free |
| 3 | **Calendar 一级模块**:升 SmartTable 现有 calendar/timeline/kanban 为独立日历 + CalDAV/ICS 连接器(经 gate) | 前端新模块 + connector | 锁内 free |
| 4 | **上下文管道**:一键把当前笔记/选区喂给 Irisy/BYO-CLI —— projection+gate,比 raw 子进程干净 | `projector.rs` + composer | amend ADR-005 |
| 5 | **Shell/IA 重排**:ambient 壳按 capture→plan→review,L1=Notes/Calendar/Tasks/Review,Irisy 当 pipe 路由输出进各模块 workspace | 前端 `AmbientWorkbench.tsx` | 锁内 free |
| 6 | **远程模块**:WebRTC(屏幕流+输入 data channel)+ ctrl-wire protobuf + P2P/E2EE + content-blind relay | 新 `ctrl-remote` / 骑 `packages/ctrl-mesh` 骨架 | ADR-010 缝⑧ 扶正 |

**ADR 锁点(不动,ADR agent 已确认功能面在锁内自由)**:5 primitives(actor/capability/event/channel/effect)· 双脑(Hermes-Irisy + BYO-CLI)· 三动词冻结(describe/query/produce)· 三能力面(MCP/API/Skills)不塌缩 · 明文 vim-test · **不自带笔记编辑器**(用现有 Tiptap inline viewer,不再造)· BYOK 无 CTRL 默认花费 · gate 单收口。**要碰**(需 bao 共识 amend):加第 3 条 brain 路径 / 第 4 动词 / 第 4 能力面 = 禁;新 Life Source(§14)/ Irisy 管道(005)/ 远程(010)= amend 即可。

---

## 5. 为什么现在没远程(记录在案,非 bug)

- 曾像「远程」的 **ST-SS** 是单向语义广播,**设计上 no input plane**,架构上做不了多端远控;bao 2026-06-23 全量弃用(`master-plan.md` §二·五 C:「多次尝试失败是选型错,不是实现问题」)。
- 真·远程桌面(对标 **ToDesk/RustDesk**,WebRTC + `ctrl-wire` protobuf + P2P/E2EE,NAT 失败走 content-blind relay)被**明确切成独立模块,但从没排期**(ADR-010 缝⑧「留口」,GOAL 非目标)。
- 代码里唯一 WebRTC = `packages/ctrl-mesh`(跨端 CRDT 同步骨架,SKELETON,**不是远程桌面**);远控三条腿(屏幕捕获/视频轨/输入 data channel)全缺。
- **诚实缺口**:RustDesk wire / 远控 E2EE / NAT 穿透**从没调研** → Phase 5 先专项调研再动。

---

## 6. 执行顺序(分阶段,dev-loop,不 big-bang)

Phase 1 Life 数据模型(后端,最高杠杆,滩头)→ 2 PARA/periodic → 3 Calendar → 4 上下文管道+IA 重排 → 5 远程(最大最险,先调研)。每阶段落 ADR amendment 对齐。**第一步 = SC1 Task Source**(describe/query/produce + 明文落盘 + gate 暴露 `task_*`)。

> 相关记忆:`project-ctrl-per-l1-workspace-output-routing`(每 L1 自己的 workspace,Irisy 路由)· `feedback-jump-to-industry-default-not-ctrl-moat`(别抄默认,守反默认护城河)· `feedback-do-real-web-research-dont-guess`(本图即产物)。
