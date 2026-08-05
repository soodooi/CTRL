---
title: Irisy terminal 前端优势 — 全网调研 + CTRL 兑现图 (governing 参考)
kind: reference
created_at: 2026-07-04
owner: bao
author: claude
purpose: bao「前端也是有不一样的地方，要发挥 terminal 前端优势；分析一下 / 再补全面一些，全网调研」。5 面并行调研(9 个 agentic CLI + 终端复兴 UX + agent 透明/审批 + 终端/REPL HCI 基元 + 键盘优先消费级),交叉验证后合成的「terminal 前端优势 → CTRL 友好皮肤兑现」真相图。驱动 ADR-005 §8.6.2。
source: 5 个后台调研 agent 的一手来源报告(2026-07-04),非记忆。每条 URL 在下方 Sources。
related:
  - "[[architecture-byo-cli-driver.md]]"
  - "[[irisy-capability-resource-inventory.md]]"
---

# Irisy terminal 前端优势 — 全网调研合成

> **元命题(5 面一致收敛)**:terminal 前端的威力 **可以和 shell 语法解耦** —— 保留**语义**(可命名可重复的动作 / 可寻址输出 / 键盘优先流 / 环境上下文常驻 / plan-then-approve / 可逆),把**交付** GUI 化,丢掉裸 shell 的模式/信号/转义码/DSL。这正是 **Zed ACP + Warp** 做的事,也正是 CTRL「terminal 本质 + 友好对话框(§8.1 not a raw shell)」该做的。**后端本质**已在 §8.6.1 发挥(思考+工具轨迹);本文是**前端轴**。

## 0. 一句话:terminal 前端的 5 条不可让渡属性(HCI facet 提炼)

对话框做不到、必须保留的:①**永远显示「下一步能做什么」**(补全)②**提交前什么都不触发**(行编辑缓冲)③**永远能中止**(SIGINT)④**过去可持久·可重跑**(历史)⑤**输出结构化可组合**(管道)。加上 agent 时代新增的第 6 条:⑥**plan-then-approve**(执行前先看、先批)。

---

## A. 输入 & 命令面(facets: agentic-CLI / 终端复兴 / 消费级)

| terminal 前端优势 | 谁 + 怎么做(证据) | CTRL 友好兑现 | 状态 |
|---|---|---|---|
| **一个召唤式模糊输入替代菜单** | Raycast Root Search / Superhuman·Linear·GitHub ⌘K / Arc ⌘T / Figma ⌘/ | CTRL 的 **Ctrl 唤起 → 意图浮现 1-3 模块**本就是这个;强化:模糊/语义、单一入口 | ✅ 已有 |
| **sigil 首字符 = 模式选择** | GitHub(`>`命令 `#`issue `@`用户 `/`文件 `!`项目)/ VS Code / Notion / Slack / Todoist | Irisy 输入:`>`跑能力 · `@`引用实体/联系人 · `#`引用 vault 笔记/表 · `/`slash 动作 · `:`跳转模块 | ⧗ |
| **`/` slash 菜单 = 可筛、自教** | 9 个 CLI 全有;ACP 把它做成 wire type(`available_commands_update`,含 `input.hint`) | `/` 出可筛菜单;引擎已发 `available_commands_update`(实测) | ⧗ |
| **自定义命令 = markdown 文件**(文件名即命令) | Claude Code/Codex/Gemini/opencode/Cursor 全是 `.md`/`.toml` | 正合 CTRL plain-text vault + gate 工具 `skill_read`/`skill_write` | ⧗ |
| **`@`-mention 模糊选择器** | Codex/Gemini/opencode/Crush/Cursor;Cursor 还有 `@Docs`/`@Web` 非文件源 | `@` 选 vault 笔记/表/联系人;比 Aider 的 add/drop 生命周期对非技术更友好 | ⧗ |
| **Ghost text 预测补全**(→/Tab 接受) | Fig / Amazon Q inline;**spec 驱动**(声明式 schema) | Irisy 输入灰字预测,**由 mcp manifest 的 arg 声明驱动**(类比 Fig spec) | ⧗ |
| **菜单顺带教它的快捷键**(最高杠杆) | VS Code 内联键位 / Raycast Action Panel「右侧显示快捷键」/ Superhuman「学会下次更快」/ Linear 可搜 `?` 速查表 | 每个动作旁显示快捷键;非技术用户被动习得键盘 | ⧗ |
| **两级递进**:Enter=主操作 / ⌘K=全动作面板 | Raycast(↵ 跑主操作,⌘K 出全部)/ Superhuman 上下文双击 | Enter 跑主意图;⌘K 出**上下文 Action Panel**(= drill-down/透明度的天然入口) | ⧗ |
| **自然语言 → 结构化** | Todoist 金标准(「每隔周四倒垃圾」→ 自动重复任务),Things 日期,Linear 过滤,Notion 提醒 | Irisy 前门:写一句话,抽 date/entity/module/priority + **逐 token 实时补全**(存在则选、不存在内联建) | ◑ 部分(NL 本就是 Irisy) |
| **无匹配 → 路由给 AI**(不 dead-end) | Raycast Quick-AI fallback / Alfred fallback | 无命中 → 经 `:17873` gate 交给 Irisy/Hermes | ⧗ |
| **frecency 学习排序** | Raycast(记录 + 文档化)/ Spotlight | 常用能力自动上浮,不用记名字;合 CTRL「规模在注册表不在 UI」 | ⧗ |
| **注册表合并命令**(能力增、界面不变) | Raycast 扩展 / Slack apps / Figma 插件 / VS Code 扩展 | 每个装的功能包/MCP/skill 都进同一个 bar | ⧗ |
| **<100ms 速度是前提** | Superhuman(100ms 是感知上限,目标 <50ms) | 已有记忆「trivial chat 直连模型不走整 agent loop」;面板/补全预算 <100ms | ◑ |

