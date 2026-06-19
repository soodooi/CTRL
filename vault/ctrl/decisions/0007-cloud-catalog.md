# 0007 — 云端 catalog: model list 不再锁死在 release

- 状态:Accepted (CTRL 端) · worker 端待 bao 实现
- 日期:2026-06-19
- 关联:[0003](0003-ctrl-is-modular-intent-platform.md)(模块化平台),[0006](0006-converged-architecture.md)(收敛架构)

## 背景

`provider-templates.json` 是源码里写死的 21 条静态 catalog。新模型上线(glm-5.2 / gpt-5 / claude-sonnet-5 / Gemini 3)得等 CTRL 发版才能进 picker —— catalog 漂移已成 dogfood 痛点(opencode 这类工具走云端 catalog,永远最新)。

## 决策

**provider catalog 加云端刷新层**,放在 bundled 和 user-override 之间。三层 merge,高优先级覆盖低优先级:

```
bundled (源码 include_str!)  →  cloud-cache  →  user (~/.ctrl/provider-templates.json)
```

- **bundled**:发版快照,fallback / 离线可用。
- **cloud-cache**:`~/.ctrl/cache/provider-catalog.json`,boot 时 fire-and-forget 刷一次。stale-but-present 仍胜过 bundled —— 网络挂了用昨天的不用 release 旧的。
- **user override**:不变,最高优先级。社区 / 高级用户手改。

URL 解析(首个非空胜出):
1. env `CTRL_CATALOG_URL`(dev / 高级用户覆盖)
2. `~/.ctrl/config.toml` `[catalog] url`(per-install,worker 上线时 bao 写)
3. const `DEFAULT_CATALOG_URL = ""`(默认禁用,fetch 是 no-op)

**默认禁用** —— bao 在 ctrl-cloud 上线 `GET /catalog/providers` 后,通过 config.toml 或打包默认值打开,用户零感知。

## ctrl-cloud worker spec(给 bao)

CTRL 端已就绪,worker 端按下面接即可:

**Endpoint**: `GET /catalog/providers`

**Response (option A — 跟 bundled 同 schema,最省事)**:
```json
[
  {
    "id": "zhipu",
    "label": "Zhipu GLM",
    "defaultName": "GLM",
    "protocol": "openai",
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
    "defaultModel": "glm-5.2",
    "keyHint": "get at open.bigmodel.cn/usercenter/apikeys"
  }
]
```

**Response (option B — 服务端带时间戳)**:
```json
{
  "fetched_at": "2026-06-19T12:00:00Z",
  "templates": [ ... 同上数组 ... ]
}
```

CTRL 两种都吃。Option B 让服务端自报新鲜度,但 CTRL 当前不用 staleness 判断(boot 刷一次,失败用旧 cache)。

**HTTP 要求**:
- 200 + `Content-Type: application/json`
- 15s 内返回(CTRL 端 timeout)
- 无需鉴权(catalog 是公开数据)
- CDN 缓存友好(加 `Cache-Control`)

**Ctrl-Cloud 落点建议**: 新建 `ctrl-catalog` 子服务,或挂在 `ctrl-market`(模块 store 已有)下当 `GET /catalog/providers`。前者职责更清。

## CTRL 端实现(已落地,2026-06-19)

| 文件 | 改动 |
|---|---|
| `src-tauri/src/commands/cloud_catalog.rs` | 新增。fetch / cache / URL 解析。5 个单元测试。 |
| `src-tauri/src/commands/provider_templates.rs` | 加 cloud-cache 层 merge + `refresh_provider_catalog` async command。2 个单元测试。 |
| `src-tauri/src/commands/mod.rs` | 注册 `refresh_provider_catalog` 到 invoke handler。 |
| `src-tauri/src/shell/lifecycle.rs` | boot 完成后 `tauri::async_runtime::spawn` 触发一次刷新,失败静默。 |

UI 不动 —— `ProviderPicker.tsx` 的 model 字段本就是自由 `<input>`,云端 catalog 进来后 placeholder / 自动补全自然就新了。

## Consequences

- **减负**: bao 不必每次新模型上线就 bump bundled catalog + 发版。
- **失败安全**: 3 层 fallback,任何一层缺失都优雅降级。
- **隐私**: catalog fetch 是公开数据,不带 user key,跟 P1 transparency 一致。
- **未实现**: 定时刷新(24h) / Settings UI 的 Refresh 按钮 / config.toml `[catalog]` schema —— 留给后续,worker 上线时再加。

## 待办(给 bao / 后续)

- [ ] ctrl-cloud 实现 `GET /catalog/providers`(option A 或 B)
- [ ] 设置默认 URL(写 const 还是 config.toml 默认值,bao 定)
- [ ] (可选)PWA Settings → Providers 加 Refresh 按钮,调 `refresh_provider_catalog`
- [ ] (可选)config.toml 加 `[catalog] url = "..."` schema 接通
- [ ] (可选)24h 定时刷新
