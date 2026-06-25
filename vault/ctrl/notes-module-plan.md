# CTRL Notes 模块 — 统管规划真相 (governing plan)

> 系统设计先行。Notes 模块一直在「补症状」(每个笔记开成表格 / 树藏起来 / 文件夹乱 / status 不能输入) —— 根因是**缺一张统管规划 + 代码漂移**。本文是 Notes 模块的单一真相,所有 Notes 改动对齐它。
> Backing: ADR-003 §5/§8 + **v9 (2026-06-17, kairo 退役→Obsidian)** + DRIFT D7 + 业界调研 (2026-06-25)。bao 拥有本文。

## Status: DRAFT — 待 bao 确认方向后落 ADR-003 amendment + 据此收敛代码

## 一、问题定性 (为什么「用户没法用」)

**不是某个 bug,是规划问题**:ADR-003 v9 早锁了「CTRL **不自带编辑器**,/notes = 内联查看 + 在 Obsidian 打开,Irisy 操作 vault」,但**代码层在造一个完整 Obsidian 克隆**(Tiptap 编辑器 + 文件树 + 反链 + 图谱 + 命令面板 + 笔记里塞智能表格)—— 正是 ADR 明令「不要重复造轮子」的东西。半成品克隆 = 又乱又卡又不能用。

## 二、业界调研结论 (2026-06-25, 一手源)

**没有一个严肃工具重造编辑器。** 两种范式:
1. **vault 内插件**(Obsidian Copilot / Smart Connections / Claudian)= 用 Obsidian 原生编辑器 + AI 做**侧栏 chat**,改动 1-click apply 回原笔记。
2. **外部 agent**(Claude Code / Codex CLI)= 把 **vault 目录当工作目录**,直接读写 markdown 文件,无自有编辑器。

- **集成机制** = Local REST API 插件 (`:27124`, bearer key) + obsidian-mcp(stdio,操作 vault 文件)+ 直接磁盘文件操作。verb 集(cyanheads 14 工具,**外科手术式**):`get / list / search / write / append / patch / replace / manage_frontmatter / manage_tags / open_in_ui`。
- **分工**:capture/write/link/tag/daily 合成/triage = **agent 侧**;语义 RAG / 反链建议 = **索引侧**(持久 embedding,如 Smart Connections 端侧模型)。
- **「Codex+Obsidian」无一方集成**(仅社区 feature request);真实对应 = Claude Code on vault / Claude+obsidian-mcp / Copilot 插件。
- **裁决**:「薄查看 + AI 经 gate 操作 vault + 在 Obsidian 编辑」field-aligned,自造编辑器是错误。

## 三、CTRL Notes 模块的统管设计 (governing)

四层,派生于 plain-text 哲学(vault = truth,Obsidian = 兼容承诺不是依赖):

```
vault (~/Documents/CTRL/, plain markdown, 用户拥有, = TRUTH)
   │
   ├─ CTRL Notes 模块 = 薄 KB 层 (查看 + 导航,不是编辑器)
   │     • 内联 READ/preview (glance 不用离开 CTRL)
   │     • 导航: 文件树 + 搜索 + 标签 + 反链 (都是 READ 面)
   │     • 轻量内联编辑 (现 MarkdownViewer Tiptap 够用) — 但不追 Obsidian parity
   │     • 「在 Obsidian 打开」= 重度编辑/图谱/插件的逃生舱
   │
   ├─ Obsidian (用户自己装) = 重度编辑器 + 图谱 + 插件生态
   │
   └─ Irisy = AI agent, 经 :17873 gate 操作 vault (外科手术 verb)
```

### CTRL Notes **造**:
1. **薄查看/导航层** — 文件树(分组 + 隐藏 system 文件默认)+ FTS5 搜索 + 标签 + 反链(只读面)。
2. **轻量内联编辑** — markdown 看 + 改 + 存(Tiptap/CodeMirror,已有);frontmatter 面板。够日常,不追 parity。
3. **「在 Obsidian 打开」按钮** — 重度编辑/图谱/复杂操作交给 Obsidian(`open_in_ui` 范式)。
4. **Irisy = KB agent** — 经 gate 的外科手术 verb 读/搜/写/连链/打标签;capture→recall→supply。
5. **语义 RAG / 反链建议** — SQLite FTS5 + WASM embed(索引侧,已规划)。

