# ThorVG / dotLottie — CTRL Visual Motion Skill

> Adopted 2026-05-23 (bao verbal-go) — single rendering target for all
> CTRL animated icons, mascot, illustrations, and workshop preview cards.
> Replaces the previous "inline SVG + lottie-web 二套" stack.

---

## When this skill activates

任何下列工作触发本 skill — 写之前先回到本文件对照：

- 键帽 icon（24-64 px）— `IconRenderer` 已实现，按 manifest.icon kind 分发
- Irisy mascot 6 态切换（idle/watching/thinking/happy/worried/sleeping）
- 空 workspace / empty-state 插画（160-480 px）
- LLM streaming / kernel boot loading state
- keycap success / error 一次性反馈动画
- 工作台 preview card（创作者预览自己做的键帽）
- 营销页 / onboarding step 插画（marketing 域 — apollo lane 也共享此 skill）

不触发本 skill 的场合：

- 纯文字 transition / opacity hover — CSS 直接做
- 单纯布局 spring（drawer 推出 / accordion 展开）— framer-motion / CSS
- 数据可视化（chart / sparkline）— 用 D3 / SVG / Canvas 各自工具

---

## 1 · Engine 选择决策树

按下面的优先级走 — 第一条 match 就停：

| 条件 | 渲染方案 | 理由 |
|---|---|---|
| 1-4 字符的纯文本 glyph | CSS `<span>` (`{ kind: 'glyph' }`) | 0 byte，instant paint |
| 静态 SVG，不需要 brand theming | `<img src="*.svg">` (`{ kind: 'svg' }`) | 浏览器原生解码，可缓存 |
| 静态但需 currentColor / CSS 变量驱动 | inline `<svg>` JSX | 享受 CSS 主题 |
| Lottie `.json`（动）— 仅 1-2 屏低频用 | `{ kind: 'lottie' }` → 同样走 ThorVG | 别为这个引入 lottie-web |
| Lottie `.lottie` zip 包（动 + 主题 + 状态机） | `{ kind: 'dotlottie' }` → ThorVG | first-class，整套优势 |
| Mascot / 多态切换 / 跨设备一致 | `dotlottie` + state machine | 一个文件搞定 N 态 |

**禁止**：

- 同一 PR 引入 `lottie-web` 或 `@lottiefiles/react-lottie-player` — 撞 ThorVG 多套引擎
- 用 GIF / WebP 动图取代 vector — CTRL 全 vector first，跨 DPR 永远锐
- 在 `/`（首页）路由 eager 加载 ThorVG WASM — 必须 lazy import

---

## 2 · 资产准备规范

### 2.1 Lottie / dotLottie 来源

