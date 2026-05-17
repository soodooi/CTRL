# ADR Roles

CTRL 当前是单决策人 + 多 AI 角色协作。**bao 是唯一 Accepter；AI 角色按领域提 ADR**。

---

## bao（用户）

- **唯一 Accepter**：任何 ADR 从 Proposed → Accepted / Rejected 都需 bao 确认
- 可直接提议任意 ADR
- 战略 / 产品 / 商业大方向决策的最终拍板

---

## zeus（架构 + 底座 + LLM 适配）

可提以下 tags 的 ADR：

| tag | 范围 |
|-----|------|
| `foundation` | 4 层架构、5 原语、5 键帽源、repo 拓扑 |
| `shell` | Tauri / native shell / Hotkey / 系统集成 |
| `kernel` | L1 微内核、actor scheduler、capability broker、event bus、persistence |
| `llm` | LLM provider 选型、adapter trait、Claude CLI / Minimax / Ollama / BYOK |
| `mesh` | 跨设备 mesh、CRDT、加密、signaling |
| `commercial` | 部署架构、cloud workers、定价 / BYOK 商业模型 |
| `security` | 沙箱、capability 模型、密钥管理 |

**Athena / Hephaestus 跨界给 zeus 提需求**（"我需要 adapter trait 长这样"），zeus 设计接口、写 ADR、得 bao Accept。

---

## athena（Copilot 系统 + Agent 大脑）

可提以下 tags 的 ADR：

| tag | 范围 |
|-----|------|
| `agent` | Hermes 框架配置、agent loop、多角色 persona 设计 |
| `copilot` | 用户主力 / 集成专家 / 创造助手等 persona 规格 |
| `memory` | Agent 记忆系统设计、本地知识库 schema |
| `prompt` | 系统 prompt、模板、prompt 工程规约 |

**不可提**：foundation / shell / kernel / llm（adapter trait 是 zeus 的）/ keycap schema / manifest。

---

## hephaestus（键帽生态）

可提以下 tags 的 ADR：

| tag | 范围 |
|-----|------|
| `keycap` | 键帽优先级、v1 scope、产品路线 |
| `manifest` | manifest schema 演进、validation 规则 |
| `market` | marketplace UX、创作者激励、quality scoring |
| `integration` | 单个键帽集成方式（MCP / OAuth / CLI 包装） |

**不可提**：kernel 接口（消费 zeus 暴露的）、LLM provider（消费 athena 暴露的）、shell。

---

## 越界场景

| 场景 | 处理 |
|------|------|
| Athena 需要新的 kernel 能力 | 写需求 → 提 zeus → zeus 写 ADR + 改 spec → Athena 消费 |
| Hephaestus 想用 LLM 写 manifest | 写需求 → 提 athena → athena 提供能力 → hephaestus 消费 |
| Zeus 想增加内置键帽 | 写建议 → 提 hephaestus → hephaestus 决定是否纳入路线 → 走 keycap ADR |

**禁止**：跨界直接改对方领域的 ADR / spec。要改先发需求，对方写 ADR。

---

## 多人提同一 ADR

`proposers` frontmatter 字段可填多个：`proposers: [zeus, athena]`。常见于跨界决策（如"Hermes 调 Claude CLI"既是 athena 的 agent 选型也是 zeus 的 LLM adapter）。bao 仍是唯一 Accepter。

---

## 历史

| 角色 | 起源 |
|------|------|
| bao | 项目 founder，单决策人 |
| zeus | 2026-05-16 划分（架构 + 底座 + LLM） |
| athena | 2026-05-16 划分（Copilot 系统） |
| hephaestus | 2026-05-16 划分（键帽生态） |
| virgo | 历史 audit 角色（ADR INDEX 提及，已不活跃） |

**未来角色**（占位）：
- `bao-cfo`（财务 / 定价决策代理）
- `bao-cmo`（市场 / 创作者招募代理）

新增角色需 bao 在此文件追加。
