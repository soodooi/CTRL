# Vault MD management — research + gap matrix vs Kairo

**Date**: 2026-06-01
**Trigger**: bao "接下来做 L1 vault 按钮, 研究一下用什么方式呈现笔记和记录笔记 / 调研 vault md 文档的管理, 不仅仅是做笔记 / 有直接能用的吗 / obsidian-clone 有 React 组件?"
**Status**: research complete, awaiting bao decision on scope

---

## TL;DR

整套开源 Obsidian-clone **React+Tauri** 实装存在 — **seahop/kairo (MIT)** 跟 CTRL stack 99% 一致, 可作 reference / 选择性 cherry-pick (MIT-compatible with ARR).

CTRL 现 vault 层比预期厚:
- Kernel 8 tauri commands + FTS5 + backlink/tag scanner 已落地
- Frontend Tiptap WYSIWYG + CodeMirror 6 source toggle 已落地 (MarkdownViewer.tsx 243 行)
- VaultBrowser 215 行 (tree+search+viewer+backlinks) 但 **3-pane 自带 shell**, 跟 bao L2-driven 架构冲突 — 需拆.

主要 gap = (1) L1 入口 + L2 集成 wiring, (2) wiki-link 编辑器扩展 + 自动补全, (3) 模板/Daily Notes/Tags/Aliases/Stars 等 vault 行为层 feature, (4) 知识图谱.

---

## 1 候选 Obsidian-clone 调研结果 (React-based, 真实)

| 项目 | Stack | License | 关键能力 | CTRL 适配度 |
|---|---|---|---|---|
| **seahop/kairo** | **Tauri 2 + React 18 + TS + Vite + Rust + SQLite FTS5 + CodeMirror 6 + Zustand + Tailwind + React Flow + D3-force + git2-rs** | **MIT** | 全套 (wiki-link / backlinks / 图谱 / 模板 / Daily Notes / Snippets / 版本快照 / Unlinked mentions / Dataview-like / Kanban / 图编辑器 / Git) | ★★★★★ 99% 同 stack |
| novyxlabs/novyx-vault | Next.js 16 + Tauri v2 + React 19 + TS + Tailwind 4 + CodeMirror 6 + Supabase | MIT | wiki-link / 图谱 / AI 记忆 / 21 provider preset | ★★★☆☆ Next.js 不是 Vite |
| adcaudill/phosphor-notes | Electron + React + Vite + CodeMirror + Node worker | MIT | wiki-link / 图谱 / Logseq importer | ★★★☆☆ Electron 不是 Tauri |
| ddsyasas/llm-wiki | Next.js 14 + React + TS + better-sqlite3 + react-force-graph-3d | MIT | LLM 自动维护 wiki / BYOK / 3D 图谱 | ★★★☆☆ 偏 LLM ingest pattern |
| xclusive36/MarkItUp | Next.js 16 + TS | MIT | semantic search + 知识图谱 + 浏览器 IndexedDB | ★★☆☆☆ server-side |
| devjarus/personal-knowledge-base | Next.js + MCP server + CLI | n/a | MCP-first PKM | ★★☆☆☆ Next.js+server |
| seahop/kairo-mobile (React Native) | n/a | n/a | online-only client | n/a |
| azrtydxb/kryton | React 19 + Fastify + Postgres + Yjs | n/a | 团队多人协作 PKM | ★☆☆☆☆ server-first |

**Logseq (AGPL)**, **AppFlowy (Flutter)**, **SilverBullet (Apache, server-only)**, **Trilium (server-only)** 均不适配.

**首选 reference: kairo** — 同 stack 同 license-compatible, feature 覆盖完整, 直接对照 acceptance.

---

## 2 CTRL 现状 inventory (verified)

### 2.1 Kernel (src-tauri)

`src-tauri/src/commands/vault.rs` (260 行) tauri commands:
- `vault_write(VaultWriteArgs)` — markdown + frontmatter 写入
- `vault_write_image(...)` — image attach
- `vault_read(VaultReadArgs)` — markdown + frontmatter 读取
- `vault_list(VaultListArgs)` — folder listing
- `vault_search(VaultSearchArgs)` — **FTS5 query**
- `vault_delete(VaultDeleteArgs)`
- `vault_root_path()` — ~/Documents/CTRL/
- `vault_rebuild_index()` — FTS5 reindex

