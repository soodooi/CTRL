# Vault + Irisy — 产品级设计

**Status**: brainstorm (decision points listed in §10 — pending bao lock)
**Date**: 2026-06-03
**Authors**: bao + assistant (full session iteration)
**Anchors**: ADR-002 substrate § vault v1 (vault primitives) · ADR-005 irisy v2 § soul-md-compat (memory 锁) · ADR-003 frontend § shell-4col v3 · ADR-007 workbench § canvas v1
**Predecessors**: `vault/ctrl/history/brainstorm/openclaw-compat-2026-06-03.md` (生态绑定)

> bao 2026-06-03: "要用产品的标准去设计, 不能停留在 MVP 这种低等级的需求上"
>
> 这是从 feature-level 升到 product-level 的指令. 后文每一个能力都不当"功能项"来描述, 而是当"产品形态"来设计 — 是什么形状、长在哪里、用户怎么用、Irisy 怎么用、外部 agent 怎么用.

---

## 1. 产品定位

### 1.1 我们不是哪种 vault

| 不是 | 为什么 |
|---|---|
| Notion AI 那种 "AI 当 sidebar widget" | 已被市场证伪, AI-native 流派把 AI-as-widget 比下去了 |
| Obsidian + Smart Connections 那种 "本地笔记 + 插件" | 仍是 "笔记是主, AI 是辅", CTRL 反过来 |
| Mem.ai 那种 "全自动归档无文件夹" | 牺牲了 plain-text + vim test (decision_ctrl_obsidian_philosophy) 哲学 |
| Heptabase 那种 "白板优先" | 白板是 ADR-007 workbench 的话题, 不是 vault 的话题 |
| Reflect 那种 "私密日记本" | 私密性是结果, 不是定位 |

### 1.2 我们是什么

**Vault 是 plain-text substrate, Irisy 是住在边上的脑.**

具体讲:

- **Vault**: 用户全部 plain-text 资产的家 — 笔记 / Daily / sourcing / keycap output / Irisy soul / 模板. **vim test 兜底**, 100 年后用 vim 还能读. 任何工具 (Obsidian / VSCode / Cursor / Claude Code) 都能直接读取, 因为格式是公开的.
- **Irisy**: 唯一的 user-facing AI 人格. **她不是 sidebar widget — 她是住在工作台右边的合作者**, 一直在场, 看着你写, 看着你按 Ctrl 唤出键帽, 看着 keycap 产出. 她有持久 SOUL.md, 跨 session 记得你.
- **Pi**: Irisy 的脑核心 (`@mariozechner/pi-coding-agent`, MIT). 用户不看到 Pi 这个名字, 用户只跟 Irisy 说话. (memory `decision_pi_is_sole_brain_hermes_is_keycap`)
- **Keycap**: 跨 vault 的工具仓库, 产出落回 vault. **vault 是连接器, keycap 之间通过 vault 互相说话** (一个 keycap 写到 sourcing/, 另一个 keycap 从 notes/ 读, vault 是中介).

### 1.3 核心张力 (3 条)

1. **plain-text vault 哲学 vs AI 自动结构化** — Mem.ai 走的"全自动无文件夹"路线违反 vim test. CTRL 解: vault 保持文件夹 + frontmatter 的可读结构, AI 的作用是 **建议** + **加速** + **整理**, 不是 **取代** 用户的组织.
2. **Irisy 是合作者 vs 不打扰** — 一直在场, 但 95% 时间不主动说话, 只在用户调用 / 检测到清晰意图时介入. 不当 paperclip 助手.
3. **本地优先 vs Pi 的云模型** — vault 100% 本地是 truth, AI 推理走 provider router (本地 Ollama 优先, 云 fallback). 用户拔网 vault 完整可用.

---

## 2. 产品的 4 层体验 (用户视角)

用户在 vault + Irisy 里的全部行为分 4 层. 任何 feature 必须落在其中一层, 不落的 feature 不做.

```
┌────────────────────────────────────────────┐
│ Layer 4 — Synthesize: 想清楚                 │  Irisy 帮综合 / 找矛盾 / 比变化 / 综述
├────────────────────────────────────────────┤
│ Layer 3 — Connect: 联结                     │  反链 / 标签 / 语义近邻 / 图视图
├────────────────────────────────────────────┤
│ Layer 2 — Author: 写下来                    │  Tiptap WYSIWYG + Reading + block AI 改
├────────────────────────────────────────────┤
│ Layer 1 — Capture: 抓住想法                  │  Ctrl 全局快捕 / 飞书 sync / 飞屏屏录 / 飞剪贴板
└────────────────────────────────────────────┘
                    ↓
              Vault (plain text)
                    ↓
            Irisy (一直在边上)
```

每层的产品标准:

### Layer 1 — Capture (抓住)
**标准**: 用户从 "我有个想法" 到 "已在 vault 里" 的延迟必须 ≤ 5 秒. 任何更长的流程都让想法跑掉.

