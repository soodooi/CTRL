# Open-source business model — CTRL OSS strategy

**Date**: 2026-06-02
**Trigger**: bao "如果这个项目开源, 还有商业价值吗?" → "好, 按照这个方案写一下商业模式"
**Status**: research + draft, awaiting bao decision on scope + license

---

## TL;DR

CTRL 开源不仅没死, 反而**比闭源更匹配**自身哲学 (augmentation / 无 lock-in / plain-text / 数据本地), 闭源反而矛盾。

商业模型从 "卖软件" → "卖 cloud + marketplace + enterprise" 三条腿走路, 标准 **open-core + cloud-hosted hybrid**, 跟 Supabase / Sentry / GitLab 同路线。

\**5 年粗算 ARR \~$10M** (Obsidian 量级), 3 年 $1M (validation), 1 年 $30-50k (起步 freemium 转化率验证)。

**license 建议**: **Apache 2.0** (核心代码) + **商标 "CTRL" 保护** + **闭源 ctrl-cloud / marketplace / enterprise 三个 repo** + **保留高级 keycap 自营权**。

**关键 risk 3 个**: fork → 商标 + cadence; augmentation 反向打自己 → cloud 做到"省事"不只是"兜底"; 鸡生蛋 → launch 策略要打满。

---

## 1 为什么开源跟 CTRL 哲学正向耦合

| CTRL 已锁哲学                   | 闭源张力                                | 开源契合                       |
| --------------------------- | ----------------------------------- | -------------------------- |
| augmentation, 不是 dependency | "你的工具但代码我不给你看" — 张力                 | 工具完全交给用户, 哲学闭环             |
| 数据本地, 云是 mirror             | "本地数据但 client 是黑盒" — 矛盾             | 用户可 audit 数据流, 信任成本归零      |
| 无 lock-in, 无账号              | "无 lock-in 但你只能用我家 build" — 张力      | 自托管 / fork / 自编译路径全开       |
| plain-text vault            | "plain-text 但 client 是 binary" — 张力 | client 源码也 plain-text 可读   |
| 创作者 substrate, 平台抽成         | 闭源平台收抽成 → 创作者怀疑黑箱                   | 开源平台抽成 → 抽成机制可 audit, 创作者信 |
| vim test (用户用 vim 还能拿到核心价值) | client 闭源 = vim test 通过但工具死         | 一致                         |
| Pi 是 brain (Pi 自己 MIT)      | CTRL 闭源 + Pi 开源 = 哲学错位              | Pi MIT + CTRL Apache = 同一栈 |
| VMark stack 全开源             | CTRL 用全开源 stack 反过来闭源 = 不对称         | 对称                         |

**结论**: CTRL 闭源每一条都跟自己哲学打架。开源不是商业妥协, 是哲学完成。

---

## 2 类比标杆 — 已验证的开源商业模型

### 2.1 直接可类比 (同赛道 / 同模式)

| 项目                  | 模式                                              | License    | 收入                                | 关键经验                                                    |
| ------------------- | ----------------------------------------------- | ---------- | --------------------------------- | ------------------------------------------------------- |
| **Obsidian** (闭源参考) | Freeware + Sync/Publish 订阅 + Commercial license | 闭源         | 估 8 位数美元 ARR (\~$15-30M)         | sync $8/mo + publish $20/mo + commercial $50/yr/seat |
| **Raycast** (闭源参考)  | Freemium + Pro + Team                           | 闭源         | 估值 $500M+ (2024), ARR 估 $20-40M | Pro $10/mo, AI in Pro tier, team $12/seat             |
| **Supabase**        | Open core (Apache) + Cloud                      | Apache 2.0 | ARR $80M+ (2024)                 | 自托管免费, cloud $25/mo 起, enterprise 自定义                  |
| **Cal.com**         | Open core (AGPL) + Cloud + Enterprise           | AGPL       | ARR $15M+ (2024)                 | AGPL 防云大厂; commercial license 卖给企业                      |
| **Plausible**       | Open source (AGPL) + Cloud                      | AGPL       | ARR $3M+ (2024)                  | 自托管完全免费; cloud 主收入 (toil arb)                           |
| **Sentry**          | BUSL → Apache (4yr) + Cloud                     | BUSL       | ARR $200M+                       | 防云大厂抄, 4 年后转 Apache                                     |

