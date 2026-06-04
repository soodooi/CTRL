# Irisy 系统梳理 — 管线 + 能力分解 (2026-06-04)

> bao 2026-06-04: "梳理清楚 Irisy 逻辑+管线 可以全网调研" + "助理能力要分解"
>
> 本 doc 整合现状代码 trace + 5 家业界对标 (Pi / Letta / Cline / Goose / Anthropic 2026 Agentic Trends), 不修代码; 拿到共识后再切实施.

---

## TL;DR (3 句)

1. **Pi 实际跑 0 工具** — ctrl-pi-plugin 用 `--no-tools` + ctrl-pi-bridge 只 `registerProvider` 不 `registerTool`, Pi 没 native tool 可调. 测试里 Pi 说"我没 skill 系统" 不是幻觉, 是事实.
2. **`<call>` XML 协议跟潮流反** — Letta v1 deprecate ReAct/XML 用 native function calling, Cline 用 Anthropic native tool use, Goose 用 MCP. 只有古 ReAct 还用 XML. CTRL 重新发明了一个低效协议.
3. **Pi 自己有 Skills 系统** (`~/.pi/agent/skills/` + `/skill:name` + `--skill` flag) — CTRL 完全没接, 自己造 `list_local_skills` Tauri command. 重复造轮子.

**结论**: Irisy ≠ Pi. Pi 是 chat brain, Irisy 应该是**Pi extension 注册的能力集 + 子能力分解 prompt**. 路要走 native function calling, 不走 XML.

---

## § 1 现状管线 (代码 trace)

```
┌─────────────────────────────────────────────────────────────────────┐
│ L0  User                                                            │
│     • textarea / hotkey trigger / /?text= prefill                   │
└─────┬───────────────────────────────────────────────────────────────┘
      │ trimmed string
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L1  PWA — IrisyChat.tsx :: sendMessage                              │
│     • buildSystemPrompt(): monolithic block ≈ 200 行                │
│       - IRISY_SYSTEM_DEFAULT v6 (~150 行, 一坨)  ❌ 不分能力        │
│       - <brain_state> block (engine + providers + last_failover) ✓  │
│       - core_memory (vault/.irisy-memory/) ✓                         │
│       - SOUL.md body + frontmatter (x-ctrl:lessons 注入点 ❌ 未写)   │
│       - installed_keycaps list ✓                                     │
│     • history = [system, ...prev, user_turn]                         │
└─────┬───────────────────────────────────────────────────────────────┘
      │ LLMMessage[]
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L2  Tauri — commands/irisy_chat.rs :: irisy_chat_stream             │
│     • SKILL.md prepend if skill_id                                  │
│     • Coding mode header prepend if mode == 'coding'                │
│     • POST 127.0.0.1:17874/mcp text.chat (Pi MCP server)            │
└─────┬───────────────────────────────────────────────────────────────┘
      │ JSON-RPC tools/call text.chat
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L3  Pi MCP server — ctrl-pi-plugin/src/mcp-server.ts (PID 17874)   │
│     • thin wrapper: text.chat → PiBridge.chat()                     │
│     • SSE streamback to L2 (delta / done / error)                   │
└─────┬───────────────────────────────────────────────────────────────┘
      │ chat({messages, model, cwd})
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L4  Pi subprocess — ctrl-pi-plugin/src/pi-bridge.ts                 │
│     • spawn `pi --no-tools --extension ctrl-pi-bridge` ⚠ 全禁工具   │
│     • PI_PROVIDER=ctrl-bridge / PI_MODEL=default                    │
│     • RpcClient.prompt(assemblePrompt(messages))                    │
│     • Pi events: text_delta / message_update / agent_end            │
│                                                                      │
│     ctrl-pi-bridge extension (ctrl-pi-bridge/src/index.ts):         │
│     • pi.registerProvider('ctrl-bridge', {streamSimple}) ✓          │
│     • pi.registerTool(...) ❌ 完全没注册 → Pi 实际 0 工具           │
│     • streamSimple → POST kernel /text-chat → provider router       │
└─────┬───────────────────────────────────────────────────────────────┘
      │ SSE deltas back through L3
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L5  PWA tool-dispatch — irisy-tool-dispatch.ts (我 2026-06-04 加)   │
│     • parse closed `<call name="X">{...}</call>` blocks ⚠ Pi 不熟   │
│     • whitelist: list_local_skills / install_keycap / list_keycaps  │
│        / vault_write / vault_read                                    │
│     • invoke Tauri cmd → JSON.stringify result                      │
│     • formatResultsAsUserTurn → re-stream (max 5 iter)              │
└─────────────────────────────────────────────────────────────────────┘
```