- 全局 Ctrl 快捕入口 (现 hotkey 已有, 快捕模式没接) — 0.1.158 ship #1
- 飞书 / Notion / Slack 等 sync provider 拉到 `sourcing/` (sourcing 已有, sync provider 没接) — v1.1+
- 屏幕区域 OCR 直接落 `sourcing/{timestamp}-ocr.md` (OCR keycap 已规划)
- 剪贴板 AI keycap 输出落 `sourcing/`
- 录音 → 转写落 `sourcing/{timestamp}-voice.md` (要 audio.transcribe provider, v1.1+)

### Layer 2 — Author (写下来)
**标准**: 写作体验对标 Reflect / Notion (kairo-class). 一切 friction 移除. AI 改写是 inline, 不是 sidebar.

- Tiptap WYSIWYG + reading mode (已有, 0.1.157 修了 flex 链 + 字号)
- **block AI ops** — 选段 → / 触发 → "tighten / formalize / extract action items / translate / continue writing" — 0.1.158 ship #2
- 自动 frontmatter 推断 (写完 → Irisy 推断 tags) — 0.1.158 ship #3
- AI 改写的 transparency: 任何 AI 生成块, 长按 → 看 provider/model/原始 vs 改后/raw token 用量 — 0.1.158 ship #4

### Layer 3 — Connect (联结)
**标准**: 当用户写到 X 主题时, "你 3 周前写过相关的 Y" 必须自动浮现. 不需要用户主动搜.

- **Embeddings autolink** — 本地 Ollama nomic-embed-text + SQLite vector → 写作时旁边浮 top-K 相关 — 0.1.158 ship #5
- **Hybrid 搜索** — `vault.search` v2: BM25 + cosine rerank, 自然语言查询 — 0.1.158 ship #6
- **Wikilink 自动建议** — 输入 `[[` 时基于 Tana-style autosuggest 显示候选 (现 wikilink Tiptap 扩展已有, 自动建议没接) — 0.1.158 ship #7
- **Graph view** — 已有 (lazy load)
- **Backlinks panel** — 已有 (右侧)
- **Tags panel** — 已有 (左侧 toggle)

### Layer 4 — Synthesize (想清楚)
**标准**: Irisy 主动整理 (每日 / 每周), 用户被动接受. 综合是 vault 的最终价值, 不是搜索.

- **Pi-driven 9am 总结** — `sourcing_scheduler` 升级 (现确定性, 接 Pi 智能整理 + 生成 daily summary) — 0.1.158 ship #8
- **Question vault** — Irisy 聊天里问 "上周我学了什么 X" → hybrid search → top 笔记 → Pi 综合答 (含引用) — 0.1.158 ship #9
- **Cross-note 综合** — "把 A + B 合并 / 找矛盾 / 比上周变化" — Irisy chat 内置命令 — 0.1.158 ship #10
- **每周 review** — 周日 cron 生成 `weekly/{week}.md`, Pi 综合本周笔记 — v1.1+
- **Annual review** — 年底自动生成 (用户精神食粮, 不是工具) — v1.1+

---

## 3. 信息架构 — 3 个视图层

Vault 同一份数据, 3 个 audience 看不同的视图. 这是产品决定的核心.

### 3.1 用户视图 (NotesApp 左侧文件树)

只显示用户自己创建 / 编辑的内容. 系统目录默认藏 (.ctrl / .irisy-* / irisy / keycaps / assets).

```
└── (vault root visible in NotesTree)
    ├── notes/          ← 主要笔记 (用户自己创建)
    ├── daily/          ← Daily notes (Today 按钮 / Pi 每日总结)
    ├── sourcing/       ← 未整理输入 (用户随手 Ctrl 快捕 / sync provider 拉)
    └── templates/      ← 模板 (用户可改, daily.md / meeting.md 是种子)
```

折叠的 "Advanced" toggle (现已有, "Show system folders") 展示:
```
    ├── .ctrl/          ← config (sourcing.yaml / daily-notes.yaml)
    ├── irisy/          ← SOUL.md + .soul-md-version
    ├── .irisy-memory/  ← Irisy 老的 yaml memory (向 SOUL.md 迁移中)
    ├── keycaps/        ← builtin keycap 资源 (不是笔记)
    └── assets/         ← 图 / 音频 / pdf / attachments (走 attachment viewer)
```

**产品标准**: 不让用户去思考 system 是啥, 默认就藏好. 但**永不**用 hidden 文件 (.) 来藏 — vim test 要求文件名公开可读.

### 3.2 Irisy 视图 (Pi brain context)

Irisy 每次说话前, 自动注入到 system prompt 的上下文:

