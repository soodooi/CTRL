# Workshop end-to-end — pipeline simulation · research note 03

> Author: zeus · Status: open research · Continues `00-framing-and-inventory.md` + `01-workshop-ux.md` + `02-manifest-schema-audit.md`.
> bao 2026-05-23 三条指导:
>   1. 用户能集成现有创造 (MCP / 飞书 / Obsidian / 网页功能 / LLM)
>   2. 无限画布是趋势
>   3. 从用户端到端模拟几条管线, 生成自己可用的 keycap

不再纸上谈兵。模拟 5 条真实 pipeline, 看每一步用户在哪、按什么、看什么、卡什么。问题就地暴露, 不藏。

---

## 1. Pipeline A — 包装一个 MCP server tool 成 keycap

**用户故事**: "我想把当前选中文字发到飞书我自己的频道"

**端到端步骤**:

| # | 用户动作 | 看到什么 | 卡点 |
|---|---|---|---|
| 1 | 按 Ctrl 唤起 CTRL | keyboard 显示 + Irisy 守在右栏 | — |
| 2 | 找 "造 keycap" 入口 | L-1 rail 底部的 "+" 按钮 (推荐), 或 `/irisy` chat 里 quick-action button | **入口必须首屏可见** — 找不到 = 玩不起来 |
| 3 | 点 "+" | 打开新窗口 workshop (无限画布), 第一屏 = 5 个模板入口 + "0 from scratch" | 不挤进 920px 主窗口 |
| 4 | 选 "包装 MCP server tool" 模板 | workshop 列 kernel 已知 MCP server (`list_mcp_servers` 返回); 没接过飞书 → 提示 "+ Add MCP server" | 飞书没现成 MCP server. **基础设施盲点** |
| 5 | 用户粘贴飞书 MCP server 的 URL / config | workshop 通过 kernel mcp_client (G2 substrate) 连接, 列 server 的 tools | G2 still ❌. 必须 ship 否则这条管线断 |
| 6 | 选 `feishu.send_message` tool | workshop 读 MCP tool 的 inputSchema (JSON schema), 生成 form | manifest 的 step 类型 = `mcp-invoke` (已有) |
| 7 | workshop form 自动填: 名字 / icon / input source / tool args | 用户填 channel_id | **channel_id 用户不知道怎么填** — workshop 需要内嵌"如何找 channel ID"的微帮助 |
| 8 | 点 "Test" | workshop 跑一次, 但 `send_message` 是 destructive — 不能真发 | **sandbox 必须区分 read vs write vs destructive**; manifest step 缺 `side_effect` 字段 |
| 9 | "Test" 显示 "would send: <preview message>" | 用户点 "Looks good" | side_effect-aware sandbox 还没设计 |
| 10 | 点 "Install" | keycap 装到 keyboard, workshop 窗口关 | 走通 |
| 11 | bao 回主窗口按这个 keycap, 选中文字, 真发到飞书 | 飞书 channel 收到 | — |

**这条管线暴露的具体 gap**:
- G2 (MCP client) 必须先 ship (kernel `mcp_client.rs`)
- MCP server discovery 必须有 "Add server by URL" UX
- inputSchema → form 的自动渲染 (PWA 端的 schema-form library, 类似 react-jsonschema-form)
- side_effect 标签必须进 manifest schema (D1 补丁)
- 内嵌帮助系统 ("如何找 channel ID")

---

## 2. Pipeline B — 接 OAuth 平台 (Feishu) — 不走 MCP, 走原生 OAuth + HTTP

**用户故事**: 同上, "发到飞书我的频道", 但飞书没 MCP server, 走飞书 OpenAPI

**端到端步骤**:

