# User intents inventory — 真实场景清单 (2026-06-04)

**Date**: 2026-06-04
**Trigger**: bao "整理两个文档, Irisy 的能力清单和用户 Intents 清单, 细化到每个功能"
**Scope**: 用户视角想干的事 (自然语言驱动). 每条标当前 v1 状态 + 用到 Irisy 哪些 capability (引 [[irisy-capabilities-2026-06-04]] 编号).

---

## 0 9 大类 intent (按用户认知顺)

```
A 写 (Write)        ──┐
B 找 (Find)         ──┤  日常高频 (每天用)
C 用 (Use)          ──┘
D 创 (Create)       ──┐
E 装 (Install)      ──┤  工具相关 (按需用)
F 评 (Evaluate)     ──┘
G 操 (Operate)      ──┐  系统层 (偶尔)
H 协 (Collaborate)  ──┘
I 反 (Reflect)      ──   元层 (定期)
```

每个 class 细到 5-10 个具体 intent. 总 ~60 个 intent.

---

## A — 写 (Write) — 9 项

| # | 用户原话样例 | Irisy 应该 | 用 cap | 状态 |
|---|---|---|---|---|
| A1 | "记一下: 今天开会要讨论 X" | 写 daily note → vault | A1 + B1 | ✅ |
| A2 | "把这段写成正式邮件" | text.chat 改写 | A3 | ✅ |
| A3 | "总结这篇 PDF" | file.read + text.chat | A4 + C4 | ✅ (Pi 本职) |
| A4 | "把这段翻译到日语" | text.chat translate | A3 | ✅ |
| A5 | "写个 Python 脚本: 读 csv → 画饼图" | Pi 写代码 + file.write | A5 + C5 | ✅ (Pi 本职) |
| A6 | "改简洁这段" | text.chat 改写 | A3 | ✅ |
| A7 | "写一篇关于 X 的文章" | text.chat 长文 | A3 | ✅ |
| A8 | "做 5 页关于 X 的 HTML slide" | Pi 生成 HTML → vault/artifacts/ | A5 + B1 | 🟡 缺 PWA HTML viewer 渲染 |
| A9 | "记一句话, 自动标签" | vault.write + frontmatter tag 推理 | A1 + B1 | 🟡 prompt 没指导 Pi 自动标 tag |

---

## B — 找 (Find) — 9 项

| # | 用户原话样例 | Irisy 应该 | 用 cap | 状态 |
|---|---|---|---|---|
| B1 | "我之前记过 React Hooks 的笔记" | vault.search FTS5 → 5 个结果 | B4 | ✅ |
| B2 | "tag=meeting 的所有笔记" | vault.notes_by_tag | B11 | ✅ |
| B3 | "X 笔记在哪儿被引用" | vault.backlinks | B9 | ✅ |
| B4 | "我有哪些 tag" | vault.tags | B10 | ✅ |
| B5 | "我有多少笔记没人引用" | vault.orphans | B13 | ✅ |
| B6 | "我的笔记关系图" | vault.graph_data + PWA 渲染 | B15 | ✅ |
| B7 | "查 X 最新进展 (网上)" | network.http + 网页解析 | C6 | 🟡 Pi 默认不调 network |
| B8 | "在我装的 Notion 里搜 X" | 已装 notion-mcp 调用 | D2 | ❌ 缺 notion-mcp install path |
| B9 | "上周我跟 Irisy 聊了什么" | 历史 chat 查询 | (待建) | ❌ 缺 chat history 持久化 |

---

## C — 用 (Use) — 11 项

| # | 用户原话样例 | Irisy 应该 | 用 cap | 状态 |
|---|---|---|---|---|
| C1 | "翻译这段到日语" | text.chat | A3 | ✅ |
| C2 | "总结这个 URL" | network.http + text.chat | C6 + A4 | 🟡 Pi 没主动 fetch URL |
| C3 | "我今天 GitHub 有什么 PR 待 review" | 已装 github-mcp 调 | D2 | ❌ 缺 install |
| C4 | "今天有什么会" | 已装 gcal-mcp 调 | D2 | ❌ 缺 install |
| C5 | "今天有什么重要邮件" | 已装 gmail-mcp 调 | D2 | ❌ 缺 install |
| C6 | "截屏存到 vault" | screen.capture → vault.write_image | C3 + B6 | 🟡 Pi 没 prompt |
| C7 | "总结剪贴板里的内容" | clipboard.read + text.chat + vault.write | C1 + A4 + B1 | 🟡 Pi 没 prompt |
| C8 | "用 frontend-slides skill 做 X 演示" | 调 ECC plugin SKILL.md | A14 | ❌ Pi 不 auto-discover SKILL.md |
| C9 | "审一下 ~/code/X.py 的 bug" | Pi 读 + 改 + 验证 | A5 + A6 + A7 + A8 | ✅ Pi 本职 |
| C10 | "跑一下 npm test" | bash subprocess | A8 | ✅ Pi 本职 |
| C11 | "用 OCR 这张图" | 装 ocr 工具 / 调多模态 brain | (待建) | ❌ 缺 image.understand cap |

