# 智能表格 — 对标规划图 (governing truth)

> bao 2026-06-21:「你不要一个一个,我看不清楚,整体架构想清楚没有?对标哪个产品?做到一模一样还是有哪些差距?现在进度如何?」
> 本文件 = 智能表格对标的**唯一整体规划图**。所有局部实施对齐它 (设计哲学「系统设计先行」)。不再逐块试错。

---

## 1. 对标哪个产品 (定位, bao 钦定 2026-06-21)

**主对标 = Grist (getgrist.com)** —— 开源关系型电子表格/低代码数据库。先做到**功能一致**。
**叠加 = 飞书多维表格 (Bitable) 的 AI 智能表格能力** —— Grist 一致之后再叠加 (AI 列已有基础)。

为什么是 Grist 不是飞书: Grist 开源、本地优先、`.grist` = SQLite 单文件,跟 CTRL「本地是 truth」最近;飞书是云 SaaS。Grist 的关系型/公式/Summary 模型是「真·数据库」范式,飞书在它之上加了 AI 层和更花的 UI。

---

## 2. 目标边界 — 哪些「一模一样」, 哪些「必然有差距」

不是所有东西都能/都该「一模一样」。三类:

### A. 能做到一模一样 (纯前端 + 单表能力, plain-text 撑得住)
布局 (三栏 shell)、视图类型、列类型 (单表)、查询 (filter/sort/group/search)、Creator Panel 配置、单行公式、条件格式、网格交互 (列宽/行高/键盘/复制粘贴)。**目标 = 视觉与交互对齐 Grist。**

### B. Grist 关系型灵魂 (纯 markdown 做不到) —— ✅ 路线已锁定 = 第三条路 (SQLite 派生索引)
Grist 区别于普通表格的灵魂 = **关系型 (Reference 关联 / 跨表公式 / Summary tables 作数据源 / Linked widgets 联动)**。调研结论 (`feishu-bitable-parity-assessment.md §0`): 纯 markdown 下,关联查询 = 遍历文件树 O(n²) I/O,无事务保双向同步,数万行不可用。

**决策 (bao 2026-06-21 reconfirm; 早在 ADR-002 §14 v30 / 2026-06-20 已锁定): 走第三条路 — SQLite 派生索引。**
- **markdown 仍是 truth** (schema + 数据 + 关联都存 markdown, vim 可读, 守 plain-text 哲学不变)。
- **SQLite 作派生索引**, 从 markdown 重建 —— 类比现有 `vault_index.rs` (FTS5) + `vault_embeddings.rs` (SQLite) 的同款模式。
- 关系型 / Lookup / Rollup / 跨表公式 / 大规模 `query` **走索引算**, 结果**写回 markdown**。
- §14 `query` 引擎获得 **SQLite 索引后端** (RecordSource 可选 index-backed); markdown round-trip 不变; :17873 gate 数据契约不变。
- **守哲学又能真对标**: vim test 守住 (truth 在 md), 同时拿到真·关系型 + 数万行。
- 零 ADR churn: 该路线已是 ADR-002 §14 v30 既有决策, 本次只是 reconfirm + 落地。关系型字段是 v30 写明的「待后续切片」。
- 开源: glide-data-grid (MIT) 直接用 (已接线); Teable/undb (AGPL) 只参考关系型/Lookup/公式/Visitor 设计, 不搬码。

### C. 明确不做 (non-goal, 单人模式 / 撞不做清单)
Access rules 行列权限、多人实时协同/评论、可视化 workflow 自动化编辑器。

---

## 3. 完整功能地图 × 进度 (现状盘点, 真实代码 + /table-lab 视觉验证)

图例: ✅ 完成 · 🟡 部分 · ⬜ 未做 · ⛔ non-goal

### 3.1 布局 / Shell (Grist 三栏: 左页面列表 | 中 grid | 右 Creator Panel)
| 项 | 状态 | 说明 |
|---|---|---|
| 左:表/页面列表 | ✅ | `TablesPanel` (表列表 + 模板) |
| 中:grid 画布 | ✅ | glide-data-grid (canvas, 虚拟滚动) |
| 右:Creator Panel | 🟡 | **本轮新增** — 只有 Column tab;缺 Widget/Table tab |
| 一页多 widget | ⬜ | Grist 核心,见 §3.8 linked widgets |

### 3.2 视图类型
| Grist widget | CTRL | 状态 |
|---|---|---|
| Table (grid) | Grid | ✅ |
| Card (单记录详情) | Record Card | ✅ |
| Card List | Gallery (近似) | 🟡 |
| Chart | Chart (bar/pie/line) | 🟡 Grist 还有 area/scatter |
| Calendar | Calendar | ✅ |
| Form | Form | ✅ |
| Custom (iframe) | viewer registry | ⬜ |
| (CTRL 额外) | Kanban / Timeline·Gantt / Summary | ✅ 超出 Grist |

### 3.3 列类型 (Grist 12 种)
| Grist | CTRL | 状态 |
|---|---|---|
| Text / Numeric / Toggle / Date / Choice / Choice List | text / number / checkbox / date / select / tags | ✅ |
| Integer | (用 number) | 🟡 无整数约束 |
| DateTime | date | ⬜ 无时间精度 |
| Reference / Reference List | link (单/多) | 🟡 软链,见 §2.B |
| Attachment | attachment | 🟡 类型在,渲染待验 |
| Any | — | ⬜ |
| (CTRL 额外) | currency/rating/progress/percent/duration/email/phone/url/auto_number/created_at/modified_at/user/formula/lookup/rollup | ✅ 超集 |