| # | 用户动作 | 看到什么 | 卡点 |
|---|---|---|---|
| 1-3 | 同 A | 同 A | 同 A |
| 4 | 选 "接 OAuth 平台" 模板 | workshop 列预设 provider: Feishu / Notion / Linear / Slack / GitHub | 5 个 provider 各自的 OAuth template + scope 必须预制 |
| 5 | 选 Feishu | workshop 检查 keychain 是否已有 Feishu token | `keychain.get_key` 已有 |
| 6 | 没 token → workshop 弹"授权 Feishu" | 浏览器打开飞书 OAuth 页, 用户登录授权 | **loopback OAuth flow** 必须 ship (本机 127.0.0.1 callback) |
| 7 | 回到 workshop, token 存 keychain | workshop 列 Feishu 常用 API 端点: send_message / read_chat / upload_file | 需要 per-provider API spec 内置 (Feishu OpenAPI 100+ endpoints, 选 10 个常用) |
| 8 | 选 send_message | form 自动生成: channel_id, content, msg_type | 同 A step 7 — channel_id 用户找不到 |
| 9 | manifest 生成 = 1 step `network.http` (POST 到 https://open.feishu.cn/...) + Authorization header 从 keychain 取 | preview manifest | step type `network.http` 在 schema 里 (已有 NetworkCap) |
| 10 | Test → destructive → 显示 "would POST: ..." | 同 A | 同 A side_effect |
| 11 | Install → 完成 | — | — |

**这条管线暴露**:
- Loopback OAuth flow 必须 ship (CTRL philosophy 已定, 但代码 still ❌)
- 5 个 provider 预制 OAuth template + scope 列表
- 5 个 provider 内置 10-20 个常用 API endpoint (Feishu / Notion / Linear / Slack / GitHub)
- network.http step 已有, capability broker 必须放过

**vs Pipeline A 的对比**:
- A 走 MCP, B 走 OAuth + HTTP — **两种都得支持**, 因为 MCP server 不一定存在
- 用户视角无差: 都是"我想接飞书". workshop 应该在第一屏让用户选**目标平台**, 内部决定走 MCP 还是 OAuth — 不让用户挑技术路径

---

## 3. Pipeline C — 从 0 写 LLM keycap (最简单)

**用户故事**: "把当前选中文字翻译成英文"

**端到端步骤**:

| # | 用户动作 | 看到什么 | 卡点 |
|---|---|---|---|
| 1-3 | 同 A | 同 A | — |
| 4 | 选 "LLM 加工" 模板 | workshop 显示极简 form (3 字段) | — |
| 5 | 填: 名字 "翻译为英" / input = selection / 输出 = clipboard | form 完成 | 这条管线**Shape A (pure chat) 也走得通** — 用户直接跟 Irisy 说 "I want a keycap that translates selection to English", Irisy emit manifest |
| 6 | system prompt 字段 — workshop 提示用 `irisy-system@latest` 还是写新 | 用户选写新, 输入 "Translate to English idiomatic" | G10 prompt registry 必须 ship 才能引用现成 fragment |
| 7 | Test → run LlmStep → 显示翻译 | OK | sandbox 跑 LLM 是 idempotent (除了 BYOK quota), 直接真跑 |
| 8 | Install | 完成 | — |

**这条管线**:
- Shape A 表达力够, 也用 form 表达也够
- **结论: 简单 LLM keycap 应该走 Shape A** (在 /irisy chat 里造完), 不必进 workshop 大房间
- workshop 大房间留给需要 form-based / schema-driven 引导的复杂 case (Pipeline A / B / D)

---

## 4. Pipeline D — 包装一个网页 API 成 keycap

**用户故事**: "列我 GitHub 上 issue 数 > 0 的 repo"

**端到端步骤**:

| # | 用户动作 | 看到什么 | 卡点 |
|---|---|---|---|
| 1-3 | 同 A | 同 A | — |
| 4 | 选 "网页 API / 抓取" 模板 | workshop 提供 2 个子模板: (a) REST API call, (b) HTML scrape | — |
| 5 | 选 REST API → 用户输入 URL pattern + method + auth 类型 | form 渐进式: 用户先填 endpoint, workshop 用 Irisy 推断 query params / response shape | Irisy `propose_step` 协议要 ship |
| 6 | Auth: 选 "GitHub token" → 跳 OAuth 流 (同 B step 6-7) | 完成 | — |
| 7 | manifest 生成: step 1 = `network.http` GET /user/repos, step 2 = `transform` JSON filter, step 3 = workspace render (picker) | preview | 已有 step types 够 |
| 8 | Test → 列 issue → 用户预览 | OK (read-only, sandbox 直接跑) | side_effect = read, sandbox 放行 |
| 9 | Install → 完成 | — | — |

**这条管线暴露**:
- "渐进式 form" — 用户填一步, Irisy/workshop 推断下一步; 不要一次性 dump 30 个字段
- JSON 转换 step 必须支持 path / filter (当前 transform step 只有 base64/url/case/json 工具操作, **没有 JSONPath / filter / map**) — 缺
- workspace renderer `picker` 已有

---

## 5. Pipeline E — fork + compose 已有 keycap

**用户故事**: "把现有 Translate keycap fork 一份, 改成翻译为日文 + 翻完直接发飞书 (Pipeline B 已经造好的飞书 keycap)"

**端到端步骤**:

| # | 用户动作 | 看到什么 | 卡点 |
|---|---|---|---|
| 1-3 | 同 A | 同 A | — |
| 4 | 选 "fork existing" 模板 | workshop 列用户已装的 keycap (从 `list_keycaps`) | 已有 |
| 5 | 选 "Translate" → fork | workshop 加载 manifest, 标记 `lineage.upstream_id = "ctrl.builtin.translate"`, `tier = "fork"` | D1 lineage 字段必须 ship |
| 6 | 用户改 LlmStep.prompt: "to Japanese" | form-edit | — |
| 7 | 拖一个 step (从 supplier palette `base-keycap`): 选 "发到飞书" | workshop 加 `keycap-invoke` step | D1 keycap-invoke / invoke step 必须 ship |
| 8 | manifest = 2-step: translate → keycap-invoke(feishu-send) | preview | — |
| 9 | Test → translate 真跑 (idempotent) + feishu-send 模拟 (destructive) | 显示 "would post: ..." | side_effect 标签必须 ship |
| 10 | Install → 完成 | — | — |

**这条管线**:
- 是 v1 最高价值场景 — "我已经有 N 个工具, 想组合成新工作流"
- **必须 ship 的字段**:
  - keycap-invoke / invoke step (D1 在加)
  - lineage 字段 (D1 在加)
  - **side_effect 标签** (D1 没有, 必须加)
- Pipeline A 的飞书 keycap 必须先存在 (上游依赖)
- **第一次用户从无到有用 workshop 造的 keycap, 大概率不是这条**; 这条是 v1 进入 "工具熟练期" 后的主战场

---

## 6. 模拟暴露的 10 个具体修正

按用户感知影响排序:

### 6.1 Workshop 入口必须首屏可见 (HIGH)

L-1 rail 底部加 "+" 按钮 (Daedalus 已经有 footer slot 思路, 加 1 个 item). 不进 sub-menu, 不藏 settings — 一眼能看到。

### 6.2 Workshop 用独立大窗口 (无限画布) (HIGH)

不进 920×560 主窗口。Tauri 新 webview window, 1280×800 起步, 用户可拉大或全屏。canvas pan/zoom 让小窗口也能 navigate 大 graph。Cursor / Figma 模型。

### 6.3 第一屏 5 个模板入口 + "0 from scratch" (HIGH)

不要把用户丢进空 canvas。第一屏 5 个固定模板入口对应 CLAUDE.md 5 keycap sources:
1. **MCP server tool 包装** (Pattern D)
2. **OAuth 平台接入** (Pattern E: Feishu / Notion / Linear / Slack / GitHub)
3. **本地工具 / VMark / Obsidian** (Pattern C local agents)
4. **LLM-only keycap** (Translate / Summarize / Ask 类)
5. **Fork existing** (从已装 keycap 拷贝起步)
+ "0 from scratch" 给无限画布的死磕用户

### 6.4 Schema-driven form (HIGH)

用户选了模板, workshop 读 manifest schema + MCP tool inputSchema + OAuth provider config, 自动渲染 form。用户填字段, 自动 emit manifest。**用户不面对 JSON**。需要前端引入 schema-form library (react-jsonschema-form / 自写, daedalus 决定).

### 6.5 Side effect 标签 + sandbox 分级 (HIGH)

manifest schema 加:
```ts
const StepCommon = z.object({
  as: z.string().optional(),
  side_effect: z.enum(['read', 'write', 'destructive']).default('read'),
});
```
- `read` (LLM call, GET HTTP, vault.read) — sandbox 真跑
- `write` (vault.write, localstorage.set) — sandbox 写到 tmp dir
- `destructive` (HTTP POST/DELETE, mcp tool, 飞书 send) — sandbox 只显示 "would do: <payload preview>"

### 6.6 Per-step trace (MEDIUM, Hephaestus D2)

`run_keycap_draft` 返回 n8n-style trace, canvas preview 每 step 一行 row, click 展开 input/output, 失败红框。降级版 v1 = 行展示, "rerun from step N" 推后到 v1.1。

### 6.7 Loopback OAuth flow (HIGH for Pipeline B/D)

`http://127.0.0.1:<random>/callback` 监听, 浏览器走 provider OAuth, 回调拿到 code → kernel 换 access_token → keychain。5 个 provider 各自的 client_id / scope 预制 (作为 CTRL official keycap default, 用户也能自己 fork)。

### 6.8 Provider API spec 内置 (HIGH for Pipeline B)

5 platform × 10-20 endpoint = 50-100 个内置 API spec (URL + method + auth + inputSchema). 工程方式: 静态 JSON 文件 `~/.ctrl/providers/<name>.json` 跟 CTRL 一起 ship, 用户也能自加。

### 6.9 JSONPath / filter / map step (MEDIUM)

当前 transform step 只有 字符串/base64/json 工具操作, 没有 "从 JSON 数组里 filter / map / pluck"。Pipeline D 必需. 加 step type `data-transform` 或扩展 transform.ops。

### 6.10 Drafts 列表 / 恢复 (MEDIUM)

用户做到一半切走, 回来 draft 还在。workshop 顶部 "我的 drafts" 列表 (Hephaestus D4 部分), opt-in git **不在 v1**, 但列表 + 自动保存到 `~/.ctrl/keycaps/.drafts/<id>/manifest.json` 是必须。

---

## 7. 纠正我之前 review 的判断

| 判断 | 我之前说 | 纠正 |
|---|---|---|
| Shape A 够用 | 是 | **错** — 只有 Pipeline C (简单 LLM) 够。A/B/D/E 都需要 form/schema/template — 必须有 workshop 大房间。 |
| Workshop 是低频场景 | 工程错位 | **部分错** — 用户消费多于创作, 但创作能力是 CTRL 的差异化卖点 (vs Raycast 的 extension code-only, vs ChatGPT 的 GPT Builder 单一接口). Workshop 必须扎实, 不能省。 |
| Shape F 920px 太挤 | ✓ 对 | 仍然对 — 解法: 独立窗口 + 无限画布 |
| D5 workshop.* MCP tools v1 不做 | ✗ 太激进 | **修正**: v1 只暴露 3 个 read-only (get_state / list_drafts / list_step_types), write-side 走 PWA 内部 + Tauri command. Namespace 提前预留 (写 spec, 不写完整 impl), 减少未来重构。 |
| Schema linear-only 是 blocker | ✓ 对但缩小 | Pipeline A-E 都 linear 走通 — **Linear 表达力 v1 够**. Loop / branch / trigger 推到 v1.1 当真实需求逼出来时。Schema 不是 blocker, **Side effect 标签 / OAuth flow / Provider spec 才是** |
| 用 vim 写 manifest 是 v1 escape hatch | ✓ 对 | 保留, 但 form-based 必须强 — 99% 用户不开 vim |

---

## 8. 修正后给两 lane 的清单

### Daedalus (前端 lane)

- **独立 webview window** for workshop (1280×800 起步, 可拉大/全屏)
- **第一屏 5 个模板入口** (component, 复用 KeycapCard 模式)
- **无限画布** — canvas pan/zoom (推荐 react-flow / @xyflow/react 已是 2026 业界标准, 或自写)
- **Schema-form** for filling manifest fields based on Zod schema (react-jsonschema-form 或自写)
- **Drafts 列表** 顶部组件
- **Per-step trace inspector** — click step row 展开 input/output (Pipeline D 验证 read step ok)
- **L-1 rail 底部 "+" 按钮** 进 workshop (Daedalus footer slot 已就位, 加 1 item)

跟之前 Daedalus 提的 3 registry (STEP_TYPE / SUPPLIER / RAIL_PANEL) 兼容 — 现在追加: workshop 是新 surface, 不嵌主 shell。

### Hephaestus (Irisy / kernel lane)

D1 schema **加项** (在 D1 原始 7 项基础上):
- **`StepCommon.side_effect`** (`read` / `write` / `destructive`) — 关键, sandbox 分级靠这个
- **`provider_template` source 类型** (per Pipeline B) — 让 manifest 声明 "this keycap uses Feishu OAuth template"
- **`http-extract` 或 `data-transform` step type** (per Pipeline D JSON 过滤需求)

D2 (run_keycap_draft trace) **降级 v1 版**:
- per-step input/output/duration/error 返回; **`rerun_from_step` 推 v1.1**

D5 (workshop.* MCP tools) **缩减 v1 版**:
- 只 3 个 read-only: `workshop.get_state` / `workshop.list_drafts` / `workshop.list_step_types`
- write-side 走 PWA → Tauri command (短路径)
- namespace 预留 (写 spec markdown, 不写代码), 未来 add 7 个 write tool 不重构

**G2 (MCP client) 必须先 ship** — Pipeline A 整个挂在这上面。kernel `mcp_client.rs` 是 zeus 范畴, 但 Hephaestus 熟 commands/, 哪边接 bao 拍。

**Loopback OAuth flow + 5 provider template** — 大工程, 一个独立 substrate (G13?). Pipeline B + D 都依赖。Hephaestus 还是 zeus 接? bao 拍.

### zeus (我)

- `mcp_client.rs` kernel module — Pipeline A 解锁; OR 让 Hephaestus 接, 我 review
- ADR-004 amendment (audio.* / image.* / mcp.client / stss promote) — 现在更紧迫, 因为 Pipeline A-D 都依赖
- 写本 doc + 协调 Hephaestus + Daedalus 重 align

---

## 9. 关键 open questions (给 bao)

1. **5 个模板入口** — 数量 / 名字 / 顺序合理吗? 还是直接 6 个 (加 "fork existing")?
2. **无限画布 + 独立窗口** — 同意了, 1280×800 起步合理吗? 或更大?
3. **5 provider OAuth template** (Feishu / Notion / Linear / Slack / GitHub) — 全部 v1 ship, 还是先 Feishu (中文圈用户) + GitHub (开发者) 两个?
4. **Loopback OAuth + Provider API spec** 是新 substrate (G13), 工程量大, 谁接 (Hephaestus / zeus / 新 lane)?
5. **MCP server marketplace** — workshop 内置一个 "推荐的 MCP server" 列表给用户首次接? 这又是一个新 substrate。v1 做不做?

---

## 10. 下一步

- 这份 doc commit 进 keycap-dev (跟 spec.md 同 dir, 当作 spec v0.1.1 的 supplementary)
- bao 拍 9 个 open Q
- Daedalus / Hephaestus 根据修正过的清单调整他们的 D1-D5 + 6 件起飞项
- zeus 起 ADR-004 amendment + 决定 mcp_client.rs 谁接

---

## Changelog

| Date | Author | What |
|---|---|---|
| 2026-05-23 | zeus | 5 端到端 pipeline 模拟 (MCP / OAuth / LLM / 网页 API / fork+compose), 10 修正项 (含 side_effect 标签 / 独立窗口无限画布 / schema-form / Provider spec 内置 / OAuth loopback). 纠正之前 "Shape A 够用" + "D5 全砍" 判断. 给 Daedalus / Hephaestus / zeus 三方清单 + 5 个 open Q for bao. |
