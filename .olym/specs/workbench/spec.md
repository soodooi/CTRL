# Workbench (工作台) — Build Brief

> 给另一个 zeus 开发用。bao 2026-05-28 全网调研后定稿的技术选型 + 架构。
> 模型来源: memory `decision_keycap_workbench_composition_model` + `decision_ctrl_lean_substrate_scheduler_executor_tools`。
> 本 brief 只定**怎么做**;键帽"所有组成"清单 + I/O schema 词表是**增量**的,边做键帽边补。

---

## 0. 一句话

工作台 = 用户把 **ctrl skill 配成键帽**、再把**多个键帽连成系统**(如简单 ERP)的可视化拼装台。
旁边常驻 **Irisy 对话框** + **组件选择器**。执行权**永远留在 CTRL 自己的执行器/MCP**,工作台只负责**画图 + 校验**。

---

## 1. 技术选型 (已调研, locked)

| 用途 | 选 | 版本 | License | gzip | 为何 |
|---|---|---|---|---|---|
| 节点连线画布 (Op3 组合) | **React Flow** `@xyflow/react` | 12.10.2 | **MIT** | ~56.6 KB | React 原生; 自定义节点 = 直接渲染真实键帽组件; `isValidConnection` 校验; lazy-load 进单路由; Stripe/Typeform/Flowise/Langflow 在用 |
| 调色板拖放 (Op1 Pool→键盘) | **dnd-kit** `@dnd-kit/core` + `/sortable` | 6.3.1 / 10.0.0 | **MIT** | ~19 KB | palette→grid + 重排 + 键盘 a11y + DragOverlay 开箱即用。**钉死 v6/v10, 不用 `next`** |
| I/O 端口类型 | **JSON Schema** | — | — | — | 跨语言事实标准; MCP tool I/O 本就用它([[decision_keycap_protocol_is_mcp]]); 现有 Zod 可互转 |

**禁用 (license/架构不合)**:
- ComfyUI / litegraph.js = **GPL-3.0**,n8n = **fair-code**,均与 CTRL `UNLICENSED` 冲突 → 不碰。
- **不采用任何库自带的 dataflow 执行引擎**(Flowise/Langflow/n8n/ComfyUI/Dify 都把执行绑死在自家 runtime)。React Flow **只当画布**,节点→键帽调用走 CTRL executor。

bundle: React Flow + dnd-kit ≈ 76 KB gzip,**全部 lazy-load 进 `/workbench` 路由**,不进关键路径(PWA ≤500KB / critical ≤200KB 约束不破)。

---

## 2. 单键帽的 3 个操作 (bao 定义)

1. **Pool → 键盘区拖放** = 装上键盘。**dnd-kit**;落点写绑定 → 调现有 `install_keycap`(`src-tauri/src/commands/kernel.rs`)写 `~/.ctrl/keycaps/<id>/manifest.json`。**无连线**。
2. **点击键帽 → 进该键帽自己的工作区**(每个键帽有自己的 workspace,复用现有 `routes/workspace.tsx` + viewer registry `lib/viewer-registry.ts`)。
3. **拖键帽 → 新建工作区 → 跟其他键帽连成系统**。**React Flow** 画布;这是连线/拼装发生的地方。

---

## 3. 数据模型

### 键帽节点 (React Flow custom node)
- node 渲染**真实键帽卡片组件**(视觉统一,不是默认方块)。
- 每个 input/output = 一个 `<Handle>`,handle `id` 里**编码端口的 JSON Schema(或 schema 的 ref/hash)** —— 学 Langflow "type-in-handle",这样**连线时即可拒绝**不兼容的线,不必等执行。

### 连线校验 (CTRL 的差异化)
- 在 `isValidConnection(connection)` 里做 **JSON Schema 结构兼容检查**(source.output schema 是否是 target.input schema 的结构子类型)。
- 调研结论: **没有一个现有工具做到 schema 级校验**(Flowise/ComfyUI 只字符串类型,Rete `isCompatibleWith` 只是类型名比对)。CTRL 用 JSON Schema 结构兼容 = 真正的正确性保障(ERP 类组合不出错)。
- 学 Rete 的**连线时即查**心智模型,把它的字符串类型换成 JSON Schema。
- 学 n8n: **数据边 vs 能力绑定边分两类 lane**(数据流 ≠ "挂个模型/工具"那种附着边),别混。

### 图持久化 (两份 JSON, 学 ComfyUI)
- **UI 图**(坐标/外观)= plain JSON,vim 能读(对 plain-text 哲学,见 [[decision_ctrl_obsidian_philosophy]])。
- **执行 IR**(干净的可执行图)= 从 UI 图派生。
- 工作区落盘到 vault 的 markdown+JSON frontmatter,不进私有 store。

