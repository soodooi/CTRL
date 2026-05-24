# 00 · Keycap inventory + Irisy 集成校验 + 前端/底座抽象 ask

- **Owner**: Hephaestus (keycap ecosystem)
- **Date**: 2026-05-22
- **Branch**: `keycap-dev`
- **Audience**: bao (拍板) / daedalus (前端 ask) / zeus (底座 ask) / Athena (Irisy 集成校准)
- **Replaces** (lost prior work): `00-adr-010-inputs-from-hephaestus.md` / `02-pattern-{A..G}-*.md` / `05-manifest-schema-v0.2.md`
- **Reads from**:
  - `.olym/decisions/010-keycap-execution-model.md` (accepted)
  - `doc/keycap-integration-research/06-jiazuo-result.md` (spike done)
  - `doc/keycap-ideas-record.md` (46 意向 v3 pattern 已分桶)
  - `doc/keycap-roadmap.md` (v1.0 = 8 / v1.1 候选)
  - `.olym/personas/irisy/keycap-creator.md` (Irisy 创作助手 system prompt)
  - `packages/ctrl-keycap-sdk/src/manifest-schema.ts` (untracked，对齐 ADR-010 + spike 06，建议作为新 SSOT)

---

## 0. TL;DR

1. **清单 71 行已齐**：16 G builtin shipped + 9 v1 top-15 待开 + 46 意向 (含 11 不适配/待澄清) — 全部按 ADR-010 7 pattern 分桶 + 按 spike 06 capability frequency 分级。
2. **Irisy keycap-creator persona 能生成 manifest，但 4 份 schema 漂移**（v0.1 spec / manifest-schema.ts / irisy-keycap-zod.ts / 16 builtin 实际 shape）—— 不统一前，"一条 NL → 一份 manifest → 跑通" 链路在每个 pattern 上都断在不同地方。
3. **底座 `run_keycap` 现状 = 4 条硬编码 match arm + Stub fallthrough** —— 这就是 bao "一个 keycap 新增一条管线" 的现状根因。
4. **前端无 workspace UI dispatch registry** —— 任何 keycap 想要非默认 render（output != notification/clipboard/modal/silent）必须改前端代码。
5. **给 daedalus 5 条前端 ask + 给 zeus 4 条底座 ask + 1 条 schema 统一 ask**（§5 / §6 / §7）。这 10 条做完，46 条意向中**约 60 条零代码上货**（Irisy 直出 manifest → 装入即用）。

---

## 1. Master inventory

> **行级数据源**：spike 06 §Q1.1（已 23 keycap × 100 (keycap, capability) row）+ keycap-ideas-record.md（46 意向，已打 pattern 标签）+ share/modules/builtin/（16 shipped 实证）。本表 = 这三份合并去重后视图。
>
> **列定义**：
> - `Pattern` = ADR-010 A-G（A notes / B CLI / C daemon / D 3p-MCP / E OAuth / F STSS / G builtin）
> - `Kernel ns` = spike 06 §Q2.13 八 v1 namespace (clipboard / text / network / keyring / screen / file / mcp / platform) + v1.1 候选括号标
> - `Workspace UI` = manifest 期望 frontend dispatch 类型 (notification / modal / chat-stream / html-output / picker / form / canvas / none / clipboard)
> - `Irisy?` = keycap-creator persona 当前形态能否仅由 NL slot 生成（✅ / ⚠️ 需补 slot / ❌ 阻塞）
> - `Status` = shipped / unshipped-v1 / v1.1 / 不适配 / 待澄清

### 1.1 G builtin 已 shipped (16)

| # | id | Pattern | Kernel ns | Workspace UI | Irisy? | Status |
|---|---|---|---|---|---|---|
| 1 | ctrl.builtin.ai-summarize | G | clipboard.read · text.chat · platform.notify | modal | ✅ | shipped |
| 2 | ctrl.builtin.baidu-search | G | clipboard.read · network.open_url | none | ✅ | shipped |
| 3 | ctrl.builtin.base64-decode | G | clipboard.read · clipboard.write · text.transform | clipboard | ✅ | shipped |
| 4 | ctrl.builtin.base64-encode | G | clipboard.read · clipboard.write · text.transform | clipboard | ✅ | shipped |
| 5 | ctrl.builtin.github-search | G | clipboard.read · network.open_url | none | ✅ | shipped |
| 6 | ctrl.builtin.google-search | G | clipboard.read · network.open_url | none | ✅ | shipped |
| 7 | ctrl.builtin.json-pretty | G | clipboard.read · clipboard.write · text.transform | clipboard | ✅ | shipped |
| 8 | ctrl.builtin.lowercase | G | clipboard.read · clipboard.write · text.transform | clipboard | ✅ | shipped |
| 9 | ctrl.builtin.markdown-codeblock | G | clipboard.read · clipboard.write · text.transform(template) | clipboard | ✅ | shipped |
| 10 | ctrl.builtin.markdown-heading | G | clipboard.read · clipboard.write · text.transform(template) | clipboard | ✅ | shipped |
| 11 | ctrl.builtin.markdown-quote | G | clipboard.read · clipboard.write · text.transform(template) | clipboard | ✅ | shipped |
| 12 | ctrl.builtin.uppercase | G | clipboard.read · clipboard.write · text.transform | clipboard | ✅ | shipped |
| 13 | ctrl.builtin.url-decode | G | clipboard.read · clipboard.write · text.transform | clipboard | ✅ | shipped |
| 14 | ctrl.builtin.url-encode | G | clipboard.read · clipboard.write · text.transform | clipboard | ✅ | shipped |
| 15 | ctrl.builtin.word-count | G | clipboard.read · text.transform · platform.notify | notification | ✅ | shipped |
| 16 | ctrl.builtin.zhihu-search | G | clipboard.read · network.open_url | none | ✅ | shipped |