### 真实数据流断点 (B1-B4)

| ID | 断点 | 后果 | 影响测试 |
|---|---|---|---|
| **B1** | Pi `--no-tools` + bridge 不 registerTool, Pi 没 native function | Pi 不会 (也不能) 调 vault/skills/keycap tool | "我没 skill 系统" |
| **B2** | XML `<call>` 协议是 prompt 教学的虚拟 tool, Pi native 倾向 function calling | Pi 不知道这是个真协议, 偶尔忽略 | 试 3 次有 1 次直接英文回 "I can't…" 不 emit XML |
| **B3** | monolithic system prompt ~200 行 8 件事 | Pi 抓不住重点, 优先记"装 cap"忘"先判断" | 一切动词都 install_keycap |
| **B4** | Pi 自己有 Skills (`/skill:name` + `--skill`), 没用上 | 重复造 list_local_skills + Pi 不知 `~/.claude/skills/` 是 skill | Pi 跟用户说"那不是我的概念" |

---

## § 2 助理能力分解 (Irisy 的"助理" = 8 子能力)

bao 指令: "助理能力要分解". 不再 monolithic, 拆成 8 个独立 capability — 各有触发词 / 工具集 / 输出格式 / 系统 prompt segment.

| # | Capability | 触发词 / 场景 | Tools (kernel) | 输出格式 | 现状 |
|---|---|---|---|---|---|
| **C1** | **Note Writer** | "写个笔记 / 草稿 X / 帮我写 md / draft a note / 总结这段并存" | `vault.write` | 1 行 ack + path link | ❌ Pi 想存 `~/Desktop/`, 不知道 vault |
| **C2** | **Cap Builder** | "做个键帽 / a key for X / 做个按钮 / 一键 X / 我经常 X" | `skill.list_local` + `keycap.install` | 一句话报新 cap | ❌ Pi 一切动词都建 |
| **C3** | **Cap Invoker** | "用 frontend-slide / 跑那个翻译键 / 运行 X cap" | `keycap.run` (新增) | 启 cap + 实时结果回传 | ❌ Tauri command 不存在 |
| **C4** | **Knowledge Retriever** | "我前几天写啥 / 关于 X 的笔记 / 搜下 vault" | `vault.search` + `vault.read` + `vault.tags` | 引用 (path:line) + 摘要 | ❌ kernel MCP 暴露了, prompt 没教 |
| **C5** | **Memory Curator** | bg trigger (idle 30min OR 5 turn) | `vault.read SOUL.md` + `vault.write` (`x-ctrl:lessons`) | 静默, 后台 | ❌ ADR-005 v3 §5 设计完, 0 行代码 |
| **C6** | **System Doctor** | "切 provider / 我用什么 model / Irisy 慢" | `brain.status` only | 一行指南 (指 Settings) | ✅ `<brain_state>` 注入正确 |
| **C7** | **Coding Companion** | Coding mode (project_dir 已设) | Pi 自带 read/write/edit/bash/grep + `vault.write` | code diff / 命令报告 | 🟡 Coding header 注入有, 但 `--no-tools` 把 Pi 工具也禁了 |
| **C8** | **Conversation** | "你是谁 / 哈喽 / Irisy 怎么样" | none | 自然语言, 短 | ✅ |

