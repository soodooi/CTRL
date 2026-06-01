---
# Handoff frontmatter (multi-agent fleet v1.1)
#
# id           — H-YYYY-MM-DD-NNN format. Date is opening date.
# title        — Imperative one-liner. Will appear in fleet-status / SessionStart.
# severity     — P0 (block ship) / P1 (must fix this sprint) / P2 (nice-to-have)
# status       — open → claimed → in_progress → done → verified → archived
#                  open       — created, not yet picked up
#                  claimed    — worker has accepted but not started
#                  in_progress — worker is actively on it
#                  done       — worker finished; awaiting reporter verification
#                  verified   — reporter confirmed; ready to archive
#                  archived   — moved to archive/ (after 30d in verified)
# reporter     — role that opened the handoff (zeus / athena / apollo)
# assigned_to  — lane-name (resolves to whichever role is bound to that lane)
#                or "zeus" for orchestrator-only tasks
# lane         — owning lane of the WORK (often == assigned_to, but a P0 in
#                lane X may be assigned to zeus to coordinate)
# touches      — file globs the worker is authorized to write while this
#                handoff is in_progress. Lane-guard hook reads this list.
# related      — sibling handoffs (use IDs)
# project_id   — optional. kebab-case logical project (e.g., olym-v3-protocol /
#                creator-credit-pack / mayaCS-v2). Groups handoffs for
#                project-level rollup view in handoffs-index By Project section.
#                Backward compat: missing → "(no project)" group.
# category     — optional. Work nature (NOT urgency — severity is urgency).
#                Values: feature | bugfix | refactor | docs | chore (aligns
#                with conventional commit types). severity × category cross-
#                product decides priority (P0+bugfix=hotfix, P0+feature=
#                block-ship, P2+refactor=nice-to-have).
#                Backward compat: missing → "(uncategorized)" group.
# created      — opening date YYYY-MM-DD
# updated      — last status / body change YYYY-MM-DD

id: H-YYYY-MM-DD-NNN
title: <imperative one-liner>
severity: P0 | P1 | P2
status: open
reporter: <zeus | athena | apollo>
assigned_to: <lane-name | zeus>
lane: <lane-name>
touches:
  - path/to/file.js
  - path/to/glob/**
related: []
project_id: <optional-kebab-id>
category: <feature | bugfix | refactor | docs | chore>
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

## 现象
<observed behavior or risk; what hurts>

## 证据
- `file:line` — direct quote or PRAGMA / curl output
- 复现步骤（如适用）

## 建议
<suggested fix approach; not prescriptive>

## 验收清单
- [ ] 修复实现
- [ ] 自测通过（含具体命令 / URL / 输入）
- [ ] 发现方确认（status → verified）

## 讨论 / 备注
<空白；接收方或发现方在此追加 context。worker 求助 zeus 也写在这里：
"@zeus 需要 ... 因为 ..." 等到 zeus 回复后再继续。>