**首选**：[LottieFiles](https://lottiefiles.com)（社区免费 + 商用）
- 下载格式优先 `.lottie`（80% 小于 `.json`）
- 找不到 `.lottie` 就下 `.json` 用 [`dotlottie-js`](https://github.com/dotlottie/dotlottie-js) 转
- 检查 license — community 部分免费商用，premium 部分需购买

**次选**：[Lordicon](https://lordicon.com/) / [IconScout](https://iconscout.com/lottie-animations) — 同样提供 dotLottie 导出

**自制**：[Lottie Creator](https://creator.lottiefiles.com/) (web) / [Lottielab](https://lottielab.com) — 设计师 hand-off 走这两个工具，导出时勾 "color slots" 暴露品牌色 hook

### 2.2 文件命名 + 落位

```
packages/ctrl-web/public/lottie/
├── irisy/                  # Irisy 6 态共用一个 .lottie
│   └── irisy.lottie        # state machine 内 6 segment
├── keycap/                 # 内置键帽运行态动画
│   ├── translate.lottie
│   ├── ocr.lottie
│   └── ...
├── feedback/               # 通用反馈动画
│   ├── success.lottie      # checkmark 一次性
│   ├── error.lottie
│   └── loading.lottie      # spinner / shimmer
└── empty-state/            # 大插画
    ├── no-sessions.lottie
    └── no-vault.lottie
```

第三方 keycap 自带的 lottie 资产 — 走 keycap MCP server 的 resources，不进 PWA bundle。

### 2.3 大小约束

| 用途 | 文件上限 | 备注 |
|---|---|---|
| 键帽 icon（含 idle/running 态） | 8 KB | piggy.lottie 标杆 |
| 反馈动画（success/error） | 12 KB | sample.lottie 标杆 |
| Irisy mascot（6 态全集） | 40 KB | state machine 单文件 |
| 空 workspace 大插画 | 60 KB | full-bleed 320-480 px |

超标直接拒收 — 跟设计师退件，要求：减少 layer / 取消 raster image embed / 压缩 keyframe / 用 marker 替代多文件。

---

## 3 · 实现 pattern

### 3.1 永远走 IconRenderer

```typescript
// 已实现于 packages/ctrl-web/src/components/primitives/IconRenderer.tsx
<IconRenderer
  icon={{ kind: 'dotlottie', src: '/lottie/irisy/irisy.lottie' }}
  size={64}
  playing={isRunning}
  speed={1}
  ariaLabel="Irisy companion"
  fallbackGlyph="I"
/>
```

不要直接 `import { DotLottieReact }` — 绕开 IconRenderer 意味着：

- 没有 glyph fallback，WASM 加载时白屏
- 跨页面 ThorVG 实例不复用
- 未来切渲染后端（WebGL → WebGPU）要改 N 处

### 3.2 Lazy import 强制

`IconRenderer` 已经把 `@lottiefiles/dotlottie-react` 包在 `React.lazy()` 里。所以：

- 主路由 chunk（`index.js`）不含 ThorVG（~32 KB / gzip 11 KB 现状）
- 第一次出现 `lottie` / `dotlottie` icon 时拉 678 KB / gzip 123 KB chunk
- 之后所有 Lottie 实例共享 WASM singleton

**优化进一步**（v1.1 触发）：在 `<head>` 加 prefetch hint：

```html
<link rel="prefetch" href="/assets/dotlottie-react-xxx.js" />
```

只对 Tauri desktop 加 — mobile PWA 别预取，省流量。

### 3.3 主题集成（dotLottie color slots → CTRL OKLCh tokens）

设计师导出 `.lottie` 时给品牌色 slot 命名：
- `slot_brand_primary` → 映射到 `--color-accent`
- `slot_brand_secondary` → `--color-accent-warm`
- `slot_brand_neutral` → `--color-text`
- `slot_brand_bg` → `--color-bg-l0`

CTRL 运行时读 CSS 变量 → 调 `dotLottie.set_color_slot(id, r, g, b)`：

```typescript
// 待实现 — 写完 IconRenderer 后补
const applyBrandTheme = (instance: DotLottie): void => {
  const tokens = getComputedStyle(document.documentElement);
  const accent = parseOklch(tokens.getPropertyValue('--color-accent'));
  instance.set_color_slot('slot_brand_primary', accent.r, accent.g, accent.b);
  // ...
};
```

dark / light mode 切换时自动重应用。详 [LottieFiles Theming docs](https://developers.lottiefiles.com/docs/tools/dotlottie-js/theming/)。

### 3.4 State machine（Irisy 用例）

Irisy 6 态不要在 React 写 if-switch — 用 dotLottie state machine：

```typescript
// IrisyMascot 完整重写 — 6 态 = state machine input
<DotLottieReact
  src="/lottie/irisy/irisy.lottie"
  loop
  autoplay
  stateMachineId="emotion"
/>;
// JS 侧切换：
instance.state_machine_set_string_input('mood', 'happy');
```

state machine 在 `.lottie` 包里声明，hover/click/scroll 也可声明式触发，不写 React 状态机。详 [dotLottie v2.0 spec](https://dotlottie.io/spec/2.0/)。

---

## 4 · 运动 UX — 双层 tier（VI v0.2 §12.1 锁定）

> **本节是 brand-tokens.md §12 的 application guide — 不是 source of truth**。
> 值看 `doc/visual-identity/brand-tokens.md` §12 + `tokens.css`。冲突时
> brand-tokens.md 赢。

行业参考：

- 上游通用 skill: [LottieFiles motion-design-skill](https://github.com/lottiefiles/motion-design-skill) — Disney 12 原则 + motion personality
- [Material Motion](https://m1.material.io/motion/duration-easing.html)
- [Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)

### 4.1 Tier 选择

| 场景 | Tier | 用什么 token |
|---|---|---|
| 键帽 hover / active CSS transition | **chrome** | `--duration-fast` 150 ms + `--ease-out-quart` |
| Workspace tab 切换 | **chrome** | `--duration-normal` 220 ms |
| Modal / drawer 推入退出 | **chrome** | `--duration-normal` + `--ease-out-expo` |
| 键帽 Lottie idle / running loop | **decoration** | `--duration-emote-slow` 1600 ms loop |
| 键帽 success / error 一次性反馈 | **decoration** | `--duration-emote-normal` 1000 ms |
| Irisy mascot state transition | **decoration** | `--duration-emote-normal` + spring |
| 空状态 ambient illustration loop | **decoration** | `--duration-emote-slow` 1600 ms |
| Onboarding step 插画 | **decoration** | `--duration-emote-normal` + `--ease-anticipation` |

**判断口诀**：交互后果发生在 CTRL chrome（导航 / 状态 / 容器）= chrome tier；
内容是装饰 / 人物 / 庆祝 / 引导 = decoration tier。

### 4.2 禁止项

- 单次 chrome micro-interaction > 300 ms — 用户感觉迟滞
- decoration ambient loop < 1 s — 抖动焦躁
- linear easing 用在 transition（除 shake / rotate 这类机械感）
- 在 Modal / button 上用 `--duration-emote-*` — toy-y
- 在 mascot 上用 `--duration-fast` — 看着没生命力

### 4.3 Reduce Motion 必做

`tokens.css` 已在 `prefers-reduced-motion: reduce` 下 clamp 全部 motion
duration 到 ≤ 50 ms。每个 Lottie 实例额外要：

```typescript
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
<IconRenderer
  icon={icon}
  playing={!reduceMotion && requestPlaying}
  speed={reduceMotion ? 0 : speed}
/>;
```

策略：**reduce motion = ambient loop 停 / 反馈动画跳末帧 / 插画切首帧静止**。

---

## 5 · VI 集成（VI v0.2 §12 锁定 — 引用，不重复）

完整规范看 `doc/visual-identity/brand-tokens.md` §12。本节 = 落地速查：

### 5.1 颜色

5 keycap + 4 status + neutrals 全可用，**每张资产 ≤ 3 色**。Slot 命名严格按
brand-tokens §12.2 表格 — `slot_brand_primary` / `slot_keycap_*` /
`slot_status_*` / `slot_text` / `slot_text_muted` / `slot_bg`。

### 5.2 Stroke — Mixed 默认

填色为主，关键细节描边。Stroke 宽度按渲染尺寸：

- 24-32 px → 1.5 px stroke
- 40-48 px → 2 px stroke
- 80+ px → 3 px stroke

Stroke 颜色走 §12.2 slot 表，**不准 plain #000 / #FFF**。

### 5.3 Mascot — geometric abstract

Irisy 形状继承 `--radius-lg` 12 px 圆角方脸，dot eyes / geometric mouth。
**禁止 illustrated character / cartoon line art**。整 6 态 1 个 `.lottie`
文件 + state machine，每段 ≤ 60 frame @ 60 fps。

### 5.4 背景

透明强制。`slot_bg` 默认 skip（不画），需要时才填 `--color-bg-l0`。
有不透明底色的 `.lottie` 退件。

---

## 6 · 性能 checklist

跑过任何 Lottie-using PR 之前自查：

- [ ] `IconRenderer` 是否走 lazy import（不应有 top-level `import { DotLottieReact }`）
- [ ] 资产文件大小符合 §2.3 上限
- [ ] 主 route bundle（`/`）不含 ThorVG（用 `npm run build` 看 chunk 报告）
- [ ] `prefers-reduced-motion: reduce` 切静态状态
- [ ] 同屏 ≤ 4 个 Lottie 实例（更多用 Worker variant：`DotLottieWorkerReact`）
- [ ] 256×256 以上的大动画用 WebGL backend（`@lottiefiles/dotlottie-react/webgl`）
- [ ] mobile PWA 同屏 ≤ 2 个（电量 + 内存约束）

**ThorVG smart partial rendering** 自动 ON — 不写 update 时它不重绘，不要手动 invalidate。

---

## 7 · Anti-pattern 清单

| 反例 | 为什么坏 | 改成 |
|---|---|---|
| 引入第二个 Lottie 渲染器（lottie-web / react-lottie-player）| 撞 WASM 多 instance、bundle 翻倍、跨平台 pixel diff | 全部走 IconRenderer |
| `<DotLottieReact>` 散在 5 个文件里 | 升级 API 要改 5 处 | 包到 IconRenderer |
| 静态 SVG 用 dotLottie 渲染 | 浪费 WASM + 678 KB chunk | 用 `<img src>` 或 inline JSX |
| 4 个 mascot 状态拆 4 个 `.lottie` | 切换断帧 + bundle 大 | 1 个 .lottie + state machine |
| Lottie 文件嵌位图 raster | 失去 vector 优势，体积爆 | 让设计师全 vector 重绘 |
| 不响应 `prefers-reduced-motion` | a11y 不合规 | IconRenderer 必须传 playing |
| 主页 eager 加载 ThorVG | 首屏 +680 KB | 用 React.lazy + Suspense |
| LLM 现场生成 Lottie JSON 给键帽 | 几乎不会成功 | LLM 生成 SVG；Lottie 走人工 / 社区 |
| Lottie 跟 CSS keyframe 在同一组件混用 | 时长 / easing 不同步 | 一种 source-of-truth |

---

## 8 · 参考 + 案例

**已上 ThorVG 产线**：

- Canva iOS — 全 UI 切 ThorVG → 80% faster, 70% memory 降
- Gojek — dotLottie 替换 → 体积 -89%, 内存 +99.6%
- Zomato Lookback 2024 — dotLottie 输出 → -60-70%
- Lottie Creator 自家编辑器
- ArcBrush, Espressif ESP32, Tizen OS, LVGL（嵌入式同 engine）

**炫酷 demo**（看视觉上限）：

- [Thor Janitor](https://github.com/thorvg/thorvg.janitor) — 10K+ 实时 vector 对象 + DropShadow + Blur + 120 FPS
- [ThorVG Showcase](https://www.thorvg.org/showcase)

**设计参考**（dev tool / SaaS 风格）：

- Raycast — empty state + extension icon 微动
- Linear — celebration + onboarding 插画
- Vercel — deploy success/error 状态
- Notion — empty state 大 Lottie

**官方文档**：

- [dotLottie v2.0 spec](https://dotlottie.io/spec/2.0/) — 包格式 + 主题 + 状态机
- [dotlottie-web API](https://developers.lottiefiles.com/docs/dotlottie-player/dotlottie-web/) — JS 实例方法
- [Lottie Theming docs](https://developers.lottiefiles.com/docs/tools/dotlottie-js/theming/) — Slot + Theme
- [ThorVG GitHub](https://github.com/thorvg/thorvg) — 底层 C++ engine
- [Motion Tokens](https://lottiefiles.com/motion-tokens) — runtime override

**CTRL 本仓资产**：

- `packages/ctrl-web/src/components/primitives/IconRenderer.tsx` — 唯一渲染入口
- `packages/ctrl-web/src/lib/icon.ts` — Icon discriminated union + Zod schema
- `packages/ctrl-web/src/routes/icon-lab.tsx` — 4 方案对比 + ThorVG 控制台 demo
- `packages/ctrl-web/public/lottie/*.lottie` — 5 个公开样本

---

## 9 · Skill 维护

- 本文件 owner: athena lane（PWA front-end）
- 更新触发：每次 Lottie 资产规范有改 / 性能 budget 有变 / 新 anti-pattern 累积 3+ 次
- 跨 lane 改动（daedalus / apollo / hephaestus 也吃这套）→ 走 `.olym/decisions/` ADR
- 上游 LottieFiles motion-design-skill 有大改 → 本文件 §4 同步重审