**核心观察**:
- C2 / C3 是不同方向: C2 = 装新 cap, C3 = 跑已装的. 现 prompt 把 C2 教得太狠, C3 完全没教.
- C1 / C2 边界靠"用户是不是说'键帽 / 按钮 / 经常 / 一键'触发词" 判断. v6 prompt 已经写, 但 monolithic 大 prompt 里淹没.
- C5 sleep-time subagent 不在前台路径上, 单独路线 (ADR-005 v3 §5).
- C7 需要 ctrl-pi-bridge 重新注册 Pi 工具 (撤 `--no-tools` 或注册替代品).

---

## § 3 业界对标 (Pi / Letta / Cline / Goose / Anthropic 2026)

### 3.1 Pi (我们的 brain) — `@mariozechner/pi-coding-agent` 0.73.1

来源: `~/.ctrl/pi/node_modules/@mariozechner/pi-coding-agent/README.md`

| 维度 | 现状 |
|---|---|
| **Philosophy** | "No MCP. No sub-agents. No plan mode. No background bash. Build with extensions." |
| **Default tools** | 4 个: `read` / `write` / `edit` / `bash`. **CTRL 用 `--no-tools` 全禁.** |
| **Extra built-in** | `grep` / `find` / `ls` (允许 `--tools <list>` allowlist) |
| **Extension API** | `pi.registerTool({name, ...})` + `pi.registerProvider({streamSimple})` + `pi.registerCommand` + hook `on('tool_call', ...)` |
| **Skills** | `~/.pi/agent/skills/<name>/SKILL.md` + `/skill:name` + `--skill <path>` flag. 自动 load, agent 可 auto-load. |
| **Prompt templates** | `~/.pi/agent/prompts/<name>.md` + `/name` expand |
| **Pi Packages** | npm/git, 含 `extensions + skills + prompts + themes` 一个 bundle |
| **Modes** | interactive / `--print` / `--mode json` / `--mode rpc` (CTRL 用 rpc) |
| **System prompt** | `.pi/SYSTEM.md` 替换 / `APPEND_SYSTEM.md` 追加 / `--system-prompt <text>` CLI |
| **Context files** | `AGENTS.md` + `CLAUDE.md` 自动 load (CTRL 没用) |
| **Sub-agents** | 不内建, "use tmux or build extension" |
| **Native tool calling** | YES — 透传 provider tool calling (Anthropic / OpenAI function calling) |

**CTRL 没用上的 Pi 能力**:
1. Pi 自带 Skills 系统 — CTRL 重复造 `list_local_skills` Tauri command
2. Pi 的 `--skill <path>` flag — CTRL 在 PWA 端拼 SKILL.md 作 system message (低效, 不走 Pi 内 caching)
3. Pi extension `registerTool` — CTRL 走 PWA XML 协议 (低效, 不走 Pi native function calling)
4. Pi context files (AGENTS.md) — CTRL 在 PWA 拼 prompt block
5. Pi `/skill:name` slash command — CTRL 在 PWA 自己造 cap selector

### 3.2 Letta (formerly MemGPT) — v1 (2026)

来源: https://www.letta.com/blog/letta-v1-agent + https://docs.letta.com/guides/agents/architectures/sleeptime/

| 维度 | Letta v1 |
|---|---|
| **Agent loop** | Native model tool calling, deprecates ReAct + heartbeats + `send_message` 特殊 tool |
| **Memory tier** | **3 层**: core memory (in-context blocks, agent 可 R/W) + archival memory (DB, search 时拉) + message buffer |
| **Memory blocks** | Labeled (goals / preferences / persona), 总是注入 prompt, agent 用 tool CRUD |
| **Sleep-time subagent** | 每 N=5 turn (默 sleeptime_agent_frequency=5) 触发, 主 agent + 主 agent 同时跑 |
| **Sleep-time 工作** | 读主 agent message history, 生成 "learned context" 写回 memory block (直接 CRUD) |
| **Sub-agent (Task tool)** | Letta Code: spawn 独立 Letta 进程, 自己 system prompt+tools+model, 终态 message 回主 agent, 主 agent context 干净 |
| **Sub-agent worktree** | git-based 隔离, 多个 subagent 并发写, merge 通过 git conflict |
| **Tool 协议** | Native (provider 决定 — OpenAI function calling / Anthropic tool use), 不再 XML |