### 2.2 反面教材 (开源但没钱)

| 项目               | 模式                | 现状                      | 教训                                                      |
| ---------------- | ----------------- | ----------------------- | ------------------------------------------------------- |
| **Cline**        | 纯 MIT, 无商业实体      | 30k+ stars, $0 ARR     | 没有 cloud / marketplace / enterprise, 只剩 GitHub donation |
| **Continue.dev** | 早期纯开源, 2024 pivot | 最近加 Continue Hub 商业平台救场 | 纯开源不可持续, 必须叠商业层                                         |
| **Logseq**       | AGPL, Sync 闭源     | Sync 订阅勉强养团队            | 单产品线脆弱, 没 marketplace                                   |
| **Joplin**       | MIT, Cloud 订阅     | 小规模年收入                  | 没有创作者经济, 增长慢                                            |

### 2.3 Hybrid 经典案例 — VSCode

- VSCode core: MIT 开源
- GitHub Codespaces / Copilot: 闭源, MSFT 收订阅
- Marketplace: 开源协议但 publishing 走 MSFT 闭源后端

**CTRL 直接对标这条路**: client + kernel + keycap-sdk **开源 Apache**; cloud + marketplace + enterprise **闭源 separate repo**。

---

## 3 三条商业收入线 (CTRL 适配)

### 3.1 收入线 A — CTRL Cloud Subscription (主腿)

**定价**: $8/mo personal, $0 free tier (限 quota)
**类比**: Obsidian Sync ($8) / Raycast Pro ($10) / Cursor Pro ($20)

**Cloud 卖什么** (闭源 ctrl-cloud Worker):

1. **CF Workers AI quota 兜底** — 用户不想配 BYOK / 想要稳定 fallback (ADR-002 § provider v2 已锁 irisy.fallback)
2. **ctrl-relay mesh 中转** (ADR-002 § crypto v1, v1.1+ 范围) — P2P 跨设备 STUN/TURN, 自托管也可但麻烦
3. **vault 云镜像** — 本地 truth + 云 mirror (ADR 锁), 跨设备 sync / 灾备
4. **OAuth broker 代理** — 飞书 / Notion 等第三方 OAuth callback 中转 (用户不想自起 loopback)
5. **Pi token 兜底** — 用户 BYOK 没填时, 用 CTRL CF Workers AI quota 不中断

**为什么用户付** (在 augmentation 哲学下):

- "我可以自己跑 (Ollama + BYOK + 自托管 relay), 但不想折腾"
- "我多设备需要 sync, 自己搭 relay 太麻烦"
- "我不想配 OpenAI key 充值, 用 CTRL 月费图省事"

**抵御 "用户太容易自己跑就不付钱" 的设计**:

- Cloud quota 要"明显省事"而不是"刚好兜底" — quota 给到无感的水平 (类比 Obsidian Sync 速度远好于自搭 git sync)
- mesh relay 要无配置工作 — 自托管要折腾 STUN/TURN, cloud 即开即用
- 不锁数据 (本地仍 truth), 但锁体验 (cloud 路径就是顺)

**5 年数学** (粗算):

| Year                         | 周活用户 | Cloud 转化率          | Paid users | ARPU/yr         | Cloud ARR |
| ---------------------------- | ---- | ------------------ | ---------- | --------------- | --------- |
| Y1 (ship + open source)      | 10k  | 3% (validation)    | 300        | $96            | $29k     |
| Y2 (marketplace launch)      | 50k  | 5%                 | 2500       | $96            | $240k    |
| Y3 (mesh + enterprise pilot) | 200k | 5%                 | 10k        | $108 (mix Pro) | $1.08M   |
| Y4                           | 500k | 6%                 | 30k        | $120           | $3.6M    |
| Y5                           | 1M   | 7% (Obsidian rate) | 70k        | $130           | $9.1M    |

类比 sanity check: Obsidian 2M+ MAU × 5% × $96/yr ≈ $10M (估算落在公开报道 8 位数区间)。

### 3.2 收入线 B — Creator Marketplace 抽成

