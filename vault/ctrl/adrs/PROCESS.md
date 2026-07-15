# ADR Governance Process

> 治理规则。**唯一真相**: 每 module 一个 ADR + integer version 控制。不能“说加就加、说减就减”。

## 1. Module-based ADR

当前 8 个 active module ADR 见 `INDEX.md`: 001-007 + 010 communication；008/009 已 retired 并保留占号。**仅当出现现有模块都不拥有的新架构域时创建新 ADR**，否则：

- **改既有 section** → 改正文 + bump `version:` + prepend `changelog:` + 更新 `last_updated:`
- **加新 section** → 同步正文、`sections:`、version、changelog、date
- **撤销 section** → 正文明确 retired；`sections:` 历史项保留并在 source 标记 `retired-vN`

Newest-first 是**向前生效的 amendment 规则**：从 process v0.5 起每个新 amendment 必须 prepend。部分 active ADR 的旧 changelog 在本规则建立前按历史写入顺序保留，可能非单调；不为纯排版重写大段 provenance。读取旧历史时以显式 `vN` 与日期为准，任何新增项仍必须位于列表首部。

号码与 slug 边界固定：`spine` / `substrate` / `frontend` / `cap` / `irisy` / `cross-cutting` / `workbench` / `communication`。

## 2. Frontmatter 必填

```yaml
---
adr_id: 002
module: substrate
title: CTRL substrate — ...
version: 1                     # integer; every accepted amendment increments it
status: accepted               # proposed | accepted | deprecated
last_updated: 2026-05-31       # matches latest changelog entry
deciders: [bao, zeus]
sections:
  - { id: brain, source: orig-003 }
changelog:
  - v1 2026-05-31: ...
related:
  - vault/ctrl/adrs/001-spine.md
---
```

`v3b` 等非整数版本禁止；follow-up amendment 必须成为下一个整数版本。

### 2.1 Retired provenance exception (ADR-008/009 only)

`008-irisy-assistant.md` 与 `009-pi-surface-integration.md` 是 module reorg 前的只读 provenance snapshots，不是 active module ADR。它们保留 legacy frontmatter（`id`、`status: retired`、`retired_by`），可以没有 `adr_id` / `module` / integer `version` / active-module `sections`。此例外只适用于这两个已退役文件：

- 不出现在 8-row active module registry，也不参与 accepted-module Acceptance/release gates
- 正文与 open checklist 仅作 historical evidence，不得作为 live architecture authority
- 不得复用 008/009 号码或把 legacy schema 扩展到新的 active ADR
- 当前行为只能由 001-007/010 的 accepted amendment 接管

## 3. Status 翻牌

| from → to | who | 触发 |
|---|---|---|
| (none) → proposed | 任何 lane owner | genuinely new module drafted |
| proposed → accepted | bao + zeus 双签 | 主 decision 与 acceptance 确定 |
| accepted → deprecated | bao + zeus | 整个 module 不再 load-bearing |

没有 `rejected` / `superseded` active 状态。单个 module 原地演进；历史决定通过 changelog 与 retired section provenance 保留。

## 4. Acceptance gate (load-bearing)

`scripts/check-adr-acceptance.sh` 按 heading scope 扫描 accepted module ADR，嵌套标题不会逃逸外层作用域。两种模式故意承担不同职责：

- 日常开发 / CI：`bash scripts/check-adr-acceptance.sh --soft` 扫描任意 level 2-6、标题含 `Acceptance` 或 `验收` 的作用域，完整暴露 inherited design debt，但不把所有 push 永久置红
- Release：`scripts/release.sh` 步骤 `[0/9]` 严格模式只扫描显式 `Release Acceptance` / `发布验收` 作用域；其中任一 `[ ]` 阻断 ship
- 长周期设计/平台 backlog 必须放在 `Design Acceptance (non-release)` 等普通 Acceptance scope，不得伪造为 `[x]`；真正 ship contract 才进入 Release Acceptance
- `ADR_AUDIT_SOFT=1` 仅限经批准的 emergency hotfix，release 会明确打印 override 语义

## 5. 代码引用与 executable governance

非平凡架构改动使用：

```text
(ADR-NNN module § section vN)
```

`scripts/check-governance.mjs` 对 architecture-critical diff 的每个 substantive hunk 检查邻近引用，并解析 `adr_id`、module、真实 changelog version 与 section heading；仅有格式像 ADR 的字符串不能通过。

- 不写 `(ADR-XXX)` 单引；必须带 module slug、section、version
- section amendment 后更新受影响代码引用
- `INDEX.md` module map 必须覆盖真实 owner 路径

## 6. INDEX.md 维护

- 8 个 active row + 2 个 retired provenance row，按 `adr_id` 排序
- ADR title/status/version/date 改动时同步 INDEX
- Module map 只能列存在的当前路径与 transport；retired runtime 名只能出现在明确历史上下文
- Provenance 表保留用于历史 audit trail

## 7. 命名 + 号码

- `adr_id` = NNN 零填充 3 位；active ids = 001-007、010
- 文件名 = `NNN-<module-slug>.md`
- 号码 + slug 不可改；title 可通过 versioned amendment 修改
- 008/009 retired，不能复用

## 8. Amendment workflow

1. 修改 owning section；不要另开重复 ADR
2. Increment integer `version`，prepend changelog，更新 `last_updated`
3. 同步 `sections` provenance（新增/退役时）
4. 同步 INDEX version/date/module map
5. 更新受影响代码的精确 ADR 引用
6. 跑 `bash scripts/check-adr-acceptance.sh --soft`
7. 跑 `node scripts/check-governance.mjs --worktree` 与相关 compiler/test evidence
8. Release 前严格 Acceptance audit 必须通过，除非有明确 emergency override

## 9. Provenance

INDEX 的历史 provenance 不删除。旧实现只可作为明确标注的 historical/retired 内容存在，不得继续出现在 live schema、release probe 或 binding Acceptance criterion 中。

---

**Process version**: 0.6 (2026-07-13)
**Last process change**: strict release audit now checks only explicit Release Acceptance / 发布验收 scopes, while soft mode continues to report all inherited design Acceptance debt。