`src-tauri/src/kernel/vault.rs` + `vault_index.rs` — backend storage + **FTS5 + backlink scanner + tag scanner** (kernel-native, no VMark dep, 跟 CLAUDE.md "Vault index" 行对齐).

### 2.2 Frontend (packages/ctrl-web/src)

| 文件 | 行数 | 职责 | 状态 |
|---|---|---|---|
| `routes/vault.tsx` | 6 | 入口 route, delegate to VaultBrowser | stub |
| `components/vault/VaultBrowser.tsx` | 215 | 3-pane shell [tree \| viewer \| backlinks] | **完整但布局错** — 自带 shell 跟 4-col app shell 冲突 |
| `components/vault/BacklinksPanel.tsx` | 107 | client-side O(N) scan, self-noted "swap for kernel index later" | 凑合但 perf 不行 |
| `components/viewers/MarkdownViewer.tsx` | 243 | **Tiptap WYSIWYG + CodeMirror 6 source toggle**, IME-safe round-trip | 已实装, round-trip lossy |
| `lib/viewer-registry.ts` | n/a | content-type → viewer | 完整 |
| Tauri shell `app.module.css` | n/a | 4-col grid [Tab \| L2 \| L1 \| Irisy] | L2 当前空, `data-l2-open='true'` 拉宽 200px |

### 2.3 ADR-002 vault 锁定状态

- §2 capability surface 列了 `file.{read,write}` (低层 fs primitive)
- §6 MCP tools 列了 `vault.{read,write,list,search}`
- §4 + §7 提到 vault 作 skill/cap_asset override path
- **❌ 没有专属 § vault 章节** — vault stack lock (Tiptap / CodeMirror 6 / mermaid / FTS5) 当前**只在 CLAUDE.md table 行**, **不在 ADR**, 这是真 gap.

---

## 3 Gap matrix vs Kairo

### Tier 1 — bao 本次 task 必做 ("L1 vault 按钮怎么做 + L2 整合")

| Item | CTRL 现状 | Kairo | 行动 |
|---|---|---|---|
| L1 vault 按钮 | ❌ NAV_ITEMS 无 vault | n/a | **add icon to PrimaryRail** |
| L2 vault 导航 | ❌ L2 空 | n/a (kairo 自带 shell) | **L2 panel 装 tree + search + new note button** |
| VaultBrowser 3-pane shell | 自带 [tree\|preview\|backlinks] | n/a | **拆**: tree → L2; preview → workspace tab (现已通过 openTab 走通); backlinks → 决定 (Q1) |
| 新建笔记 | ❌ 无 UI 按钮 | ✅ Ctrl+N + 模板 picker | **加 L2 顶部 + 按钮 + dropdown 选模板** |
| Backlinks 位置 | 现在 VaultBrowser 右 aside | ✅ 浮窗 / 底部 drawer / 侧栏 | **Q1 — bao 拍** |

### Tier 2 — vault 行为层 (kairo 1:1 parity)

| Item | CTRL 现状 | 优先 |
|---|---|---|
| Wiki-link `[[]]` Tiptap 扩展 + autocomplete + broken-link styling | ❌ 仅 BacklinksPanel regex 用 | **P0** (kairo 必须) |
| Frontmatter YAML 编辑面板 | ⚠️ vault_read/write 已 round-trip 但无 UI | P0 |
| Tags inline + tag panel | ❌ kernel 有 tag scanner, frontend 没 surface | P0 |
| Aliases (frontmatter `aliases:`) | ❌ | P1 |
| Templates (Zettelkasten / PARA / Daily Notes) | ❌ | P1 |
| Daily Notes button | ❌ | P0 (高频) |
| Stars / Bookmarks | ❌ | P2 |
| Snippets (`/` trigger) | ❌ | P2 |
| 自动版本快照 | ❌ | P2 |
| Unlinked Mentions | ❌ | P2 |

### Tier 3 — vault 探索层 (差异化)

| Item | CTRL 现状 | 备注 |
|---|---|---|
| 知识图谱 (force-directed) | ❌ | kairo 用 React Flow + D3-force; 需 kernel 出 backlink edge dataset; **可后置** |
| Orphan detection | ❌ | kernel 现有 backlink scanner 直接派生即可 |
| MOC candidates | ❌ | 同上 |
| Dataview-like 查询 | ❌ | 复杂; defer |
| Vault health dashboard | ❌ | 派生 |

---

## 4 架构决策候选 (待 bao 拍)

### Q1 — Backlinks 放哪?