**模型**: 创作者 publish keycap, 平台抽 GMV 20% (Apple 30% / Steam 30% / WordPress 0% / Obsidian 0%, Substack 10%, Gumroad 10%)
**定价**: 平台抽 20%, 创作者保留 80%
**类比**: Apple App Store / Roam Research / Substack / Gumroad / Webflow Marketplace

**关键洞察**: **开源 CTRL 反而 unlock marketplace, 闭源会卡死**

- 创作者要把作品交给平台 → 平台抽成机制必须可 audit
- 闭源平台 = 创作者"被吃 GMV 不知情" → 大创作者不进
- 开源平台 = "我能看你怎么抽" → 创作者放心 publish
- 同样: VSCode 开源 + extension 市场起得来; Sketch 闭源 + plugin 市场半死

**Marketplace SKU 设计**:

| SKU 类型                 | 单价               | 平台抽成 | 类比                        |
| ---------------------- | ---------------- | ---- | ------------------------- |
| 免费 keycap (大部分)        | $0              | $0  | npm package               |
| 付费 one-time keycap     | $1-9.99         | 20%  | App Store 简单 utility      |
| 付费 subscription keycap | $1-4.99/mo      | 20%  | 复杂 keycap (需后端)           |
| Creator Pro 套件         | $9.99/mo bundle | 20%  | Setapp style 订阅打包         |
| Tip jar (买咖啡)          | 任意               | 5%   | Patreon / Buy Me a Coffee |

**5 年 marketplace 数学**:

| Year | Active creators  | Avg GMV/creator/yr | Total GMV | 平台 20% 抽成 |
| ---- | ---------------- | ------------------ | --------- | --------- |
| Y1   | 50 (early seed)  | $200              | $10k     | $2k      |
| Y2   | 500              | $400              | $200k    | $40k     |
| Y3   | 2000             | $600              | $1.2M    | $240k    |
| Y4   | 5000             | $800              | $4M      | $800k    |
| Y5   | 10000 (0.1% MAU) | $1000             | $10M     | $2M      |

类比 sanity check: VSCode marketplace \~50k extensions, 但付费率 <1% → CTRL keycap 估付费率 5-10% (跟 Raycast / Obsidian community plugin paid 同量级)。

### 3.3 收入线 C — Enterprise (B2B)

**模型**: 团队 license + 私有 keycap 库 + SSO + 审计 + on-prem CTRL Cloud
**定价**: $30/seat/mo Team, Enterprise 自定义 ($50-100/seat/mo)
**类比**: GitLab Premium $29 / Linear Plus $14 / Notion Business $18 / Supabase Team $599

**Enterprise 必杀技** (开源后 audit 顺):

- on-prem CTRL Cloud (CF Workers self-host 或 docker compose)
- SSO (SAML / OIDC, 走 Auth0 / Okta)
- 审计日志 (谁运行了哪个 keycap, 接 SIEM)
- 私有 keycap 库 (内部工具不能 publish 公开 marketplace)
- 团队 vault sync (跨成员的 plain-text vault)
- SLA support (24h response, dedicated success engineer)
- 商用 license (闭源 fork CTRL 商业产品要单独谈)

**为什么 B2B 比 personal 更挣**: 单 seat 价高, churn 低, 决策周期长但合同大, 合规需求是刚需 (个人不在意 audit log, 企业必装)。

**5 年 enterprise 数学**:

| Year | Team 数              | Avg seats | Avg ARR/team | Enterprise ARR |
| ---- | ------------------- | --------- | ------------ | -------------- |
| Y1   | 0 (focus PMF)       | -         | -            | $0            |
| Y2   | 10 (design partner) | 10        | $3600       | $36k          |
| Y3   | 50                  | 12        | $4500       | $225k         |
| Y4   | 200                 | 15        | $5400       | $1.08M        |
| Y5   | 500                 | 20        | $7200       | $3.6M         |

### 3.4 三线汇总 + 5 年 ARR

| Year           | Cloud   | Marketplace | Enterprise | **Total ARR** | 备注                  |
| -------------- | ------- | ----------- | ---------- | ------------- | ------------------- |
| Y1 (2026 ship) | $29k   | $2k        | $0        | **\~$31k**   | OSS launch + PMF 验证 |
| Y2 (2027)      | $240k  | $40k       | $36k      | **\~$316k**  | marketplace + 设计伙伴  |
| Y3 (2028)      | $1.08M | $240k      | $225k     | **\~$1.55M** | enterprise pilot 起  |
| Y4 (2029)      | $3.6M  | $800k      | $1.08M    | **\~$5.5M**  | 三线齐飞                |
| Y5 (2030)      | $9.1M  | $2M        | $3.6M     | **\~$14.7M** | Obsidian 量级         |