```
[Always-on memory blocks] (Letta core-memory pattern, SOUL.md 模式)
├── vault/irisy/SOUL.md body verbatim                ← user identity + 偏好 + 持续目标
├── 当前 active provider + model + token budget         ← 自知 (ADR-002 § provider §3.7)
└── 当前 open note path + 最近 selection                ← context-aware

[On-demand retrieval] (Letta archival pattern)
├── vault.search 命中 top-K                             ← user question 驱动
├── vault.backlinks + vault.mentions                    ← 当 user 提到某 [[note]]
└── recent vault.watch events                            ← 当 user 问 "我最近改了啥"
```

Irisy 可以读 vault 任何路径 (包括 system 目录), 但产品标准: **Irisy 不主动建议改 system 目录**, 除非用户明示.

### 3.3 外部 agent 视图 (MCP 总线 :17873)

外部 (Cursor, Claude Code, 别的 IDE) 通过 MCP 总线访问 vault. 23 个 vault MCP 工具 + SOUL.md 读写 (ADR-005 §4 待落地).

**产品标准**: 外部 agent 看到的 surface = Irisy 看到的 surface. 没有 "Irisy 私有" 的特权 API. SOUL.md 的存在让 Cursor / Claude Code 知道 CTRL 的用户偏好, 无缝过渡.

---

## 4. Interaction Model — Irisy 是怎么住的

### 4.1 4 列 shell (ADR-003 § shell-4col v3)

```
┌─[L1]─┬─[L2 (workspace tab body)]──────────────────┬─[Irisy]──┐
│ 48px │ Notes app (3-col inside) / Pool / Coding   │  430px   │
│ Nav  │   左 200 文件树 · 中 1fr 编辑器 · 右 180 反链  │  chat    │
└──────┴────────────────────────────────────────────┴──────────┘
```

Irisy 永远在右. 用户写笔记时她**沉默地观察**, 用户主动 @her 或 / 时介入. **她不主动弹消息**, 除非:
- 每日 9:00 一次 "今天 N 条待 review" 提醒 (Layer 4 自动整理)
- 检测到用户写笔记里有明显 question mark / TODO 时, 在 Irisy chat 顶轻提示 "需要帮忙?" (一次性, 可关)

### 4.2 唤起方式

| 场景 | 怎么唤起 Irisy |
|---|---|
| 在编辑器选段 → `/` | inline 出 block AI ops 浮层 (改写 / 抽 action / 翻译) |
| 在 Irisy chat 框输入 | 直接说话, 上下文自动注入当前 open note |
| Ctrl 全局快捕 | 不走 Irisy, 直接落 sourcing/, Irisy 9am 整理 |
| 在 NotesApp 顶部 actions | "Today" / "Review N" — Layer 4 自动整理结果 |

### 4.3 关键设计原则

1. **Irisy 永远说一种话 (一个 persona)** — 不切角色 (memory `decision_one_persona_irisy`). 内部 mode (Janus/Talos/Mnemosyne) 不暴露给用户.
2. **每个 AI 块都可下钻** — 设计哲学 #6 (transparency by drill-down). 长按 / hover → 看 provider/model/原始/改后/token 数.
3. **Irisy 改东西要走 confirm** — vault.write / vault.delete 走 platform.notify 事件让用户看到 (ADR-005 §4 SOUL.md 写也走此流程).
4. **离线优先** — Pi 不可达时 Irisy 不消失, 改为 "本地模式" (Ollama), 用户感知到 fallback 是哪个 provider.

---

## 5. Irisy 13 能力的产品 spec (不是技术清单)

每个能力写: 用户场景 / 产品形态 / 依赖 / 状态.

### 5.1 Embeddings autolink (优先级 1)

**用户场景**: bao 在写 "今天跟客户讨论了 onboarding 流程的卡点", 右侧 backlinks panel 自动浮现卡片: 「3 周前你写过相关: `notes/onboarding-friction-2026-05-15.md`」.

**产品形态**:
- 写作时 Irisy 静默对当前段落 embed → 跑 cosine top-3 → 写在右侧 backlinks panel 顶部, 跟 explicit backlinks (来自 [[wikilink]]) 分组并存
- 卡片是 "candidate", 用户可 1 键转为正式 [[wikilink]] (插入到当前光标位置)
- 卡片不打断写作 — 静默出, 用户不看也不影响

**依赖**:
- 本地 Ollama nomic-embed-text 模型 (用户首次启动提示 install Ollama, 拒装则 fallback 到 Volc cloud)
- 新 kernel 模块 `vault_embeddings.rs` (SQLite vector 表, sqlite-vss 或纯 cosine + flat search)
- 新 MCP 工具 `vault.semantic_search`

**状态**: ADR-002 § vault v1 amendment 待写

### 5.2 Block AI ops (优先级 2)

**用户场景**: bao 选中一段散稿, 按 `/`, 浮层出 6 个动作: Tighten / Formalize / Extract action items / Translate / Continue / Custom. 选 Tighten → 段落原地改 (带 diff 高亮 + Accept/Reject).