**观察**：16 个 builtin 实际只用 4 个 namespace（clipboard / text.transform / network.open_url / platform.notify）。可 100% 落在 spike 06 v1 surface 内。但**当前 manifest 缺 `variant: "builtin"` 字段 + 缺 `capabilities: {...}` 对象** —— 见 §7 schema 统一 ask。

### 1.2 v1 top-15 待开 (9，roadmap §v1.0 + §v1.1)

| # | name | Pattern | Kernel ns | Workspace UI | Irisy? | Status |
|---|---|---|---|---|---|---|
| 17 | Clipboard AI 改写 | G | clipboard.read · clipboard.write · text.chat | clipboard | ✅ | unshipped P0 |
| 18 | AI OCR | G + keycap-local | screen.capture · file.read · clipboard.write + (image.ocr v1.1) | modal | ⚠️ slot 表达 source=screen vs file | unshipped P0 |
| 19 | AI 翻译 | G | clipboard.read · text.chat · clipboard.write | clipboard | ✅ | unshipped P0 |
| 20 | AI 文本处理 | G | clipboard.read · text.chat · clipboard.write | clipboard | ✅ | unshipped P0 |
| 21 | Ctrl Chat | G (但实为 Irisy 入口) | text.chat | chat-stream | ❌ Irisy 自身不应作为 keycap 生成 | unshipped P0 (重叠 Irisy) |
| 22 | AI Snippet / 文本扩展 | G + keycap-local | clipboard.read · clipboard.write · text.chat + (persistence.kv keycap-local) | picker | ⚠️ slot 表达 snippet 库管理 | unshipped v1.0 |
| 23 | 代码片段 + AI 解释 | G | clipboard.read · text.chat · clipboard.write | modal | ✅ | unshipped v1.0 |
| 24 | 邮件 / 客户回复 AI 草稿 | G + (E v1.1) | clipboard.read · text.chat · network.http (SMTP/Gmail) | form | ⚠️ 走 v1 = 仅 LLM 起稿无 OAuth 出件 | unshipped v1.0 |
| 25 | 跨设备同步 | — (mesh primitive) | mesh ADR-003 收编 | none | — | 不做 keycap（spike 06 已结论：mesh primitive 不该是 keycap） |

**观察**：8 条 v1 top-15 中 6 条纯 G builtin 形态（Clipboard AI / 翻译 / 文本处理 / 代码 / Snippet text 部分 / 邮件 v1 起稿）—— 全部落在 v1 namespace。OCR + 邮件出件需 v1.1 promote。Chat 重叠 Irisy 应砍。同步走 mesh 不走 keycap。

### 1.3 v1.1+ 意向 (46，详 keycap-ideas-record §1.18 + §24-46)

汇总（每 pattern 一段，明细见 keycap-ideas-record 同号）：

#### Pattern A (HTTP API sink) — 15 条，最大桶
2 文本翻译 / 3 AI 改写 / 6 搜索聚合 / 11 AI 对话 (砍, 重叠 Irisy) / 17 Follow Builders / 18 Supadata / 20 Frontend Slides / 21 OpenAI Realtime / **31 Memos ★** / 32 Note Mark / 35 quick-input / 36 Obsidian Clipper / 40 transfer.sh / 46 Dify ★

- **Kernel ns**: 全部 `network.http` (allowlist 强制) + 部分 `keyring.read` (API key) + 部分 `text.chat` (内置 LLM 调用)
- **Workspace UI**: 多为 modal (响应) / notification (sink 完成) / form (配置时)
- **Irisy?**: ✅ 简单 sink (Memos / transfer.sh / Notion) / ⚠️ 复杂 fan-in (搜索聚合, 需多 endpoint slot) / ⚠️ long-lived (OpenAI Realtime, WS/WebRTC)

#### Pattern B (CLI wrapper) — 7 条
10 网页抓取 (scrapling) / 12 文件处理 / 22 飞书 CLI (larksuite/cli) / 24 HyperFrames (待 license) / **39 BetterDisplay ★** / 41 GitHub 加速 / 44 cc-switch (P0)

- **Kernel ns**: 需要 v1.1 `process.spawn` + `process.kill` + `process.stdin`；v1 走不通（除非作为 keycap-local 包装但失去 capability gate）
- **Workspace UI**: html-output (输出 parse) / form (参数填写)
- **Irisy?**: ⚠️ slot 表达 `process.spawn args + allowlist + version_command` 当前 persona 没显式 cover

#### Pattern C (Daemon controller) — 2 条
13 OpenTeams / **38 Motrix / Aria2 ★**