**对照 baseline**: 闭源 + 仅 Pattern D 订阅, 5 年估 $3-5M ARR (单腿走路, 没创作者经济, 企业不进)。**开源 hybrid 模式 ≈ 闭源 3 倍 ARR**, 且 multi-leg 抗风险。

---

## 4 License 选择 — 4 个候选 + 推荐

| License                 | 宽松度               | 防大厂抄                    | 企业接受度     | OSI 认可                   | CTRL 适配        |
| ----------------------- | ----------------- | ----------------------- | --------- | ------------------------ | -------------- |
| **MIT**                 | 最宽松               | 最弱 (Mongo / Elastic 教训) | 最高        | ✓                        | ★★☆ 太宽松, 大厂可白嫖 |
| **Apache 2.0**          | 宽松 + patent grant | 中 (有 patent 防御)         | 最高        | ✓                        | ★★★★★ 主推       |
| **AGPL v3**             | 强制开源衍生            | 强 (云大厂怕)                | 中 (企业法务怕) | ✓                        | ★★★ 企业版会受阻     |
| **BUSL** (4yr → Apache) | 限商用 4 年           | 最强                      | 低-中       | ✗ (Sentry / HashiCorp 用) | ★★★ 防御性强但社区怕   |

**推荐: Apache 2.0** 主代码 + **商标 "CTRL" 保护** + **separate 闭源 repo** for cloud/marketplace/enterprise + **dedicated commercial license** for 商业 fork。

理由:

- Apache 2.0 = 业界最被信任 (Kubernetes / Android / TensorFlow / Supabase 都用)
- patent grant 比 MIT 强 (防专利讹诈)
- 企业法务 0 障碍 (AGPL 进企业要专门 review)
- 商业护城河靠商标 + 闭源 ctrl-cloud + cadence, 不靠 license 苦修
- AGPL 防云大厂的能力 CTRL 不需要 (我们不是数据库 SaaS, 没有"用户托管 = 大厂套利"风险)

**商标策略**:

- "CTRL" / "CTRL App" / logo 注册商标 (US + EU + 中国)
- fork 可以, 改名 "MyTool" 可以, **改名仍叫 CTRL = 商标侵权**
- 类比: Elastic / Mongo 商业模型主要靠商标而不是 license

**License 配置**:

```
soodooi/CTRL                    Apache 2.0 (this repo, after open source)
soodooi/ctrl-cloud              UNLICENSED (闭源, CF Workers backend)
soodooi/ctrl-marketplace        UNLICENSED (闭源, market backend + 抽成机制)
soodooi/ctrl-enterprise         Commercial License (闭源, SSO/审计/on-prem)
@ctrl/keycap-sdk (npm)          Apache 2.0 (创作者写 keycap 用)
@ctrl/kernel-sdk (npm)          Apache 2.0 (高级用户/集成方用)
soodooi/ctrl-keycaps-builtin    Apache 2.0 (top 15 keycap 源码示范)
soodooi/ctrl-keycaps-premium    Commercial (CTRL 自营 premium keycap, 可选)
```

---

## 5 开源 vs 闭源分界线 — 具体到 repo + 文件

### 5.1 开源 (Apache 2.0) — 进 `soodooi/CTRL` (this repo) 不动

- `src-tauri/` — Tauri 2 shell + Rust kernel (5 primitives + provider router + vault + MCP bus)
- `packages/ctrl-web/` — PWA (React + Vite + Tiptap + CodeMirror 6)
- `packages/ctrl-stss/` — ST-SS protocol
- `packages/ctrl-memory/` — client event log
- `packages/ctrl-kernel-sdk/` — L2 syscall TS surface
- `packages/ctrl-keycap-sdk/` — keycap manifest schema + validation
- `packages/ctrl-pi-bridge/` + `packages/ctrl-pi-plugin/` — Pi extension (本身就 MIT 上游)
- `packages/ctrl-keycaps/` (top 15 v1 builtin) — Apache 示范
- `.olym/` framework — 已经开源 hello-olym (类比已有)
- `share/stss-spike/` — reference impl
- `doc/` — 大部分可开源

