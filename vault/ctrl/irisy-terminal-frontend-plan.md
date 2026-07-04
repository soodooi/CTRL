---
title: Irisy terminal 前端方案 — 能力清单 + 资源清单 (detailed, governing plan)
kind: reference
created_at: 2026-07-04
owner: bao
author: claude
purpose: bao「出方案，落到 Irisy 能力清单/资源清单，要细化，譬如 claude 的斜杠、对话的方式」。把 §8.6.2 的 terminal 前端优势落成可开发的能力清单(细到 slash 命令集/对话模式/键盘)+ 资源清单(每条能力依据的开源源码 + 许可证 + adopt/adapt/参考 + 接 CTRL 哪)。
source: 8-facet 全网调研(design 5 + 源码 3)一手来源;ACP 源码 Apache-2.0 已核实。见 [[terminal-frontend-research.md]] + ADR-005 §8.6.1/§8.6.2。
related:
  - "[[terminal-frontend-research.md]]"
  - "[[irisy-capability-resource-inventory.md]]"
  - "[[architecture-byo-cli-driver.md]]"
---

# Irisy terminal 前端方案

> **总纲**:Irisy 前端 = **「ACP 契约驱动的友好 GUI 审查客户端」**。渲染 ACP wire type 成 对话框 + 卡片 + 审批卡 + 状态条;保留 terminal 全部语义,GUI 化交付,不做裸 shell(§8.1)。**地基决定**:退掉手写 `acp_client.rs` 解析,**adopt 官方 Apache-2.0 ACP SDK**(Rust crate + TS npm)+ 从 `schema.json` **codegen** Rust/TS 类型,kernel 与 PWA 永不漂移。
>
> 姊妹文档 [[irisy-capability-resource-inventory.md]] = **建包**视角能力/资源;本文 = **前端**视角能力/资源。

---

## A. 能力清单(capability list)—— 细到 affordance

### A1. 对话模式(conversation modes)—— 参考 Aider ask/architect/code + ACP session modes

Irisy 三模式(下拉切换,对应 ACP `session/set_mode` + `current_mode_update`):

