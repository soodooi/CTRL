# CTRL 架构换代 — BYO-CLI Driver Platform

> **2026-06-17 · bao 钦定 · 新真相源 (authoritative)**
> 本文是 CTRL 当前架构的权威基准。任何其他文档 / ADR / 代码与本文冲突时，以本文为准并立刻 amend 对应 ADR。

---

## 一句话定位

CTRL 从「内置 lazy-install agent 的聚合器」换代为 **BYO-CLI driver 平台**：
用户本地自选的强 CLI agent（Claude Code 等）作为**坐镇的通用 driver / 引擎**；
CTRL = 把用户本地的**工具 / 技能 / 记忆 / 工作流**投影（projection）成该 CLI 能认的原生形态的平台 + **MCP gate** + （v1.1）**共享网络**。

CTRL 不再自带 brain，不再 lazy-install，不再 supervise agent loop。
**brain 是用户带来的（BYO）；CTRL 是让那个 brain 看得见你全部资产、且回流可被 gate 的投影层。**

---

## 演进链 (provenance)

```
Pi-centric                          (retired)
  → 3-agent aggregator              (retired)
      hermes / opencode / kairo     ADR-001 spine v4–v6
  → BYO-CLI driver platform   ★     ADR-001 spine v7 (2026-06-17, 本次)
```

| 代次 | 形态 | brain 来源 | 退役原因 |
|---|---|---|---|
| Pi-centric | 单一内置 agent loop | Pi (`@mariozechner/pi-coding-agent`) | 被 3-agent 取代 |
| 3-agent aggregator | 聚合 3 个内置 agent | hermes / opencode / kairo（lazy-install + supervise） | CTRL 不该自带 / 养 brain；用户已有更强的本地 CLI |
| **BYO-CLI driver** ★ | 用户自选本地 CLI 坐镇，CTRL 投影资产 | **用户本地 CLI（Claude Code 等）** | — 当前真相源 — |

**关键转向**：从「CTRL 提供 brain」→「CTRL 投影资产给用户自带的 brain」。
这让 CTRL 回到它该在的层：不是 agent，是 **augmentation / projection 层**。

---

## 核心定案

### 1. driver = 用户自选本地 CLI
- driver 是用户**本机已安装**的强 CLI agent。**Claude Code 是旗舰对接目标**。
- CTRL **不再 lazy-install** 任何 brain，**不再 supervise** 任何内置 agent loop。
- driver 的升级、计费、模型选择全在用户侧 —— CTRL 搭便车（ride upgrades），不背维护成本。

### 2. 内置 brain 全摒弃
- **hermes**（NousResearch assistant）、**opencode**、**Pi** —— 全部退役。
- **ACP 通道不删**，但降级为 **future「ACP-aware CLI 增强通道」**：当 driver CLI 支持 ACP 时可走更丰富的双向协议；不再是 hermes 的门。
- **Notes = Obsidian 保留不变**（见定案 9）。

### 3. 接入 = projection（物化到原生配置）
CTRL 把资产**物化（materialize）**到目标 CLI **启动时本就会扫描**的位置，零侵入：

| CTRL 资产 | 物化形态 | 落点（Claude Code 示例） |
|---|---|---|
| 工具集 (tools) | MCP server，挂 CTRL MCP bus `:17873` | 写进**项目级 `.mcp.json`**（`~/Documents/CTRL/.mcp.json`）。**纠正（实测）: Claude Code 不读 `~/.claude/.mcp.json`**；用户级走 `claude mcp add --scope user`。已落地 `kernel/projector.rs` |
| 技能 (skills) | 物化 `SKILL.md` | CLI 的 skills 目录 |
| 记忆 (memory) | 派生 `CLAUDE.md` / `AGENTS.md` 注入 context | CLI 启动时读取的 context 文件 |
| 工作流 (用户主动触发) | 物化 slash command | `.claude/commands/` |

- manifest 留可选 **`target:` override**；**默认按资产类型自动分流**（上表）。

### 4. 两种触发，一份投影真相
- **被动投影（底座）**：用户在**任意终端**自己跑 `claude`，启动即**自动发现** CTRL 投影的资产，**零侵入**。
  完全符合 **vim-test / plain-text 哲学** —— 文件本就在那，不需要 CTRL 在运行。
- **主动拉起（增强）**：CTRL 可在 `Ctrl` 唤起的 **ephemeral workspace** 里拉起 CLI 进程。
- **两者共用同一份投影，不分叉**。被动是底座，主动是增强，落点 / 内容完全一致。

### 5. 调度权在 CLI 模型手里
CTRL 只负责两件事：
1. **让 CLI 看得见资产**（projection）。
2. **调用回流经 `:17873` = kernel gate**（权限 / 审计 / 可见性）。

CTRL **不 supervise、不编排** CLI 的决策。符合 **one-shot, not flows** + **AI 是 pipe, 不是 sidebar** 哲学。

### 6. 按 intent 投影子集
- **不全量灌爆 CLI context**。CTRL 按当前 **workspace / intent** 只投影相关 **1–N 个**资产。
- 呼应 **modular intent platform** 定位（scale 在 registry，不在 UI / context）。
- **v1 就做**（不是 future）。