### 5.2 闭源 — 拆 separate repo

| 闭源 repo                        | 内容                                                                                  | 商业角色                        |
| ------------------------------ | ----------------------------------------------------------------------------------- | --------------------------- |
| `soodooi/ctrl-cloud`           | CF Workers backend: ctrl-auth / ctrl-billing / ctrl-market / ctrl-relay / ctrl-push | 订阅 quota + relay + sync 核心  |
| `soodooi/ctrl-marketplace`     | Marketplace 后端 + Stripe Connect 创作者收款 + 抽成结算 + 审核                                   | 创作者经济抽成                     |
| `soodooi/ctrl-enterprise`      | SSO / SAML / 审计 / on-prem 部署器 / 私有 keycap 库                                         | B2B 主腿                      |
| `soodooi/ctrl-keycaps-premium` | CTRL 自营高级 keycap (可选, 不强推)                                                          | Setapp 类 first-party bundle |
| `soodooi/ctrl-cli-binary`      | release 编译 + signing + notarization + auto-updater 私钥                               | distribution control        |

`soodooi/CTRL` 仓库本身 fully open。`ctrl-cloud` URL endpoint 是闭源 backend, 但 client 调 endpoint 的代码开源 (URL 写死 `cloud.ctrl.app` 但任何人可改成自己的 self-hosted 实例)。

### 5.3 哪些"中间件"必须留给商业线

| 功能                      | 开源?      | 闭源?                        | 理由                   |
| ----------------------- | -------- | -------------------------- | -------------------- |
| Tauri auto-updater 签名公钥 | 公钥开源     | 私钥闭源                       | distribution control |
| Marketplace 审核策略        | 政策文档开源   | 审核 backend 闭源              | 防绕过                  |
| Cloud quota 限流逻辑        | 开源 (SDK) | 限流策略闭源 (server)            | 防套利                  |
| Mesh relay STUN/TURN    | 协议开源     | endpoint 闭源                | 收带宽费                 |
| 创作者结算 (Stripe Connect)  | 接口开源     | Stripe key + 结算 backend 闭源 | 安全                   |

---

## 6 三大风险 + mitigation (详)

### Risk 1 — Fork 大厂抄走

**威胁**:

- 字节 / 阿里 / 腾讯 / Notion / Raycast / Cursor 把 CTRL fork 改名走商业化, 用资源碾压
- 类比: ElasticSearch 被 AWS fork 成 OpenSearch (Elastic 损失估 50% 用户), Mongo 被 AWS DocumentDB

**Mitigation**:

1. **商标 "CTRL"** — fork 不能用名字 (Elastic 用此条款救回部分市场)
2. **Cloud / Marketplace 闭源** — fork 拿不到收入 backend, 商业化要从零搭
3. **Release cadence** — 自己 ship 比 fork 快 (Linear / Raycast 模式)
4. **创作者生态先发** — creators 黏在 CTRL marketplace, fork 拉不走 (类比 VSCode marketplace 锁住 extension 生态)
5. **品牌 + 哲学** — augmentation / plain-text 故事大厂学不来, 公司基因不同 (类比 Obsidian vs Notion)

**残余风险**: 中等。CTRL 不是数据库 SaaS, 大厂套利动机弱; 但国内可能有人 fork 改名做"全英文换中文" → 商标 + cadence 应对。

### Risk 2 — Augmentation 哲学反向打自己

**威胁**:

- "augmentation 不是 dependency" → 用户可 100% 用 Ollama + BYOK + 自托管 relay → 永远不付钱
- Cloud 订阅价值被自己哲学稀释

**Mitigation**:

1. **Cloud 做到"明显省事"而非"刚好兜底"** — quota 给到无感水平, 速度 / 延迟 / 稳定性远超自搭
2. **打"省力税"而不是"功能税"** — 自搭可以, 但要花周末; 付 \$8 直接用
3. **Marketplace 锁定增值** — 付费 keycap 只能从 CTRL marketplace 装, 自托管不接 (这条不违反 augmentation, 因为 keycap 是 augmentation 上层)
4. **vault sync 卷"无配置"** — 自搭 Syncthing 可以, 但 CTRL Cloud sync 0 配置, 双设备开箱即同步
5. **Pricing 卡在"心理无痛"区** — \$8/mo = 1 杯咖啡, 远低于"自搭折腾时间成本"