**Letta 给 CTRL 的启示**:
1. **Memory blocks** ≈ CTRL `vault/.irisy-memory/*.md` + SOUL.md. CTRL 设计在轨, 实施 lag.
2. **Sleep-time every 5 turn** — 跟 ADR-005 v3 §5 (idle 30min + 5 episode + user-asked) 设计一致, 数字也一致.
3. **Subagent worktree (git-based)** — CTRL 没需要, vault 是单写者.
4. **Native function calling** — CTRL 应该撤 XML.

### 3.3 Cline — VSCode AI agent v3.81 (2026)

来源: https://github.com/cline/cline + https://cline.bot/

| 维度 | Cline |
|---|---|
| **Tool 协议** | Anthropic native tool use (function calling) — 不是 XML |
| **Plan / Act mode** | Plan = explore + clarify + strategy; Act = 执行. 两 mode 切换. |
| **Approval** | 默认 every edit + every command 要批准. Auto-approve toggle (per-tool 粒度) |
| **MCP-ready** | 是 — 用户加 MCP server, Cline 接 |
| **Max iter** | (文档没说, 大概 ~25-50) |

**Cline 给 CTRL 的启示**:
1. **Plan/Act mode** ≈ CTRL Coding mode vs Personal mode, 但 Cline 是同一 agent 两 mode, CTRL 应该效仿
2. **Per-tool approval toggle** — CTRL 当前是 zero-approval (Pi 自治), 未来加 settings 控制
3. **Anthropic native tool use** — Cline 不发明 XML, 直接用 provider native. 我们应该一样.

### 3.4 Goose (Block) — 29k stars (2026)

来源: https://goose-docs.ai + https://aaif.io/blog/where-new-mcp-ideas-go-to-become-real-goose-as-a-proving-ground/

| 维度 | Goose |
|---|---|
| **Tool 协议** | **MCP-first** — 第一个公开 MCP client, 3000+ MCP servers 可接 |
| **Extension** | `goose configure` → "Add Extension" → 输入 MCP server URL |
| **AGENTS.md** | Linux Foundation AAIF 项目 (跟 Anthropic MCP + OpenAI AGENTS.md 同期 founding project) |
| **Recipes** | YAML-defined workflow, 类似 CTRL keycap manifest |

**Goose 给 CTRL 的启示**:
1. **MCP-first** — CTRL kernel MCP server (17873) 已存在, 但 Pi 没接. 应该让 Pi 接 17873 (撤 `--no-tools` + 加 MCP extension).
2. **Recipes ≈ keycap manifest** — CTRL 方向对, 实施细节可参考.

### 3.5 Anthropic 2026 Agentic Coding Trends Report

来源: WebSearch consensus (libertify.com / pathmode.io / agentailor.com)

| 主张 | Anthropic |
|---|---|
| 2026 = single agent → coordinated agent teams | Yes, 主旋律 |
| Specialized agents per capability (implementation / testing / security) | Best practice |
| Orchestrator + specialized parallel | 是 |
| Engineer 价值转向 "task decomposition + agent coordination + quality eval" | 战略 |
| Context engineering > prompt engineering | Yes |

**Anthropic 给 CTRL 的启示**:
1. Irisy 单 agent → 单 agent + specialized capability segment (Phase A) 或 多 agent (Phase B+, 不急)
2. 不是必须搞多进程, 用 **capability-aware prompt segment switching** 也算 task decomposition

---

## § 4 Cross-cutting patterns (5 家共识)

| Pattern | Letta | Cline | Goose | Pi | CTRL 现状 |
|---|---|---|---|---|---|
| Tool dispatch host-side | ✓ | ✓ | ✓ | ✓ | ✓ (XML loop) |
| No-confirmation default | ✓ | ❌ (auto toggle) | ✓ | ✓ | ❌ (Pi 默 confirm 太多) |
| Memory tier ≥ 3 | ✓ (core/archival/buffer) | ❌ | ❌ (recipes) | ❌ (single context) | 🟡 (设计有, 实装部分) |
| Sleep-time subagent | ✓ (every N) | ❌ | ❌ | ❌ | ❌ (ADR-005 §5 设计) |
| **Native function calling > XML** | ✓ | ✓ | ✓ (MCP) | ✓ | ❌ **CTRL 用 XML** |
| **Capability decomposition** | ✓ (subagent) | ✓ (Plan/Act) | ✓ (recipe) | ❌ (philosophy) | ❌ **monolithic** |

