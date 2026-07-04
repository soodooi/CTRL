---
title: Irisy 能力清单 + 资源清单（建包视角，governing 参考）
kind: reference
created_at: 2026-07-04
owner: bao
author: claude
purpose: bao「给 Irisy 能力清单和资源清单，方便规划」——规划建包 research-first 流程前，先有一张 Irisy 到底有什么工具/资源的真相图。
source: 实测 —— live gate `tools/list`(caller=hermes, 40 工具, 2026-07-04) + Hermes 官方文档研究(~71 原生工具 + 136 API 端点) + visibility.rs BRAIN_TOOLSET。非记忆。
related:
  - "[[plan-ctrl-skills-tap.md]]"
  - "[[plan-agent-observability.md]]"
  - "[[capability-pack-map.md]]"
---

# Irisy 能力清单 + 资源清单

> **两个大脑面**：① **CTRL gate（:17873）工具** = **~100 个真实注册**（不是早先说的 76——那是过滤视图）② **Hermes 原生** = 大脑自带（~71 工具 + skills-hub/mcp-catalog/memory/curator）。建包能力 = 两面合起来。

## ★ 修正 + 工具发现层（2026-07-04）

早先本文说 76 端点 / Irisy 见 40 —— **两处不准**：
- **真实注册 ~100 个**（vault 32 / smart 17 / mcp 12 / note 8 / task 6 / source 3 连接器 / http / calendar / discover / web…）。76 是 pwa 某个 intent 的过滤视图。
- **Irisy 默认只见 ~42**（BRAIN_TOOLSET,含新加的 2 元工具),但**全 ~100 现在都够得着** —— 通过**工具发现层**（本日落地,commit cf3a811）:
  - `gate_tool_search(query)` → 搜全 ~100 的任何工具（名+描述+schema）
  - `gate_tool_call(name, args)` → 调任何一个（走正常 dispatch,权限+审计照旧）
- **建包关键工具**（`mcp_pack_scaffold`/`validate`/`publish`、`source_*` 连接器、`http_*`、`mcp_proxy_call_tool`)早先"被藏",**现在经工具发现层全部可达**。建包 skill(create-feature-pack)已进 ctrl-skills 并引用它们。
- **结论更新**:建包**资源够 + 现在够得到 + 有 research-first skill 引导**。三缺口都补上了。

## A. Irisy 的 CTRL gate 工具（40 个，实测 caller=hermes）

### A1. 建包 / 发现 / 研究（★ 建包核心）
| 工具 | 作用 |
|---|---|
| `discover_packs` | 搜 **MCP Registry + Smithery(2000+ servers)** 找现成功能包/MCP —— **"找真实源"的核心** |
| `discover_skills` | 搜 GitHub 上发布的 skills(SKILL.md) |
| `web_search` | web 搜索(标题+URL+摘要;BYOK Tavily/Brave + DDG/Wiki fallback) |
| `skill_list` / `skill_read` | 列/读本地已装 skill |
| `mcp_pack_list` / `install` / `run` / `uninstall` | 装/跑/卸功能包(from manifest + server) |
| `mcp_pack_write_file` | 往包里写 skill/asset 文件(`skills/<name>/SKILL.md`) |
| `mcp_list_servers` | 列已注册的外部 MCP server |

### A2. 智能表格 / 数据(建+改+读)
`smart_table_base_scaffold`(一次建多表 base+关联) · `smart_table_create`(单表) · `smart_table_produce`(统一写:set_cell/upsert/del/add_field...) · `append_row` / `batch_append_rows` · `describe` / `query`

### A3. Vault(笔记/知识)
`vault_read/write/search/list/create_folder` + `vault_backlinks/tags/orphans/broken_links/suggest_links`(知识库组织)

### A4. 其它
- **记忆**:`irisy_soul_get/set`(SOUL.md 长期记忆)
- **任务**:`task_describe/query/create/update`(LifeOS)
- **市场**:`market_quote/screen`(Yahoo,无 key)
- **设置/推理**:`providers_query` · `registry_query` · `llm_chat` · `kernel_status`

