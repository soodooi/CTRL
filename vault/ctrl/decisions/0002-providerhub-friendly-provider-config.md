# 0002 — ProviderHub:cc-switch 风格 + 友好配置

- 状态:Accepted
- 日期:2026-06-11

## Context
bao 要 provider 配置页参考 **opencode 的选择方式** + **cc-switch 的多 provider 管理**,且要「用户友好」—— 一般用户(非技术)只填 key 就行。

竞品里 provider/key 配置是**最差的 onboarding 时刻**(hermes 交互式 TTY 向导、openclaw 手编 JSON、豆包/coze BYOK 要第三方 relay)。所以「友好配置」本身就是差异化。

## Decision
`ProviderHub`:provider **卡片网格**(volc / zhipu / claude 置顶)+ 状态(`○ set up` / `● switch to` / `★ in use`)+ 一键切换 active。

点一个 provider → **只有 API key 框是显眼的**;endpoint + model 折叠进 "Advanced"。Zhipu 给 **International (z.ai) / China (bigmodel.cn)** 一键切换(key hint 跟着变),不用填 URL。

双入口、同一套:首屏「Connect your AI」(modal)+ Settings → Providers(inline 模式)。

## Consequences
- 替换旧的 `ProvidersBlock` 列表 UI;dead code 已清(settings.tsx 1064 → 355 行)
- 浏览器/dev fallback templates,让 UI 在 Tauri 外也能渲染(便于 Playwright 验证)
- 待:provider 写进 `~/.hermes/.env`(已做适配器),但 hermes 认不认 volc/zhipu 自定义 base_url 需真机验证 → [open-questions](../open-questions.md)
