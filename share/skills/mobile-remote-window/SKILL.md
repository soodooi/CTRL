---
name: mobile-remote-window
description: 用于「用手机远程访问桌面 CTRL 的功能」相关请求 —— 当用户问「怎么在手机上用 / 移动端 / 远程窗口 / 手机远程连桌面 / 把功能投到手机 / 配置移动端 / 手机连不上 / 远程链接打不开」时,按本规范引导设置、解释原理、排障。核心:手机是桌面功能的瘦远程窗口,不是投屏;数据主权在桌面。
---

# Mobile / 远程窗口 — 规范

用户按 `Ctrl` 唤起的桌面功能,想在**自己手机上远程用**。你(Irisy)按本规范引导 + 解释 + 排障。**先读本 skill 再答**,别自己另立一套或凭记忆编。

## 是什么(定位,先说清)

- **手机 = 桌面 CTRL 的瘦远程窗口**:手机跑同一套 PWA,经零知识 relay 连到用户**自己的桌面**,**原生渲染**桌面功能包(股票、CRM、笔记…)+ 一个 Irisy 对话。**不是投屏(不是像素)**,是把桌面能力投影到手机。
- **数据主权在桌面**:relay 只转**加密密文**,PWA host 只给静态壳。用户数据、计算、Irisy 全在**桌面**,手机不存数据、不跑 kernel。拔了桌面 app,手机就没内容(窗口后面没主机)。
- **不承诺**:不是跨设备云同步(数据不在云);不是「投屏/远程桌面」(那是 ToDesk/RustDesk,CTRL 不走那条);手机看到的是**桌面功能的子集**(用户在配置页勾了哪些)。

## 怎么开(一步步引导用户)

1. **桌面**:L1 侧栏点 **Mobile** → 打开「**Stay reachable**」开关(状态点变绿 = 桌面已在 relay 上待命)。
2. 复制那条**配对链接**(`app.ctrlapplab.com/?remote=…#k=…`)+ 记下 **6 位 passcode**。
3. **手机**:浏览器开那条**完整链接**(不是裸 `app.ctrlapplab.com`)→ 输一次 passcode → 看到底部导航 + 各功能。
4. **以后随时连**:链接 bookmark / 加主屏;桌面「Stay reachable」开着,手机随时打开就连上(ToDesk 式持久设备,不用每次碰桌面)。

## 手机上能用什么

- **底部导航**切各功能包(用户在配置页 allowlist 勾选的,**默认拒绝**;View 只看 / Act 可操作)。
- **每个包原生渲染**:包用 `describe` 自报一串通用 part(gauge/metrics/barlist/tiers/table/record/list…),手机一套渲染器渲,任何包都行,**不为某个包写代码**。
- **右滑屏幕右缘 / 点右下 ✦ Irisy 球** → 调出**对话**:跟的是**桌面上的同一个 Irisy**(消息经隧道到桌面 engine,流式返回)。

## 架构(你该懂,便于解释 + 排障)

- **传输 = relay-only + E2E**:桌面**出站**连 relay(0 监听端口),手机连同一房间;每帧 AES-GCM 加密,密钥锚在**配对链接**里 → relay(及 CTRL 云)只转密文,**零知识**(比 HA-Cloud 更强,连我们自己也解不了)。LAN 也走 relay(严守 0 端口,取舍是不做离线 LAN 直连)。
- **持久设备**:桌面有稳定 device-id + E2E 密钥 + passcode,后台保活 relay 连接(RustDesk 注册心跳式);passcode 在 E2E 之后校验(relay 看不到),Reset = 撤销记住的手机。
- **describe-驱动 SDUI**:包描述自己的手机界面(§14 describe),手机通用渲染 + 动作经 gate 隧道回流(点按 → produce/query → 重渲染)。没有 `stock` 特判。
- **对话隧道**:手机 Irisy sheet ↔ 桌面 engine 流式(`engineTransport`,同一助手)。

## 排障(用户说"不行"时按此查)

- **链接打不开 / 崩** → 多半是**旧缓存**(PWA service worker)。让用户**清站点数据 / 用无痕**再开,或删主屏图标重加。
- **开了裸 `app.ctrlapplab.com`(不带 `?remote`)只看到落地页** → 那是正常的,必须用桌面生成的**完整配对链接**。
- **手机连不上(转圈/Nothing shared)** → 桌面 Mobile 页那个**状态点是绿的吗**?灰的 = 桌面没在 relay(Stay reachable 没开 / 桌面 app 没跑 / 网络挡了 WSS)。让用户确认桌面开着 + Stay reachable 绿灯。
- **手机看不到某功能** → 桌面配置页 allowlist 里**没勾**它,或勾了但 View-only。让用户去桌面 Mobile 页勾上 + 选 Act。
- **passcode 不对** → 让用户看桌面 Mobile 页当前 passcode(可能 Reset 过);重输。

## 你该做 / 别做

- **做**:按上面步骤引导设置;解释「数据在你桌面、relay 只转密文」打消隐私顾虑;排障时先问「桌面状态点绿不绿」。
- **别做**:别说「投屏 / 远程桌面」;别承诺手机离线可用或云端存数据;别凭记忆编设置步骤 —— 照本 skill。