**残余风险**: 中。Obsidian 同哲学也卖出 \$10M+ ARR, 证明此模型 work。但 CTRL 用户画像更技术, 自搭意愿可能更强 → 早期转化率假设要保守 (3% 不是 5%)。

### Risk 3 — 鸡生蛋 (创作者 / cloud 用户起不来)

**威胁**:

- 没创作者 → 没付费 keycap → marketplace 死
- 没 cloud 用户 → relay / sync 不规模化 → 体验差 → 更少人付费
- GitHub stars 起不来 → 没 community → 没创作者

**Mitigation**:

1. **Open source launch 制造话题** — HN 头条 + Product Hunt #1 + Twitter 创作者社群 + 联动 Obsidian / Raycast / Logseq / Pi (Mario Zechner) 社区
2. **早期创作者激励** — 头 100 个 keycap 创作者免抽成 1 年 + 官方 feature + free Cloud Pro 1 年
3. **CTRL 自营 premium keycap 兜住基础体验** — 头 15 个 v1 keycap CTRL 自营 + 高质量, 让用户先觉得"好用" 再有动力安装第三方
4. **Bao 个人品牌 + 开发日志** — Twitter / 小红书 / B 站 / 知乎 build in public, 制造跟随者
5. **集成 Pi 社区** — Pi 用户群天然是 CTRL 早期用户, MCP 标准本身就在推广

**残余风险**: 高。开源项目"建好了没人来"是常态, 需要 launch playbook + 持续运营投入。

---

## 7 开源时机 + Launch 策略

### 7.1 推荐时机: **v1 ship 同步开源** (而非先闭源 ship + 后转开源)

理由:

- v1 ship 本身是话题, 开源同步发 = 流量倍增
- 闭源 ship → 后转开源, 话题二次稀释, 且"为什么之前闭源"会被问
- v1 同步开源, "我们一开始就开源" 故事完整, 用户信任建立成本最低

但前提:

- **代码必须 ready** — 不开源垃圾 (没 README / 没注释 / 跑不起来 = 开源也是死)
- **运营 ready** — 至少 1 人 part-time 看 issue + 回 PR
- **商业 backend 必须 ready** — ctrl-cloud / marketplace 必须能跑, 否则开源后用户没付费路径

### 7.2 Launch 渠道 (按 ROI 排)

| 渠道                                                           | 触达                            | 转化率           | 难度                                          |
| ------------------------------------------------------------ | ----------------------------- | ------------- | ------------------------------------------- |
| **Hacker News 头条**                                           | 30-100k 触达, 高质量开发者            | 5-10% star    | 难 (随机, 但 augmentation/plain-text 故事 HN 群体爱) |
| **Product Hunt #1 of the day**                               | 10-30k 触达, mac power user     | 3-5% download | 中 (要预热 hunter network)                      |
| **Twitter 创作者社群**                                            | 1-5k engagement               | 10-20%        | 易 (build in public)                         |
| **Reddit r/ObsidianMD / r/Productivity / r/macapps**         | 5-20k                         | 5%            | 中                                           |
| **小红书 / B 站** (中国创作者市场)                                      | 不评估 v1 (global English first) | -             | - (defer 到 i18n)                            |
| **联动现有社区** (Pi / Mario / Obsidian Discord / Raycast Discord) | 5-50k                         | 10%           | 易 (cross-promotion)                         |
| **YouTube 创作者合作** (Linus Tech Tips 类)                        | 100k-1M                       | 1%            | 难/贵                                         |

### 7.3 Day 0 必备物料

1. **README.md** — 30 秒讲清楚 CTRL 是什么, 3 个 GIF 看到价值
2. **CONTRIBUTING.md** — keycap 创作者怎么入门
3. **官网** ctrlapplab.com — 主推 download + cloud subscription
4. **5-10 个 builtin keycap demo video** — 30 秒 each, Twitter 友好长度
5. **Apache 2.0 LICENSE + THIRD\_PARTY\_LICENSES** — license hygiene
6. **Discord** — community 实时支持
7. **5 个 design partner (B2B)** — 已签早期企业用户作为 case study