- **Kernel ns**: 需要 v1.1 `network.local_rpc` (127.0.0.1:port + JSON-RPC) + `keyring.read` (rpc_secret)
- **Workspace UI**: html-output (任务列表 / 进度)
- **Irisy?**: ⚠️ slot 表达 "local daemon port + health probe" 当前 persona 缺

#### Pattern D (3rd-party MCP) — 2 条 ★ 生态势能最大
**1 bazi-mcp ★** / 14 GBrain

- **Kernel ns**: v1 `mcp.spawn` + `mcp.list_tools` + `mcp.invoke_tool` （已落 stub, run_keycap 已支持）
- **Workspace UI**: html-output (MCP tool 返回 content array)
- **Irisy?**: ✅ persona 已 cover (source.type = mcp + server + tools)
- **观察**：一旦 `MCPServerActor` 完整落地 + sandbox profile derivation，Anthropic 10K+ MCP servers 全部可即插即用 —— 这是 ADR-010 的生态杠杆

#### Pattern E (OAuth 大平台) — 3 条
**7 飞书 ★** / 8 Coze / 19 X/Twitter API

- **Kernel ns**: 需要 v1.1 `oauth.broker.{start_flow, refresh, revoke}` + v1 `network.http` (allowlist=vendor host) + `keyring.{read,write}` (token rotation)
- **Workspace UI**: form (首次授权) + modal (响应)
- **Irisy?**: ✅ persona 已 cover (source.type = oauth + vendor); 但 oauth flow loopback callback 走不通 v1（v1 没 broker）
- **观察**：bao 已锁"端侧化优先 — OAuth loopback 不走 cloud proxy"（CLAUDE.md Design Philosophy #2）。oauth.broker 必须在 kernel 落地 loopback HTTP listener。

#### Pattern F (3rd-party STSS publisher) — 1 条
**VSCode coding context publisher ★**

- **Kernel ns**: 需要 v1.1 `stss.publish` + `stss.subscribe` + `mcp.notifications` (server-initiated bridge)
- **Workspace UI**: chat-stream / html-output (Irisy 端 ingest 后渲染)
- **Irisy?**: ❌ persona 当前完全没 cover ST-SS bridge slot 表达
- **观察**：spike 06 §Q2.11 + ADR-010 §8 已 reserve；ST-SS↔MCP bridge protocol 由 zeus 后续在 `.olym/specs/stss-protocol/mcp-bridge.md` 出 spec

#### Pattern G 扩展 (除 16 shipped 外的声明式 step keycap)
4 Markdown 工具集（细分多个 keycap，已在 16 shipped） / 5 剪贴板增强（部分 G 部分 A） / 43 garden-skills (新 pattern H "Claude Skill Launcher" 候选, v1.1 修订 ADR-010 决定)

#### 不适配 / 参考 / 待澄清 (11)
15 PokoClaw (与 Irisy 冲突) / 16 Excalicord (不明) / 25 nexu-io/open-design (参考价值大于集成) / 26 cc-telegram-bridge (与 "PWA only" 决策冲突) / 27 midaz (金融账本不重合) / 28 moxt (量化不重合) / 29 royfhs (未找到) / 30 confldence (未找到) / 33 printnotes (太重) / 34 dumbnote (太薄) / 37 Input Leap (与 mesh 边界待 zeus 决) / 42 Intent (未找到)

### 1.4 统计

| 桶 | 条数 | v1 namespace 覆盖 | v1.1 promote 需要 | 立即 ship 可能性 |
|---|---|---|---|---|
| G shipped | 16 | 100% | — | 已 shipped (但需 schema migrate) |
| v1 top-15 未开 | 8 | 6 条 100% / OCR 80% / 邮件出件需 oauth | image.ocr + oauth.broker | 6 条 high / 2 条 v1.1 |
| Pattern A (sink) | 15 | 100% (其中 1 条 Realtime 边缘) | — | high — 是最大批量上货桶 |
| Pattern B (CLI) | 7 | 0% | process.* | 全部 v1.1 |
| Pattern C (daemon) | 2 | 0% | network.local_rpc | 全部 v1.1 |
| Pattern D (3p-MCP) | 2 | 100% (mcp.* 已落 stub) | — | ★ 生态势能最大，优先 |
| Pattern E (OAuth) | 3 | 0% | oauth.broker | 全部 v1.1 |
| Pattern F (STSS) | 1 | 0% | stss.* + mcp.notifications | v1.1 |
| 不适配 / 待澄清 | 11 | — | — | 不做 |
| **合计 v1 可立刻 ship** | **40** (16 + 6 v1 top + 15 A + 2 D + 1 markdown 扩展) | — | — | **57% (40/71)**，前提是 §5-7 ask 落地 |

---

## 2. Irisy 集成跑通校验

> **方法**：从 7 个 pattern 各拉 1 条代表性 keycap，模拟 NL → Irisy keycap-creator slot fill → manifest → kernel run_keycap → workspace render 全链。每条标 ✅ 通 / ⚠️ 阻塞点 / ❌ 当前不可达。
>
> **Irisy keycap-creator persona 现状**（`.olym/personas/irisy/keycap-creator.md`）：通过 NL 对话发 `<keycap-slot field="X">value</keycap-slot>` token，PWA 端解析填 manifest，最后 `<emit-manifest/>` 输出完整 manifest JSON + server.ts。**source.type 自动推断**，用户从不见 CTRL jargon。

