# Brainstorm — Irisy.assist 第一个功能

> **状态**: brainstorm,待 bao 拍板
> **owner**: bao(决策),claude(草案)
> **日期**: 2026-05-30
> **触发**: bao "全网调研有哪些功能?可对接哪些已有大用户的 app?可以移动 + PC 同步的 app?"
> **不在本 doc 范围**: 主窗 / input 窗 / shell layout(在 `PRODUCT.md` §5);键帽 / 创作(归 Irisy.create,见 PRODUCT.md §8)
> **过期处理**: 决定的项落到 `PRODUCT.md` §8 + ADR,然后本 doc flag 删

---

## 1. 调研结论

### 1.1 2026 personal AI assistant 功能矩阵

| Assistant | 强项 | 集成方式 | 跨设备 |
|---|---|---|---|
| **Pi (Inflection)** | 情绪陪伴, 8 voice, 实时 web search | 自家 app | iOS / Android / Web |
| **ChatGPT** | 通用, 记忆, 工具, 图像, voice | GPTs + Plugins + MCP | 全平台 |
| **Claude Cowork** | 1M context, computer use, code analysis | MCP + Chrome 插件 | macOS + Windows |
| **Gemini** | 多模态 + Google Workspace | Gmail / Drive / Docs / Calendar / Meet | Web + Android |
| **Microsoft Copilot** | Outlook / Teams / Office 原生 | M365 stack | Web + Windows |
| **Lindy AI** | Email 自动化, 调度, workflow | Gmail / Slack / HubSpot / calendar | 主要 web |
| **Manus** | 自主任务执行 + research + coding + browse | Cloud VM | Web |
| **Doubao (ByteDance)** | 自然 voice + 中文最强 | 字节系 | iOS / Android / Web |
| **Kimi (Moonshot)** | 长 context, 多语言 | 自家 | iOS / Android / Web |

### 1.2 共通"功能原子"

| # | 原子能力 | 谁强 |
|---|---|---|
| 1 | chat with memory(对话 + 长期 persona) | Pi / ChatGPT / Vellum |
| 2 | email triage / 自动回信 | Lindy / Copilot / Gmail Gemini |
| 3 | schedule 日历调度(找空 + 自动发邀请) | Lindy / Reclaim / Motion |
| 4 | quick capture → 多端同步(记笔记) | Notion / Evernote / Bear / Things |
| 5 | page-aware(看当前 app / 浏览器,理解上下文) | Cluely / Claude Cowork / Manus / Granola |
| 6 | search across personal data(私人 RAG) | Notion AI / Mem / Reflect / Mymind |
| 7 | task / todo 管理 | Todoist + AI / TickTick + AI / Things |
| 8 | voice 实时陪伴 | Pi / Doubao / ChatGPT voice |
| 9 | 跨 app 转 / 移动数据(Slack 存 Notion) | Zapier / IFTTT / Lindy |
| 10 | research agent(写报告) | Manus / ChatGPT deep research / Perplexity |

---

## 2. 集成生态 — MCP 是事实标准

2026 行业事实: **MCP (Model Context Protocol)** 已成 AI ↔ app 接口标准。Notion / Slack / 飞书 / Stripe / GitHub / Linear 都官方发了 MCP server;Grok / Claude / ChatGPT / Copilot 都已支持 MCP client。Zapier MCP 一接 = 7000+ app。

| 类别 | 已有官方 MCP server 的 app |
|---|---|
| 笔记 / 文档 | Notion · Notion Mail · Linear · Figma · HubSpot · GitHub · Intercom |
| 邮件 | Gmail · Outlook · Notion Mail |
| 日历 | Google Calendar · Outlook · Notion Calendar |
| 协作 IM | Slack(官方) · Linear · Jira |
| 财务 | Stripe · Ramp · Attio |
| 存储 | Google Drive · OneDrive · SharePoint |
| 代码 / 监控 | GitHub · Sentry · Amplitude · Wiz |
| **中文圈** | **飞书**(官方 MCP) · 钉钉 · 企业微信 · 微信(OpenClaw / CowAgent OSS bridge) |

> 影响 CTRL: **不要重写集成,接 MCP 即可**。Irisy 跟一堆 app 通话 = 装他们的 MCP server + OAuth。

---

## 3. 移动 + PC 同步的 app(第一梯队)

bao 关键过滤器: "**移动端和 PC 端同步**"。