---

## 8 跟现有 CLAUDE.md / ADR 的冲突 + 修订

### 8.1 必改的 lock 点 (CLAUDE.md "## Rules")

| 当前规则                                                                     | 改成                                                                                                                                                     | 理由        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `License: All Rights Reserved. 所有子包 private: true + license: UNLICENSED` | `License: 主代码 Apache 2.0. ctrl-cloud / marketplace / enterprise 闭源 separate repo. 关键 npm 包 (@ctrl/keycap-sdk, @ctrl/kernel-sdk) Apache 2.0 published.` | 开源前提      |
| `禁止 npm publish 任何 @ctrl/* 包到公开 npm`                                     | `允许 publish @ctrl/keycap-sdk + @ctrl/kernel-sdk + @ctrl/stss; 禁止 publish @ctrl/cloud-* 闭源包`                                                            | 创作者生态需要   |
| `禁止 wrangler dev (走 staging)`                                            | 不变 (本来是安全, 跟开源无关)                                                                                                                                      | -         |
| `单 deliverable, 自包含`                                                     | 改: `主仓单 deliverable (开源), cloud/marketplace/enterprise 闭源 separate repo`                                                                               | 拆 repo 必然 |

### 8.2 新写 ADR

需要新建 **ADR-008 oss-model** (新增 module = 新 ADR, 符合 PROCESS.md):

```
adr_id: 008
module: oss-model
title: Open-source business model — Apache 2.0 core + closed cloud/marketplace/enterprise
sections:
  - license: Apache 2.0 主代码 + Commercial license enterprise + 商标保护
  - boundary: 开源 vs 闭源分界线 (repo + 文件级)
  - revenue: 三条收入线 (cloud / marketplace / enterprise)
  - launch: 开源时机 + 渠道 + Day 0 物料
  - risk: fork / augmentation 自打 / 鸡生蛋 + mitigation
```

### 8.3 不冲突 (无需改)

- augmentation / 数据本地 / plain-text / vim test → 全 0 冲突
- Pi 是 brain (MIT) → 开源 CTRL 反而对称
- VMark stack 全开源 → 同
- Pattern D LLM 路由 → 不变, 只是 cloud quota backend 闭源
- 创作者 substrate → 开源后反而起得来

---

## 9 决策清单 — bao 拍板项

| #  | 决策点               | 选项                                                                  | 我的推荐                                  |
| -- | ----------------- | ------------------------------------------------------------------- | ------------------------------------- |
| 1  | 开源?               | A. 闭源继续 / B. 开源 / C. 部分开源 (open core)                               | **B 全开源 + open core 商业**              |
| 2  | License           | A. MIT / B. Apache 2.0 / C. AGPL / D. BUSL                          | **B Apache 2.0**                      |
| 3  | 开源时机              | A. v1 ship 同步 / B. v1 闭源 ship 后转 / C. v1.5 / v2                     | **A v1 同步**                           |
| 4  | 商业线优先级            | A. Cloud 主 + 其他 backup / B. Cloud + Marketplace 并行 / C. 三线全推        | **A Y1, B Y2-3, C Y4+**               |
| 5  | 商标策略              | A. 不注册 / B. US 注册 / C. US+EU+CN                                     | **C US+EU+CN**                        |
| 6  | 自营 premium keycap | A. 全交创作者 / B. CTRL 自营 + 第三方混合                                       | **B 混合 (前 15 keycap CTRL 自营保质量)**     |
| 7  | 开源仓库 hosting      | A. 留 soodooi private 转 public / B. 转 ctrl-app org / C. 新 GitHub org | **B 转 ctrl-app org (品牌干净)**           |
| 8  | 早期创作者激励           | A. 不激励 / B. 头 100 创作者免抽成 1 年 / C. 含 free Cloud Pro                  | **C 全套**                              |
| 9  | Day 0 launch 渠道   | A. HN 单点 / B. HN + PH + Twitter / C. 全渠道                            | **B 集中火力**                            |
| 10 | 闭源 cloud 自托管允许?   | A. 不允许 / B. 自托管 + 不许商用 / C. 允许商用付商标 license                         | **B 自托管允许 personal use, 商用要 license** |

