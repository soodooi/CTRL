---
title: Agent 可观测/调试栈选型 — 让 Irisy 可调试（governing）
kind: plan
created_at: 2026-07-03
owner: bao
author: claude
purpose: bao「别人是怎么调试 agent 的？深入研究一下」——现调 Irisy 靠翻粗粒度 gate 审计账本(只记 tool 名 + args_hash,无参数/结果/reasoning)+ 想逆向发消息,是土办法。本 plan = 真调研 2026 agent 调试/observability 栈后的 CTRL 选型。
serves: 让 Irisy/CTRL 可调试(当前 base_scaffold 调试卡壳暴露的缺口)+ CTRL observability 底座。
research: 自查(WebSearch/WebFetch, 2026-07-03, 全带一手 URL); 后台研究 agent 因 403 挂了, 改自查。
related:
  - "[[plan-tables-workspace-ux.md]]"   # base_scaffold 调试是触发点
  - 002-substrate.md § audit-ledger（现有账本 = 升级起点）
---

# Agent 可观测/调试栈选型

> **一句话**：业界调 agent 的核心 = **把一次 turn 录成 OTel/OpenInference span 树**（LLM 调用带 prompt+response、工具调用带 **参数+结果**）→ 送 trace 后端看树 → 加 eval 断言工具调用 → 可回放。CTRL 的 **gate(:17873) 是天然埋点口**（所有工具调用都过它）；把现有审计账本从 `args_hash` 升成**真 OTel span（args+result）**，是最小高价值一步。

## 1. 业界四招（真调研）

**① Trace viewer（最主流）** — 一次 agent turn = span 树，每个 LLM 调用/工具调用/检索是子 span，可回放逐层展开。CTRL 的审计账本是它的雏形,但缺参数/结果/reasoning/树结构。

