---
title: 通讯/集成协议 2026 深度调研 — 竞品共识 · 协议趋势 · 5 缝判断
kind: research
status: done
created_at: 2026-06-22
owner: bao
author: zeus (通讯协议)
method: deep-research workflow (5 角度 fan-out → 多源抓取 → 断言抽取 → 对抗验证)
feeds: 010-communication.md
related:
  - "[[protocol-refactor-plan]]"
  - 010-communication.md
  - 002-substrate.md
---

# 通讯/集成协议 2026 深度调研

> bao 2026-06-22:「调研充分一些,竞品、最新协议技术,与业务结合,与时俱进。」
> 方法:deep-research workflow —— 5 角度并行搜索 → URL 去重抓取 → 抽取可证伪断言 → 对抗式验证。来源以官方/一手为主。

## 一、竞品共识:2026 已收敛到 MCP

| 发现 | 证据/来源 |
|---|---|
| 主要 AI host(Claude / ChatGPT / VS Code·Copilot / Goose)全部讲 MCP,MCP 成第三方工具接入的**通用标准** | chatforest.com「MCP Ecosystem 2026」 |
| MCP **治理中立化** — 2025-12-09 捐给 Linux Foundation 的 **Agentic AI Foundation**(OpenAI + Block 共同创始;AWS/Google/Microsoft/Cloudflare/Bloomberg 白金会员) | en.wikipedia.org/wiki/Model_Context_Protocol |
| MCP **2026 spec cycle 在吸收原本要独立协议的功能**:stateless/Streamable HTTP、server discovery/**registry**、tasks、enterprise **auth**、triggers、**streaming**、skills、extensions、SDK v2 | tedt.org「MCP's 2026 Roadmap」 |

**对 CTRL 的意义**:CTRL 把 `:17873` gate 建成 MCP、把能力插件做成 MCP server,是**押在行业收敛答案 + 厂商中立标准**上,且 MCP 自身在长出 registry/auth/streaming —— CTRL 的「能力市场发现 + gate 审计 + 流」都能搭它演进,不必自造。**强化 ADR-010 § plugin / § governance。**

## 二、协议分层互补,不竞争(印证「统一窄腰 + 多元传输」)

| 协议 | 定位(接缝) | 2026 状态 | 来源 |
|---|---|---|---|
| **MCP** | agent ↔ 工具/数据/上下文 | 通用标准,Linux Foundation 治理 | nextpj / wikipedia |
| **A2A** | agent ↔ agent 协调 | 与 MCP 两层参考架构固化 | nextpj / zylos |
| **AG-UI** | agent ↔ 前端 UI 流 | 界面层标准,框架生态广 | nextpj / d4b / ag-ui |
| **MCP-UI / MCP Apps** | MCP host 渲染工具供给的 UI | 与 AG-UI 区分(app↔runtime 流 vs host 渲染工具 UI) | d4b agentic-ui |
| **ACP** | editor/client ↔ coding agent | 跨编辑器标准,Registry 上线 | zed / agentclientprotocol |

多源一致:这些是**互补的不同层**(TCP/HTTP/HTML 式分层),不是竞品。**直接印证 ADR-010 北极星**:统一在契约/治理/插件面,传输按缝多元。

## 三、ACP 已是驱动 coding agent 的生产级标准(seam ④,强化)

- **`@zed-industries/claude-code-acp`**:包 Claude Code SDK,翻译成 ACP JSON-RPC。Claude Code 作为**独立本地子进程**跑,编辑器只提供 UI —— **正是 CTRL 模型**(驱动本地 CLI、在 PWA 呈现、调用走 gate,CTRL 不拥有 agent loop)。来源:zed.dev/blog/claude-code-via-acp。
- **ACP = Apache 开源标准,JSON-RPC over stdio,"AI coding agent 的 LSP"**;**ACP Agent Registry(2026-01 上线)列 28+ agents**(Claude Code/Codex/Copilot/Gemini/OpenCode 都有 `--acp` 模式:`claude --acp`、`codex acp`、`gemini-cli --acp`)。来源:agentclientprotocol.com。
- **跨编辑器采用**:client 端 JetBrains/Neovim/Emacs/AWS Kiro;agent 端 Gemini/Google。不再 Zed 专属。来源:zed.dev/blog/acp-progress-report。
- ACP+MCP 分层:ACP = editor↔agent,MCP = agent↔tools(ACP 把 MCP 透传给 agent)。

**校准**:CTRL 旧 ADR(001/002)把 ACP 降为 future。调研显示 **ACP 2026 已成熟标准**,且「**一个 ACP client 集成 = 驱动所有 BYO-CLI coding agent**」。→ ADR-010 seam ④ 的 ACP 判断**从乐观假设升级为有据采用**;阶段 5 落地时直接对接 ACP Registry 生态,而非自研 stream-json。

## 四、AG-UI 是 agent↔前端流的事实标准(seam ③,提优先级)

- 开放轻量协议:前端 POST 一次 → 听 **SSE 流**,**17 种 typed events** 五类:Lifecycle(RunStarted/Finished/Error/Step…)、Text Message(Start/Content/End,token 流)、Tool Call(Start/Args/End/Result)、**State(StateSnapshot/StateDelta/MessagesSnapshot)**、Special(Raw/Custom)。来源:github.com/ag-ui-protocol/ag-ui、copilotkit「17 event types」、docs.ag-ui.com。
- **明确定位为 MCP(工具)+ A2A(agent间)的互补,AG-UI 拥有界面层**。
- 框架生态:LangGraph / CrewAI / Mastra / LlamaIndex / Pydantic AI / Agno,CopilotKit 提供 SDK。
- **snapshot-delta 状态模式**(全量快照 + 增量 STATE_DELTA patch)= 模块 UI 共享状态的成熟契约。

**校准**:CTRL 现用 **ST-SS(CBOR Cell/Op)** 做 Irisy↔前端流,自研、两端自控,**没必要现在替换**。但调研显示 AG-UI 是 agent↔UI 的事实标准 + 17-event 词汇成熟。→ **ADR-010 seam ③ 从「低优先」升级为「ST-SS 向 AG-UI event 词汇对齐」**(尤其 token 流 / tool-call / state-snapshot-delta 三类),这样未来「让第三方 agent 框架(LangGraph 等)的输出流进 CTRL 前端」时免费兼容。设计原则,不是立刻迁移。

## 五、local-first 数据主权:Beelay/Keyhive 是手搓 Olm 的 2026 继任者(seam ⑤,潜在校准)

- **Ink & Switch「Keyhive + Beelay」**(local-first 运动发源实验室):
  - **Beelay** = Automerge **下一代 sync 协议**,同步 **E2EE payload(服务器无法解密)**,只在 Keyhive capability 授权的 peer 间复制;是 **RPC 协议,可跑任何机密传输(HTTPS / WebSocket / raw TLS)** —— **匹配 CTRL 的 WebRTC+CBOR mesh**。来源:inkandswitch.com/keyhive/notebook/05。
  - **Keyhive** = capability-based、**coordination-free** 访问控制 + post-compromise security(Causal Keys)+ 压缩后加密 Automerge change 区段。**正是 CTRL 数据主权护城河**。注意:Automerge 需完整因果历史来渲染(不像 Signal 临时历史)→ 影响 mesh 密钥轮换 + 设备 onboarding 设计。来源:inkandswitch.com/project/keyhive。
- **CRDT 选型印证**:Yjs(最广/最快/生态最大 ~920K weekly)、**Automerge(JSON 形状 + Git-like 文档版本/变更历史,Rust core + WASM/JS)**、Loro(新兴)。CTRL 已选 Automerge+CBOR —— 调研印证 Automerge 的文档版本 + 二进制格式适合 plain-text/vault substrate,代价是 Yjs 的性能优势。Automerge **transport-agnostic**(WS/WebRTC/Bluetooth)支持 CTRL mesh。来源:pkgpulse「Yjs vs Automerge vs Loro 2026」、github.com/automerge/automerge。
- 实践警示:手搓 E2EE local-first(密钥管理/设备配对/加密 CRDT 历史)很难,Beelay/Keyhive 正是来补这个坑。来源:zaynetro「build E2EE local-first app」、wal.sh/research/local-first。

**校准**:CTRL 现在手搓 **Olm + Automerge + WebRTC + CBOR**(ctrl-mesh)。调研强烈指出 **Beelay/Keyhive(Automerge 官方下一代 E2EE + capability sync)** 是更对的 2026 方向,胜过手搓 Olm。→ **ADR-010 seam ⑧ + ADR-002 § crypto 应把 Beelay/Keyhive 列为演进跟踪项**(不是现在换 —— 现有栈能跑;是 reserve + 跟踪,Automerge 已锁则迁移成本低)。

## 六、对 ADR-010 五缝的最终判断(经调研校准)

| 缝 | 协议 | 调研结论 | 现用 / 未来 |
|---|---|---|---|
| ① 能力插件接入 | **MCP server** | 行业收敛 + Linux Foundation 中立 + registry/auth 2026 成熟 **(强化)** | 现用 |
| ② 第三方集成/对外暴露 | **MCP** | SaaS 出官方 MCP 成主流;MCP registry 上线 **(强化)** | 现用 |
| ③ Irisy ↔ 前端流 | **ST-SS(CBOR)→ 向 AG-UI event 词汇对齐** | AG-UI 是 agent↔UI 事实标准 **(提优先级:对齐设计)** | 现用 ST-SS;对齐 AG-UI = 设计原则 |
| ④ 驱动外部 coding agent | **ACP** | 已成熟标准,Registry 28+,一个 client 驱动所有 BYO-CLI **(从 future 升为有据采用)** | 阶段 5 |
| ⑤ 跨设备同步 | WebRTC+Olm+Automerge+CBOR **→ 跟踪 Beelay/Keyhive** | Beelay/Keyhive = Automerge 官方下一代 E2EE+capability sync,胜过手搓 Olm **(潜在校准)** | 现用现栈;Beelay/Keyhive = 演进跟踪 |

## 来源清单(deep-research 抓取,官方/一手优先)

- chatforest.com/guides/mcp-ecosystem-2026-state-of-the-standard/
- tedt.org/MCPs-2026-Roadmap/
- nextpj.net/blog/mcp-a2a-ag-ui-ai-agent-protocols-guide-2026
- d4b.dev/blog/2026-03-20-agentic-ui-comparing-ag-ui-mcp-ui-and-a2a-protocols
- en.wikipedia.org/wiki/Model_Context_Protocol
- zylos.ai/research/2026-03-26-agent-interoperability-protocols-mcp-a2a-acp-convergence/
- zed.dev/blog/claude-code-via-acp · zed.dev/blog/acp-progress-report
- agentclientprotocol.com/get-started/agents
- github.com/ag-ui-protocol/ag-ui · docs.ag-ui.com/concepts/events · copilotkit.ai/blog/master-the-17-ag-ui-event-types
- inkandswitch.com/keyhive/notebook/05 · inkandswitch.com/project/keyhive
- pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026 · github.com/automerge/automerge
- wal.sh/research/local-first · zaynetro.com/post/how-to-build-e2ee-local-first-app
