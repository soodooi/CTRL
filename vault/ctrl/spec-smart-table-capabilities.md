# 智能表格 — 能力清单 (参考飞书多维表格)

> Workspace module spec. 第一步 = 对标飞书多维表格 (Bitable / Base) 的能力全景,
> 再按 CTRL 哲学 (plain-text / vim-test / one-shot / local-truth / AI-is-pipe) 裁剪 v1 范围。
> bao 钦定 2026-06-19: 「接下来一个工作区页面,智能表格,实现飞书的一些功能,先整理能力清单」。
>
> 这是规划文档,不是实施。落地走 module 哲学 (per-L1 workspace + viewer registry)。
> 真相源约束: ADR-001 spine § byo-cli-driver + ADR-006 cross-cutting § plain-text + 「不做清单」(CLAUDE.md What CTRL is NOT)。

---

## 0. 一句话定位

**飞书多维表格 = 关系型数据库 + 多视图 + 自动化 + 仪表盘的中台。**
**CTRL 智能表格 = 一份 plain-text markdown 表 + frontmatter schema,本地是 truth,AI 经 Irisy 作为 in-line pipe。**

不是要克隆飞书 (那是 Airtable/Coze 赛道,见「不做清单」),而是把飞书**对单人创作者真正有用**的那几样能力,用 plain-text 的方式重做,达到 vim test。差异化不在「功能多」,在「数据是你的 + AI 直接长在表上」。

---

## 1. CTRL 现状 (已实装,基线)

| 能力 | 现状 | 代码 |
|---|---|---|
| 文件格式 | markdown 管道表格 + YAML frontmatter schema (vim test ✅) | `packages/ctrl-web/src/lib/smart-table.ts` |
| 解析/序列化 | `parseSmartTable` / `serializeSmartTable` round-trip 保结构 | 同上 |
| 单元格类型 | `text` `number` `date` `checkbox` `tags` `select` `url` (7 种) | `smart-table.ts:27` `CellType` |
| 列配置 | `key` `label` `type` `options`(select) `min`/`max`(number) | `smart-table.ts:36` `ColumnSpec` |
| 行操作 | `appendRow` / `updateCell` / `deleteRow` (immutable) | `smart-table.ts:264+` |
| 渲染 | TanStack Table,单元格编辑 → 序列化回 markdown | `components/viewers/SmartTableViewer.tsx` |
| 注册 | content-type `text/x-ctrl-smart-table` → lazy viewer | `lib/viewer-registry.ts:127` |
| 布局 hint | PartKind `table` → 响应式比例 | `lib/ui-registry.tsx` |

**基线 = 单表 / 单视图 (grid) / 7 字段类型 / 无筛排分组 / 无关联 / 无自动化 / 无仪表盘。**
约等于飞书的「表格视图 + 基础字段」最小子集。

---

## 2. 飞书多维表格能力全景 (对标参考)

飞书多维表格的能力分 6 大类。下面是清单 (不是承诺要做,是对标的全集)。

### A. 字段类型 (Field types) — 飞书 20+ 种

