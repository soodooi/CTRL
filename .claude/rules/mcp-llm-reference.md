---
paths:
  - "packages/ctrl-mcp-sdk/**"
  - "packages/ctrl-mcps/**"
  - "src-tauri/src/kernel/provider/**"
  - "src-tauri/src/kernel/mcp_server.rs"
  - "src-tauri/src/kernel/mcp_host.rs"
---

# MCP manifest model + LLM pattern + Top 15 mcps (reference)

> Reference content split out of CLAUDE.md (Anthropic best practice). Path-scoped — loads when working on the MCP SDK, bundled mcps, or the provider/MCP-bus kernel subsystems.

## MCP manifest model

Every mcp = declarative manifest (Zod schema). 4 source types: builtin / mcp-server / oauth / local_agent. (ST-SS retired as a source 2026-06-25, ADR-001 spine v9.)

> 2026-06-07: "keycap" 退役为 UX 装饰概念, 技术端统一称 "mcp" 跟 MCP 生态对齐. memory `decision_keycap_collapses_to_mcp_meta_ux_layer` (2026-06-05) 已升级 — 都叫 mcp, skills 也是 mcp.

详细 schema: ADR-002 substrate § composition v1 + `packages/ctrl-mcp-sdk/src/manifest-schema.ts` (SSOT).

AI 创作助手 generates manifests from natural language. User never writes JSON unless they want to (advanced mode).

## Top 15 mcps (v1 scope)

| # | MCP | Tier |
|---|---|---|
| 1-5 | Clipboard AI / OCR / Translate / Text / Chat | P0 v1.0 |
| 6-10 | 窗口 / PDF / LaTeX / 智识 / 屏幕录 | P1 v1.1 |
| 11-15 | Snippet / Code / Email / 会议 / 同步 | 差异化 |

## LLM Pattern D

```
Default subscription = CF Workers AI quota (Qwen-3 / Llama-3.3, 含在订阅)
       ↓
BYOK 高级 = user fills own Anthropic / OpenAI key (advanced creation tier)
       ↓
Local Ollama = privacy geek tier
```

> **ADR-006 cross-cutting § byok-no-claude v1 lock**: Anthropic Claude / GPT-4 / Ollama 都是 **BYOK only**, 用户主动启用. Default subscription path 只 CF Workers AI (Tokyo 主路径). CTRL runtime never ships an Anthropic / OpenAI SDK on its hot path — those clients only load when the user has filled their own key in Settings → Providers (ADR-002 substrate § provider §3.6 v1). User-facing references to `claude-code` / `aider` etc. as external CLIs (Code Space env presets) are NOT a violation: they are user choice, not CTRL-bundled dependency.

**We sell tools + platform, not models.**

## Key external references

- Architecture: AIOS (Rutgers COLM 2025), Anthropic Sandbox Runtime, IronClaw seL4-inspired
- MCP standard: Linux Foundation / AAIF governance, Anthropic SDK
- Inspirations: Raycast, Cursor, Linear, OP-1, Frank Chimero
- Anti-references: ChatGPT 灰, Material Design, 紫色渐变 SaaS 模板
