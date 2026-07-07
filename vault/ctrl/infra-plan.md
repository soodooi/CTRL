---
title: CTRL 云侧基建规划 — 包管理 / 反馈 / 分享 / CN 出口
type: infra-plan
status: governing (draft, bao 2026-07-07 拍「落 vault + ADR」)
owner: bao
related: [ADR-002 §provider, ADR-002 §composition §7.4, ADR-002 §crypto(mesh)]
viz: doc/design/ctrl-infra-plan.html
---

# CTRL 云侧基建规划

> 结论先行:**功能包管理 / 反馈 / 分享 绝大部分留 Cloudflare(已有栈,边缘,R2 出口免费,scale-to-zero);AWS 只需 1 台小机做「中国可达出口代理」——CF Workers 地理够不到 CN 金融站的那个洞。** 可视化 = `doc/design/ctrl-infra-plan.html`。

## 决策 (bao 2026-07-07)

反射性上 AWS 做后端 = industry-default 陷阱(memory `feedback-jump-to-industry-default-not-ctrl-moat`),会 fork 掉已有 CF 栈、失去 R2 免费出口、还要管服务器。对「端侧优先、云是 augmentation 不是 dependency」的 CTRL,**云侧越薄越对**。所以:

- **留 Cloudflare(Workers + D1 + R2)**:包注册表/搜索、包分发、反馈收集、分享 HTML/产物、以及已在跑的 auth/billing/market/relay/push。
- **只上 AWS 一处**:CN 数据出口代理(1× Lightsail nano)。

## 逐组件 → 平台 → 成本(定价核对 2026-07)

| 能力 | 组件 | 平台 | 成本(起步) |
|---|---|---|---|
| 功能包注册表 / 搜索(Discover 后端) | Registry Worker + D1 | Cloudflare | 免费档内 |
| 功能包分发(manifest + 打包服务代码/资产) | R2 对象存储 | Cloudflare | $0.015/GB·月;**出口 $0** |
| 反馈收集(截图+日志+审计轨迹 → 开 Issue) | Feedback Worker + R2 + D1 + GitHub API | Cloudflare | 免费档内 |
| 分享 HTML / 产物(短链,私有默认) | R2 + Worker | Cloudflare | 近乎 $0;**出口 $0** |
| **中国数据出口** | Lightsail nano + 薄代理 | **AWS** | **$5/月** |
| auth / billing / relay / push | Workers + D1 + Stripe | Cloudflare | 已在跑 |

关键定价事实:
- **R2 出口(egress)免费** vs S3+CloudFront 出口收费(1TB≈$90/月)→ 分发 + 分享放 R2 几乎零成本。
- Workers 100K req/日、D1 5GB/5M 读日、R2 10GB + 1M/10M ops 免费档 → 起步基本免费。
- **AWS EC2 出口贵**(1TB≈$90);要用就用 **Lightsail nano $5/月(含 1TB 流量)**,别用 EC2。

## 你要的 AWS 服务器 = 一台

- **规格**:Lightsail nano · 512MB / 2 vCPU / 20GB SSD · 含 1TB 流量
- **区域**:东京 `ap-northeast-1`(或香港,看哪个真通 CN)
- **价格**:$5/月(IPv4)· 或 $3.5/月(仅 IPv6)
- **跑什么**:token 鉴权的薄 HTTP 代理,白名单只转发 CN 金融 host(`qt.gtimg.cn` / 东财 `push2his`)
- **为什么 Lightsail 不用 EC2**:EC2 出口 1TB≈$90;Lightsail 打包 1TB 进 $5
- **诚实缺口**:东京/香港到大陆金融站的可达性是经验问题,**先拿一台真机 probe** `qt.gtimg.cn`/`push2his` 通不通再定区域,不猜。全球可达的价量+指标层(Yahoo/EODHD)已通,这台只补「换手/资金流/龙虎榜」那层深数据。

## 用户分享 HTML / 产物(bao「用户能直接分享 html 或其他」)

机制 = R2 + Worker,跟 CTRL 发 artifact 链接同理,R2 出口免费 = 分享再多不烧钱:
1. 本机产出(报告/面板/包介绍 = HTML 或 markdown)—— 数据始终在 vault。
2. 点「分享」→ 上传 R2,Worker 发**短链**。
3. **私有默认**:链接带不可猜 token;可加口令/有效期/随时撤销。
4. 对方打开即看,**无需装 CTRL、无需账号**——符合「无账号系统」。

## 反馈收集(截图 + 问题)—— 薄且尊重主权

最佳实践(调研共识):常驻不打扰入口 · 自动带上下文(截图+OS+日志)· **只收够做决策的信息不做监控档案** · opt-in、发送前审阅。CTRL 硬约束(本地优先/无账号)→ **不挂 always-on 云 SDK**,做显式 opt-in + 审阅门版本。

- **触发**:常驻「报告问题」入口,一次用户主动动作,绝不后台传。
- **自动附**:Tauri 抓 webview 截图 · kernel 日志尾部 · **★ gate 审计轨迹(`event-store.db` 的 `audit_calls`)= 反馈真相源**(Irisy 叙述会撒谎、账本不会;复用现成基建,memory `reference-read-audit-ledger-not-guess-irisy`)· app 版本+OS。
- **审阅门**(transparency by drill-down):发送前用户可看/删敏感内容。
- **传输**:ctrl-cloud 加薄 `feedback` Worker → 落 D1 或自动开 GitHub Issue;匿名轮换 id、无登录。无云降级为「生成预填 GitHub Issue 链接,浏览器打开」。
- **崩溃单独路**:opt-in panic-hook → 本地 crash 文件 → 下次启动提示发送,绝不静默上报。

工具对标(参考不照搬):崩溃→Sentry(可自托管);截图标注 UX→Instabug/Shake;截图→issue→Marker.io/Userback;需求板→Canny/Featurebase;dev→GitHub Issue Forms。对 CTRL 自建薄 opt-in reporter 比接 SaaS 更贴哲学。

## 落 ADR 的映射

- **注册表/分发** = ADR-002 §composition §7.4(已提「Discover registry-pull」,此文补后端拓扑 = R2+Worker+D1)。
- **CN 出口代理** = ADR-002 §provider(数据/provider 可达性;端侧优先框架)。
- **relay/push/分享短链** = ADR-002 §crypto(mesh)+ 云 Worker 既有栈。
- 锁点不动:本地是 truth / 无账号 / secret 不进 LLM / 端侧优先 / 云是 augmentation。

## 下一步候选(片)

包注册表/分发 · 分享(R2 短链) · 反馈(截图+审计轨迹+审阅门+feedback Worker) · CN 出口代理(先真机 probe 可达性再开机器)。
