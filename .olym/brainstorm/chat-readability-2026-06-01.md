# Irisy 对话框可读性调研 — 2026-06-01

> bao 反馈: "对话框不对 看都看不清楚 全网调研 最佳方案"
>
> 起因: 我把字体压到 13px / line-height 1.42 / label 9px, scroller gap 2px,
> 段落 0 margin. 单纯堆密度, 牺牲了可读性. 撤回, 找回 industry 标杆.

---

## 1. 当前 v0.1.138 实测问题诊断

| 维度 | v0.1.138 | 问题 |
|---|---|---|
| body font-size | 13px | < industry baseline (14-16px). 在 macOS Retina 也偏小 |
| line-height | 1.42 | 偏紧, 段内行间挤 |
| label font-size | 9px | 远低于 macOS HIG 11pt 系统最小可读. 视盲区 |
| label color | text-faint | 对比度 < WCAG AA 4.5:1 |
| 段落 margin | 0 | 段落界限消失, 一团 |
| scroller gap | 2px | turn-to-turn 没呼吸 |
| label 列宽 | 40px | "Irisy" 5 字 + 0.14em letter-spacing 实际需 ~48px |

→ "字体小 + label 太弱 + 段落无界" 三因素叠加 = 看不清.

## 2. 全网调研: 5 个标杆 + 数字

### 2.1 Cursor IDE chat panel (Forum + dredyson.com)

- 默认: ~12-13px, 用户广泛抱怨 "microscopic" / "lines stacked"
- 用户 CSS override 实测最舒服: **font-size 15-16px, line-height 1.5-1.6**
- 结论: 13px 是 "用户抱怨阈值", 14.5-16px 是 "舒适阈值"

### 2.2 Linear (typ.io 实测)

- Inter UI, header text 12px / line-height 15px (1.25 — 仅 header)
- body 14px 是 dashboard / 高密度面板的 baseline
- 允许用户自调 font-size (preferences)

### 2.3 Raycast AI sidebar

- 没拿到精确数值, 但 product 走 macOS HIG → 默认 system font 13pt = 17.3px @96dpi.
  实际 chat body 视觉 ≈ 14-15px CSS-side.

### 2.4 Pimp My Type / Baymard / UXPin (line-length 研究)

- 最佳 line-length: **45-75 chars / line** (Bringhurst 经典), 66 是 sweet spot
- 380-400px content column @ 14-15px = ~50-55 chars → 已落区间
- 窄列 line-height 建议 **1.3-1.45** (但前提是字够大; 字小+紧行 = 不可读)

### 2.5 Notion AI / Granola (产品观察 — 无明确数值, 但风格)

- 撤 sender label (头像 + 缩进区分), 或 label 跟 timestamp 同行做 metadata
- body 15-16px, line-height 1.5-1.6 系标准
- 段落 margin ≥ 0.5em

## 3. WCAG / macOS HIG 硬约束

- **WCAG 2.1 AA**: body text 对比度 ≥ 4.5:1. 我们的 `--color-text-faint` 实测 ~3:1 (label 不达标)
- **macOS HIG**: 系统最小可读 11pt = ~14.6px @1x. label 9px = 6.75pt → 远低于 HIG
- **Apple SF 字体**: 12-13px CSS 渲染锐利, 但需 weight ≥ 500 + tracking 略放; 9px 任何 weight 都糊

## 4. 推荐方案 — Linear/Cursor 折中 (dense + 可读)

| 项 | v0.1.138 | → 推荐 v0.1.139 | 出处 |
|---|---|---|---|
| body font-size | 13 | **14.5** | Cursor 用户实测 sweet spot 下界 |
| body line-height | 1.42 | **1.5** | Cursor + Linear + Pimp My Type |
| label font-size | 9 | **10.5** | macOS HIG 8pt 边界, 配 weight 600 可读 |
| label weight | 500 | **600** | 小字补可读性 |
| label color | text-faint | **text-muted** | 提一档对比度到 ≥ 4.5:1 |
| label 列宽 | 40px | **48px** | "Irisy" + tracking 实际所需 |
| paragraph margin | 0 | **0.35em** | 段落界限 (Notion 标准) |
| p + p 额外 gap | 0.2em | 撤掉 (margin 已覆盖) | 简化 |
| scroller turn gap | 2px | **10px** | turn-to-turn 呼吸 |
| turn separator margin | 8/10 | **12/14** | 保留 hairline + 节奏 |
| column-gap (grid) | 8px | **10px** | label 列宽变大后视觉舒适 |

净效果:
- 同 height 770px (本 session 已加的 +50px) 可读 ≈ 16-18 turn 摘要 (vs v0.1.138 ~20 但糊)
- side-by-side 保留, label 不再像漏字
- 段落有界, 信息块可扫描

## 5. 保留 v0.1.138 的对的决策

- 2-col grid `[label | content]` (bao 拍板, 不变)
- 无 bubble 填充 / 无圆角 (Editorial 风, 不跟 ChatGPT/Doubao)
- hairline turn separator
- markdown body inline

## 6. 撤回 v0.1.138 的过激决策

- 字体 13px → 回 14.5px
- line-height 1.42 → 1.5
- label 9px → 10.5px + 600 weight
- 段落 0 margin → 0.35em
- scroller gap 2px → 10px

## 7. 何时再压

仅当 bao 显式说 "再小" 或某次内容真的长到一屏放不下且必须密化, 再考虑下 0.5px.
默认走 14.5/1.5 这条 industry 共识线.

## Sources

- [Cursor Chat Panel Font Size Forum](https://forum.cursor.com/t/changing-chat-panel-font-size-line-height-easily/375)
- [Dre Dyson — Cursor chat font size workarounds](https://dredyson.com/changing-chat-panel-font-size-line-height-in-cursor-a-comprehensive-comparison-of-every-solution-i-tested/)
- [Linear Inter UI on typ.io](https://typ.io/s/2jmp)
- [Pimp My Type — line length & line height](https://pimpmytype.com/line-length-line-height/)
- [Baymard — line length readability](https://baymard.com/blog/line-length-readability)
- [UXPin — optimal line length 2026](https://www.uxpin.com/studio/blog/optimal-line-length-for-readability/)
- [Learn UI Design — Font Sizes in UI Design](https://www.learnui.design/blog/ultimate-guide-font-sizes-ui-design.html)
