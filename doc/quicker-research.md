# Quicker 高频工具研究 + CTRL 实现矩阵

> 数据源：[Quicker 受欢迎的动作](https://www.getquicker.net/Share/Recommended) · [Quicker 动作库分类](https://getquicker.net/Share)
> 抓取日期：2026-05-04
> 用途：决定 v0.1 / v0.2 / v0.3 工具优先级，不再凭直觉拍脑袋

---

## 1. 真实使用数据（Top 10）

| 排名 | 工具 | 用户数 | 核心功能 |
|---|---|---|---|
| 1 | 截图 | 175,718 | 屏幕截图 + 拖拽 / 缩放 / 搜索 |
| 2 | 截图 OCR | 53,751 | 截图 + 高精度文字识别 + AI 对话 |
| 3 | 剪贴板 | 10,629 | **剪贴板历史管理器**（支持文件/文本/图） |
| 4 | Translator | 8,532 | 聚合 19 个翻译源（Google / DeepL / 镜像等） |
| 5 | EVER 智识 | 6,268 | 智能识别（URL / 计算 / QQ 号 → 自动路由） |
| 6 | EVER 重命名 | 6,024 | 批量文件重命名（含撤销） |
| 7 | 快搜 | 3,146 | 多搜索引擎切换 |
| 8 | Everything | 1,924 | 本地文件搜索（Win 专属） |
| 9 | 截图识别 | 2,457 | 20 种识别模式 + 60 种文本处理 |
| 10 | PDF 处理 | 640 | 71 种 PDF 操作（合并/分割/解密） |

### 关键洞察

1. **截图 + OCR 占断层第一** —— 前 2 名占用户基数 ≈ 23 万。截屏是 Quicker 的真正杀手锏
2. **剪贴板历史管理器** —— 不是单次转换，是**持久化历史 + 浮窗回溯**
3. **聚合 19 个翻译源** —— 一个 Tool 多 actions 的最佳示范
4. **EVER 智识** —— 智能识别 + 路由是产品差异化方向（"按一次知道你在干嘛"）
5. **文本工具（base64 / 大小写 / 字数）几乎进不了 Top 50** —— 之前 v0.1 选择偏错

---

## 2. CTRL 实现矩阵

### 阶段 v0.1（修正）—— 现有引擎能做（不动 Rust）

| Quicker 对标 | CTRL 工具 | 实现方案 | 工作量 |
|---|---|---|---|
| **Translator** | 聚合翻译 Tool | 单一 manifest，多 actions（Google / DeepL / 有道 / 百度 / Bing），每个 action 是 `open-url` | **0.5 天**（含 React 多 action UI） |
| 快搜 | 聚合搜索 Tool | 同上，多 actions（Google / Baidu / Bing / GitHub / 知乎 / 微博 / B 站） | **0.5 天**（同上 UI 复用） |
| 文本工具（小子集） | base64 / json-pretty / url 编解码 | 已有 ✅ | 已完成 |

**v0.1 panel 总数从 15 缩到 ~8 个 Tools（13 个 actions）**，去掉低频长尾，集中到「翻译 Tool（6 actions）+ 搜索 Tool（7 actions）+ 开发者工具（5 个）+ Markdown（1 个）」= 真高频结构。

### 阶段 v0.2 —— Slice 2 / 必做（覆盖 Quicker 核心）

| # | Quicker 对标 | CTRL 工具 | 需要新增 | 工作量 |
|---|---|---|---|---|
| 1 | **截图** | 截图工具 | `ScreenCapturePort`（macOS `screencapture` 命令）+ `screencapture` step type | **1 天** |
| 2 | **截图 OCR** | OCR 工具 | `OcrPort`（**macOS Vision Framework** 经 objc2-vision，免费 + 本地 + 中英都强）+ `ocr` step type | **2 天** |
| 3 | **剪贴板历史** | 剪贴板历史 | `ClipboardHistoryPort` + 后台轮询 `NSPasteboard.changeCount` + SQLite 持久化 + 历史浮窗 UI | **2-3 天** |
| 4 | **AI 翻译/改写/总结** | AI 工具集（Translator AI 升级版） | `LlmPort`（Anthropic + OpenAI + DeepSeek + Ollama） + `llm` step type + 用户自带 key 引导 | **2 天** |
| 5 | **EVER 智识** | 智能识别路由 | `branch` step type（按 var 值分支）+ `smart-detect` transform op（regex 识别 URL/email/计算式/QQ/中英） | **1.5 天** |

**v0.2 总工时**：8.5–9.5 天 · 从此 CTRL 覆盖 Quicker Top 5 的 4 个（除 EVER 重命名要等 v0.3 文件 port）

### 阶段 v0.3 —— 进阶 / 开发者向

| # | Quicker 对标 | CTRL 工具 | 需要新增 | 工作量 |
|---|---|---|---|---|
| 6 | EVER 重命名 | 批量文件重命名 | `FileSystemPort`（list / rename / move）+ 文件选择器 webview + 规则引擎 + 预览 | **3–4 天** |
| 7 | PDF 处理 | PDF 工具集 | `lopdf` Rust crate / 调 `pdftools` 命令 + `pdf-merge / pdf-split / pdf-extract` step types | **5–7 天** |
| 8 | 窗口神器 | 窗口管理 | `WindowServerPort`（macOS Accessibility AX API 控制窗口）+ 预设布局（半屏/四分屏/居中） | **3–4 天** |
| 9 | 颜色精灵 | 颜色拾取 / 调色板 | macOS `digitalcolormeter` 或 swift-bridge + 历史调色板 SQLite | **1–2 天** |
| 10 | 极速预览 | 文件 QuickLook | macOS `qlmanage` 命令包装即可 | **0.5 天** |

---

## 3. 真高频 Top 5 的实现深度方案

### 3.1 截图（v0.2 #1）

**Quicker 怎么做**：调 Win 截屏 API（`PrintScreen` / `Win+Shift+S`）；返回图片到剪贴板或暂存。

**CTRL 方案**：调 macOS 原生 `screencapture` 命令。

```rust
// adapters/outbound/macos/screencapture.rs
pub trait ScreenCapturePort {
    fn capture_region(&self) -> Result<PathBuf>;     // 区域选择（screencapture -i）
    fn capture_fullscreen(&self) -> Result<PathBuf>; // 整屏（screencapture）
    fn capture_window(&self) -> Result<PathBuf>;     // 窗口（screencapture -w）
}

impl ScreenCapturePort for MacScreenCapture {
    fn capture_region(&self) -> Result<PathBuf> {
        let path = std::env::temp_dir().join(format!("ctrl-{}.png", uuid()));
        Command::new("screencapture")
            .arg("-i")     // interactive (drag region)
            .arg("-o")     // no shadow
            .arg(&path)
            .status()?;
        Ok(path)
    }
}
```

新 step type: `screencapture { mode: "region" | "full" | "window", as: "img" }` 输出图片路径。

### 3.2 截图 OCR（v0.2 #2）

**关键决策**：用 **macOS Vision Framework**（不上云，免费，质量高，原生）。

**绑定方案**：用 `objc2-vision` 或自己写 FFI，调 `VNRecognizeTextRequest`。

```rust
pub trait OcrPort {
    fn recognize(&self, image_path: &Path, langs: &[&str]) -> Result<String>;
}
```

新 step type: `ocr { input: img_path, langs: ["zh", "en"], as: "text" }`。

链式用法：截图 → OCR → 写剪贴板（或调 LLM 总结）。

### 3.3 剪贴板历史（v0.2 #3）

**架构**：

```
后台 ClipboardWatcher 线程
  ↓ 轮询 NSPasteboard.changeCount（200ms）
  ↓ 检测变化 → push 到 SQLite
SQLite 持久化（最近 1000 条，文本/图片/文件）
  ↓
ClipboardHistoryPort.list(limit) / restore(idx)
  ↓
新工具「剪贴板历史」：弹一个 ListPanel UI 显示最近 50 条，点击恢复
```

新 step types: `clipboard-history-pick`（交互式弹列表）、`clipboard-history-list`（返回数组）。

### 3.4 AI 工具集（v0.2 #4）

**LlmPort 设计**：

```rust
pub trait LlmPort {
    fn chat(&self, model: &str, prompt: &str) -> Result<String>;
    fn chat_stream(&self, model: &str, prompt: &str) -> impl Stream<String>;
}
```

适配器：
- `AnthropicAdapter`（Claude Haiku / Sonnet / Opus）
- `OpenAiAdapter`（GPT-4 / GPT-4o）
- `DeepSeekAdapter`（DeepSeek-V3，便宜的中文）
- `OllamaAdapter`（本地，零成本）

新 step type: `llm { model, prompt_template, stream: bool, as }`。

3 个 AI 工具示范：
- **AI 翻译**：剪贴板 + prompt "翻译成中文：{{clip}}" → 流式输出 → 写剪贴板
- **AI 改写**：剪贴板 + 多 actions（知乎风格 / 邮件风格 / 朋友圈风格）
- **AI 总结**：剪贴板（长文）+ prompt "用 3 句话总结：{{clip}}" → notify 显示

**用户自带 key**：v0.1 简化路径，setting 里填一次。

### 3.5 智能识别（v0.2 #5，CTRL 差异化）

**Quicker EVER 智识**：识别选中文本类型，自动选合适的动作。

**CTRL 方案**：扩展 step engine 支持分支。

新 step type: `branch`：

```json
{
  "type": "branch",
  "var": "{{clip}}",
  "cases": [
    { "match": "regex:^https?://", "do": [{ "type": "open-url", "url": "{{clip}}" }] },
    { "match": "regex:^[\\d+\\-*/() ]+$", "do": [{ "type": "transform", "op": "calculate" }] },
    { "match": "regex:^[\\w.+-]+@", "do": [{ "type": "open-url", "url": "mailto:{{clip}}" }] }
  ],
  "default": [{ "type": "notify", "message": "未识别" }]
}
```

可识别类型（regex 起步）：
- URL（http/https）→ 浏览器打开
- 邮箱 → mailto:
- 中国手机号 → 拨号 / 复制
- 计算式（含 +-*/）→ 计算结果
- IP 地址 → ipinfo.io 查
- 中文 → 翻译成英文
- 英文 → 翻译成中文

---

## 4. 推荐路线

### 这一轮（v0.1 修正）—— 0.5 天

按 Quicker Top 4 / Top 7 模式做"聚合 Tool"：

1. **聚合翻译 Tool**：1 个 manifest，6 个 actions（Google / DeepL / 有道 / 百度 / Bing / 微软）
2. **聚合搜索 Tool**：1 个 manifest，7 个 actions（Google / Baidu / Bing / GitHub / 知乎 / 微博 / B 站）
3. **删低频**：Markdown 标题 / 字数统计 / 单独的搜索工具（合并到聚合搜索里）
4. **改 React UI**：tool 多 action 时展开二级列表

总数从 15 缩到 **8 个 Tools**（含 13 个 actions）：
- 聚合翻译（6 actions）
- 聚合搜索（7 actions）
- Markdown 引用
- 大写 / 小写
- Base64 编码 / 解码
- JSON 美化
- URL 编码 / 解码

### 下一轮（v0.2 真正的杀手锏）—— 8.5-9.5 天

按 Quicker Top 5 实施：截图 → OCR → 剪贴板历史 → AI 工具 → 智能识别。

到这里 CTRL **覆盖 Quicker Top 5 中的 4 个**，且其中 AI 工具是 Quicker 没有的差异化（Quicker 全靠 URL 跳转，无原生 LLM）。

### 再下一轮（v0.3 进阶）—— 开发者 / 文件向

文件重命名 / PDF 处理 / 窗口管理 / 颜色拾取 / QuickLook。

---

## 5. 战略意义

**CTRL 不该模仿 Quicker 的全部 8000 个动作**——绝大多数是长尾、Win 专属、或低质。

**CTRL 该做的是**：
1. **Quicker Top 10 中的 6 个**（截图 / OCR / 剪贴板历史 / 翻译聚合 / 搜索聚合 / 智能识别）—— 用 macOS 原生 API 重做，质量比 Quicker 平均水平高
2. **Quicker 没有的差异化**：原生 AI 工具集（LlmPort + 翻译/改写/总结）+ 工具市场分发的 partner program
3. **Quicker 长尾不抄**（base64 / 小工具 / Win 专属 App 集成）

这就是 PRD §7.5 聚合策略 + §7.6 vs 飞书 的具体落地：**CTRL 是 OPC 段的 Quicker × Raycast × Cherry Studio 的中文圈版，重做 Top 10 + 加 AI 杠杆 + 走开放 manifest 生态**。

---

## 变更日志

- **2026-05-04**：初版整合 —— Quicker Top 10 真实数据 + 实现矩阵 + v0.1/v0.2/v0.3 路线 + 5 个核心工具实现深度方案。基于真实使用数据修正了 v0.1 的工具选择（之前的 base64 / 大小写 / 多搜索引擎选择偏跑偏，应聚焦"聚合"模式 + 截图/OCR/剪贴板历史/AI 这些真高频）。

---

## 6. AI 加持后的工具矩阵（v0.1 路线再修正）

> **核心洞察**：Quicker 是 pre-AI 产物，每个 Quicker 工具加 AI 后能力被放大 5-20 倍。CTRL 不是「聚合 Quicker 工具」，是「AI-first 的工具合集」。

### Quicker Top 10 × AI 加持的价值差

| Quicker 工具 | Quicker 版（无 AI） | + AI 版本 | 提升 |
|---|---|---|---|
| 截图 | 截一张图 | 截屏 → Claude/GPT-4V 看图 → "这段代码什么 bug" / "图里说啥" | **10×** |
| 截图 OCR | OCR 出纯文本 | OCR → LLM 总结 / 翻译 / 转 Markdown 表 / 提取发票关键字段 | **5×** |
| 剪贴板历史 | 关键词搜历史 | embedding 语义搜索 + 自动分类 + 跨条目总结 | **3×** |
| Translator | 跳 Google Translate 网页 | 直接 LLM 翻译，上下文感知，不切窗口 | **2×** + UX 飞跃 |
| EVER 智识 | regex 识别类型 → 路由 | LLM 识别 + 直接回答 | **5×** |
| EVER 重命名 | 规则引擎模板 | "按发票日期重命名" → LLM 看内容生成 | **8×** |
| 快搜 | 跳搜索引擎页 | Perplexity 模式直接 AI 答 | **3×** |
| PDF 处理 | 合并 / 分割 | AI 总结 / AI 翻译保留排版 / 提取合同条款 | **20×** |

### 双层结构：免费版 + AI 版

**免费版**（无需 API key，立刻可用）：
- 开发者工具：base64 编/解、json-pretty、url 编/解、Markdown 引用
- 文本：大写、小写
- 搜索：跳网页搜索（Google / Baidu / GitHub / 知乎）

**AI 版**（首次使用提示填 key，加密存 macOS Keychain）：
- AI 翻译（流式）
- AI 改写（多风格）
- AI 总结
- AI 解释（"这是什么"）
- AI 代码解释 / 修 bug

UX 设计：
- AI 工具默认列在面板（不灰显）
- 首次点击未配置时弹 onboarding wizard
- 配置完后正常运行
- 设置面板可换 provider / 改 key

### 多 Provider 策略

绝大多数 LLM provider 提供 **OpenAI 兼容 API**，可用一个泛用适配器覆盖：

| Provider | 类型 | endpoint | 推荐场景 |
|---|---|---|---|
| **阿里通义千问** | OpenAI-compat | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 中文 OPC 默认（便宜 + 中文好） |
| **DeepSeek** | OpenAI-compat | `https://api.deepseek.com/v1` | 极便宜 + 代码强 |
| **MoonShot Kimi** | OpenAI-compat | `https://api.moonshot.cn/v1` | 长上下文 |
| **智谱 GLM** | OpenAI-compat | `https://open.bigmodel.cn/api/paas/v4` | 国产替代 |
| **OpenAI** | OpenAI 原生 | `https://api.openai.com/v1` | 国际默认 |
| **Anthropic Claude** | 原生（不兼容 OpenAI） | `https://api.anthropic.com/v1` | 写作 / 推理 |
| **Ollama 本地** | OpenAI-compat | `http://localhost:11434/v1` | 离线 / 隐私 |

**适配器策略**：
- `OpenAiCompatibleAdapter` —— 用户填 base_url + key + model，覆盖 7 家中的 6 家
- `AnthropicAdapter` —— 单独适配 Claude 原生 messages API
- 默认推阿里通义（中文 + 便宜），但用户可换

### v0.1 AI-first 路线（修正版，约 4 天）

| # | 类型 | 项 | 工时 |
|---|---|---|---|
| 1 | 基建 | LlmPort + OpenAiCompatibleAdapter + AnthropicAdapter | 1 天 |
| 2 | 基建 | macOS Keychain 集成（rust-keyring crate）+ 配置文件 | 0.5 天 |
| 3 | 基建 | 首次配置 wizard（React 多步引导，含教程链接到各家申请 key 页） | 1 天 |
| 4 | step | 新 step type `llm { provider, model, prompt, stream, as }` | 0.5 天 |
| 5 | UI | 流式输出在面板里实时渲染 | 0.5 天 |
| 6 | 工具 | 5 个 AI 工具 manifest（翻译/改写/总结/解释/代码解释） | 0.5 天 |

**v0.1 panel = 11 个 Tools**：
- AI 翻译 / AI 改写 / AI 总结 / AI 解释 / AI 代码解释（5 个，需 key）
- Markdown 引用 / Base64 编/解 / JSON 美化 / URL 编/解（5 个，免费）
- 大写 / 小写 合并成 1 个 Tool 2 actions（免费）

**删的低频长尾**：单独的搜索工具（4 个）、Markdown 标题、字数统计——理由：AI 时代搜索被 AI 答取代，标题/字数很少高频。

### v0.2 重排（按 AI 价值）

1. **截图 + AI 看图**（macOS screencapture + Claude Vision / 通义千问 VL）—— Quicker Top 1 的 AI 升级
2. **AI 智能路由**（LLM 看输入自动选工具/直接答）—— EVER 智识 v2，CTRL 真正的差异化
3. **剪贴板历史 + 语义搜索**（embedding 索引）

### 决策（2026-05-04）

| # | 决策 | 选择 |
|---|---|---|
| D9 | v0.1 形态 | **AI-first + 免费版基础工具混合**（不全 AI、不全无 AI） |
| D10 | LLM provider 默认 | **阿里通义千问**（中文 OPC 友好），UI 可切换 6 家 |
| D11 | API key 处理 | **用户自带 + macOS Keychain 加密** |
| D12 | 免费版边界 | 不依赖 LLM 的所有工具均为免费版可用 |

