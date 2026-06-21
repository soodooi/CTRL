# 智能表格 — 开源横评 + CTRL 现状 + 最佳方案

> bao 2026-06-20:「都评估 给出最佳方案」。本文件 = 5 个对标开源项目横评 × CTRL 现状(15 PR)× 可执行最佳方案(借鉴策略 + 优先级 roadmap)。下载源码全在 `/tmp/ref/`。

---

## 1. 开源项目横向评估(全下载,源码实测)

| 项目 | License | 前端栈 | 数据层 | 能搬代码? | 对 CTRL 的用法 |
|---|---|---|---|---|---|
| **Teable** | AGPL ❌ | React+TS | Postgres | **否**(copyleft 污染) | 设计参考:LinkField/Lookup/Rollup/Visitor(已借鉴) |
| **undb** | AGPL ❌ | TS | SQLite | **否** | 设计参考:SQLite 派生索引(路线 C 灵感) |
| **NocoDB** | AGPL ❌ | Vue | 多 DB | **否** | 设计参考:LinkToAnotherRecord/关系 |
| **Grist** ★ | **Apache 2.0 ✅** | **TS(954 文件)** | Python+SQLite | **能**(保留版权) | **直接借鉴 TS 代码**(统计栏/关联picker/复制粘贴/列冻结) |
| **Baserow** | 客户端 MIT ✅ | Vue | Django/Postgres | 客户端能,但 Vue | 参考(语言不对口,价值低) |
| **glide-data-grid** | **MIT ✅** | React canvas | — | **已直接用** | 网格层(行号/键盘/复制粘贴/列宽/虚拟滚动) |

**横评结论 = 最优组合已锁定**:
- **网格层** = `glide-data-grid`(MIT,已用) — 网格最硬的部分,直接用,不造轮子。
- **交互/统计/picker 代码** = 借 **Grist**(Apache 2.0,同为 TS,合法搬片段)。
- **关系型/数据模型设计** = 参考 **Teable/undb**(AGPL,只学设计不搬码)。
- **公式** = CTRL 自研 JS 引擎(不用 Grist 的 Python — 门槛太高,违背「会用表格就会用」)。

---

## 2. CTRL 现状 vs 飞书 Bitable(15 PR 全 merged)

**已做 ✅**(对上飞书 Bitable 核心):
canvas 网格(行号/键盘/复制粘贴/列宽/虚拟滚动)· 列头字段类型图标 · 彩签/星级/货币/进度 · 多视图(grid/kanban/gallery/calendar)+ 保存 · filter/sort/group + **OR 筛选 + 多级分组** · **关系型(link/Lookup/Rollup)** · **公式(JS 100+ 函数)** · AI 列(同步/异步/自动填充)· 行身份(record id)· 记录详情卡 · 字段增删改 · CSV 导入

**缺 ⬜**:
统计栏 · 复选框选择列 · Form 视图 · Gantt 视图 · 真 widget cell(可点星/拖进度)· Summary 汇总表 · 单元格评论 · Chart/仪表盘 · 路线 C SQLite 索引(规模化)

**不做 ❌**(哲学/定位决定):
Python 公式(门槛,违背低门槛)· ACL 权限(单人模式)· 自动化编辑器(撞「不做清单」,Coze/n8n 已做)· WebSocket 实时同步后端(本地 plain-text)

---

## 3. 最佳方案(可执行 roadmap)

### 阶段 1 — 借 Grist(Apache 2.0)代码,高价值低成本
| 做 | 借鉴 Grist | 价值 |
|---|---|---|
| **底部统计栏**(列 sum/count/avg,延迟增量计算) | `SelectionSummary.ts` | CTRL 缺,飞书有,直接补 |
| **关联选择器升级**(token + autocomplete + 新建记录) | `ReferenceEditor.ts` / `ReferenceListEditor.ts` | CTRL link picker 现在是裸 select,升级到飞书级 |
| **复制粘贴富格式**(TSV/HTML + 类型保留) | `tableUtil.ts` | 跨表/跨应用粘贴 |

### 阶段 2 — 自研补齐(参考设计)
- **真 widget cell**(star 可点 / progress 可拖,glide `drawCell`)
- **复选框选择列 + 批量操作**(glide rowMarkers='checkbox' + 批量删除)
- **Form 视图**(快速录入一条)
- **Summary 汇总表**(参考 Grist summary 概念,按 group 派生统计表)

### 阶段 3 — 大工程
- **Chart / 仪表盘**(只读派生图表 + AI 生成)
- **路线 C:SQLite 派生索引**(关系型/公式规模化,内核,类比 `vault_index.rs` FTS5)
- **Gantt 视图**

### 借鉴策略锁(每次新功能照此)
1. 能用 MIT/Apache 现成的 → 直接用/借(glide MIT · Grist Apache)。
2. 只能看设计的(AGPL Teable/undb/NocoDB)→ 学数据模型/算法,代码自写。
3. 公式坚持 JS 自研(低门槛),不引 Python。

---

## 5. 跟着 Grist 升级的机制(bao 问:以后能跟着 grist 升级吗?)

**能 —— 但要分两层,且 CTRL 不是盲目追 Grist:**

| 层 | 关系 | 跟升级方式 |
|---|---|---|
| **网格底座 = glide-data-grid** | **npm 依赖** | **自动**:`npm update @glideapps/glide-data-grid`,glide 出新版直接升 |
| **Grist** | **借鉴源(非 fork/非依赖)** | **半自动**:Grist 是 Python 后端全栈服务,不能 fork(架构不同)。改为「借鉴溯源 + 定期 diff」 |

**为什么 Grist 不能 fork/依赖**:它是服务(Python 数据引擎 + WebSocket 同步 + 自研网格),CTRL 是 Tauri 桌面 + 本地 markdown + glide 网格 + JS 公式。fork 要把整个后端换掉 = 重写。

**借鉴溯源机制**(每次借 Grist 代码必记,Grist 升级时 diff 这些文件看要不要跟进):

| CTRL 功能 | 借鉴 Grist 文件 | Grist commit | 借了什么 |
|---|---|---|---|
| 底部统计栏 | `app/client/components/SelectionSummary.ts` | a13e9b8 | sum/avg/count/min/max 聚合 + 统计栏概念 |
| (关联picker 升级,待做) | `ReferenceEditor.ts` / `ReferenceListEditor.ts` | a13e9b8 | token + autocomplete + 新建记录 |
| (复制粘贴,待做) | `tableUtil.ts` | a13e9b8 | TSV/HTML 富格式序列化 |

> 代码里也打 `// borrowed from Grist <file> (Apache 2.0)` 注释,双向可溯。

**但 CTRL 有自己的方向**:本地 markdown=truth · Irisy 集成 · :17873 gate · JS 公式低门槛 · AI 列 —— 这些 Grist 没有。我们借 Grist 的**通用表格交互代码**,但产品方向是 CTRL 自己的(AI-native ambient OS),不是追 Grist 功能列表。

---

## 4. 一句话最佳方案

**继续 glide-data-grid(MIT)做网格底座 + 系统性借 Grist(Apache 2.0)的 TS 交互代码补缺(统计栏/关联picker/复制粘贴)+ 自研补视图与 widget + 路线 C SQLite 索引收尾规模化。** 先做**阶段 1**(借 Grist,ROI 最高),从**底部统计栏 + 关联选择器升级**起手。