---

## 4. Dataflow / 执行 (CTRL 自己拥有一个薄 orchestrator)

**澄清: 不是没有 dataflow —— 是不借第三方引擎,CTRL 自己有一个薄的。** 没有编排,工作区就没法把多键帽连成系统。

- **避免的**: n8n / Langflow / Rete **自带的执行引擎** —— 它们把节点模型 + 持久化 + runtime 绑死在一起,而且**根本不会跑 CTRL 键帽**(键帽走 MCP / subprocess,不是它们的 node 类型,塞不进去)。
- **要建的**: 一个 **薄 orchestrator**,跑在现有执行器(subprocess + mcp_host + 沙箱,见 [[decision_ctrl_lean_substrate_scheduler_executor_tools]])之上。

**工作区运行流程**:
1. React Flow = **设计期**图编辑(连线 + `isValidConnection` 做 JSON Schema 兼容校验)。
2. 图编译成 **执行 IR**(§3 的干净 JSON,与 UI 图分离)。
3. orchestrator **拓扑遍历 IR**: 每节点 → 调对应键帽(executor)→ 拿 output → 按边路由给下游 input,**每跳 JSON Schema 校验**;无依赖的节点可并行。
4. 失败处理: 单节点失败 → 该分支停 + 错误回填到该节点(不静默吞,见全局 error-handling 规约)。

与 lean 模型一致: **executor 跑工具,orchestrator 走图**。这是一块**真实要写的薄组件**,不是免费的 —— 但它薄(读图 + 拓扑 + 调 executor + 路由 I/O),不是 n8n 那种重型引擎。

> 注意: orchestrator = 真正落地"多键帽拼系统",它本质就是 flow runtime,放大了 §8 的 "one-shot / 非 workflow editor" 战略张力。bao 确认有意演进后写 ADR。

---

## 4b. 外部工作流引擎作为单键帽 (n8n / Zapier / Make 等)

**模式: 不把外部引擎嵌进 CTRL,而是调用用户自己的外部实例,执行留在那头,CTRL 把整条工作流包成一个键帽。** (已核实, 2026-05-28)

两条干净路径:
1. **MCP 路径(最契合)**: n8n 工作流挂 **MCP Server Trigger** 节点 → 工作流以 MCP tool 暴露在一个 URL → CTRL 当 **mcp-source 键帽**消费,复用现有 `install_keycap_from_mcp`(`src-tauri/src/commands/kernel.rs`)。其 `inputSchema` 本就是 **JSON Schema**,直接接 §3 的 I/O 规范。
2. **Webhook 路径(最通用)**: 工作流以 Webhook 节点起头 → HTTP 端点 → 键帽 = HTTP POST 到该 URL(kernel MCP server 已有 `http POST`)。任何 n8n(云/自托管)都行。

**与 §1/§4 "禁用 n8n 引擎" 不冲突**: 那条指**别把 n8n runtime 嵌进 CTRL**(fair-code + 跑不了 CTRL 键帽);这里是**调用用户自己的外部 n8n**,无 license 问题、无引擎嵌入。

**架构红利**: 一个复杂多步工作流 → **包成单个键帽**,按下 = 一次黑盒调用 → 结果。所以 **CTRL 不必自建 workflow editor 也能用上 flow** —— 把流程外包给 n8n,CTRL 这头仍是 **one-shot 键帽**。同一模式适用任何暴露 MCP/webhook 的外部自动化引擎(Zapier / Make / Pipedream…)。

**前提/配置**: 用户得有在跑的 n8n 实例;键帽存 URL + token(token 进 **Keychain**,config 档,见 [[decision_keycap_3_tier_adjustment]])。

> 这给"组合"两条腿: **CTRL 自建 orchestrator**(§4,多键帽在工作区里连)+ **外包给外部引擎**(本节,整条流压成一个键帽)。两者并存,按复杂度/用户已有工具选。

