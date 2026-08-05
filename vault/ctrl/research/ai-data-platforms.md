# AI × 数据/业务平台 — 对标研究 (Dify / Coze / ChatBI / Airtable / MCP)

> CTRL 智能表格「Irisy 操作面」的**对标研究事实源**。决策落 `ADR-003 frontend §6.5 (v11)`;本文件只记**别人怎么做的事实**。
> 联网核实 2026-06-19(WebSearch 稳、WebFetch 对静态站可用)。来源附各节。

---

## 1. Dify — LLM 应用平台

- **工具(Tools)三类**:① 内建工具(Google/Slack/Notion/DALL·E…)② 自定义 API 工具(给 OpenAPI/Swagger spec + 认证即接外部)③ workflow-as-tool(把一条工作流封装成可被别处调用的工具)。
- **AI 怎么调工具**:两种推理策略 —— 原生 **function-calling**(模型支持时)/ **ReAct**(不支持时)。流程 = 分析意图 → 选工具 → 带参执行 → 解释结果。
- **连接外部**:API endpoint + 认证层 + 参数映射。
- **关键取舍**:**workflow(可视化、预定义、确定性)与 agent(自主决策)双轨并存**;明确"复杂/要确定性输出的任务用 workflow"。

来源:[Dify Tools 指南](https://dify.ai/blog/mastering-tools-in-dify-a-comprehensive-guide-for-beginners-and-developers) · [Dify Agent node 文档](https://docs.dify.ai/en/guides/workflow/node/agent)

## 2. 扣子 Coze(字节)

- **Plugin**:外部能力经 API 封装成工具;**大模型靠插件的「功能描述 description」语义匹配**决定调不调用。可配自动/强制调用。
- **Workflow**:可视化编排多节点(大模型/代码/知识库/插件节点),支持条件分支、循环,适合稳定可预测的复杂任务。
- **知识库(RAG)**:上传文档/网页 → 切片 + 向量化 → 提问先检索片段再作上下文;支持自动/按需调用。
- **设计哲学**:**「简单任务用对话,复杂任务用工作流」**,两者可结合。

来源:[一文了解 Coze 的 Plugin/Workflow/知识库](https://www.woshipm.com/ai/6149301.html)

## 3. ChatBI / 对话式 BI(NL2SQL + 语义层)

- **直接 NL2SQL 准确率低**,原因:schema 复杂(表多、命名不规范)、术语歧义(「销售额」对哪个字段)、**模型幻觉**(造不存在的表/字段)、业务规则缺失(同比环比难表达)。
- **语义层(Semantic Layer)= 解法核心**:预定义指标(GMV/留存率)固化口径 + 维度建模 + 术语→物理字段映射。**把模型从「开放式生成 SQL」收窄成「受限选择预定义指标」**。
- **Schema 注入**:相关表结构 + 字段业务注释经 RAG 检索注入(不一次灌全量)。
- **防幻觉**:语义层约束 + schema 检索 + SQL 校验 + 执行前预检字段是否存在。

来源:[ChatBI:基于大模型的对话式BI(阿里云)](https://developer.aliyun.com/article/1648882)

## 4. Airtable AI / Notion AI(结构化数据上的 AI 列)

- **配置**:写 prompt 模板 + 用 **`{Field Name}` token 引用其他列** + 选输出类型(文本/单选/多选…)。
- **整列逐行批处理**:每行按本行引用字段生成;引用字段变 → 可自动更新;可一键整列跑。
- **支持操作**:分类、总结、提取、翻译、内容生成。
- **存储**:结果直接落字段,可喂下游字段/自动化。

来源:[Airtable AI 指南](https://www.airtable.com/guides/ai)

## 5. MCP — Resource vs Tool 模式(CTRL gate 的直接对标)

- **Resource**(应用控制、只读、无副作用,类比 GET):暴露文件内容、**数据库 schema**、文档等上下文。
- **Tool**(模型控制、有副作用/带参,类比 POST):增删改、带参查询、调外部系统。
- **结构化数据(表)推荐模式**:**schema 当 Resource(让模型懂数据形状)+ query 当 Tool(参数化、可校验)+ 写操作永远是 Tool(带参数校验)**。
- **工具设计防幻觉(function-calling 可靠性)**:① 用 **enum** 约束取值;② **别用自由字符串**,能结构化就结构化;③ **窄工具面**(少工具、不重叠);④ 清晰命名+描述;⑤ 返回**结构化 JSON + 状态**让模型可复核。

来源:[MCP Resources 文档](https://modelcontextprotocol.io/docs/concepts/resources) · [设计 LLM agent 的 MCP 工具](https://www.leonardomontini.dev/mcp-tools-llm-agents-design) · [OpenAI function-calling 指南](https://platform.openai.com/docs/guides/function-calling)

---

## 综合 → 对 CTRL 的判断(决策见 ADR-003 §6.5)

| 维度 | 标杆共识 | CTRL 设计 | 判断 |
|---|---|---|---|
| AI 获取能力 | tool/plugin + function-calling,靠 description 匹配 | `smart_table.*` gate 工具投影,Hermes 发现 | 方向对;**执行闭环(P2 门控)未通**是真断点 |
| 业务连接 | Dify 自定义 API / Coze 插件(多云托管) | MCP 连接器 + gate proxy,数据留本地 | **CTRL 更优**(开放标准 + 数据主权) |
| 工作流 | Dify/Coze **双轨**,复杂任务必用 workflow | 砍可视化 workflow,压 brain one-shot | **最大争议**:丢了确定性多步流程 → §6.5.6 A/B/C 待拍 |
| AI 列 | Airtable `{field}` token 整列逐行 | `run_ai_column` 同形态 | **被完全印证**,可放心做 |
| 对话查询正确性 | NL2SQL 准确率低,必须**语义层**收窄 | plain-text 表、无 SQL、无语义层 | **CTRL 风险更高** → 必须用 frontmatter schema 当语义层 + 让 Irisy 填 enum 参数而非生成查询 |

**一条主线**:**让 Irisy 填受约束的工具参数,不自由生成查询/逻辑** —— 这是 5 个标杆 + MCP 模式的共同结论,也是 CTRL 在无 SQL 兜底的 plain-text 表上防幻觉的命门。
