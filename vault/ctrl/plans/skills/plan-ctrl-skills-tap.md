---
title: CTRL 拥有并分发 Irisy skills（ctrl-skills tap，governing）
kind: plan
created_at: 2026-07-04
owner: bao
author: claude
purpose: bao「是最根本的有效架构吗？→ 落根本架构，发成 Skills Hub tap」——CTRL 加了 gate 工具（如 smart_table_base_scaffold），但"怎么用"的 skill 漂在 ~/.hermes/skills（CTRL 管不着、Curator 会冲、不同步工具、不可复现）。根本解 = CTRL 拥有 skill 源 + 用 Hermes 机制分发。
serves: 让 CTRL 工具的用法指引跟工具同步、跨大脑、跨用户、Curator 冲不掉；闭合 base_scaffold 那条线的根因（Irisy 靠过时 skill 走错）。
research: 自查 Hermes Skills 文档 + 本机 hermes（2026-07-04，一手来源）。
related:
  - "[[plan-agent-observability.md]]"
  - 001-spine.md § byo-cli-driver（projector 投影 skills 是设计目标待落地）
---

# CTRL 拥有并分发 Irisy skills

> **一句话**：CTRL 加工具 → 拥有"怎么用"的 skill（仓库 `ctrl-skills/` = 源），用 **Hermes `skills.external_dirs`（只读发现、Curator 冲不掉）** 分发给本机 Irisy，同结构可推 GitHub 当 **Skills Hub tap** 分享。手改 ~/.hermes 是补丁,这才是根本。

## 0. 根因（研究后）

Irisy=Hermes,它有自带 skills 系统 + 自主 Curator（7天周期评分/精简/合并）+ Hub（tap 开放标准）+ ~71 原生工具（含浏览器/web）+ 原生 MCP catalog。`vault-smart-tables` skill 漂在 `~/.hermes/skills/data/`,**CTRL 不拥有**：Curator 会冲、跟 base_scaffold 工具不同步（它教一张张手写 → Irisy 手写 vault_write 崩）、换机不存在。

## 1. Hermes skill 分发机制（一手核实）

- **`skills.external_dirs`（config.yaml）** = 本地目录,Hermes **只读扫描发现**;"agent 仍写进主 `~/.hermes/skills/` 树",所以 **Curator 只管主树、不碰 external_dirs** → CTRL 拥有的外部目录 Curator 冲不掉。**local-first,无需 GitHub。**
- **Skills Hub tap** = GitHub repo（`hermes skills tap add owner/repo`,仅 GitHub Contents API）。结构:`skills/<name>/SKILL.md` + 根 `skills.sh.json`（分类）。用于**跨用户/跨 agent 分享**。
- bundled 同步:改过的 skill "user-modified,skipped forever" 不被更新冲——但那是 Hermes 自带 skill,非 CTRL 的。
- SKILL.md frontmatter:必填 `name`/`description`;选 `version`/`author`/`metadata.hermes.tags`。

## 2. 落地（本次）

- **CTRL 拥有源** = 仓库 `ctrl-skills/`（tap 结构:`skills/vault-smart-tables/{SKILL.md,references,templates}` + `skills.sh.json` + README + **MIT LICENSE**,守 ctrl-* commons ADR-006 §5.1）。`vault-smart-tables` 已迁入 + 升到 base_scaffold 版（建关联 base = 一次 `smart_table_base_scaffold`,禁手写)。
- **本机分发** = `~/.hermes/config.yaml` `skills.external_dirs` 指向 `…/ctrl-skills/skills`（已配)。下次 Hermes 重启接管成唯一源(现临时留一份 ~/.hermes 拷贝保证立即可用,重启后应删）。

## 3. 产品化 follow-up（未落地,标清）

1. **CTRL kernel 自动注册 external_dirs**:setup/launch Hermes 时,把 CTRL 打包的 `ctrl-skills/skills`（或 copy 到稳定路径 `~/.ctrl/hermes-skills`）写进 `~/.hermes/config.yaml` external_dirs + 触发 Hermes 重读——每用户自动、离线可用、无手动。这是 projector「skills→SKILL.md」设计目标的落地(ADR-001 spine 待 slice)。
2. **公开 tap 发布**:`ctrl-skills/` 推到公开 repo `soodooi/ctrl-skills`（MIT）→ 别的 Hermes/Claude/Cursor 用户 `hermes skills tap add soodooi/ctrl-skills`（share-and-be-shared）。外向操作,需 bao 授权/GitHub。
3. **建包 research-first skills** 也归这里(需求分析 / 调研 playbook),跟 vault-smart-tables 一起分发。

## 4. 红线
- CTRL 工具的用法指引一律 **CTRL 拥有**（仓库源）,不手改 Hermes 本地散文件。
- 分发走 Hermes 原生机制(external_dirs / tap),**不重造 skill 系统**（Hermes 已有,骑它）。
- ctrl-* = MIT commons。