| 字段 | 飞书 | CTRL 现状 |
|---|---|---|
| 文本 (单行/多行) | ✅ | ✅ text |
| 数字 / 货币 / 百分比 | ✅ | ⚠️ number (无货币/百分比格式) |
| 单选 | ✅ | ✅ select |
| 多选 | ✅ | ⚠️ tags (近似) |
| 日期 / 时间 | ✅ | ✅ date (无时间) |
| 复选框 | ✅ | ✅ checkbox |
| 评分 (星级) | ✅ | ❌ (可 number+渲染) |
| 进度条 | ✅ | ❌ |
| 超链接 (URL) | ✅ | ✅ url |
| 邮箱 / 电话 | ✅ | ❌ (text 近似) |
| 附件 (图片/文件) | ✅ | ❌ (可存 vault 相对路径) |
| 人员 (成员) | ✅ | ❌ (单人 OS,弱需求) |
| 群组 | ✅ | ❌ |
| **关联** (双向链接其他表) | ✅ | ❌ ← 关系型核心,plain-text 张力大 |
| **查找引用** (Lookup) | ✅ | ❌ ← 依赖关联 |
| **汇总** (Rollup) | ✅ | ❌ ← 依赖关联 |
| **公式** (Formula) | ✅ | ❌ ← 计算引擎 |
| 自动编号 | ✅ | ❌ |
| 创建时间 / 修改时间 | ✅ | ❌ |
| 创建人 / 修改人 | ✅ | ❌ (单人弱需求) |
| 地理位置 | ✅ | ❌ |
| 按钮 (触发自动化) | ✅ | ❌ ← 违反 one-shot |
| **AI 字段** (提取/分类/总结/翻译/生成) | ✅ | ❌ ← **CTRL 差异化主战场** |

### B. 视图类型 (Views) — 同一数据多视图

| 视图 | 飞书 | 说明 |
|---|---|---|
| 表格 (Grid) | ✅ | CTRL 现状唯一视图 |
| 看板 (Kanban) | ✅ | 按单选字段分列 |
| 画廊 (Gallery) | ✅ | 卡片 |
| 甘特 (Gantt) | ✅ | 时间线/项目 |
| 日历 (Calendar) | ✅ | 按日期字段 |
| 表单 (Form) | ✅ | 收集录入 |

### C. 数据操作 (View controls)

| 能力 | 飞书 |
|---|---|
| 排序 (多列) | ✅ |
| 筛选 (多条件 AND/OR) | ✅ |
| 分组 (Grouping) | ✅ |
| 隐藏字段 | ✅ |
| 冻结列 | ✅ |
| 行高 / 列宽 | ✅ |
| 全表搜索 | ✅ |

### D. 记录详情 / 协作

| 能力 | 飞书 |
|---|---|
| 记录卡片 (行展开成详情卡) | ✅ |
| 评论 / @提及 | ✅ |
| 编辑历史 / 变更记录 | ✅ |
| 实时协同编辑 | ✅ |
| 权限 (表/字段/记录级) | ✅ |

### E. 自动化 / 智能

| 能力 | 飞书 |
|---|---|
| 自动化流程 (触发器+动作) | ✅ ← **违反 CTRL 不做清单 (workflow editor)** |
| 仪表盘 (统计图表) | ✅ |
| AI 问数据 (自然语言查询) | ✅ ← **CTRL 差异化** |
| AI 字段批量处理 | ✅ ← **CTRL 差异化** |
| 公式引擎 | ✅ |

### F. 导入 / 导出 / 集成

| 能力 | 飞书 |
|---|---|
| 导入 Excel / CSV | ✅ |
| 导出 Excel / CSV | ✅ |
| Open API | ✅ |
| 嵌入 / 分享链接 | ✅ |
| 模板库 | ✅ |

---

## 3. CTRL 哲学约束 → 取舍判据

每条飞书能力过 4 道哲学闸,决定做不做、怎么做:

1. **vim test** (ADR-006 § plain-text): 用户用 vim 打开本机文件,能拿到核心价值吗?
   → 表格数据必须是 plain markdown,任何结构都要 round-trip 回 `.md`。
   → **关系型 (关联/Lookup/Rollup) 在单文件 plain-text 下是硬张力** → v1 用「跨文件 `[[wikilink]]` 引用 + vault backlink」近似,不建数据库外键。
