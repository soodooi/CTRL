# CTRL — Design System

> 视觉方向：Keycap 派 · 工业精确。Tokens 源在 `doc/design/tokens.json`，原型在 `doc/design/keycap-prototype.html`。

## Color (light)

OKLCH-friendly hex（实际值是 hex，未来可移到 oklch）：

| Role | Value | Use |
|---|---|---|
| `--bg` | `#F5F5F7` | 应用背景（platinum） |
| `--bg-elev` | `#FFFFFF` | sidebar / 抬升面 |
| `--card` | `#FFFFFF` | 键帽面（top of gradient） |
| `--card-deep` | `#F0F0F3` | 键帽底（bottom of gradient） |
| `--border` | `rgba(0,0,0,0.08)` | 弱边界 |
| `--border-strong` | `rgba(0,0,0,0.14)` | 键帽边界 |
| `--text` | `#1D1D1F` | 主文字（ink） |
| `--text-muted` | `#6E6E73` | 辅助文字 |
| `--text-subtle` | `#98989D` | 占位/计数 |
| `--primary` | `#3B5BDB` | 钴蓝（cobalt，工程蓝） |
| `--primary-soft` | `rgba(59,91,219,0.10)` | hover 软底 |
| `--primary-ring` | `rgba(59,91,219,0.18)` | focus halo |
| `--warm` | `#F59F00` | 琥珀（amber，accent / 强调） |
| `--cool` | `#0CA678` | 翠玉（jade，success） |
| `--destructive` | `#E03131` | 警示红 |
| `--destructive-soft` | `rgba(224,49,49,0.08)` | error 软底 |

Dark mode 取值见 tokens.json `color.dark`（背景 #1D1D1F，card #2E2E30，primary #5C7CFA）。

**Color strategy**: **Restrained** — 中性 + 一个钴蓝 primary（≤10%）+ 状态色（hover/success/error）。不 drench，不 full palette。

## Typography

- **UI**: `-apple-system, "Inter", "PingFang SC", "Source Han Sans SC", system-ui, sans-serif`
- **Mono** (数字 / 快捷键 / 模板): `"SF Mono", "JetBrains Mono", "Menlo", monospace`

Scale (px): 10 / 11 / 12 / 13 / 14 / 16 / 18
Weight: 400 / 500 / 600 / 700
Tracking (letter-spacing): tight `-0.04em` (mono 数字) · normal `-0.005em` (UI) · wide `0.02em` (caps) · widest `0.12em` (label kicker)
Line-height: tight 1.3 / normal 1.5 / loose 1.6

## Spacing

8pt grid: 4 / 8 / 12 / 14 / 16 / 24 / 32 / 48

## Radius

- `--r-sm`: 6px (输入框 / 计数 chip)
- `--r-md`: 8px (按钮 / pool item)
- `--r-lg`: 10px (键帽)
- `--r-window`: 14px (顶级容器)

## Shadow（核心识别度）

5 层键帽阴影（top highlight + bottom bevel + ground line + near drop + far drop）：

```css
--shadow-keycap:
  inset 0 1px 0 rgba(255,255,255,0.95),    /* 顶部高光 */
  inset 0 -1px 0 rgba(0,0,0,0.06),         /* 底部斜边 */
  0 1px 0 rgba(0,0,0,0.04),                /* 贴地线 */
  0 2px 4px rgba(0,0,0,0.06),              /* 近阴影 */
  0 4px 12px rgba(0,0,0,0.08);             /* 远阴影 */

--shadow-keycap-hover:
  inset 0 1px 0 rgba(255,255,255,1),
  inset 0 -1px 0 rgba(0,0,0,0.07),
  0 1px 0 rgba(0,0,0,0.04),
  0 4px 8px rgba(0,0,0,0.09),
  0 12px 28px rgba(0,0,0,0.14);

--shadow-keycap-press:
  inset 0 2px 5px rgba(0,0,0,0.12),         /* 深内陷 */
  inset 0 1px 0 rgba(0,0,0,0.06),
  0 0 0 1px rgba(0,0,0,0.05);
```

## Gradient

```css
--grad-keycap:       linear-gradient(180deg, var(--card) 0%, var(--card-deep) 100%);
--grad-keycap-press: linear-gradient(180deg, var(--card-deep) 0%, var(--card) 100%); /* press 时反转 */
```

## Motion

- duration fast 120ms / base 200ms / slow 320ms
- easing standard `cubic-bezier(0.4, 0, 0.2, 1)`
- decelerate `cubic-bezier(0, 0, 0.2, 1)` (window appear)
- **spring** `cubic-bezier(0.34, 1.56, 0.64, 1)` (键帽 hover / press 微 overshoot)
- 唤出动画：scale 0.96 → 1 + opacity 0 → 1，180ms decelerate
- 严禁动画 layout 属性（width/height/padding）；只动 transform / opacity / box-shadow / background

## Components

### Keycap (主组件)

```
.tool-key {
  background: var(--grad-keycap);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-lg); /* 10px */
  box-shadow: var(--shadow-keycap);
  padding: 14px 10px 12px;
  min-height: 88px;
  /* spring hover, press 下沉 1px + 渐变反转 */
}
```

### Pool item (sidebar 列表项)

```
.pool-item {
  display: flex; gap: 10px;
  padding: 7px 10px;
  border-radius: var(--r-md); /* 8px */
  /* hover: primary-soft 底色，无键帽阴影（信息密度优先） */
}
```

### Search input

```
.pool-sidebar-search input {
  background: var(--card);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  padding: 6px 10px;
  font-size: 12px;
  /* focus: border primary + 3px halo */
}
```

### Result banner (顶部 result)

```
.run-result {
  margin: 12px 16px 0;
  border: 1px solid var(--border-strong); /* 状态色覆盖 */
  border-radius: var(--r-md);
  background: var(--grad-keycap);
  /* meta 行 + body 行 + 关闭按钮 */
}
```

## Layout

```
┌──────────────┬──────────────────────────────┐
│ pool-sidebar │ keyboard-pane                │
│ 240px        │ 1fr                          │
│              │                              │
│ search       │ header                       │
│ list         │ [result banner if any]       │
│              │ keycap grid                  │
└──────────────┴──────────────────────────────┘
```

Window: 720×520 默认，min 540×360，可调，alwaysOnTop，唤出时跟随鼠标位置。

## Anti-patterns（绝对不做）

- ❌ Side-stripe 左边色 stripe 当 accent
- ❌ Gradient text（background-clip: text）
- ❌ Glassmorphism 默认（除非有强目的）
- ❌ Hero-metric SaaS 模板
- ❌ Identical card grids（每张卡片同尺寸 icon + heading + 文案）
- ❌ Modal first-thought（先用 inline / progressive 替代）
- ❌ em dash（用 ， ：；。（）.）
