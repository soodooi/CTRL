---
title: CTRL product brief
kind: product-intent
status: living
last_updated: 2026-08-02
owner: bao
architecture_authority: vault/ctrl/adrs/INDEX.md
---

# CTRL — Product Brief

> 本文只定义稳定的产品意图，不定义架构、运行机制、技术栈或开发进度。架构唯一真相是 [`vault/ctrl/adrs/INDEX.md`](vault/ctrl/adrs/INDEX.md) 所列的 owning module ADR；当前开发范围以 [`vault/ctrl/GOAL.md`](vault/ctrl/GOAL.md) 为准。发生冲突时，先修正文档权威关系，再实施。

## 产品定位

CTRL 是面向一人公司经营者、独立开发者和专业创作者的本地优先 AI 工作台。用户按下 `Ctrl` 进入工作区，由一个 App AI 助手 Irisy 调用本机能力、用户自有模型和既有应用，把任务完成为可检查、可继续编辑的结果。

核心价值：

- **本地是真相，云是镜像**：用户内容保持为可由普通工具读取的 Markdown、YAML、TOML、JSON 或原生文件。
- **能力而非模型**：CTRL 提供工具、能力包、治理和呈现；用户自带模型与凭据。
- **环境中的工作台**：Ctrl 键是主要入口；内容按类型呈现，不按来源平台分割。
- **可追溯的行动**：能力调用经过 `:17873` gate；写入、外发、消费和删除遵循审查边界；原始输入、转换过程和结果可下钻。
- **可扩展但不堆连接器**：MCP、API 和 Skills 是互补能力面；可分享能力包复用通用机制。

## 产品角色

角色定义只有一个权威来源：[`ADR-005 §11`](vault/ctrl/adrs/005-irisy.md#11-app-ai-assistant-role-boundary-v36)。

- **Irisy** 是 CTRL App 内面向用户的 AI 助手，操作用户文档、应用、业务数据和已安装能力。
- **Coding agent** 是左侧工作区中的独立 OpenCode agent，负责所选工作区的代码和功能包创作，不是 Irisy。
- **CTRL development agent**（例如 Kiro）在产品之外开发 CTRL 仓库，受 GOAL 和 owning ADR 约束，不是 Irisy，也不执行 App 用户任务。

## 体验原则

1. 一个 Irisy 品牌，不复制助手窗口或产品专属聊天壳。
2. Workspace、Companion、Artifact 是能力接入的三种形态；定义见 [`ADR-005 §10`](vault/ctrl/adrs/005-irisy.md#10-irisy-capability-integration-contract-v35)。
3. AI 是管道，不是侧边栏产品；结果进入所属 workspace 或原生 artifact。
4. 一个 MCP 是一个原子动作，不建设工作流编辑器。
5. 外部应用继续拥有其协作、权限和格式规则；CTRL 不伪造成功，也不建立第二份数据真相。

## 产品边界

CTRL 不是工作流编辑器、硬件项目、长尾连接器集合、Quicker 克隆、ChatGPT GPT 集成、多租户 SaaS、模型销售商，也不是替代用户现有编辑器和业务应用的封闭套件。

## 文档导航

- 当前目标：[`vault/ctrl/GOAL.md`](vault/ctrl/GOAL.md)
- 架构索引：[`vault/ctrl/adrs/INDEX.md`](vault/ctrl/adrs/INDEX.md)
- 不可变脊柱：[`ADR-001`](vault/ctrl/adrs/001-spine.md)
- Irisy 与角色边界：[`ADR-005`](vault/ctrl/adrs/005-irisy.md)
- 产品跨域原则：[`ADR-006`](vault/ctrl/adrs/006-cross-cutting.md)
- 品牌视觉：[`brand/brand-tokens.md`](brand/brand-tokens.md)