### 7. 多 driver
- 架构允许**挂多 CLI 按任务路由**。
- v1 先 **单一坐镇 + 可切换**；多 driver 同时路由优先级低。

### 8. 共享网络（share & be shared）
- **= 杀手锏 + 商业模式核心**，**v1.1 scope**。
- v1 先做**单机本地武器库**；架构**预留共享接口** —— 你的工具 / 技能可被打包共享，也能消费别人的。

### 9. Notes 层 = 用户自己的 Obsidian
- **ADR-002 §1.9，不变**。Notes folder = `~/Documents/CTRL/Notes/`（Obsidian vault）。

---

## 接入模型图 (projection)

```
                    用户本机资产 (CTRL 武器库)
        ┌──────────┬──────────┬──────────┬──────────────┐
        │  工具集   │   技能    │   记忆    │ 主动触发工作流 │
        └────┬─────┴────┬─────┴────┬─────┴──────┬───────┘
             │          │          │            │
        ╔════╪══════════╪══════════╪════════════╪═══════════════╗
        ║  CTRL projection 层  (按 intent 只投影相关子集 — 定案6)  ║
        ╚════╪══════════╪══════════╪════════════╪═══════════════╝
             │ MCP      │ SKILL.md │ CLAUDE.md  │ slash command
             │ server   │ 物化      │ /AGENTS.md │ 物化
             ▼          ▼          ▼            ▼
        ~/.claude/   skills/    context      .claude/
        .mcp.json    目录        文件          commands/
        ───────────────────────────────────────────────
                 driver CLI 启动时本就扫描的原生落点
                              │
                              ▼
            ┌─────────────────────────────────────┐
            │   driver = 用户自选本地 CLI           │
            │   (Claude Code = 旗舰)               │
            │   ★ 调度权在 CLI 模型手里 (定案5)      │
            └──────────────┬──────────────────────┘
                           │ 工具调用回流
                           ▼
            ┌─────────────────────────────────────┐
            │  CTRL MCP bus :17873 = kernel gate   │
            │  权限 / 审计 / 可见性                  │
            └─────────────────────────────────────┘

  触发 A (被动·底座):  任意终端跑 `claude` → 自动发现投影  (零侵入, vim-test)
  触发 B (主动·增强):  Ctrl 唤起 ephemeral workspace → 拉起 CLI
  两者共用同一份投影, 不分叉 (定案4)
```

---

## 资产映射表 (完整)

| 资产类型 | 物化形态 | CLI 原生落点 | manifest target | v1? |
|---|---|---|---|---|
| 工具集 | MCP server @ `:17873` | 项目级 `.mcp.json`（`~/Documents/CTRL/.mcp.json`，非 `~/.claude/`） | 可 override | ✅ 已落地 `projector.rs` |
| 技能 | `SKILL.md` 文件 | CLI skills 目录 | 可 override | ✅ |
| 记忆 | 派生 `CLAUDE.md` / `AGENTS.md` | CLI context 文件 | 可 override | ✅ |
| 工作流（主动触发） | slash command | `.claude/commands/` | 可 override | ✅ |
| Notes | Obsidian vault（不物化，原生即真相） | `~/Documents/CTRL/Notes/` | — | ✅ |
| 共享资产（打包 / 消费） | 打包格式 + 共享接口 | （v1.1 预留） | — | v1.1 |

默认按资产类型自动分流；manifest 仅在需要时用 `target:` 覆盖。

---

## 不变项 (没漂移 — 别动)

- **5 kernel primitives**：Actor / Capability / Event / Channel / Effect。
- **plain-text 哲学 / vim-test / 本地是 truth 云是 mirror**。
- **全英文代码规则 / `## Rules` 铁律**（整个项目代码零中文；无 `--no-verify`；private + UNLICENSED 等）。
- **MCP bus `:17873`**（工具回流 gate） + **ST-SS WS `:17872`**（intra-device PWA bridge，token-auth）。
- **Notes folder = `~/Documents/CTRL/Notes/`**（Obsidian vault，ADR-002 §1.9）。

---

## 待定 / future

- **共享网络（v1.1）** —— share & be shared，杀手锏 + 商业模式核心。
  v1 只做单机本地武器库 + 预留打包 / 消费接口；v1.1 落网络。
- **ACP-aware CLI 增强通道（future）** —— 当 driver CLI 支持 ACP 时启用更丰富的双向协议。通道保留，不再绑 hermes。
- **多 driver 同时路由（优先级低）** —— v1 单一坐镇 + 可切换；按任务路由到多 CLI 是后续。

---

## 对应 ADR 版本（本次 amend）

| ADR | 版本 | 变更 |
|---|---|---|
| ADR-001 spine | **→ v7** | 架构换代：3-agent aggregator → BYO-CLI driver platform |
| ADR-002 substrate | **→ v27** | 新增 **§ projection**（资产物化到 CLI 原生落点 + intent 子集投影 + MCP gate 回流） |

> amend 规则见 `.olym/decisions/PROCESS.md §1`：section amendment = bump `version:` + 加 changelog 行，不开新 ADR。
