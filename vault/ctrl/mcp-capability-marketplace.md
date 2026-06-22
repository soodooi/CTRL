---
title: CTRL 能力市场 — 架构方案(MCP 接入:发现 + 安全 + 生命周期)
kind: plan
status: plan
created_at: 2026-06-22
owner: bao
author: zeus (通讯协议)
serves: ADR-010 seam ③(能力插件接入)+ 能力市场;CTRL「普通用户通用平台」
sequencing: 排在 GOAL.md 主目标(§14 + 智能表格 + SC8)之后,后面慢慢实现;SC8 不动
related:
  - 010-communication.md          # seam ③ 权威:能力插件 = MCP server
  - "[[protocol-research-summary]]"
  - "[[GOAL]]"
---

# CTRL 能力市场 — 架构方案

> bao 2026-06-22:「把研究整理出最好的方案、最佳架构、可执行的、与目标一致的,后面慢慢实现。」
> 一句话:**CTRL 能力市场 = 普通用户「发现 → 一键装 → 安全运行」第三方能力(每个能力 = 一个 MCP server),全程经 `:17873` gate 统一治理。** 这是 ADR-010 seam ③ 的实现架构;协议方向已锁(能力插件 = MCP server),本文是「怎么做成普通用户能安全用」的设计。
>
> **与目标对齐**:本方案服务「普通用户通用平台 + 能力市场」,**排在主目标 SC8(§14 接前端)之后**。不抢主线,作为后续可执行蓝图。

## 一、研究归档(MCP 接入这块,精炼)

**发现机制谱系**(博取众长):① 配置文件 + scope 分层(Claude Code,stdio)② `.well-known/mcp.json` HTTP 自动发现(SEP-1649,连接前拿 capabilities/transports/auth)③ `mcp://` URI + DNS TXT(IETF draft,前沿)④ 官方 MCP Registry(Anthropic+GitHub+Microsoft,**只存 metadata 不存代码**)。

**UX 谱系**:Claude Code = 纯配置(开发者向);**Cursor/Cline = visual marketplace + one-click**;VS Code = 首次 trust dialog;Cline = human-in-the-loop approval first-class。→ **普通用户要 Cursor/Cline 那种,不是 JSON。**

**安全风险**(OWASP MCP Top 10):token/secret 暴露、scope creep 提权、**tool poisoning**(CVE-2025-54136,恶意 metadata 藏指令)、供应链攻击、命令注入、intent 颠覆、auth 不足、缺审计、shadow MCP、context over-sharing。两个最致命:**tool poisoning** + **rug pull**(已批准 server 后改 tool 定义,WhatsApp MCP demo)。真实事件:postmark-mcp 后门、MCPoison(Cursor)、mcp-server-git CVE。

**业界缓解**:gateway defense(集中防线 contain blast radius)/ install+update 时扫描 + **hash-pin tool 定义改了 alert**(防 rug pull)/ OAuth 2.1+PKCE+token≤15min+细粒度 scope / 沙箱(容器不够,要 gVisor/Kata)/ 签名 + SBOM 验签。

## 二、CTRL 天生优势(为什么我们站对了架构)

研究最大发现:MCP 安全最佳实践要的,CTRL 大半已有 —— 这不是巧合,是 ADR-001/002 的地基对了。

| 业界要 | CTRL 现状 |
|---|---|
| Gateway defense | ✅ **`:17873` gate 本就是**(别人要专门搭) |
| 凭证不落 LLM | ✅ **keychain 已有** |
| 写操作审批 | ✅ **§14 读写分离 + produce 过 gate** |
| 减 exfiltration | ✅ **local-first**(数据不出本地) |
| MCP host 连接能力 | ✅ **mcp_host.rs**:register/connect/list_tools,4 source(Npm/Pypi/Local/Http)+ stdio/streamable-http,已连 Obsidian |
| install 扫描 / tool hash-pin / 验签 / 沙箱 | ❌ **缺这四块**(目标明确) |

## 三、最佳架构(4 层,我的方案)

```
  ┌─ 发现层 ── 能力市场(metadata 目录,对接官方 MCP Registry)
  │            + .well-known/mcp.json 自动发现 + plain-text 能力 manifest
  ├─ 接入层 ── one-click install + 验签(SBOM/signature) + 首次信任确认(trust dialog)
  ├─ 治理层 ── :17873 gate:hash-pin tool 定义(变更→冻结+重审,防 rug pull)
  │            + 细粒度 scope + 凭证走 keychain + produce 写操作审批(human-in-loop)
  └─ 运行层 ── 沙箱隔离:进程隔离起步 → WASM Component Model/Extism 强隔离(future)
```

**能力 manifest 设计**(plain-text,守 vim-test —— CTRL 比 Claude 的 JSON 更彻底):一个能力 = `MCP source`(npm/pypi/local/http)+ `权限 scope`(细粒度,如 `notes:read`)+ `UI surface`(可选,MCP Apps sandboxed-iframe)+ `signature/SBOM`。用户可手编可 git diff。

