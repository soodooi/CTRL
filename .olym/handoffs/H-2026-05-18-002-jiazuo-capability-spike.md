---
id: H-2026-05-18-002
title: "底座 capability surface 验证 spike — 喂 ADR-004"
severity: P0
status: open
reporter: zeus
assigned_to: hephaestus
lane: lane-B
touches:
  - .worktrees/scratch/spike-jiazuo-capability/**
  - doc/keycap-integration-research/06-jiazuo-result.md  # spike 输出位置
related:
  - H-2026-05-17-002  # keycap-integration (同 slot, 此 spike 复用 7-pattern 研究)
  - H-2026-05-18-001  # irisy-companion (输出物 ADR-004 影响其 D4)
project_id: jiazuo-v1
category: research
created: 2026-05-18
updated: 2026-05-18
timebox: 1-2 days
---

## 🎯 目标 (Ship value, 1 句)

输出 `底座 capability surface 定义清单`，让 zeus 能基于证据写 ADR-004 (而不是凭直觉)，并让 daedalus 在 H-2026-05-18-001 D4 知道 Irisy 该调哪些 capability。

## 📦 交付成果 (Deliverables)

单一文件: **`doc/keycap-integration-research/06-jiazuo-result.md`** (RESULT.md)，含三节：

| 节 | 内容 | 评判标准 |
|---|---|---|
| **§Q1 Keycap → capability 消费表** | 把 16 starter keycap + 7 pattern research 全过一遍。每个 keycap 列：消费哪些 syscall (text.chat / image.generate / file.read / clipboard.read / screen.capture / ...)。出现 3+ 次 = 底座；1-2 次 = keycap-local 实现 | 至少 30 行表格，每行 keycap + capability + 频次 |
| **§Q2 Capability surface draft schema** | 把 Q1 频次 ≥3 的 capability 按 namespace 分组 (text.* / image.* / audio.* / file.* / clipboard.* / screen.* / network.*) + 给每个出 Zod-shape input/output 草稿 | 至少 8 个 namespace，每个 ≥2 个 method 的草稿 |
| **§Q3 Claude-free verification** | grep 实际 production code paths (`packages/ctrl-web/src/**`, `src-tauri/src/**`, 不含 `experiments/`)，列出残留的 Claude/Anthropic 引用 + 每条建议 fix。验证 ADR-005 propose 的事实基础 | 表格 / 列表，0 引用 = pass，>0 = fix 清单 |

**输出之外的不做**:
- ❌ 不写 ADR-004 (zeus 接力)
- ❌ 不改任何 production code (spike 只 read + 出报告)
- ❌ 不动 `~/.ctrl/keycaps/` 设计 (zeus Z2 域)

## 🧠 Skill 匹配 (hephaestus platform-owner + keycap-research)

bao 提醒"匹配 skill"。本 spike 用 hephaestus 的：

- **核心**: keycap-research history (他自己写的 7 pattern + 39 意向分桶)
- **复用**: `doc/keycap-integration-research/00-adr-010-inputs-from-hephaestus.md`、`02-pattern-A/B/C/D`、`05-manifest-schema-v0.2.md`
- **不做**: Rust kernel 实现 (zeus)、PWA UI (daedalus)、ADR 写作 (zeus)、sandbox profile 实施 (后续 lane)

**Olym skill 调用建议**（开 hephaestus 窗口第一条 prompt 引这些）:

```
新 session start, 在 .worktrees/scratch/spike-jiazuo-capability/ 工区, .lane=jiazuo-spike
你是 hephaestus, 接 H-2026-05-18-002. 必读:
  - .olym/personas/hephaestus/persona.md + skills.md
  - CLAUDE.md + .olym/CLAUDE.md
  - .olym/handoffs/H-2026-05-18-002-jiazuo-capability-spike.md (本文件)
  - .olym/decisions/001-system-architecture.md + 010-keycap-execution-model.md
  - doc/keycap-integration-research/00-adr-010-inputs-from-hephaestus.md (你自己写的, 起点)
  - doc/keycap-integration-research/02-pattern-A/B/C/D-*.md, 05-manifest-schema-v0.2.md
执行顺序:
  1. /writing-plans — 先拆 Q1/Q2/Q3 各 ≤30min 子任务清单
  2. Q1 输出后通知 bao (检查点 1, ≤ 4h)
  3. /systematic-debugging — Q2 schema 设计 (核对 Q1 频次, 避免过设计)
  4. Q2 输出后通知 bao (检查点 2)
  5. Q3 grep 实证, 不靠记忆
  6. /verification-before-completion — RESULT.md 收尾前自查
```

## Spike 三个 must-answer 问题（详）

**Q1: 底座 / 键帽精确边界？**
- 输入: 16 starter keycap (在 `.olym/specs/tool-manifest/spec.md` v0.1 starter 段 + `02-pattern-*` 研究里) + 7 pattern × 每 pattern 至少 1 reference impl
- 方法: 列每个 keycap "运行时需要调什么外部能力" (text generation / image gen / OCR / file IO / clipboard / screenshot / network / DB)
- 输出: 表格 行=keycap, 列=capability, 单元格 = 命中数 / 是否硬依赖
- 判断规则: **≥3 keycap 命中 = 底座; <3 = keycap-local 实现** (避免单 keycap 把 builtin AI 拽进底座)

**Q2: Capability surface 长啥样？**
- 输入: Q1 输出
- 方法: Q1 命中 ≥3 的 capability → 按 namespace 分组 (text.* / image.* / audio.* / file.* / clipboard.* / screen.* / network.* / persistence.*)
- 输出: Zod 草稿，每个 method 写 input/output type
- 反例自查: **不要先定 namespace 再回头匹配 keycap** (容易过设计)

**Q3: Claude/Anthropic 在 production 代码路径残留？**
- 输入: `packages/ctrl-web/src/**` + `src-tauri/src/**`，**排除** `experiments/`
- 方法: `grep -rn 'claude\|anthropic\|@anthropic' --include='*.ts' --include='*.tsx' --include='*.rs'`
- 输出: 表格 file:line + 当前内容 + 建议 fix
- 已知红点: `packages/ctrl-web/src/lib/llm-transport.ts:108 model: opts.model ?? 'claude-haiku-4-5'`、line 2 注释引用

## ⚠️ 阻塞 / 待 bao 决策

- 无内部阻塞，spike 自包含
- **超 1.5 day 不能收口** → 暂停 + 向 zeus 升级

## ✅ 验收清单

- [ ] `doc/keycap-integration-research/06-jiazuo-result.md` 落地，§Q1 / §Q2 / §Q3 三节齐
- [ ] Q1 表至少 30 行 (16 keycap × 平均 2 capability)
- [ ] Q2 至少 8 namespace，每个 ≥2 method 草稿
- [ ] Q3 grep 实证 (含命令 + 输出引用)，不靠记忆
- [ ] 每个 Q 完成后 bao 中途看过一次（防憋大稿失控）
- [ ] zeus 验收 → 启动 ADR-004 propose

## 讨论 / 备注

**Anti-orphan 自查**（spike 完工后）:
- RESULT.md 结论 → ADR-004 草稿 (zeus 接力)
- ADR-004 → `.olym/specs/kernel/capability-surface.md` (Q2 schema 落 spec)
- spike 工区可归档到 `.olym/digests/` 或直接删除（RESULT.md 已留底）
- 不留 dangling 文件 / dangling 决策

---

### 2026-05-19 hephaestus (lane-C) — spike DONE

- **Commit**: `3488c45` on `feat/h-2026-05-18-002-jiazuo-spike` (pushed, no PR per spike timebox convention)
- **Deliverable**: `doc/keycap-integration-research/06-jiazuo-result.md` (575 行, outcome-focused)

**3 句结论**:
1. **Q1** — 100 (keycap, capability) 消费行覆盖 23 keycap (16 starter + 7 pattern ref + screenshot + v1 top-15); 频次规则 ≥3=底座 / <3=keycap-local 实证有效, 无反例; **v1 必造底座 14 项 (8 namespace) + v1.1 bucket-projection 5 项 (5 namespace 已 reserve)**.
2. **Q2** — Capability surface = **10 namespaces (v1 暴露 8: clipboard/text/network/keyring/screen/file/mcp/platform; v1.1 promote 5: process/network.local_rpc/oauth.broker/stss/image)**, 每 method 给 Zod input/output 草稿 + manifest 声明例; mcp.* 是 Pattern D 10K MCP 生态的 infra exception (即使 v1 单实例也必须底座).
3. **Q3** — Production code 27 处提到 claude/anthropic, **0 个违反** (17 = 合法 BYOK Anthropic adapter, 5 = 合法 doc/enum/MCP 引用, 0 个 hardcoded `claude-*` 模型字符串); 唯一 3 处可改 = `kernel/runtime.rs:53` + `kernel/llm_port.rs:4` 默认 fallback chain 应改 Volc-first (per ADR-011) + `settings.tsx:21` BYOK 文案漏 Volc (路 Apollo per memory).

**@zeus ready for ADR-004 drafting** — RESULT §"Hand-off to Zeus" 段给了 ADR-004 每 § 的 lift 清单 + anti-orphan 自查 + 给 daedalus / Apollo 的下游 ask.