**产品形态**:
- Tiptap selection API 触发 `/` 浮层 (kairo / Reflect 模式)
- 流式 Pi 调用, 改写 inline 渲染
- Diff 高亮: 红删绿加, Accept 1 键合, Reject 1 键回
- Custom 是 "你想让我做什么?" 自由输入, 用户可写自己的提示 (落 SOUL.md 让 Pi 跨 session 学习)

**依赖**: Pi (已有) · provider router text.chat (已有) · Tiptap selection extension (待加)

**状态**: 完全新做

### 5.3 Pi-driven 每日总结 (优先级 3)

**用户场景**: 早上 9 点 Irisy 顶部弹: 「今日已综合昨日 5 条笔记 + 2 条 sourcing, 摘要写在 daily/2026-06-03.md 顶部」. bao 点开 daily 笔记, 看 Pi 写的 3 段摘要 + 3 个 action items + 3 个开放问题. 可改可留.

**产品形态**:
- `sourcing_scheduler` (现确定性) 升级: 命中 cron 后, 拼 prompt = sourcing-prompt.md + SOUL.md body + 昨日 daily 笔记 + 昨日 sourcing → 调 Pi text.chat → 流式写入 today's daily
- daily 笔记顶部 frontmatter `summary_by: irisy:pi:claude-haiku-4-5` 留下溯源
- Irisy chat 一次性 toast "今日总结已生成", 可点击跳转

**依赖**: Pi · provider router · 现有 sourcing_scheduler

**状态**: 升级现有模块, 不是新做

### 5.4 Ctrl 全局快捕 (优先级 4)

**用户场景**: bao 在浏览器里看到一段有意思的文字, 按 Ctrl, 弹"快捕"小框 (不打开完整 CTRL workspace), 粘贴 + Enter, 关. 内容已落 `sourcing/2026-06-03-1845-quick.md`.

**产品形态**:
- Ctrl 按一次 (短按): 现有的"唤起 CTRL window"
- Ctrl 长按 (300ms+): 弹"快捕"小窗 (200x80px, 仅一个文本框 + Enter 提示)
- 输入完 Enter: 自动落 `sourcing/{date}-{HHMM}-quick.md`, 带 frontmatter `{source: quick-capture, captured_at: ISO8601}`
- 窗口自动隐, 无需用户操作

**依赖**: hotkey (已有, 加长按检测) · vault.write · 新 Tauri window `quick-capture`

**状态**: 全新做 (PWA 1 个新 route + Tauri 1 个新 window)

### 5.5 Hybrid 自然语言搜索 (优先级 5)

**用户场景**: bao 在 NotesApp actions 搜索框输入 "上次跟谁聊 RFP", `vault.search` v2 命中: BM25 召回 + cosine rerank + Pi 1-shot 总结 "你 4 月 18 日跟 Acme 客户聊了 RFP". 点击跳转原笔记.

**产品形态**:
- 搜索框 placeholder: "搜索笔记 — 关键词或自然语言均可"
- 输入 < 4 字 → 走纯 BM25 (现有)
- 输入 ≥ 4 字 → BM25 召回 top-30 → embedding cosine rerank top-10 → 列出
- 输入是疑问句 (?, "what", "who", "when" 启发式) → top-3 + Pi 1-shot 总结
- 总结也可 drill-down (查 raw top-10)

