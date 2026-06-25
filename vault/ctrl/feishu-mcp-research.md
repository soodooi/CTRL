---
title: 飞书 (Lark) MCP 现状核实 — 带源
kind: reference
created_at: 2026-06-23
author: deep-research (101 agent / 18 源 / 25 断言 3 票对抗验证 / 22 确认 3 驳回)
serves: 智能表格对标飞书 Bitable + 飞书作 sync provider (connector) + 能力市场 seam ⑤
related:
  - "[[GOAL]]"
  - 010-communication.md   # seam ⑤ 第三方 app = MCP
  - "[[mcp-capability-marketplace]]"
---

# 飞书 MCP 现状核实(2026-06,带源)

> 时效:核心事实截至 2026-06。官方 server 为 **Beta**,最新 release **v0.5.1 (2025-08-06)**,能力面/preset 名可能随后续 release 变,接入前复核 presets.md + README 最新版。

## 一句话

**飞书有官方 MCP server,且生产可用、local-first 友好、Bitable 全读写** —— CTRL 可零自研把它挂 `:17873` gate 当 connector。社区第三方实现全是玩具,别用。飞书没有 Claude-Code 式 agent CLI(只有 MCP server + API CLI + SDK),**这反向印证 CTRL 的定位:CTRL 是 AI 前端/brain 层,飞书只是后端/connector**。

## 核实结论

| # | 结论 | 置信 | 源(官方=第一方) |
|---|---|---|---|
| 1 | **官方 MCP 存在**:仓库 `larksuite/lark-openapi-mcp`(字节 larksuite org,维护者 @bytedance.com / @larksuite.com),npm `@larksuiteoapi/lark-mcp`,~743★,MIT,v0.5.1 (2025-08),Beta。README 自述「Lark official, NOT an Anthropic MCP integration」(纠正了二手源误称 Anthropic) | high (3-0) | 官方:github.com/larksuite/lark-openapi-mcp · npmjs.com/package/@larksuiteoapi/lark-mcp · open.larksuite.com/.../mcp_introduction |
| 2 | **能力面按 preset 分域暴露**:`preset.im` / `base`(Bitable)/ `doc` / `task` / `calendar` 等,`-t/-p` 选子集 | high (3-0) | 官方:presets.md + advanced-configuration |
| 3 | **Bitable 多维表格 = 完整读写**:建 base/table/record + batchCreate/update/batchUpdate(底层 batch ≤1000 条/次,需 edit 权限);`preset.base.batch` 专做批量 | high (3-0) | 官方:presets.md |
| 4 | **核心模块覆盖**:IM(发消息/建群/搜群/取成员,读写)· 日历(建/改 event + 忙闲 freebusy)· 通讯录(批量取 user ID,读)· 任务(建/改,读写)· Drive/Wiki(权限 + 搜索,读) | high (3-0) | 官方:presets.md |
| 5 | **能力空白(关键)**:云文档(docx)**只读/导入/搜索,不可直接编辑**;文件上传下载**不支持**;**审批(approval)未在 preset 出现** | high (3-0) | 官方 README 逐字:"Direct editing of Feishu cloud documents is not supported"、"File upload and download operations are not yet supported" |
| 6 | **鉴权三模式**(`--token-mode`):`tenant_access_token`(app 身份,-a/-s)/ `user_access_token`(用户身份,`lark-mcp login` 走 OAuth)/ `auto`(默认,LLM 自动选,**可能误回退 tenant 致个人数据权限不足**) | high (3-0) | 官方:configuration.md + advanced-configuration |
| 7 | **OAuth 本地 loopback + keychain**:登录走 `localhost:3000/callback`,user token 经 **keytar 存 OS keychain**,**不必经第三方 server** | high (3-0) | 官方:npm manifest(keytar ^7.9.0)+ configuration.md |
| 8 | **三种 transport**:`stdio`(默认/推荐)/ `streamable` HTTP / `sse`,`-m` 选 | high (3-0) | 官方:cli.md + configuration.md |
| 9 | **社区第三方全是玩具**:`kone-net/mcp_server_lark`(2★,实际只 1 个 write_excel)、`loonghao/feishu-bot-mcp-server`(2★,仅模板样板)→ **别用,官方是唯一可行** | high (3-0) | github 两仓库主页 |
| 10 | **飞书无 Claude-Code 式 agent CLI**:有官方 API CLI(`larksuite/cli`,Go,OpenAPI 命令包装,类似 `gh`)+ `lark-mcp` CLI(只是 server 启动器 + OAuth 登录),agent loop 仍由 MCP 客户端(Claude/Cursor)承担;飞书侧 = oapi-sdk + MCP server | medium(推断,无源提交互 agent CLI) | 官方:cli.md;larksuite/cli |

