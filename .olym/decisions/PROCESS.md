# ADR Governance Process

> 治理规则。不能"说加就加，说减就减"。

## 1. Lifecycle SLA — proposed 不能永久挂

| 紧急度 | SLA | 超时动作 |
|---|---|---|
| **P0 (v1 ship blocker)** | 3 天 | 自动 escalate → bao 决策列表顶 |
| **P1 (current sprint)** | 7 天 | EOD audit 上报 |
| **P2 (research / future)** | 30 天 | 季度 audit 上报 |

**SLA 起点** = `date:` 字段（drafted 日）。超时未 accept / reject → zeus EOD 必报 bao。

**只有 3 个出口**：`accepted` / `rejected` / `superseded`。`proposed` 不能 sediment。

## 2. Status transitions — 谁能翻牌

| from → to | who | 触发 |
|---|---|---|
| (none) → proposed | 任何 lane owner（drafted on RFC Step 1） | RFC OPEN |
| proposed → accepted | **bao + zeus 双签 in `deciders:`** | RFC Step 3 themis APPROVE + bao verbal-go |
| proposed → rejected | bao 单方 | 否决，保留文件作 audit trail |
| accepted → superseded | bao + zeus，新 ADR 显式 `supersedes: [NNN]` | 完全替代 |
| accepted → deprecated | bao + zeus | 不再 load-bearing 但保留历史 |

**accepted 后 immutable**（zeus stewardship denylist 强制）。要改 = 开新 ADR 用 `supersedes:` 或 `amended_by:`。

## 3. amended_by — 部分修改用这个

完全替代用 `supersedes:`；**部分修改**（如 ADR-001 binary size 被 ADR-003 调整）用：

```yaml
amended_by: [003]   # 在 001 的 frontmatter 加
amends: [001]       # 在 003 的 frontmatter 加，section-level 注明改了哪条
```

amends 不翻 status（001 仍 accepted），只挂引用链。读者跟链能拼出完整真相。

## 4. Reserved 号码登记 — 不能黑洞

INDEX.md `## Reserved` 区每个保留号必有 4 列：编号 / 主题 / owner / trigger 条件。无 trigger 的占号 6 个月 → release 号码（号码重用允许，但 frontmatter 写明 `superseded_history`）。

## 5. Audit cadence

| 周期 | 谁 | 内容 |
|---|---|---|
| Daily EOD | zeus | proposed ADR 超时检查、SLA 超时报 bao |
| Sprint 末 | zeus | accepted ADR 抽查 30% 是否仍 load-bearing |
| 季度 | zeus + bao | 全量 sweep：deprecated 候选、reserved 号码清理、INDEX vs 文件一致性 |

EOD audit 自动跑 `python3 scripts/adr-check.py`（pending — 待 hello-olym 下发 lint）。

## 6. INDEX.md 维护

- Active 区按 adr_id 升序
- Reserved 区按 adr_id 升序
- Superseded / Deprecated 区按 date 倒序（最新废弃在顶）
- 每次 ADR 状态翻牌 → 同 commit 改 INDEX.md（不允许漂移）

## 7. 命名 + 号码

- adr_id = NNN 零填充 3 位
- 文件名 = `NNN-kebab-slug.md`
- merge 后 **号码 + slug 不可改**（外部链接稳定）
- 标题（title 字段）可改（错别字 / 精度提升），但要在 Changelog 加行

## 8. 紧急 carve-out

production page+ 事故允许 commit-first（先改后补 ADR），24h 内回补 ADR + RFC trace。其他情况不允许跳过 RFC。

---

**Process version**: 0.1 (2026-05-19, zeus 初稿)
**Next review**: 季度 audit 时（2026-08-19）