### 2.1 Pattern G — markdown-quote (reference impl)

- **NL trigger**: 用户："我想要一个把剪贴板内容包成 markdown 引用块的工具，按 Ctrl+Shift+Q 触发"
- **Irisy slot fill**:
  - `<keycap-slot field="name">Markdown 引用</keycap-slot>`
  - `<keycap-slot field="id">markdown-quote</keycap-slot>`
  - `<keycap-slot field="icon">Quote</keycap-slot>`
  - `<keycap-slot field="keycap_color">platinum</keycap-slot>` (utility/converter)
  - `<keycap-slot field="triggers">[{"kind":"hotkey","combo":"Ctrl+Shift+Q"}]</keycap-slot>`
  - source.type 推断 = builtin（提到 clipboard + format → builtin）
  - actions[0].steps = capture-clipboard → template → write-clipboard → notify
- **Kernel dispatch**: 应走 `variant=builtin → StepEngine`。**现状阻塞**：`classify_seed()` 只硬编码 4 个 id（ctrl-chat / clipboard-ai / ai-translate / ai-text），其它 builtin id fallthrough Stub。`classify_from_installed_manifest()` 只认 `source.type == "mcp"`。**markdown-quote 已 shipped 但 run_keycap 走不到 Step 执行** —— 需要 B1 + B4。
- **Workspace UI**: output=clipboard，应由通用 sink 写回剪贴板 + notification 显示「已写入剪贴板」。无需自定义组件。**前端阻塞**：现状 KeycapCard 仅 render tile，无统一 invoke + output sink dispatch —— 需要 A2 + A3。
- **Verdict**: ⚠️ Irisy 端 ✅；底座 + 前端各阻塞 1 处。

### 2.2 Pattern A — Memos (notes sink, reference impl)

- **NL trigger**: 用户："我要个把选中的文字发到我的 Memos 实例的 keycap，host 在 https://memos.mydomain.com"
- **Irisy slot fill**:
  - `<keycap-slot field="name">发送到 Memos</keycap-slot>`
  - source.type 推断 = builtin（用户提具体 platform 但当前 persona 推断规则只列了 feishu/coze/notion/linear/slack/github → memos 走 builtin + http step） ⚠️ **persona 推断规则未覆盖 generic HTTP sink**
  - actions[0].steps = capture-clipboard → http-post (需新 step type) → notify
- **Kernel dispatch**: 需要 `step.type = http-post` 调用 `network.http` capability。**现状**：manifest-schema.ts StepEngine 没 `http-post` step type（仅 mcp-invoke 是网络出口），需补 `http-request` step。**底座 ask B4 包含**。
- **Workspace UI**: output=notification "已发送 N 字到 Memos"。通用 sink 即可。
- **Irisy persona ask**: 推断规则补 "未列举的 platform → 走 builtin + http step 而非 mcp"，避免 Irisy 把 sink 错推为 oauth/mcp。
- **Verdict**: ⚠️ Irisy persona 推断规则需补；底座需 http-request step；前端通用 sink ✅。

### 2.3 Pattern B — BetterDisplay (CLI wrapper, reference impl)

- **NL trigger**: 用户："我想要个 keycap 调 betterdisplaycli 来切外接屏 HiDPI"
- **Irisy slot fill**:
  - source.type 推断 = local_agent（"local process / Python / shell script"）⚠️ 规则匹配 "shell" 但 betterdisplaycli 是已安装的 CLI 不是 user script —— 推断不准
  - 需要 slot 表达：`process.spawn` allowlist + `version_command` + `platforms: ["macos"]`
- **Kernel dispatch**: v1.1 `process.spawn` capability + SubprocessActor —— v1 走不通。spike 06 已列 v1.1 promote 触发条件（B bucket ≥ 2 keycap）。
- **Workspace UI**: html-output (CLI stdout 解析显示)。**前端缺**：通用 html-output renderer（A1）。
- **Irisy persona ask**: 补 source.type=cli-wrapper 推断 + `<keycap-slot field="source.command">` 表达。
- **Verdict**: ❌ v1 不可达（v1.1 promote 后可达）；persona 推断规则需补 cli-wrapper case。

### 2.4 Pattern C — Motrix (daemon controller)

- **NL trigger**: 用户："我想要 keycap 调起 Motrix 加新下载任务"
- **Irisy slot fill**: source.type 推断 ⚠️ persona 当前规则没 daemon-controller 桶 —— "local agent" 又会被 v1.1 source.type=cli-wrapper 抢匹配
- **Kernel dispatch**: v1.1 `network.local_rpc` —— v1 走不通
- **Workspace UI**: html-output (任务进度)
- **Verdict**: ❌ v1 不可达；persona 推断 + manifest source.type 都需 v1.1 补 daemon-rpc-tool 分类。

### 2.5 Pattern D — bazi-mcp (3rd-party MCP, reference impl) ★

