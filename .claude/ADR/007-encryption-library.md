---
id: ADR-007
title: 加密库选型——vodozemac 全平台一统
status: Proposed
date: 2026-05-16
proposers: [zeus]
accepter: bao
supersedes: []
superseded_by: []
implemented_by:
  - .olym/specs/stss-protocol/mesh-profile.md
tags: [foundation, mesh, security]
---

# ADR-007: 加密库选型——vodozemac 全平台一统

## 1. Context

[ADR-003](./003-multi-device-mesh.md) 在 §3.1 与 §7 之间存在**内部矛盾**：

| 章节 | 写法 |
|------|------|
| [§3.1 Layer diagram](./003-multi-device-mesh.md#31-layer-diagram) | "Encryption: **vodozemac** (Matrix.org fork of Olm)" |
| [§3.1 段落注释](./003-multi-device-mesh.md#31-layer-diagram) | "Signal's libsignal-rust is **explicitly rejected** (upstream policy 'use outside Signal is not yet recommended')" |
| [§7 Platform coverage 表](./003-multi-device-mesh.md#7-platform-coverage) | iOS Safari PWA / Android Chrome PWA 加密列 = **libsignal-wasm** |

§7 表格与 §3.1 文字直接打架。**Sprint 1 evidence**（H-2026-05-14-001）的库锁也写 vodozemac。**§7 表的 libsignal-wasm 是 typo / 复制粘贴遗留**，但未被 Accept 时纠正，留下双标。

Athena 在 Hermes 调研中确认了 NousResearch/hermes-agent，但目前 mesh-baseline 代码（`packages/ctrl-mesh/`）刚 skeleton，还未引入任何加密库依赖。**现在是无成本决定的窗口**。

## 2. Decision

**CTRL 全平台采用 vodozemac**（Matrix.org 维护的 Olm 1:1 Rust 实现）：

- **桌面**（Win 11 Tauri 2 / macOS 13+ Tauri 2）：`vodozemac` crate (Rust)
- **PWA**（iOS Safari / Android Chrome）：`vodozemac` 通过 `wasm-bindgen` 编译的 WASM bundle
- **未来硬件 peer**（AI 眼镜 / 电纸书）：`vodozemac` 或最小化 C FFI

**仅使用 Olm 1:1 session**（点对点 double-ratchet），**禁用 Megolm**（群组加密；CTRL 是单用户多设备，无群体场景）。

**libsignal-wasm 拒绝**，理由见 §4。

## 3. Consequences

### Positive
- **单一加密栈**：所有平台一套实现，文档 / 审计 / 漏洞响应单点维护
- **Rust + WASM 同源**：桌面与 PWA 共享同一份代码，行为可证一致
- **维护活跃**：Element / matrix-rust-sdk 团队主力维护，2026-02 修复 Soatok 报告的非贡献性 DH 密钥披露
- **Bundle 可控**：vodozemac-wasm ~150 KB（与 libsignal-wasm 相当）
- **守住 [ADR-003](./003-multi-device-mesh.md) §3.1 已 Accepted 的核心选型**——无新决策、纯消除矛盾

### Negative
- **vodozemac 知名度低于 libsignal**：审计文献 / 攻击面分析以 libsignal 为多。补偿：vodozemac 是 Olm 上层封装，Olm 已有 10+ 年 Matrix 生态实战
- **iOS PWA WASM 加密首次加载 + 编译 ~80 ms**：可接受，配对流程是一次性

### Trade-offs
- **未来 SDK 生态选择受限**：若有第三方 mesh 工具基于 libsignal 协议，CTRL 不直接互通。CTRL 是封闭 mesh（单用户多设备），无此需求。

## 4. Alternatives Considered

| 方案 | 优点 | 缺点 | 拒绝原因 |
|------|------|------|---------|
| **libsignal-wasm**（Signal 官方 WASM 绑定） | 协议最广泛审计；行业标杆 | 上游明确"use outside Signal is not yet recommended"；C++ 项目，WASM 工具链复杂；无桌面 Rust 对应（libsignal-rust 不推荐外用） | 上游政策 + 跨端不一致（桌面只能上 libsignal-rust 但被自己警告） |
| **vodozemac + 桌面 libsignal-rust 混栈** | 桌面强 / PWA 强 | 两份代码两份协议，行为差异不可控；审计成本翻倍 | 单一栈优先 |
| **raw NaCl / libsodium** | 简单 / 成熟 | 无前向保密 / 无后向恢复 / 自己实现 X3DH + Double Ratchet = 自杀 | 加密原语不等于加密协议 |
| **自实现 Double Ratchet** | 完全可控 | 高概率出微妙 bug；安全审计成本远超开发成本 | 不重新发明 |
| **完全不加密**（mesh 走 TLS） | 简单 | relay 看明文 = ADR-003 §4.2 zero-knowledge 承诺破产 | 与产品承诺冲突 |

## 5. Compliance / Validation

实现需满足：

- [ ] `packages/ctrl-mesh/` 依赖中只出现 `vodozemac`，不出现 `libsignal-*`
- [ ] PWA bundle 通过 `vodozemac-wasm` 经 `wasm-bindgen` 接入，不引入 `@signalapp/libsignal-client`
- [ ] vodozemac 版本 pin 到 ≥ 2026-02 修复后版本（具体 commit/tag 在 Cargo.toml 注释中标）
- [ ] DH 公钥有效性 / non-contributory check 在 wrapper 层加 defense-in-depth（不依赖 vodozemac 内部检查）

回归触发：
- 如 vodozemac 上游废弃 / 严重未修漏洞 → 启动 ADR-007 review
- 如 CTRL 战略转向多用户 / 群组场景 → Megolm 启用走新 ADR
- 如出现"vodozemac 不支持某平台"硬阻塞 → 重新评估

## 6. References

- [ADR-003](./003-multi-device-mesh.md) §3.1 + §7（被本 ADR 消除矛盾）
- [vodozemac repo](https://github.com/matrix-org/vodozemac)
- [Soatok DH disclosure 2026-02](https://soatok.blog/) （vodozemac 已修复）
- [Signal libsignal upstream policy](https://github.com/signalapp/libsignal) （"use outside Signal not yet recommended"）
- H-2026-05-14-001 Discussion （Sprint 1 库评估证据）
