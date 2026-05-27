---
id: H-2026-05-17-002
title: Keycap integration spec — 7 pattern × MCP tools 契约 + 39 意向分桶
severity: P1
status: open
reporter: zeus
assigned_to: hephaestus
lane: hephaestus-keycap-spec
worktree: /Users/mac/Documents/coding/CTRL (main, mac physical)
branch: feat/hephaestus-keycap-spec
touches:
  - doc/keycap-integration-research/02-pattern-A-notes-sink.md
  - doc/keycap-integration-research/02-pattern-B-cli-wrapper.md
  - doc/keycap-integration-research/02-pattern-C-daemon-controller.md
  - doc/keycap-integration-research/02-pattern-D-thirdparty-mcp.md
  - doc/keycap-integration-research/02-pattern-E-oauth-platform.md
  - doc/keycap-integration-research/02-pattern-F-stss-publisher.md
  - doc/keycap-integration-research/02-pattern-G-builtin-step.md
  - doc/keycap-ideas-record.md   # 加 pattern 标签
parent_adr:
  - ADR-010
related:
  - doc/keycap-integration-research/00-adr-010-inputs-from-hephaestus.md   # v2 §8 三件事来源
project_id: ctrl-v1
category: spec
created: 2026-05-17
updated: 2026-05-17
---

## 角色

Hephaestus = CTRL keycap 生态负责人。**只写契约，不写实现代码。**

## 触发

ADR-010 (71ab91f) accepted（bao 2026-05-17）—— 键帽 = MCP server 对外 + actor 对内，5 个子决策落定。Zeus 通知本 handoff 三件事可正式启动。

## 任务清单

### 1. 锁定 7 个 reference impl 候选（已与 Zeus 对齐）

| Pattern | Reference impl | 来源 |
|---|---|---|
| A. Notes / share sink | **Memos** (#31) | keycap-ideas-record |
| B. CLI wrapper | **BetterDisplay** (#39 + 官方 betterdisplaycli) | keycap-ideas-record |
| C. Daemon controller | **Motrix / Aria2** (#38) | keycap-ideas-record |
| D. Third-party MCP server | **bazi-mcp** (#1) | keycap-ideas-record |
| E. OAuth 大平台 | **飞书 (Lark Open Platform)** (#7) | keycap-ideas-record |
| F. 第三方 ST-SS publisher | **VSCode coding context publisher** | 01 §4.2 |
| G. 声明式 step | **markdown-quote**（作为 "CTRL Builtin MCP Server" 的一个 tool） | share/modules/builtin/markdown-quote |

### 2. 每 pattern 写 ≤200 行 "对外 MCP tools 契约" 草案

位置：`doc/keycap-integration-research/02-pattern-{A..G}-{name}.md`

每份必含：
- **tool 名**（dotted notation：`memos.post` / `betterdisplay.set_brightness` / `bazi.calculate`）
- **输入 JSON Schema fragment**（zod-friendly）
- **输出 JSON Schema fragment**
- **所需 capabilities**（`HttpCapability` / `ShellCapability` / `OAuthCapability(provider, scopes)` / `KeyringReadCapability` / `StssBridgeCapability` 等，对齐 ADR-010 §5.2）
- **manifest 字段示意**（让 Zeus 知道 manifest schema 需要哪些字段）
- **MCPServerActor 子类 runtime 提示**（如：常驻 / on-demand / 持有 SubprocessActor）
- **错误模型**（MCP error code）
- **Irisy 调用样例**（自然语言 → MCP tool call → 结果回流）

**不写实现代码**（Rust / TS / JS 都不写）。只写契约。

### 3. 39 条意向按 A–G 分桶

在 `doc/keycap-ideas-record.md` 每条加 `**Pattern**：X` 字段（39 条全部）。

## 输出

- 7 份契约草案 md（≤200 行 each）
- `keycap-ideas-record.md` 39 条带 pattern 标签

## 不做

- 不写实现代码
- 不动 kernel / actor 源
- 不写 Pattern F 的 ST-SS↔MCP 桥接协议细节（ADR-010 §8 明确出 scope，落 `stss-protocol/mcp-bridge.md`，Zeus 之后开）
- 不展开 marketplace 签名（v1.1）

## 依赖

- ✅ ADR-010 accepted
- ⏳ Zeus 接下来落：`MCPServerActor` / `SubprocessActor` / `OAuthCapability`（kernel actor 子类）。**本 handoff 不被阻塞**——契约稿可独立完成；reference impl 实施时才需要 Zeus 落地。

## 完成准则

- 7 份契约 md 齐，每份 ≤200 行
- 7 候选都有契约 fully written，足以让 Zeus（kernel） + Athena（Irisy）在 ADR-010 落地后立刻按契约对齐
- `keycap-ideas-record.md` 39 条都有 pattern 标签
- ADR-010 §7 Validation list 中 "7 个 pattern 各有 1 个 reference impl 候选" 这一条已满足契约层

## 估时

~3–5 小时
- 每份契约 30–45 min × 7
- 分桶 30 min
- 自我 review + 一致性 30 min

## 后续

完成后产出会作为：
- Zeus 实施 `MCPServerActor` / `SubprocessActor` / `OAuthCapability` 时的契约对照
- Athena 在 Irisy 内做 MCP tool calling 时的 schema 对照
- `.olym/specs/tool-manifest/spec.md` 重写的输入（ADR-010 §`implemented_by` 列出）

---

**Hephaestus 立即接手。** 完成或遇到阻塞 ping bao + Zeus。