**3 个 critical gap (按重要性)**:
1. **Pi 0 tool** (B1) — 应通过 `ctrl-pi-bridge.registerTool` 注册 5-10 个 native tool
2. **XML 协议** (B2) — 应撤 `<call>` 改 Pi native function calling
3. **monolithic prompt** (B3) — 应分 8 个 capability segment

---

## § 5 实施建议 (不切 phase, 一次 ship)

### Step A: ctrl-pi-bridge 注册 native Pi tools (B1 + B2 一起修)

**改 `packages/ctrl-pi-bridge/src/index.ts`**:
```ts
export default function (pi: PiExtensionApi) {
  pi.registerProvider('ctrl-bridge', { streamSimple });  // 已有
  
  // 新加 — 注册 ~10 个 native Pi tool, Pi 用 function calling 调:
  pi.registerTool({
    name: 'vault_write',
    description: 'Write a markdown note to the user vault (one-shot, no install).',
    schema: { type: 'object', properties: { path: {type:'string'}, content:{type:'string'}, frontmatter:{type:'object'} }, required: ['path','content'] },
    handler: async (args) => fetch(kernelUrl('/vault/write'), {method:'POST', body: JSON.stringify(args)}).then(r=>r.json())
  });
  // 同样: vault_read / vault_search / vault_tags / keycap_install / keycap_run / keycap_list / skill_list
}
```

**改 `packages/ctrl-pi-plugin/src/pi-bridge.ts:242`**:
```ts
- const args: string[] = ['--no-tools'];
+ const args: string[] = ['--no-builtin-tools']; // 禁 read/write/edit/bash, 保留 extension 注册的 tool
```

**后果**:
- Pi 看到 vault_write / keycap_install 等是 native function call (Anthropic tool use schema)
- 撤 PWA 端 `irisy-tool-dispatch.ts` XML loop (or 保留作 fallback)
- 撤 prompt 教 XML 那段 (~20 行省下)

### Step B: monolithic prompt → 8 capability segment

**改 `packages/ctrl-web/src/lib/irisy-prompts.ts`**:
```ts
export const IRISY_SYSTEM_BASE = `
  You are Irisy ... [persona + brand label + reply style, ~30 行]
`;

export const IRISY_CAPABILITY_SEGMENTS = {
  note_writer: `## Note writing
  When the user says "write a note about X" / "draft a markdown of Y"...
  Call vault_write directly. One-line ack with path.`,
  
  cap_builder: `## Building reusable keycaps
  ONLY fire when user said "键帽 / 按钮 / 键 / shortcut / key / a button for".
  ...`,
  
  // ... 8 个 segment, 每个 ~15-25 行
};

export function buildSystemPrompt(...): string {
  // v0.1: 全部注入 (~200 行, 但每段清晰)
  // v0.2: 关键词预判 → 只注 2-3 个相关 segment (省 token)
  return [
    IRISY_SYSTEM_BASE,
    formatBrainStateBlock(brainState),
    coreMemoryBlock,
    soulMdBlock,
    ...Object.values(IRISY_CAPABILITY_SEGMENTS),
    installedKeycapsBlock,
  ].join('\n\n');
}
```

### Step C: 用 Pi 自己的 Skills 系统 (撤 list_local_skills 重复)

**改 ctrl-pi-bridge 启动**:
```ts
// pi-bridge.ts ensureRpc()
const skillArgs: string[] = [];
const userSkills = await listClaudeSkills(); // 扫 ~/.claude/skills/ + plugin cache
for (const s of userSkills) skillArgs.push('--skill', s.path);
const args: string[] = ['--no-builtin-tools', ...skillArgs, '--extension', bridgeExt];
```

