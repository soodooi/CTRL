---
title: Irisy coding companion — retired design note
kind: history-pointer
status: retired
retired_at: 2026-08-02
superseded_by: adrs/005-irisy.md#11-app-ai-assistant-role-boundary-v36
---

# Irisy 开发伴侣（已退役）

本文的 Claude + PTY + ST-SS 方案已被 accepted ADR 替代。历史内容可通过 Git 查看；当前文件只保留权威指针，避免旧机制继续被当作实现要求。

当前唯一权威：

- 角色和任务归属：[`ADR-005 §11`](adrs/005-irisy.md#11-app-ai-assistant-role-boundary-v36)
- 左区 Coding 与右区 Irisy：[`ADR-005 §8.7`](adrs/005-irisy.md#87-consolidation--leftright-regions--the-right-region-pluggable-acp-engine-new-v9-2026-06-28)
- OpenCode projection 与 gate：[`ADR-001 §4`](adrs/001-spine.md#4-byo-cli-driver-5-block-view-logical-co-exists-with-1)
- Coding 前端与 workspace：[`ADR-003 §8.5`](adrs/003-frontend.md)

Irisy 是 App AI 助手；Coding agent 是独立的 OpenCode actor；Kiro 等 CTRL development agent 在产品外维护仓库。共享 ACP、附件或 gate 基础设施不代表角色合并。