| App | 用户量 | 国别 | 跨设备 | API/MCP | 备注 |
|---|---|---|---|---|---|
| **Notion** | 100M+ | 全球 | 全平台 | **官方 MCP** | 笔记 + DB + Custom Agents (21k beta) |
| **Todoist** | 30M+ | 全球 | 全平台 | REST API | task 顶尖, NLI |
| **Evernote / 印象笔记** | 200M+(累计) | 全球 / 中国 | 全平台 | API | 笔记品牌 |
| **OneNote** | M365 全家桶 | 全球 / 中国 | Win/Mac/iOS/Android | Graph API | 中国可用 |
| **滴答清单 (TickTick)** | 中国 + 全球 | 中国出品 | 全平台,中国稳 | Open API | 中国首选 task |
| **飞书** | 1000万 + 海外 | 中国出品 | 全平台 | **官方 MCP** | 协作 + IM + docs + calendar |
| **Slack** | 65M+ DAU | 全球 | 全平台 | **官方 MCP + RTS** | 协作 IM 标准 |
| **Gmail** | 1.8B+ | 全球 | 全平台 | Google API + MCP | 邮件最大 |
| **Google Calendar** | 1B+ | 全球 | 全平台 | Google API + MCP | 日历最大 |
| Things 3 / Bear | 高质量小众 | 全球 | Apple-only | URL scheme | 筛除(覆盖窄) |

---

## 4. Irisy.assist 第一个功能 — 3 个候选

### 候选 A: 统一收件箱 / 通知聚合 (Lindy / Notion AI 路线)

**做什么**: 接 Gmail + Outlook + Slack + 飞书 + 微信 → 一处 triage 一处回。

**为什么**: 每天 4-5 个 IM/邮件切换是高频痛点。

**技术**: MCP × 5(Gmail / Outlook / Slack / 飞书 / 微信桥)。

**第一版**: Gmail + 飞书(海外 + 中国)。

**疑虑**: 工程重(5 个 OAuth flow + token 续期 + push);跟 Notion AI / Lindy / Grok 正面竞争;privacy 暴露面大(读所有邮件)。

### 候选 B: 快记 → 多终端同步 (Mem / Reflect 路线) ⭐

**做什么**: 按 Ctrl,说一句话(打字 / 语音), Irisy 写到用户**已用的** Notion / 滴答 / 飞书 docs / OneNote。手机上立刻看到。

**为什么**:
- 高频(每天 5-20 次快记)
- 跨设备闭环最明显(PC 说 → 手机看)
- 入门最低(1 个 API 就 ship)
- 不依赖屏幕监听 → privacy 风险低
- **跟 bao 原话"能用用户自己的 app 就用"对最齐**
- 跟 CTRL vault 哲学一致 —— 先写本地, 再 sync 到云

**技术**:
- Phase 0: 写本地 vault(markdown),Obsidian / VMark 已能手机端读(Obsidian Sync / iCloud)
- Phase 1: Notion MCP(OAuth → 选 page → append)
- Phase 2: 飞书 docs + 滴答清单 + OneNote(用户配)

**第一版(2 周内可 ship)**: Irisy 收到"记一下: xxx" → 写本地 vault → 用户自己装的 Obsidian Sync / iCloud 同步到手机。**先不接云 API**, 只写本地 markdown。

**疑虑**: 用户要先装 sync 工具。但这跟"对接用户已有 app"恰好契合 —— 我们不做 sync, 让用户的 sync 工具做。

### 候选 C: 当下窗口理解 + 行动 (Cluely / Claude Cowork 路线)

**做什么**: Irisy 看用户当前 app(Chrome / Notes / Excel),抓上下文,推荐 / 跨 app 转写。

**为什么**: companion 杀手锏。Chrome 看英文 → Ctrl → Irisy 自动 "translate / summarize / save to Notion"。

**技术**: macOS Accessibility API 读当前 app + 内容;或 Screenshot + vision LLM;Tauri 端新 Rust 子系统。

**疑虑**:
- 工程重(AX / screen recording 权限申请 + 授权 UI)
- privacy 暴露面巨大
- 跟 Cluely 直接竞争(他们 A 轮)
- 入门高,不适合"第一个"

### 推荐 = B

理由(ROI 排):
1. **入门成本最低** — Phase 0 不接外部 API,只写本地
2. **立刻体现 companion 跨端价值** — bao 原话最直接命中
3. **跟 CTRL 哲学一致** — 本地是 truth, 云是 mirror(PRODUCT.md §3, `decision_ctrl_obsidian_philosophy`)
4. **不抢用户的 app** — 用户自己装 Obsidian Sync, 我们不重写
5. **privacy 最小暴露** — 不监听屏幕, 不读邮件, 只接用户主动说的话
6. **后续可叠 A / C** — B 是 substrate

---

## 5. 选 B 的话,第一版 spec 草案

### 5.1 用户场景