---

## 10 立即可做的下一步 (如果 bao 同意全开源 + Apache + v1 同步)

1. **修订 CLAUDE.md ## Rules** — license 段改成 Apache 2.0 + 闭源 separate repo
2. **新建 ADR-008 oss-model** — 7 module → 8 module
3. **License audit** — 跑 `npm ls --all` 看依赖 license, 确认 Apache 2.0 兼容 (Pi MIT ✓, Tiptap MIT ✓, CodeMirror MIT ✓, Tauri MIT/Apache dual ✓)
4. **THIRD_PARTY_LICENSES/ 完整化** — 现在只有 kairo-MIT, 要扩到全依赖
5. **商标查询** — USPTO / EUIPO / 国知局查 "CTRL" 名字可用性 (CTRL 名字太通用, 可能要叫 "CTRL App" / "CTRL OS" / "ctrlapp")
6. **拆 ctrl-cloud repo** — 现在已经是 separate (CLAUDE.md 写明), 确认私有 + 必要 secrets 已 keychain 化
7. **写 launch playbook draft** — 4-page README + 3 GIF + 1 video
8. **找 5 个 design partner** — 早期 B2B 信号

---

## 附录 A — 数学题敏感性分析

如果转化率 / ARPU / 增长达不到, 5 年 ARR 怎么变?

| 场景                       | 转化率 | ARPU  | Y5 周活 | Y5 ARR           |
| ------------------------ | --- | ----- | ----- | ---------------- |
| **乐观** (Obsidian rate)   | 7%  | $130 | 1M    | **$14.7M**      |
| **基线** (本文用)             | 5%  | $100 | 500k  | **$5.5M**       |
| **保守** (augmentation 自打) | 3%  | $80  | 200k  | **$1.2M**       |
| **悲观** (鸡生蛋失败)           | 1%  | $60  | 50k   | **$130k** (生存线) |

即使悲观场景, 5 年 ARR $130k 仍然是 1 人独立开发养活线; 基线 $5.5M 是小团队级别; 乐观 $14.7M 是融资 / 退出级别。

**风险/回报对称性高**, 值得做。

---

## 附录 B — 跟 bao 已锁哲学交叉检查

| 哲学条款                         | 本商业模型违反?                                                             |
| ---------------------------- | -------------------------------------------------------------------- |
| "我们卖工具 + 平台, 不卖模型"           | ✓ 不违反 (cloud 卖的是 quota 不是模型, marketplace 卖创作者, enterprise 卖 audit)   |
| "本地是 truth, 云是 mirror"       | ✓ 不违反 (vault 仍本地 truth, cloud 是 sync mirror)                         |
| "augmentation 不是 dependency" | ⚠️ 部分张力 (cloud 订阅价值需要"明显省事", 但用户可选不付) — mitigation 见 §6.2            |
| "数据本地, 无 lock-in"            | ✓ 不违反 (用户随时可走)                                                       |
| "vim test"                   | ✓ 不违反 (开源后更 pass)                                                    |
| "无 CTRL 账号系统"                | ⚠️ 跟 cloud 订阅冲突 (要 Stripe customer ID 绑机器指纹? 或妥协加最简账号?) — 单独需 bao 拍板 |
| "Global English first"       | ✓ 不违反 (开源 launch 走英文社区)                                              |
| "私有 binary 格式禁止"             | ✓ 不违反 (开源加固)                                                         |

**关键张力 1 个**: "无 CTRL 账号系统" 跟 cloud 订阅冲突。两个解决路径:

- **A 路径** (推荐): 加最简 account (只 email + Stripe customer), 仅订阅功能用, 跟 vault / keycap 数据 0 关系 — 这条不违反 plain-text + 数据本地哲学 (账号只管钱, 不管数据)
- **B 路径**: 走机器指纹 + Stripe customer 但无 email, 用户换设备麻烦 — 体验差

**A 路径建议拍板**: "无账号" 哲学校准为 "无 CTRL 用户数据账号 (vault / keycap / 数据全本地)", 不包括"无支付账号" — 哲学闭环仍成立。

---

**End of brainstorm — 等 bao 拍板 §9 决策清单 10 项, 再决定是否落 ADR-008**
