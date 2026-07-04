---
name: debug-irisy
description: Disciplined root-cause loop for fixing Irisy's BEHAVIOUR — when Irisy is "not smart", answers with a feature list instead of doing the job, shows the wrong soul/identity (e.g. still says "副驾驶/co-pilot"), can't see tools, "can't browse", forgets, or routes wrong. Use BEFORE editing any prompt/soul/brief file. Enforces: locate the ACTUALLY-LIVE truth source first, build a real red→green test on the running app, change ONE source, re-test on the live app. Adapted from hermes systematic-debugging (NousResearch, MIT) + CTRL dev-loop. Living doc — if the loop is wrong, fix the skill first.
---

# debug-irisy — 调试 Irisy 行为的纪律循环

> 改编自 hermes `systematic-debugging` skill(4-phase 根因法, MIT)+ CTRL `dev-loop` 三层验证。
> **真相源参考**: 引擎操作层 → [[hermes]] skill; 架构 → `vault/ctrl/architecture-byo-cli-driver.md` + ADR-005 §9。
> **这是 living doc** — 按它做的过程中发现流程漏了/错了, **先改这个 skill, 再继续调试**(bao 2026-06-29 钦定: "如果 skill 有问题, 我们先改 skill")。

## 为什么要这个 skill(它治的病)

Irisy 的行为由**多个真相源**决定, 而**实际生效的那个, 常常不是你以为的那个**。
2026-06-29 血泪教训: 为了把 Irisy 的魂从"副驾驶"改成"运营官", 改了 `vault_seed/irisy-soul.md` + `irisy-prompts.ts` + ADR —— 全部方向对、**全部改错文件**。真机一测还是"副驾驶", 因为 hermes 引擎实际读的是 `~/.hermes/SOUL.md`(一个没有任何代码在管的**孤儿运行时文件**)。三刀白费, 就因为没先定位"实际生效的源"。

## Iron Law(铁律)

> **NO EDIT WITHOUT LOCATING THE LIVE TRUTH SOURCE FIRST, AND NO "DONE" WITHOUT A LIVE RED→GREEN.**
> 改任何 prompt/soul/brief 之前, 先证明"这个文件就是当前这条路径实际读的"; 改完之前, 先在**运行中的 app** 上看见 红→绿。源文件改对 ≠ 生效(可能编译期嵌入要重启 / 可能是孤儿运行时文件 / 可能走的是另一条路径)。

## 四阶段

### Phase 1 — 复现 + 建红绿 tight loop
1. **拿到症状原文**: Irisy 实际回复的那句话(用户截图/粘贴), 不要转述。
2. **建一个固定的红绿探针**: 一句**固定的话**问 Irisy, 定义什么是红、什么是绿。例:
   - 探针 = 问 "你是谁?能帮我做什么?"
   - 🔴 红 = 出现旧魂词(副驾驶/co-pilot/keycap)/ 报功能清单 / "我可以: A、B、C…"
   - 🟢 绿 = 运营官姿态(替你把整件事做完 + 记住你的生意 + 反问一个具体的活)
3. **agent 自己跑探针 — 不要外包给用户**(bao 2026-06-29: "你不能直接调试吗?直接看 Irisy 真实回复?")。直接起 Irisy 的引擎拿真实回复:
   ```bash
   # hermes 完整 CLI 经 kernel-bootstrapped uvx 起 (本地 launcher `tirith` 只有 setup/trust)。
   # -z = 单次 headless prompt; --yolo 免确认挂起; --cli 免 TUI。读 ~/.hermes/SOUL.md, 用 config.yaml 的 model。
   ~/.ctrl/bin/uvx --python 3.12 --from hermes-agent==0.16.0 hermes -z "你是谁？能帮我做什么？" --yolo --cli
   ```
   这条**真实调模型**(同一引擎、同一 `~/.hermes/SOUL.md`) —— **魂层(身份/口吻/不演 persona)可自验**。但 oneshot **不连 gate**(没 ctrl 的 vault/整理工具), 所以验"带 gate 的能力面"要下面两个方法。其它自助命令: `hermes status` / `hermes doctor` / `hermes logs -f --component tools`。

   **关键真相(2026-06-29 证伪了旧的"够不着 gate"结论, 别再信那个)**: gate token **不是** per-boot 内存随机 —— 它**稳定持久化在 `~/.ctrl/state/gate-token`**(mode 0600, `resolve_stable_gate_token`, mcp_server.rs)。**读对这个文件, 就能完全从外部端到端自测 Irisy 的 gate 能力**, 不必外包给用户 app。(我之前读错文件 `.mcp.json`/`kernel-handshake.json` 都是旧的/占位, 才误判"够不着"。)

   - **方法 A — curl 直连 gate(验工具投影 / 直接调工具)**: streamable-http MCP, 你能设任意 header(含 gate 认 first-party 所需的 `x-ctrl-caller: hermes`):
     ```bash
     TOKEN=$(cat ~/.ctrl/state/gate-token)
     # initialize 拿 mcp-session-id, 再 tools/list / tools/call。Accept 要含 text/event-stream(响应是 SSE: data: {...})
     curl -s -D - -X POST http://127.0.0.1:17873/mcp \
       -H "Authorization: Bearer $TOKEN" -H "x-ctrl-caller: hermes" \
       -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
       -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"p","version":"1"}}}'
     ```
     验"我投影的工具到了没"/"工具真能调"。python 模式见 `scratchpad/gate.py`(initialize→tools/call, 解析 SSE `data:` 行的 `result.content[0].text`)。

   - **方法 B — ACP 客户端让 hermes *自己* 用 gate(完整端到端, bao 的"hermes 来做, 你模拟用户")**: 自己 spawn `hermes-acp` 走 ACP(newline-delimited JSON over stdio), 跟 `acp_client.rs` 一模一样。两个坑: ① 启动命令**必须加 `--with mcp>=1.24`**(`hermes-agent[acp]` 不带 mcp 包 → `_MCP_AVAILABLE=False` → session/new 的 mcpServers 静默被丢, brain 看到 ZERO CTRL 工具); ② `session/new` 的 `mcpServers` 里塞 ctrl gate + `x-ctrl-caller: hermes` header。流程: `initialize`(protocolVersion **1**) → `session/new`{cwd, mcpServers} → `session/prompt`{sessionId, prompt:[{type:text,text}]}, 边读 `session/update`(agent_message_chunk=回复文本, tool_call=它调的工具) 边应答 `session/request_permission`(选 `allow_once`)。完整脚本 `scratchpad/acp_run.py`(token 从 env `CTRL_AUTH` 注入避免 hook, 不写进 .py)。**这能看到 hermes 自己调了哪些 `mcp_ctrl_*` 工具 —— 真·端到端。**