**依赖**: vault_embeddings (#1 的副产品) · Pi · 升级 vault.search

**状态**: 升级现有

### 5.6 Keycap output → vault sidecar (优先级 6 — CTRL 独有)

**用户场景**: bao 用 OCR keycap 截了一段图文, OCR 结果除了显示给用户外, 自动落 `notes/inbox/2026-06-03-1850-ocr-{stem}.md` 含 frontmatter `{source: keycap:ocr, original_image: assets/images/.../{stem}.png}`. 1 个月后 Irisy 总结时, 这条 OCR 输出可被 vault.search 找到.

**产品形态**:
- 所有 keycap (translate / OCR / text / chat) 的 final output 在显示给用户的同时, 走 `vault.write` 自动落 `notes/inbox/`
- frontmatter 包含: `source: keycap:<id>`, `model: <provider>:<model>`, `tokens_in / tokens_out`, `keycap_run_id`
- 用户可在 sourcing.yaml 配置 `auto_capture_keycap_output: true/false` (默认 true)
- 用户不想要的输出可手动删 (vault.delete)

**依赖**: keycap_runner 加 vault write hook · 所有 keycap manifest 加 `output_target: notes/inbox/` 默认

**状态**: 全新做 (substrate-level change, 涉及 keycap_runner.rs)

### 5.7 SOUL.md 作 Cursor / Claude Code 跨工具记忆 (优先级 7 — CTRL 独有)

ADR-005 §4 已锁. 落地见 §10 决策点 P5.

### 5.8 Wikilink autosuggest (优先级 8)

**用户场景**: bao 在写笔记输入 `[[`, 弹 autosuggest 浮层 (Tana 风格), 显示最近 + 相关笔记, ↑↓ 选 + Enter 插入. 输入文字过滤. 输入 + Enter 新建.

**产品形态**:
- Tiptap wikilink 扩展加 autosuggest (现 wikilink 扩展已有, autosuggest 没接)
- 候选排序: 最近编辑 (mtime) → embedding 相关 → 字母序
- 输入新名字 + Enter: 创建空白 note + 插入 wikilink (符合 Obsidian / Roam 直觉)

**依赖**: Tiptap 扩展 · vault.list · vault_embeddings (#1)

**状态**: 升级现有 wikilink 扩展

### 5.9 Smart frontmatter 推断 (优先级 9)

**用户场景**: bao 写完一段 meeting 笔记保存时, Irisy 静默推断: tags: [meeting, acme, rfp], type: meeting-note, related: [[onboarding-friction]]. 在 FrontmatterPanel 上方浮一行 "Suggest tags?" + Accept/Edit/Reject.

**产品形态**:
- vault_write 后台 trigger Irisy 推断 (异步, 不阻塞 save)
- 用 vault.tags 拿现有 tags vocabulary, 让 Pi 从中选 (不创新 tag, 避免 tag 爆炸)
- 用户 Accept → 写回 frontmatter
- Reject → 这次 session 不再推这条 (写 SOUL.md `x-ctrl:suggest_disabled: true`)

**依赖**: Pi · vault.tags · vault.write

**状态**: 全新做

### 5.10 Cross-note 综合 (优先级 10)

**用户场景**: bao 在 Irisy chat 输 "把 onboarding-friction 和 acme-rfp 合并到 客户问题 这条". Irisy 读两文件 + 合 + 新建 `notes/客户问题.md` + 给原两文件加 frontmatter `merged_into: ...`. 完成弹通知.

**产品形态**:
- Irisy chat 识别"合并 X 和 Y"模式
- Pi 多文件 read → 综合 → write 新 + update 旧
- 不删原文件 (保留可恢复, frontmatter 标记 superseded_by)

**依赖**: Pi · vault.read · vault.write · 多文件上下文管理

**状态**: 全新做

### 5.11 ST-SS 跨设备协同看笔记 (优先级 11 — CTRL 独有, v1.1+)

ADR-005 §2 lock. v1.1+ scope.

### 5.12 语音 → vault (优先级 12, v1.1+)

要 audio.transcribe provider, v1.1+ scope.

### 5.13 Annual / weekly review (优先级 13, v1.1+)

延伸自 #3, weekly 周日 cron / annual 年底 1 次, v1.1+ scope.

---

## 6. 状态模型

### 6.1 Open notes (内存)

```
NotesApp 内 zustand store:
  - openTabs: Array<{ path, dirty, lastSeenAt }>
  - activePath: string | null
  - capturedSelection: Range | null       (供 block AI ops 用)
```

持久化: tabs 写 `~/.ctrl/state/notes-open-tabs.json` 每 5s + 退出时. 重启恢复.

### 6.2 Sync state (vault 内)

```
Vault frontmatter:
  - synced_to: { lark: { id, last_sync_at }, notion: {...} }  (sync provider 加)
  - merged_into: [path]
  - superseded_by: path
  - source: quick-capture | keycap:<id> | manual
  - captured_at: ISO8601
  - summary_by: irisy:pi:<model>
```

### 6.3 Capture pipeline

```
[input] (Ctrl 长按 / sync / OCR / clipboard / voice)
   ↓
sourcing/{date}-{HHMM}-{kind}.md   (落地, vim 可见)
   ↓
[9am cron] sourcing_scheduler::tick
   ↓
Pi: read sourcing/* + SOUL.md + 昨日 daily → 综合
   ↓
write daily/{date}.md (summary 段) + .ctrl/review-queue/{date}.md (suggested actions)
   ↓
Irisy toast: "今日总结已生成"
   ↓
user 点开 daily 看, Accept 建议 / 移笔记到 notes/
```

### 6.4 AI 块状态

任何 Irisy 写入 vault 的内容都带 frontmatter / inline 标记:

```yaml
ai_blocks:
  - id: blk_2026-06-03-T0918-001
    range: [120, 280]                  # char offset in body
    provider: ollama
    model: llama3.3:70b
    prompt_id: tighten-paragraph-v2
    tokens_in: 245
    tokens_out: 132
    original_text: "..."
    accepted_at: ISO8601 | null         # null = pending, ISO = user accepted
```

用户长按某 AI 块 → 浮 popup 显示这 metadata + "再生成 / 回滚 / Approve" 按钮.

---

## 7. 跟同类产品的差异化 (产品级, 不是 feature 级)

| 维度 | Mem.ai | Tana | Reflect | Heptabase | Obsidian + SC | CTRL |
|---|---|---|---|---|---|---|
| **核心隐喻** | "stream of thought" | "supertagged DB" | "encrypted journal" | "infinite canvas" | "open vault + plugins" | **"plain-text substrate + 住在边上的 Irisy"** |
| **AI-as** | 自动归档器 | tag 推断 + 转写归档 | inline 改写 | 空间聚类 | 反链建议 | **合作者 + 综合者** (4 层完整) |
| **存储** | 私有 cloud | 私有 cloud | 端到端加密 cloud | 私有 cloud | 本地 markdown | **本地 markdown + 跨设备 mesh** |
| **lock-in 程度** | 高 | 高 | 中 | 高 | 无 | **无 + 跨工具 (SOUL.md)** |
| **AI 模型** | 自家 + GPT | 自家 + GPT | GPT-4 | 自家 + GPT | 用户自选 | **BYOK + 本地 Ollama + 透明** |
| **多设备** | iOS + web | iOS + web + desktop | web + iOS | web + desktop | desktop + 同步插件 | **mesh + ST-SS 跨设备同屏 (v1.1)** |
| **跨工具读** | ❌ | ❌ | ❌ | ❌ | 部分 | **是 (SOUL.md, ADR-005 §4)** |
| **AI 透明度** | 黑盒 | 黑盒 | 黑盒 | 黑盒 | 看插件 | **每块 drill-down (philosophy #6)** |
| **核心交付物** | 笔记 | DB rows | 笔记 + 日记 | 白板 | 笔记 | **笔记 + keycap output + Irisy 综合** |

**CTRL 的 3 个不能复制的差异化**:

1. **Plain-text + AI-native 同时** — Mem 选了 AI 弃了 plain-text, Obsidian 选了 plain-text 但 AI 是插件. CTRL 同时. (philosophy + vim test)
2. **Keycap output 自动落 vault** — 这个没竞品做, 因为没竞品有 keycap 概念. 这让 vault 成为用户跨工具的"沉淀池", AI 工具的输出不蒸发.
3. **SOUL.md 跨工具** — Cursor / Claude Code / Obsidian 都能读 CTRL 的 soul, 用户在哪里都是同一个 Irisy. 这是 OpenClaw 生态绑定的复利.

---

## 8. 实施路径 (不分 phase, 按依赖序)

按"产品标准设计"要求: 不出现 phase / MVP / 阶段. 而是按**依赖链路**排序. 每一节是一个 cohesive 的产品交付物, 不是单 feature.

### 8.1 第一节 — Irisy block AI 合作者落地

(Layer 2 Author 维度全交付)

**交付物**: 编辑器内选段 `/` 触发 inline AI ops, 6 个 block actions (tighten / formalize / extract-actions / translate / continue / custom), diff 高亮 + Accept/Reject, 流式渲染, AI 块 metadata 写 frontmatter.

**新模块**:
- `packages/ctrl-web/src/components/notes/BlockAiOps.tsx` (浮层)
- `packages/ctrl-web/src/components/viewers/tiptap-selection.ts` (selection API)
- `packages/ctrl-web/src/lib/irisy-block-ops.ts` (Pi 调用 + diff 逻辑)
- `packages/ctrl-web/src/lib/ai-block-metadata.ts` (frontmatter ai_blocks 处理)

**关联**: §5.2

### 8.2 第二节 — Vault embeddings substrate 落地

(Layer 3 Connect 维度地基)

**交付物**: 本地 Ollama embeddings 接入 (首次启动提示 install Ollama, 拒装 fallback 到 Volc cloud), SQLite vector 表, 5 个新 vault.* MCP 工具 + Tauri 命令.

**新模块**:
- `src-tauri/src/kernel/vault_embeddings.rs` (sqlite-vss 或纯 cosine flat)
- `src-tauri/src/commands/vault_embeddings.rs` (Tauri commands)
- 升级 `vault.search` 加 `mode: hybrid | bm25 | semantic`
- 新 MCP 工具: `vault.semantic_search`, `vault.embed_note`, `vault.reembed_all`, `vault.embedding_status`, `vault.suggest_links`

**关联**: §5.1, §5.5, §5.8 的依赖

### 8.3 第三节 — Layer 3 Connect UI 串起来

(Layer 3 完整呈现)

**交付物**:
- 写作时旁边浮 candidate links (基于 §8.2 embeddings)
- Wikilink `[[` autosuggest 浮层 (Tana 风格)
- Hybrid 自然语言搜索框 (NotesActions 搜索框升级)
- backlinks panel 加 "Suggested" 分组

**新模块**:
- `packages/ctrl-web/src/components/notes/SuggestedLinks.tsx` (写作时浮层)
- `packages/ctrl-web/src/components/viewers/tiptap-wikilink-autosuggest.ts`
- 升级 `NotesBacklinks.tsx` 加 Suggested 分组
- 升级 `NotesActions.tsx` 搜索框走 hybrid

**关联**: §5.1, §5.5, §5.8

### 8.4 第四节 — Layer 4 Synthesize 上线

(Pi-driven 综合, 真正的 AI-native 价值)

**交付物**:
- `sourcing_scheduler` 升级 Pi 智能整理 (现确定性)
- Daily summary 自动生成 (顶部 frontmatter `summary_by`)
- Irisy chat 内置命令 "综合 X 和 Y" / "找矛盾" / "上周变化"
- Question vault 走 hybrid + Pi RAG (Irisy chat 自动检测疑问句)

**新模块**:
- 升级 `src-tauri/src/kernel/sourcing_scheduler.rs` 接 Pi
- `packages/ctrl-web/src/lib/irisy-synth-commands.ts` (合并 / 矛盾 / 变化)
- `packages/ctrl-web/src/lib/irisy-vault-qa.ts` (RAG loop)

**关联**: §5.3, §5.10

### 8.5 第五节 — Layer 1 Capture 完整覆盖

(Capture 4 个入口)

**交付物**:
- Ctrl 长按全局快捕窗口
- Smart frontmatter 推断 (写完 save 后 Irisy 静默推 tags)
- Keycap output 自动落 vault (所有 builtin keycap 接 vault.write)
- Clipboard AI keycap 输出自动落 sourcing/

**新模块**:
- `src-tauri/src/shell/hotkey.rs` 加长按检测
- 新 Tauri window `quick-capture`
- `packages/ctrl-web/src/routes/quick-capture.tsx`
- 升级 `keycap_runner.rs` 加 vault write hook
- `packages/ctrl-web/src/lib/irisy-tag-suggest.ts`

**关联**: §5.4, §5.6, §5.9

### 8.6 第六节 — SOUL.md 跨工具桥

(OpenClaw 生态绑定, ADR-005 §4 落地)

**交付物**: 7 个 §4 acceptance 子项 (memory `decision_openclaw_compat_layer`)

**关联**: §5.7

### 8.7 第七节 — Transparency 通层

(philosophy #6 落地)

**交付物**: 所有 AI 块的 drill-down popup + Settings → Privacy 总览

**新模块**:
- `packages/ctrl-web/src/components/ai/AiBlockDrilldown.tsx`
- Settings → Privacy 加 "AI usage stats" 面板

**关联**: §5.2 后置, 但跨所有 AI 触点

---

## 9. 产品维度的关键决策 (要 bao 拍)

以下 7 个是产品级决策, 不是技术细节. 每个的取舍影响整套产品形态. 现请 bao 逐条 lock.

### P1 — embeddings 默认本地 Ollama, fallback 云?

| 选项 | 利 | 弊 |
|---|---|---|
| A. 强制本地 Ollama, 不可达就关 autolink | 100% 本地哲学, 0 云依赖 | 用户拒装 Ollama 直接没 Layer 3 体验 |
| B. 默认本地, 不可达自动 fallback Volc cloud | 体验不打断 | 用户不知何时切了云 (违反 transparency) |
| **C. 默认本地, 不可达 prompt 用户选 (本地 install / 云授权 / 关闭)** | transparency + 用户选 | 多一个 onboarding 步骤 |

**建议**: C. (跟 §4.3 #2 "Irisy 不主动" 一致)

### P2 — AI block 改写默认 streaming inline OR 弹独立 popover?

| 选项 | 利 | 弊 |
|---|---|---|
| **A. Streaming inline 改 (kairo / Reflect 模式)** | 写作 flow 不断 | 选错段会"现场炸" |
| B. 浮 popover 改完确认再合 (Notion AI 模式) | 安全 | 多一步, 失去 inline 感 |
| C. A + B 双模式 toggle | 灵活 | 复杂度爆炸 |

**建议**: A. inline. 错了 1 键回滚.

### P3 — Daily summary 用 Pi (BYOK) OR Volc (CTRL 兜底)?

| 选项 | 利 | 弊 |
|---|---|---|
| A. Pi 本地 (Ollama llama3.3:70b) | 0 成本 | 70B 模型本地慢 |
| B. Volc cloud (CTRL 兜底, 用户无需配 key) | 体验快 | CTRL 付 token 费 |
| C. 优先用户已配的 BYOK provider, 都没就 Volc 兜底 | 灵活 + 透明 | 实现复杂 |

**建议**: C. 跟 ADR-002 § provider §3.5 现有 role-based 路由一致.

### P4 — Keycap output 自动落 vault 默认开 OR 关?

| 选项 | 利 | 弊 |
|---|---|---|
| **A. 默认开** | vault 是沉淀池天然填满 | 用户私密 keycap 也落 |
| B. 默认关, 用户在 sourcing.yaml 启 | 私密 | 用户大概率永远不开, 失去 §5.6 的差异化 |
| C. 按 keycap 类型: 信息型默认开 (OCR/translate), 私密型默认关 (chat/auth) | 中庸 | keycap manifest 要加分类字段 |

**建议**: C. 但起步可以先做 A 跑通, 后续 keycap manifest 加 `output_privacy: public | private` 字段.

### P5 — SOUL.md 顶层路径: `vault/irisy/SOUL.md` vs `vault/SOUL.md`?

| 选项 | 利 | 弊 |
|---|---|---|
| **A. `vault/irisy/SOUL.md`** | 跟 .irisy-memory/ 同地, 语义清晰 | irisy/ 目录默认隐藏会让用户找不到 |
| B. `vault/SOUL.md` 顶层 | 用户一眼看见, 像 README | 顶层文件污染 |
| C. `vault/.ctrl/SOUL.md` | 跟 config 同地 | 跟 OpenClaw 默认 (项目根 SOUL.md) 不一致 |

**建议**: A. 跟 OpenClaw + ADR-005 §4 已有锁一致 (但 NotesTree 加 "Irisy memory 入口" 卡片让用户能找到).

### P6 — Layer 4 自动整理用户可关吗?

| 选项 | 利 | 弊 |
|---|---|---|
| A. 永远开 | 价值最大化 | 用户无控制 |
| **B. sourcing.yaml 顶部 `enable_auto_summary: true` 默认开, 用户可关** | 用户掌控 | 大部分用户不会关 (无所谓) |
| C. 默认关, 用户主动开 | 极度保守 | 失去 §5.3 的核心价值 |

**建议**: B.

### P7 — block AI ops 浮层触发: `/` 还是 `Cmd+K` 还是两者?

| 选项 | 利 | 弊 |
|---|---|---|
| A. `/` (Notion / kairo) | 直觉 | 跟 Markdown 表格分隔符冲突 |
| B. `Cmd+K` (Linear / Raycast 通用) | 跟 muscle memory 一致 | 跟现 Ctrl 全局冲突需要核对 |
| **C. 两者都行, `/` 在选段后才弹** | 兼顾 | 实现略复杂 |

**建议**: C.

---

## 10. 不做的事 (明确边界)

为防止 scope creep, 以下不在 vault + Irisy 产品 spec 内:

- **白板 / 空间 canvas** — 那是 ADR-007 workbench § canvas, 不是 vault 的事
- **Heptabase 风格无限画布** — 同上
- **跨 vault 多 workspace** — v1 单 vault root, 多 vault 是 v1.1+ scope
- **Sync provider 集成 (飞书 / Notion)** — 是 ADR-002 substrate § sync (待开), 不是 vault 本身
- **公共 markdown 主题切换 / 编辑器主题市场** — 锦上添花, 不进 v1
- **Plugin 系统让第三方写 vault 扩展** — 是 keycap (ADR-004 cap), 不是 vault
- **AI 自动改 vault 结构 (重组目录)** — vault 结构是用户的, AI 永不动 (philosophy)
- **Cloud sync vault 本身** — vault 是本地 truth, 多设备靠 mesh (ADR-002 § crypto v1.1+)

---

## 11. 验收标准 (产品级)

(代替 ADR § acceptance 的 checkbox list — 这里写成产品体验标准)

1. **新用户从打开 CTRL 到 Vault Layer 1 capture 完成 — ≤ 30 秒** — 含 Ctrl 唤起 + 输入 + Enter 保存
2. **写笔记到一段 250 字 — 旁边出现 candidate links ≤ 2 秒** — Embeddings autolink latency
3. **选段 → `/` → 改写完成 — ≤ 5 秒** — Block AI ops 首字符流式延迟 ≤ 800ms, 全段 ≤ 5s
4. **Daily summary 9:00 准时生成, 用户无需手动触发** — Layer 4 自动
5. **任何 AI 块 drill-down — 1 次点击看到 provider/model/token/原始** — Transparency
6. **关 Ollama / 关 Volc / 关网 — vault CRUD + 搜索 (BM25) 仍 100% 可用** — 本地优先
7. **删 vault 任意文件夹后重启 CTRL — 自动重建用户级文件夹 + system 文件夹** — 鲁棒性
8. **Irisy SOUL.md 内容 — Cursor 打开 vault/irisy/SOUL.md 能读懂 + Claude Code 也能** — 跨工具 (OpenClaw)

---

## 12. 下一步

bao 拍 P1-P7 后, 我按 §8 的 7 节依赖顺序逐节 ship. **不分 phase, 不切 MVP**, 每节是 cohesive 产品交付物, 跨多个 commit 但单一 PR.

文件锚:
- ADR-002 substrate § vault v1 amendment (vault.semantic_search 等 5 个新 MCP) — §8.2 起跑前先写
- ADR-005 irisy § soul-md-compat 落地 — §8.6
- 新 brainstorm 引用: `vault/ctrl/history/brainstorm/openclaw-compat-2026-06-03.md`
- Memory: `decision_vault_adr_002_section_8` · `decision_openclaw_compat_layer` · `decision_pi_is_sole_brain_hermes_is_keycap` · `decision_ctrl_obsidian_philosophy` · `decision_one_persona_irisy`
