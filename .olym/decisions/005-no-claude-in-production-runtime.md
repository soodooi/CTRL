---
adr_id: 005
title: No Claude / Anthropic SDK in CTRL production runtime
status: accepted
date: 2026-05-18
deciders: [bao, zeus]
related:
  - .olym/decisions/001-system-architecture.md
  - packages/ctrl-web/src/lib/llm-transport.ts
scope: framework
supersedes: []
superseded_by: []
---

## Context

ADR-001 §LLM Pattern D 写：默认 CF Workers AI + Doubao; BYOK 含 Claude / GPT-4 / 本地 Ollama. 实施过程中 production code 漂出原意：
- `packages/ctrl-web/src/lib/llm-transport.ts:108` 默认 `model: opts.model ?? 'claude-haiku-4-5'` — 用户没显式选 model 时 fallback 到 Claude
- `experiments/claude-cli-shim/` 是 zeus 的 dev-time Claude wrapper，被 Athena 文档化为 Irisy v1 stack 一环（memory 旧版 `decision_drop_hermes_for_irisy_v1.md` 写 "PWA → Tauri → Zeus shim → claude"）
- 注释 `llm-transport.ts:2` "served by Zeus's claude-cli-shim" 把 dev-time tooling 当成 production 路径

CN OPC 用户没有 Anthropic API key 也不会安装 Claude CLI；产品默认调 Claude = dead-on-arrival。bao 2026-05-18 钦定：**shipped CTRL 产品 production runtime 不能有 Claude / Anthropic SDK / Claude CLI / 任何 Anthropic-owned dependency 在默认路径上**。

## Decision

CTRL production runtime **仅**通过 LLMTransport → 用户配置的 AI provider 调 AI:

- **默认订阅** = CF Workers AI (Qwen-3 / Llama-3.3, 含在订阅, CN-reachable via Tokyo 主路径)
- **BYOK advanced** = 用户主动添加 Anthropic API key / OpenAI key / 本地 Ollama；这些 key 的存在 + 调用是 **user action**，不是 CTRL 默认
- **dev-time only** = `experiments/claude-cli-shim/` 和 Claude CLI 是 contributor 本地开发工具，**不进 shipped binary**

`packages/ctrl-web/src/lib/llm-transport.ts` 必须修：
- line 108 默认 model 改成 Volc-shaped 字符串 (例如 `'doubao-1-5-pro-256k'`) 或抛错强制 user 显式选 provider
- line 2 注释把 "Zeus's claude-cli-shim" 改成 "user-configured LLM provider"
- `experiments/claude-cli-shim/` 在 vite build excludes 中显式排除

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | 默认含 Claude CLI passthrough (用户没 key 时 noop) | 用户根本没装 Claude CLI; noop 等于 broken UX; CN 用户无 GitHub 加速安装路径 |
| A2 | bundle Anthropic SDK 进 shipped binary 作为 BYOK 标配 | Anthropic SDK redistribute 政策风险; 用户无 key 时 SDK 占 100KB+ bundle 浪费; 法律灰区 |
| A3 | Claude-shim 作为可选 add-on (像 Ollama 一样可选下载) | 增产品复杂度; 用户预期 "BYOK = 我有 key" 不是 "BYOK = 先装 plugin"; 跨平台 install pipe 额外成本; 无 ship value |
| A4 | 保持现状 (默认 claude-haiku) | 直接违反 bao 2026-05-18 directive + dead-on-arrival CN 用户 |

## Consequences

**Positive**:
- CN 用户开箱可用 (默认 CF Workers AI 经 Tokyo 主路径可达)
- 法律 / 依赖管理简化 (Anthropic SDK 不进 binary = 不背 Anthropic 政策包袱)
- BYOK 语义清晰 (用户主动加 key = 主动启用, 不是默认就有)
- 跟 ADR-001 LLM Pattern D 原意一致 (Pattern D 本意 user choice)
- Irisy 设计回归正轨 (Irisy 用配置的 provider, 不是 "Claude wrapper")

**Negative / cost**:
- Athena 之前在 `experiments/claude-cli-shim/` 的 dev-time scaffolding 不能搬进 production (~2 days 投入"作废"; 但作为 dev-time 测试工具仍有价值)
- LLMTransport 返工: 默认 model / 默认 baseURL / 错误处理都改 (lane-A H-2026-05-18-001 D1 范围内)
- BYOK 文档 / UI 需新增 (用户主动添 key 入口, lane-A daedalus 范围)

**Reversal cost**:
- 便宜 — 1 天加 Claude CLI / Anthropic SDK 回去. 但 reversal 触发: (a) CN 用户 dead-on-arrival 风险 (b) Anthropic 依赖政策风险. 不建议轻易 reverse.

## Acceptance

- [ ] `packages/ctrl-web/src/lib/llm-transport.ts:108` 默认 model 改成 Volc-shaped (lane-A H-2026-05-18-001 D1 验收)
- [ ] `packages/ctrl-web/src/lib/llm-transport.ts:2` 注释更新去除 "claude-cli-shim" 表述
- [ ] `experiments/claude-cli-shim/` 在 vite build exclude (`vite.config.ts` 或 `.vite-ignore`)
- [ ] `grep -rn 'claude\|anthropic\|@anthropic' packages/ctrl-web/src/ --include='*.ts' --include='*.tsx'` 输出 0 命中 production paths (排除 `experiments/`)
- [ ] `grep -rn 'anthropic' src-tauri/Cargo.toml` 0 命中
- [ ] BYOK UI 落地 (lane-A daedalus): 设置面板可添加 Anthropic / OpenAI / Ollama key
- [ ] CLAUDE.md `## LLM Pattern D` 段加注: "Anthropic Claude / GPT-4 / Ollama 都是 BYOK, 用户主动启用; 默认 only CF Workers AI 经 Tokyo 主路径"
- [ ] memory `feedback_no_claude_in_production.md` 引用本 ADR

## Changelog

| Date | Change |
|---|---|
| 2026-05-18 | Initial proposed (zeus); evidence: grep `llm-transport.ts:108` default model = `claude-haiku-4-5`; memory `feedback_no_claude_in_production.md` captures bao 2026-05-18 directive |
| 2026-05-19 | **Accepted** (bao verbal-go + zeus). De-facto already enforced via memory + handoffs; status flipped to align with reality. |
