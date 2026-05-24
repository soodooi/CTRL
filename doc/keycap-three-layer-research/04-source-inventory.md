# Keycap source inventory — research note 04

> Author: zeus · Status: open inventory · Continues 03 end-to-end pipelines.
> bao 2026-05-23: "从源头梳理 — 哪些网站 / GitHub 开源项目 / skill / MCP 可以集成上去, 一条一条过".
>
> 不预设结论。建框架 + 列每条 + 标优先级 + 标 status. zeus training cutoff = Jan 2026; 部分条目标 "verify" 等 WebSearch 补 + bao 跟 hephaestus 验证。

---

## 1. 分类框架 (5 个源头类型, 对应 CLAUDE.md 5 keycap sources)

| Source type | 用户视角 | 集成路径 | 例子 |
|---|---|---|---|
| **A. MCP server (公开)** | "用现成 MCP server 加" | manifest variant=mcp-server, source.type=mcp | GitHub MCP / Filesystem MCP / Notion MCP |
| **B. OAuth 平台** | "登录我的 X 账号" | manifest variant=oauth, source.type=oauth + loopback flow | 飞书 / Notion / Linear / Slack / GitHub |
| **C. 本地 agent / CLI** | "调本机 X 工具" | manifest variant=cli-wrapper / local-agent, source.type=cli-wrapper | Hermes / Claude Code / Ollama / VMark / Obsidian |
| **D. Skill (agentskills.io)** | "装一个能力包" | manifest variant=builtin + target=hermes-skill, skill 文件在 `~/.hermes/skills/` | Anthropic 官方 skill / 社区 skill |
| **E. Raw 网页 / 自定义 HTTP** | "我想接 X 网站" | manifest variant=builtin, step network.http + JSONPath extract | 任何 REST API (有 OpenAPI 加分) |

CTRL philosophy 不限制用户走哪条 — workshop 第一屏 5 模板入口 (per 03 §6.3) 对应这 5 类。

---

## 2. MCP servers — 官方 + 公开生态

### 2.1 官方 (modelcontextprotocol/servers)

reference 实现, 都是 MIT / Apache, 可直接 ship. Verify list against current registry; below is what I'm confident about as of training cutoff:

| 名字 | 用途 | 优先级 | Notes |
|---|---|---|---|
| `filesystem` | 本地文件读写 (CTRL 已有 vault.* 替代) | skip | 跟 vault.* 重叠 |
| `git` | git 命令包装 | P1 | "git status / log / blame in any repo" keycap |
| `github` | GitHub API 包装 | **P0** | issues / PRs / repos / search — 开发者高频 |
| `gitlab` | GitLab API 包装 | P2 | 国内/欧洲用户 |
| `postgres` | Postgres 查询 | P1 | "query my prod DB" — DB 用户高频 |
| `sqlite` | SQLite 查询 | P1 | 本地数据/笔记结构化查询 |
| `brave-search` | 网络搜索 | **P0** | "search web from CTRL" 是常驻 keycap |
| `google-maps` | 地图/路径 | P2 | 出行场景 |
| `sentry` | 错误监控查询 | P2 | 开发者 |
| `sequential-thinking` | LLM tool use 内部 | infra | 不是 user-facing keycap |
| `slack` | Slack 消息 | **P0** | 国际团队高频 |
| `time` | 时区/时间 | infra | LLM 调用辅助, 不是独立 keycap |
| `fetch` | HTTP GET wrapper | infra | step network.http 已替代 |
| `memory` | knowledge graph | P1 | 跟 G12 重叠 — 让 hephaestus 比较 |
| `puppeteer` | 浏览器自动化 | P1 | "scrape this page" / web 自动化场景 |
| `everything` | demo server | skip | |

### 2.2 第三方 MCP (公开生态)

bao 视野的 "10,000+ Day-1" 大头在这。我熟的 + 需 verify (打 ⚠️ ):

