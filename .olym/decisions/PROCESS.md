# ADR Governance Process

> 治理规则。**唯一真相**: 每 module 一个 ADR + version 控制. 不能"说加就加, 说减就减".

## 1. Module-based ADR (2026-05-31 重整后)

8 个 module ADR (INDEX.md; 原 7 + **communication** 2026-06-22 扩编 — 通讯协议是横跨 spine/substrate/frontend 的 cross-cutting module, bao 钦定独立成 ADR-010). **新 ADR 仅当出现新 module 时新建**, 否则:
- **改既有 section** → 改正文 + bump `version:` + 追加 `changelog:` 行 + 改 `last_updated:`
- **加新 section** → 在 ADR § 加一段 + bump `version:` + 追加 `changelog:` 行 + 在 `sections:` 列表加新 entry
- **撤销 section** → 删正文 + 在 `changelog:` 行写明撤销 + 不动 `sections:` 历史项 (只在 source 字段加 `retired-vN` 标注)

号码 001-007 + **010** (communication; 008/009 已 retired 占号, 故顺延 010) 保留, slug (`spine` / `substrate` / `frontend` / `cap` / `irisy` / `cross-cutting` / `workbench` / `communication`) 跟模块边界绑死.

## 2. Frontmatter 必填

```yaml
---
adr_id: 002                    # 3 位零填充
module: substrate              # slug, 跟文件名一致
title: ...                     # 描述
version: 1                     # 整数, amendment bump
status: accepted               # accepted | proposed | deprecated
last_updated: 2026-05-31       # 跟最新 changelog 行同步
deciders: [bao, zeus, ...]
sections:                      # 列出每个 § 的来源
  - { id: brain,     source: orig-003 }
  - { id: provider,  source: new-2026-05-31 }
  ...
changelog:
  - v1 2026-05-31: ...
related:
  - .olym/decisions/<other>.md
---
```

## 3. Status 翻牌

| from → to | who | 触发 |
|---|---|---|
| (none) → proposed | 任何 lane owner (drafted) | new module 出现 |
| proposed → accepted | bao + zeus 双签 in `deciders:` | bao verbal-go + 主 § decision 确定 |
| accepted → deprecated | bao + zeus | 整个 module 不再 load-bearing (尚未发生) |

**没有 superseded 状态**了 — 单个 module 不会被替代, 只会演进. 整 module 退役 = `deprecated`.

## 4. § Acceptance gate (load-bearing)

每个 ADR `## Acceptance` 段列勾选项. `scripts/check-adr-acceptance.sh` 跑过全部 ADR, 任一 `[ ]` 未关 → `release.sh` 步骤 [0/8] 阻塞 ship. 设 `ADR_AUDIT_SOFT=1` 紧急 override (仅 page+ 事故).

## 5. 代码注释引用格式 (binding)

非平凡改动必须引 ADR § + version:

```rust
// (ADR-002 substrate § provider v1) — VMark-port path_resolver
// fixes Tauri sparse PATH; same trap as brain_supervisor and pi_install.
```

```typescript
// (ADR-005 irisy § persona v1, prompt v5) — brand label not codename.
const SYSTEM_PROMPT = ...;
```

- 不写 `(ADR-XXX)` 单引 — 必须带 module slug + section id + version
- amendment 后 grep 全代码改引 version
- 注释里没引 = 我没读过 ADR 的物证 (memory `feedback_use_adr_acceptance_as_checklist`)

## 6. INDEX.md 维护

- 7 行表 (按 adr_id 升序) — 改 ADR title / status / version → 同 commit 改 INDEX
- "Provenance — 原 22 numbered ADR" 区永不删 (历史 audit trail)
- 不再有 `## Reserved` 区 — 没有空号

## 7. 命名 + 号码

- `adr_id` = NNN 零填充 3 位 (001-007)
- 文件名 = `NNN-<module-slug>.md`
- 号码 + slug 不可改 (外部链接稳定 + 代码注释稳定)
- `title` 可改 (Changelog 加行)

## 8. Amendment workflow (无 phasing, 单 commit)

1. 改正文
2. Bump `version:` + 加 `changelog:` 行 + 改 `last_updated:`
3. `sections:` 列表同步 (若加/撤 section)
4. 改 INDEX.md `Version` 列 + `Last updated`
5. grep 代码 `(ADR-NNN <module> § <section> v<旧>)` → 改新 version
6. 跑 `bash scripts/check-adr-acceptance.sh` 确认 § Acceptance 未引入新 `[ ]`
7. 跑 cargo + tsc 验证不引入 build break
8. 单 commit 单 PR

## 9. Provenance 表 — 历史不删

INDEX.md `## Provenance — 原 22 numbered ADR` 表保留, 不补不动. 用于:
- 外部链接 (commit message 历史 / memory / chat) 仍能跟到原文件位置
- audit "当时为什么这么决定" 时跟 git log 看原文

---

**Process version**: 0.3 (2026-06-22, communication module 扩编 7→8)
**Last process change**: 2026-06-22 — 新增 ADR-010 communication (cross-cutting 通讯总纲; 7→8 module; 号码 008/009 retired 占用, 顺延 010). 前: 0.2 (2026-05-31) 替换 0.1 (22-numbered-ADR + immutable accepted + superseded chains) 为 7-module + in-place version bump