---

## B. 透明度 / 工作轨迹(facets: agentic-CLI / agent-透明)—— 后端已发挥,前端可补

| 优势 | 谁 + 怎么做 | CTRL 兑现 | 状态 |
|---|---|---|---|
| **折叠的、流式、summarized 思考块** | ChatGPT + Claude 都从 raw CoT 走到 **summarized**(raw 既不忠实也不友好) | 「Thinking」折叠轨迹 | ✅ v13 已做 |
| **实时 tool-call 状态 + 可展开细节** | ACP `tool_call`→`tool_call_update`(pending→in_progress→completed/failed);`locations` 让 UI「跟着 agent 走」 | 步骤 chip ◐→✓,drill-down 看 raw I/O | ✅ v13 已做(可补 status 种类 + locations 跟随) |
| **步骤/活动 ticker**(不是 spinner) | Perplexity「Researching…」阶段条 / Manus todo | 一行「读你的 CRM… 起草更新…」当一等 UI | ◑ |
| **provenance drill-down** | Perplexity 内联 citation chip + hover 预览源;Claude/v0 Preview⇄Code 切换 | citation chip + hover 到 raw;**audit ledger = 透明度制品** | ⧗ |
| **plan + 实时 task-list** | Warp 富文本 plan / ACP `plan` entries(content+priority+status,每次全量重发) | 展示「将发生什么 + 进度」 | ⧗ |

---

## C. Human-in-the-loop / 审查门(facet: agent-透明 + CLI 审批)★ CTRL 的 moat

**行业最佳实践,直接给 gate**:一张**条件触发、可就地改参、可选作用域、同轮暂停**的审批卡。

