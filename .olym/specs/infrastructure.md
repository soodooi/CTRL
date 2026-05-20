---
parent_adr: ADR-001
status: Draft v0.1
last_updated: 2026-05-16
---

# CTRL 18 底座基础设施（spec）

抽自 [ADR-001 §6](../../.olym/decisions/001-system-architecture.md#6-eighteen底座-infrastructure-items)，因属实现细节不属架构决策。**本文档是真实来源**；ADR-001 §6 仅保留作历史。

后续这 18 项每一项落地时各自有独立 spec 文档（`.olym/specs/<domain>/spec.md`），本文档负责索引 + 现行状态。

---

## Protocol layer (5)

| # | 项 | 状态 | spec |
|---|----|------|------|
| 1 | MCP client + server discovery | 部分实现（W3.6 roundtrip） | `kernel/spec.md`（mcp_host 节） |
| 2 | ST-SS receiver/sender | ✅ 已实现 `packages/ctrl-stss/`（99 tests） | `stss-protocol/spec.md` |
| 3 | OAuth flow + token vault（Tauri Keychain） | ⏳ P8 | TBD |
| 4 | Process IPC（local agents） | ⏳ | TBD |
| 5 | Webhook receiver（Coze/Feishu callbacks） | ⏳ P8 | TBD |

## Data flow layer (3)

| # | 项 | 状态 | spec |
|---|----|------|------|
| 6 | Unified event bus（kernel-internal） | ✅ kernel::event_bus | `kernel/spec.md` |
| 7 | AI memory（event-sourced, `@ctrl/memory`） | ✅ `packages/ctrl-memory/` | TBD |
| 8 | Step engine（chain MCP + ST-SS + LLM） | ⏳ P5 依赖 | TBD |

## Creator layer (4)

| # | 项 | 状态 | spec |
|---|----|------|------|
| 9 | Manifest schema（Zod + `.describe()`） | ✅ v0.1 `share/modules/SCHEMA.md` | `tool-manifest/spec.md` |
| 10 | AI 创作助手（NL → manifest） | ⏳ P6 | TBD |
| 11 | Sandbox dry-run（WASM execution） | ⏳ P3.9 RFC | TBD |
| 12 | Manifest version management（git-style） | ⏳ | TBD |

## Market layer (3)

| # | 项 | 状态 | spec |
|---|----|------|------|
| 13 | `ctrl-market` registry + review | ⏳ P9 | `creator-economy/spec.md` |
| 14 | Revenue share engine | ⏳ P9 | 同上 |
| 15 | Quality scoring | ⏳ P9 | 同上 |

## Commercial layer (3)

| # | 项 | 状态 | spec |
|---|----|------|------|
| 16 | `ctrl-auth`（独立 D1） | ⏳ P8 | `ctrl-cloud` 仓库（未存在） |
| 17 | `ctrl-billing`（Stripe + CF AI quota + LLM proxy） | ⏳ P8 | 同上 |
| 18 | BYOK key vault（Tauri Keychain） | ⏳ P8 | TBD |

---

## 修订记录

- 2026-05-16: 抽自 ADR-001 §6，初始版（zeus）