### CTRL Notes **不造**(交给 Obsidian,ADR-003 v9 锁):
- ❌ 完整 WYSIWYG / Obsidian-parity 编辑器
- ❌ 图谱视图克隆(GraphView)
- ❌ 命令面板克隆(CommandPalette)
- ❌ 笔记里塞智能表格(smart-table 是独立 `tables/` 模块,不混 Notes — ADR-003 v20「no doc-mixing」)

## 四、gate verb 收敛 (AI/agent 面)

现 CTRL gate 有:`vault_read / write / search / list / backlinks / tags / notes_by_tag / mentions / orphans / graph_data / rename / move / create_folder / set_starred / aliases`。**缺外科手术 verb**(业界关键):
- ➕ `vault_append`(末尾追加,daily/capture)
- ➕ `vault_patch`(按 heading/block/frontmatter 定点插入)
- ➕ `vault_replace`(局部替换,不整文件重写)
- ➕ `notes_open_in_obsidian`(交还 Obsidian)
- `vault_write` 保留作整文件写,但 AI 默认用外科手术 verb(避免整文件覆盖丢内容)。

## 五、收敛计划 (据本规划改代码,不再补症状)

1. **保**:MarkdownViewer 轻量编辑 + NotesTree 导航 + 搜索 + 标签 + 反链(只读)。
2. **废/降**:未提交 WIP 的 GraphView(中心图谱)、CommandPalette —— 不是 CTRL 该造的(Obsidian 有)。MarkdownViewer 的 isSmartTable handoff **已废**(笔记不再开成表格,commit `fb2ada0`)。
3. **加**:「在 Obsidian 打开」按钮(`commands/obsidian.rs` 已有 connector,DRIFT D7);gate 外科手术 verb(append/patch/replace)。
4. **清树**:默认隐藏 system 文件(AGENTS/README/.* ),默认按文件夹分组,「Show system folders」可开 —— 修「文件夹乱」。

## 六、待 bao 拍

- 方向对吗:**Notes = 薄层 + Obsidian 编辑 + Irisy 操作,不自造编辑器**(= 重申 ADR-003 v9)?
- WIP 的 GraphView / CommandPalette:**废掉**(交给 Obsidian),还是你想留(则需补完 + 入 ADR)?
- 确认后:落 ADR-003 amendment + 据第五节收敛代码。

## 七、vault 根 + 同步(bao 2026-06-25 拍板)

**vault 根 = 用户配置,不是写死。**(原 `default_vault_root()` 硬编码 `~/Documents/CTRL/` 违背「vault 由用户决定 / 本地是 truth」。)
- 内核读 `~/.ctrl/config.json` 的 `vault_root` → 有就用用户选的(指向他自己的 Obsidian vault),没有才 fallback `~/Documents/CTRL/`。
- 首次运行引导用户用**原生文件夹选择器**(Tauri dialog 插件)指向自己的 vault;Settings→General→Vault 可切换。
- 这样「CTRL 和 Obsidian 是同一个 vault」靠配置成立,数据主权护城河成立(CTRL 不在数据路径里)。
- 落点:`kernel/vault.rs`(`configured_vault_root`/`set_vault_root`)+ `commands/vault.rs`(`vault_get_config`/`vault_set_root`)+ `components/VaultSetup.tsx`。

**vault 同步 = 组合,不自建 mesh。**
- 调研裁决(2026-06-25):vault 是纯 markdown,用户多半已有同步(Obsidian Sync / Syncthing / iCloud / git)。CTRL **不自造同步** —— 谁同步文件谁就顺带同步 CTRL 的读写,CTRL 零参与 = 数据主权。
- **完整 mesh(ADR-002 §4:vodozemac + webrtc + Automerge CRDT)留作 v1.1+**,且仅给 **CTRL 自己的跨设备非文件态**(在线/实时/CTRL 专有记录)用,**不**拿来重新同步 vault(两个 merge owner 会损坏文件)。
- **唯一 CTRL 提供的同步助手 = 薄 git 一键同步**:`vault_git_sync`(init→add→commit→push,无 origin 优雅降到本地 commit,内联 git identity)。组合 git,不自造协议。落点 `commands/git.rs::vault_git_sync` + Settings Vault 行的「Sync to git」按钮。
- **「vault 同步是不是通讯模块业务?」答**:vault 文件同步**不是**(= 组合用户的同步工具);跨设备 mesh 传输**是**通讯模块(ADR-010 缝⑧),但那是 v1.1+ 给 CTRL 自有态,与 vault 文件同步两回事。
