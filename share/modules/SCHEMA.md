# CTRL Tool Manifest Schema (v0.1)

CTRL 的工具是声明式的：JSON 定义元数据 + 步骤序列。无需写代码即可发布。

## 顶级 Tool 字段

```json
{
  "$schema": "https://ctrlapplab.com/schema/tool/v1.json",
  "id": "ctrl.builtin.markdown-quote",
  "name": "Markdown 引用",
  "version": "0.1.0",
  "author": { "name": "CTRL App Lab", "github": "ctrlapplab" },
  "description": { "short": "...", "long": "..." },
  "icon": "❝",
  "category": "markdown-document",
  "tags": ["markdown", "format"],
  "permissions": ["clipboard"],
  "settings": [],
  "actions": [ ... ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✓ | 全局唯一，倒序域名风格 |
| `name` | ✓ | 显示名 |
| `version` | ✓ | semver |
| `author` | ✓ | `{ name, github?, url?, avatar? }` |
| `description.short` | ✓ | ≤ 80 字 |
| `description.long` | | Markdown |
| `icon` | ✓ | URL / inline base64 / emoji（v0.1 emoji 即可） |
| `category` | ✓ | 单一主分类（见 product-spec §7.10） |
| `tags` | | 自由字符串数组 |
| `permissions` | ✓ | 数组：clipboard / network / shell / files / screenshot |
| `settings` | | 用户可配项 schema（v0.2 起） |
| `actions` | ✓ | Action 数组 |

## Action 字段

```json
{
  "id": "wrap-selection",
  "name": "包裹为引用",
  "description": "...",
  "input": "selection",
  "output": "clipboard",
  "scenes": ["any-app"],
  "steps": [ ... ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✓ | tool 内唯一 |
| `name` | ✓ | 显示名 |
| `description` | | 一句话 |
| `input` | ✓ | `none / selection / clipboard / freetext / file` |
| `output` | ✓ | `none / clipboard / replace-selection / modal / browser / notify` |
| `scenes` | | 默认 `["any-app"]`；其他：`App(bundle_id)` / `TextEditor` / `BrowserUrl(regex)` |
| `steps` | ✓ | Step 数组，按顺序执行 |

## Step 类型（v0.1）

| `type` | 字段 | 输出 |
|---|---|---|
| `capture-selection` | `as?: string` | 当前选中文本 |
| `capture-clipboard` | `as?: string` | 剪贴板内容 |
| `template` | `template: string`, `as?: string` | Handlebars-like 渲染（`{{$prev}} {{$selection}} {{$clipboard}} {{name}}`） |
| `transform` | `op: string`, `input: string`, `as?: string` | 对 `input` 应用 `op` 后的结果 |
| `write-clipboard` | `value: string` | 副作用 |
| `open-url` | `url: string`（可含模板） | 副作用 |
| `notify` | `message: string`（可含模板） | 副作用 |
| `http` | `method, url, headers?, body?` | response body |
| `shell` | `cmd, args?` | stdout |
| `llm`（Slice 2） | `model, prompt` | LLM 输出 |

### `transform` 内置 op

| op | 说明 |
|---|---|
| `uppercase` | 全大写 |
| `lowercase` | 全小写 |
| `titlecase` | 单词首字母大写 |
| `trim` | 去首尾空白 |
| `reverse` | 字符串反转 |
| `urlencode` | URL 百分号编码 |
| `urldecode` | URL 百分号解码 |
| `wordcount` | 返回 `字符 X / 单词 Y / 行 Z` |
| `length` | 字符数 |

## 变量

- 每步可指定 `as: "name"`，把输出绑到变量 `name`
- 未指定 `as` 时输出绑到 `$prev`
- 内置变量：`$selection`、`$clipboard`、`$foreground_app`、`$cursor_x`、`$cursor_y`
- 模板用 `{{name}}` 引用任意变量

## Permissions

| 值 | 含义 |
|---|---|
| `clipboard` | 读写剪贴板 |
| `network` | HTTP 请求 |
| `shell` | 执行子进程 |
| `files` | 读写文件 |
| `screenshot` | 截屏 |

CTRL 在工具安装前展示 permission 列表给用户确认；运行时 host 强制 enforce。

## 完整示例

见 `share/modules/builtin/markdown-quote/manifest.json`。