- **门的位置**:模型选了写动作**之后**、执行**之前**(LangGraph `HumanInTheLoopMiddleware`);**副作用写操作 deferred 到 approve 之后才真跑**(LangGraph 硬教训:node 恢复时从头重跑 → pre-approval 必须幂等,写在 resume 之后)。
- **三选一 = approve / deny / EDIT-args**(不是 yes/no):LangGraph `edit` / Copilot 展开改参 / Agent Inbox `allow_edit`。
- **作用域**:一次 / 本会话 / 本工作区 / 永远(Copilot)= **ACP 4 值枚举** `allow_once`/`allow_always`/`reject_once`/`reject_always`(实测 CTRL 现在**自动放行**这个请求)。
- **auto-vs-ask 四法可组合**:静态 allowlist(Cursor/Claude)+ **classifier 判定**(Cursor auto-review / Claude auto,「手动审查与无护栏之间的中间地带」)+ **分级置信 hold**(Devin 🟢自动/🟡🔴等批 + 软 30s 超时)+ **条件谓词**(LangGraph `when` = 只 gate 写 / 非 SELECT SQL / 目录外)。
- **按可逆性 × 代价分级**(NN/g + HAX G9-C/G10-A):可逆低风险 → **直接做 + Undo**(别 cry wolf);不可逆/花钱/外部副作用 → 卡确认(**具体后果句 + 动作标签按钮**「发送发票/取消」,不是「确定吗」);批量销毁 → 输入名字/长按。
- **gate 强制,不是模型**(Claude Code:enforced by client not the model)。
- **避免审批疲劳**(Anthropic:93% 批准率会麻木)→ 让门**智能**(风险分级 + 沙箱 + plan-first),不是取消门。

CTRL 现状:`select_allow_outcome` 永远选 allow —— **等于主动把 human-in-the-loop 扔了**。这是最高杠杆的缺口。

---

## D. 状态 / 会话 / 可逆(facets: agentic-CLI / REPL 基元)

| 优势 | 谁 + 怎么做 | CTRL 兑现 | 状态 |
|---|---|---|---|
| **会话 resume / list / fork / branch** | 全体;引擎 `initialize` 自报 `{fork,list,resume,loadSession}`(实测) | 历史 picker + 恢复 + 分叉一条支线 | ⧗(有历史抽屉,无 fork) |
| **文件态 checkpoint:代码+对话一起回滚** | Gemini `/restore`(shadow git)/ Claude `/rewind` | 正合 CTRL local-is-truth + 可逆;让试错低风险 | ⧗ |
| **可分享会话链接** | opencode `opncd.ai/s/<id>` / Warp 云同步链接 | 合「share and be shared」定位 | ⧗ |
| **detach/attach 持久**(关窗任务不停) | tmux;job-control 心智模型 | 后台任务托盘,关窗仍在,重开还在(合本地 daemon) | ⧗ |

---

## E. 常驻 chrome / 状态条(facets: 终端复兴 / agentic-CLI)

- **常驻 status line**:全体显示 model / context-% / tokens / cost / cwd / git。**友好翻译 = 彩色「上下文快满」条,不是 `142k/200k`**(Anthropic 自己的示例)。ACP `usage_update`(`used`/`size`/`cost`)是现成 wire type。Starship 的「每模块自动检测」= CTRL 上下文段。
- **CTRL 兑现**:一条常驻状态条 = 活跃模块 · provider/model · 同步/云状态 · 后台任务数 · 上下文健康条。
- **状态信号**(REPL 模式提炼):永远显示 Irisy 处于 idle / thinking / awaiting-confirmation —— 非技术用户**更**需要模式清晰。

---

## F. 输出 = 可寻址单元(Blocks)(facet: 终端复兴)