Pi 自动 load `--skill` 路径下的 SKILL.md, 暴露 `/skill:name` slash command. 用户在 Irisy chat 输入 `/skill:frontend-slide ...` 直达 Pi.

**Bonus**: Pi `--skill` 之外 还有 auto-load (放 `~/.pi/agent/skills/`). 我们可 symlink:
```
~/.pi/agent/skills/ → ~/.claude/skills/
```
让 Pi 自动 load 用户的所有 Claude skills.

### Step D (异步, 不阻塞 A-C): sleep-time subagent (ADR-005 v3 §5)

Crawl 路径 — `irisy-reflection.ts` (PWA-side) + 新 Tauri cmd `trigger_reflection` + vault writes `.irisy-memory/lessons-YYYY-MM-DD.md`. 详 ADR-005 v3 §5.

---

## § 6 Open questions (待 bao 拍)

1. **Step A 改 ctrl-pi-bridge 接受不?** — 这是核心修复, 大概 ~200 行 TS + 1 行改 `--no-tools` → `--no-builtin-tools`. 撤 `irisy-tool-dispatch.ts` XML 协议.
2. **Step B 8 个 capability segment 全注入 OK?** — 起初浪费 token (cache 后只首次浪费), 简单可控. 后续按关键词预判注入再优化.
3. **Step C 让 Pi 直接用 `--skill` flag, 撤 PWA 端 SKILL.md 注入** — 行不? 含义 = 用户可以在 chat 输入 `/skill:frontend-slide ...` 直达, 不需 cap mode wear/unwear UI.
4. **能力 C3 (Cap Invoker) 需新 Tauri cmd `keycap_run`** — 现在没? 还是有别名?
5. **能力 C5 (sleep-time) 现在做还是推后?** — 优先级 vs Step A-C?

---

## § 7 References (本 doc 引用)

- Pi README + CHANGELOG: `~/.ctrl/pi/node_modules/@mariozechner/pi-coding-agent/README.md` (本机)
- ctrl-pi-bridge src: `packages/ctrl-pi-bridge/src/index.ts`
- ctrl-pi-plugin pi-bridge: `packages/ctrl-pi-plugin/src/pi-bridge.ts`
- IrisyChat: `packages/ctrl-web/src/components/irisy/IrisyChat.tsx`
- Irisy prompt v6: `packages/ctrl-web/src/lib/irisy-prompts.ts`
- ADR-005 irisy v3 §5 (Self-reflection-loop): `.olym/decisions/005-irisy.md`
- ADR-001 spine v2 §8 (Self-evolution): `.olym/decisions/001-spine.md`
- Letta v1 blog: https://www.letta.com/blog/letta-v1-agent
- Letta sleep-time docs: https://docs.letta.com/guides/agents/architectures/sleeptime/
- Cline GitHub: https://github.com/cline/cline
- Goose docs: https://goose-docs.ai
- Anthropic 2026 Agentic Coding Trends: https://www.libertify.com/interactive-library/agentic-coding-trends-2026-anthropic-report/

---

## § 8 v2 校准 (background research agent 回报 2026-06-04 540s, 86 tool uses)

调研用 `gh api` 直接拉源码 (WebFetch sandbox 限), 拿到比我手拉更深的实施细节. 关键校准 + 补强:

### 8.1 校准 (改我前面的判断)

**× 校准 1: XML 协议 — Step A 不该立即撤**

调研发现 **Cline 还在用 XML tool tags** (`apps/vscode/src/core/prompts/system-prompt/components/tool_use/formatting.ts`), 不是我推测的 native function calling. Cline 用 XML 因为支持弱本地模型 (Qwen / DeepSeek), JSON function calling 这些模型不稳. **Cursor 2.0** 从 XML 切到 native (`CL4R1T4S/CURSOR/Cursor_2.0_Sys_Prompt.txt`).

调研结论: **CTRL Pattern D 默认走 Volc CF Workers AI (Qwen-3 / Llama-3.3), 跟 Cline 同处境**. XML 该保留 for v1, 等 frontier-only BYOK ship 后再切 native.