> **注**:gate 只暴露 `web_search`(浅);深度抓取/浏览走 Hermes 原生(见 B)。

## B. Hermes 原生能力(大脑自带，~71 工具 + 平台)

### B1. 原生工具(~71，研究所得)
**10 浏览器工具** + **2 web 工具**(深度研究/抓取,超出 gate 的 web_search) · 4 文件 · 2 终端 · 5 Feishu · 7 Spotify · 9 kanban · 2 Discord · Home Assistant …

### B2. 平台能力(136 API 端点)
- **Skills Hub**(开放标准 tap + `external_dirs` + 自主 **Curator** 7天周期自动评分/精简/合并)
- **原生 MCP client + catalog**(自己发现+装 MCP,stdio/HTTP)—— 跟 gate 的 discover_packs 互补
- **memory**(独立记忆系统) · **cron**(定时) · **profiles**(agent 画像) · **tools/toolsets**(工具集配置) · **audio**(TTS/STT/transcribe)

## C. 资源清单(Irisy 能取用的"料")

| 资源 | 通过 | 用于建包哪步 |
|---|---|---|
| **用户 vault**(笔记/表格/skills/SOUL) | vault_* / smart_table_* / skill_* | 懂用户已有什么 |
| **MCP Registry + Smithery**(2000+) | discover_packs + Hermes mcp-catalog | 调研:找现成 MCP/API 当包的源 |
| **GitHub skills** | discover_skills | 调研:找现成 skill |
| **全网**(搜索+浏览器) | web_search(gate) + Hermes 浏览器工具 | 调研:领域知识、真实 API 文档、竞品 |
| **LLM providers**(BYOK) | providers_query / llm_chat | 推理引擎 |
| **市场数据** | market_quote/screen | 金融域包的数据 |
| **CTRL gate(:17873)** | 全部 | 受治理的能力通道(审计/权限/可见性) |

## D. 建包 research-first 流程 × 能力映射

```
A.需求分析  → 领域知识 + web_search(不熟就查) + 轻确认        [已有能力,缺 skill 引导]
B.调研      → discover_packs(找 MCP/API) + discover_skills +
              web_search + Hermes 浏览器(深读文档) + 交叉核实   [能力齐,缺 research playbook skill]
C.设计      → 从调研定形态(app-connector/MCP/API)+ 表/关联     [靠 create-feature-pack skill]
D.建造      → smart_table_base_scaffold / mcp_pack_install /
              mcp_pack_write_file / 表+关联                     [工具齐 ✓]
E.分发      → mcp_pack_publish(§7.6) / Skills Hub tap           [部分]
```

## E. 缺口(规划要补的)

1. **调研/需求分析没 skill 引导**：能力都在(web_search/discover_*/浏览器),但没 skill 教 Irisy "建包先调研+分析需求"。→ 归 `ctrl-skills` 的 research-first pack-creation skill。
2. **gate 只给浅 web_search**：深读靠 Hermes 原生浏览器——但 CTRL 侧没把"深抓取"当受治理能力暴露(要不要 gate 化 web_extract?待定)。
3. **discover_packs vs Hermes mcp-catalog 两套发现**：一个 CTRL gate、一个 Hermes 原生,可能重叠——规划时明确谁主。
4. **建包 skill(create-feature-pack)现是 build-first**：缺 A/B/C 前端(见 plan-tables/建包 research-first 线)。

## F. 一句话给规划
**建包的"造"能力齐了(smart_table/mcp_pack/base_scaffold);缺的是"研究+需求"的 skill 引导 + 把 Hermes 深研能力接进流程。** 下一步 = 在 ctrl-skills 里写 research-first 的建包 skill,驱动 A/B/C,复用 discover_packs + web_search + Hermes 浏览器,别重造。