4. 探针必须**只对这个 bug 变红**。没有探针不许往下。

### Phase 2 — 定位 ACTUALLY-LIVE 真相源(本 skill 的核心, hermes 原版没有)
先确定**这次走的是哪条路径**, 再查那条路径**实际读的文件**。

**两条路径**(`irisy_chat.rs` `use_agent` 决定):
- **hermes ACP 引擎**(默认): `engine=hermes` 且非 coding、非 `direct` mode、hermes 已装 → 走 `acp_client.rs`。引擎**自持** loop/memory/context。
- **provider-direct / PWA**(fallback): coding mode / `direct` mode / hermes 没装 → 走 PWA 的 composed system prompt。

**Irisy 真相源 map**(改之前对号入座 —— 默认 hermes 引擎路径生效):

| 你想改 | 看起来该改(常踩坑) | hermes 引擎路径**实际读的** | 怎么确认 |
|---|---|---|---|
| 魂 / 身份 / 口吻 | `vault_seed/irisy-soul.md`, `irisy-prompts.ts` | **`~/.hermes/SOUL.md`**(每轮读; 孤儿运行时文件, 无代码同步) | `cat ~/.hermes/SOUL.md`; 真机问"你是谁" |
| 能力意识 / 工具 | `irisy-prompts.ts capabilityListForPrompt()` | `acp_client.rs::CTRL_CAPABILITY_BRIEF`(每轮注入第一句) | 真机问"你能做什么"; grep BRIEF |
| 记忆 / 记住的事 | `vault/irisy/SOUL.md`(seed) | `~/.hermes/memories/MEMORY.md` + hermes 内建 `memory_enabled`(私有双写) | `cat ~/.hermes/memories/MEMORY.md` |
| 模型(为什么"笨") | — | `~/.hermes/config.yaml` `model.default` | `grep model ~/.hermes/config.yaml` |
| 走哪条路 | — | `irisy_chat.rs` `use_agent` / `engine` | grep `use_agent`/`force_direct` |

> ⚠️ PWA 路径(`irisy-prompts.ts` v14 + `vault/irisy/SOUL.md`)只在 fallback 时主导。日常对话默认 hermes 引擎 —— 改 PWA 文件对默认路径**可能无效**。先确认路径!

读错误/日志: hermes 完整版 `hermes logs -f --component tools|agent` + `display.tool_progress: verbose`; gate `audit_calls`(event-store.db)是工具调用 ground truth(memory `read-audit-ledger-not-guess-irisy`)。本地 bundle 的 `~/.hermes/bin/tirith` 只有 setup/trust, **没有** logs/doctor(那是上游完整 CLI)。

### Phase 3 — 假设 + 单变量测试
1. 列 1–3 个可证伪假设(例: "副驾驶来自 `~/.hermes/SOUL.md` 而非 vault seed")。
2. **一次只动一个变量**验最高排序的(例: 只改 `~/.hermes/SOUL.md`, 不动别的, 真机复测)。
3. 不确定就停下问 bao, 不要猜着批量改。

### Phase 4 — 改实际源 + 真机变绿
1. 改 **Phase 2 定位到的那个实际生效的源**(不是"看起来对"的)。
2. **让改动真生效**: `include_str!` 嵌入的 → 重编译 + 重启; 孤儿运行时文件(`~/.hermes/SOUL.md`)→ 直接写**但同时落代码做持久同步**(否则下次漂回去); 配置 → 重启 app 重投影。
3. **真机跑 Phase 1 探针, 亲眼看见 🟢**。源改了但探针还红 = 没修好, 回 Phase 2(很可能源定位错了)。
4. **持久化**: 运行时改完, 必须有代码保证下次启动还在(把孤儿文件纳入 seed/同步)。临时手改 = 治标, ADR/代码 = 治本。
5. **Rule of Three**: 同一症状改 3 次还红 → 停, 怀疑架构(很可能真相源散了 = ADR-005 §9 病根, 该合并成单 spine)。

## 红旗(看到就回 Phase 1/2)
- 改了源文件就报"完成", **没在运行中的 app 上复测**。
- 改"看起来对"的文件, **没先确认它是这条路径实际读的**。
- 一次改多个文件(魂同时改 4 处), 分不清哪个生效。
- 凭 Irisy 自己的叙述判断它做了什么(它会描述没发生的工具调用 —— 看 audit/日志/真机回复, 别信叙述)。

## 与 CTRL 流程的关系
- 这是 `dev-loop` 在"调 Irisy 行为"场景的专用化: dev-loop 的三层验证(编译/kernel smoke/视觉)在这里**第三层 = 真机问 Irisy 探针**。
- 修完若涉及架构(真相源散乱)→ 按 ADR-005 §9.5 收口(合并成单 spine), 不只补丁。
