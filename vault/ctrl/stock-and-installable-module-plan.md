# 股票模块 + 可安装功能包方案(2026-06-24 bao × AI 达成)

> ✅ **已并入(2026-06-24 真相源对账)** — 核心决策(股票国内外双形态 Ghostfolio / AkShare+SmartTable + 功能包边界「领域各独立、KB 通用兜底」)**已收进 `[[capability-pack-map]]`(bao 集成清单段)= 功能包真相源**。本文保留作落定 provenance + 细节(Ghostfolio API 端点 / AkShare 字段)。**读功能包 → capability-pack-map**,本文不再独立追。
>
> ~~状态:ACTIVE 方案~~(此前因工具污染未能并入 vault,**对账时已完成并入**)。
> 关系:`master-plan.md` §二·五/§二·六 + `capability-pack-map.md`(已并)+ `smart-table-*` + `endpoint-catalog.md`。

---

## 一、概念边界(bao 2026-06-24 校准)

- 每个领域 = 一个**独立 L1 功能包**,有自己的 workspace。**股票是一个功能包,不是知识库的用例。** 功能包之间平级,不混为一谈。
- 知识库是**通用兜底**功能包:没专门到需要独立功能包的东西(想法 / 笔记 / 资料 / 灵感)待在知识库里;专门的领域(股票 / CRM / 记账)各自独立成功能包。

## 二、知识库功能包的本质

- 本质 = **捕获 → 召回 → 调用(记 / 找 / 用)**。双链 / 标签 / 图谱 / markdown 是**实现手段,不是给用户的功能**。
- 用法 = 对 Irisy 说人话:「记一下…」/「我之前写过啥关于…」/「根据我的笔记帮我…」。全程不碰文件、不碰格式。
- 前端 = **「看内容 + 说话」**;文件树 / markdown / 标签对非技术用户**隐藏**,收进角落留给想手动的人。**不是文件管理器。**
- 现状差距:现在 note 前端是"文件管理器的脸"——这是用户"不会用"的根因。

## 三、股票功能包:国内外各一个(bao 拍板)

### 国外 = Ghostfolio
- 开源 AGPL-3.0,自托管(Docker + PostgreSQL + Redis),REST API:`order` CRUD / `portfolio/details`·`performance`·`positions` / `account` CRUD / `symbol/lookup` 行情 / `import`;两步 JWT auth。
- 角色:软件本身记录 + 分析,CTRL 当它的 AI 前端。

### 国内 = AkShare(数据源)+ CTRL Smart Table(记录)
- 原因:国内**无**"开源 + 自托管 + API"的一体软件(雪球 / 且慢 / 蛋卷皆封闭 SaaS、无开放 API、不能自托管 → 违反数据主权,排除)。开源只剩**数据层**。
- AkShare(MIT;A股 / 港股 / 基金行情 + 财务 + 复权;baostock 备选)。
- 角色:AkShare 只管行情 / 财务(读);持仓 / 复盘用 **CTRL Smart Table**(A股券商 API 封闭,手动 / 导入)。**CTRL 自己就是那个"软件"。**

### 形态差异(关键)
| | 国外 Ghostfolio | 国内 A股 |
|---|---|---|
| 记持仓 | Ghostfolio `order` API | CTRL Smart Table |
| 行情 / 财务 | Ghostfolio 内置(Yahoo 等) | AkShare |
| 分析 | Ghostfolio `performance` API | Irisy 基于 Smart Table + AkShare |
| CTRL 角色 | 软件的 AI 前端 | CTRL 即软件 |
| 许可 | AGPL-3.0(进程外 API 连、用户自托管 → 安全;不分发其代码) | AkShare MIT |

> 这个差异是 CTRL 的卖点:在没有现成软件的市场(国内),用「开源数据 + 自己的表」自己拼一个出来。

## 四、集成机制(两个都是"功能包",走同一条链)

**连接器 / 数据源(MCP)→ Irisy `mcp-creator` 生成(NL → manifest + server.ts,不手写)→ L1 股票 workspace → 意图词浮现。**

- 国外:Ghostfolio 本地 Docker → REST→MCP 连接器;下单 / 改单(write:`POST/PUT/DELETE order`)过 `:17873` gate + review。
- 国内:AkShare 包成本地行情 MCP + CTRL Smart Table 当持仓表 → Irisy 拉数据写表。

## 五、缺口清单(已核过代码)

**共用**:① 功能包打包抽象({连接器 + L1 workspace + 意图词 + skill} + registry)② 股票 L1 workspace ③ 意图浮现(说"持仓 / 我的组合" → 浮现并打开)
**国外特有**:Ghostfolio 连接器(两步 JWT)、写操作 review UX、token 录 Keychain
**国内特有(后续,归 ADR-002,不在本垂直)**:AkShare 行情 MCP、**接通 Smart Table**(断线:`smart_table_query/describe/run_ai_column` 未暴露给 gate;前端 `TableViewer` 未挂载、`lib/kernel.ts` 无 `smartTable*` wrapper)、A股代码 / 复权处理
**现状已有**(核过):`PrimaryRail`(L1 入口)、`packages/ctrl-web/src/personas/irisy/mcp-creator.ts`、`kernel/mcp_host.rs`、`:17873` gate(intent 裁剪 + audit ledger)、`InstallBar`、Keychain。

## 六、落地顺序(2026-06-24 修正:Ghostfolio 单点垂直)

按 ADR-004 §2 A1→A4 把 Ghostfolio 这一条链跑通:
1. **A1** — Irisy `mcp-creator` 生成 Ghostfolio 连接器包(manifest + mcp server + secrets.schema);**dev 加固 flow,不手写连接器**
2. **A2** — 读工具(portfolio/performance)过 gate;写工具(order CRUD)过 review gate(ADR-005)
3. **A3** — 装成 L1 功能包 + 持仓 workspace(ADR-007)
4. **A4** — 卸载干净(MCP 注册 + 投影 skills + secrets 全移除)

链路通了 → 套任何第三方产品(CRM / 飞书 / 国内数据源)都是复制;国内 AkShare 那条届时作为复制案例,归 ADR-002。

## 七、待对齐(环境干净后)

- **master-plan §二·五 B 表补一行**:`股票 | Ghostfolio(海外)/ AkShare+SmartTable(A股)| 自托管 or 数据源经 MCP + 写过 gate`
- 与 `capability-pack-map.md` / `endpoint-catalog.md` / `smart-table-*.md` 对齐去重(本 session 因注入无法可靠读取,留待复核)。
- 是否将本方案立为新 GOAL(当前 GOAL 仍是通讯协议重构)由 bao 定。