Sources: [n8n MCP Server Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger/) · [n8n MCP server 使用](https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/) · [Custom n8n Workflow Tool / MCP tools 参考](https://docs.n8n.io/advanced-ai/mcp/mcp_tools_reference/)

---

## 5. Irisy 副驾 (工作台内)

- Irisy 侧边对话框常驻。学 Langflow Assistant / Flowise Prompt-Engineer:**LLM 输出结构化 graph-patch 工具调用**(`add-node` / `wire` / `set-prop`),**不是散文**。
- 每个 patch **先过 schema 校验再 apply**,画布始终是 source of truth。
- 走现有 MCP 路线: kernel 已作 MCP server([[decision_kernel_is_mcp_server_for_irisy]]),工作台操作包装成 MCP tools,Irisy `tools/list`+`call` 即可改图。

---

## 6. 现有代码复用点 (verify 过)

| 要做的 | 复用现有 |
|---|---|
| 写键帽绑定 | `install_keycap` / `install_keycap_from_mcp` (`src-tauri/src/commands/kernel.rs`) |
| 列已装键帽 | `list_keycaps`(扫 `~/.ctrl/keycaps/*/manifest.json` → `KeycapSummary`) |
| 键帽存储 | `~/.ctrl/keycaps/<id>/`(SKILL.md = 工具本体,manifest.json = 键帽绑定) |
| 工作区渲染 | `routes/workspace.tsx` + `lib/viewer-registry.ts`(content-type viewer registry) |
| Pool 浏览 | `routes/pool.tsx`(注意: 它现在搜索只过滤**已装**键帽,全球发现是另一步,见 §8) |
| 状态 | Zustand(已装)+ TanStack Query(已装) |
| 新路由 | 仿 `app.tsx` 里 `createRoute` 模式,新增 `/workbench`(lazy) |

**现状**: 无 workbench 路由;React Flow / dnd-kit **都未安装**(`packages/ctrl-web/package.json` 已确认)。现有创建面 = Irisy `CreatorShell`(对话式生成 manifest)——bao 倾向**新工作台取代它**(管线是"用户在工作台操作",不是跟 AI 聊出 JSON)。

---

## 7. 不要做 (anti-pattern)

- ❌ 手写/塞 manifest.json 替用户完成创建(那是 dev 作弊,不是系统)——系统让**用户**在工作台操作。
- ❌ 采用任何库的 dataflow 引擎。
- ❌ GPL / fair-code 依赖(ComfyUI/litegraph/n8n)。
- ❌ 字符串类型端口——用 JSON Schema 结构兼容。
- ❌ 把单键帽变成多步 flow:**单键帽仍 one-shot**;组合是新增上层。

---

## 8. 增量 / 待定 (边做边补)

- **键帽"所有组成"清单**: 不预先定死,逐个键帽做的过程中发现,回填 memory `decision_keycap_workbench_composition_model`。
- **I/O JSON Schema 词表**: 增量建(clipboard / text / file / table / image…),按引用传二进制/流(handle/URI),不内联。
- **全球 skill 发现 (Pool 上游)**: 单独一步。skill 在 GitHub,入口 = 搜 `filename:SKILL.md` + 贴 `owner/repo`;直连 GitHub API vs CF Worker 代理 **待 bao 拍**(倾向 CF Worker:藏 token + 边缘缓存 + 全球低延迟)。
- **战略张力 → ADR**: "拖拽连线 + 多键帽拼 ERP" vs CLAUDE.md "CTRL is NOT a workflow editor" + 哲学 #4 "one-shot, not flows"。模型 firm 后写 ADR amendment supersede 那两条。**先确认 bao 有意演进**再写。

---

## 9. 第一个验证用例

**frontend-slides**(html ppt,`zarazhangrui/frontend-slides`,含 SKILL.md)。
跑通: Pool 找到 → clone 到 `~/.ctrl/keycaps/frontend-slides/` → 工作台里用户配成键帽 → 上键盘 → 点击进工作区 → 按下 → Pi 读 SKILL.md → 出 HTML → HtmlViewer 渲染。

---

## Sources (调研, 2026-05-28)

- React Flow: [npm @xyflow/react](https://www.npmjs.com/package/@xyflow/react) · [custom nodes](https://reactflow.dev/learn/customization/custom-nodes) · [isValidConnection](https://reactflow.dev/api-reference/types/is-valid-connection) · [Pro vs free](https://reactflow.dev/pro) · [bundlephobia](https://bundlephobia.com/package/@xyflow/react)
- dnd-kit: [npm core](https://www.npmjs.com/package/@dnd-kit/core) · [sortable](https://www.npmjs.com/package/@dnd-kit/sortable) · [GitHub clauderic/dnd-kit](https://github.com/clauderic/dnd-kit) · [维护 issue #1830](https://github.com/clauderic/dnd-kit/issues/1830)
- 同类工作台: [Flowise (Apache)](https://github.com/FlowiseAI/Flowise) · [Langflow (MIT) typed handles](https://github.com/langflow-ai/langflow) · [n8n (fair-code)](https://docs.n8n.io/sustainable-use-license/) · [Rete.js (MIT) validation](https://retejs.org/docs/guides/validation/) · [ComfyUI (GPL)](https://github.com/comfyanonymous/ComfyUI)
