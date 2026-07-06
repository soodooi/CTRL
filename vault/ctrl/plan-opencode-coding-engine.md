---
title: OpenCode 集成方案 —— CTRL 的 coding 引擎(开源 / 模型无关)
kind: plan
created_at: 2026-07-06
owner: bao
author: claude
status: landed-v1-byo-driver
purpose: 把 coding 模块的引擎定为 opencode(自有集成,不包 Claude Code/Codex 商业品)
related:
  - "[[architecture-byo-cli-driver]]"       # ADR-001 spine §byo-cli-driver + §8.7 引擎槽
  - "[[capability-pack-map]]"                # coding = KOL 获客滩头
  - "[[create-feature-pack]]"                # 建包 skill(引擎无关,升级到完整-app 标准)
governing_adrs:
  - ADR-005 §8.7 (Irisy 引擎可选 hermes/Codex/Claude-Code → 加 opencode)
  - ADR-001 spine §byo-cli-driver (BYO-CLI driver 路径)
---

> **⚠️ 已落地的是 BYO-driver 路(不是下面 § 架构/Slices 写的 ACP-engine 槽)。** 一次 plan review 后改选:coding 场景直接在**投影工作区(vault 根)跑 `opencode` 完整 TUI**,projector 已投 gate(`opencode.json`)—— 零 ACP 接线、opencode 体验完整、合 spine §4。下面的「ACP 引擎槽 + S1-S5」是**被否的备选**(留作以后「聊天内轻量 coding」的可选增强,非 v1)。真相以 ADR-001 spine v10 + ADR-005 §8.7 v18 为准。

# 决策:coding 引擎 = OpenCode(不包商业 Claude Code/Codex)

**为什么不用 Claude Code / Codex**:成熟商业产品,直接包 = CTRL 成薄壳、依赖别人、有 ToS 灰区、不符合「卖工具不卖模型」。
**为什么 OpenCode**:MIT 开源(CTRL 自有集成)· 75+ provider + 本地 Ollama(模型无关,不逼用户有 Claude,免费地板 + BYOK 升级)· 原生 `opencode acp`(插进 CTRL 现成 ACP 槽)· MCP client(自动吃 `:17873` gate)· LSP + 160K★(强 coder)。

**分工**:hermes = 助理脑(Irisy 聊天,免费地板,不退役)。**opencode = coding 引擎**(coding 模块)。建包的结构化活在 gate 工具 + `create-feature-pack` skill(引擎无关)。

# 架构:插进已有的 ACP 引擎槽,不新造机制

```
Coding 场景 / Irisy 引擎选择器 (§8.7)
        │  选 opencode
        ▼
acp_client.rs  ──spawn──►  `opencode acp`  (line-delimited JSON-RPC / stdio)
   session/new ──passes──►  CTRL :17873 gate 作为 MCP server (build_mcp_servers)
        │                         │
        │                         ▼  opencode 拿到全部 gate 工具
        │                    (mcp_pack_* / smart_table_* / source_* / provision …)
        ▼
   opencode 跑在用户选的任意模型 (免费 CF/Ollama 本地 → BYOK Claude/GPT)
```

已复用(零新造):ACP 驱动(`acp_client.rs` 已驱动 hermes/codex/claude-code)· gate passthrough(`session/new` build_mcp_servers)· installer 脚手架 + `AgentName::Opencode` 枚举 · 前端引擎选择器 · provider 注入(`agent_env_injection`)。

# Slices

## S1 — 解封 + 接引擎(kernel)
1. **`agent_installer.rs`**:删掉 4 处 `"opencode retired — unwired"` 硬挡(144/156/208/214)。`npm_package(Opencode)` 从 `None`(79 行)改为 `Some("opencode-ai")`(或走 `curl -fsSL https://opencode.ai/install|bash` 脚本装,二选一,npm 更贴现有 codex/claude-code 路)。
2. **`acp_client.rs::engine_argv`**:加
   ```rust
   "opencode" => Ok(vec![resolve_or("opencode"), "acp".into()]),
   ```
   `resolve_engine_binary` 映射 `opencode` → 托管装的 `~/.ctrl/agents/opencode/.../opencode`(binary 名 `opencode`,64 行已是),否则 PATH。**注意**:opencode 是**自身二进制 + `acp` 子命令**,不是 codex/claude-code 那种 `npx <adapter>` —— engine_argv 直接跑 opencode 本体。