| 名字 / GitHub | 类别 | 优先级 | Notes |
|---|---|---|---|
| **Notion MCP** (`makenotion/notion-mcp-server`) | 知识库 | **P0** | 国际 Notion 用户必备 |
| **Linear MCP** (`linear-archive/linear-mcp` ⚠️) | issue 管理 | **P0** | 创业团队高频 |
| **Obsidian MCP** (`MarkusPfundstein/mcp-obsidian` ⚠️) | vault | P1 | bao 选 VMark 是 base, Obsidian users 仍是大群体 |
| **VMark MCP server** (`xiaolai/vmark` 的 `@vmark/mcp-server`) | vault | **P0** | bao 钦定 base substrate (spec §5.2) |
| **Spotify MCP** | 音乐 | P2 | 副业场景 |
| **YouTube MCP** ⚠️ | 视频 | P1 | "summarize video", scrape captions |
| **Stripe MCP** (`stripe/stripe-mcp` ⚠️) | 支付 | P2 | SaaS 创始人 |
| **Cloudflare MCP** ⚠️ | 网络 | P2 | DevOps |
| **Apify MCP** | scraper 平台 | P1 | 大量预制 scraper |
| **Figma MCP** ⚠️ | 设计 | P1 | 设计师, 2026 趋势 |
| **Cursor MCP** ⚠️ | coder | P1 | 跟 Claude Code 互补 |
| **Twitter (X) MCP** ⚠️ | 社交 | P1 | "post tweet" / "read mentions" |
| **Reddit MCP** ⚠️ | 社区 | P2 | |
| **HackerNews MCP** | 社区 | P2 | 简单 fetch, 低优先级 |
| **Wikipedia MCP** | 知识 | P1 | "查百科" |
| **Arxiv MCP** | 科研 | P2 | 学术用户 |
| **AWS / GCP / Azure MCP** ⚠️ | 云 | P2 | DevOps |
| **Discord MCP** ⚠️ | 社区 | P2 | 游戏 / 社区运营 |

### 2.3 中国 / 中文圈 MCP servers

