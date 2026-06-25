---
title: Irisy 开发伴侣 — 职能清单
kind: design
status: draft
created_at: 2026-06-22
owner: bao
related:
  - "[[GOAL]]"
  - architecture-byo-cli-driver.md
---

# Irisy 开发伴侣 (coding companion) — 职能清单

> 系统设计先行:先有这张职能图,再实现。bao 2026-06-22。
> 形态锁定:Coding 工作区 = 左「常驻 terminal(跑用户自己的 claude)」+ 右「常驻 Irisy」。
> Irisy 是**同一个**常驻助手(shell 级,跟其他页一致、不分裂),coding 场景下自动「进入开发伴侣模式」——
> 多了终端的**眼睛 + 手**,但还是那个 Irisy。

## 角色边界(先分清,避免塌缩)

- **terminal 里的 claude** = 真正写代码的 coding agent(BYO-CLI driver 路径,CTRL 不 supervise)。
- **Irisy** = 旁边的开发伴侣(Hermes 脑,Irisy 路径),**不替代 claude**——它看着、解释、出主意、帮你操作终端/环境。
- 两条路都经 `:17873` gate。

## 连接架构 — Irisy 怎么连终端 / claude

三条通道,**CLI 和 MCP 是分工,不是二选一**。Irisy 跟终端、跟 claude 是不同的连接:

```
 [Irisy 脑 Hermes]
       │  ① ST-SS(读 stdout) + Tauri cs_stdin(发命令)   ← CTRL 内部,非外部协议
       ▼
 [coding 终端 PTY] ──stdin/stdout(纯文本)── [claude 在跑]
                                                │  ② MCP(.mcp.json 自动发现)
                                                ▼
                                    [CTRL :17873 gate] ← Irisy 也挂在这
```

| # | 谁连谁 | 走什么 | 性质 | 现状 |
|---|--------|--------|------|------|
| ① | Irisy → 终端(看输出/发命令) | CTRL 内部:ST-SS WS(读 stdout)+ Tauri `cs_stdin`(写命令) | 同 app 内,**非外部协议** | 通道已有,P0 接线 |
| ② | claude → CTRL/Irisy(结构化协作) | **MCP**(`.mcp.json` 自动发现 `:17873` gate) | **通用协议**;claude 拿 CTRL 上下文/工具,CTRL 审计 | **已通**(claude-code 已连 gate) |
| ③ | Irisy ↔ claude 直连 | 无;通过 ①终端文本(粗)+ ②共享 MCP gate(供上下文) | — | — |

分工:
- **CLI / PTY(stdin·stdout 文本流)** = Irisy 眼睛手的最后一公里(看输出、代打命令、装配 claude)。粗粒度、立刻能做、**任何 CLI 通用**。→ **P0 用这个**。
- **MCP** = claude ↔ CTRL 结构化深度协作 + 审计。**通用协议**(Cline/Cursor/Codex 都支持),已通,是护城河。→ 深度上下文/工具走这。
- **ACP**(Agent Client Protocol) = agent-loop 级通用协议(Irisy 跟 claude agent 级编排)。代码保留、降级 future(ADR-002)。→ E 层 / goal mode 才接。

一句话:**P0 靠 ①CLI 文本流就能跑(眼睛+手);深度协作和审计靠已通的 ②MCP gate;③ACP 以后做 agent 级编排才接。**

## 职能分层

### A. 感知层(眼睛)— 看到开发上下文
| ID | 职能 | 优先级 | 复用 |
|----|------|--------|------|
| A1 | 读 coding 终端近期输出(stdout:命令/报错/claude 输出) | **P0** | `useTerminalBuffer`(已有) |
| A2 | 场景感知:知道当前在 coding(对话带上下文) | **P0** | smart-table `activeTablePath` ambient 先例 |
| A3 | 读当前 cwd / 项目文件树 | P1 | vault_list / 新 fs 读 |
| A4 | 读 git 状态 / diff(分支、改了哪些文件) | P1 | 新 git 命令(经 gate) |
| A5 | 实时跟踪 claude 进程状态(在跑/退出/报错) | P2 | `useSubprocessChannel` env_status |

### B. 行动层(手)— 能操作
| ID | 职能 | 优先级 | 复用 |
|----|------|--------|------|
| B1 | 发命令到终端(回复里的命令块「一键运行」) | **P0** | `cs_stdin` + 旧 CompanionPane 命令块提取 |
| B2 | 一键装/配 claude(国内镜像 + 写 Settings→Env) | **P0** | B1 + dev-env `setEnvVar` |
| B3 | 读/写项目文件(经 gate) | P1 | vault_write / gate 工具 |
| B4 | 起/关终端、起 claude | P2 | `cs_spawn` / `cs_kill` |