## S2 — 检测 + 露出(kernel + 前端)
3. **`agents.rs::list_byo_drivers`**:加 `opencode_present = is_installed(Opencode) || on_path("opencode")`(仿 codex/claude 117-119 行)。
4. **前端 `AgentSelector.tsx` / `settings.tsx`**:引擎选项加 opencode(「Coding · OpenCode(开源,任意模型)」),`present`/一键装状态同 codex。

## S3 — 模型接线(关键决策点)
opencode 从**自己的 `opencode.json` / 环境变量**读 provider+model。要让它用**用户在 CTRL 选的模型**(免费地板或 BYOK),需要一个 **opencode 配置投影**(仿 `write_hermes_config_yaml`):把 CTRL 的 active provider(base_url/key/model/protocol)写进 opencode 的配置。
- 复用 `agent_env_injection`(已按 shape 注 `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`)—— opencode 认标准 provider env,多数直接可用。
- 补一个 `write_opencode_config`(active provider → `opencode.json` 的 provider/model),覆盖 opencode 默认。
- **地板**:无 BYOK 时指向免费 CF Workers AI / 本地 Ollama(opencode 原生支持 Ollama)。

## S4 — 真机 smoke(必做,像 codex/claude 2026-06-29 那样)
- 装 opencode → 经 ACP 驱动一轮(可复用 `/debug/irisy/turn` 式路径,或临时 harness)→ 确认:① ACP 握手通 ② `session/new` 后 opencode 列到 CTRL gate 工具 ③ 让它跑 `create-feature-pack` 流程建一个最小包 + smoke 绿。
- 验模型无关:分别用 一个 BYOK provider + 本地 Ollama 各跑一次。

## S5 —(后续,单独 slice)coding 模块 UX
- Coding 场景从「开 bash」升级为「在 `~/Documents/CTRL/` 起 opencode」(projector 的 `.mcp.json`/`AGENTS.md` 已投影,opencode 自动发现 gate)。
- `create-feature-pack` skill 投影给 opencode(skills→ 落点)+ 升级到「完整-app」标准(workspace/§14/provision),对所有引擎受益。
- per-pack workspace 投影扩到所有包(现仅 record_source 包)。

# 关于上次「误接线」—— 不重蹈
`AgentName::Opencode` 是 v4「3-agent aggregator」(kernel lazy-install + PWA 直连其原生端点)时接的,v7 换代 BYO-CLI driver 时退役、封成 `retired — unwired`。**本方案不复活老架构** —— 走 ADR-005 §8.7 的 **ACP 引擎槽**(CTRL 经 ACP 驱动,gate 经 session/new),这是 v8/v9 governing 的正确姿势。

# 风险 / 诚实 gap
- **opencode ACP 成熟度**:文档 + Zed 在用,但要 S4 真机验(别假设)。
- **模型接线细节**:opencode 配置格式 vs CTRL provider 映射,S3 需真读 opencode.json schema(别猜)。
- **装机足迹**:opencode 跑在 Bun,首装体积/时间比 npx adapter 大 —— 懒装 + 进度提示。
- **地板体验**:免费/本地模型 coder 力弱,建复杂包吃力;但结构化活在 gate 工具/skill,基础包可行。

# ADR 变更
- **ADR-005 §8.7**:引擎列表加 opencode(hermes/Codex/Claude-Code/**OpenCode**),注明 opencode = 开源模型无关引擎、CTRL 自有集成。bump version + changelog。
- **ADR-001 spine**:opencode 从 `retired` 改为「§8.7 ACP 引擎(非 v4 aggregator)」的一行澄清。

# 落地顺序
S1+S2+S3 = 集成 slice(引擎能选能跑) → S4 真机验(绿了才算通) → S5 coding 模块 UX(单独、更大)。ADR 变更随 S1 一起落。