这部分**严重需验证** — 中文圈 MCP 生态新, 我训练数据稀。需 WebSearch / hephaestus 跑一遍 agentskills.io + 中文社区 (即刻 / 知乎 / 微博 / X 上的 #MCP) 才能补全。

| 名字 ⚠️ | 类别 | 优先级 | Notes |
|---|---|---|---|
| **飞书 (Lark) MCP** | 协作 | **P0** | 中文圈协作高频; 官方还是第三方需 verify |
| **钉钉 (DingTalk) MCP** ⚠️ | 企业 | P1 | 中企业用户 |
| **企业微信 MCP** ⚠️ | 企业 | P1 | 中企业用户 |
| **微信 MCP** ⚠️ | 通讯 | P0? | 微信官方不开 API, 第三方 web 协议套壳风险 |
| **知乎 MCP** ⚠️ | 知识 | P2 | "搜知乎答案" |
| **微博 MCP** ⚠️ | 社交 | P2 | |
| **小红书 MCP** ⚠️ | 社交 | P2 | 营销用户 |
| **B 站 (bilibili) MCP** ⚠️ | 视频 | P2 | |
| **抖音 MCP** ⚠️ | 视频 | P2 | API 限制严格 |

**Status: 全部 verify 待 hephaestus 跟我下一轮调研补**. CLAUDE.md memory `decision_ctrl_is_global_english_first` 优先级在 hermes / agentskills / global MCP > flomo / 飞书 / Coze, 所以中文 MCP 可推后调研, 但 v1 launch 拿 Feishu 一个 P0 必需 (bao 是中文用户).

---

## 3. OAuth 平台 (没 MCP 或 MCP 不成熟时走 OpenAPI + OAuth)

跟 Pipeline B 对应。manifest variant=oauth, source.provider 已定义 enum (Feishu / Notion / Linear / Slack / GitHub).

| Provider | OAuth + API 状态 | 内置 endpoint 建议 (10-15 个) | 优先级 |
|---|---|---|---|
| **Feishu** | OAuth 2.0, OpenAPI 100+ endpoint | send_message / read_chat / upload_file / create_doc / search / get_user / list_chats / etc. | **P0** |
| **Notion** | OAuth 2.0, REST API | create_page / append_block / search / database_query / etc. | **P0** |
| **Linear** | OAuth 2.0 + GraphQL | create_issue / list_issues / update_issue / comment / search / etc. | **P0** |
| **Slack** | OAuth 2.0 + Web API | chat.postMessage / conversations.list / users.lookupByEmail / files.upload / search.messages | **P0** |
| **GitHub** | OAuth 2.0 + REST + GraphQL | list_issues / create_issue / search_repos / get_pr / merge_pr / list_my_repos / etc. | **P0** |
| **Discord** | OAuth 2.0 + REST | post_message / read_channel / list_servers | P1 |
| **Twitter (X)** | OAuth 2.0 (限制大, 付费) | post_tweet / read_mentions / search | P1 (限制问题) |
| **Google (Workspace)** | OAuth 2.0 + REST | gmail.send / drive.upload / calendar.add / docs.create | P1 |
| **Microsoft 365** | OAuth 2.0 + Graph | mail.send / onedrive.upload / teams.message | P2 |
| **Zoom** | OAuth 2.0 | create_meeting / list_recordings | P2 |
| **Trello** | OAuth 1.0a | create_card / list_boards | P2 |
| **Asana** | OAuth 2.0 | create_task / list_projects | P2 |
| **Reddit** | OAuth 2.0 | post / comment / read_subreddit | P2 |
| **YouTube** | Google OAuth | search / upload / playlist | P2 |
| **微信开放平台** ⚠️ | OAuth 2.0 (复杂) | 限制多, 不推 v1 | P2 |
| **支付宝** ⚠️ | OAuth | 商业场景 | P2 |
| **企业微信** ⚠️ | 类 OAuth | 企业 | P2 |

**v1 ship 量**:
- P0 = 5 个 (Feishu / Notion / Linear / Slack / GitHub) — 内置 OAuth template + 10-15 endpoint spec
- P1 = 4 个 (Discord / Google / Twitter / Microsoft) — v1.1
- P2 = 一堆 — 用户自加 (workshop 让用户填 OAuth config + endpoint URL)

**新 substrate G13 — Loopback OAuth + Provider spec registry**:
- `~/.ctrl/providers/<name>.json` 内置 5 个 P0 provider 的 client_id + scope + endpoint list
- kernel 提供 `oauth.start(provider) → opens browser → callback → keychain.store_key`
- 走 ADR-015 vim test: provider JSON 是 plain text, 用户可看可编可加

---

## 4. 本地 agent / CLI (Pattern C — local agents)

这些是已经在用户机器上的程序, CTRL 通过 subprocess / stdio / HTTP API wrap 成 keycap.

| 名字 | 类别 | 集成路径 | 优先级 |
|---|---|---|---|
| **Hermes Agent** | AI runtime | 已集成 (irisy_init / irisy_chat_hermes / irisy_upgrade_hermes) | **shipped** |
| **Claude Code** (Anthropic CLI) | coder | wrap stdio + ANTHROPIC_API_KEY env | **P0** if bao 在用 |
| **Cursor CLI** | coder | wrap stdio | P1 |
| **Ollama** | local LLM | HTTP API @ :11434 | **P0** (privacy geek tier per CLAUDE.md) |
| **LM Studio** | local LLM | HTTP API | P1 (Ollama 替代) |
| **VMark** | vault editor | lazy install + URL scheme + MCP sidecar | **P0** (bao 钦定) |
| **Obsidian** | vault editor | URL scheme `obsidian://` + plugin API (复杂) | P1 |
| **Logseq** | vault editor | URL scheme | (bao 决定 v1 不上) |
| **Raycast** | launcher | 不集成 (竞品), 学模式 | study only |
| **Alfred** | launcher | 竞品 | study only |
| **Espanso** | text expander | YAML 配置 + CLI | P2 |
| **fish / zsh / bash** | shell | SubprocessActor + PTY (Code Space 已 ship) | shipped |
| **ffmpeg** | 多媒体 | CLI wrap | P2 (高级用户) |
| **Pandoc** | 文档转换 | CLI wrap | P2 |
| **ImageMagick / GraphicsMagick** | 图像 | CLI wrap | P2 |
| **yt-dlp** | 视频下载 | CLI wrap | P2 |
| **jq / yq** | JSON / YAML 工具 | step 内置 transform 已替代 | infra |

**v1 ship 量**:
- P0 = Claude Code / Ollama / VMark — 3 个本地 agent 直接集成
- Hermes 已 ship
- 其他通过用户自加 (workshop CLI-wrapper template, 填 binary path + args)

---

## 5. Skills (agentskills.io + hermes ecosystem)

manifest target=hermes-skill, 安装到 `~/.hermes/skills/<name>/SKILL.md` + assets/.

| 来源 | Status | 优先级 |
|---|---|---|
| **agentskills.io 官方 skill marketplace** ⚠️ | training 后期出现, verify 当前状态 | P1 |
| **claude-skills/skills (社区 GitHub)** ⚠️ | 社区 skill 集 | P1 |
| **CTRL 内置 skill** | hephaestus 维护 | P0 — 跟 v1 builtin keycap 重合 |

**v1 ship 策略**:
- v1: 不内嵌 skill marketplace UI; workshop 让用户填 skill URL 装
- v1.1: 接 agentskills.io 浏览 (类似 "MCP marketplace") — 单独一个 substrate (G14?)

跟 G10 prompt registry 关系: skill 是 markdown + asset; G10 prompt 是 markdown only. Skill 更重 (含 code / sub-tools), prompt 更轻 (纯 system prompt). v1 两个都需要, 不互斥.

---

## 6. GitHub OSS — 借鉴模式, 不集成

CTRL 自己造的部分会借鉴这些开源项目的设计 / 代码 (license 友好的)。

| 项目 | 用途 | 借鉴方向 | License |
|---|---|---|---|
| **`reactflow` / `@xyflow/react`** | canvas / node graph | workshop 无限画布 (per 03 §6.2) | MIT |
| **`react-jsonschema-form`** | schema → form | workshop schema-driven form (per 03 §6.4) | Apache 2.0 |
| **`use-zustand`** | 状态管理 | workshop store (per Daedalus D5 PWA cache) | MIT |
| **`@tanstack/react-router`** | 路由 | 已用 | MIT |
| **`react-markdown` + `remark-gfm`** | markdown 渲染 | 已用 (Irisy P0 #1) | MIT |
| **`tldraw`** | infinite canvas + collab | workshop canvas 候选 | TLDraw License (商业受限, 用前看) |
| **`Logseq`** (AGPL-3.0) | vault | 不集成 (bao 决定); 学 plugin 架构 | AGPL — 不 fork 不 bundle |
| **`Obsidian`** (proprietary) | vault | 学插件 / template 模式 | 闭源 |
| **`Raycast Extensions`** | extension model | 学 manifest + UI 模式 (借鉴 1000+ extension 命名 + 分类) | MIT |
| **`Cursor`** | coder + canvas (2026 v3) | 学 agent + canvas 互动模式 | 闭源 (UI 模式公开) |
| **`Figma`** (2026 agent 开放) | canvas + agent | 学 agent 改 canvas 模式 (但 v1 不实做 D5 全套) | 闭源 |
| **`Continue.dev`** | coder companion | 学 extension config UI | Apache 2.0 |
| **`LobeChat`** | LLM UI 中文 | 学中文用户预设 | MIT |
| **`AnythingLLM`** | private LLM | 学知识库 ingestion 模式 | MIT |
| **`Pieces for Developers`** | snippet + clipboard | 学 clipboard history UX | 闭源 |
| **`n8n`** | workflow editor | 学 per-step trace inspector (per 03 §6.6) | Sustainable Use License (商用看许可) |
| **`Pipedream`** | workflow + git sync | 学 drafts + version control 模式 (per Hephaestus D4) | 闭源, 但概念公开 |
| **`Zapier`** | workflow no-code | 学触发器 + zap template 模式 | 闭源 |
| **`shadcn/ui`** | UI components | 不用 (CLAUDE.md 禁用 component library); 学 Radix 模式 | MIT |
| **`Lucide`** | icon set | workshop icon palette 候选 | ISC |
| **`Tabler Icons`** | icon set | 同上 | MIT |
| **`Heroicons`** | icon set | 同上 | MIT |
| **`@lottiefiles/dotlottie-react`** | animation | 已用 (Daedalus IconRenderer §3.3) | MIT |

**重要 license 注意**:
- AGPL (Logseq) → 不 fork 不 bundle, lazy install 模式 (我们已经为 Logseq 写过 doc, 现在没接但模式留着用 VMark)
- TLDraw License → 商用前 verify; reactflow 是更安全选择
- n8n Sustainable Use License → 商用条款细看 (CTRL 是 closed-source, n8n 概念可借鉴, 代码不 copy)

---

## 7. Priority-consolidated v1 ship list (CTRL 自己 ship 的内置入口)

**workshop 第一屏的 5 模板入口对应的"已知好用"清单**:

### 模板 1 — MCP server tool 包装

预置 6 个 P0 MCP server 一键接入 (推荐, 不强制):
1. **github** (modelcontextprotocol/servers 官方)
2. **brave-search** (官方)
3. **VMark** (xiaolai/vmark 的 sidecar — bao 钦定)
4. **Notion** (verify 官方 status)
5. **Linear** (verify)
6. **Slack** (官方)

用户也能 "Add by URL" 加任何第三方 MCP。

### 模板 2 — OAuth 平台

预置 5 个 P0 (per §3):
1. Feishu
2. Notion
3. Linear
4. Slack
5. GitHub

每个内置 client_id + 10-15 endpoint spec.

### 模板 3 — 本地 agent / CLI

预置 4 个 P0:
1. **VMark** (lazy install)
2. **Claude Code** (CLI wrap, ANTHROPIC_API_KEY 走 keychain)
3. **Ollama** (HTTP @ :11434)
4. **Hermes** (已 ship)

### 模板 4 — LLM keycap (无 platform 依赖)

用户填 prompt + input source + output target. 不需要预置清单。Pipeline C 走通就行。

### 模板 5 — fork existing

列用户已装 keycap. 不需要预置内容, list_keycaps 出。

### Bonus — "0 from scratch"

无限画布, 用户从 supplier palette 拖。Power user 路径。

---

## 8. 必须 v1 ship 的新 substrate (per inventory)

inventory 暴露的新 substrate 需求, 加入 keycap-base-layer spec:

| Substrate | 来自哪条 source | Status | 优先级 |
|---|---|---|---|
| **G13 — Loopback OAuth + 5 provider spec registry** | §3 OAuth 平台 | 没 spec, 没代码 | **P0** (5 模板入口 #2 必需) |
| **G14 — MCP marketplace / Add by URL** | §2 MCP servers | 没 spec, 没代码 | **P0** (5 模板入口 #1 必需) |
| **G15 — CLI wrapper + binary discovery** | §4 local agents | 部分 (irisy 走 hermes-only) | P0 (5 模板入口 #3 必需) |
| **G16 — Skill marketplace bridge** | §5 skills | 没 spec, 没代码 | P1 (v1.1) |
| **G17 — JSONPath / filter / map data step** | §2 + §3 任意 API response 处理 | 没 spec, 没代码 | P0 (per 03 §6.9) |
| **G18 — side_effect 标签** (新增字段) | §3.5 Pipeline 都需要 sandbox 分级 | 没 spec, 没代码 | **P0** (per 03 §6.5) |

合并 keycap-base-layer spec §3 ❌ Missing 列表 (G1-G9 + G10/G11/G12 hephaestus 加的) → **共 G1-G18, 18 个 gap**. 一半是 v1 P0 (G1 VMark / G2 MCP client / G7 clipboard / G8 screen / G9 shell.open / G10 prompt registry / G11 image lib / G12 memory / G13 OAuth / G14 MCP marketplace / G15 CLI wrap / G17 data transform / G18 side_effect).

剩 G3-G6 (audio/image extension) + G16 (skill marketplace) 可 v1.1.

---

## 9. 调研 holes 待补 (WebSearch / hephaestus 一轮)

- 中文圈 MCP server 真实 status (飞书 / 钉钉 / 企业微信 / 微信 / 知乎 / 微博 / 小红书 / B 站) — 全标 ⚠️
- 第三方 MCP 当前活跃度 (有些 repo 可能已 abandoned) — Linear / Stripe / Cloudflare / Figma / Cursor / Twitter / Reddit / AWS 全标 ⚠️
- agentskills.io 当前 skill 数量 + 分类
- Hermes ecosystem skill 数量
- ChromaDB / Pinecone / Weaviate 等 vector DB MCP 状态
- TLDraw 商用 license 当前条款 (用前 verify)
- n8n / Pipedream 当前 license 条款

每条 ⚠️ 都是 1 个 WebSearch query + 5 分钟阅读, 总量 30-50 query, 可在 1 个 session 内完成.

---

## 10. 给 bao 的关键 open Q

1. **v1 P0 MCP server 数量**: §2.1 列了 6 个 + §7 模板入口 1 我列 6 个推荐, 这 6 个对吗? 多还是少?
2. **v1 P0 OAuth provider 数量**: §3 列 5 个 (Feishu / Notion / Linear / Slack / GitHub), 全 v1 ship 还是先 Feishu + GitHub 两个 (per 03 §9.3)?
3. **中文 MCP 调研**: 这部分 ⚠️ 最重, 是否值得现在花 30 个 WebSearch query 补全? 还是等 Feishu MCP 一个 ship 再说?
4. **Skill marketplace v1 做不做**: §5 我标 P1 v1.1 — 同意推后吗?
5. **CLI wrap (Claude Code / Ollama)**: §4 列 3 个 P0 + Hermes 已 ship — 这 3 个用户量你判断对吗?
6. **TLDraw / reactflow 二选一**: workshop 无限画布选哪个? license 友好度: reactflow MIT 更稳, TLDraw 商用可能要付钱 — 建议 reactflow.
7. **Provider spec 谁维护**: 50-100 个 endpoint spec 持续维护成本不低, 我建议**社区 PR** + CTRL 内置 5 个 P0; v1.1+ 让 CTRL community 自补充。 同意吗?
8. **G13 / G14 / G15 谁接**: 3 个新 substrate 都是 v1 P0, kernel + Tauri command 量, 落 hephaestus 还是 zeus 还是分?

---

## 11. 行业维度 (bao 2026-05-23: 办公 / 日常 / 电商 / 营销 + ...)

之前的 §2–§5 按 **source type** 分 (MCP / OAuth / CLI / Skill / HTTP) — 这是工程视角。bao 现在加 **industry vertical** 维度 — 这是产品 positioning, 决定 workshop 推荐 keycap + 内置模板的 default 顺序。

**8 个候选行业 vertical** (bao 列了 4 个, 我加 4 个常被低估的 knowledge-worker segment, 等 bao 确认):

### 11.1 办公 (knowledge worker — bao 列)

- **画像**: 公司白领 / 项目经理 / 行政 / 教师 / 律师助理
- **高频痛点**: 跑会议 / 写文档 / 找信息 / 跨平台沟通 / 总结
- **关键 source** (来自 §2-§4):
  - 协作: 飞书 / Notion / Slack / Teams (P0 OAuth + MCP)
  - 文件: GDrive / OneDrive / Dropbox (P1 OAuth)
  - 日程: Calendar (Google / Outlook, P1)
  - 知识库: Notion / Obsidian / VMark (P0 OAuth + local)
- **v1 P0 keycap (3-5 个建议)**:
  1. "Summarize this meeting transcript" (LLM, Pipeline C)
  2. "Post selected text to 飞书 #channel" (OAuth Pipeline B)
  3. "Create Notion page from selection" (OAuth)
  4. "Add to today's daily note" (vault.write)
  5. "Find recent docs about X" (vault.search + Notion.search)

### 11.2 日常 (普通用户 / 学生 / 副业 — bao 列)

- **画像**: 大学生 / 个人用户 / 副业开始者
- **高频痛点**: 翻译 / 学习 / 阅读 / 提醒 / 个人助理
- **关键 source**:
  - LLM (translate / summarize / Q&A) — kernel substrate
  - Search: Brave / Google (P0 MCP)
  - Wikipedia (P1 MCP)
  - 任务: Todoist / Reminders (P2 OAuth)
- **v1 P0 keycap**:
  1. "Translate" (LLM, builtin 已 ship)
  2. "Summarize this page / article" (LLM)
  3. "Ask Wikipedia" (MCP + LLM)
  4. "Remind me in 1h" (calendar 本机 + notification)
  5. "Save to my reading list" (vault.write)

### 11.3 电商 (运营 — bao 列)

- **画像**: 淘宝 / 京东 / 拼多多 / Shopify / Amazon 店主
- **高频痛点**: 选品调研 / 商品文案 / 客服回复 / 数据看板 / 跨平台上架
- **关键 source**:
  - 平台 API: 淘宝开放平台 / Shopify Admin API / Amazon SP-API (P1 OAuth, 都有 API)
  - 客服: 淘宝旺旺 / 微信 (P2, 中文圈微信难)
  - 数据: 生意参谋 / Shopify Analytics (P1)
  - LLM: 文案 / 客服回复草稿
  - 图片: Volc image.generate / Poster (已 ship)
- **v1 P0 keycap**:
  1. "写商品文案 (input: 产品特点)" (LLM)
  2. "Polish 客服回复 (input: 顾客消息)" (LLM)
  3. "生成主图 / 海报" (Poster — 已 ship)
  4. "翻译商品描述 (中→英 / 英→中)" (Translate)
  5. "竞品文案抓取" (network.http + LLM extract, Pipeline D)

### 11.4 营销 (内容 + 投放 - bao 列)

- **画像**: 品牌 / 内容运营 / 投放优化师 / 自媒体
- **高频痛点**: 内容生产 / 跨平台分发 / 数据汇报 / 素材生成 / 竞品监测
- **关键 source**:
  - 内容平台: 小红书 / 抖音 / B 站 / 公众号 / Twitter (中文 OAuth 难, 多走 scrape)
  - 投放: Facebook Ads / Google Ads / 巨量引擎 / 千川 (P2, OAuth 复杂)
  - 数据: GA / Mixpanel (P2 OAuth)
  - LLM: 文案变体 / SEO
- **v1 P0 keycap**:
  1. "生成 5 个小红书 caption 变体" (LLM)
  2. "Poster 海报" (已 ship)
  3. "改写 for 抖音文案" (LLM, 风格 transform)
  4. "翻译并适配 X 平台" (LLM + culture adapt)
  5. "竞品爬取 / 内容监测" (network.http + LLM)

### 11.5 开发 (software engineer — zeus 加, 等 bao 确认)

- **画像**: 程序员 / DevOps / SRE
- **高频痛点**: 写代码 / 看 PR / 查 bug / 文档 / 部署
- **关键 source**:
  - GitHub / GitLab (P0 MCP + OAuth, 双路径)
  - CLI: Claude Code / Cursor (P0 local agent)
  - Stack Overflow (P2 MCP if 存在)
  - 文档: MDN / npm / pypi / crates (P1, 走 fetch)
  - DB: Postgres / SQLite (P1 MCP)
- **v1 P0 keycap**:
  1. "Ask Claude Code about this file" (CLI wrap)
  2. "Search StackOverflow" (LLM + scrape)
  3. "Open file in Cursor" (URL scheme)
  4. "Explain this code" (LLM)
  5. "Query DB X" (Postgres MCP)

### 11.6 设计 (UI/UX/平面 — zeus 加, 等 bao 确认)

- **画像**: 设计师 (UI / UX / 平面 / 视觉)
- **高频痛点**: 找参考 / 改色 / 排版 / 出图 / 协同
- **关键 source**:
  - Figma MCP (P1 已列)
  - 图片生成: Volc / Midjourney (P0 内置)
  - Pinterest / Behance / Dribbble (P2 scrape)
  - 配色: Coolors API (P2)
- **v1 P0 keycap**:
  1. "Generate reference image" (image.generate)
  2. "Color palette from image" (image.ocr-ish or LLM vision)
  3. "Open in Figma" (URL scheme)
  4. "海报生成" (Poster)

### 11.7 写作 / 创作 (内容生产者 — zeus 加)

- **画像**: 编辑 / 公众号作者 / 自媒体 / 小说作者
- **高频痛点**: 写 / 改 / 配图 / 排版 / 发布跨平台
- **关键 source**:
  - LLM: 改写 / 润色 / 标题
  - 图片: image.generate
  - 平台: 公众号 / 知乎 / 简书 / Medium / 即刻
  - vault: Notion / VMark
- **v1 P0 keycap**:
  1. "改写为公众号风" (LLM, 风格 transform)
  2. "生成 3 个标题候选" (LLM)
  3. "配图 from prompt" (image.generate)
  4. "整理为长文 outline" (LLM)
  5. "Save to vault as draft" (vault.write)

### 11.8 教育 (教师 / 学生 — zeus 加)

- **画像**: 中小学 / 大学老师 / 学生 / 培训师
- **高频痛点**: 备课 / 出题 / 解题 / 笔记 / 学习
- **关键 source**:
  - LLM (解释 / 题目生成 / 备课)
  - Wikipedia / Arxiv (高校)
  - vault (笔记)
  - 平台: 学而思 / 猿辅导 (中, 难接) / Khan Academy (P2)
- **v1 P0 keycap**:
  1. "解释这个概念" (LLM)
  2. "出 3 道练习题" (LLM)
  3. "笔记总结" (LLM + vault.write)
  4. "查百科 (Wiki / Baidu)" (MCP / scrape)
  5. "学习计划" (LLM)

### 11.9 v1 launch 策略

- **通用 15 个 builtin keycap** (CLAUDE.md Top 15 v1) — 装机即有, vertical-agnostic
- **8 个 vertical, 每个 3-5 个 vertical-specific keycap** — workshop "推荐 for 你的行业" 板块, 用户选行业后展现
- **workshop 第一屏** 增加: 上半部分 "选行业" (8 chip), 下半部分 "5 模板入口" (per §7) — 让用户既能按行业找现成 keycap, 也能按 source type 造 keycap
- **可不选行业** — 跳过即用通用集合; 用户后续可在 settings 改

### 11.10 行业 × source matrix (供 workshop 推荐排序用)

|  | 飞书 | Notion | Slack | GitHub | Linear | VMark | LLM | image.gen | 平台 scrape |
|---|---|---|---|---|---|---|---|---|---|
| 办公 | ★★★ | ★★★ | ★★★ | ★ | ★★ | ★★★ | ★★★ | ★ | — |
| 日常 | ★ | ★★ | — | — | — | ★★★ | ★★★ | ★★ | ★ |
| 电商 | ★★ | ★ | — | — | — | ★ | ★★★ | ★★★ | ★★★ (淘宝/京东) |
| 营销 | ★ | ★★ | ★ | — | — | ★ | ★★★ | ★★★ | ★★★ (小红书/抖音) |
| 开发 | ★ | ★★ | ★★★ | ★★★ | ★★★ | ★★ | ★★★ | ★ | ★★ |
| 设计 | ★ | ★★ | ★ | — | — | ★ | ★ | ★★★ | ★ |
| 写作 | ★★ | ★★★ | — | — | — | ★★★ | ★★★ | ★★★ | ★★ |
| 教育 | — | ★★ | — | — | — | ★★★ | ★★★ | ★★ | ★ |

★★★ = vertical 高频, workshop 推荐排序优先; ★ = 偶尔; — = 几乎无关。

### 11.11 给 bao 的新 open Q (基于行业)

A. **8 个行业对吗?** bao 列了 4 个 (办公/日常/电商/营销), 我加了 4 个 (开发/设计/写作/教育). 是 8 个全收, 还是只 4 个?
B. **v1 ship 哪几个行业 vertical?** 8 全部 (40 个 vertical-specific keycap 是工程量), 还是先 4 个 (bao 列的, 20 个)?
C. **中文圈 vs 国际**: 电商 / 营销 vertical 重中文 (淘宝 / 小红书 / 抖音 / 公众号); 开发 / 设计 / 办公 国际感强。CLAUDE.md memory 说 "global English first", 但 v1 launch 用户大概率是中文圈早期接触者 — 矛盾点需要 bao 拍。
D. **workshop "选行业" 是否第一屏出现**? 还是用户跳过默认通用集合, 在 settings 里改?
E. **平台 scrape (淘宝 / 小红书 / 抖音)** 大量靠 scrape 而非 OAuth (平台不开 API), 工程脆弱 (反爬 / IP 风控) — v1 做不做这种 keycap? 还是只 ship 有 OpenAPI 的平台 (Notion / Linear / Slack / GitHub), scrape 走 v1.1+?

---

## Changelog

| Date | Author | What |
|---|---|---|
| 2026-05-23 | zeus | 初 inventory: 5 source category, ~80 entry, P0/P1/P2 标注. 暴露 G13/G14/G15/G16/G17/G18 6 个新 substrate, 总 gap 列表升至 G1-G18. 中文 MCP 部分大面积 ⚠️ verify pending. 给 bao 8 个 open Q. |
| 2026-05-23 | zeus | §11 添加 — 8 个候选行业 vertical (bao 列 4 + zeus 加 4), 每个行业 5 keycap 建议 + source 关键源 + 行业 × source matrix. v1 launch 策略 = 通用 15 + vertical-specific (workshop 推荐板块). 5 个新 open Q for bao (行业取舍 + 中文/国际 + scrape vs OpenAPI). |