---

## D — 创 (Create) — 7 项

| # | 用户原话样例 | Irisy 应该 | 用 cap | 状态 |
|---|---|---|---|---|
| D1 | "做个对接公司 Confluence 的 MCP" | 读 spec → Pi 写 ts → 测 → 装 | A5 + B1 + D1 | ❌ 缺 vault/.ctrl/specs/ + Pi prompt |
| D2 | "教 Irisy 怎么审 PR (SKILL.md)" | 读 spec → 写 vault/skills/.../SKILL.md | A5 + B1 | ❌ 缺 spec + symlink |
| D3 | "把 OpenAPI 文档转 MCP" | swagger-mcp wrap → 装 | A5 + D1 | ❌ 缺 wrap 工具 + prompt |
| D4 | "拼一个 daily-standup 微型系统" | composition canvas | (待建) | ❌ P0-4 缺 |
| D5 | "做个简单 CRM 系统" | aggregator 推 + 装 + 拼 | F1-F12 全套 | ❌ 全套缺 |
| D6 | "拼一个 'GitHub 搜 → 翻译 → 邮件' 工作流" | canvas | (待建) | ❌ P0-4 缺 |
| D7 | "做一个 reading list workspace" | canvas + 复用现有 vault | (待建) | ❌ P0-4 缺 |

---

## E — 装 (Install) — 8 项

| # | 用户原话样例 | Irisy 应该 | 用 cap | 状态 |
|---|---|---|---|---|
| E1 | "装 Claude Code" | brew install claude-code | D1 (待建) | ❌ 缺 installer/app.rs |
| E2 | "装 cc-switch" | brew install --cask cc-switch | D1 (待建) | ❌ 同上 |
| E3 | "装 github-mcp" | mcp_host spawn / npx 装 | D1 (待建) | ❌ 缺 installer/mcp.rs |
| E4 | "装 obra/superpowers skill" | git clone → vault/skills/ → symlink | D1 (待建) | ❌ 缺 installer/skill.rs |
| E5 | "装 Gmail API 接入" | OAuth + OpenAPI → MCP wrap | D1 (待建) | ❌ 缺 installer/api.rs |
| E6 | "升级我所有 MCP" | installer.update_all | D1 (待建) | ❌ 缺 |
| E7 | "卸 X" | installer.uninstall | D1 (待建) | ❌ 缺 |
| E8 | "我装了什么" | inventory 查询 | E2 | 🟡 现有 provider list, 没 MCP/skill/app 全栈 inventory |

---

## F — 评 (Evaluate / 决策) — 6 项

| # | 用户原话样例 | Irisy 应该 | 用 cap | 状态 |
|---|---|---|---|---|
| F1 | "找个 GitHub PR 总结工具" | aggregator 搜 + 推 5 个 | F1 (待建) | ❌ 缺 aggregator |
| F2 | "X MCP 安全吗" | trust score 静态分 (mpak/ToolBench) | F2 (待建) | ❌ 缺 trust 接入 |
| F3 | "X MCP 跟 Y MCP 哪个好" | rating + 评测对比 | (网页+缓存) | ❌ 网页没建 |
| F4 | "X MCP 上个月活跃吗" | GitHub maintain 时间 | sync | ❌ aggregator 没接 |
| F5 | "推几个翻译类工具给我" | Irisy 推 + cache | (推荐引擎) | ❌ ranking 没建, 走简单 GitHub star 排序也可 v1 |
| F6 | "X 工具能做啥" | 显示 demo (input → output) | manifest.demo | ❌ manifest schema 没强制 demo |

---

## G — 操 (Operate / 系统) — 8 项

| # | 用户原话样例 | Irisy 应该 | 用 cap | 状态 |
|---|---|---|---|---|
| G1 | "你现在用什么 brain" | brain_status | E1 | ✅ |
| G2 | "切到 Volc 我自己的账号 (BYOK)" | provider_set_active | E3 | ✅ |
| G3 | "我有 OpenAI key, 怎么填" | 引导用户走 Settings → BYOK | (Settings UI) | ✅ (PWA Settings 有) |
| G4 | "我装了多少 MCP" | inventory | (待建全栈) | 🟡 现有 provider list, 没 MCP/skill/app inventory |
| G5 | "拔网还能用吗" | 离线模式: vault 全可用, Pi 走本地 Ollama | (Ollama path) | 🟡 Ollama provider 在, 但用户没默认配 |
| G6 | "上次 Claude 挂多久了" | failover_record | E4 | ✅ (2026-06-04 ship) |
| G7 | "把全局 hotkey 改成 Ctrl+Space" | 改 settings | (Settings) | ✅ |
| G8 | "禁用 X cap" | cap registry disable | (待建) | ❌ 没 cap registry |

---

