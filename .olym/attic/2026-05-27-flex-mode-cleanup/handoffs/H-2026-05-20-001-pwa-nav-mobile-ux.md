---
id: H-2026-05-20-001
title: "PWA nav redesign — borrow mobile UX patterns for the 920×560 floating-shell viewport"
severity: P1
status: open
reporter: zeus
assigned_to: daedalus
lane: lane-A
touches:
  - packages/ctrl-web/src/app.tsx
  - packages/ctrl-web/src/app.module.css
  - packages/ctrl-web/src/components/BottomTab.tsx           # new
  - packages/ctrl-web/src/components/BottomTab.module.css    # new
  - packages/ctrl-web/src/components/StatusBar.tsx           # new
  - packages/ctrl-web/src/components/StatusBar.module.css    # new
  - packages/ctrl-web/src/routes/{home,pool,workspace,settings}.module.css  # safe-area padding only
related:
  - H-2026-05-14-003     # PWA polish parent
  - H-2026-05-18-001     # Irisy keycap-creator — Irisy is one of the 3 tabs
  - (PR #11)             # token aliases + container vars this handoff depends on
parent_decision:
  - decision_pc_mirrors_mobile_layout    # bao 2026-05-19 修正: PC 学 mobile UX 技术方案, 不是渲染 iPhone 容器
project_id: ctrl-v1
category: feature
created: 2026-05-20
updated: 2026-05-20
---

## 🎯 目标 (ship value, 1 句)

CTRL 浮窗 920×560 ≈ phone landscape, 主导航从 desktop 横向文字 nav 改成 mobile-team 已经解过的"小屏大信息量" patterns (bottom-tab + status-bar + safe-area + 44pt 触控), 让 ambient launcher 感不被 desktop-style top nav 拖累。

## 现象

`app.module.css` 当前 nav = 横向 4-link 文字 chip (Home / Pool / Workspace / Settings):

- 在 920px 宽度 ≈ phone landscape 的浮窗里, 横向文字 nav 占顶部高度 ~56px, 信息密度低
- 缺 logo 曝光 (单一 brand 资产从未出现)
- 缺 status-bar 范式 (time / connection / mode 都散落各 route)
- 缺 safe-area 处理 (mobile PWA 装机时刘海会吃)
- 触控目标 < 44pt (text chip 大约 32px)
- Workspace 是独立 native window (`openWorkspace` 在 pool.tsx) 但仍出现在主 nav, 用户点击会困惑

## 证据

- `packages/ctrl-web/src/app.module.css:1-36` — 现状 nav 实现 (top horizontal text chips)
- `packages/ctrl-web/src/app.tsx:36-55` — rootRoute component 引这套 nav
- `packages/ctrl-web/src/routes/home.tsx:48-91` — iPhone-frame stage 已落地 (fedd0d0), nav 是仅剩的 desktop-throwback
- `doc/visual-identity/logo-mark.svg` + `logo.svg` — 单一资产, 当前 0 曝光
- `decision_pc_mirrors_mobile_layout` memory (bao 2026-05-19): "不是 'PC 渲染 iPhone 容器', 是 '学习 mobile UX 解小屏大信息量的技术方案'"
- bao 2026-05-19 钦定的 3 个 icon: Pool / Irisy / Settings (workspace 排除 — 独立 native window)

## 建议 (mobile UX 学习清单)

### Nav 结构 — bottom-tab + status-bar 范式

```
┌─────────────────────────────────────────┐   ← StatusBar
│ [logo] CTRL · 17:42        ● connected  │
├─────────────────────────────────────────┤
│                                         │
│   <Outlet /> (home / pool / settings)   │   ← Route surface
│                                         │
├─────────────────────────────────────────┤   ← BottomTab
│   ⌨  Pool      ◐  Irisy      ⚙  Settings│
└─────────────────────────────────────────┘
                                              workspace = independent
                                              native window, not in tab
```

### 5 个 mobile pattern 一次到位

1. **BottomTab 主导航** (3 icons: Pool / Irisy / Settings)
   - 每 tab = vertical stack of `<icon 24px> + <label text-xs>` 总高 ≥ 44pt
   - Active state: `--color-accent` icon + label, 顶部 2px `--ctrl-blue` indicator
   - Inactive: `--color-text-muted` icon, label
   - Container query (keyed on shell width, NOT viewport — 因 home 是嵌套 IPhoneFrame 的)

2. **StatusBar 顶部 chrome** (替 ClockStrip 作为主窗顶部)
   - Left: `<Logo size="sm" mark-only>` (首次 logo 曝光) + "CTRL" wordmark
   - Center / right: 时间 (mono tabular-nums) + connection LED (kernel WS 状态)
   - 高度 = 32px + safe-area-inset-top
   - Workspace native window 单独有它自己的 header, 不复用此 StatusBar

3. **Safe-area 全面 opt-in**
   - 主 shell padding `env(safe-area-inset-top)` / `env(safe-area-inset-bottom)`
   - iPhone-frame 已经处理了 inset (home.module.css:64) — 这次给真 mobile PWA
   - Test: iOS PWA add-to-home, viewport-fit=cover

4. **44pt 触控目标 (跨 nav + 任何按钮)**
   - BottomTab item, StatusBar action icon, route 内 button 全 `min-height: 44px`
   - 已经在 `home.module.css:67` `.compactBack` 上 done — 这次推广

5. **One-hand reach + gesture (P2, optional)**
   - 顶部 status-bar 全 inert (display only, 不可点) — 不要把功能放在拇指够不到的区域
   - 主操作集中在 bottom 60% 区域
   - (gesture / swipe-to-go-back 留 P2, 不在本 handoff)

## 不动的边界

- **不动 `lib/irisy/**`** — lane-B 边界
- **不动 `routes/irisy.tsx`** 内部 — lane-B 边界 (但 BottomTab `to="/irisy"` 必须工作)
- **不动 `home.tsx` 内部 iPhone-frame 逻辑** — 已 ship, 这次只在外层加 StatusBar + BottomTab
- **不动 `workspace.tsx` 独立 native window 内部** — 它有自己的 header, 不与主 shell nav 耦合
- **不引外部 UI lib** — 走 tokens.css 自建 (per .olym/CLAUDE.md design philosophy #9 anti-template)

## 依赖

- **PR #11 (lane-A token aliases) merge** — `--color-accent` / `--color-success` / `--container-*` 全在那个 PR 里, 本 handoff 要消费
- **#2 primitives 抽取** — `<Logo>` 组件来自那个 PR, BottomTab 内部 icon 可能复用 `<Button variant="ghost">` 视实现而定
- 若 #2 还没 merge, 本 handoff 可先用 inline SVG + native button, 后续 swap

## 验收清单

- [ ] BottomTab 3 icons (Pool / Irisy / Settings) — workspace **不**在 tab
- [ ] StatusBar 出现 logo + wordmark + time + connection LED
- [ ] safe-area-inset-top/bottom 在主 shell 生效, iOS PWA add-to-home 真机验证
- [ ] 所有 nav / button 触控目标 ≥ 44pt (axe / measure)
- [ ] `prefers-reduced-motion: reduce` 时所有 nav transition 降级
- [ ] focus-visible 在每个 tab 上明显
- [ ] `npm run typecheck` + `npm run build` 绿
- [ ] bundle gzip 预算 ≤ 500 KB (ADR-002 §5)
- [ ] zeus / bao 视觉验收 — 浮窗 (920×560), iPhone PWA (375×812), 大 desktop (1440×900) 三档截图

## Themis tier

**Tier B** — 新增 2 个共享组件 + 改主 shell + safe-area / a11y 全面 touch。涉及 routing 边界 (workspace 从 tab 移除) 需 zeus signoff。

## 讨论 / 备注

(daedalus 工作时往这里写: 视觉决策 / blocker / 给 zeus 的请求)