> 设计师在 Sketch 改图,突然想到"明天要问 X 颜色规范在哪个文件"。按 Ctrl → 在 Irisy 说"记一下: 问 X 颜色规范文件" → Enter → companion 收起。**手机上的 Obsidian 同一秒就能看到**(因为他装了 Obsidian Sync)。

### 5.2 输入路径(都触发"快记")

- Irisy 文本框说"记一下 / remember: xxx"
- Irisy 文本框按 Tab → 切到"note mode" → 输入直接记,不走 LLM
- 拖文件 / 选文本到 Irisy → 自动记 + 加引用

### 5.3 输出路径

- **默认**: 本地 `~/.ctrl/vault/inbox/<yyyy-mm-dd>.md`(append timestamp + 内容)
- **可选(用户配)**: append 到 Notion page / 飞书 docs / OneNote section
- **永远本地优先** — 即使云不可达,本地一定成功(`decision_ctrl_obsidian_philosophy`)

### 5.4 同步路径(谁负责)

- **不由 CTRL 同步**, 由用户工具:
  - Obsidian Sync(vault root 改到 `~/Obsidian/MyVault`)
  - iCloud Drive(同上)
  - Dropbox
  - git
- **CTRL 只写文件, sync 是用户的事**

### 5.5 手机端读

- Obsidian iOS app(免费)打开同一个 vault → inbox/<日期>.md 立刻看到
- 飞书 / Notion mobile app(如果用户选了云同步) → 自己 sync
- **不做 CTRL iOS app**, 不重造 sync

### 5.6 不在本期范围

- 智能分类 → v1.1
- 全文搜索 UI → v1.1(SQLite FTS5 已有)
- 提醒 / due date / task → 滴答 / Todoist 的活, 不做

### 5.7 验收

- 用户说"记一下 X" → 1 秒内本地 vault 有新行
- 配了 Obsidian Sync → 5 秒内手机看到
- 关网 → 仍成功写本地
- ctrl.log 有 `irisy_note_capture` 事件 + path

### 5.8 工程量(列工作, 不估天数)

- Irisy text 输入流加 `intent: note` 旁路(不进 LLM, 走 capture)
- 新 Tauri command `note_capture(text, source)` → 写本地 vault
- vault path 用户可配(现有 vault root API)
- Irisy chat 给轻 ack("✓ saved to inbox/2026-05-30.md")
- `doc/setup-obsidian-sync.md` 引导用户装手机端

---

## 6. 给 bao 的决策清单

| 决策点 | 选项 | 倾向 |
|---|---|---|
| **第一个功能选哪个** | A 收件箱 / **B 快记同步** / C 屏幕理解 / 别的 | B |
| **B 的 Phase 0 同步路径** | 只本地 vault(用户配 sync) / 直接接 Notion MCP(我们做 OAuth) | 只本地 vault |
| **触发 note mode 的方式** | 关键词("记一下") / 快捷键 Tab / button / 都要 | 关键词 + Tab |
| **手机读法 doc 挂哪** | `doc/setup-obsidian-sync.md` / `PRODUCT.md §14` / 都要 | 都要(setup 详细, PRODUCT 一行引) |
| **B 决定后是否要 ADR** | 要(写"Irisy.assist 第一个功能 = 快记到本地 vault") / 不要 | 要(战略级) |

---

## 7. 调研 sources

- [Best Personal AI Assistants 2026 — Vellum](https://www.vellum.ai/blog/best-personal-ai-assistants-2026)
- [AI Assistants with MCP Support 2026 — Dume.ai](https://www.dume.ai/blog/best-ai-assistants-with-mcp-support-in-2026-connect-your-tools-automate-everything)
- [Notion 2026 Custom Agents — Y Build](https://ybuild.ai/en/blog/notion-custom-agents-autonomous-ai-teammates-2026)
- [Cross-Platform Productivity 2026 — Cloudwards](https://www.cloudwards.net/best-productivity-apps/)
- [Pi AI 2026 Review — Sider](https://sider.ai/blog/ai-tools/is-inflection-ai-s-pi-the-most-human-ai-assistant-an-in-depth-review)
- [飞书 MCP 平台 — Feishu Open Platform](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_introduction?lang=zh-CN)
- [Slack agentic platform](https://slack.com/blog/news/powering-agentic-collaboration)
- [Grok Connectors 2026](https://beginnersinai.org/grok-connectors-launch-2026/)
- [Best AI personal assistant apps — Zapier 2026](https://zapier.com/blog/ai-personal-assistant/)
- [OpenClaw / CowAgent 中文圈接入](https://developer.aliyun.com/article/1712095)

---

## 8. 变更记录

| 日期 | 改了什么 |
|---|---|
| 2026-05-30 | 初稿 — 调研 + 3 候选 + 推荐 B + 决策清单 |