| 选项 | 描述 | tradeoff |
|---|---|---|
| **A. workspace tab 内右栏 aside** | 现在 VaultBrowser 那种, 但跟着打开的笔记 | 占工作区横向空间, 跟 Irisy 列冲突 |
| **B. 工作区底部 drawer** | 折叠 / 拉起, 默认关 | 不占横向, 但 vertical 切割 viewer |
| **C. L2 底部 panel** | tree 上半 / backlinks 下半 (跟当前 selection 联动) | L2 已经窄 (200px), 信息密度低 |
| **D. 浮窗 (hover trigger)** | 选中笔记标题时浮出 | 干净, 但发现性差 |

**推荐**: B (底部 drawer) — kairo 也用这种, 用户 muscle memory.

### Q2 — Wiki-link Tiptap 扩展 走哪条?

| 选项 | 描述 | tradeoff |
|---|---|---|
| **A. 自写 Tiptap extension** | 拦 `[[`, 弹 autocomplete from `vault_list`, 渲染时 broken-link styling | 工作量大 (~3-400 LOC), 可控 |
| **B. Cherry-pick kairo 的 wiki-link 实现** | Kairo MIT, 直接 port src/components/editor 相关代码 | 快, 但 Tauri command 接线需重接 |
| **C. 用 Milkdown 替换 Tiptap** | Milkdown 自带 markdown-first + 部分 wiki-link plugin | 换 editor 等于推倒重来 |

**推荐**: B (cherry-pick kairo) — MIT 兼容, 减少 ~3 周自写时间. **需 bao 同意 cherry-pick 路线**.

### Q3 — 模板系统设计?

