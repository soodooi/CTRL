---
title: Irisy 工具调用诊断 — hermes one-shot 工具编排瓶颈
date: 2026-06-27
status: active-investigation
relates:
  - vault/ctrl/architecture-byo-cli-driver.md
  - .olym/decisions/002-substrate.md  # §1 brain = hermes
---

# Irisy 工具调用诊断

> 一句话:**「Irisy 联网搜索不好用」的真根因,不是搜索后端 / 不是功能包 / 不是模型的 function-calling 能力 —— 而是 CTRL 把 Irisy 接在了 hermes 的 one-shot(`hermes -z`)模式上,而 one-shot 的工具编排不稳。**

## 问题溯源(怎么一路挖到这)

1. Irisy 联网搜索答得含糊 → 查 hermes 最佳实践:`web_search` 只给摘要,要 `web_extract` 抓正文;backend 分 search/extract 两维。
2. 默认 backend 选了 `ddgs`(免费免 key,但 search-only、质量垫底)。
3. 用户要「多源 + 免费档用完自动 failover」→ hermes 0.16.0 单 backend、failover 是未实装 upstream(`hermes-agent#32159`)→ 决定做成 CTRL 功能包 `ctrl-websearch`(多源 failover)。
4. 功能包做完接 Irisy,逐层撞墙,最后定位到工具编排层。

## 受控实验矩阵(都用 ctrl-websearch 当试金石,`CTRL_WEBSEARCH_DEBUG` 写调用日志做决定性证据)

| 模型 | toolset | 结果 |
|---|---|---|
| doubao-1-5-pro(volc)+ `hermes-cli,ctrl-websearch` | 吐 `<\|FunctionCallBegin\|>[{"name":...}]` 格式,**hermes 不解析执行**(doubao 用私有 FC token,非标准 OpenAI `tool_calls`) |
| hermes3:8b(ollama)+ `ctrl-websearch`(单独) | 纯 2023 训练记忆答,**没调工具** |
| hermes3:8b(ollama)+ `hermes-cli,ctrl-websearch` | **空回复**(model returned empty content after retries) |
| hermes3:8b(ollama)+ **ACP agent-loop**(`hermes-acp`,ctrl-websearch 作 mcpServer,自写最小 ACP 客户端,permission 自动 approve) | **没调工具**:握手全通(initialize ✓ / session/new ✓ / prompt `stopReason:end_turn`),inputTokens=16380(**工具定义确实发给了模型**),但模型 137 token 就 end_turn,无 tool_call |

## 部件隔离验证 —— 单独测每个部件都 ✅ 完美

- **ctrl-websearch MCP server**:独立 stdio client 测 → handshake ✓、`tools=[web_search]` ✓、多源 failover 搜索 ✓(ddgs 命中 nodejs.org/realpython)。
- **ollama hermes3 的 function-calling**:直接打 `/v1/chat/completions` 带 tools → **完美返回标准 `tool_calls: web_search({"query":...})`**。
- **hermes ↔ ctrl-websearch 连接**:`hermes mcp test ctrl-websearch` → `✓ Connected, Tools discovered: 1`(前提:用 `hermes-agent[mcp]`,默认 spec 不含 mcp 客户端 SDK)。

→ 部件全好,**组合在 hermes one-shot agent loop 里就不通**。

## 接入链上踩过的坑(都已确认 + 解法)

1. `hermes-agent==0.16.0` 默认 **不含 mcp 客户端 SDK** → 连不了任何 stdio MCP server。解:`hermes-agent[mcp]`。
2. one-shot 默认不加载 `config.yaml` 的 `mcp_servers` → 要显式 `-t <server-name>`。
3. downstream MCP 工具命名 = `mcp_{server}_{tool}`(与内置 `web_search` 不撞名)。
4. hermes 禁工具只能 **toolset 粒度**,没法单禁内置 `web_search`(它在 `hermes-cli` core)。
5. Irisy 同时有内置 `web_search` + `browser_*`,one-shot 下优先用内置、不选 MCP 的。

## 根因(修正 — 2026-06-27 ACP 实验后)

**不是执行模式。** ACP agent-loop 模式(hermes 工具调用的"正经"设计路径,自动 approve permission)**一样不调工具** —— 推翻了「one-shot 是瓶颈」的假设。

证据指向 **模型能力 / provider 适配** 是瓶颈:
- **doubao-1-5-pro**:吐私有 `<\|FunctionCallBegin\|>` token,**非标准 OpenAI `tool_calls`**,hermes 不解析 → 工具调用从协议层就不通。
- **hermes3:8b(ollama)**:FC 单独测好(直接 `/v1` + 1 工具 → 完美 `tool_calls`),但在 hermes-agent 真实负载下(inputTokens 16380 = 大 system prompt + 多工具定义)**8B 太小被淹没,137 token 就 end_turn 不调**。

即:Irisy 用工具要可靠,需要一个 **(a) 标准 OpenAI `tool_calls` 格式 + (b) 足够强(非 8B 级)+ (c) hermes adapter 一等支持** 的模型。doubao 缺 (a),hermes3:8b 缺 (b)。

## 下一步

1. **测一个强的标准-FC 模型**(决定性):Claude(`anthropic` provider,hermes `anthropic_adapter` 一等支持 + 标准 `tool_use`)最佳;或 GPT-4o / GLM-4 / Nous 托管的大 Hermes。用户已配 `~/.ctrl/providers/{anthropic,zhipu}.toml`。若强模型能调通 ctrl-websearch → 根因坐实 = 模型,Irisy 换强模型即解(执行模式 / 功能包 / 搜索后端都不用动)。**← 下一步**
2. 若强模型也不调 → 再回头查 hermes-agent ↔ ollama/provider 的工具传递实现。

## 关键结论

部件全好(功能包 ✓ / 连接 ✓ / 强模型直连 FC ✓ / ACP 握手 ✓),**唯一没验证通的是「在 hermes-agent 真实负载里,一个够强的标准-FC 模型实际产生 tool_call」**。这是 Irisy 工具能力的真正命门,也是「Irisy 为何像在背记忆」的根。

## 资产现状

- `ctrl-websearch` 功能包本体:✅ 完成、独立验证、已提交(MIT,`share/modules/ctrl-websearch/`)。任何工具调用正常的 MCP host 都能用。
- 接 Irisy:阻塞在执行模式,待方向 1 验证。