**核心设计原则**:
1. **gate 是唯一治理收口** —— 所有第三方能力调用过 gate,blast radius 被 contain。
2. **普通用户友好 = one-click + 自动安全**(扫描/验签/pin 用户无感,gate 替他守)。
3. **plain-text manifest + 本地是 truth** —— 能力定义本地可读可迁,无 lock-in。
4. **做 MCP 生态公民** —— 对接官方 Registry(发现)+ 暴露 well-known(被发现),非封闭花园(呼应「§14 不开源、做生态公民」结论)。

## 四、可执行落地路径(切片,排在 SC8 之后,慢慢实现)

| 切片 | 内容 | 复用 CTRL 现状 |
|---|---|---|
| **0** | 能力 manifest 格式(plain-text)+ gate 配置驱动发现(从硬编码 register → 用户可编辑配置 + scope 分层) | mcp_host.rs register/connect |
| **1** | install-time 扫描(tool 定义)+ 验签 + 首次信任确认 UI | gate + 前端 |
| **2** | gate **hash-pin tool 定义 + 变更冻结重审**(防 rug pull,最关键安全切片) | gate 审计层 |
| **3** | 凭证走 keychain + 细粒度 scope 模型 | keychain 已有 |
| **4** | produce 写操作 human-in-loop 审批 UI(§14 produce gate 接前端) | §14 已有 produce gate |
| **5** | 沙箱:进程隔离强化 →(future)WASM/Extism | ADR-010 future 档 |
| **6** | 能力市场 UI:one-click 浏览/装 + 对接官方 MCP Registry | 前端 + mcp_host |

> 顺序原则:先 manifest + 发现(0)→ 安全地基(1-2,rug pull 防护最优先)→ 凭证/审批(3-4,复用已有)→ 沙箱(5)→ 市场 UI(6,用户可见的最后一段)。每切片一 PR + 测试,走 dev-loop。

## 四点五、gate 待拍决策(★ 研究封板 → 下面是决策 + 实装,不再开研究旁支)

gate 的研究已**充分且全面**(gateway defense / OWASP MCP Top 10 / OAuth 2.1 / hash-pin / review gate / 审计 都研究透了)。gate 现状(`mcp_server.rs` 2238 行):MCP server + loopback ephemeral bearer token + 58 工具 + §14 四动词已落地 + cost gate;但治理面(review/audit/scope/rate-limit/hash-pin)**大半是 future 注释、未实装**。能力市场治理阶段开工前,只需拍这 4 个**架构决策**(非研究问题):

| # | 决策 | zeus 推荐 | 理由 |
|---|---|---|---|
| ① | **auth 模型** | 维持 ephemeral bearer(现状) | gate 是 local loopback,够用;OAuth 2.1 resource server 只在 gate 要被**远程/mesh** 访问时才需要——那是 mesh 阶段的事,现在上是过度工程 |
| ② | **review gate(produce 审批)** | ADR-006 §4 转实装:Cline 式 human-in-loop(提议→用户一键批准→执行),写操作默认过审 | §14 已有 produce gate 钩子,接 UI 即可;CTRL gate 天生是审批层 |
| ③ | **scope/permission 引擎** | 细粒度 scope(`notes:read`/`table:write`),能力 manifest 声明、安装时用户确认、gate 强制 | 防 confused deputy + scope creep;现状全有或全无不安全 |
| ④ | **hash-pin + audit 接线** | tool 定义 hash-pin 存进 §11 audit-ledger 同款 SQLite event store;变更→冻结+重审 | 复用已有 §11 audit-ledger,不另造;这是防 rug pull 最关键的一环 |

> 这 4 个拍完 → 直接写 **ADR-006 §4 实装** + 开发,**不需要再研究**。当前主目标 SC8 用不到这些(SC8 只用 gate 的 query 面,已就绪)。

## 五、与项目/目标一致(锚定)

- **权威**:ADR-010 seam ③(能力插件 = MCP server)。本文 = 其实现架构细则,不改协议方向。
- **排序**:**SC8(§14 接前端)是当前主目标,本方案在其后**。不抢主线。
- **不动的锁点**:spine 5 primitive、plain-text/vim-test、134 Tauri + 58 MCP 收敛不推倒、keychain secrets。
- **可深挖(未来,不阻塞)**:沙箱方案选型(WASM/Extism vs 进程隔离 vs gVisor)、能力 manifest 完整 schema、对接官方 Registry 的具体协议。

## 来源(deep-research 撞 session 上限后,单线 WebSearch 取证)

OWASP MCP Security Cheat Sheet · truefoundry(tool poisoning CVE-2025-54136 / gateway defense)· pipelab(State of MCP Security 2026)· systemprompt(OAuth 2.1)· modelcontextprotocol(authorization / SEP-1649 well-known / 官方 Registry)· Cursor·Cline·VS Code MCP docs · IETF draft-serra-mcp-discovery-uri
