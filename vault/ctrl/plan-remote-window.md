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

## 待确认的小决策(边做边问,不停)

- 配对方式:v1 用 spike 的「房间号+密码」,还是更简的「桌面显二维码/一次性 token,手机扫/开即连」?我倾向后者(极简,self-device 场景)。
- ADR:B 落地后把 ADR-005 §2 co-view 从「v1.1 设计」更新为「语义远程已实装」+ 记 A/B 分野。spike 引用的 `ADR-002 §remote-control` 收敛进 ADR-005 §2(避免双真相源)。