2. **one-shot, not flows** (CLAUDE.md #4 + 不做清单): 无 wizard / 无 multi-step / 无 dialog tree。
   → **飞书「自动化流程编辑器」直接出局** (Coze/n8n 已做)。「按钮字段」同理出局。
3. **local 是 truth,云是 mirror**: 实时协同 = Automerge CRDT,是 ADR-002 v1.1+ scope。
   → **实时多人协同、评论、权限推到 v1.1+**,v1 单人本地编辑。
4. **AI 是 pipe,经 Irisy + `:17873` gate**: AI 默认 in-line 处理,可关默认开。
   → **AI 字段 / AI 问数据 = CTRL 主战场**,且天然经现有 Irisy/gate,不需新基建。

---

## 4. 能力对标矩阵 + v1 取舍

> 取舍列: **v1** = 首版做 / **v1.x** = 推后 / **NO** = 违反哲学不做 / **derive** = 用 CTRL 既有机制近似

| # | 飞书能力 | CTRL 取舍 | 落地方式 (plain-text) |
|---|---|---|---|
| C1 | 7 基础字段类型 | **v1 (已有)** | 现状基线 |
| C2 | 评分/进度/货币/百分比 | **v1** | number 子类型,frontmatter `format:` 字段,渲染层处理,存仍是数字 |
| C3 | 多选 (区别于 tags) | **v1** | tags 已近似;加 `multiselect` + options 约束 |
| C4 | 邮箱/电话/附件路径 | **v1** | text 子类型 + 渲染 (mailto/tel/vault 相对路径链接) |
| C5 | 排序 (多列) | **v1** | 视图态,不改文件;或写回 frontmatter `view.sort` |
| C6 | 筛选 (多条件) | **v1** | 视图态;frontmatter `view.filter` 持久化 |
| C7 | 分组 | **v1** | 按 select/checkbox 字段折叠分组 (视图态) |
| C8 | 隐藏字段/列宽/冻结 | **v1** | frontmatter `view.*` 持久化 (plain-text 可读) |
| C9 | 全表搜索 | **v1** | 复用 vault FTS5 或本地 filter |
| C10 | 记录卡片 (行→详情) | **v1** | 行展开 panel,复用 SmartTableViewer |
| C11 | 看板视图 (Kanban) | **v1** | 按单选字段分列,同一 `.md` 派生;拖拽 = 改该字段值 |
| C12 | 画廊视图 (Gallery) | **v1.x** | 卡片渲染,低优先 |
| C13 | 日历视图 | **v1.x** | 按 date 字段 |
| C14 | 甘特视图 | **v1.x** | 需 start/end 字段 |
| C15 | 表单视图 (录入) | **v1.x** | one-shot 录入面 (不是流程,合规) |
| C16 | **AI 字段** (提取/分类/总结/翻译) | **v1 ★** | 整列经 Irisy 批处理,结果写回 markdown 单元格;差异化核心 |
| C17 | **AI 问数据** (自然语言→筛选/统计) | **v1 ★** | Irisy in-line:自然语言 → 生成 view filter/sort,经 gate |
| C18 | 公式字段 (Formula) | **v1.x** | 受限纯函数子集 (无副作用),计算值不落盘或落盘标记 derived |
| C19 | 关联 (双向链表) | **derive → v1.x** | v1 用 `[[wikilink]]` + vault backlink 近似;真双向外键 v1.x 评估 |
| C20 | Lookup / Rollup | **v1.x** | 依赖 C19 关联落地后 |
| C21 | 自动编号/创建时间/修改时间 | **v1.x** | 需写时元数据 hook,谨慎 (改文件 = 改 mtime 语义) |
| C22 | 仪表盘 (图表) | **v1.x** | 复用 vault 渲染栈;只读派生视图 |
| C23 | 导入 CSV/Excel | **v1** | CSV→smart-table 转换,低成本高价值 |
| C24 | 导出 CSV/Excel | **v1** | smart-table→CSV;markdown 本身已是导出 |
| C25 | 模板库 | **v1.x** | 几个种子 `.md` 模板 |
| C26 | 自动化流程编辑器 | **NO** | 违反 one-shot + 不做清单 (workflow editor = Coze/n8n) |
| C27 | 按钮字段 (触发自动化) | **NO** | 同 C26 |
| C28 | 实时协同/评论/权限 | **v1.x** | ADR-002 Automerge CRDT scope (v1.1+) |
| C29 | Open API / 嵌入分享 | **v1.x** | 经 `:17873` gate 暴露,后续 |

---

## 5. v1 范围建议 (MVP 边界)

**v1 做的 (一份 plain-text 表 + 多视图 + AI 长在表上):**
- 字段: 7 基础 + number 子格式 (评分/进度/货币/百分比) + 多选 + 邮箱/电话/附件路径 (C1–C4)
- 视图操作: 排序 / 筛选 / 分组 / 隐藏列 / 搜索,视图态持久化进 frontmatter `view.*` (C5–C9)
- 视图: 表格 (现状) + 看板 (C11) + 记录卡片 (C10)
- **AI: 整列 AI 字段批处理 (C16) + AI 问数据生成筛选 (C17)** ← 差异化招牌
- 互通: CSV 导入/导出 (C23/C24)

**v1 不做 (但清单留好,不是删):** 画廊/日历/甘特/表单视图、公式、关联/Lookup/Rollup、仪表盘、自动编号、模板库、API、协同 (全部 v1.x)。

**永不做:** 自动化流程编辑器 (C26)、按钮触发器 (C27) — 违反 one-shot + 不做清单。

---

## 6. 核心设计张力 (待 bao 拍 / 系统设计先行)

> 「先有统管全局的规划再实施」(bao 2026-06-13)。动代码前这几个张力要先定。

1. **关系型 vs plain-text**: 飞书的灵魂是「关联+Lookup+Rollup」的关系网络。CTRL 单文件 markdown 装不下外键。
   → **建议**: v1 不追关系型,用 `[[wikilink]]` + vault backlink 做「软关联」(符合 vault 哲学);真关系型留 v1.x 单开设计。**这是 CTRL 与飞书最大的取向分叉,需 bao 确认接受。**
2. **视图态存哪**: 排序/筛选/分组是「视图」不是「数据」。存进同一 `.md` frontmatter `view.*`?还是独立 `.view` 文件?
   → **建议**: frontmatter `view.*`,保持单文件 vim test;一份数据一个 default 视图,多视图 v1.x。
3. **AI 字段结果落盘语义**: AI 生成的单元格值要不要落 markdown?落了就是 truth,不落每次重算。
   → **建议**: 落盘 + frontmatter 标记 `derived: [colKey]`,用户可见可手改 (符合 transparency by drill-down)。
4. **模块归属**: 智能表格是独立 L1 module 还是 vault viewer 的增强?
   → **建议**: 它本质是 vault 的一个 content-type viewer (已注册),不是新 L1;但需要一个「表格工作区」L1 入口来 新建/浏览/AI 操作 多张表。即 **viewer 已有,缺 workspace 外壳 + AI 接线**。

---

## 7. 落地下一步 (本文档之后)

1. bao 拍板 §6 的 4 个张力 (尤其 #1 关系型取向)。
2. 按 module 哲学定 v1 范围最小切片 (建议: number 子格式 + 筛排分组 + 看板 + AI 字段批处理)。
3. 走 dev-loop 实施,从扩 `smart-table.ts` schema (子格式/多选/view.*) 起,不碰 Irisy 测试目标区。
4. ADR: 智能表格若引入新 content-type 语义或跨文件关联,需在相关 module ADR amend (不开新 ADR,PROCESS.md §1)。

---

## 附: 与「不做清单」的对账

| 不做清单条目 | 智能表格是否触碰 | 结论 |
|---|---|---|
| Workflow editor (Coze/n8n) | C26/C27 自动化流程 | **不做,已排除** |
| 100+ 长尾 adapter | 导入仅 CSV/Excel 标准格式 | 不触碰 |
| 多 tenant SaaS | 本地单人,vault 文件 | 不触碰 |

智能表格作为 workspace module **不违反不做清单** (前提是排除 C26/C27 自动化)。