### 3.4 查询
| 项 | 状态 |
|---|---|
| Filter 多条件 AND/OR | ✅ |
| Sort | 🟡 单列 (Grist 多列 tie-break) |
| Group 多级 | ✅ (2 级) |
| 全表搜索 | ✅ |
| Linked filtering (跨 widget 联动) | ⬜ §3.8 |

### 3.5 公式 / 计算
| Grist | CTRL | 状态 |
|---|---|---|
| Formula 列 (Python) | formula (JS 表达式 + 函数) | 🟡 非 Python,单行可 |
| Trigger formula (建/改时写值) | created_at/modified_at 自动填 | 🟡 部分 |
| `$Ref.Field` 解引用 / 链式 | lookup/rollup 客户端算 | 🟡 软链版 |
| Summary 聚合 (`$group`) | Summary 视图 | 🟡 是视图非数据源 |

### 3.6 Creator Panel (Grist: Widget tab + Column tab)
| 项 | 状态 |
|---|---|
| Column tab (类型/标签/选项/条件格式/AI) | ✅ 本轮 (复用 `SmartTableFieldEditor`) |
| Widget/Table tab (Sort & Filter / Fields 可见性·冻结·密度 / Data) | ⬜ 仍散在查询栏弹出菜单 |
| 面板内竖向排版打磨 | 🟡 现横向 flex-wrap 在窄面板偏挤 |

### 3.7 网格交互
| 项 | 状态 |
|---|---|
| 列宽拖拽 / 列重排 / 键盘导航 / 框选 / 复制粘贴 | ✅ glide 原生 |
| 冻结列 | ✅ 冻结首列 |
| 行密度 | ✅ compact/cozy/comfortable |
| 自由行高 / 文本换行 | ⬜ |
| 底部占位行直接加行 (Grist 范式) | 🟡 用 +Row 按钮 |

### 3.8 关系型灵魂 (§2.B 决定能做到多少)
| 项 | 状态 |
|---|---|
| Reference (display column + 下拉选关联) | 🟡 软链 picker |
| Lookup / Rollup | 🟡 客户端算 (route A) |
| Summary tables 作数据源 | ⬜ |
| Linked widgets / "Select By" | ⬜ |
| 跨表公式 / 条件聚合 | ⬜ (纯 markdown 难) |

### 3.9 其他
| 项 | 状态 |
|---|---|
| 条件格式 (cell rule) | ✅ |
| 条件格式 (row rule) | ⬜ |
| 导入 CSV | ✅ |
| 导入 Excel/JSON/Google | ⬜ |
| 导出 (文件本就是 plain-text) | ✅ 天然 + 🟡 per-table CSV/XLSX 下载待做 |
| API (gate :17873 = MCP API) | ✅ |
| Webhook / Automation | ⬜ |
| Access rules (行列权限) | ⛔ non-goal |

### 3.10 飞书 Bitable AI 层 (Grist 一致后叠加)
| 项 | 状态 |
|---|---|
| AI 列 (classify/extract/summarize/translate/generate) | ✅ 已有 (经 gate, 成本门控, 自动填充) |
| AI 问数 / AI 一键生成仪表盘 | ⬜ (Irisy + gate) |

---

## 4. 总进度

- **A 类 (能一模一样的前端能力)**: ~70% —— 视图/列类型/查询/网格/Creator Panel 骨架基本在,差 Widget tab、DateTime、行高换行、面板排版、多列 sort。
- **B 类 (关系型灵魂)**: ~30% (route A 软链版) —— 卡在 route A/B 决策;不决策就只能停在「像」。
- **C 类 (non-goal)**: 不做。
- **飞书 AI 层**: AI 列 ✅,问数/仪表盘 ⬜。

**一句话**: 前端骨架对齐 Grist 已过半;**剩下最硬的是关系型灵魂,它卡在一个 bao 必须先拍的决策 (路线 A 软链 vs 路线 B SQLite 索引)**。这个决策定了「一模一样」能到哪一步。

---

## 5. 推进顺序 (路线已锁, 直接铺开 — 两条并行轨)

§2.B 路线已锁 (第三条/SQLite 派生索引), 不再有 governing 决策卡点。两条轨并行:

**轨 1 — A 类前端打磨 (不碰数据层, 可立即全做)**: 目标 = grid 体验/外观与 Grist 一模一样。
- Creator Panel 加 Widget/Table tab (收编 filter/sort/group/fields 弹出菜单) + 面板内字段编辑器竖向排版。
- DateTime / Integer 列类型。
- 多列 sort (tie-break)。
- 自由行高 / 文本换行。
- 底部占位行直接加行 (Grist 范式)。
- Chart 补 area/scatter; row-rule 条件格式。

**轨 2 — B 类关系型 (走 SQLite 派生索引, kernel 工作, ADR-002 §14 v30)**:
- kernel: smart-table SQLite 派生索引 (从 markdown 重建, 仿 `vault_index.rs`), RecordSource index-backed。
- Reference (display column + 索引驱动下拉) → Lookup / Rollup 走索引 → 跨表公式 / 条件聚合。
- Summary tables 作数据源 + Linked widgets / "Select By" 联动。
- 写回 markdown round-trip 保持 truth。

**轨 3 — 飞书 AI 层 (A/B 成型后叠加)**: AI 问数 / AI 一键生成仪表盘 (Irisy + gate; AI 列已有)。

> 已落地: 增量 1 = Creator Panel 三栏布局 (commit `66ca041`, 分支 `feat/smart-table-grist-parity`)。
> 推进方式 (bao 2026-06-21「不要一个一个」): 按**整轨/成型的块**推进 + 验证后一起给, 不逐微步打断。
