# CTRL Cloudflare Setup — Fill-in Sheet

> Per `feedback_document_setup_flows`: setup 先写 doc / 列字段, bao 填, zeus 不让 bao 现场试 command.
>
> 新 CF account = **CTRL 独立** (per 2026-05-22 session 共识: CTRL / mamamiya / olym-platform 各自 account).

---

## How to use

1. bao 把下面 `____` 替换成实际值 (Section 1-5 必填, Section 6 选填)
2. 填完留言 "CF setup OK" → zeus 读 + 验证 + 开始 deploy worker
3. **敏感字段 (API token)** 不写本文件, 走 macOS keychain (Section 2 列命令)

---

## Section 1 · Account identity (必填)

| Field | Value | Note |
|---|---|---|
| `account_id` | `____________________` | dashboard.cloudflare.com 右上角 "Account ID" |
| `account_email` | `____________________` | 登录邮箱 |
| Workers subdomain | `__________.workers.dev` | 任意 deploy 一个 worker 后看, 暂可留空 |

---

## Section 2 · API token (必填, 但不写本文件 — 存 keychain)

### 生成步骤

1. dashboard.cloudflare.com → 右上角头像 → **My Profile** → **API Tokens** → **Create Token** → **Custom Token**
2. 勾选以下权限 (全部勾, 一次到位):

**Account permissions**:
- ☐ Workers Scripts · Edit
- ☐ Cloudflare Pages · Edit
- ☐ D1 · Edit
- ☐ Workers KV Storage · Edit
- ☐ Workers R2 Storage · Edit
- ☐ Account Settings · Read

**Zone permissions** (Resources: All zones):
- ☐ DNS · Edit
- ☐ Zone · Read
- ☐ Workers Routes · Edit

3. **Token TTL**: 1 year (推荐) 或 永久
4. Continue → Create → **复制 token (只显示一次, 离开页面就看不到了)**
5. 存 keychain:

```bash
security add-generic-password \
  -s ctrl-cf-api-token-v2 \
  -a "$USER" \
  -w "PASTE_TOKEN_HERE" \
  -U
```

(zeus 读取: `security find-generic-password -s ctrl-cf-api-token-v2 -a "$USER" -w`)

> 旧 token `ctrl-cf-api-token` (per memory `reference_cf_api_token`) 是上一个 CF account 的, **不能复用**. 新 account 用 `-v2` 后缀区分.

---

## Section 3 · Domains (必填)

| Domain | 在新 CF DNS? | Registrar (如果不在 CF) |
|---|---|---|
| `ctrl.run` | ☐ Yes / ☐ No / ☐ 还没买 | `__________` |
| `ctrlapplab.com` | ☐ Yes / ☐ No | `__________` |
| 其他 CTRL 用的域名? | | |

> `ctrlapplab.com` 之前 Apollo 在旧 account 部署的 (per `decision_marketing_stack_astro`). 如果你已 transfer 到新 account → ☐ Yes; 如果还在旧 account → ☐ No, zeus 需要先 transfer.

---

## Section 4 · Plan status (必填)

| Service | Status |
|---|---|
| Workers Paid plan ($5/month, unlock D1/R2/cron) | ☐ Already on / ☐ Not yet |
| 其他付费 add-on (WAF Pro / Bot Mgmt) | ☐ None (推荐 v1) / ☐ ____________ |

> v1 只需 Workers Paid ($5/month). D1 / KV / R2 free tier 含, 不另买.

---

## Section 5 · 现有资源 inventory (必填 — 让 zeus 知道哪些不能 over-write)

新 account 已建什么? **如果完全空白填 "none"**.

### Workers
| Name | URL | 保留? |
|---|---|---|
| `__________` | `__________.workers.dev` | ☐ Yes / ☐ No |
| | | |
| (没建过填 "none") | | |

### D1 databases / KV namespaces / R2 buckets / Pages projects
> 同样列出, 没建填 "none":

```
D1:    __________________________________________
KV:    __________________________________________
R2:    __________________________________________
Pages: __________________________________________
```

---

## Section 6 · 子域名预留确认 (选填, zeus 默认建议)

zeus 计划在 `ctrl.run` 下用以下子域:

| Subdomain | 用途 | 你 OK? |
|---|---|---|
| `app.ctrl.run` | PWA prod (用户登录入口) | ☐ OK / ☐ 改名 ____________ |
| `api.ctrl.run` | API entry (billing / market / llm-proxy) | ☐ OK / ☐ 改名 ____________ |
| `relay.ctrl.run` | mesh NAT 穿透 (ADR-003) | ☐ OK / ☐ 改名 ____________ |
| `updates.ctrl.run` | Tauri auto-update 渠道 | ☐ OK / ☐ 改名 ____________ |
| `push.ctrl.run` | 移动 push (post-launch, defer) | ☐ OK / ☐ 改名 ____________ |

留空 = 全 OK.

---

## Section 7 · zeus 计划部署清单 (FYI, 你不用填)

填完上面 1-5, zeus 会按以下顺序 deploy:

| # | Resource | 用途 | Priority |
|---|---|---|---|
| 1 | `ctrl-billing` worker | 用户订阅 + Volc/OpenAI wholesale 结算 (商业飞轮基础) | P0 |
| 2 | `ctrl-market` worker | keycap 公共仓库 + 创作者分发 | P0 |
| 3 | `ctrl-relay` worker | mesh NAT 穿透兜底 | P1 |
| 4 | `app.ctrl.run` Pages | PWA prod build | P0 |
| 5 | `ctrlapplab.com` Pages | marketing (Apollo) — transfer or redeploy | P0 |
| 6 | `ctrl-llm-proxy` worker | platform mode token proxy (国内 BYOK 直连 Volc, 不经此) | P1 |
| 7 | `ctrl-push` worker | 移动 push | P2 (defer to post-launch) |

---

## Secrets (后续 wrangler 注入, 现在不填)

下列 secret 等 worker 建好后用 `wrangler secret put` 注入, **不写本文件**:

- `VOLC_ARK_API_KEY` (CTRL wholesale)
- `OPENAI_API_KEY` (可选)
- `ANTHROPIC_API_KEY` (可选)
- `STRIPE_API_KEY` + `STRIPE_WEBHOOK_SECRET` (billing)
- `TURN_USERNAME` + `TURN_CREDENTIAL` (relay fallback)

zeus 上每个 worker 时单独问 bao 填.

---

## 填完后

留言 "CF setup OK" → zeus:
1. 读本文件
2. 验证 API token (`wrangler whoami`)
3. 检查现有资源 inventory 不冲突
4. 开始 deploy 第一个 worker (`ctrl-billing`)