- **NL trigger**: 用户："我要装个八字算命的 MCP server，github 上的 cantian-ai/bazi-mcp"
- **Irisy slot fill**:
  - source.type = mcp ✅ persona 直接 cover
  - `<keycap-slot field="source.server">npx -y bazi-mcp</keycap-slot>`
  - `<keycap-slot field="source.tools">["bazi.calculate"]</keycap-slot>`
- **Kernel dispatch**: `variant=mcp-server → MCPServerActor → mcp.invoke_tool` —— **现状**：`classify_from_installed_manifest` 已支持 `source.type == "mcp"` ✅。但需要 `mcp_host` 真实 spawn 第三方 MCP server（不是 stub）—— 待 zeus 实现完整 MCPServerActor。
- **Workspace UI**: html-output (MCP content array: text/image/resource)。**前端缺**：html-output renderer。
- **Sandbox**: spike 06 §Q2.13 列了 sandbox profile derivation —— 第三方 MCP 自动落 `restricted` profile (sandbox-exec / landlock+seccomp / AppContainer)。zeus 实现。
- **Verdict**: ✅ Irisy 端最干净；底座需 mcp_host 完整 spawn；前端需 html-output renderer。**这是 Day-1 应该跑通的 pattern**（生态杠杆最大）。

### 2.6 Pattern E — 飞书 (OAuth, reference impl)

- **NL trigger**: 用户："我要个 keycap 把当前选中文字发到飞书我的小群"
- **Irisy slot fill**: source.type = oauth (vendor=feishu) ✅ persona 直接 cover
- **Kernel dispatch**: v1.1 `oauth.broker.start_flow(feishu)` + loopback callback —— v1 走不通
- **Workspace UI**: form (首次授权 + 选群) + notification (发送完成)
- **Verdict**: ❌ v1 不可达；oauth.broker v1.1 落地后可达。**端侧化要点**（CLAUDE.md §2）：OAuth callback 必须 loopback `http://127.0.0.1:<random>/cb`，**不走 cloud proxy**。

### 2.7 Pattern F — VSCode coding context publisher

- **NL trigger**: 用户："我装了 VSCode 插件能 publish 当前编辑器选中代码到 CTRL，怎么订阅"
- **Irisy slot fill**: ❌ persona 完全没 cover ST-SS subscribe pattern；用户场景也不是创作 keycap 而是订阅
- **Kernel dispatch**: v1.1 `stss.subscribe` + `mcp.notifications` bridge
- **Verdict**: ❌ v1 完全不可达；这条本质上**不该走 keycap-creator** —— 走 Irisy 的另一种 intent (subscribe-stream)。**Irisy persona 后续扩多 intent mode 时再处理**。

### 2.8 集成校验小结

| Pattern | Irisy slot fill | Kernel dispatch | Workspace UI | 综合 |
|---|---|---|---|---|
| G builtin (markdown-quote) | ✅ | ⚠️ B1 + B4 | ⚠️ A2 + A3 | v1 可通 |
| A sink (Memos) | ⚠️ persona 推断补 | ⚠️ B4 (http step) | ✅ | v1 可通 |
| B CLI (BetterDisplay) | ⚠️ persona 补 cli-wrapper | ❌ v1.1 promote | ⚠️ A1 (html-output) | v1.1 |
| C daemon (Motrix) | ⚠️ persona 补 daemon | ❌ v1.1 | ⚠️ A1 | v1.1 |
| D 3p-MCP (bazi) | ✅ | ⚠️ B5 (mcp_host 实化) | ⚠️ A1 | v1 应优先跑通 |
| E OAuth (飞书) | ✅ | ❌ v1.1 oauth.broker | ⚠️ A4 form | v1.1 |
| F STSS publisher | ❌ persona 缺 intent | ❌ v1.1 | ⚠️ A1 chat-stream | v1.1 + persona 扩 |

**结论**：v1 上货链路（G + A + D）瓶颈集中在 **schema 统一 + B1/B2/B4 底座 + A1/A2/A3 前端**。这 6 条做完，A 桶 15 条 + D 桶 2 条 + 6 条 v1 top-15 + 16 G shipped 全部可走通用管线。**不再有"一个 keycap 一条管线"**。

---

## 3. "一条 keycap 一条管线" 现象拆解（bao 提的核心问题）

观察到的 4 处"管线"：

### 3.1 Schema 漂移（4 份不同 shape）

| 位置 | shape | 状态 |
|---|---|---|
| `.olym/specs/tool-manifest/spec.md` v0.1 | 顶层 `source` discriminated union；capability 数组 | 陈旧，没补 ADR-010 v0.2 改动 |
| `packages/ctrl-keycap-sdk/src/manifest-schema.ts` (untracked) | `variant` + `source` 并存；`permissions` 数组（不是 `capabilities` 对象） | 对齐 spike 06 部分，但 capability 字段未落 |
| `packages/ctrl-web/src/lib/irisy-keycap-zod.ts` | PWA 副本，注释明说"swap when zeus ships Z1 manifest spec v0.2" | 是临时副本 |
| 16 G builtin manifest.json 实际字段 | `permissions: ["clipboard","network"]` 字符串数组；无 `variant`；`description.short` 嵌套 | 实证 SSOT，但跟上面 3 份都不一致 |

**问题**：Irisy 创作助手生成的 manifest、PWA 端校验的 schema、kernel 端解析的 schema、16 builtin 实际字段，4 份不互信。每写一条新 keycap 都要在 4 份之间手工对齐。

