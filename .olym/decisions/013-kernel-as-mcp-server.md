---
adr_id: 013
title: Kernel as MCP server — single bus for hermes / Irisy / external agents
status: accepted
date: 2026-05-22
deciders: [bao, zeus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/010-keycap-execution-model.md
  - .olym/specs/irisy/spec.md
  - doc/hermes-spike/RESULT.md
  - src-tauri/src/kernel/mcp_server.rs
scope: framework
supersedes: []
superseded_by: []
---

## Context

> **2026-05-23 amendment**: ADR-019 demotes this ADR's role from "primary hermes integration" to "**kernel IPC layer + secondary surface for non-hermes agents**". The kernel MCP server below is unchanged; only the framing of who consumes it shifts. Primary hermes consumer = `ctrl-hermes-plugin` Python adapter (ADR-019). See §"Role after ADR-019" at the bottom.

CTRL kernel 已经是 MCP **client** (`kernel::mcp_host`, rmcp `client` feature, 调外部 MCP server). 但 memory `decision_kernel_is_mcp_server_for_irisy` (2026-05-22) 钦定 kernel 同时也作 **server**: 让 hermes-agent / Irisy / 外部 agent (Claude Code / Cursor) 都通过单一 MCP wire 消费 kernel capability (vault / kv / llm / mcp.proxy).

不作 server 的话:
- hermes 只能通过自己的 MCP `add` 机制连接外部 server, 无法读用户 vault / 改 kv / 调 kernel-routed LLM
- Irisy 想调 vault 要走 Tauri command (web only), 想调同样东西的 external agent 要走另一套 RPC, 协议碎片化
- "kernel = AI agent integration hub" 这个 framing 在协议层没落地, 只是口号

Spike (`doc/hermes-spike/RESULT.md`) 同时证实: hermes-agent 没有 spec 假设的 `/v1/runs` HTTP daemon, 真实集成路径就是 `hermes mcp add ctrl-kernel http://127.0.0.1:17873/mcp` + Bearer token. 这条决定不是新的设计, 是把已经 spike 出来的 only viable path 文档化.

## Decision

### 1. Kernel 起 MCP server, 跟 mcp_host (client) 平行

- 文件: `src-tauri/src/kernel/mcp_server.rs`
- Transport: **streamable-http** (MCP 2025-03-26 spec, 取代 deprecated SSE transport)
- 库: rmcp 1.7 + `server` + `transport-streamable-http-server` + `macros` + `schemars` features
- 绑: `127.0.0.1:17873` (deliberately one port above ST-SS bridge 17872; log-readers 可眼看两条 stream 并存)
- 永不绑 `0.0.0.0` — cross-device 走 mesh (ADR-003), 不复用 MCP server

### 2. Auth — ephemeral Bearer token (mirror ST-SS bridge model)

- 每次 kernel boot 生成全新 UUID v4
- Token 不落盘 (`stss_bridge` 现存模式), 进程退出即失效
- 客户端通过 `Authorization: Bearer <token>` header 携带
- Axum middleware 在 `/mcp` 路由前层做 token equality 检查, 不匹配 → 401
- PWA 通过 Tauri command `mcp_server_info` 拿 `{ url, token }`
- 外部 agent (Claude Code / Cursor / hermes) 通过 `mcp_server_info` 或 `hermes mcp add` 拿到同一份 URL+token

### 3. Tool surface — 10 tools, 1 PR ship 完整集

不分 v1/v1.1, 全集一次落地. 工具就是 thin layer 调现有 kernel modules + Tauri commands 的底层逻辑:

| Tool | 调底层 | 用途 |
|---|---|---|
| `kernel.status` | `runtime.booted_at` + `mcp_host.list_installed()` + `llm_port.fallback_chain()` | 健康探针 / 调试 |
| `vault.read` | `vault::read` | 读 markdown |
| `vault.write` | `vault::write` | 写 markdown (含 frontmatter) |
| `vault.list` | `vault::list` | 列 vault 子目录 |
| `vault.search` | `vault::search` (FTS5 → substring fallback) | 全文搜索 |
| `kv.get` | `LocalStorage::get` | per-keycap KV 读 |
| `kv.set` | `LocalStorage::set` | per-keycap KV 写 |
| `llm.chat` | `llm_port.primary_adapter().complete` | 非流式 LLM 调用 |
| `mcp.list_servers` | `mcp_host.list_installed` | 列 kernel 已挂的外部 MCP server |
| `mcp.proxy_list_tools` | `mcp_host.list_tools` | 转发: 列外部 MCP server 的 tools |
| `mcp.proxy_call_tool` | `mcp_host.invoke` | 转发: 调外部 MCP server 的工具 |

(11 行 — `kernel.status` + 4 vault + 2 kv + 1 llm + 3 mcp proxy.)

**Stream LLM 不在 MCP surface**: chat stream 已经在 Tauri 的 `chat.stream.delta` event channel, 留给 PWA 直接 invoke `chat_stream` 命令. 外部 agent 要 stream 走 `llm.chat` 非流式或自己接 LLM provider.

### 4. KernelRuntime 加 `local_storage` 字段

`commands/storage.rs` 现存 `OnceLock<Option<LocalStorage>>` 全局单例继续 OK (短期内不重构), kernel 内部多开一个 `Arc<LocalStorage>` 句柄给 MCP server. SQLite 文件层锁定保证两份句柄不冲突. v1.1 可统一回 KernelRuntime 单源.

### 5. 跟现有 `mcp_host` (client) 同 crate, 双角色

`kernel::mcp_host` (client, 既存) 跟 `kernel::mcp_server` (新, 本 ADR) 都用 rmcp 1.7 同一 crate, 不同 feature flag. 不开新 crate, 不抽通用 lib. 用同一份 `Tool` / `CallToolResult` 类型 = 协议一致天然有保障.

### 6. hermes 接入路径

不在本 ADR 实施, 在 follow-up PR (hephaestus 拿 ownership). 路径已确定:

1. `bootstrap_hermes` Tauri command (hephaestus owns): `python3 -m venv ~/.ctrl/hermes-venv` → `pip install hermes-agent` → 调 `mcp_server_info` 拿 URL+token → 调 `hermes mcp add ctrl-kernel <url> -H "Authorization: Bearer <token>"`
2. 用户运行 `hermes chat -q "save this note"` 等 → hermes 自动看到 `ctrl-kernel:vault.write` 工具 → 直接调
3. Irisy 也走同样 wire (PWA 端通过 `mcp_server_info` 直接构造请求, 或者通过 Tauri proxy)

## Alternatives considered

### Stdio transport (rmcp `transport-io`)

- 优势: 不占 TCP port, 一对一进程绑定
- 劣势: 只能服务一个 client/agent. 我们要同时支持 hermes + Irisy + 外部 agent (Claude Code 在同一台机器上跑), stdio 强行 1:N 要自己写 multiplexer
- **拒**

### 走 ctrl-cloud (CF Workers) 做远程 MCP server

- 优势: 一次部署多设备共享
- 劣势: 违反 Obsidian 哲学 "本地是 truth, 云是 mirror"; 国内用户不能上 CF; vault 数据出本机. 远程方案 → mesh (ADR-003), 不复用 MCP server
- **拒**

### 一个 MCP server, 把 keycap 也作 tool 列出

- 把 keycap 当 MCP tool, 让 hermes 直接调 `keycap.invoke` ? 这条思路跟 `decision_keycap_is_mcp_server_only` (memory) 的最新框架冲突 — keycap 本身就**是** MCP server, kernel 当 server 不该再代理 keycap (那是 hephaestus spec v0.2.0 的范围)
- v0.2.0 落地后: 用户装 keycap → keycap 作为子 MCP server 起来 → kernel 用 `mcp_host` 连 → kernel MCP server 通过 `mcp.proxy_*` 转发. 不是 kernel 自己暴露 `keycap.list` / `keycap.invoke` 工具
- **本 ADR 不暴露 `keycap.*` 工具**

### Custom protocol (非 MCP) 走 ST-SS bridge

- ST-SS 是 CTRL 私有协议, 外部 agent 不能消费
- MCP 是事实标准 (Anthropic / OpenAI / Google 都对接), 选这条没替代品
- **拒**

## Acceptance

- [x] `rmcp = "1.7"` + `server` / `server-side-http` / `macros` / `schemars` features 加 Cargo.toml
- [x] `axum = "0.8"` + `schemars = "1.0"` + `tower = "0.5"` 加 Cargo.toml (axum host StreamableHttpService + middleware)
- [x] `src-tauri/src/kernel/mcp_server.rs` 实现 11 tools + Bearer token auth (axum middleware)
- [x] Runtime 加 `local_storage: Option<Arc<LocalStorage>>` 字段, MCP server 共用 SQLite handle
- [x] KernelHandle 加 `mcp_server: Option<McpServerHandle>` 字段, kernel_supervisor::start 起 server
- [x] Tauri command `mcp_server_info` 返 `{ url, token }`, 注册进 `pwa_invoke_handler!`
- [x] 单元 smoke test: 401 unauthorized + 200/2xx with valid Bearer (kernel boot + axum bind + reqwest 真路径, 2/2 pass)
- [x] doc/hermes-spike/RESULT.md 落 spike 数据 (Critical 3 + 4 验证给 hephaestus 解锁 spec v0.2.0)

## Counter-evidence (会推翻本 ADR 的发现)

1. rmcp 1.7 `transport-streamable-http-server` API 大改 / 退坑 → 评估 stdio 或 rmcp fork
2. hermes-agent 上游废弃 `hermes mcp add` 接外部 server 的能力 → 重新评估接入路径
3. MCP spec 2025-03-26 之后再有 breaking transport change → 评估升级或 pin 版本
4. Bearer token-in-header 在 axum middleware 被 streamable-http 内部 session 机制干扰 → 重写 auth 层

## Implementation note

- Listen addr 跟 ST-SS bridge **不能合并**: ST-SS = CBOR over WebSocket, MCP = JSON-RPC over HTTP, 不同 transport, 同端口冲突
- `LocalStorage` SQLite 句柄 `commands/storage.rs` 那份 (`OnceLock`) + kernel runtime 那份并存. 改写成单源是 follow-up, 不阻塞本 ADR
- `mcp_server_info` 命令返 `Option<...>` 字段 (None when bind failed), PWA 端 graceful degrade (Irisy 不依赖, 仅 future bootstrap_hermes 命令依赖)
- 端口 17873 跟 ST-SS 17872 故意差 1, 方便日志肉眼看
- ADR-013 落地不动 hephaestus 的 Irisy spec v0.2.0 流程; spec 跟本 ADR 独立 advance, 在 follow-up PR (bootstrap_hermes 命令) 才有 hard dependency

## Role after ADR-019 (amendment 2026-05-23)

ADR-019 introduces the **`ctrl-hermes-plugin` Python adapter** as the **primary hermes integration UX**. The kernel MCP server below is unchanged in implementation but its consumers re-rank:

| Consumer | Status | Notes |
|---|---|---|
| `ctrl-hermes-plugin` (Python, in `~/.hermes/plugins/ctrl/`) | **Primary** | Each plugin tool handler forwards to the kernel MCP server over Bearer-authed HTTP; the plugin is a thin shim, not a re-implementation |
| Non-hermes agents (Claude Code / Cursor / future MCP-capable agents) | **Secondary** | Direct `hermes mcp add ctrl-kernel http://127.0.0.1:17873/mcp` or equivalent; no plugin required |
| PWA mobile mode | **Tertiary** | Intra-device WebSocket/HTTP path when Tauri invoke is unavailable |

This ADR's Acceptance items remain ticked; ADR-019's Acceptance items are the new gates for the primary-path UX. Nothing in §1-§5 above needs revision.

## Decision log

- 2026-05-22 bao 钦定 "kernel = AI agent integration hub", memory `decision_kernel_is_mcp_server_for_irisy` 记录, 本 ADR 是协议层落地
- 2026-05-22 zeus 抢在 hephaestus spec v0.2.0 land 前 ship 本 ADR 的理由: spec v0.2.0 引用 kernel MCP server 的 URL/token surface; 先有 server + Tauri command 再有 spec 收敛, 减少 spec 跟实施的 drift
- 2026-05-22 拒绝 phasing (v1=3 tools / v1.1=8 tools): 反 `feedback_no_planning_no_phasing` memory, 单 PR ship 全集
- 2026-05-23 hephaestus 完成 hermes plugin 3-class due diligence, 发现 plugin path 自动 reuse hermes profile/cron/logs/models, ADR-019 钉死 plugin = 主路径; 本 ADR 角色 demote 至 IPC layer + secondary surface. Implementation 不变, framing 变 — see §"Role after ADR-019" 上方表格.

---

## 2026-05-25 amendment — reconcile with ADR-001 third 校准 (Pi-as-sole-brain)

This ADR predates 2026-05-25 brain-as-keycap reframing. Read in conjunction with:

- `.olym/decisions/001-system-architecture.md` 2026-05-25 amendments (first/second/third 校准 — authoritative)
- memory `decision_pi_is_sole_brain_hermes_is_keycap` — Pi is Irisy's sole brain; hermes is an optional personal-assistant keycap (target=brain, opt-in install via Pool), not the primary integration
- memory `decision_vmark_not_substrate_use_open_stack` — VMark is a compatibility commitment, not a substrate; CTRL uses the same open-source stack (Tiptap + CodeMirror 6 + mermaid.js + SQLite FTS5) directly

Where this ADR's body says "hermes" as the canonical brain / primary client / single integration point, **substitute "the active brain keycap (default = Pi, `@earendil-works/pi-coding-agent` lazy npm install; optional = hermes via `pip install hermes-agent` from Pool)"**. The substantive design (kernel-as-MCP-server / auto-update strategy / etc.) remains valid; only the brain identity / framing is updated.

Where this ADR uses "Obsidian philosophy" wording, the philosophy is unchanged but **the section is renamed "Plain-text philosophy"** (substance: local-is-truth, vim-readable markdown, no proprietary binary, no CTRL account, end-side OAuth/LLM/RAG/sync). The vim test remains the design gate.

Body not rewritten to keep diff small + preserve historical reasoning. This amendment header is the canonical pointer.
