# 智能表格极简 UI — 参考 getgrist + 独立文件夹

> bao 2026-06-21 校准:智能表格页面要「**极简 UI + 参考 getgrist 前端**」,且智能表格要有「**单独文件夹,不跟 Obsidian 冲突**」。
> 本文件补上之前缺失的决策(decision vacuum):`smart-table-opensource-eval-and-plan.md` 只定了**代码层**借鉴 Grist(统计栏/picker/复制粘贴),从没定**前端 UI 极简方向**;`079e17c` 只做了 layout 外壳的开头。
> governing ADR = **ADR-003 §6 v20**。事实源 = 本文件。

## 决策

### 1. 极简 UI — 对照 getgrist 的视觉/交互语言

getgrist 的极简 = 白底大留白 · 极细 hairline 网格线 · 扁平图标工具栏 · Sort/Filter/Fields 收进 popover(不平铺)· 控件无常驻边框(hover 才显)。

CTRL 智能表格据此落地(`SmartTableView` + `Viewer.module.css` + `SmartTableGrid`):

- **工具栏只放扁平触发按钮** — Filter / Sort / Group / Fields 从「一行平铺 select/input」收进 **popover**(统一 `openMenu` state),工具栏一行只剩:视图切换 + Search + ⚲Filter ↓Sort ⊞Group ⚙Fields + count。
- **视图切换 = 扁平下划线 tab**(Grist 风格),不是带边框的 segmented box。
- **控件扁平** — 无常驻边框/填充,hover 才显淡背景(`--color-surface-hover`)。
- **网格线 hairline** — glide `DataEditor` theme `borderColor`/`horizontalBorderColor` 调到 `rgba(0,0,0,0.05)` 级。canvas theme 只吃字面色值,不能用 CSS var。
- 功能零损失:8 视图 / filter-sort-group(含 OR + 多级)/ AI 列 / 统计栏 / 类型化单元格 / 所有 testid 全保留。

### 2. 智能表格 = 独立 `tables/` 文件夹(不跟 Obsidian 冲突)

- 智能表格本来就写进 `tables/`(`createSmartTable` / `importCsv`),但 `listSmartTables` 之前扫**整个 vault**,会把用户散落各处的 md 也当表;`listVaultDocs` 更是把**整个 vault 的 Obsidian 笔记**全列进侧栏。
- **修正**:`listSmartTables` 现在只扫 `tables/`。智能表格与 Obsidian 笔记物理隔离在不同文件夹,互不干扰。
- 符合 plain-text 哲学:`tables/` 是 CTRL 给智能表格的 default layout policy;文件仍是普通 markdown(frontmatter schema + pipe table),vim test 通过。

### 3. 侧栏不混 docs(per-L1 模块边界)

- `079e17c` 把侧栏做成 Tables / **Docs** / Templates 三段(照搬 Grist「一个 document 混装 table + page」),但 **Docs 段扫的是整个 vault 的 Obsidian 笔记**。
- CTRL 是 per-L1 模块架构([[project-ctrl-per-l1-workspace-output-routing]] / [[project-ctrl-modular-intent-platform]]):**智能表格**和 **Notes(docs)是两个不同 L1 模块**,docs 不该出现在智能表格侧栏。
- **修正**:删掉 Docs 段(+ `listVaultDocs`),智能表格侧栏只剩 **Tables + Templates**。docs 归 Notes 模块。

## 非目标 / 边界

- 不做 getgrist 的 Python 数据引擎 / WebSocket 同步后端(本地 plain-text;见 opensource-eval)。
- 不把智能表格和 Notes 合并成 Grist 那种「统一 document」——CTRL 模块边界优先于 Grist 模型。
- 代码层借鉴 Grist(统计栏/关联picker/复制粘贴)是另一条线,见 [[smart-table-opensource-eval-and-plan]] 阶段 1。

## 实装(分支 `feat/smart-table-minimal-ui`)

- `SmartTableView.tsx` — 工具栏 popover 化(`openMenu` + `toggleMenu`)。
- `Viewer.module.css` — 扁平控件 + hairline 分隔 + 下划线 tab + `.menuRow`。
- `SmartTableGrid.tsx` — glide theme hairline 网格线。
- `smart-tables.ts` — `listSmartTables` 限定 `tables/`;删 `listVaultDocs`。
- `TablesPanel.tsx` — 删 Docs 段,侧栏 = Tables + Templates。
- 验证:tsc 绿 + vitest 绿 + Playwright 截图前后对照(`/tmp/ctrl-min-A.png` → `ctrl-min-B.png`)。