**② MCP Inspector** — 我用 curl 死磕"工具暴露没、参数对不对"的**正解**。官方 `npx @modelcontextprotocol/inspector`,UI 在 `localhost:6274`(+proxy 6277),连 stdio/SSE/**streamable-HTTP**,列工具 + 按 JSON schema 生成表单**手动调用看返回**;CLI 模式 `--method tools/list` / `tools/call --tool-name --tool-arg`。→ 本可以一分钟验出 `base_scaffold` 暴露没 + 手动喂参数跑一次。

**③ Eval（给 agent 写测试）** — 数据集(输入→期望工具调用/输出)跑 agent 断言。**DeepEval** 有开箱的 **tool-correctness metric**（"是否用对参数调对工具"）+ task-completion + step-efficiency;**promptfoo** CLI+YAML 本地跑,custom assertion 也能断言工具调用。都开源、纯本地(唯一外呼 = model API)。

**④ Replay / 时间旅行** — 录会话确定性回放,rewind 改状态重跑(LangGraph checkpoint 代表)。

## 2. 标准 = 反锁定层（关键,CTRL 最该用）

**OTel GenAI semantic conventions** — 一次埋点、任意后端(Phoenix/Langfuse/Jaeger),不锁厂商。具体 span 属性（一手, opentelemetry.io / greptime）:
- LLM 调用: `gen_ai.operation.name`(chat) · `gen_ai.request.model` · `gen_ai.usage.input_tokens/output_tokens` · `gen_ai.input.messages/output.messages`(开 content capture)
- **工具调用**: `gen_ai.tool.name` · **`gen_ai.tool.call.arguments`** · **`gen_ai.tool.call.result`**（span 名 = `execute_tool {tool.name}`）
- **MCP 专属**: `mcp.method.name`(tools/call) · `mcp.session.id` · `jsonrpc.request.id` + W3C Trace Context 跨协议边界传播(client span 套住 server span,一条 trace)
- **状态**: 2026-05 GenAI + MCP conventions 仍是 **Development(experimental)**,属性名可能变 → 用 `OTEL_SEMCONV_STABILITY_OPT_IN` 管迁移。**OpenInference**(Arize)= 专为 agent 设计、Phoenix 原生,是另一条更稳的路。

## 3. 自托管 trace 后端对比（CTRL local-first 只看能本地跑的）

| 后端 | License | 自托管 | 标准 | 记 args+结果 | local-first 契合 | 备注 |
|---|---|---|---|---|---|---|
| **Arize Phoenix** | Elastic License 2.0 | ✅ pip / Docker,**可离线** | OpenInference 原生 + OTel | ✅ | **★★★★★** | 全功能免费无 gating、live 流式、notebook 友好、可嵌;非 OSI(不能拿去做竞品 SaaS,内部/dev 无碍) |
| **Langfuse** | **Apache-2.0** | ✅ 自托管免费无限 | **OTel 原生** | ✅ | ★★★★ | license 最干净、框架支持广;**但重**(要 Postgres + Clickhouse),footprint 大 |
| LangSmith | 闭源 SaaS | ❌ cloud-only | — | ✅ | ★ | 违反 local-first/隐私,弃 |
| Braintrust / Datadog / Helicone | SaaS(部分自托管付费) | 多为云 | 部分 OTel | ✅ | ★ | 云优先,弃 |

**判断**:CTRL local-first + 最小 footprint → **Phoenix**(轻、可离线、可嵌、OpenInference 原生)是最佳"可选外接后端";要 license 最干净且不怕重 → Langfuse。**但 CTRL 不必立刻 bundle 整个平台**(见 §4)。

## 4. 给 CTRL 的选型（最小高价值 → 逐步）

CTRL 已有 **① hermes dashboard(:17890, 有 /api/sessions/{id}/messages,是现成 trace 视图)② gate 审计账本**。缺的是"参数+结果的真 span + 验工具的手段 + 回归 eval"。**不重造平台,补三样**:

- **S1（0 成本,立刻）**: **MCP Inspector 进 dev-loop** —— `npx @modelcontextprotocol/inspector`,连 gate `:17873`(streamable-HTTP + Bearer),列工具确认 `base_scaffold` 在、手动喂 CRM spec 调一次看返回。调 Irisy「工具够不够得着 / 参数对不对」再不用 curl 猜握手。
- **S2（核心,自建）**: **审计账本升级成真 OTel span** —— gate 已是所有工具调用的 choke point,把 `args_hash` 换成 **`gen_ai.tool.call.arguments` + `gen_ai.tool.call.result`**(脱敏)+ `mcp.method.name`/`mcp.session.id` + `caller`。一次改,账本从"只知调了啥"变"知道喂了什么、返了什么、哪步崩"。**这正是 base_scaffold 调试当时缺的**(当时只看到 vault_write error,看不到它喂的 frontmatter 长啥样)。用 OTel GenAI 属性形状 = 反锁定,以后能 OTLP 导出到 Phoenix 看树。
- **S3（可选,外接）**: gate 的 span **OTLP 导出到本地 Phoenix**(离线 Docker/pip),要 span 树可视化时开,不要就只看账本 —— augmentation 不是 dependency,守 CTRL 哲学。
- **S4（回归)**: 一条 **DeepEval/promptfoo eval**:「建 base 的 NL → 期望调 `smart_table_base_scaffold`(不是 vault_write)」进 dev-loop,防 Irisy 再退回手写。

**红线**:不接闭源云 SaaS(LangSmith/Datadog,违反 local-first + 隐私);内容捕获(prompt/args/result)默认本地、脱敏、可关(隐私);标准层用 OTel/OpenInference 不自造 span schema。

## 5. 先做
S1(MCP Inspector 立刻验 base_scaffold)→ S2(账本升 OTel span,把 base_scaffold 调试闭环补上)→ S4(eval)→ S3(Phoenix 外接,按需)。

## 6. 一手来源
- Langfuse vs Phoenix: langfuse.com/faq/all/best-phoenix-arize-alternatives · zenml.io/blog/langfuse-vs-phoenix · laminar.sh/article/arize-phoenix-alternatives-2026
- OTel GenAI/OpenInference: opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans · opentelemetry.io/blog/2026/genai-observability · greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions · arthur.ai/column/openinference-vs-opentelemetry-genai-conventions-agent-tracing
- MCP Inspector: modelcontextprotocol.io/docs/tools/inspector · github.com/modelcontextprotocol/inspector
- Evals: github.com/promptfoo/promptfoo · deepeval.com · technspire.com/en/blog/agent-evaluation-2026-deepeval-promptfoo-langsmith