| 选项 | 描述 | tradeoff |
|---|---|---|
| **A. 硬编码 3 个内置 (Zettelkasten / PARA / Daily Notes)** | YAGNI 风, 跟 kairo 一致 | 灵活性 0 |
| **B. vault/templates/*.md 用户自定义 + 内置 3 个 seed** | vim test 满分, 文件即模板 | 实现稍多 |
| **C. Irisy 现场生成** | "帮我新建一个会议笔记" → Irisy 写 md | 高级但慢 |

**推荐**: B (filesystem-driven) — plain-text 哲学一致, 用户可 fork 内置.

### Q4 — VaultBrowser.tsx 215 行怎么处理?

| 选项 | 描述 |
|---|---|
| **A. 整体废弃**, 拆成 L2VaultPanel + workspace vault-md tab + (Q1 选项的 backlinks UI) | 干净, 跟 ADR-003 4-col shell 对齐 |
| **B. 保留 routes/vault.tsx, 但拆掉 3-pane shell** | 跟 A 等价, 只是 file 名留 |
| **C. 不拆, L1 vault button 直接打开 /vault route** | 偷懒, 但跟 L2 架构冲突 |

**推荐**: A — 按 feedback `feedback_no_redundancy_one_ssot` ("加新退旧, 不留并行"), 整体废.

---

## 5 推荐实施路线 (待 bao 选择后)

### 阶段 1 — L1 入口 + L2 集成 (1-2 commit)

1. Add `vault` to NAV_ITEMS (PrimaryRail) — icon: book / vault
2. `app.tsx` 在 active L1 === vault 时, 把 L2 标记 `data-l2-open='true'` + 渲染 `<L2VaultPanel />`
3. New `components/vault/L2VaultPanel.tsx`:
   - 顶部: "+ New note" 按钮 (default + 模板 dropdown) + "Today's note" 按钮 + search box
   - body: folder-grouped tree (现 VaultBrowser groupPathsByFolder)
   - click → openTab(vault-md, path) 入 workspace
4. Workspace vault-md tab 继续用 MarkdownViewer (现已 Tiptap+CM6)
5. 废弃 routes/vault.tsx + VaultBrowser.tsx 旧 shell

### 阶段 2 — wiki-link + frontmatter (1-2 commit)

6. Cherry-pick kairo wiki-link Tiptap extension (Q2-B), 接 vault_list 做 autocomplete
7. Frontmatter editor (Q2 collapsible YAML 块在 viewer 顶部)
8. Tag panel — L2 下半 (或独立 L1 tab; defer)
9. Backlinks UI — Q1 决定 (B drawer)

### 阶段 3 — 行为层 parity (defer until bao confirms)

10. Daily Notes + Stars + 模板 system
11. 知识图谱 (React Flow + D3-force)
12. Orphan / unlinked mentions / MOC candidates

---

## 6 License + 兼容性确认

- **Kairo MIT** — cherry-pick 单文件需保留 `Copyright (c) 2026 Sean Hopkins` + MIT 文本. 加 `THIRD_PARTY_LICENSES.md`. CTRL 整体 ARR 不冲突 (MIT permissive 允许进 closed-source).
- **Kairo 用的依赖**: 全部 MIT / ISC (CodeMirror 6 MIT, react-force-graph-2d MIT, d3-force ISC, @xyflow/react MIT, react-markdown MIT, react-window MIT). 全部 CTRL 可直接装.
- **Kairo 用了 Tailwind**, CTRL 没用 Tailwind — port 时需要换成 CSS modules + tokens.

---

## 7 ADR 影响 — § vault v1 新章节草案

按 PROCESS.md §1, 这是 ADR-002 加新 section + bump overall version (现 v2 → v3 since adding § vault v1).

```
### §8 Vault — markdown PKM stack (NEW v1)

`packages/ctrl-web/src/components/vault/` + `src-tauri/src/kernel/vault*.rs`.

**Storage**: `~/Documents/CTRL/` plain markdown + YAML frontmatter. vim test 满分.

**Kernel surface** (`vault.{read,write,write_image,list,search,delete,root_path,rebuild_index}`): SQLite FTS5 index + kernel-native backlink + tag scanner. No VMark sidecar.

**Frontend stack**:
- Markdown editor: **Tiptap v2** (WYSIWYG) + **CodeMirror 6** (source mode toggle), wiki-link Tiptap extension ported from kairo (MIT, Sean Hopkins 2026)
- Mermaid: `mermaid.js`
- Frontmatter: `gray-matter` round-trip
- HTML viewer: iframe + CSP sandbox
- File tree: folder-grouped flat list (react-arborist if nesting needed)

**Shell integration** (ADR-003 frontend § shell v4):
- L1 nav has `vault` icon
- L2 column = vault navigator (tree + search + new note + tags)
- Workspace tab = single-file MarkdownViewer
- Backlinks = workspace bottom drawer (Q1-B per brainstorm doc)

**Reference (not vendored)**: seahop/kairo MIT — feature parity target Tier 1+2 above.

§ Future work — knowledge graph (React Flow + D3-force), Dataview-like queries, version history.

§ Acceptance v1:
- [ ] L1 vault icon wired
- [ ] L2VaultPanel renders tree + search + new-note
- [ ] vault-md tab opens via openTab() from L2
- [ ] Wiki-link Tiptap extension + autocomplete from vault_list
- [ ] Frontmatter editor in viewer
- [ ] Backlinks drawer
- [ ] Old VaultBrowser shell retired
```

Changelog 行: `2026-06-01 — add § vault v1 (L1+L2 integration, Tiptap+CM6 lock, kairo-compatible feature baseline)`

---

## 8 待 bao ack 决策

(全部 ack 于 2026-06-01 — 见 §10 lock)

---

## 9 Sourcing workflow + Daily Note feature-layer 校准 (2026-06-01 增节)

### 9.1 校准: Daily Note 不进 kernel

bao 2026-06-01 拒绝 `vault.create_note(kind="daily")` 高层 wrapper. 理由: **Daily Note 是 feature, kernel 只提供 infrastructure**. 跟 memory `feedback_build_system_not_business` 一致 — 我建系统不建业务.

落地形态:
- `vault/.ctrl/daily-notes.yaml` — 用户可改的 convention (路径模板 / 频次 / 默认 frontmatter / 触发方式)
- `vault/templates/daily.md` — 默认 template 文件 (用户可 fork)
- `lib/vault-conventions.ts` (frontend) — 读 yaml, 拼出 `daily/2026-06-01.md` 这种路径
- Irisy 同样读 yaml — 用户跟 Irisy 说 "建今天的 daily" → Irisy 读 conventions → 调 `vault.write(path, body)` 低层 API

kernel 不感知 "Daily Note" 概念, 也不感知 "template". 它只知道 vault 是 markdown + frontmatter 文件树 + index.

### 9.2 Sourcing 工作流 (核心新增)

**Mental model** (bao 2026-06-01):

```
vault/sourcing/      ← 用户随手收件箱
    2026-06-01-1432-clip.md     ← clipboard 键帽写入
    2026-06-01-1530-ocr.md      ← OCR 键帽写入
    2026-06-01-1721-link.md     ← 链接键帽写入
    ...

vault/.ctrl/
    sourcing.yaml               ← 触发规则 + 整理 prompt 配置
    sourcing-prompt.md          ← Irisy 整理 prompt 模板 (用户可改)
    daily-notes.yaml            ← Daily Note 路径/频次配置
    review-queue/
        2026-06-01.md           ← Irisy 整理建议 (待 user review)

vault/templates/                ← 模板文件 (用户可加)
    daily.md
    meeting.md
    zettelkasten.md
    ...
```

**Irisy 整理 routine** (每条 sourcing/ 项目, 输出到 review-queue/):
1. 读 sourcing/ 全部
2. 对每条:
   - 抽内容类型 (link / 截图 OCR text / 短笔记 / 摘录)
   - 推荐归类目标 (`notes/projects/foo.md`)
   - 推荐 frontmatter (tags / source / created)
   - 推荐 backlinks (基于现有 vault index)
3. 写建议到 `vault/.ctrl/review-queue/<date>.md` (单一文件, 一天一篇, 含 N 条建议项)
4. 推 `platform.notify` "今天 N 条待整理"

**Review workflow** (user):
1. L1 vault 点开 → L2 顶部 "📥 Review (N)" badge (N = review-queue 未处理条数)
2. 点 badge → workspace 开 "Sourcing Review" tab
3. 逐条 [Accept] / [Edit] / [Reject]:
   - Accept: `vault.move(sourcing/X → notes/foo.md)` + 注入建议 frontmatter + 记 backlinks
   - Edit: 打开编辑器手改, 然后 Accept
   - Reject: `vault.delete(sourcing/X)`
4. review-queue 条目自动从未处理变 processed (frontmatter `status: done` + timestamp)

### 9.3 触发: 3 路 (bao ack 全部并存)

| # | 触发 | 实现 |
|---|---|---|
| 1 | 时间 (默认 9am) | kernel cron (`vault.watch_sourcing_cron(spec)`) or tokio 定时调度 |
| 2 | 数量 (sourcing/ ≥ N, 默认 5) | kernel file watcher (notify crate / chokidar 等价) on `vault/sourcing/` |
| 3 | 手动 ("/integrate sourcing" or 顶 button) | Irisy chat slash 命令 or 显式 button |

三者并存 — 任一满足触发. 触发后查 dedup (同 day 已跑就 skip + 等手动 force).

### 9.4 配置 schema

**`vault/.ctrl/sourcing.yaml`** (默认 seed):

```yaml
version: 1
triggers:
  cron: "0 9 * * *"          # 每天 9am
  count_threshold: 5         # sourcing/ 内 ≥5 条
  manual_command: "/integrate sourcing"
review_queue_path: ".ctrl/review-queue/{date}.md"
default_target_root: "notes/"
preserve_sourcing_originals: false   # accept 后是否保留 sourcing/<id>.md
```

**`vault/.ctrl/daily-notes.yaml`**:

```yaml
version: 1
path_template: "daily/{YYYY}-{MM}-{DD}.md"
template: "templates/daily.md"      # 相对 vault root
frontmatter_default:
  tags: [daily]
  type: journal
auto_create_on_first_write: false   # 用户必须主动 New → Daily
```

**`vault/.ctrl/sourcing-prompt.md`** (用户可改 — vim test):

```markdown
# Sourcing integration prompt (user-editable)

You are integrating items from the user's sourcing inbox into their main vault.

For each item in `vault/sourcing/`:
1. Read the content + any embedded metadata (URL / OCR source / clipboard origin).
2. Classify the type (link / quote / screenshot-text / fleeting-note / draft).
3. Propose a target path under `notes/`, using existing folder conventions you can see in the current vault tree.
4. Propose 3-5 tags based on existing tags in the vault (read via `vault.tags()`).
5. Propose 2-3 backlinks to existing notes that are semantically related (use `vault.search()` + `text.embed`).
6. Write the proposal to `vault/.ctrl/review-queue/<today>.md` as a numbered list with [Accept] [Edit] [Reject] markers.

Conservative defaults: when in doubt, leave classification empty and let the user decide.
```

### 9.5 隐藏目录 (bao ack)

`vault/.ctrl/` 跟 Obsidian `.obsidian/` 一致, **隐藏在 file tree** 但仍可被 `vault_list({ include_hidden: true })` 拉取. Irisy 整理 routine 直接走 kernel API 读, 不依赖 tree visibility.

frontend `L2VaultPanel` tree 显示 filter: 默认隐 `.ctrl/` + `.git/` + 用户可在 settings 切 "Show hidden".

---

## 10 决策 lock (2026-06-01 bao ack)

| # | 决策 | 选项 |
|---|---|---|
| Q1 | Backlinks 位置 | **B** 工作区底部 drawer (collapsible) |
| Q2 | Wiki-link 实现 | **B** cherry-pick kairo MIT extension (Sean Hopkins 2026), 接 vault_list 做 autocomplete + broken-link styling |
| Q3 | 模板系统 | **B** filesystem-driven (`vault/templates/*.md` + `vault/.ctrl/*.yaml`) |
| Q4 | 旧 VaultBrowser shell | **A** 整体废, 拆 L2VaultPanel + workspace vault-md tab + bottom drawer |
| S1 | Sourcing 触发 | **d** 时间(cron 9am) + 数量(≥5) + 手动 三者并存 |
| S2 | Review UI 位置 | **a** workspace 独立 "Sourcing Review" tab |
| S3 | `vault/.ctrl/` 可见性 | **隐藏** (跟 `.obsidian/` 一致) |
| S4 | Daily Note 触发 | **a** 用户主动 New → Daily (不自动建) |
| S5 | 整理 prompt 位置 | **vault/.ctrl/sourcing-prompt.md** (用户可改, vim test) |
| F1 | Daily Note 分层 | **feature 层** — kernel 不知道 "Daily Note" 概念, 走 yaml + Irisy/frontend 拼 |
| F2 | Sourcing 分层 | **feature 层** — kernel 只出 watch/move/list 等 primitive, sourcing routine 是 Irisy 行为 |
| F3 | MCP 暴露 | **统一** — kernel vault.* 全部走 MCP :17873 (ADR-002 §6) |
| F4 | 实施节奏 | **整体一次性 ship** — 不切 Tier/Phase, 单 branch commit-streak, 单 PR squash → main |

---

## 11 完整 kernel 端点清单 (lock)

按 F2/F3 分层后, kernel 提供 18 个 vault command (现 8 + 新 10):

| # | Command | 状态 | 用途 |
|---|---|---|---|
| 1 | `vault_read(path, opts?)` | ✅ 现有 | 读 md+frontmatter |
| 2 | `vault_write(path, body, frontmatter)` | ✅ 现有 | 写 md+frontmatter |
| 3 | `vault_write_image(path, bytes)` | ✅ 现有 | 写图片 attachment |
| 4 | `vault_list({prefix?, include_hidden?, limit?})` | ✅ 现有 (扩 opts) | 列表 |
| 5 | `vault_search(query, limit)` | ✅ 现有 | FTS5 全文 |
| 6 | `vault_delete(path)` | ✅ 现有 | 删除 |
| 7 | `vault_root_path()` | ✅ 现有 | vault 根路径 |
| 8 | `vault_rebuild_index()` | ✅ 现有 | reindex FTS5 + scanners |
| 9 | `vault_backlinks(path)` | ➕ 新 | 反链 (kernel scanner already exists) |
| 10 | `vault_tags()` | ➕ 新 | 全部 tag |
| 11 | `vault_notes_by_tag(tag)` | ➕ 新 | tag → notes |
| 12 | `vault_mentions(text)` | ➕ 新 | unlinked mentions |
| 13 | `vault_orphans()` | ➕ 新 | 无 inbound link 的笔记 |
| 14 | `vault_broken_links()` | ➕ 新 | 指向不存在 note 的 link |
| 15 | `vault_graph_data()` | ➕ 新 | 全图 node+edges (for 图谱 UI) |
| 16 | `vault_rename(from, to)` | ➕ 新 | 改名 + 维持 backlinks |
| 17 | `vault_move(from, to)` | ➕ 新 | 移动 (Sourcing accept 用) |
| 18 | `vault_create_folder(path)` | ➕ 新 | 建子目录 |
| 19 | `vault_set_starred(path, bool)` | ➕ 新 | 元数据 star (frontmatter `starred:`) |
| 20 | `vault_aliases(path)` | ➕ 新 | 读 frontmatter `aliases:` |
| 21 | `vault_watch(prefix?)` → event stream | ➕ 新 | 文件变化推 (sourcing trigger 用) |

不进 kernel (feature 层):
- ~~`vault.create_note(kind="daily")`~~ — Daily Note 是 feature, 走 yaml
- ~~`vault.sourcing_routine()`~~ — Irisy 行为, 不是 kernel API (Irisy 直接读 sourcing/ + 写 review-queue/, 全部通过 1-21 primitive)

**全部 21 个 command 透 MCP** (ADR-002 §6 tools list 从 11 增至 28).

---

## 12 不动 kernel 的 feature 层逻辑 (Irisy + frontend 拼)

| Feature | 实现位置 | 用到的 kernel primitive |
|---|---|---|
| Daily Note 建立 | frontend `lib/vault-conventions.ts` 读 `.ctrl/daily-notes.yaml` → 拼路径 + 读 `templates/daily.md` → `vault_write` | 4, 1, 2 |
| Template picker | frontend `lib/vault-conventions.ts` 扫 `templates/*.md` → dropdown | 4, 1 |
| Sourcing routine | Irisy daily — 读 sourcing/ + index, 写 review-queue/ | 4 (prefix=sourcing/), 1, 2, 10, 12, 9 |
| Sourcing trigger (cron+count+manual) | Irisy schedule + kernel `vault_watch` | 21 |
| Review accept | frontend `SourcingReviewTab` 按钮 → `vault_move` + `vault_write` 注入 frontmatter | 17, 2 |
| Star toggle | frontend button → `vault_set_starred` | 19 |
| Backlinks drawer | frontend `BacklinksDrawer` → `vault_backlinks(currentPath)` | 9 |
| Tag chip | frontend L2 → `vault_tags()` + `vault_notes_by_tag(tag)` | 10, 11 |
| Wiki-link autocomplete | Tiptap extension → `vault_list` (filter by stem match) | 4 |
| Graph view (Tier 3, defer) | React Flow + `vault_graph_data()` | 15 |

---

## 13 实施清单 (整体一次 PR, 不切 phase)

按 bao "整体规划一次性开发":

### Design lock (this turn)
- [x] brainstorm doc append (本节 §9-13)
- [ ] ADR-002 §8 Vault v1 (new section)
- [ ] ADR-002 frontmatter bump v2→v3 + sections + changelog
- [ ] ADR-002 §6 MCP tools list extend (11 → 28)
- [ ] ADR-002 ### Vault (§8) acceptance checklist
- [ ] THIRD_PARTY_LICENSES/kairo-MIT.txt

### Kernel (next turns)
- [ ] vault_index.rs expose scanner APIs (backlinks/tags/mentions/orphans/broken_links/graph_data)
- [ ] commands/vault.rs 加 13 new commands (#9-21)
- [ ] kernel/mcp_server.rs MCP tools 从 11 升 28
- [ ] kernel watcher (notify crate) for vault.watch endpoint
- [ ] commands/mod.rs registry update
- [ ] packages/ctrl-kernel-sdk TS types

### Frontend (next turns)
- [ ] PrimaryRail vault icon
- [ ] components/vault/L2VaultPanel.tsx (replaces tree from VaultBrowser)
- [ ] components/vault/SourcingReviewTab.tsx (workspace tab kind)
- [ ] components/vault/BacklinksDrawer.tsx (workspace 底部 drawer)
- [ ] components/viewers/MarkdownViewer.tsx — port kairo wiki-link Tiptap extension
- [ ] lib/vault-conventions.ts (reads .ctrl/*.yaml)
- [ ] lib/workspace-store tab kinds + 'sourcing-review' + 'vault-md' 已有
- [ ] routes/vault.tsx 删
- [ ] components/vault/VaultBrowser.tsx 删 (按 F4 退旧)
- [ ] components/vault/BacklinksPanel.tsx 删 (O(N) scan 退役, 换 BacklinksDrawer)

### Feature seed (next turns)
- [ ] First-boot seed `vault/.ctrl/{sourcing.yaml, daily-notes.yaml, sourcing-prompt.md}` + `vault/templates/{daily.md, meeting.md}` (kernel vault init code)
- [ ] Irisy sourcing routine wiring (MCP tool + scheduler + kernel cron)
- [ ] platform.notify integration

### Verify + ship
- [ ] cargo build + clippy 双绿
- [ ] tsc --noEmit 双绿
- [ ] manual smoke (L1 vault → L2 → create note → see backlinks drawer → sourcing trigger → review accept)
- [ ] single squash PR → main
