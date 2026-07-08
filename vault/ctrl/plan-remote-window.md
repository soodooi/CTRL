---
title: Remote Window (mobile-native PWA co-view) — plan
type: plan
status: active
owner: bao
decided: 2026-07-07
governing_adrs: [ADR-005 §2 remote-co-view, ADR-010 §transports ⑧, ADR-004 §1 capability-scoping, ADR-002 §crypto]
---

# Remote Window — 手机原生 PWA 语义远程

> bao 2026-07-07 拍板 **B(语义远程 · 手机原生 PWA)**,不是 A(像素远程桌面)。
> 「按 Ctrl 唤起的功能,手机远程也能用」——手机跑 CTRL PWA,经桥连桌面 kernel,
> **原生渲染**各功能面(股票驾驶舱/包/笔记),底部导航切换,一个 L1 配置页管
> 「手机能看什么、能做什么」。像素投屏(A)降级为「手机渲染不了才投该窗口」的后续选项。

## 为什么 B(对齐既有决策)

- **ADR-005 §2** 明说 co-view「流 workspace 语义 cell,不是像素;**不是远程桌面工具**」——B 正是这条。
- 轻、跨平台、复用最多:手机就是同一套 PWA(mobile 布局),不需要 macOS 专属的 screen_capture/H.264/input_inject。
- 我刚做的股票卡片/驾驶舱在手机上**直接原生渲染**,零改动。

## 复用清单(不重造)

**从 main 直接用**:
- `event_ws.rs`(:17872 双向 CBOR-WS)+ `bridge.ts`(手机非-Tauri → WS fallback,JSON invoke envelope)——手机端调 kernel 的通道已经在。
- `FeaturePackScene` / Sidebar / L1 切换 / 股票 `StockCockpit`+`StockCard` —— 功能面原生渲染。
- gate `:17873`(gateInvoke)—— 手机端工具调用经同一治理门(权限/审计)。

**从 spike `feat/remote-window-share-spike` 摘出复用(后续跨 NAT 时)**:
- `worker/ctrl-relay-spike`(CF Worker 信令 relay,Durable Objects,2-peer/room)。
- `remote_session`(配对:房间号 + 密码 / self-device 免密 token)。
- vodozemac Olm 1:1 加密(`ctrl-mesh`)。

**明确不用(B 不需要)**:screen_capture / video_codec / input_inject / WebRTC 视频腿 —— 那是 A(像素)的机器,留给后续降级选项。

## 缺什么(要新建)

1. **L1「远程」配置页**(桌面)—— 连接状态 + 配对码/二维码 + allowlist(勾选手机可见的包/功能 + 每项 view-only / can-act 权限)。持久化 allowlist。
2. **手机端 shell** —— mobile 布局 + **底部导航**(渲染 allowlist 的包),每 tab = 原生渲染该功能面。
3. **连接**:v1 同局域网直连(手机开 URL → mobile PWA → `configureWsBridge` 指向桌面 LAN IP:17872 + session token)。跨 NAT = 后续接 spike 的 relay。
4. **ACL 落地**:远程 session 只能见/调 allowlist 内的包(capability-scoped,ADR-004 §1)。v1 最小:allowlist 驱动手机导航可见项 + WS session 的可见面。

## 切片(dev-loop,每片验证后 commit)

- **S1 · L1 远程配置页**(桌面前端 + 一个持久化 allowlist 的 kernel 命令)—— 纯前端可视觉验证。**先做,最止痛,是 bao 点名的「配置管理页」。**
- **S2 · 手机 shell + 底部导航** —— mobile 布局渲染 allowlist 的包;mock 数据可视觉验证。
- **S3 · 连接(同 LAN)** —— 配对码 + configureWsBridge + session token;真机(桌面+手机)= 诚实 gap,我这边 tsc + mock 验。
- **S4 · ACL 落地** —— 远程 session 工具/包可见性按 allowlist 裁剪(接 gate visibility)。
- **后续**:跨 NAT relay(摘 spike)· pixel 投屏降级(A,摘 spike)。

## 诚实 gap(一贯那条)

- 手机真连桌面 kernel、跨设备网络 = 需要桌面 app + 一台手机,我这边 tsc + mock/真 CSS 渲染验,真机 round-trip 是 bao 的。
- v1 同 LAN 直连要 :17872 的 token auth(已有)+ ACL —— 别过度暴露;跨 NAT 前不开公网。

