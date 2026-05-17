---
id: ADR-010
title: 键帽执行模型——MCP 对外 / actor 对内
status: Proposed
date: 2026-05-17
proposers: [hephaestus, zeus]
accepter: bao
supersedes:
  - ADR-001#3.1   # "键帽 = WASM sandboxed actor" 收窄，WASM 退为可选 actor impl
  - ADR-001#4     # 5 keycap sources 表 — 全部纳入 MCP 框架（仍生效，但表达方式合一）
superseded_by: []
implemented_by:
  - .olym/specs/tool-manifest/spec.md   # 即将重写
  - .olym/specs/kernel/spec.md           # MCPServerActor 子类规范
tags: [foundation, kernel, keycap, integration]
references:
  - doc/keycap-integration-research/00-adr-010-inputs-from-hephaestus.md
  - bao 2026-05-17 verbal-go "走 B"
---

# ADR-010: 键帽执行模型 —— MCP 对外，actor 对内

## 1. Context

ADR-001 §3.1 把键帽定义为"WASM sandboxed actor"。但 Anthropic MCP 生态 2024 起爆发（Day-1 10,000+ servers），第三方键帽来源（Quicker / Raycast 插件 / 飞书 OAuth / Coze / CLI wrapper / 本地 daemon / ST-SS publisher）现实上**没有人按 WASM 写**。

两种模型在仓库内并存且语义不明：
- ADR-001 §3.1：keycap = WASM actor 子集
- Athena 实施 / ctrl-tool-integration 雏形：keycap-like 调用走 MCP

Hephaestus 调研 39 条意向 + share/modules + ctrl-tool-integration 后，给出 7 个 keycap pattern × 接入实现矩阵（详见 `doc/keycap-integration-research/00-adr-010-inputs-from-hephaestus.md`）。bao 2026-05-17 拍板 **B 方案**。

## 2. Decision

**键帽的对外接入协议是 MCP；对内 runtime 是 actor。**

- **MCP（Model Context Protocol，Anthropic 标准）** = 键帽与 CTRL 内核 / Irisy / 任何 MCP client 的**唯一**对外接入面
- **Actor**（ADR-001 §3.1-§3.2 五原语之一） = 键帽在 CTRL kernel 内的运行时形态
- **MCPServerActor** = 新引入的 well-known actor 子类，承担 "包一个 MCP server 让 kernel 编排" 的责任。不增第 6 原语。

ADR-001 §4 的 5 类键帽源（MCP / OAuth / Local agent / ST-SS / Builtin）不取消，**统一表达为 MCP server**，差异只在 MCPServerActor 内部的实现细节（详见 §3）。

## 3. Consequences

### Positive
- **Day-1 兼容 Anthropic MCP 生态**（10K+ servers），用户可直接装第三方 MCP keycap，无需 CTRL 团队适配
- **Irisy / Claude / 任何 MCP client 调用 keycap 路径统一**，不需要 case-by-case 集成代码
- **键帽创作者一次写 MCP server，到处可用**（Claude Code / CTRL / 任何 MCP host）
- **ADR-001 5 原语 spine 不破**，向后兼容
- **7 个 keycap pattern 在协议层完全统一**（详 Hephaestus 输入 §1）

### Negative
- **现有 16 个声明式 starter（share/modules/builtin/）需要重新包装**为单个 "CTRL Builtin MCP Server"，v0.1 step engine 降级为其内核
- **现有 `packages/ctrl-tool-integration` 的两套 schema**收敛为 MCP 一套；旧 zod schema 仅做 builtin server 内部用
- **WASM 不再是默认键帽形态**，仅作为高安全场景的 actor impl 选项
- **第三方 MCP server 安全沙箱** 需要 OS-level 强制（sandbox-exec / landlock+seccomp / AppContainer），带来部署复杂度

### Trade-offs
- 选 MCP 意味着 CTRL 的扩展面**对齐 Anthropic 路线**——若 Anthropic 改 MCP 协议，CTRL 跟着改。**评估**：MCP 已是 OASIS 候选标准 + LinuxFoundation/AAIF 标准化进程中，绑定风险低。
- MCP 是请求-响应模型，与 ST-SS 事件流不天然匹配 → Pattern F 需要桥接（见 §4 #6）。

## 4. 五条隐含子决策（bao 拍 B 时一并落定）