### C. 协助层(脑)— 开发知识
| ID | 职能 | 优先级 | 复用 |
|----|------|--------|------|
| C1 | 解释终端报错 + 给修复命令 | **P0** | A1 + Irisy 脑 |
| C2 | 教 claude 用法/配置(含国内镜像) | **P0** | prompt v13(已有) |
| C3 | 解释代码 / 终端输出 | P1 | A1/A3 + 脑 |
| C4 | 出方案 / 调试思路 | P1 | 脑 |

### D. 记忆层(CTRL 特色)— project brain
| ID | 职能 | 优先级 | 复用 |
|----|------|--------|------|
| D1 | 所有伴侣操作经 `:17873` gate(权限/审计) | **P0** | gate(已有) |
| D2 | 把 vault 里的项目决策/上下文喂给开发 | P1 | vault_search/read |
| D3 | 捕获开发决策回写 vault | P1 | captureToNotes(已有) |

### E. 编排层(后续,谨慎)
| ID | 职能 | 优先级 | 复用 |
|----|------|--------|------|
| E1 | 多终端 / 多任务协调 | P2 | 多 scene / cs_list |
| E2 | 长任务跟踪(goal mode) | P2 | 撞 one-shot 哲学,先想清再做 |

## P0 切片(第一步实现的最小开发伴侣)

A1 + A2(眼睛:看终端、知场景) + B1 + B2(手:发命令、装配 claude) + C1 + C2(脑:解释报错、教 claude) + D1(经 gate)。

实现接线(一处新增):CodingTerminal 把 `streamId` + stdout buffer 提升到一个共享 store(zustand);
AmbientHome 的 Irisy 在 `scene==='coding'` 时读它 → 注入 ambient context(眼睛)+ 命令块「运行到终端」按钮(手)。
不改 Irisy 的位置/外观 —— 常驻不变,只是 coding 时更懂、能动手。

## 市面调研补充 (2026) — 其他 Claude 开发伴侣

调研对象:Cline / Cursor / Windsurf(Devin Desktop) / Aider / Claude Code。
提炼出的功能模式 + 对应补进本清单的职能(标 NEW):

| 市面模式 | 来源 | CTRL 落地 | 优先级 |
|---------|------|----------|--------|
| **提议-批准**(Plan/Act,不自动执行) | Cline Plan/Act · Cursor Composer | **B0(NEW)**:伴侣提议命令/改动 → 你一键批准 → 经 gate 执行;跟 `:17873` gate 天然契合 | **P0** |
| 每改动 **diff + 批准** | Cursor · Claude `/diff` | 强化 A4 + B0 | P1 |
| **自动 git commit / undo** 安全网 | Aider 招牌 · Claude Code | **F1(NEW)**:agent 改动自动 commit(可读 msg)+ 一键 diff/undo,可审计可回滚 | P1 |
| **规则文件治理**(`.clinerules`) | Cline · CLAUDE.md/AGENTS.md | **D4(NEW)**:Irisy 帮你维护 AGENTS.md/CLAUDE.md 喂给 claude;**projector 已投影**,是现成优势 | P1 |
| **repo map / 大上下文** | Aider repo map · Cursor/Windsurf | 强化 A3 + D2(CTRL = project brain 喂上下文) | P1 |
| **实时感知用户动作** | Windsurf Cascade | 已在 A1/A2/A5 | — |
| **多 agent command center** | Windsurf Devin Desktop | 已在 E1 | P2 |
| **多模态上下文**(图/网页/语音) | Aider | **A6(NEW)**:截图/贴图给 Irisy(已有 screenshot OCR,补全) | P2 |
| Computer Use 浏览器验证 | Cline | 对应 CTRL「verify UI」,P2 | P2 |

### 关键差异化(CTRL 不是再做一个 Cline/Cursor)

市面产品都内嵌在 editor(Cline/Cursor/Windsurf VS Code 系)或纯终端(Aider)。
CTRL 的 Irisy 是**终端旁的常驻伴侣 + local-first vault + gate**:
- **不替代 claude** —— claude 在终端自己写代码,Irisy 是**协调 / 上下文供给 / 安全网**层。
- **vault = project brain** —— 把项目决策/规范喂给 claude(D2/D4),别人没有这层。
- **一切经 gate** —— 提议-批准(B0)用的就是 CTRL 已有的 `:17873` 审计层。

## 修订后的 P0 切片

A1 + A2(眼睛) + **B0(提议-批准)** + B1 + B2(手) + C1 + C2(脑) + D1(gate)。
即:Irisy 看得到终端 → 提议命令/修复 → 你一键批准 → 经 gate 发到终端执行(含装/配 claude)。

## 待 bao 拍

- 修订后 P0 切片(加了 B0 提议-批准)对不对?
- F1 git 安全网(auto-commit/undo) + D4 规则文件治理 要不要提到 P0?
- E2 goal mode 跟 one-shot 哲学冲突,做不做、怎么做?
