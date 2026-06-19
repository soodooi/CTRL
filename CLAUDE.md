# CTRL — Claude Code Project Entry

> **新 session 必读**: `vault/ctrl/architecture-byo-cli-driver.md` (架构唯一真相源, authoritative — 顶部 2026-06-18 纠正块 governing) + `.olym/decisions/INDEX.md` (7 module ADRs) + `.olym/decisions/001-spine.md` (architecture lock)

---

## What is CTRL?

CTRL = **AI-native ambient OS 中枢** (野心), v1 落地 = **global ambient AI workbench + creator substrate** (ADR-006 cross-cutting § global-english v1; 中文是后续 i18n locale, 不是 v1 default).

按 `Ctrl` 唤起 → ephemeral workspace → 1 mcp = 1 AI 工具. 极简化 + AI native + 创作者经济.

**Single deliverable**: this repo (`soodooi/CTRL`, private). Self-contained; no npm runtime dependency. Dev harness = **minimal single-dev mode** (`goal` + `dev-loop` skill + a few life-line hooks); the olym multi-agent framework was stripped 2026-06-19 (rationale + restore: `vault/ctrl/harness-minimal.md`).

---

## Rules

- 全英文代码 — **整个项目代码零中文** (注释 / UI 文本 / 字符串字面量 / API 响应 / 错误信息 全英). bao 钦定 2026-05-28
- 中文只允许出现在 `.md` 文档 (战略文档 / spec / handoff / ADR) + 跟 bao 对话, **不允许出现在任何 `.rs` / `.ts` / `.tsx` / `.css` 代码注释里**
- License: All Rights Reserved. **所有子包 `private: true` + `license: UNLICENSED`**
- 禁止 `npm publish` 任何 `@ctrl/*` 包到公开 npm
- 禁止本地 `wrangler dev` (ctrl-cloud 走 `*.workers.dev` staging)
- 禁止 `--no-verify` 跳过 git hooks
- 禁止跨 D1 JOIN
- 模棱两可的指令直接询问 bao
- 涉及战略改动: 先读 ADR-001 spine + `.olym/decisions/INDEX.md` (7 module ADR 索引), 不冲突再动手

### Working mode: 灵活开发 — 只做 ADR + 代码 + PR

bao 2026-05-25 进一步校准: **只 3 件事**:

1. **ADR** — 战略决策必写 ADR (module-based, 7 个, 编号 001-007 锁死). **section amendment = bump version: + 加 changelog 行, 不开新 ADR** (PROCESS.md §1 锁). **ADR 跟最新决策有冲突立刻改**, 不留拖延 (memory `decision_pi_is_sole_brain_hermes_is_keycap` 反例: 原 ADR-019 hermes-primary 等到第二天才删 — 不允许再发生)
2. **代码** — 直接动手实施, 走 `dev-loop` skill (三层验证 + 独立 checker), 绿了就 commit
3. **PR** — 单 branch 累积 commit, 一次性 PR → main, squash merge

**不做** (极简单人模式, olym 多智能体层已剥离 2026-06-19, 详见 `vault/ctrl/harness-minimal.md`):
- handoff / RFC 5 步 / 7-step process / fleet 编排 / lane 车道 — 已剥离
- spec 细则中间态 / README 同步 / doc churn / cleanup PR / governance ADR — 不做

**仍守** (这些是保命线):
- 全英文代码 (pre-push hook)
- `--no-verify` 禁用
- Cargo.lock + package-lock.json 进 commit
- ADR-001 spine § primitives v1 (5 primitives) 不动
- 安全 (Keychain secrets, no hardcode)
- **ADR 跟实装不允许漂移** — 发现冲突立刻 superseded / amend

---

## Design Philosophy

