# 02 — Keycap Shortlist Research (bao 2026-05-26 list of 21)

> **Author**: hephaestus (keycap lane)
> **Date**: 2026-05-26
> **Source**: bao verbal — 21 items to web-research as potential CTRL keycap integration / competitor / inspiration
> **Method**: 4 parallel general-purpose research agents (5 items each) + memory grep for prior records
> **Output**: per-item identity + license + tech surface + CTRL integration angle + confidence + v1 priority
> **Maps to**: `01-output-taxonomy-and-universal-contracts.md` §3 contract numbers (B-* / F-* / I-*) + 5 keycap source types from ADR-001 §4

---

## 0. Memory check (item 21 — "之前给你记的")

grep'd all 70 memory entries for `proma / ppt2video / blueprint / baklib / skillopt / 3Dcellforge / julebu / openhuman / ruview / cloakbrowser / supertonic / remotion / hyperframes / codegraph / easy-vibe / wala` — **0 hits**. memory 里全是 CTRL 战略 / fleet 协议 / lane 边界决策, 没有"待集成项目候选清单"形式的记录。

**第 21 项 = bao 需要直接给原始清单**, 我手上没有 cross-session 持久化的"之前记录的"列表。candidate 可能是 conversation history 里曾经口头提过但没写 memory 的项目 — 比如 hermes / agentskills.io / Pi / VMark 这些已经决策了的, 但那些已经在 ADR / spec 里, 不需要研究。

---

## 1. Per-item findings

### 🟢 v1 strong-fit candidates

| # | Item | What it is | License | Source type | Contract # | v1? |
|---|---|---|---|---|---|---|
| **13** | **Supertonic** (supertone-inc/supertonic) | 端侧 TTS, 31 语言, ONNX runtime, ~99M params, expression tags `<laugh>/<breath>/<sigh>`. 浏览器 / 端侧 / Android 都跑得动. | Open weights, ONNX assets free | Built-in (B-3 provider) | B-3 audio.tts | **YES** — 默认端侧 audio.tts provider, 取代 Volc cloud TTS 在隐私敏感场景 |
| **14** | **CLI-Anything** (HKUDS/CLI-Anything) | 自动把任意 GUI 软件 / SDK / Web API 包成 CLI, demo 覆盖 GIMP / Blender / Inkscape / Audacity / LibreOffice / OBS / Kdenlive (1,100+ 测试通过). | OSS (academic, 待 license file verify) | Built-in + MCP factory | B-4 mcp.spawn + 创作者 manifest gen | **YES** — **战略最高**, CTRL "5000+ Day-1" 野心的实施路径; AI 创作助手用它从用户已装软件自动派生 keycap |
| **20** | **HyperFrames** (heygen-com/hyperframes) | HTML 视频框架, Remotion 的 plain-HTML 替代品, GSAP/Lottie/Three.js, agent-first 非交互 CLI. | **Apache 2.0** | Local-agent / MCP | B-4 subprocess + F-1 video kind | **YES** — Apache 干净, 比 Remotion 适合 CTRL bundling, **vim test 过关** (HTML 是 plain text) |

### 🟡 v1.x / 战略价值候选