### 3.2 底座 dispatch 硬编码（4 条 match arm）

`src-tauri/src/commands/kernel.rs:519-540` 的 `classify_seed()`：

```rust
match keycap_id {
    "ctrl-chat" => TextChat { system: "..." },
    "clipboard-ai" => TextChat { system: "..." },
    "ai-translate" => TextChat { system: "..." },
    "ai-text" => TextChat { system: "..." },
    _ => Stub,
}
```

**问题**：这 4 条 keycap 都是 G builtin，本应走 manifest 的 `actions[].steps[]` 走 StepEngine 执行 (`type: llm` step 自带 `system` 文本)。现在 system prompt 硬编码在 Rust 里 + Stub fallthrough 让其他 12 个 builtin 跑不通 LLM step (没有 LLM step 路径) —— 加新 G keycap = 加新 match arm = 一条管线。

### 3.3 前端无 workspace UI dispatch registry

`packages/ctrl-web/src/components/KeycapCard.tsx` 仅 render 一个 button tile。没有：
- 按 `manifest.actions[].output` (clipboard / modal / notification / workspace / silent) 路由到通用 sink
- 按 `manifest.workspace.ui` 类型路由到 React 组件

**问题**：任何想自定义 workspace 显示的 keycap (Memos 配置 form / 八字算命结果展示 / 任务列表 html-output) 都得在 PWA 加专门组件 —— 又一条前端管线。

### 3.4 16 builtin manifest 缺 `capabilities` 字段

builtin manifest 用 `permissions: ["clipboard", "network"]` 字符串数组（v0.1 spec），没有 spike 06 §Q2 设计的 `capabilities: { clipboard: { read: true, write: true }, ... }` 结构化对象。没有结构化字段 → kernel 没法做细粒度 capability gate（read vs write 不分；allowlist 不能声明）。

---

## 4. Manifest schema 统一（前提条件）

> 这是所有后续 ask 的依赖。schema 不统一，下面所有 ask 都白干。

### 4.1 SSOT 提议

- **代码 SSOT** = `packages/ctrl-keycap-sdk/src/manifest-schema.ts`（untracked, 当前最新；本 PR 提议 commit）
- **人类 doc** = `.olym/specs/tool-manifest/spec.md`（重写为对照 .ts 的 prose 解释，不再含独立 schema 定义）
- **PWA 端** = `packages/ctrl-web/src/lib/irisy-keycap-zod.ts` 改为从 `@ctrl/keycap-sdk` re-export，不再独立维护
- **kernel 端** = Rust 端 `kernel/keycap_manifest.rs`（待 zeus 落）serde 反序列化结构，**字段名 + enum 值与 TS schema 字符串对齐**（手工 + golden file 测试）

### 4.2 manifest-schema.ts 缺补（spike 06 落地）

当前 manifest-schema.ts 有 `permissions: Permission[]` 字符串数组（chord/category 等 16 builtin 字段也保留），但 spike 06 §Q2 要的结构化 `capabilities` 对象未加。补：

```typescript
// 在 KeycapManifest top-level 加：
capabilities: z.object({
  clipboard: z.object({ read: z.boolean(), write: z.boolean() }).optional(),
  text: z.object({ chat: z.boolean(), transform: z.object({ ops: z.array(z.string()) }).optional() }).optional(),
  network: z.object({
    http: z.object({ allowlist: z.array(z.string()), methods: z.array(z.enum(['GET','POST','PUT','DELETE','PATCH'])), max_request_size_kb: z.number().int().optional() }).optional(),
    open_url: z.object({ allowlist: z.array(z.string()) }).optional(),
  }).optional(),
  keyring: z.object({ read: z.array(z.string()), write: z.array(z.string()) }).optional(),
  screen: z.object({ capture: z.boolean(), list_displays: z.boolean() }).optional(),
  file: z.object({ read_allowlist: z.array(z.string()), write_allowlist: z.array(z.string()) }).optional(),
  mcp: z.object({ spawn: z.boolean(), invoke: z.boolean(), notifications: z.boolean() }).optional(),
  platform: z.object({ notify: z.boolean(), hotkey: z.boolean() }).optional(),
}).optional(),

// 同时加 workspace 字段：
workspace: z.object({
  ui: z.enum(['none', 'notification', 'modal', 'clipboard', 'html-output', 'chat-stream', 'picker', 'form', 'canvas']).default('none'),
}).optional(),
```

### 4.3 16 builtin manifest 一次性迁移

每个 `share/modules/builtin/*/manifest.json` 加：
- `"variant": "builtin"`（隐式默认即可，但显式更清晰）
- `"capabilities": { ... }`（按 spike 06 §Q1.1 表填）
- `"workspace": { "ui": "..." }`（clipboard / notification / none）

保留：id / name / version / author / description / icon / category / tags / actions / chord（这些字段都在 manifest-schema.ts 已覆盖）。

去掉：`permissions: ["clipboard","network"]` 字符串数组（被 capabilities 取代）。

---

## 5. 前端抽象缺口 (asks for @daedalus)

> **总原则**：不允许 keycap 自带 React 组件。所有 UI 通过 manifest 数据驱动 + 固定 N 个通用 renderer 实现。