→ **Step A 改成**: ctrl-pi-bridge 注册 native Pi tool (修 B1 — Pi 0 tool 问题) **但保留 PWA XML loop 作为 fallback**, 给 Volc 路径用. Pi 的 native tool 给 BYOK (Anthropic / OpenAI) 路径用. dual-path.

**× 校准 2: Pi 实际有 7 个 built-in tools, 不止 4**

`packages/coding-agent/src/core/tools/` 有: `bash` / `read` / `write` / `edit` / `find` / `grep` / `ls`. Pi README §Quick Start 只提 4 个是简写. **撤 `--no-tools` 应改 `--no-builtin-tools` (而不是 allowlist 部分工具)** — 让 ctrl-pi-bridge 完全接管, 不给 Pi 默认 shell 在 vault 外乱写.

### 8.2 补强 (本 doc 没覆盖的细节)

**+ Pi `before_agent_start` 事件 — chained system prompt mutation**

Pi 内部 (`agent-loop.ts`): 多 extension 可 chain-mutate `event.systemPrompt` per-turn. CTRL 完全没用上 — 现在 ctrl-pi-bridge 只 registerProvider, 没 hook `before_agent_start`. 

这给 CTRL 一个**本来就有的钩子做 capability segment 注入**: 每 turn 根据 user message 动态注入需要的 segment, 不必 PWA 端拼 monolithic. **Step B 的更优实现**: kernel 多个 capability provider 各注册 `before_agent_start` hook, 各贡献一块 context block. Pi 自动按 extension 加载顺序 chain.

**+ Pi `tool_call` 事件 — `{block: true, reason}` 安全 inspector**

Pi 暴露 `pi.on('tool_call', ...)` — extension 可返回 `{block:true, reason:'...'}` 拦截 tool 调用. CTRL 当前 0 inspector, Goose 4-layer (Permission / Adversary / Egress / Security) + RepetitionInspector (检测 loop). 

→ **新 Step E (v1.1)**: ctrl-pi-bridge 加 inspector hook, 拦截 dangerous tool (shell `rm -rf`, vault_write 到敏感路径). 现在没 prompt injection 防护.

**+ Letta sleeptime_v2 prompt 是 reference 实现**

`letta/prompts/system_prompts/sleeptime_v2.py` 是工业级 sleep-time prompt: "You are Letta-Sleeptime-Memory… You run in the background, organizing and maintaining the memories of an agent assistant". Memory-edit tool: line-based add / del / replace + `rethink` (整块 rewrite) + `finish` (终止).

→ **Step D 实施时直接 port sleeptime_v2 模板**, 不重造. ADR-005 v3 §5 acceptance §5 提到的 "Letta-code pattern" 就是这个文件.

**+ Pi 没 MCP client = 永久限制, 但 wrapping cost ~10 LOC/cap, 不该换 brain**

调研结论: Pi `--extension <ts>` API 是唯一 seam 让 CTRL 注入 capability. 每加一个 kernel capability ~10 行 TS wrapper. **不换 brain**, 不要因为 "MCP-first" 跑去用 Goose.

**+ 双 max-iter 规范**: Cline 默 `DEFAULT_MAX_TURNS = 1000`, Goose `DEFAULT_MAX_TURNS: u32 = 1000`. Pi 0 cap, 信 stopReason. Cursor linter-fix 3 iter 内. CTRL PWA loop 我设 max=5, **应改 50** (内部 tool chain) + 跟 Pi 同 0 cap policy 信 stopReason 主路径.

### 8.3 共识 patterns (本 doc §4 增订)