| 模式 | 行为 | 写操作 | 参考 |
|---|---|---|---|
| **Chat** | 纯对话(润色/问答/翻译),**trivial 直连模型不走整 agent loop**(已有,快) | 无 | 现状 |
| **Plan** | 只读探索 → 出计划/diff,**物理只读不写源** | 禁止,先看后批 | Claude/Cursor/Gemini plan-mode(#1 信任机制) |
| **Do / Build** | 执行,写操作**经审批门**(A5) | 经门 | Aider code / opencode Build |

**对话的方式(细化)**:
- textarea **永不禁用** + 真 **Stop** 按钮(§8 锁,已有)
- streaming **分段渲染**:`Thinking…` 折叠轨迹(✅ v13)→ 工具步骤 chip ◐→✓(✅ v13)→ 答案文本 → 底部「working」指示贯穿整轮
- 友好皮肤(§8.1):非技术用户看到的是对话,不是 shell 提示符

### A2. Slash 命令 `/` —— 参考 Claude Code(bao 点名)

`/` 出**可筛菜单**,每条右侧**显示快捷键**(Raycast/VSCode 教学法)。引擎已发 `available_commands_update`(实测)带 `input.hint`。Irisy 命令集(CTRL 化,参考 Claude/Codex/Gemini):

| 组 | 命令 |
|---|---|
| 会话 | `/new` 新对话 · `/resume` 恢复 · `/fork` 分叉 · `/rewind` 回滚(代码+对话)· `/share` 分享链接 · `/compact` 压缩上下文 |
| 模式 | `/chat` · `/plan` · `/do` |
| 工作(CTRL 特有)| `/table` 建/开智能表 · `/note` 笔记 · `/pack` 建功能包 · `/skill` 技能 · `/review` 审查 · `/diff` 看改动 |
| 系统 | `/model` 换模型 · `/agent` 换引擎(hermes/codex/claude)· `/context` 上下文用量 · `/permissions` 权限 · `/status` |
| 自定义 | **markdown 文件名即命令**(`$ARGUMENTS`/`$1`)→ 走 gate `skill_read`/`skill_write`,合 plain-text vault |

### A3. Sigil 输入模式 —— 参考 GitHub 命令面板

一个输入,首字符选模式:

- `>` 跑能力/命令 · `@` 提及实体(联系人/笔记/表)· `#` 标签 · `/` slash 动作 · `:` 跳模块
- `@`/`#` 出**模糊选择器**(存在则选、不存在内联建);`@Docs`/`@Web` 式非文件源(Cursor)可后加

### A4. 键盘 —— 友好化的 readline

↑/↓ **历史回溯并编辑重发** · `Ctrl-R`/⌘K **模糊搜过去对话**一键重跑 · `Esc` 中止(保留工作)· `Esc Esc` rewind 菜单 · Enter 发送 / Shift-Enter 换行 · 可搜 `?` 速查表。**丢掉**:leader-key/vim-mode/chord 当默认(power-view 才给)。

### A5. ★ 审批卡(write-review gate,moat)—— 参考 LangGraph HITL + Copilot

**最高杠杆**。现状 `select_allow_outcome` **自动放行** ACP `session/request_permission` = 主动把 human-in-the-loop 扔了。改成:

- **触发**:模型选了写动作(ACP `tool_call.kind` ∈ edit/delete/execute)→ 弹卡,**写操作 defer 到批准后才真跑**(LangGraph 硬教训:恢复从头重跑,写在 resume 后)
- **卡片**:显示 工具 + 目标 + **可编辑参数** + 三选 **approve / deny / 改参数** + 作用域 **一次 / 本会话 / 永远**(ACP 4 值枚举 `allow_once`/`allow_always`/`reject_once`/`reject_always`)
- **分级(NN/g + HAX)**:可逆低风险 → 直接做 + Undo(别 cry wolf);不可逆/花钱/外部副作用 → 卡确认(具体后果句 + 动作标签按钮「发送发票/取消」);批量销毁 → 输入名
- **auto-vs-ask 组合**:静态 allowlist + classifier(经 CTRL brief 判)+ 条件谓词(只 gate 写)+ 分级置信 hold;**gate 强制不是模型**;避免审批疲劳(93% 批准会麻木 → 让门智能)

### A6. Plan 面板 + task-list —— 参考 Warp/Cursor plan mode

ACP `plan` entries(content + priority + status,每次全量重发)→ 可勾选清单 + 实时进度,展示「将发生什么 + 到哪了」。

### A7. Diff 审查 —— 参考 Zed multibuffer / Cursor

ACP `tool_call.content` 的 **diff 类型**(path/oldText/newText)→ **逐 hunk accept/reject** + 行内评论→agent 改。用 CTRL 已有的 CodeMirror 6。

### A8. 状态条(status line)—— 参考 Claude statusline / Starship

常驻一条:活跃模块 · engine/model · **上下文健康彩条**(不是 `142k/200k`)· 后台任务数 · sync/云状态 · cost。数据源 ACP `usage_update`(used/size/cost)。永远显示 Irisy 处于 idle/thinking/awaiting-confirmation(非技术用户更需模式清晰)。

### A9. 会话对象 —— resume / fork / checkpoint

ACP `session/load`(回放历史)/ `session/resume`(恢复不回放)/ `session/new`;`/fork` 分叉支线;checkpoint **代码+对话一起回滚**(Gemini `/restore` / Claude `/rewind`,合 local-is-truth);可分享链接(合 share-and-be-shared)。

### A10. Blocks 卡片 —— 参考 Warp

每个 turn / 工具结果 = **可寻址卡片** + 友好动作(重跑 / 复制 / 分享链接 / pin / 「问这个」);输出里实体(日期/金额/联系人/发票号)→ 可点(WezTerm quick-select 超集);富输出**就地渲染**不甩外部 app(CTRL viewer registry)。

---

## B. 资源清单(resource list)—— 依据源码 + 许可证 + 用法 + 接 CTRL 哪

> 许可证是硬指标(CTRL = AGPL 主体 + MIT 功能包)。**Apache-2.0 双向安全**(可进 AGPL,也可 vendored 进 MIT);**GPL 只读参考不抄**;MIT 最友好。

| 能力 | 依据源码 | 许可证 | 用法 | 接 CTRL 哪 |
|---|---|---|---|---|
| **ACP 契约(全部 wire type)** | `agentclientprotocol/rust-sdk`(crate `agent-client-protocol` v1.0.1)+ `typescript-sdk`(`@agentclientprotocol/sdk`)+ `schema/v1/schema.json` | **Apache-2.0 ✓核实** | **adopt** crate+npm;从 schema **codegen** Rust/TS 类型 | kernel 退手写 `acp_client.rs`,实现 `Client` trait;PWA 加 sdk 的 `types.gen.ts`+`zod.gen.ts` |
| **agent 端发 permission/tool/diff** | `claude-agent-acp`(`elicitation.ts`/`tools.ts`)· gemini-cli `zedIntegration.ts` | **Apache-2.0 ✓** | **adapt** | hermes ACP 侧 / gate 参考 |
| **客户端渲染交互模型**(权限钮/plan/diff hunk) | Zed `crates/agent_ui/…/thread_view.rs`(`render_permission_buttons`/`render_plan_*`)· `agent_diff.rs` | **GPL-3.0 ⚠** | **只读参考,不抄**(且是 GPUI-Rust,非我们栈) | 学交互,用 TS 重写 |
| **聊天壳 primitives**(消息/工具/thread) | `assistant-ui`(headless,`humanTool()`+`addResult`+`requires-action` 态,`ExternalStoreRuntime` 后端无关骑 gate)**或** Vercel **AI Elements**(shadcn copy-in:`Tool`/`Confirmation`/`Reasoning`) | assistant-ui **MIT ✓** / AI Elements **Apache-2.0 ✓** | **二选一 adopt**:要维护库→assistant-ui;要「拥有每一行」→AI Elements copy-in | React PWA;后端无关,骑 `:17873` gate 事件流 |
| **命令面板 ⌘K + sigil** | `pacocoursey/cmdk`(headless,`shouldFilter={false}`+`pages` 做 sigil)· kbar(**不适合** sigil,弃) | cmdk **MIT ✓** | **adapt cmdk** | 独立 React 组件,自持 CSS |
| **slash + @mention 编辑器** | `@tiptap/suggestion`(`@` 和 `/` 都用它)+ `@tiptap/extension-mention` · `novel` 的 `slash-command.tsx`(**只 adapt 这一个文件**) | tiptap 全 **MIT ✓** / novel **Apache-2.0 ⚠**(保留署名) | **插进 CTRL 已有 Tiptap**(两个小 MIT peer dep) | 现有 Tiptap;novel 只借模式重写(pins Tiptap v2,先确认 CTRL 的 Tiptap 大版本) |
| **diff 逐 hunk accept/reject** | `@codemirror/merge` 的 `unifiedMergeView`(**自带每块 Accept/Reject 钮**,`mergeControls:true`) | **MIT ✓** | **adopt**(就是 CM6) | **插进 CTRL 已有 CodeMirror 6**(repo 2026-04 归档但 npm 6.12.2 在维护,跟 npm) |
| **审批卡 UX(moat)** | `assistant-ui` 审批卡(MIT,`addResult` 回调,已验证脱离 LangGraph)· AI Elements `Confirmation`(Apache)· **`agent-inbox` 4-flag**(MIT,`allow_ignore/respond/edit/accept`→按钮,**含改参数**) | 全 **MIT/Apache ✓** | **组合 adapt**:卡交互抄前两个 + **改参数按钮抄 agent-inbox** | 新 React 组件(A5);作用域 once/session/always = CTRL 自己 ~30 行策略 |
| **模糊排序 / frecency** | `fzf`(fzf-for-js,含 match positions 高亮)· `frecency`(Mixmax,频率+近因)· `command-score`(已内置在 cmdk) | fzf **BSD-3 ✓** / frecency **MIT ✓** / command-score **MIT ✓** | adopt | 面板排序(A2/A3);frecency 存 CTRL 本地库不用 localStorage(vault-is-truth) |
| **引擎已提供(白送)** | hermes-acp 0.16.0:`thought`/`tool_call`/`tool_call_update`/`plan`/`available_commands_update`/`usage_update`/`request_permission` | — | 已在发(实测) | kernel 已解析前 3 + thought(v13);其余待接 |

> **净增依赖(全部许可证已核实,兼容 AGPL 主体 + MIT 功能包)**:`cmdk` + `@tiptap/suggestion` + `@tiptap/extension-mention` + `@codemirror/merge` + `fzf` + `frecency` + 聊天壳(assistant-ui **或** AI Elements copy-in)—— 6+1 个小包,其中 4 个是**扩展 CTRL 已有的 Tiptap(×2)/ CodeMirror 6(×1)**。**避雷**:`@nlux/react`(MPL-2.0 + 禁作 AI 训练数据条款)、Open WebUI(改版 MIT 品牌条款 + Svelte)—— 只参考不用。novel 是 Apache-2.0(非 MIT),抄 slash 文件要保留署名。

---

## C. 优先级 roadmap(细化到里程碑)

1. ✅ **思考 + 工具轨迹**(§8.6.1,done v13,live 0.1.852)
2. **打地基:adopt ACP SDK + codegen `schema.json`** —— 退手写解析,拿到 permission/plan/diff/usage/modes 全套维护类型。**其余能力都长在这上面。**
3. ★ **审批卡(moat,A5)** —— `request_permission` 现被自动放行,改弹卡;唯一 terminal 前端专属 + 正中数据主权护城河
4. **命令面(A2/A3/A4)** —— `/` 菜单(cmdk)+ sigil + `@`mention(Tiptap)+ ↑ 历史;菜单教快捷键
5. **状态条(A8)** —— 上下文健康彩条 + engine + 后台任务
6. **Plan 面板(A6)+ Diff 审查(A7)** —— ACP `plan` + CodeMirror merge
7. **会话 fork/checkpoint(A9)**
8. **Blocks 卡片(A10)**

---

## D. 一句话给开发

**地基先行(adopt Apache-2.0 ACP SDK + codegen schema)→ 审批卡(moat)→ 命令面 → 状态条 → plan/diff → 会话 → blocks**。Zed 的 UI 只读学交互(GPL 不抄),UI 组件全用 MIT/Apache 的 cmdk + Tiptap + CodeMirror-merge + agent-inbox 重写进 CTRL 的 React/PWA 栈。引擎(hermes-acp)该发的事件都已在发,主要工作在 PWA 渲染 + kernel 转发 ACP 类型。