## 被对抗验证驳回(别信二手源)

- ❌「审批 approval / docx 写编辑 已覆盖」→ 驳回(1-2 / 0-3)。**当前确实空白。**
- ❌「三种 token 含 app_access_token 作独立模式」→ 驳回(0-3)。实为 tenant/user/auto 三 mode。
- ❌「官方 server 是 Anthropic MCP 集成」→ 二手源错,README 明确是 Lark/字节自有。

## 对 CTRL 的接入含义(medium,结合 CTRL 架构推断)

**能直接挂 `:17873` gate 当 connector,stdio 子进程模式最契合**(本地、单用户、无网络暴露面)。零自研。

**接入要点 / 坑**:
1. **显式锁 `--token-mode user_access_token`** —— 否则 auto 会回退 tenant 身份,拿不到用户私有数据 + 破坏数据主权语义(要代用户身份,不是租户身份)。
2. **OAuth loopback + keytar/keychain 跟 CTRL 端侧 OAuth + Keychain-secrets 天然吻合** —— 这是接入的有利条件,不是阻碍。(注:keychain 只管 user OAuth token;tenant/app token 经 flag/env 传,需 CTRL 自己保护。)
3. **写操作过 CTRL review gate**:Bitable batch 写、IM 发消息等都是 produce,走 `:17873` 的写治理(controlled writes,Apollo 模型,= 刚做的 SC3)。
4. **能力空白要 fallback**:CTRL 若需写回飞书云文档 / 走审批流 / 传文件,**MCP 做不到,得走 `@larksuiteoapi/node-sdk` 自实现**。
5. **Beta + tool-poisoning 风险**:MCP 工具描述可被注入 → 正好用 CTRL gate 刚做的 **caller/intent 可见性裁剪 + 审计 ledger(SC1/2/3)** 兜:把飞书 MCP 归到一个 intent 域、白名单可见工具、审计每次调用。

> **架构印证**:飞书 MCP 是「现成 connector」的标准样本 —— 它正好需要 CTRL gate 治理面(写审批 + 可见性裁剪 + 审计)才能让普通用户安全用。这验证了「CTRL = 整合 + 治理层,不重造后端」的命题,也验证了刚做的 SC3 治理面是对的。

## Bitable 对标的额外价值(智能表格)

飞书 Bitable OpenAPI 的 **read/write 端点 + batch(≤1000/次)+ 字段类型** 是 CTRL 智能表格对标飞书的**一手能力清单**:既是 parity 目标(CTRL 要做到的字段/操作),又是 sync 通道(本地 truth → 飞书 mirror 写回经此 MCP)。接智能表格 ↔ 飞书 Bitable 双向 sync 时,这个官方 MCP 是现成写通道。

## Open questions(接入前需再核)
1. 后续版本会否补 docx 块级写 / approval / 文件上传下载?(决定 CTRL 能否纯靠 MCP 做双向 sync,还是必须 oapi-sdk fallback)
2. user_access_token 有效期 / refresh 周期?token 过期 + 权限变更时 keytar 自动刷新的失败行为?(关系 CTRL gate 降级/重新授权 UX)
3. Bitable batch 之外的 QPS 频控阈值 + 429 退避?(大量本地→飞书写回会否成瓶颈)
4. 工具描述是否签名/校验?(决定 CTRL gate 工具白名单 + 审计粒度)

## 一手源清单(官方为主)
- github.com/larksuite/lark-openapi-mcp(+ /blob/main/README.md · presets.md · configuration.md · cli.md)
- npmjs.com/package/@larksuiteoapi/lark-mcp
- open.larksuite.com/document/.../mcp_integration/{mcp_introduction, advanced-configuration, mcp_installation}
- open.larksuite.com/.../api-access-token/app-access-token-development-guide
- github.com/larksuite/cli(官方 API CLI)
- (社区,反例)github.com/kone-net/mcp_server_lark · github.com/loonghao/feishu-bot-mcp-server