> 跨 session 强约束。冲突时优先级：**目标推进 > 硬规则 (## Rules) > 设计哲学 (本节) > 实施细节**。

### Meta: 系统设计先行 — 不用 debug 的方式开发系统 (bao 钦定 2026-06-13)

**先有统管全局的整体规划, 再实施; 不要靠 debug 式试错凑结果。**

- 动手改 UI / 数据流 / 架构前, 先建立一张统管全局的规划图 (信息架构 / 边界 / 职责 / 网格), 把它写下来 (vault 或 ADR), 所有局部对齐它。
- **反模式 (debug 式开发)**: 逐个组件调样式、改一处看一处、靠截图 / 日志反复试错来「凑齐」。结果必然是各组件各自为政 —— 品牌出现两次、竖线各画各的 x 对不齐、token 各 fallback 各的。
- debug / 截图 / 日志 / tsc 是**验证**手段, **不是开发方法**。先把设计想对, 再用它们验证; 不是边试边改凑出对。
- **症状自检**: 一旦发现「局部各自为政 / 对不齐 / 重复 / 搞不清楚」= 整体规划缺失的信号 → **停下补规划**, 不要继续局部打补丁。
- 反例 (bao 2026-06-13): UI 布局逐组件调样式、没有统一网格 → L1 和第一行各放一次品牌、4 条竖线各在各的 x 对不齐。bao: 「线都不齐 我搞不清楚 你是不是没有整体规划」。

### Meta: Plain-text 哲学 (VMark-compatible vault, 一切派生于此)

**CTRL 是用户能力的延伸 (augmentation)，不是知识中介。**

- 数据本来就是用户的——本地 markdown + YAML / TOML / JSON, 永恒中间格式, 100 年后用 vim 还能读
- 本地是 **truth**, 云是 **mirror**, 不是反过来
- 无 lock-in：离开 CTRL = 文件还在那, 不需要"导出"因为根本没"导入"
- 无 CTRL 账号系统：用户身份 = 本机 keychain 里的密钥, CTRL 团队不知道你存在
- 无私有 binary 格式：所有用户内容必须 plain text + structured frontmatter
- **VMark / Obsidian 是兼容承诺, 不是依赖** — vault 文件夹是普通 markdown, 用户已装的 VMark / Obsidian / vim 都能开, 但 CTRL 不依赖它们任何一个 (不集成 VMark MCP sidecar, 不依赖 Obsidian DB cache)

**vim test** (每个新 capability 的设计门槛): 用户用 vim 打开本机文件, 能拿到 CTRL 提供的核心价值吗? 答 No = 设计错, 重做。

### Derived rules (任何新代码都遵守)

1. **本地是 truth, 云是 mirror** — 所有读走本地；写本地立即可见, 异步推云。云不在 → 降级运行, 不 hard fail。
2. **端侧化优先** — OAuth (本机 loopback callback, 不走 CTRL cloud proxy) / LLM (Volc 云 + Ollama 端侧 dual) / sync (mesh P2P, ADR-002 substrate § crypto v1) / RAG (本机 SQLite FTS5 + WASM embed) / OCR (本机 Vision framework) 都端侧实现。**ctrl-cloud 是 augmentation, 不是 dependency**——用户拔网 / 不用 ctrl-cloud, CTRL 完整可用。
3. **Ctrl-key 是唯一入口** — 用户永不打开飞书 / Notion / Linear 等第三方 app；CTRL workspace 区 render 所有数据类型 (viewer registry by content type, 不是 by platform)。
4. **One-shot, not flows** — 一个 mcp = 一个原子动作。无 wizard / 无 multi-step / 无 dialog tree。
5. **AI 是 pipe, 不是 sidebar** — 发收消息 / 处理内容时 AI 默认 in-line 处理 (润色 / 摘要 / 抽 action item / 翻译), 可关默认开。
6. **Transparency by drill-down** — 任何 AI / 抽象处理都可长按 / hover 看 raw 数据 (飞书原文 / AI 改后 / 本地草稿三层视图)。
7. **CTRL 不自带通用 brain;两条并行路径,都经 `:17873` gate** *(ADR-001 spine § byo-cli-driver v8 + ADR-002 substrate § brain v28; 真相源 `vault/ctrl/architecture-byo-cli-driver.md`)*:
   - **Irisy(app 内助手)的脑 = Hermes Agent** (NousResearch). CTRL bundle + lazy-install + 启动它 (dashboard `:17890`, Irisy 嵌入). **hermes 不退役.**
   - **BYO-CLI driver(projection)= 附加并行路径** — CTRL 把工具/技能/记忆/工作流投影 (materialize) 进用户自选本地 CLI (Claude Code 旗舰) 的原生落点 (`.mcp.json` / `SKILL.md` / `CLAUDE.md`·`AGENTS.md` / slash command), CLI 启动自动发现; CTRL 不 lazy-install / 不 supervise 该 CLI 的 agent loop. 已落地 `kernel/projector.rs` (项目级 `~/Documents/CTRL/.mcp.json`).
   - **Pi 已退役** (ADR-002 v19, 2026-06-09 PR — `@mariozechner/pi-coding-agent` + ctrl-pi-bridge / ctrl-pi-plugin / `~/.ctrl/pi/` 全删, 代码零接线). opencode 未接线 (保留作未来 coding 路径). ACP 降级为 future「ACP-aware CLI 增强通道」, 代码保留.
   - **调度权在 brain 手里** — CTRL 只「让 brain 看见资产 (projection)」+「调用回流经 `:17873` gate (权限/审计/可见性)」, 不编排决策 (符合 one-shot / AI-is-pipe).

### 几个具体推论

- **没有"导出"功能** — 数据从来没被进口过, vault 文件夹就是数据
- **OAuth tokens 存 macOS Keychain** — CTRL 团队 server 不在 token 流量里
- **mcp manifest = markdown + JSON frontmatter** — 不是 binary blob, 用户可手编可 git diff (mcp = 用户 + 代理共享 vocab, 替代"keycap" 2026-06-07)
- **vault layout 由用户决定** — CTRL 提供 default policy (flat / by-day / by-entity), 用户可换；不 hardcode 目录结构
- **第三方 backend (飞书 / Notion / Slack) 是 sync provider** — 不是 source of truth, 本地永远赢冲突
- **CTRL-native vault stack** *(2026-05-25)* — viewer 用 **Tiptap** (markdown WYSIWYG+source) + **CodeMirror 6** (code/JSON/YAML/TOML/HTML) + **mermaid.js** (mermaid) + iframe+CSP (HTML sandbox) + browser-native (SVG); 索引用 **SQLite FTS5** (kernel `vault_index.rs`) + 自实现 backlink/tag scanner. VMark 用的也是同样开源 stack — 不需要把 VMark 作 substrate, 直接 npm 装这些 lib 即可

详见真相源 `vault/ctrl/architecture-byo-cli-driver.md` (brain + projection 唯一真相) + memory `decision_ctrl_obsidian_philosophy.md` (long-form rationale) + `decision_vmark_not_substrate_use_open_stack.md` (vault stack 校准)。

---

## Architecture overview

> 真相源: `vault/ctrl/architecture-byo-cli-driver.md` (governing). Spine: `.olym/decisions/001-spine.md` § byo-cli-driver (v8). INDEX = `.olym/decisions/INDEX.md` (7 module ADR).

**CTRL = BYO-CLI driver projection 平台** (不自带通用 brain; CTRL 把本地武器库投影给 brain 看, 调用回流经 gate). 演进: Pi-centric (retired) → 3-agent aggregator (retired) → **BYO-CLI driver platform ★**.

**两条并行 brain 路径** (都经 `:17873` gate):

1. **Irisy 路径** — app 内助手 Irisy 的脑 = **Hermes Agent** (CTRL bundle + 启动, dashboard `:17890`, Irisy 嵌入).
2. **BYO-CLI 路径** — 用户自选本地 CLI (Claude Code 旗舰) 当 driver; kernel `projector` 把资产物化进它的原生配置, 它启动自动发现. CTRL 不 supervise.

**kernel 极薄 — 只做 4 件事**: ① `projector` (tools→`.mcp.json` / skills→`SKILL.md` / memory→`CLAUDE.md`·`AGENTS.md` / workflows→slash command, 按 intent 投影子集) ② `mcp_server :17873` = the gate (权限/审计/可见性, 工具回流落点) ③ `provider/` (fal.ai 旗舰 + Anthropic/OpenAI/Hunyuan/DeepSeek/Volc BYOK) ④ keychain.

**3-capability-face SSOT** (互补不塌缩): **MCP** (协议) + **API** (provider router, fal.ai 985 endpoints) + **Skills** (markdown `SKILL.md`).

**5 kernel primitives** (L1 内): Actor / Capability / Event / Channel / Effect.

**5 mcp sources**: MCP servers / Big-platform OAuth / Local agents / ST-SS shared windows / Built-in.

物理 topology (L0-L3 + PWA 4 层垂直栈) 见 ADR-001 spine § layers v8 — BYO-CLI driver 5-块是 logical view, 4 层是 implementation view, 两图并存.

---

## Reference (split out — Anthropic best practice: CLAUDE.md < 200 lines)

Detail moved to path-scoped `.claude/rules/` (auto-loads when editing the matching code; canonical truth still lives in the ADRs):

- **Stack + Repository topology** → `.claude/rules/stack-and-topology.md` (loads under `src-tauri/**` · `packages/**`)
- **MCP manifest model + Top 15 mcps + LLM Pattern D + external refs** → `.claude/rules/mcp-llm-reference.md` (loads under provider / mcp-sdk / mcps)
- **LLM hard lock** (every-time): Anthropic Claude / GPT-4 / Ollama are **BYOK only**; default path = CF Workers AI; CTRL runtime never ships an Anthropic/OpenAI SDK on its hot path (ADR-006 § byok-no-claude v1).

**We sell tools + platform, not models.**

---

## Active goal

单人极简模式: 当前目标见 `vault/ctrl/GOAL.md` (走 `goal` skill 读写), 推进用 `dev-loop` skill。
handoff / fleet 机制已剥离 (`vault/ctrl/harness-minimal.md`)。

---

## Decision flow

When you need to make any non-trivial decision:

1. **Read** `.olym/decisions/INDEX.md` (1 min) — 7 module ADR map
2. **Open** the relevant module ADR — § Decision + § Acceptance + § Future work
3. **Ask** bao if conflict between ADRs or decision absent

Do **not** unilaterally change lock points without ADR amendment.

---

## What CTRL is NOT

| Don't | Why |
|---|---|
| Workflow editor | Coze / n8n 已经做了 |
| 自己造硬件 | Solo + 资本错配 |
| 100+ 长尾 platform adapter | ST-SS 给创作者自己接 |
| Quicker 8000 长尾 clone | 不可能赢 |
| ChatGPT GPTs 接入 | API 不开放 |
| 共享 mamamiya 用户数据 | 独立 D1 |
| 多 tenant SaaS | Pandagooo 那条线, 不混 |

---

## Git workflow

- Branch from `main`: `feat/...` / `chore/...` style
- Conventional commits: `feat / fix / chore / refactor / docs / test` (handoff `[H-...]` trailer no longer enforced)
- Squash merge to main via PR
- No force push to main, no `--no-verify`

---

## When in doubt

- Architecture question → ADR-001 spine + relevant module ADR (INDEX.md)
- Strategic question → `.olym/decisions/INDEX.md` + relevant module ADR
- "Should I add this?" → check 不做清单 first
- "How does X work?" → ask bao directly, do not guess