### A1. WorkspaceUiDispatch registry

- **现状**：无。任何 keycap 想要非默认 render 都得改 PWA 代码。
- **要求**：按 `manifest.workspace.ui` 枚举值路由到固定组件：

```typescript
// packages/ctrl-web/src/components/WorkspaceUiDispatch.tsx (新建)
const WORKSPACE_UI_REGISTRY = {
  'none': NullRenderer,
  'notification': NotificationRenderer,        // 系统通知，无 workspace 区域
  'modal': ModalRenderer,                       // 弹窗显示 string 输出
  'clipboard': ClipboardCompleteRenderer,       // 写完剪贴板后的简短提示
  'html-output': HtmlOutputRenderer,            // MCP content array / CLI stdout 解析（最通用，70% keycap 用这个）
  'chat-stream': ChatStreamRenderer,            // LLM 流式（ctrl-chat / 翻译 / 改写共用）
  'picker': PickerRenderer,                     // 选项列表（snippet / preset / kb 检索结果）
  'form': FormRenderer,                         // 配置 / OAuth 授权 / 邮件草稿
  'canvas': CanvasRenderer,                     // 截图 / OCR 选区
};
```

- **9 个组件，N 个 keycap** —— manifest 改 enum 值即换 render。
- **acceptance**：46 条意向 + 8 条 v1 top-15 全部能落在这 9 类，零新增组件。

### A2. 通用 KeycapInvokeButton

- **现状**：KeycapCard 是 button，onActivate 走 `onActivate(id)` 但 PWA 路由层针对 ctrl-chat / clipboard-ai 各有分支。
- **要求**：所有 keycap 走同一入口：

```typescript
// packages/ctrl-web/src/lib/keycap-invoke.ts (新建)
export async function invokeKeycap(keycapId: string, manifest: KeycapManifest): Promise<void> {
  const action = manifest.actions[0]; // primary action
  const input = await captureInput(action.input);  // 5 枚举: clipboard/selection/screen/none/prompt
  const result = await invoke('run_keycap', { keycap_id: keycapId, input });
  await routeOutput(action.output, result);  // 5 枚举: clipboard/modal/notification/workspace/silent
}
```

- 取消 `ctrl-chat` / `clipboard-ai` 专属触发路径。

### A3. 通用 OutputSink

- **现状**：散落在各处的 setClipboard / setModal / showToast 调用。
- **要求**：单点路由（与 A1 配合）：

```typescript
async function routeOutput(target: ActionOutput, result: unknown) {
  switch (target) {
    case 'clipboard': await writeText(stringify(result)); break;
    case 'notification': showToast(stringify(result)); break;
    case 'modal': openModal(result); break;
    case 'workspace': openWorkspaceUi(result); break;   // → A1 dispatch
    case 'silent': break;
  }
}
```

### A4. Form renderer for OAuth / config

- **现状**：无 schema-driven form。
- **要求**：从 manifest.actions[].input==='form' + manifest 自带 `inputs_schema: zod` 渲染表单（Memos host 填写 / OAuth 授权前 scope 选择 / 邮件 to/subject/body 起稿）。
- **acceptance**：Memos + 飞书 + 邮件 3 个 keycap 共用同一 FormRenderer，零专属组件。

### A5. KeycapManifestForm (Irisy 创作助手右侧预览)

- **现状**：irisy-keycap-store.ts + irisy-keycap-slots.ts 已存在（lane-B 写过），但 PWA 端绑定路径未端到端跑通。
- **要求**：Irisy `<keycap-slot>` token 实时驱动右侧 form preview（manifest fields filled / unfilled visual），用户能点字段触发 `<keycap-patch>` 修改。
- **acceptance**：bao 在 `/irisy` 跑 "我要个 X keycap" 一气呵成出 manifest，右侧 form 同步可见 + 字段可点回改。

---

## 6. 底座抽象缺口 (asks for @zeus)

> **总原则**：删除所有"by keycap-id" 的 hardcoded dispatch。所有 keycap 走 manifest-driven 通用 dispatch + capability gate。

### B1. run_keycap manifest-driven dispatch（去硬编码）

- **现状**：`classify_seed()` 4 条 match arm + LLM system prompt 硬编码在 Rust。
- **要求**：删除 `classify_seed`；改为：
  - 读 manifest（builtin 从 `share/modules/builtin/<id>/manifest.json` 或 `~/.ctrl/keycaps/<id>/manifest.json`）
  - 按 `manifest.variant` 路由：
    - `builtin` → StepEngine (执行 actions[0].steps[])
    - `mcp-server` → MCPServerActor (mcp.invoke_tool)
    - `oauth` → v1.1 oauth.broker + http step
    - `cli-wrapper` → v1.1 SubprocessActor
    - `stss-publisher` → v1.1 stss subscribe
- **acceptance**：删除 `ctrl-chat` / `clipboard-ai` / `ai-translate` / `ai-text` 这 4 个 Rust match arm；4 条 keycap 走 builtin manifest + `llm` step；新加 G keycap 完全零 Rust 改动。

### B2. 8 namespace capability gate（spike 06 §Q2.13）