| # | Item | What it is | License | Source type | Contract # | v1.x? |
|---|---|---|---|---|---|---|
| **1** | **Proma** (ErlichLiu/Proma) | Local-first AI agent workbench + 飞书/Lark/钉钉/微信 bot 桥, 用户从手机群聊触发本机 agent. Electron + Bun + React + Jotai + Tiptap + MCP stdio+http. | **AGPL-3.0** | 竞品 + Built-in 飞书桥模式 | gateway-keycap 模式 | **战略借鉴** — bao 显式 directive "做轻量版飞书移动端入口" 的 reference. AGPL 阻止 vendor 代码, 但 **架构模式 = builtin keycap "Lark Trigger"** 走 ctrl-relay (ADR-003 mesh + CF Worker outbound WSS) + 本机 Pi/hermes |
| **2** | **ppt2video** | 多个 GH 项目 (DH-Center-Tuebingen/ppt2video 用 Azure Speech, iburn78/ppt2video 用 Google TTS). 都是 Python + python-pptx + TTS + ffmpeg. SaaS 替代品 themama.ai. | MIT / Apache | Local-agent subprocess | B-4 subprocess + B-3 audio.tts | **v1** — 1 天键帽: drop .pptx → 用 CTRL 已有 audio.tts (Volc 或 supertonic 端侧) + ffmpeg → MP4 进 vault |
| **5** | **Baklib CLI** | Tanmer 出的国内知识库/文档站 SaaS. 有 CLI (`help.baklib.cn/code`) + Ruby SDK (`tanmer/baklib_api`). REST + Liquid 模板. Channels + Articles. | Proprietary SaaS + Ruby SDK MIT (待验) | OAuth | B-4 oauth.* | **v1.x** — 国内创作者细分: "publish vault note → baklib", "pull baklib article → vault". 全局英文优先下优先级下调 |
| **6** | **SkillOpt** (microsoft/SkillOpt) | text-space 优化器, 把 frozen LLM agent 的 SKILL.md 当神经网络训练 (epoch / batch / validation gate); +19.1pts on Claude Code over no-skill. 输出 `best_skill.md` (agentskills.io 兼容). | **MIT** | Local-agent | B-4 subprocess + I-3 improve | **v1 dev keycap** — "optimize this SKILL.md" 针对 `target=hermes-skill` keycaps, 跟 I-3 improvement→patch 路径互补 |
| **8** | **AI Marketing (open-source pack)** | OpenClaudia/openclaudia-skills 34+ marketing skills; alirezarezvani/claude-skills 329 skills 5.2k★; Open AI UGC 复刻 Arcads/MakeUGC. 都是 Claude-Code-skill 形态. | MIT / Apache | hermes-skill keycap pack | F-1 picker (Pool 分类) | **v1** — Pool "Marketing" 分类一次性导入 OpenClaudia 全套 (target=hermes-skill, 需要 hermes keycap 装) |
| **12** | **CloakBrowser** (CloakHQ/CloakBrowser) | Stealth Chromium fork, C++ 源码级指纹改造 (canvas / WebGL / audio / fonts / GPU / WebRTC), Playwright/Puppeteer drop-in, 30/30 antibot 测试通过. | OSS (license 待验) | Local-agent subprocess | B-4 subprocess + 沙箱 | **v1.x** — `web.automate` / `web.scrape` keycap; 绕过 paywall / Cloudflare 墙的场景. **Legal/ToS 警告写明.** |
| **17** | **Understand-Anything** (Lum1104/) | Claude Code Plugin, 多 agent pipeline 跑任意 codebase 建知识图 (files / functions / classes / deps + 业务域视图) + 交互式 HTML dashboard. 跨 14 平台 (Claude Code / Codex / Cursor / Copilot / Gemini CLI). | OSS (license 待验) | MCP server | F-1 chart kind (graph) + iframe sandbox | **v1.x** — "Understand this codebase" 键帽, 跟 18 配对 (17 是 viz, 18 是 data layer) |
| **18** | **CodeGraph** (colbymchenry/codegraph) | 预索引代码图 for Claude Code / Codex / Cursor / OpenCode / **Hermes Agent**, 100% local, SQLite + FTS5. (另有 CodeGraphContext MCP server / ChrisRoyse Neo4j / FalkorDB) | OSS (待验, FalkorDB 是 AGPL) | MCP server | B-4 mcp.spawn + B-7 discovery | **v1.x** — 跟 CTRL `vault_index.rs` 同栈 (SQLite+FTS5), data layer; 跟 17 是同问题域不同层 |

### 🔴 不做 keycap (但有用)