## S3 传输定案(2026-07-07,调研 + bao 拍)

**调研**(HA/Nabu Casa · Syncthing · Tailscale · Cloudflare Tunnel · ngrok/VS Code Tunnels · WebRTC;事实源 = 本 session 研究 agent,多源交叉):
- 「手机远程访问自托管 app 功能(JSON 非像素)」的最佳实践 = **出站 relay 隧道**(ngrok/VS Code Tunnels/HA-Cloud 模式)。纯 JSON **不需要 WebRTC**(Syncthing 证明数据类不用它);WireGuard/Tailscale 浏览器 PWA 跑不了 → 排除。
- 普遍规范:**relay 零知识 + 帧 E2E 加密**(SniTun/DERP/Syncthing 都只转密文;不能只靠 WSS-to-Cloudflare,TLS 在边缘就解)。

**bao 决策 = 真·0 监听 · relay-only**:严守「0 监听端口 / 只出站」哲学,**LAN 也走 relay**(手机 ──WSS──> relay <──出站── 桌面)。
- **明确取舍(bao 拍)**:**不支持离线 LAN 直连** —— 断网 / relay 挂了手机连不上(HA/Syncthing 的 LAN-直连-兜底模型**不采用**,换取零本地监听)。
- **保留调研的 E2E**:relay-only 全流量过 relay,故**帧必须 E2E 加密**(复用 spike vodozemac,relay 只转密文)。

**定案架构**:桌面 kernel 出站 WSS 连 ctrl-relay room + 手机 WSS 连同 room + relay 不透明转发 **E2E 密文帧**(gate 调用 req/resp + 事件流 + allowlist 开局握手)。配对 = 二维码/一次性 token(SelfDevice)+ E2E 密钥交换。
- **复用 spike**:`ctrl-relay` worker(转发)+ vodozemac(E2E)+ `remote_session`(配对)。**跳过**:WebRTC / screen_capture / video / input_inject / LAN 监听 / mDNS。

## HA Companion 对标校准(2026-07-07 深调研,事实源 = 本 session 研究 agent + 官方一手)

对标最贴的 Home Assistant Companion,验证 relay-only + 锁死几条设计:

- **配对优先 onboarding(借鉴 + 更简)**:HA「LAN 发现 → 否则手输 URL」两分支;CTRL 0 监听端口 = 无可发现 → **扫码/输配对码**(码带 relay room 端点 + 设备身份 + E2E 密钥),手机永不需知 host/port。
- **E2E 密钥锚在配对交换(反超 HA)**:HA 云拥有信任根(域名+CA)可 MITM(官方披露)。CTRL 的 E2E 会话密钥在**手机↔桌面配对时**建立(QR 携带 / 双方 key-agreement),relay **对 CTRL 自己也零知识**。堵上 HA 的洞。
- **每设备可撤销(借鉴)**:allowlist 页兼作设备页,「删设备 = 该手机登出」;每设备命名(操作可归属)。HA refresh-token 模型。
- **故意不做 SSID 本地/云切换**:HA 最被吐槽子系统(VPN/漫游/同名 SSID + 强制定位权限),是 LAN 直连模型的产物;relay-only 构造上删掉,**禁止**以后加「在家走 LAN」开关把坑请回。
- **访问控制反超**:allowlist = 每设备/每能力/**默认拒绝**、gate 裁决(HA per-user 又粗又漏,社区求而不得)。
- **离线反超(local-first)**:手机**立即渲染缓存语义状态**(只读可用)+ 重连对账 + 不阻塞小状态点;**不做** HA 的阻塞「Connection lost」墙。
- **同一套面两端渲染**不变量(JSON-semantic 白拿);mobile 可 reflow 成原生组件(非缩小的桌面网格)。widgets/快捷操作后续。

## ADR 收尾(B 落地后)

- ADR-005 §2 co-view 从「v1.1 设计」更新为「语义远程已实装(relay-only + E2E)」+ 记 A(像素,ADR-010 ⑧)/B 分野 + 「不做离线 LAN」的取舍。
- spike 引用的 `ADR-002 §remote-control` 收敛进 ADR-005 §2(避免双真相源)。