| Pattern | Pi | Letta | Cline | Goose | Cursor | CTRL |
|---|---|---|---|---|---|---|
| Tool format | native | native | **XML** | MCP | native (was XML) | XML (保) |
| Memory tier | recency | 4-tier (core/archival/recall/buffer) | session | session+skills | sliding | 部分 |
| Sleep-time | ❌ | ✓ `sleeptime_v2` | ❌ | ❌ | ❌ | 设计中 |
| MCP client | ❌ | ❌ | ✓ | ✓ | ✓ | (Pi 不接) |
| Max iter | trust stopReason | tool rules | 1000 | 1000 | linter 3x | should=stopReason |
| Pre-turn hook | `before_agent_start` chain | templated per agent type | TemplateEngine | prompt_manager | static | ❌ 该加 |
| Tool inspector | `tool_call` block | ToolRulesSolver | ToolPolicy | 4-layer chain | none | ❌ 该加 |
| Anti-confirm | guideline | tool rules | hooks | inspector | "Bias towards not asking" | v6 加了 |
| Identity lock | ❌ | ✓ | ✓ | ✓ | ✓ (Composer hard refuse) | ✓ |
| Code-as-action | ❌ | ❌ | ❌ | ❌ | ❌ | n/a (OpenInterpreter only) |

### 8.4 修正实施顺序 (v1 → v2)

**Step A v2** (修 B1 + 不立即撤 XML):
- ctrl-pi-bridge `registerTool` ~10 native Pi tool (frontier path)
- `--no-tools` → `--no-builtin-tools` (撤 Pi 默认 7 工具)
- **保留 PWA XML loop** 作 Volc 路径 fallback
- ctrl-pi-bridge 加 `pi.on('before_agent_start', ...)` hook — kernel 多 capability provider chain-inject context block (Step B 的实施 substrate)
- ctrl-pi-bridge 加 `pi.on('tool_call', ...)` inspector hook (粘 1 个 stub, Step E 真填规则)

**Step B v2** (capability segment via chained `before_agent_start`):
- 不在 PWA 端 buildSystemPrompt, 改在 kernel-side capability providers
- 每个 provider (note_writer / cap_builder / cap_invoker / retriever / curator / doctor / coding / chat) 注册 `before_agent_start` hook
- hook 看 user message 关键词, 决定贡献 0-2 个 capability segment

**Step C** (Pi `--skill` flag): 不变.

**Step D** (sleep-time): port `sleeptime_v2.py` 到 PWA-side `irisy-reflection.ts` + Tauri cmd. ADR-005 v3 §5.

**Step E** (v1.1, 新加): inspector chain (Permission / Adversary / Egress + RepetitionInspector for tool loop detection). 拦截 dangerous tool calls.

### 8.5 待 verify (调研提的 open question)

- **Pi session per turn**? — pi-bridge.ts 看是单 RpcClient 持续 (`ensureRpc()` 单例), 不每 turn reset. 那 Pi 自己 compact 处理 context. 但 PWA-side `messages[]` array 每次 sendMessage 都全送 — **重复**. 应该: PWA 只送 incremental user turn, Pi 自己保 conversation state. (verify 后改)

## § 9 References (v2 加)

- pi-mono actual repo: https://github.com/badlogic/pi-mono (npm `@mariozechner/pi-coding-agent` 之 source)
- letta sleeptime_v2 prompt: `letta-ai/letta` `letta/prompts/system_prompts/sleeptime_v2.py`
- letta sleeptime multi-agent: `letta-ai/letta` `letta/groups/sleeptime_multi_agent_v3.py`
- Cline XML formatting: `cline/cline` `apps/vscode/src/core/prompts/system-prompt/components/tool_use/formatting.ts`
- Cursor 2.0 leaked: `elder-plinius/CL4R1T4S` `CURSOR/Cursor_2.0_Sys_Prompt.txt`
- Goose security inspectors: `block/goose` `crates/goose/src/security/`
- Goose mcp_client: `block/goose` `crates/goose/src/agents/mcp_client.rs`

---

## Changelog

- **v1 2026-06-04**: initial brain dump after bao asked "梳理逻辑+管线" and "助理能力要分解". L4 trace (Pi `--no-tools` + bridge no-tool finding) + 5 external benchmarks + 8-capability decomposition + 4-step implementation plan.
- **v2 2026-06-04**: amend with background research agent findings (540s, 86 tool uses, gh api深拉源码). Critical calibration — XML 协议保 for v1 (Cline 同处境跑弱模型, CTRL 默 Volc Qwen 也弱). 加 Pi `before_agent_start` chain hook + `tool_call` inspector hook 设计. 新增 Step E (inspector chain). port Letta sleeptime_v2 to Step D.
