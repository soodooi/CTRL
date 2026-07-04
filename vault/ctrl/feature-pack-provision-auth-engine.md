---
title: 功能包「一键装 + 静默认证」通用引擎 —— 声明式 provision + auth
kind: design
created_at: 2026-07-01
owner: bao
author: claude
purpose: bao 2026-07-01「一键安装不要多余步骤 / 安全静默实现 / 没有好的通用化方案吗 / 就按这个方向做」
serves: 功能包命题 = 把开源软件变 AI-native;让任意自托管连接器一键静默,零 per-pack 代码
governing_for: ADR-002 §7.2 provision amendment + manifest-schema.ts + kernel provision/auth runtime
related:
  - "[[ai-native-feature-pack-research.md]]"
  - "[[capability-pack-map.md]]"
  - 002-substrate.md   # §7 composition / §7.2 provision axis / §7.4 systematization
---

# 通用引擎:manifest 声明,runtime 通用跑

**铁律(ADR-002 §7.4)**:manifest = 数据,runtime = 通用,加一个 pack 零代码。把这条用到「provision(起服务)+ auth(拿凭证)」上 —— 每个自托管连接器只写 manifest,引擎只写一次。手填向导降级为**最后兜底**(既无 OAuth 又无 bootstrap 的已有远程实例)。

## 两个声明轴(加进 manifest-schema.ts)

### ① `provision.service` —— 把服务起起来
声明一个容器服务,通用引擎起它。字段:
```
provision.service:
  runtime: "compose"            # v1 只支持 docker/podman compose
  compose_inline: "<yaml>"      # 或 compose_ref 指向 pack 内文件
  generated_secrets: ["JWT_SECRET_KEY","ACCESS_TOKEN_SALT","POSTGRES_PASSWORD"]  # 引擎首次生成随机值 → 注入 env + 存 keychain(幂等)
  ready:                        # 起后轮询直到就绪
    url: "http://127.0.0.1:{port}/api/v1/health"
    timeout_s: 180
  ports: { app: 3333 }          # 引擎分配/记录,注入 {port} 模板
```
引擎:检查容器 runtime(有则用,无则走 provision.tools 装 / 引导)→ 渲染 compose(填 generated_secrets + ports)→ `compose up -d` → 轮询 ready → 记状态。幂等:已起则跳过。**适配任何 Docker 自托管 app**(Ghostfolio/Memos/Twenty)。

### ② `auth` —— 静默拿凭证
声明认证方式,引擎各有通用实现:
```
auth:
  kind: "oauth" | "bootstrap" | "token-exchange" | "manual"
```
- **oauth**:端侧 loopback OAuth(大平台)。引擎起 loopback callback,拿 token 存 keychain。零手填。
- **bootstrap**:provision 就绪后跑一次声明的 HTTP,**自动铸凭证并捕获**:
  ```
  auth.bootstrap:
    method: POST, path: /api/v1/user, body: {}
    capture: { pointer: "/accessToken", into_secret: "ghostfolio_token" }
  ```
  引擎跑一次 → 按 JSON pointer 抓值 → 存 `mcp:<id>:<into_secret>`。**全自动,零手填**(Ghostfolio 新实例正是这样拿 security token)。
- **token-exchange**:每次调用前用存的长期凭证换短期 bearer(已实现的 ghostfolio `auth/anonymous`,泛化):
  ```
  auth.token_exchange:
    path: /api/v1/auth/anonymous
    send_secret: "ghostfolio_token", as_body_field: "accessToken"
    capture_bearer: "/authToken"
  ```
  引擎在每个数据调用前 mint bearer(可缓存到过期)。
- **manual**(兜底):config_schema 手填向导(已建 `PackConfigModal`)。仅当上面都不适用。

## 通用安装流(一键 = 引擎串起来)
用户点「装」→ 引擎:
1. `provision.service` 有 → 起容器栈 + 等 ready(生成密钥静默存);
2. `auth.bootstrap` 有 → 跑一次抓凭证存 keychain;（`oauth` → 跑 loopback；都无且 `manual` → 才弹向导）
3. 完成。**零多余步骤**。之后 §14 gate 工具(ghostfolio_describe/query/produce)照常,`token-exchange` 每调用 mint bearer,creds/secret 全 kernel 侧、永不进 LLM。

## Ghostfolio 变成纯数据(第一个验证)
现 manifest 手填 url+token → 改成:`provision.service`(app+PG+Redis compose,生成 JWT_SECRET_KEY/ACCESS_TOKEN_SALT/PG 密码)+ `auth.bootstrap`(POST /api/v1/user 抓 accessToken)+ `auth.token_exchange`(auth/anonymous)。**引擎跑,Ghostfolio 零代码**。Memos/Twenty 后续同法只写 manifest。

## 复用的砖(不重造)
credential_vault(存 secret)· 现有 provision 轴(tools 装 runtime)· OAuth loopback(端侧)· ghostfolio auth-exchange(已实现→泛化成 token-exchange)· §14 + gate(已有)。新写的只有:compose 引擎 + bootstrap 执行器 + 声明轴的 Zod + 通用安装编排。

## 差异化(研究印证)
Smithery 等是**托管**帮管 auth/session(云);CTRL = **local-first 声明式自跑**,服务+数据+凭证全在用户机器,CTRL 只当引擎。整条 discovery→provision→silent-auth→§14→gate 无人统一 = 白地。

## 构建顺序
1. **schema 声明轴**(manifest-schema.ts:`provision.service` + `auth`)+ ghostfolio manifest 数据化 + Zod vitest(本步:foundation,可测)。
2. **kernel 通用 runtime**:compose provision 引擎 + bootstrap 执行器 + token-exchange 泛化 + 安装编排(重,Docker orchestration,下一步)。
3. ADR-002 §7.2 amendment 对齐。诚实 gap:真机跑 Docker 栈 = bao 机器(需 Docker),CTRL 侧 compose 渲染/bootstrap/exchange 由 mock e2e 验。