| # | 子决策 | 落地说明 |
|---|------|------|
| 4.1 | MCP 是 keycap 唯一对外接入协议 | OAuth / CLI / Daemon / ST-SS 全部 wrap 为 MCP server |
| 4.2 | 16 starter 包成 **"CTRL Builtin MCP Server"** | v0.1 step engine 作为内核；对外仍是 MCP tools |
| 4.3 | 两套 schema 收敛 → MCP | 老 schema 降级为 builtin server 实现细节 |
| 4.4 | CLI / OAuth / 第三方 ST-SS publisher 不再是独立 type | 统一为 MCP server，差异在 runtime actor 子类 |
| 4.5 | WASM 仅作为 actor 一种实现 | 高安全内置场景可选，但非默认 |

## 5. 我（zeus）对 Hephaestus 6 个剩余问题的回答

| # | 问题 | 决议 |
|---|---|---|
| 5.1 | MCPServerActor 是子类还是新原语？ | **子类**。不增第 6 原语。继承 `Actor` trait，关联 `MCPServerHandle` |
| 5.2 | OAuth runtime 在哪一层？ | **底座统一**：新增 well-known `OAuthCapability(provider, scopes)`，挂在 ADR-001 §3.2 Capability 系统。Pattern E keycap 声明此 capability，kernel broker 注入凭证；keychain 读写由 capability gated |
| 5.3 | SubprocessActor 进 ADR-010 还是独立 ADR？ | **进 ADR-010**。Pattern B/C/D 强依赖，与 keycap 模型耦合紧 |
| 5.4 | 安全沙箱默认形态？ | **OS-level + capability 强声明 + 安装时审批**。macOS: `sandbox-exec`；Linux: `landlock + seccomp`；Win: AppContainer。Capability 缺则 syscall block。性能开销估 < 5% |
| 5.5 | 第三方 MCP server 安装机制？ | **v1**：下载 + manifest 声明 + 安装时用户审批 capability list；**v1.1**：marketplace 签名（ctrl-market） |
| 5.6 | Pattern F 事件流 ↔ MCP 映射？ | **MCP `notifications`（server-initiated）+ 兜底 long-poll tool**。具体协议设计落 `.olym/specs/stss-protocol/mcp-bridge.md`，本 ADR 不展开 |

## 6. Alternatives Considered

| 方案 | 摘要 | 拒绝原因 |
|------|----|------|
| **A. WASM-only**（原 ADR-001 §3.1 严格读法） | 所有键帽必须 WASM 沙箱 | 切断 10K+ MCP 生态；创作者门槛过高；Anthropic 路线一致性差 |
| **B-本次决策**：MCP 对外 + actor 对内 | 见 §2 | — |
| **C. 并存双协议**（MCP 第三方 + 自定 builtin） | 内置走声明式 v0.1 schema，第三方走 MCP | 2 套 schema 长期维护；Irisy / Claude 调用要 case-by-case；违反单决策原则 |
| **D. 自造 CTRL-only 协议** | 重新发明 MCP-like | 重复造轮 + 失去生态 |

## 7. Compliance / Validation

实施需满足：

- [ ] `MCPServerActor` 作为 `Actor` 子类 in `src-tauri/src/kernel/actors/mcp_server_actor.rs`
- [ ] `SubprocessActor` in `src-tauri/src/kernel/actors/subprocess_actor.rs`
- [ ] `OAuthCapability(provider, scopes)` 加入 `kernel::capability` 已知 capability 表
- [ ] 现有 16 starter 重写为单个 "ctrl-builtin" MCP server（可走 stdio JSON-RPC 给 kernel）
- [ ] `packages/ctrl-tool-integration` 两套 schema 收敛
- [ ] 7 个 pattern 各有 1 个 reference impl（见 Hephaestus 输入 §8 候选）
- [ ] OS sandbox profile 各平台跑通（macOS first → Win → Linux）

回归触发：
- 如 MCP 协议出现破坏性变更 → 本 ADR review
- 如 7 个 pattern 中任一 reference impl 无法在该 pattern 下落地 → 回 ADR

## 8. 不做（Out of Scope）

- 不增第 6 原语
- 不在 ADR-010 内详细写 Pattern F 的 ST-SS↔MCP 桥接协议（落到 stss-protocol spec）
- 不写 marketplace 签名细节（v1.1 ADR）
- 不为 user 暴露 manifest 字段（UX 由 Irisy NL 生成）

## 9. References

- [Hephaestus 输入 v2](../../doc/keycap-integration-research/00-adr-010-inputs-from-hephaestus.md)
- [ADR-001 5 原语 / 5 键帽源](./001-system-architecture.md)
- [ADR-002 PWA pivot](./002-pwa-pivot.md)
- [Anthropic MCP 规范](https://modelcontextprotocol.io/)
- bao 2026-05-17 verbal-go "走 B"

---

**等 bao Accept → Hephaestus 按 §7 落 reference impl + Zeus 按 §7 落 kernel actor 子类 + Athena 按 §5 在 Irisy 内消费 MCP tools**.