| # | Item | 为什么不是 keycap |
|---|---|---|
| **10** | **OpenHuman** (tinyhumansai/openhuman) — Obsidian-vault desktop AI, 118+ OAuth, Memory Tree, ElevenLabs TTS + lip-sync, 加入 Google Meets 当真人参与者. **GPL-3.0**. | **核心竞品 + GPL bundle 阻止**. validate CTRL Obsidian 哲学 (2026-05-22) 的市场需求, 但 license 不能 vendor. 可走 OAuth keycap "Ask OpenHuman memory tree" 让用户 dual-run. |
| **15** | **AI Engineering** (Chip Huyen, O'Reilly 2025) | Paid book + repo. **参考资料, 不是 keycap**. 留给 hephaestus / Irisy team 设计读物 (RAG / eval / cost). |
| **16** | **easy-vibe** (datawhalechina) | OSS vibe-coding 教程, CN-origin EN-translated. **课程内容**, 不是 keycap. 可作 CTRL discovery flow 推荐内容. |

### 🟣 极窄垂直, 推 v1.1+

| # | Item | 备注 |
|---|---|---|
| **7** | **3DCellForge** (3dcellforge.org) — 浏览器内 AI 生成 3D 细胞模型, WebGL + 生成式后端. 生物教育/科普 vertical. OSS. | **v1.1+ 教育/科研 Pool 分类**. 全局英文 ambient OS 范畴下太窄. |
| **11** | **RuView** (ruvnet/RuView) — **不是 code review**. WiFi-DensePose: ESP32 节点 + 8KB 4-bit 量化模型 + Pi, 把 WiFi CSI 信号转成 presence / pose / 呼吸 / 心率 / 跌倒检测. 无摄像头无云. Matter Bridge → Apple Home / Google Home. ~45K★ (2026-03). | **v1.x ambient signal source** (ST-SS keycap 订阅) — 对齐 CTRL "ambient OS" framing 但需要硬件, 留实验. |
| **19** | **Remotion** — React 编程式视频框架, 标准 MCP server (`remotion.dev/docs/ai/mcp`), 社区 4+ MCP servers. **特殊 license**: 个人 / ≤3 人公司免费, >3 人公司需付费. | **License 警告** — soodooi 实体超过 3 人就需付费 license. **HyperFrames (#20) 是更干净替代品**, 优先选 20, Remotion 当 BYOK fallback. |

### ⚠️ 歧义未决 — 需 bao 澄清

| # | Item | 候选解释 | 我建议 |
|---|---|---|---|
| **3** | **blueprint** | (a) BlueprintAI.dev — 把模糊 app idea 变结构化 spec, 喂 Cursor/Claude/Copilot. SaaS. (b) NVIDIA AI Blueprints — 容器化 RAG / agent / video-analytics 参考架构, GPU 重. (c) Anthropic Skills 模式 framing (May 2026 文章用 "blueprint" 形容 SKILL.md+CLAUDE.md). | **最可能 (a) BlueprintAI.dev** (符合"第三方产品评估"框架). 请 bao 确认。 |
| **4** | **wala smart** | 搜不到精确匹配. 近似: Wali (学生 OpenAI shopping 助手) / Wala 语音 app (印度市场) / WalaPlus (海湾员工忠诚 SaaS) / 瓦拉星球 valavala.com (CN 站, 内容不可见). | **请 bao 提供**: 来源国家 / 类别 / 拼写 (wala / vala / 瓦拉) / 是 smart home / AI assistant / agent / mobile app? |
| **9** | **julebu** | 最可能拼写错误指 **julep-ai/julep** — Apache-2.0, 开源 stateful AI workflow 平台, "Firebase for AI agents". 另有 lzh3/julebu (A+俱乐部, 跟 AI 无关). | **若是 julep**: 平台竞品, 不是 keycap (julep 本身是给开发者建 agent 的 backend, 跟 CTRL kernel 同 layer). **跳过**. 请 bao 确认。 |
| **21** | **之前记录的** | memory grep 0 hit. | **请 bao 提供原始清单** — 我跨 session 没保留. |

---

## 2. 通用合约映射 (回 01 doc §3)

这 20 项落到 5 keycap 来源 + 通用合约编号:

### 按 5 来源分桶

| 来源 | 项目编号 | 走 CTRL 哪些合约 |
|---|---|---|
| **Built-in** (kernel-internal) | 13 supertonic, 2 ppt2video, 6 skillopt, 14 CLI-Anything 产物 | B-3 provider (supertonic) · B-4 subprocess (2, 6) · B-4 mcp.spawn + manifest-gen (14) |
| **MCP server** | 17 understand-anything, 18 codegraph, 19 remotion, 20 hyperframes | B-4 mcp.spawn + F-1 各 renderer (chart / video / iframe) |
| **OAuth** | 5 baklib, 1 proma 飞书桥模式 (新建) | B-4 oauth.* (5) · 飞书桥 = 新 gateway 模式 (1, 见下) |
| **Local-agent** | 12 cloakbrowser, 14 CLI-Anything 自动产物 | B-4 subprocess + B-5 sandbox derivation |
| **ST-SS** | 11 ruview | B-2 stream protocol (ambient signal) |
| **非 keycap** | 10 openhuman (GPL), 15 AI Engineering (book), 16 easy-vibe (course), 7 3DCellForge (太窄) | reference / discovery / dual-run |

### 触发新合约延伸的项目

| 项目 | 合约延伸 | 影响 |
|---|---|---|
| **1 Proma 飞书桥** | **新 B-4 entry: `gateway.*`** (lark / discord / telegram / slack) — bao directive "做轻量版飞书移动端入口" 落地路径 | 跟 hermes messaging 设计 (`decision_ctrl_is_hermes_workbench` Q2) 合流; ctrl-relay CF Worker 出站 WSS 已设计 (ADR-003) |
| **13 supertonic** | B-3 provider table 添加 "supertonic" provider (端侧 audio.tts, 跟 Volc cloud 并列) | provider 表本来就 open; 加条目不是新合约 |
| **14 CLI-Anything** | **新 I-1 子合约: keycap factory** — Irisy 不只 dispatch 已装 keycap, 还能用 CLI-Anything 自动给用户已装软件生成 keycap | I-1 升级 — 从 "intent→keycap match" 到 "intent→keycap match OR manufacture" |
| **17+18 codegraph/understand-anything** | F-1 新 kind: `code-graph` (Cytoscape / D3 graph) — 但其实 chart kind 已覆盖, 用 chart + graph dataset | 不是新合约, 扩展 chart renderer |
| **20 hyperframes** | F-1 新 kind: `video-preview` + B-2 stream 子类型 `render-progress` | 不是新合约, 视频是已知 B3 子类型 |
| **11 ruview** | B-2 stream 子类型 `ambient-signal` (presence / pose / vital) | 已涵盖 ST-SS 公共流, 不是新合约 |

**结论**: 21 项跑下来 **0 个真正新合约**, 唯一例外是 #1 Proma 飞书桥 → 新增 `gateway.*` capability namespace (B-4 子表), 跟 mesh ADR-003 + hermes messaging 自然合流。

---

## 3. v1 优先级建议 (bao 拍板用)

### 必上 v1 (覆盖 Top 15 + 这次新增)
- **#13 Supertonic** → 端侧 audio.tts default (替代或并列 Volc cloud)
- **#14 CLI-Anything** → keycap factory + AI 创作助手 backbone (这是 Day-1 "5000 keycap" 野心的关键)
- **#20 HyperFrames** → Built-in "make video from prompt" keycap (Apache 2.0 干净)
- **#2 ppt2video** → Built-in "pptx → mp4" keycap (1-day 易做)
- **#6 SkillOpt** → dev keycap "optimize SKILL.md" (跟 I-3 improve 互补)
- **#1 Proma 飞书桥模式** → Built-in "Lark Trigger" keycap (bao 显式 directive)

### v1.x 创作者经济 Pool (跟 Top 15 平行)
- **#8 AI Marketing pack** → OpenClaudia 34 skills, Pool "Marketing" 分类一次导入
- **#17+#18 understand-anything + codegraph** → coding companion (Code Space 周边)
- **#12 CloakBrowser** → web.automate keycap (绕 paywall / Cloudflare)
- **#5 Baklib** → 国内创作者细分, OAuth keycap (中文用户 i18n 后再优先)
- **#10 OpenHuman 部分** → OAuth keycap "Ask OpenHuman memory" (dual-run 场景)

### v1.1+ 实验 vertical
- **#11 RuView** → ambient signal source (需硬件)
- **#7 3DCellForge** → 教育/科研 Pool 分类
- **#19 Remotion** → BYOK license 用户的 video 选项 (HyperFrames 默认后的补充)

### 不做 keycap (但用)
- **#15 AI Engineering / #16 easy-vibe** → discovery 推荐内容 + 团队设计读物

---

## 4. 待 bao 澄清 (4 个)

| # | 问题 |
|---|---|
| **3** | blueprint 指 BlueprintAI.dev / NVIDIA AI Blueprints / Anthropic Skills 哪个? |
| **4** | wala smart 来源国家 / 类别 / 拼写? 全网无匹配。 |
| **9** | julebu 是否拼写错误指 julep-ai? (若是, 跳过 — julep 是 backend 平台不是 keycap) |
| **21** | 之前记录的项目清单 — memory 0 hit, 请直接给我原始名字 |

---

## 5. 影响 H-2026-05-26-001 handoff 的具体改动

这次研究产生的合约 / 项目落到 handoff:

### 新增 zeus 行
- **Z13** — B-3 provider 表添加 **supertonic 端侧 audio.tts** (跟 Volc 并列, 默认 supertonic 优先因为 vim-test + Obsidian 哲学优先本地)
- **Z14** — B-4 `gateway.*` capability namespace (`gateway.lark` / `gateway.discord` / `gateway.telegram` 等), 对应 #1 Proma 模式; 跟 ADR-003 ctrl-relay 合流

### 新增 daedalus 行
- **D14** — F-1 video renderer kind (覆盖 #20 HyperFrames / #19 Remotion 输出)
- **D15** — F-1 code-graph renderer (扩展 chart kind, 覆盖 #17+#18 输出)

### 新增 hephaestus (我自己) 行
- **H10** — keycap factory pipeline 集成 **#14 CLI-Anything** 作为 manifest auto-gen 引擎 (AI 创作助手 backbone)
- **H11** — Pool "Marketing" 分类种子 import: **#8 OpenClaudia 34 skills** + 其他 hermes-skill pack
- **H12** — Built-in keycap 实施 5 个: **#2 ppt2video / #6 SkillOpt / #20 HyperFrames-based video / #1 Lark Trigger / #13 supertonic provider 接入**

### Irisy 新合约
- **IR-6** — keycap factory drive: Irisy 不只 dispatch 已装 keycap, 接 #14 CLI-Anything → 用户说"我想给 Audacity 加 AI 降噪" → Irisy 调 CLI-Anything 自动派生 keycap manifest → 用户 review → install

---

## 6. License 警告汇总

| 项目 | License | CTRL bundling 风险 |
|---|---|---|
| **#1 Proma** | AGPL-3.0 | ❌ 不能 vendor 源码; 只能学架构模式 |
| **#10 OpenHuman** | GPL-3.0 | ❌ 不能 vendor; 只能 OAuth 跨进程对接 |
| **#19 Remotion** | 个人 + ≤3 人公司免费, 否则付费 | ⚠️ soodooi 实体 headcount 决定. 默认选 #20 HyperFrames (Apache 2.0) 规避 |
| **#13 Supertonic** | 开权重 (商业 SaaS 独立) | ✅ 端侧模型免费用; 商业语音云另购 |
| **#14 CLI-Anything** | 学术 OSS (license file 待 verify) | ⚠️ 集成前必须 verify license file |
| **#17 Understand-Anything** | OSS (license file 待 verify) | ⚠️ 同上 |
| **#18 CodeGraph (colbymchenry)** | OSS (license file 待 verify) | ⚠️ 同上; FalkorDB 变体是 AGPL — 选 colbymchenry 不选 FalkorDB |
| **#12 CloakBrowser** | OSS (license file 待 verify) | ⚠️ 同上 |

**Action**: 在 keycap-dev 集成任何 #14/17/18/12 前, hephaestus 必须读 license file + 加进 `THIRD_PARTY_LICENSES.md`.

---

## 8. Content-creation category deep-dive (seede.ai + 8 peers, added 2026-05-26)

bao directive: "还有很多做内容的, 譬如 seede.ai 等做图片海报的, 这些如何接入". Content-creation = a whole category, not single tools. Researched 9 items spanning image / poster / slide-deck / upscale / music / video / 3d.

### 8.1 Per-item findings

| # | Item | Category | API surface | Pricing | Output | CTRL fit | Conf |
|---|---|---|---|---|---|---|---|
| C1 | **seede.ai** | poster / social-post / design | **NO public API** (SaaS only) | Freemium | layered poster | ST-SS shared window OR wait-for-API | HIGH identity, LOW integration |
| C2 | **Recraft V3** | image-gen + **vector SVG** | REST async + webhook | $0.022-0.08/img | image (raster + SVG) | MCP server | HIGH |
| C3 | **Ideogram V3** | text-in-image (typography leader) | REST sync + async | $0.0375-0.1125/img | image (poster / logo / sign) | MCP server | HIGH |
| C4 | **Gamma** | slide-deck + doc + website | REST async, X-API-KEY, export PPTX/PDF | Pro plans → credits | **slide-deck** structured | OAuth | HIGH |
| C5 | **Magnific (Freepik)** | upscaler 2x-16x to 16K | REST async (job-poll) | Per-pixel-area | image upscaled | MCP server | HIGH |
| C6 | **Suno** | music generation | **NO official API**, 3rd-party wrappers | $0.05-1/song via 3rd-party | audio mp3 | ST-SS or local-agent (ToS risk) | MEDIUM |
| C7 | **Runway Gen-4** | video gen | REST async + webhook | ~$0.10-0.40/sec video | video mp4 | MCP server | HIGH |
| C8 | **Tripo AI** | text/image → 3D | REST async | $0.01/credit | **3d glb/obj** + PBR | MCP server | HIGH |
| C9 | **Krea AI** | multi-model aggregator (20+ video/image models) + Realtime canvas | REST job + webhook | Sub + credit pool | image / video / 3d / realtime | MCP server (high-leverage — 1 integration → N models) | HIGH |

### 8.2 Structure findings (apply across ALL content-creation keycaps)

**(a) Async-job is the dominant API shape**. Recraft / Magnific / Runway / Tripo / Krea / Gamma all submit→poll OR webhook. Only Ideogram TURBO is sync. **CTRL kernel B-1 effect envelope must explicit async semantics** (job_id / status / webhook_url / result_uri) — not a new contract, but lift from "deadline_ms only" to "async-job-aware".

**(b) Cost variance 2 orders of magnitude**:
- Cheap: image-gen $0.02-0.10, upscale $0.05-0.20
- Mid: 3D $0.10-0.50, music $0.05-1.00/song, slide $0.20-0.50
- Expensive: **video $1-15+/call** (Runway HQ ~$0.40/sec)

→ **F-6 cost-disclosure modal must have auto-confirm threshold + per-call estimate + post-call actual**. Without this, paid keycaps untrustable.

**(c) New B-3 provider sub-namespaces** (table entries, not contracts):

| Sub-namespace | Providers | Output kind |
|---|---|---|
| `image.generate` (have) | Recraft V3 raster, Ideogram, Flux, Krea | raster image |
| `image.generate.vector` (new) | Recraft V3 vector | SVG |
| `image.upscale` (new) | Magnific | image-enhanced |
| `image.edit` / `image.outpaint` / `image.remix` (new) | Ideogram, Recraft, Krea | image |
| `image.bg_remove` (new) | Seede, commodity | image |
| `video.generate` (new) | Runway, Krea→Sora/Veo/Kling/Hailuo | video mp4 |
| `audio.music.generate` (new) | Suno 3rd-party, Udio | audio mp3 |
| `audio.sfx` (new) | ElevenLabs | audio |
| `model.3d.generate` (new) | Tripo, Meshy, Rodin, Hunyuan3D | glb/obj/fbx + PBR |
| `design.poster.compose` (new) | Seede, Gamma, Canva | layered doc / pptx / pdf |
| `design.slidedeck.compose` (new) | Gamma, Beautiful.ai | slide-deck |

All open-table extensions of B-3. Each provider is a sub-keycap that adapts to a 3rd-party API.

**(d) New PWA renderer kinds** (F-1 table extensions, not new contracts):

| Kind | Use | Lib |
|---|---|---|
| `3d-viewer` | glb/usdz preview | Google `<model-viewer>` web component (MIT) |
| `slide-deck` | Gamma export render | pdf.js OR pptx2html |
| `asset-gallery` | N variants grid for re-roll | grid component, no lib needed |
| `waveform-audio` | music / SFX scrub | wavesurfer.js (BSD-3) |
| `layered-poster` | Seede / Canva-class | `workspace.ui=custom` tier (high bar) |

**(e) New Irisy contracts (these ARE new I-* contracts)**:

| # | Contract | Why content-creation needs it |
|---|---|---|
| **I-7** | **Multimodal asset reasoning** — Pi brain receives generated image/video/3d/audio as input + provides feedback ("too dark", "headline not fitting", "wrong aspect"); requires vision-capable Pi (multi-modal LLM input) or BYOK vision provider | User says "make it more vibrant" → Irisy needs to SEE current output to give specific advice; without I-7 Irisy can only edit prompt blindly |
| **I-8** | **Asset versioning lineage** — vault stores `<asset>.v1.png` + `<asset>.v1.meta.json` (prompt + provider + cost + job_id); Irisy tracks v1→v2→v3 with prompt diff; surfaces in F-5 drill-down | User re-rolls 5 times, wants "go back to v2 + try slight variant"; without I-8 the previous attempts are lost |

**(f) Multi-step pipeline "make me a poster"** — covered by **I-2 multi-keycap chain** (already in 01 doc §3), but content-creation is the canonical use case:

```
intent: "poster for my event"
  ↓ I-1 decompose
  ├─ text.chat (headline + body copy from event details)
  ├─ image.generate (Ideogram for text-in-image OR Recraft vector for logo)
  ├─ image.upscale (Magnific, if hero needs 4K)
  ├─ design.poster.compose (Seede / Gamma / CTRL-native layout)
  └─ vault.write (PNG/PDF + .meta.json with provider chain + cumulative cost)
```

CTRL-native poster keycap differentiates from sending users to Canva by: composing in CTRL workspace using the chain + vault provenance + Irisy on-demand refinement via I-7.

### 8.3 Layer support summary (what each layer adds for content creation)

| Layer | New / extended contracts |
|---|---|
| **Base (zeus)** | B-1 explicit async-job semantics (Z15) · B-3 sub-namespaces image.upscale/edit/outpaint, video.generate, audio.music, model.3d.generate, design.poster/slidedeck (Z16) · B-6 cost-variance handling auto-confirm threshold (Z17) · B-2 render-progress stream sub-type (Z18) |
| **Frontend (daedalus)** | F-1 new kinds: 3d-viewer / slide-deck / asset-gallery / waveform-audio (D16) · F-4 jobs pane for active async jobs cross-keycap (D17) · F-6 cost-disclosure with auto-confirm threshold per category (D18) · F-3 drag-drop reference assets generalization (D19) |
| **Irisy** | **I-7 multimodal asset reasoning** (NEW, Pi vision input) (IR-7) · **I-8 asset versioning lineage** (NEW, vault meta + diff) (IR-8) · I-2 multi-keycap chain — content-creation is canonical use case |

### 8.4 License & integration mode summary

| Mode | Examples | Integration |
|---|---|---|
| **OSS with API + permissive license** | Recraft, Ideogram, Magnific, Runway, Tripo, Krea, Gamma | MCP server keycap; bundle adapter; lowest friction |
| **OSS without API (SaaS only)** | seede.ai | ST-SS shared window (drive web app); wait-for-API; or skip |
| **OSS via 3rd-party wrapper (ToS risk)** | Suno (3rd-party APIs reverse-engineer) | Surface warning to user; user-supplied API key; ToS notice |
| **OAuth platform** | Gamma (API key tied to account), Canva, Adobe Express | OAuth keycap, scope-gated calls |

## 9. Sync substrate via 3rd-party SaaS (added 2026-05-27)

bao directive: "通过 Irisy 和软件 api, 实现规划, 编写, 写入后, 该软件在用户的手机上就可以实时看见". Pattern = let 3rd-party SaaS sync infra carry data desktop→phone. CTRL writes via API, SaaS pushes to its own mobile app, user sees in seconds. **No CTRL mobile app needed for this loop.**

### 9.1 Per-app verification (2026-05 verified)

| Cat | App | API | Auth | Mobile sync | Pricing | License | v1? |
|---|---|---|---|---|---|---|---|
| Notes | **Notion** | REST mature; HMAC webhooks 2025+ | OAuth 2.0 page-scoped | seconds via vendor cloud | Free tier OK for API | SaaS proprietary | ✅ |
| Notes | **Obsidian** | Local REST API plugin only (coddingtonbear); Sync is E2E so CTRL can't inject server | API key paste (no OAuth) | Sync paid $4-10/mo | API plugin MIT; Sync paid | proprietary + plugin | ⚠️ requires user pre-install plugin + paid Sync |
| Notes | **Logseq** | **No public REST 2026** — plugin SDK only | — | Sync paid $5/mo OR free iCloud/Dropbox at FS | OSS AGPL-3 (client) | — | ❌ skip v1, filesystem-only path if anyone |
| Notes | **Joplin** | Local REST on :41184 (Web Clipper) | local token | sync via Joplin Cloud / WebDAV / S3 (~seconds-min) | OSS MIT + €2.99-7.99/mo cloud | OSS | 🟡 niche |
| Notes | **AFFiNE** | GraphQL (docs thin) | session/token | CRDT (Y-Octo) | MIT (self-host) | OSS | 🟡 defer (API doc thin) |
| Finance | **YNAB** | REST v1, mature; no webhooks | OAuth 2.0 or PAT | seconds | **$14.99/mo no free tier** | SaaS | ✅ but hard paywall |
| Finance | **Actual Budget** | NPM `@actual-app/api` only (no REST) | — | **mobile native apps deprecated 2026** → PWA | MIT self-host | OSS | ❌ skip v1 (mobile broken) |
| Finance | **Lunch Money** | OpenAPI v2 (GA early 2026) | PAT single-user | **no first-party mobile** (community apps Pal/Companion) | $10/mo pay-what-you-want | SaaS | ⚠️ weakens phone loop |
| Finance | **Firefly III** | REST + OAuth2 PKCE | OAuth | PWA + 3rd-party native (Firefly Pico / Waterfly) | AGPL-3 self-host | OSS | 🟡 niche self-hosters |
| Tasks | **Todoist** | REST v2 + Sync v9 + unified v1 | OAuth 2.0 / PAT | seconds vendor cloud | Free tier supports API | SaaS | ✅ **top pick** |
| Tasks | **TickTick** | `api.ticktick.com/open/v1` (limited surface) | OAuth | seconds | Free + Premium ~$28/yr | SaaS | 🟡 watch for opaque approval; community libs use private endpoints — ToS land mine |
| Reading | **Readwise + Reader** | Highlights API + Reader API (`v3/save/`) | token (no OAuth) | seconds | $9.99/mo Reader / $5.59 Lite | SaaS | ✅ cleanest "save → phone" loop |

### 9.2 Structure findings

**(a) Top 3 v1 strong-fit candidates**: **Todoist** (gold-standard OAuth + free + fast mobile) · **Notion** (universal note/db, page-scoped consent matches plain-text philosophy) · **Readwise/Reader** (canonical Ctrl-key moment: desktop URL → 地铁手机看). Honorable mention **YNAB** if user accepts $109/yr paywall.

**(b) Dominant auth split**: 6/12 use OAuth 2.0 (Notion/YNAB/Todoist/TickTick/Firefly/AFFiNE), 4/12 use static PAT (Lunch Money/Readwise/Obsidian/Joplin). **CTRL needs both flows**: `oauth_provider` (loopback callback on 127.0.0.1:N → Keychain) and `api_token_paste` (one paste → Keychain). Manifest `auth` field selects.

**(c) Webhook reality**: only Notion has native webhooks (HMAC-SHA256, requires public HTTPS — needs ctrl-relay). **All others = polling or user-refresh.** For v1 skip webhook inbound; revisit when ctrl-relay ships.

**(d) Paid-tier gate**: YNAB / Readwise Reader / Obsidian Sync / Logseq Sync / Lunch Money all gate the sync that makes this work. Free-API-with-no-mobile-sync (e.g. Lunch Money) breaks the loop premise.

**(e) ToS landmines**: TickTick community libs hitting private `/api/v2/*` instead of `/open/v1` → manifest must hardcode `/open/v1` base URL. Logseq has no public HTTP API beyond filesystem.

### 9.3 New B-4 sub-namespace `external_sync.*`

Open table extension (not new contract):

```
external_sync.notion.{page.create, db.row.insert, page.append}
external_sync.todoist.{task.create, task.complete, project.create}
external_sync.readwise.{highlight.create, reader.save_url}
external_sync.ynab.{transaction.create, budget.update}
external_sync.lunchmoney.{transaction.create}
external_sync.firefly.{transaction.create}
external_sync.lark.{message.send, doc.create}   # extends Z14 gateway.lark
external_sync.joplin.{note.create}    # local API not cloud
external_sync.obsidian.{note.write}   # via Local REST plugin
```

### 9.4 Obsidian philosophy reconciliation (本地 truth vs 3rd-party 写入)

`external_sync.*` writes data to 3rd-party SaaS — the **SaaS becomes canonical** for that data (Notion / Todoist / etc. owns the source). This appears to conflict with `decision_ctrl_obsidian_philosophy.md` "本地是 truth, 云是 mirror".

**Resolution**: explicit opt-in trade-off + **always mirror locally**. Every external_sync write also produces:
```
~/.ctrl/vault/external/<service>/<entity-id>.{json|md}
  + frontmatter: { service, remote_id, written_at, sync_status, prompt_chain }
```
- User keeps a plain-text local copy (passes vim test)
- If user leaves CTRL, the data lives both in their SaaS account AND their vault
- If SaaS goes down / user cancels subscription, local mirror still readable
- Irisy I-5 vault-context exposure surfaces these mirrors when grounding response

## 10. IM platforms — Irisy as group participant (added 2026-05-27)

bao directive 2026-05-27: "Intent 这种 IM 工具我们有可能集成上吗? 最好让 Irisy 也能加入到群聊, 这样会很有价值". Different pattern from §9 sync — here Irisy is a **first-class group participant** (reads context, contributes when relevant, threads).

### 10.1 Intent (intent.app) — NOT integratable v1

GroupUltra's AI-translation IM (intent.app, GP listing `app.intent.android`). Consumer mobile-only, no `/developers`, no SDK, no bot API. **Drop from v1.** Watch for API publication.

### 10.2 Platform matrix

| Platform | Create cost | Group join | Read scope | E2E | SDK license | v1 conf |
|---|---|---|---|---|---|---|
| **Telegram Bot** | Free, BotFather | User invites | Privacy mode ON default (@mentions / commands / replies only); toggle OFF or admin → all | No E2E in groups | `grammY` MIT / `teloxide` MIT | **HIGH ✅ v1 first** |
| **Matrix** | Free, self-host or hosted | Bot is a user, invited like person | Full member | **E2E preserved** via vodozemac (CTRL ADR-007 already vendors) | `matrix-bot-sdk` MIT, `matrix-rust-sdk` Apache-2 | **HIGH ✅ v1.1 philosophy-pure** |
| **Slack** | Free workspace | Admin install + per-channel invite | `channels:history` scoped | No E2E | Bolt SDKs MIT | HIGH ⚠️ classic apps deprecating end-2026, build on new platform |
| **Discord** | Free dev portal | User invites | **Message Content = privileged intent**, gate at 100 servers (review required) | No E2E | discord.js Apache-2, serenity-rs ISC | HIGH ⚠️ MCI scaling cliff at 100 servers |
| **Lark/Feishu intl** | Free dev tenant | Workspace admin + channel | Bot event subscription, per-app scoped | No E2E (TLS) | `@larksuiteoapi/node-sdk` MIT | **HIGH ✅ v1 enterprise** (intl + 国内 strictly separated) |
| **Mattermost / Rocket.Chat / Zulip** | Free OSS self-host | Admin install | Full bot scopes | No E2E | MIT / Apache | MEDIUM 🟡 niche reach |
| **DingTalk / WeCom** | Free webhook OR enterprise bot | Group admin | Webhook = outbound only; enterprise = full | TLS only | Permissive | MEDIUM 🟡 China-only |
| **Signal** | signal-cli + dedicated phone # | Bot as person | All group msgs | E2E preserved | **GPL-3.0 blocks CTRL bundling** | **LOW ❌ license + ToS land mine** |
| **WhatsApp Business** | Paid + Meta approval | Customer-initiated only | No group bots; only 1:1 customer | No E2E (cloud-hosted) | Meta proprietary | **LOW ❌ 2026-01-15 bans general AI chatbots** |
| **iMessage** | No API | Beeper bridge needs Mac + Apple-ID puppet | — | E2E lost via bridge | Beeper repo legal grey | **LOW ❌ Apple kills bridges; treat unreachable** |
| **WeChat personal** | Reverse-engineered itchat/wechaty | Personal account login | All | None | MIT libs but **ToS = permanent ban** (2026-04 crackdown active) | **NEVER ❌ DO NOT SHIP** |

### 10.3 Synthesis — pattern implications

**(1) v1 path**: Telegram first (lowest friction, BotFather → token in 10min, scales to millions). Matrix as v1.1 philosophy-pure follow-up (vodozemac already in tree). Lark intl as v1 B2B path (extends gateway.lark Z14).

**(2) Split Z14**: keep `gateway.trigger.*` (one-way, fire-and-forget, current Z14 semantics for Proma) as one B-4 sub-table; add `gateway.participant.*` (NEW B-4 sub-table, bidirectional group-member) as separate sub-namespace because consent / state / rate-envelope / E2E posture all differ.

**(3) Context window primitive**: new B-4 sub-namespace `chat.*` for kernel-resident group context:
- `chat.context.window(room_id, n_messages, since)` — windowed ring-buffered history per room
- `chat.context.subscribe(room_id, filter)` — push events when relevant message arrives (B-2 stream)
- Storage: SQLite event-sourced per ADR-001 (kernel-native), markdown export per room (vim test)

**(4) Pi brain throttling — NEW Irisy contract I-9**: group autonomy. Pi decides `should_speak / listen / defer` for each new group message. Default rules: respond if `@`-mentioned, respond if direct reply to Irisy's last turn, otherwise stay silent unless keycap config flag `permissive_mode: true`. **Anti-spam = product table stakes** for any group-participant LLM.

**(5) Consent disclosure (Transparency-by-drill-down)**: bot joins group → posts a 1-message disclosure: "Irisy can read all messages in this group; messages are not E2E encrypted to begin with" (or correct posture per platform). User-side consent recorded in vault. Drill-down: tap Irisy in member list → see permission scope.

**(6) Risk callouts (DO-NOT-SHIP)**:
- **WeChat personal** — ToS ban tier, 2026-04 AI-content crackdown active
- **iMessage Beeper** — Apple kills bridges (Beeper Mini precedent), Mac-required, Apple-ID puppet violates user data ownership
- **Signal signal-cli** — GPL-3 incompatible with CTRL All-Rights-Reserved + no-publish rule
- **WhatsApp Business** — 2026-01 Meta bans general-purpose AI chatbots (Irisy = direct policy violation)

### 10.4 New Irisy contract I-9

| # | Contract | Detail |
|---|---|---|
| **I-9** | **Group-chat autonomy** | (a) `should_speak(message, context_window) → {speak, listen, defer}` — Pi brain throttle decision; (b) context window pull via `chat.context.window` before deciding; (c) consent disclosure post on bot join; (d) rate envelope (per-group throttle); (e) Transparency-by-drill-down member-info panel surfacing scope. **Anti-spam + privacy is the v1 trust gate.** Without I-9, Irisy in group = spammy + invasive. |

## 11. Changelog

| Date | Change |
|---|---|
| 2026-05-26 | Initial — 4 parallel research agents (5 items each) covering items 1-20; memory grep for item 21 returned 0 hits. 21 items mapped to 5 sources × universal contracts (01 doc §3); 0 new contracts triggered except `gateway.*` namespace (B-4 extension). v1 / v1.x / v1.1+ priority list + 4 disambiguation Qs for bao. |
| 2026-05-26 | **§8 added** — content-creation category deep-dive (seede.ai + 8 peers Recraft/Ideogram/Gamma/Magnific/Suno/Runway/Tripo/Krea). Structure findings: async-job is dominant API shape (lift B-1 envelope), 2-order cost variance (lift F-6), 11 new B-3 sub-namespaces (image.* extensions + video.* + audio.music + model.3d + design.compose), 5 new F-1 renderer kinds (3d-viewer / slide-deck / asset-gallery / waveform / layered-poster), **2 new Irisy contracts I-7 (multimodal asset reasoning) + I-8 (asset versioning lineage)**. Layer-support summary table + license/integration mode taxonomy. |
| 2026-05-27 | **§9 added** — sync substrate via 3rd-party SaaS. 12 apps verified across notes/finance/tasks/reading; top 3 v1: Todoist + Notion + Readwise/Reader. New B-4 sub-namespace `external_sync.*` (open-table). Obsidian-philosophy reconciliation: every external_sync write mirrors locally to `~/.ctrl/vault/external/<service>/<id>.{json,md}`. |
| 2026-05-27 | **§10 added** — IM platforms Irisy-as-group-participant. Intent (intent.app) confirmed has no bot API in 2026-05 — drop v1. Platform matrix: Telegram v1 first / Matrix v1.1 philosophy-pure (vodozemac already vendored) / Lark intl v1 enterprise. DO-NOT-SHIP: WeChat personal / iMessage Beeper / Signal signal-cli (GPL) / WhatsApp Business (2026-01 AI chatbot ban). **New Irisy contract I-9** group-chat autonomy (should_speak + context window + consent disclosure + rate envelope). New B-4 sub-namespaces `gateway.participant.*` + `chat.*` (context window + subscribe). Z14 split: `gateway.trigger.*` (one-way Proma) vs `gateway.participant.*` (bidirectional group-member) — different consent + state + rate envelope. |