- **现状**：spike 06 已设计 schema，但 kernel 端未落地。
- **要求**：
  - `src-tauri/src/kernel/capability/{clipboard,text,network,keyring,screen,file,mcp,platform}.rs` 8 个文件
  - 每个 method 入参用 serde 反序列化 + zod 同形 Rust validator（手工对齐）
  - run_keycap 在 dispatch 前查 manifest.capabilities，缺什么 method 拒什么调用 → 返 `CAPABILITY_VIOLATION`
- **acceptance**：跑 spike 06 §Q1.1 23 keycap × 100 (keycap, capability) 行的 golden file 测试，全过。

### B3. StepEngine（manifest.actions[].steps[] 执行器）

- **现状**：隐式存在于"builtin step semantics" 但未结构化代码。
- **要求**：实现 manifest-schema.ts 列的 9 个 step type：
  - `capture-clipboard` → kernel `clipboard.read`
  - `write-clipboard` → kernel `clipboard.write`
  - `llm` → kernel `text.chat` (stream)
  - `template` → 字符串 mustache 替换
  - `transform` → kernel `text.transform`
  - `notify` → kernel `platform.notify`
  - `open-url` → kernel `network.open_url`
  - `mcp-invoke` → kernel `mcp.invoke_tool`
  - `vault-write` → kernel `vault.append`（已 shipped per #37 PR）
- 新增 step type（§2.2 Memos sink 暴露）：
  - `http-request` → kernel `network.http`（带 allowlist 校验）
- **acceptance**：16 G builtin manifest 用新 StepEngine 全部跑通；Memos keycap 装一份新 manifest 即跑通。

### B4. 16 builtin manifest 一次性迁移（与 §4.3 联动）

- **现状**：16 个 `share/modules/builtin/*/manifest.json` 用旧 shape (permissions 数组 / 无 variant / 无 capabilities)。
- **要求**：一次性 sed 迁移，加 `variant: "builtin"` + `capabilities: { clipboard: ..., text: ..., network: ... }` + `workspace.ui`。spec 06 §Q1.1 表是逐 keycap 该填什么的权威。
- **acceptance**：16 个 manifest 全部通过新 manifest-schema.ts `parseManifest()` 校验；run_keycap 走 builtin variant + StepEngine 跑通。

### B5. (v1 不写) mcp_host 完整 spawn（Pattern D 解锁）

- **现状**：`kernel/mcp_host.rs` 已 stub。
- **要求**：完整实现 spike 06 §Q2.7 schema 的 `mcp.spawn` (transport: stdio/sse/websocket) + `mcp.list_tools` + `mcp.invoke_tool` + `mcp.notifications` 流式 + sandbox profile derivation (sandbox-exec / landlock+seccomp / AppContainer) per ADR-010 §5.4。
- **acceptance**：装 bazi-mcp → run_keycap → 走 mcp.invoke_tool → 返结果到 PWA html-output renderer。

### B6. (v1.1 不写) process / oauth / network.local_rpc / stss / image 5 namespace

- **触发条件**：spike 06 §Q1.2 已锁。等 bucket 内第 2 条 keycap 出现再 promote。

---

## 7. 关于不做的事

- **不每条 keycap 新建 Rust dispatch arm** — 删 classify_seed，全 manifest 驱动 (B1)
- **不每条 keycap 新建 React 组件** — 9 个 workspace UI renderer 覆盖所有 (A1)
- **不每条 keycap 自带 step type** — StepEngine 9 + http-request 共 10 种 step 足够 (B3)
- **不为 v1.1 pattern 现在写 capability** — 等第 2 条 keycap 出现 (B6)
- **不重复造 mesh / Irisy 入口** — 跨设备走 mesh / Chat 走 Irisy 自身 (#15 #21 砍)
- **不接入 11 条不适配** — 已记录 (§1.3 末)

---

## 8. 立即行动顺序（不分阶段，单 deliverable）

1. **Hephaestus** commit 本文档 + manifest-schema.ts 到 keycap-dev → PR 给 bao 看
2. bao 拍板 → Hephaestus 派
   - H-2026-05-22-NNN 给 daedalus（A1-A5 前端抽象）
   - H-2026-05-22-NNN 给 zeus（B1-B5 底座抽象 + 16 builtin manifest 迁移）
3. 两条 handoff 完成 → bao + Apollo 拍板"v1 ship 哪 N 条 keycap"（候选：16 G shipped + 6 v1 top-15 + 2 Pattern D + 5 Pattern A = ~29 条全部零代码上货）
4. 长尾 46 条意向通过 Irisy keycap-creator 由用户自助创作（不再走 fleet）

---

## 9. 引用 / 交叉

- **ADR-010** `.olym/decisions/010-keycap-execution-model.md` — Decision spine
- **Spike 06** `doc/keycap-integration-research/06-jiazuo-result.md` — Capability surface + Q3 claude-free audit
- **Keycap ideas record** `doc/keycap-ideas-record.md` — 46 条意向 + pattern 标签
- **Irisy persona** `.olym/personas/irisy/keycap-creator.md` — slot/patch/ready token 协议
- **Manifest SSOT 候选** `packages/ctrl-keycap-sdk/src/manifest-schema.ts` — 本 PR untracked → commit

— Hephaestus, 2026-05-22
