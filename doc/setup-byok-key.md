# BYOK Setup — How to give CTRL your LLM API key

> 1 页文档。改哪里、怎么改、怎么验证。

CTRL 不会绑一个共享的 default key（合规 + 防滥用），每个安装需要用户填一次自己的 API key。Key 存在 macOS Keychain 里，不在源码、不在配置文件。

---

## 推荐：用 Volcano Ark（火山方舟 / 豆包）

中文 OPC 用户首选——国内 reachable、Doubao 系列模型、OpenAI-compatible API shape。

### 1. 拿 key

1. 注册 / 登录 https://www.volcengine.com/
2. 控制台 → 火山方舟（Ark）→ API Key 管理 → 创建 API Key
3. 复制 key（形如 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`）

### 2. 存进 keychain（用 CTRL 内置 CLI）

```bash
cd /Users/mac/Documents/coding/CTRL/src-tauri
cargo run --bin setup_llm_key -- volc <你的-key>
```

成功输出：
```
✓ stored & verified · service=app.ctrl.spike account=volc
```

**注意**：`volc` 是 account 名。CTRL 同样接受 `ark` 和 `doubao` 作 account 名（三选一都行），都被 adapter 视为 Volcano Ark provider：
```bash
cargo run --bin setup_llm_key -- ark <你的-key>        # 也可
cargo run --bin setup_llm_key -- doubao <你的-key>     # 也可
```

### 3. 验证 key 已存好

```bash
security find-generic-password -s "app.ctrl.spike" -a "volc" -w
# 或 -a "ark" / -a "doubao" — 取决于你存的时候用哪个
```
成功输出 = key 字符串。失败 = "could not be found"。

### 4. 启动 CTRL 验证 adapter 注册

启动 CTRL（`npm run tauri dev`），观察日志：
```
INFO llm_adapter: key resolved via service=app.ctrl.spike account=volc
INFO llm_adapter: volc (Volcano Ark) registered
```
看到这两行 = adapter 接通了，按 ctrl-chat 立刻能流式输出。

---

## 备选：OpenAI BYOK

中国大陆需要梯子。account 名用 `openai` 或 `gpt`：

```bash
cargo run --bin setup_llm_key -- openai sk-proj-xxxxxxxxxxxx
```

CTRL 把这个 key 注册成 OpenAI 的 OpenAI-compatible adapter，base_url=`https://api.openai.com/v1`，默认模型 `gpt-4o-mini`。

---

## 改 / 删 / 换 provider

### 改 key

重新跑 `setup_llm_key`，旧值被覆盖：
```bash
cargo run --bin setup_llm_key -- volc <新-key>
```

### 删 key

```bash
security delete-generic-password -s "app.ctrl.spike" -a "volc"
```
重启 CTRL → 日志显示 `volc key not found in keychain; skipping registration` = 干净状态。

### 换默认 provider（如想优先 OpenAI 而不是 Volc）

改 `src-tauri/src/kernel/runtime.rs:54` 的 fallback chain：
```rust
let mut llm_port = LlmPortRouter::new(vec![
    "openai".into(),    // ← 调到前面
    "volc".into(),
    "anthropic".into(),
    "ollama".into(),
]);
```
重 build → `run_keycap` 拿 `primary_adapter()` 时优先返回 OpenAI。

### 换默认模型（如不想用 `doubao-1-5-pro-32k-250115`）

改 `src-tauri/src/kernel/llm_adapters/mod.rs` 的 `OpenAIShapeAdapter::new(..., "<model_id>")` 第 4 参数：
```rust
let adapter = openai_shape::OpenAIShapeAdapter::new(
    "volc",
    "https://ark.cn-beijing.volces.com/api/v3",
    key,
    "doubao-1-5-thinking-pro-250515",   // ← 改这里
);
```
模型 ID 在火山方舟控制台 → 模型广场看；任何 OpenAI-compatible model id 都接受（adapter 不校验）。

---

## 添加新 provider（DeepSeek / 通义 / Moonshot 等）

所有 OpenAI-compatible provider 都能用同一个 adapter，不用写新代码。在 `register_default_adapters`（`src-tauri/src/kernel/llm_adapters/mod.rs`）加一段：

```rust
if let Some(key) = read_keychain_key_aliased(&["deepseek"]) {
    let adapter = openai_shape::OpenAIShapeAdapter::new(
        "deepseek",
        "https://api.deepseek.com/v1",
        key,
        "deepseek-chat",
    );
    router.register(std::sync::Arc::new(adapter));
}
```

然后 `setup_llm_key deepseek <key>`，重 build 即可。

非 OpenAI shape 的 provider（如 Anthropic Messages API）需要写新 adapter 文件——下次扩展时再做。

---

## 常见问题

**Q: 日志里看到 `volc key not found in keychain`，但我明明存了？**
- 检查 service 名：`security find-generic-password -s "app.ctrl.spike" -a <你存的-account>` 能不能查到。
- 早期版本用过 `app.ctrl` 作 service 名，现在统一回 `app.ctrl.spike`（adapter 同时 fallback 读两个，无需你改）。

**Q: account 名我打错了能改吗？**
- 删了重存：`security delete-generic-password -s "app.ctrl.spike" -a <错的>` → `setup_llm_key <对的> <key>`。
- 或者保持错的也行，只要在 `VOLC_ACCOUNT_ALIASES` / `OPENAI_ACCOUNT_ALIASES` 里加上你打的那个。

**Q: 出现 `AuthFailed` 错误？**
- Key 过期 / 被吊销 → 去控制台重新生成 → 重存。
- account 名跟 key 的真实 provider 不匹配（例如把 OpenAI key 存进了 `volc` account）→ adapter 把它当 Volc 用，Volc 当然认不出 → 401。删了重存到正确 account。

**Q: 出现 `QuotaExhausted`？**
- 火山方舟 / OpenAI 控制台充钱 / 提配额。