- **Warp Blocks**:每条命令+输出 = 一个可复制/搜索/筛选/pin/分享permalink/**喂给 AI** 的单元。**这是 CTRL「每个 L1 workspace + Irisy 路由输出」的终端界印证**。
- **CTRL 兑现**:每个 Irisy turn / 工具结果 = **可寻址卡片 + 友好动作**(重跑 / 复制结果 / 分享链接 / pin / 「问这个」)。
- **实体识别 → 可点动作**(WezTerm quick-select 的超集):输出里的日期/金额/联系人/发票号 → 可点。
- **就地渲染富输出,不甩给外部 app**(Kitty/Ghostty/Wave 天花板只到预览+图;CTRL 的 viewer registry 起点就在其上)—— 合「Ctrl 是唯一入口,用户不开第三方 app」。

---

## G. 保存的参数化动作(facets: 终端复兴 / 消费级)

- **Warp Workflows / Raycast Quicklinks**:命名的、`{{arg}}` 填空、可搜索、可分享的保存动作。**= CTRL「一 mcp = 一原子动作 + 参数」的填表 UX**,终端界证明了这个交互。
- **guarded placeholder**(Superhuman「发送前警告你填占位符」)= CTRL 写操作确认门的前端形态。

---

## ★ ACP = 现成的「前端↔大脑」契约(压轴发现)

ACP(Agent Client Protocol,Zed,「coding agent 界的 LSP」)是**唯一把 client↔agent 前端契约做成正式 spec** 的,几乎 1:1 映射 CTRL 的 `:17873` gate + projection。CTRL **已经在用 ACP 驱动 hermes**,架构真相源也早标它为未来通道。契约(全是 wire type):

- **8 个 `session/update` 变体**:`agent_message_chunk` · `agent_thought_chunk` · `tool_call` · `tool_call_update` · `plan` · `available_commands_update` · `current_mode_update` · `user_message_chunk`(CTRL kernel 现已解析前 3 个 + thought,v13)。
- **`session/request_permission`**:4 值枚举(allow_once/allow_always/reject_once/reject_always)→ **审查门的现成 schema**。
- **`tool_call`**:`kind`∈(read,edit,delete,move,search,execute,think,fetch,other) · `status` · `content`(可为 **`diff` 类型** oldText/newText → 逐 hunk accept/reject)· `locations`(跟随文件操作)。
- **`plan`** entries(content+priority+status)· **session modes**(`set_mode`,ask/architect/code)· **`usage_update`**(状态条数据源)。

**结论**:ACP 的 permission/tool_call/plan/usage/diff 类型 = CTRL gate 渲染「任意大脑之上的友好审查 UI」所需的**全部**。继续沿 ACP 扩前端,不自造协议。

---

## ✗ 该丢(裸 shell,撞 §8.1;最多 power-view)

alt-screen scrollback/搜索机制 · 权限规则 DSL(`Bash(git * main)`、glob last-match)→ 改用 Cursor 式**大白话规则** · `--yolo`/`--dangerously-skip`(footgun,至多藏 power-mode + 断路器)· leader-key/Ctrl-chord/vim 当**默认**输入 · 裸 token 账(`142k/200k`)→ 彩条 · 两轴审批 flag(`--sandbox`×`--ask`)→ 藏成简单预设「安全/让它改/全自动」· SEARCH-REPLACE 编辑格式内部 · 终端环境排障(鼠标上报/OSC52/tmux -CC)。

---

## 优先级(给 CTRL 的 moat + 已完成排序)

1. ✅ **已做**:思考轨迹 + 工具步骤(§8.6.1 优势 #2-3)。
2. ★ **inline 审批卡**(C 节)—— **最高杠杆**:唯一 terminal 前端专属 + 正中数据主权 moat + 已接好一半(ACP `request_permission` 现被自动放行)。改成 approve/deny/edit-args 卡 + 按可逆性分级 + defer 写到 approve 后。
3. **键盘/命令面**(A 节):`/` 菜单 + `@` 选择器 + sigil 模式 + 菜单教快捷键 + ↑ 历史回溯。
4. **状态条**(E 节):上下文健康彩条 + engine + 后台任务数。
5. **会话 resume/fork + checkpoint 回滚**(D 节)。
6. **Blocks**(F 节):turn/结果做成可寻址卡片 + 友好动作。

---

## Sources(一手,分组)

**Agentic CLI/TUI**:[Claude Code interactive-mode](https://code.claude.com/docs/en/interactive-mode) · [permission-modes](https://code.claude.com/docs/en/permission-modes) · [statusline](https://code.claude.com/docs/en/statusline) · [checkpointing](https://code.claude.com/docs/en/checkpointing) · [Codex CLI](https://developers.openai.com/codex/cli) · [agent-approvals-security](https://developers.openai.com/codex/agent-approvals-security) · [Gemini CLI keyboard-shortcuts](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/keyboard-shortcuts.md) · [trusted-folders](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/trusted-folders.md) · [Aider commands](https://aider.chat/docs/usage/commands.html) · [modes](https://aider.chat/docs/usage/modes.html) · [opencode tui](https://opencode.ai/docs/tui) · [permissions](https://opencode.ai/docs/permissions/) · [Crush](https://github.com/charmbracelet/crush) · [Warp agent overview](https://docs.warp.dev/agent-platform/local-agents/overview/) · [Cursor CLI](https://cursor.com/docs/cli/overview)

**ACP**:[overview](https://agentclientprotocol.com/protocol/overview) · [prompt-turn](https://agentclientprotocol.com/protocol/prompt-turn) · [tool-calls](https://agentclientprotocol.com/protocol/tool-calls) · [agent-plan](https://agentclientprotocol.com/protocol/agent-plan) · [session-modes](https://agentclientprotocol.com/protocol/session-modes) · [slash-commands](https://agentclientprotocol.com/protocol/slash-commands) · [session-usage](https://agentclientprotocol.com/rfds/session-usage)

**终端复兴**:[Warp Blocks](https://docs.warp.dev/terminal/blocks/) · [Command Palette](https://docs.warp.dev/terminal/command-palette/) · [Workflows](https://docs.warp.dev/knowledge-and-collaboration/warp-drive/workflows/) · [Wave](https://github.com/wavetermdev/waveterm) · [Fig autocomplete](https://github.com/withfig/autocomplete) · [Amazon Q inline](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-inline.html) · [iTerm2 shell integration](https://iterm2.com/documentation-shell-integration.html) · [Starship](https://starship.rs/config/) · [WezTerm quickselect](https://wezterm.org/quickselect.html)

**Agent 透明/审批**:[ChatGPT reasoning](https://openai.com/index/learning-to-reason-with-llms/) · [ChatGPT agent](https://help.openai.com/en/articles/11752874-chatgpt-agent) · [Claude visible thinking](https://www.anthropic.com/news/visible-extended-thinking) · [Claude connectors](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities) · [Claude Code auto-mode](https://www.anthropic.com/engineering/claude-code-auto-mode) · [Cursor security](https://cursor.com/docs/agent/security) · [Copilot approvals](https://code.visualstudio.com/docs/agents/approvals) · [Devin session-tools](https://docs.devin.ai/work-with-devin/devin-session-tools) · [Manus takeover](https://help.manus.im/en/articles/11711218) · [Replit plan-mode](https://docs.replit.com/references/agent/plan-mode) · [v0 versions](https://v0.app/docs/versions) · [LangGraph HITL](https://docs.langchain.com/oss/python/langchain/human-in-the-loop) · [interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) · [OpenAI computer-use](https://developers.openai.com/api/docs/guides/tools-computer-use)

**HCI / 设计指南**:[Bash line editing](https://www.gnu.org/software/bash/manual/html_node/Command-Line-Editing.html) · [readline(3)](https://www.man7.org/linux/man-pages/man3/readline.3.html) · [Job control](https://en.wikipedia.org/wiki/Job_control_(Unix)) · [ANSI escape](https://en.wikipedia.org/wiki/ANSI_escape_code) · [tmux](https://man7.org/linux/man-pages/man1/tmux.1.html) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [NN/g confirmation dialogs](https://www.nngroup.com/articles/confirmation-dialog/) · [MS HAX guidelines](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/) · [Google PAIR](https://pair.withgoogle.com/guidebook/) · [Anthropic effective agents](https://www.anthropic.com/research/building-effective-agents)

**消费级键盘**:[Raycast search-bar](https://manual.raycast.com/search-bar) · [action-panel](https://manual.raycast.com/action-panel) · [quicklinks](https://manual.raycast.com/quicklinks) · [Superhuman command palette](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/) · [Linear level-up](https://linear.app/features/level-up) · [VS Code tips](https://code.visualstudio.com/docs/getstarted/tips-and-tricks) · [GitHub command palette](https://docs.github.com/en/get-started/accessibility/github-command-palette) · [cmdk](https://github.com/pacocoursey/cmdk) · [Todoist quick-add](https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz) · [Things quick-entry](https://culturedcode.com/things/support/articles/2249437/)