## H — 协 (Collaborate / 跨设备) — 5 项 (推 v1.1+)

| # | 用户原话样例 | Irisy 应该 | 用 cap | 状态 |
|---|---|---|---|---|
| H1 | "在手机上看我电脑 vault" | mesh sync + 手机 PWA | F15+ | ❌ v1.1+ |
| H2 | "把这个 cap 分享给同事" | 本地导出 → 文件给 | (vault/exports/) | 🟡 简单做法 (用户手动 copy folder) |
| H3 | "跟同事一起改一个 cap" | CRDT sync | F15+ | ❌ v1.1+ |
| H4 | "团队共享 vault" | 团队 sync + 角色 | F18+ | ❌ Enterprise (v1.1+) |
| H5 | "把这个工作流给 Claude Code 用" | export 成 SKILL.md (兼容协议) | F4 + 导出 | 🟡 装 skill 通了反过来也能用 |

---

## I — 反 (Reflect / 元层) — 5 项

| # | 用户原话样例 | Irisy 应该 | 用 cap | 状态 |
|---|---|---|---|---|
| I1 | "我上周用 Irisy 最多干啥" | 历史 chat 分析 | (chat history) | ❌ 缺 chat history 持久化 |
| I2 | "本月 token 用了多少 / 花了多少钱" | usage tracker | (待建) | ❌ 缺 telemetry / billing 集成 |
| I3 | "为什么刚才 X 失败" | error explain | A6 + log read | 🟡 Pi 能, 但用户要给错信息上文 |
| I4 | "Irisy 不会 X, 怎么教它" | 引导写 SKILL.md / cap | D2 + 引导 | ❌ 缺 |
| I5 | "怎么用 Y MCP" | 读 manifest description + 示例 | F6 + 引导 | ❌ 缺 manifest demo + Irisy prompt |

---

## 总览 — 60 个 intent 状态分布

| Class | ✅ ready | 🟡 部分 | ❌ 待建 | 合计 |
|---|---|---|---|---|
| A 写 | 6 | 2 | 1 | 9 |
| B 找 | 6 | 1 | 2 | 9 |
| C 用 | 3 | 3 | 5 | 11 |
| D 创 | 0 | 0 | 7 | 7 |
| E 装 | 0 | 1 | 7 | 8 |
| F 评 | 0 | 0 | 6 | 6 |
| G 操 | 4 | 2 | 2 | 8 |
| H 协 | 0 | 2 | 3 | 5 |
| I 反 | 0 | 1 | 4 | 5 |
| **合计** | **19** | **12** | **37** | **68** |

→ **真实 ready = 19/68 = 28%**, 部分 (需 prompt 调) 12/68 = 18%, 待建 37/68 = **54%**.

---

## 关键洞察

### 1. **A + B + G 现在已经能 work** (19 + 12 ≈ 31 项 70% 可用)
→ Vault 笔记 + 系统操作 + 基础对话, 这是 v1 "能立刻 sell" 的 Irisy demo 范围。

### 2. **C 类 (用) 大部分卡在 Pi prompt** (5/11 是 prompt 问题)
→ kernel 28 tool 物理上都在, Pi 不知道用. 改 system prompt 一次性把 11 项里的 8-9 项拉到 ✅ — **最低成本最高回报**, 这是 P-1 的真正含义。

### 3. **D + E + F (54% intent 待建) 是 v1 critical path**
→ 装 + 创 + 评 = CTRL 的"杀手价值"; 不做这 3 类, Irisy 只是个 Cursor + Obsidian 的合体, 跟 OpenClaw / Cline 比无差异化。

### 4. **H 跨设备 + I 反思 推 v1.1+**
→ 复杂依赖 mesh / telemetry / billing, 不影响 v1 ship。

---

## 引申 — v1 critical path 重排 (按 user intent ROI)

| 优先 | 主题 | 解决的 intent | 估时 |
|---|---|---|---|
| **P-1** | Pi prompt 注入 28 tool 描述 | C1-C7 大量从 🟡 → ✅ (≈ 7 项) | 2-3 day |
| **F1-F7** | 集成 + 装 (4 sub-installer + aggregator + deep link) | E1-E7 全套 + F1-F6 一半 (≈ 13 项) | 4-6 周 |
| **F8-F11** | 创建 (vault/.ctrl/specs/ + Pi prompt 校准) | D1-D3 (≈ 3 项) | 1-2 周 |
| **F12-F13** | 组合 canvas | D4-D7 (≈ 4 项) | 3-4 周 |

**12-15 周后 v1 ready** = 68 intent 里至少 60+ ✅ ≈ **90% 用户感知就绪**。

---

**相关 doc**:
- Irisy capability inventory → [[irisy-capabilities-2026-06-04]]
- 战略定位 → `aggregator-positioning-2026-06-03.md`
- v1 架构 lock → memory `decision_ctrl_v1_architecture_lockdown`
- 商业模型 → `oss-business-model-2026-06-02.md`
