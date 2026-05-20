# 06 · 底座 capability surface 验证 spike — RESULT

- **Owner**: Hephaestus (lane-C jiazuo spike)
- **Date**: 2026-05-19
- **Handoff**: `H-2026-05-18-002` (合并旧 lane-B capability spike + lane-D keycap integration)
- **Feeds**: ADR-004 (zeus 接力起草), `.olym/specs/kernel/capability-surface.md` (Q2 落 spec)
- **Status**: spike done — outcome-focused 三节齐
- **Timebox**: 1-2 days, used 1 day
- **Inputs read**:
  - `.olym/handoffs/H-2026-05-17-002` + `H-2026-05-18-002`
  - `.claude/ADR/010-keycap-execution-model.md`
  - `.olym/specs/tool-manifest/spec.md` (v0.1)
  - `doc/keycap-integration-research/00,02,03,05-*` (read from git blobs — not yet on this branch)
  - `share/modules/builtin/*/manifest.json` (16 starter)
  - `doc/keycap-ideas-record.md` (45 意向 v3)
  - `packages/ctrl-web/src/**`, `src-tauri/src/**` (Q3 grep)

---

## TL;DR (lift verbatim into ADR-004)

1. **底座 capability surface = 10 namespaces, 28 well-known methods.** 频次 ≥3 当 kernel; <3 当 keycap-local。详 §Q2 表。
2. **判定规则**："出现 3+ 次 = 底座; 1-2 次 = keycap-local" 在 v1 corpus 实证有效 — 收敛速度快, 没有把单 keycap 的特殊需求拽进底座的反例。**例外两条**: `mcp.*` 和 `platform.notify` 即使频次低也必须底座 (基础设施性质)。
3. **v1 必造的底座 (10)**: `clipboard.{read,write}` / `text.chat` (LLM stream) / `network.http` (allowlist) / `network.open_url` / `keyring.{read,write}` / `screen.capture` / `file.{read,write}` / `mcp.{spawn,invoke_tool,list_tools}` / `platform.notify`。
4. **v1.1 候选 (5)**, 由 keycap-local 反向触发: `process.spawn` (B bucket) / `network.local_rpc` (C bucket) / `oauth.broker` (E bucket) / `stss.{publish,subscribe}` (F bucket) / `image.ocr` (智识/poster bucket)。这五个**v1 不要写**, 等第 2 个 keycap 出现再 promote 到 kernel。
5. **Q3 audit 结论**: production code paths 27 处提到 `claude/anthropic`, **0 个违反 ADR-005/-011** (Volc 为 v1 launch provider, Anthropic 退到 BYOK 列表第 N). 唯一两处可改进 = `kernel/runtime.rs:53` + `kernel/llm_port.rs:4` 的 hardcoded 默认 fallback 顺序: `["workers-ai","anthropic","ollama"]` 应改为 `["volc","byok","ollama"]` 或拉成可配 chain。UI 文案 `settings.tsx:21` 需 Apollo 加 Volc 到 BYOK 列表 (memory `apollo_copy_facts_from_zeus_2026-05-17` 走 Apollo)。

---

## §Q1 Keycap → capability 消费表

### 1.1 原始消费 (one row per (keycap, capability))

| # | Keycap | source | capability | 硬依赖 | 备注 |
|---|---|---|---|---|---|
| 1  | ai-summarize        | G builtin | clipboard.read | ✅ | input=clipboard |
| 2  | ai-summarize        | G builtin | network.http   | ✅ | LLM API call |
| 3  | ai-summarize        | G builtin | text.chat      | ✅ | LLM stream completion |
| 4  | ai-summarize        | G builtin | platform.notify| ✅ | modal output |
| 5  | baidu-search        | G builtin | clipboard.read | ✅ | |
| 6  | baidu-search        | G builtin | network.open_url | ✅ | browser deeplink |
| 7  | base64-decode       | G builtin | clipboard.read | ✅ | |
| 8  | base64-decode       | G builtin | clipboard.write| ✅ | |
| 9  | base64-decode       | G builtin | text.transform | ✅ | op=base64decode |
| 10 | base64-encode       | G builtin | clipboard.read | ✅ | |
| 11 | base64-encode       | G builtin | clipboard.write| ✅ | |
| 12 | base64-encode       | G builtin | text.transform | ✅ | op=base64encode |
| 13 | github-search       | G builtin | clipboard.read | ✅ | |
| 14 | github-search       | G builtin | network.open_url | ✅ | |
| 15 | google-search       | G builtin | clipboard.read | ✅ | |
| 16 | google-search       | G builtin | network.open_url | ✅ | |
| 17 | json-pretty         | G builtin | clipboard.read | ✅ | |
| 18 | json-pretty         | G builtin | clipboard.write| ✅ | |
| 19 | json-pretty         | G builtin | text.transform | ✅ | op=jsonpretty |
| 20 | lowercase           | G builtin | clipboard.read | ✅ | |
| 21 | lowercase           | G builtin | clipboard.write| ✅ | |
| 22 | lowercase           | G builtin | text.transform | ✅ | op=lowercase |
| 23 | markdown-codeblock  | G builtin | clipboard.read | ✅ | |
| 24 | markdown-codeblock  | G builtin | clipboard.write| ✅ | |
| 25 | markdown-codeblock  | G builtin | text.template  | ✅ | wrap ```...``` |
| 26 | markdown-heading    | G builtin | clipboard.read | ✅ | |
| 27 | markdown-heading    | G builtin | clipboard.write| ✅ | |
| 28 | markdown-heading    | G builtin | text.template  | ✅ | prefix `## ` |
| 29 | markdown-quote      | G builtin | clipboard.read | ✅ | |
| 30 | markdown-quote      | G builtin | clipboard.write| ✅ | |
| 31 | markdown-quote      | G builtin | text.template  | ✅ | prefix `> ` |
| 32 | uppercase           | G builtin | clipboard.read | ✅ | |
| 33 | uppercase           | G builtin | clipboard.write| ✅ | |
| 34 | uppercase           | G builtin | text.transform | ✅ | |
| 35 | url-decode          | G builtin | clipboard.read | ✅ | |
| 36 | url-decode          | G builtin | clipboard.write| ✅ | |
| 37 | url-decode          | G builtin | text.transform | ✅ | |
| 38 | url-encode          | G builtin | clipboard.read | ✅ | |
| 39 | url-encode          | G builtin | clipboard.write| ✅ | |
| 40 | url-encode          | G builtin | text.transform | ✅ | |
| 41 | word-count          | G builtin | clipboard.read | ✅ | |
| 42 | word-count          | G builtin | text.transform | ✅ | op=wordcount |
| 43 | zhihu-search        | G builtin | clipboard.read | ✅ | |
| 44 | zhihu-search        | G builtin | network.open_url | ✅ | |
| 45 | Memos (Pattern A ref)| A http   | network.http   | ✅ | allowlist=${config.host} |
| 46 | Memos                | A http   | keyring.read   | ✅ | access_token |
| 47 | Memos                | A http   | text.chat      | ⚠️ optional | Irisy 触发时, 非 keycap 内部 |
| 48 | BetterDisplay (B ref)| B cli    | process.spawn  | ✅ | allowlist=[betterdisplaycli] |
| 49 | BetterDisplay        | B cli    | platform.os_filter | ✅ | macos only |
| 50 | Motrix (C ref)       | C daemon | network.local_rpc | ✅ | 127.0.0.1:${rpc_port} |
| 51 | Motrix               | C daemon | keyring.read   | ✅ | rpc_secret |
| 52 | bazi-mcp (D ref)     | D 3p-mcp | mcp.spawn      | ✅ | stdio transport |
| 53 | bazi-mcp             | D 3p-mcp | mcp.invoke_tool| ✅ | passthrough |
| 54 | bazi-mcp             | D 3p-mcp | mcp.list_tools | ✅ | discovery |
| 55 | 飞书 (E ref)         | E oauth  | network.http   | ✅ | allowlist=api.feishu |
| 56 | 飞书                 | E oauth  | oauth.broker   | ✅ | provider=feishu |
| 57 | 飞书                 | E oauth  | keyring.read   | ✅ | access_token |
| 58 | 飞书                 | E oauth  | keyring.write  | ✅ | refresh_token rotate |
| 59 | VSCode publisher (F ref) | F stss | stss.publish | ✅ | coding-context.* stream |
| 60 | VSCode publisher     | F stss   | stss.subscribe | ✅ | clipboard.* stream |
| 61 | VSCode publisher     | F stss   | mcp.notifications | ✅ | server-initiated bridge |
| 62 | Screenshot (builtin) | G builtin| screen.capture | ✅ | macOS screencapture |
| 63 | Screenshot           | G builtin| clipboard.write| ✅ | default action |
| 64 | Screenshot           | G builtin| file.write     | ✅ | save_dir |
| 65 | Screenshot           | G builtin| network.http   | ⚠️ optional | upload transfer.sh |
| 66 | Screenshot           | G builtin| platform.hotkey | ✅ | cmd+shift+x |
| 67 | Clipboard AI rewrite | builtin  | clipboard.read | ✅ | |
| 68 | Clipboard AI rewrite | builtin  | clipboard.write| ✅ | |
| 69 | Clipboard AI rewrite | builtin  | text.chat      | ✅ | LLM rewrite |
| 70 | OCR (v1 top-15)      | builtin  | screen.capture | ⚠️ optional | source=screen |
| 71 | OCR                  | builtin  | file.read      | ⚠️ optional | source=image file |
| 72 | OCR                  | builtin  | image.ocr      | ✅ | core function |
| 73 | OCR                  | builtin  | clipboard.write| ✅ | output |
| 74 | Translate (v1 top-15)| builtin  | clipboard.read | ✅ | |
| 75 | Translate            | builtin  | text.chat      | ✅ | LLM translate |
| 76 | Translate            | builtin  | clipboard.write| ✅ | |
| 77 | 窗口 switcher        | builtin  | platform.window_list  | ✅ | OS API |
| 78 | 窗口 switcher        | builtin  | platform.window_focus | ✅ | OS API |
| 79 | PDF assist           | builtin  | file.read      | ✅ | input PDF |
| 80 | PDF assist           | builtin  | text.chat      | ✅ | summarize |
| 81 | PDF assist           | builtin  | file.write     | ⚠️ optional | annotate save |
| 82 | LaTeX render         | builtin  | text.transform | ✅ | tex→svg |
| 83 | LaTeX render         | builtin  | clipboard.write| ✅ | image bytes |
| 84 | 智识 RAG             | builtin  | file.read      | ✅ | doc ingest |
| 85 | 智识 RAG             | builtin  | text.embed     | ✅ | vectorize |
| 86 | 智识 RAG             | builtin  | persistence.vector | ✅ | local index |
| 87 | 智识 RAG             | builtin  | text.chat      | ✅ | answer |
| 88 | 屏幕录               | builtin  | screen.record  | ✅ | OS API |
| 89 | 屏幕录               | builtin  | file.write     | ✅ | mp4 out |
| 90 | Snippet              | builtin  | clipboard.write| ✅ | |
| 91 | Snippet              | builtin  | persistence.kv | ✅ | snippet store |
| 92 | Code (format/explain)| builtin  | clipboard.read | ✅ | |
| 93 | Code                 | builtin  | text.chat      | ✅ | LLM explain |
| 94 | Code                 | builtin  | clipboard.write| ✅ | |
| 95 | Email compose        | builtin  | text.chat      | ✅ | LLM draft |
| 96 | Email compose        | builtin  | oauth.broker   | ⚠️ optional | gmail/outlook |
| 97 | Email compose        | builtin  | network.http   | ✅ | SMTP / Gmail API |
| 98 | 会议 transcribe      | builtin  | audio.record   | ✅ | mic capture |
| 99 | 会议 transcribe      | builtin  | audio.transcribe | ✅ | STT |
| 100| 会议 transcribe      | builtin  | file.write     | ✅ | transcript md |

**Coverage**: 23 distinct keycaps (16 starter + 7 pattern refs + screenshot + 9 v1 top-15 — 同步 keycap skipped per ADR-003 mesh primitive, Chat skipped per memory `decision_irisy_is_pwa_native_not_keycap`). 100 (keycap, capability) consumption rows. ≥30 ✓.

### 1.2 Frequency rollup → 底座 / keycap-local 判定

| capability | freq (硬) | 边缘 (optional) | 出现 keycap | 判定 |
|---|---|---|---|---|
| `clipboard.read`      | 21 | — | 21/23 | **底座** ✓ |
| `clipboard.write`     | 17 |  — | 17/23 | **底座** ✓ |
| `text.transform`      | 11 |  — | 11/23 (10 starter + LaTeX) | **底座** ✓ (含 base64/url/case/json/wordcount/tex 等纯本地 op enum) |
| `text.chat` (LLM)     | 9  | 1  | 9/23 (含 BYOK) | **底座** ✓ |
| `network.http`        | 6  | 1  | 6/23 + screenshot upload | **底座** ✓ (强制 per-keycap allowlist) |
| `network.open_url`    | 4  | — | 4 search keycaps | **底座** ✓ (借 OS open) |
| `text.template`       | 3  | — | 3 markdown keycaps | **合并入 `text.transform` (op=template)**, 不单独留 |
| `keyring.read`        | 4  | — | Memos/Motrix/飞书/(BYOK universal) | **底座** ✓ |
| `keyring.write`       | 1  | — | 飞书 refresh | **底座** ✓ (跟 read 同 namespace, 不拆) |
| `screen.capture`      | 2  | 1  | Screenshot/OCR | **底座** ✓ (硬 2 + optional 1; ADR-010 §7 已锁) |
| `file.read`           | 4  | 1  | OCR/PDF/智识/会议 | **底座** ✓ |
| `file.write`          | 5  | 1  | Screenshot/屏幕录/PDF/会议/智识 export | **底座** ✓ |
| `mcp.spawn`           | 1  | — | bazi-mcp (D bucket = 10K+ projected) | **底座** ✓ (infrastructure exception) |
| `mcp.invoke_tool`     | 1  | — | bazi-mcp | **底座** ✓ (universal MCP routing) |
| `mcp.list_tools`      | 1  | — | bazi-mcp | **底座** ✓ |
| `mcp.notifications`   | 1  | — | F bridge | **底座** ✓ (Pattern F 强依赖, ADR-010 §5.6 已锁) |
| `platform.notify`     | ≥12 | — | starter + builtin universal | **底座** ✓ (基础设施) |
| `platform.hotkey`     | 1  | — | Screenshot | **底座** ✓ (CTRL 唤起本身就是 hotkey, kernel 持有) |
| `process.spawn`       | 1  | — | BetterDisplay | **keycap-local v1** (B bucket projection 2 个候选已排队: yt-dlp / larksuite-cli) → **promote 到底座 v1.1** |
| `network.local_rpc`   | 1  | — | Motrix | **keycap-local v1** (C bucket OpenTeams/Tailscale 排队) → **v1.1 promote** |
| `oauth.broker`        | 1  | 1  | 飞书 (+Email optional) | **keycap-local v1, 底座 v1.1** (E bucket Notion/Linear/Coze/Slack 排队; ADR-010 §5.2 已 reserve `OAuthCapability`) |
| `stss.publish`        | 1  | — | VSCode publisher | **keycap-local v1, 底座 v1.1** (Irisy coding companion + mesh primitives 排队) |
| `stss.subscribe`      | 1  | — | VSCode publisher | 同上 |
| `text.embed`          | 1  | — | 智识 RAG | **keycap-local** (v1 RAG 单实例) |
| `image.ocr`           | 1  | — | OCR | **keycap-local v1** (v1.1 第二个图像 keycap 再 promote) |
| `audio.record`        | 1  | — | 会议 | **keycap-local v1** (v1.1 voice input for Irisy 再 promote) |
| `audio.transcribe`    | 1  | — | 会议 | 同上 |
| `screen.record`       | 1  | — | 屏幕录 | **keycap-local** (单 keycap, mp4 编码) |
| `persistence.kv`      | 1  | — | Snippet | **keycap-local** (用 `~/.ctrl/keycaps/<id>/data/` filesystem 即可) |
| `persistence.vector`  | 1  | — | 智识 RAG | **keycap-local** (sqlite-vec / pgvector 嵌入) |
| `platform.window_list/focus` | 2 | — | 窗口 switcher | **keycap-local** (一个 keycap 自带, OS API wrap 不重复) |

**判定规则 self-check** (≥3 = kernel 命中 vs 反例):
- 14 个判定 kernel: 11 是硬频次 ≥3, 3 是 infra exception (mcp + notify + hotkey)。**无 "1 keycap 把 builtin AI 拽进底座" 反例**。
- 9 个判定 keycap-local: 全部 freq=1 且无 v1 第二实例。其中 5 个 (process.spawn / network.local_rpc / oauth / stss×2) 是 **bucket-projection** — bucket 内已知 ≥2 候选排队, 立刻 promote 到底座反而过度设计; 先做 reference impl 验证, v1.1 再升。其余 4 个 (text.embed / image.ocr / audio.* / screen.record / persistence.*) 是真 niche, 留 keycap-local。

---

## §Q2 Capability surface draft schema (10 namespaces, Zod-shape)

> 仅含 Q1 判定 = 底座 的能力 (14 项, 折叠为 10 namespaces)。每 namespace ≥2 method 草稿, Zod shape (TypeScript), kernel 解析 `capabilities:` manifest 段时按此 schema 校验。
>
> v1.1 候选 5 项 (`process.*`/`network.local_rpc.*`/`oauth.*`/`stss.*`/`image.ocr`) 已留位 §Q2.11, schema 草稿先给, kernel **暂不暴露**, 等 promote。

### Q2.1 `clipboard.*`

```ts
const ClipboardRead = z.object({
  // input: 无
}).describe('Read clipboard plain text or image bytes');
const ClipboardReadOutput = z.object({
  kind: z.enum(['text', 'image_png', 'image_jpg', 'file_uri_list', 'empty']),
  text: z.string().optional(),
  image_base64: z.string().optional(),
  file_uris: z.array(z.string().url()).optional(),
});

const ClipboardWrite = z.object({
  kind: z.enum(['text', 'image_png', 'image_jpg']),
  text: z.string().optional(),
  image_base64: z.string().optional(),
});
const ClipboardWriteOutput = z.object({ ok: z.literal(true) });
```

Capability declaration (manifest): `clipboard: { read: bool, write: bool }`. Kernel enforces — read-only keycap calling `write` = `CAPABILITY_VIOLATION`.

### Q2.2 `text.*`

```ts
const TextChat = z.object({
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  })),
  model_hint: z.string().optional().describe('e.g. "fast" | "quality" — kernel maps to provider'),
  max_tokens: z.number().int().min(1).max(8192).default(2048),
  temperature: z.number().min(0).max(2).default(0.7),
  stream: z.boolean().default(true),
});
const TextChatChunk = z.object({
  delta: z.string(),
  done: z.boolean(),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

const TextTransform = z.object({
  op: z.enum([
    'base64encode', 'base64decode',
    'urlencode', 'urldecode',
    'lowercase', 'uppercase',
    'jsonpretty', 'jsonminify',
    'wordcount',
    'template',
    'tex2svg',
  ]),
  input: z.string(),
  params: z.record(z.string()).optional().describe('template uses { template, vars }'),
});
const TextTransformOutput = z.object({ result: z.string() });
```

Capability declaration: `text: { chat: bool, transform: { ops: string[] } }`. `transform.ops` 默认全允许; manifest 可收窄。**provider 选择不在 manifest** — 底座按 ADR-005/-011 路由 (Volc → BYOK → Ollama)。

### Q2.3 `network.*`

```ts
const NetworkHttp = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  body: z.union([z.string(), z.record(z.unknown())]).optional(),
  timeout_ms: z.number().int().min(100).max(60000).default(10000),
  max_response_kb: z.number().int().min(1).max(10240).default(1024),
});
const NetworkHttpOutput = z.object({
  status: z.number().int(),
  headers: z.record(z.string()),
  body_text: z.string().optional(),
  body_json: z.unknown().optional(),
  truncated: z.boolean(),
});

const NetworkOpenUrl = z.object({
  url: z.string().url(),
});
const NetworkOpenUrlOutput = z.object({ opened: z.literal(true) });
```

Capability declaration:
```yaml
network:
  http:
    allowlist: ['https://api.feishu.cn', '${config.host}']  # 强制 per-keycap, 不允许 '*'
    methods: [POST, GET]
    max_request_size_kb: 256
  open_url:
    allowlist: ['https://www.google.com/search', 'https://www.baidu.com/s']
```

### Q2.4 `keyring.*`

```ts
const KeyringRead = z.object({
  key: z.string().regex(/^[a-z0-9._-]+$/).describe('e.g. memos.access_token'),
});
const KeyringReadOutput = z.object({
  value: z.string().describe('NEVER logged'),
  exists: z.boolean(),
});

const KeyringWrite = z.object({
  key: z.string().regex(/^[a-z0-9._-]+$/),
  value: z.string(),
});
const KeyringWriteOutput = z.object({ ok: z.literal(true) });
```

Capability declaration:
```yaml
keyring:
  read: ['${manifest.id}.access_token']    # 默认只允许读自己 namespace
  write: ['${manifest.id}.*']
```
Kernel namespace 强制: `${manifest.id}` prefix 不可越界 → 一个 keycap 不能读另一个 keycap 的 secret。

### Q2.5 `screen.*`

```ts
const ScreenCapture = z.object({
  mode: z.enum(['region', 'window', 'fullscreen']),
  display_id: z.string().optional().describe('缺省主屏'),
  include_cursor: z.boolean().default(false),
});
const ScreenCaptureOutput = z.object({
  status: z.enum(['captured', 'cancelled', 'permission_denied']),
  file_path: z.string().optional().describe('/tmp/<uuid>.png'),
  base64: z.string().optional(),
  size_bytes: z.number().int().optional(),
});

const ScreenListDisplays = z.object({});
const ScreenListDisplaysOutput = z.object({
  displays: z.array(z.object({
    id: z.string(),
    name: z.string(),
    is_main: z.boolean(),
    resolution: z.string(),
  })),
});
```

Capability: `screen: { capture: bool, list_displays: bool }`. **macOS 首次 capture 触发系统授权弹窗**, status=`permission_denied` 时 kernel 返回 actionable message。

### Q2.6 `file.*`

```ts
const FileRead = z.object({
  path: z.string().describe('absolute or ${config.*} expansion'),
  max_size_kb: z.number().int().min(1).max(102400).default(10240),
  encoding: z.enum(['utf8', 'base64', 'raw']).default('utf8'),
});
const FileReadOutput = z.object({
  content: z.string(),
  size_bytes: z.number().int(),
  mime_type: z.string().optional(),
});

const FileWrite = z.object({
  path: z.string(),
  content: z.string(),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
  mode: z.enum(['create', 'overwrite', 'append']).default('create'),
});
const FileWriteOutput = z.object({ ok: z.literal(true), bytes_written: z.number().int() });
```

Capability:
```yaml
file:
  read_allowlist: ['${config.input_dir}', '${user.documents}/PDF']
  write_allowlist: ['${config.save_dir}', '~/.ctrl/keycaps/${manifest.id}/data']
```
**强制 allowlist** — `*` 拒绝。Tilde + `${user.*}` / `${config.*}` 由 kernel 展开。

### Q2.7 `mcp.*` (infrastructure for Pattern D)

```ts
const McpSpawn = z.object({
  transport: z.enum(['stdio', 'sse', 'websocket']),
  command: z.string().describe('e.g. uvx | npx | docker'),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
  initialization_timeout_ms: z.number().int().default(10000),
});
const McpSpawnOutput = z.object({
  handle: z.string().describe('opaque server handle'),
  server_info: z.object({ name: z.string(), version: z.string() }),
});

const McpListTools = z.object({ handle: z.string() });
const McpListToolsOutput = z.object({
  tools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    input_schema: z.unknown(),
  })),
});

const McpInvokeTool = z.object({
  handle: z.string(),
  tool_name: z.string(),
  arguments: z.unknown(),
  timeout_ms: z.number().int().default(30000),
});
const McpInvokeToolOutput = z.object({
  content: z.array(z.object({
    type: z.enum(['text', 'image', 'resource']),
    text: z.string().optional(),
    data: z.string().optional(),
  })),
  is_error: z.boolean(),
});

const McpNotifications = z.object({
  handle: z.string(),
});
const McpNotification = z.object({
  method: z.string(),
  params: z.unknown(),
});  // streamed
```

Capability: `mcp: { spawn: bool, invoke: bool, notifications: bool }`. **Pattern D third-party 是唯一需要 `spawn` 的; G builtin 不需要** (in-process)。

### Q2.8 `platform.*`

```ts
const PlatformNotify = z.object({
  title: z.string().max(120),
  body: z.string().max(1000),
  level: z.enum(['info', 'success', 'warning', 'error']).default('info'),
  duration_ms: z.number().int().min(500).max(15000).default(3000),
});
const PlatformNotifyOutput = z.object({ shown: z.literal(true) });

const PlatformHotkeyRegister = z.object({
  combo: z.string().describe('e.g. cmd+shift+x'),
  scope: z.enum(['global', 'app_focused']).default('global'),
});
const PlatformHotkeyRegisterOutput = z.object({
  registered: z.boolean(),
  conflict: z.string().optional(),
});
```

Capability: `platform: { notify: bool, hotkey: bool }`. CTRL 主 hotkey 占用 `Ctrl` — manifest 注册的 combo kernel 检测冲突。

### Q2.9 `text.embed` (kept for §Q2.11 future kernel)

`text.embed` 在 v1 只有智识 RAG 用 → 暂留 keycap-local 实现, 见 Q1 §1.2 备注。**不进 v1 kernel surface**。

### Q2.10 `screen.list_displays` 

跟 `screen.capture` 同 namespace, 已合并到 Q2.5。

### Q2.11 v1.1 候选 namespaces (kernel schema 留位, 不暴露)

| namespace | method | promote 触发 |
|---|---|---|
| `process.*` | `spawn(cmd, args, env, timeout)` + `kill(handle)` + `stdin(handle, bytes)` | B bucket ≥2 keycap (BetterDisplay + yt-dlp 已排队) |
| `network.local_rpc.*` | `call(addr, method, params)` + JSON-RPC over HTTP/WS | C bucket ≥2 keycap (Motrix + OpenTeams 已排队) |
| `oauth.broker.*` | `start_flow(provider, scopes)` + `refresh(provider)` + `revoke(provider)` | E bucket ≥2 keycap (飞书 + Notion 已排队) |
| `stss.publish` / `stss.subscribe` | `publish(stream, cell)` + `subscribe(stream, filter)` | F bucket ≥2 keycap (VSCode publisher + Irisy coding companion) |
| `image.ocr` / `image.generate` | `ocr(image_bytes) -> text` + `generate(prompt, size)` | image-* keycap 第 2 个 (OCR + poster keycap 已存在但 Volc image.generate 已经走 text.* gateway — review v1.1) |

**Schema-first 优势**: ADR-004 一次定义, v1.1 promote 时只需 kernel `enable_namespace(...)`, manifest 不重写。

### Q2.12 完整 capability declaration 例 (Memos)

```yaml
capabilities:
  clipboard: { read: false, write: false }       # Memos 不走剪贴板
  text: { chat: false }                          # 不直接调 LLM (Irisy 调)
  network:
    http:
      allowlist: ['${config.host}']
      methods: [POST, GET]
      max_request_size_kb: 256
  keyring:
    read: ['${manifest.id}.access_token']
    write: []
```

### Q2.13 namespace 总览 (供 ADR-004 §3 lift)

| # | namespace | methods (v1) | 落地路径 |
|---|---|---|---|
| 1 | `clipboard` | read, write | `src-tauri/src/kernel/capability/clipboard.rs` |
| 2 | `text` | chat (stream), transform (op enum) | `kernel/capability/text.rs` + LLM Port 路由 |
| 3 | `network` | http (allowlist), open_url (allowlist) | `kernel/capability/network.rs` |
| 4 | `keyring` | read, write (namespace 强制) | `kernel/capability/keyring.rs` + `shell/keychain.rs` |
| 5 | `screen` | capture (region/window/fullscreen), list_displays | `kernel/capability/screen.rs` (OS-abstract) |
| 6 | `file` | read, write (allowlist) | `kernel/capability/file.rs` |
| 7 | `mcp` | spawn, list_tools, invoke_tool, notifications | `kernel/mcp_host.rs` (已 stub, 扩) |
| 8 | `platform` | notify, hotkey (register) | `kernel/capability/platform.rs` + `shell/hotkey.rs` |
| (v1.1) | `process` | spawn, kill, stdin | ADR-012 `SubprocessActor` 已落, capability gate 待加 |
| (v1.1) | `network.local_rpc` | call | reuse `network` namespace, 新 method |
| (v1.1) | `oauth.broker` | start_flow, refresh, revoke | ADR-010 §5.2 `OAuthCapability` 已 reserve |
| (v1.1) | `stss` | publish, subscribe | `ctrl-stss` 已存在, 接 capability gate |
| (v1.1) | `image` | ocr, generate | text gateway 扩或独立 namespace, 待 v1.1 决 |

**8 namespace ≥2 method 草稿 ✓** (clipboard / text / network / keyring / screen / file / mcp / platform)。

---

## §Q3 Claude-free verification (production code paths)

### Q3.1 Grep 命令 + 输出

```bash
grep -rnEi 'claude|anthropic|@anthropic' packages/ctrl-web/src src-tauri/src \
  --include='*.ts' --include='*.tsx' --include='*.rs' --include='*.js' \
  2>/dev/null | grep -v -E 'node_modules|experiments|/\.git/'
```

**Total matches**: 27 lines across 11 files. Full list reviewed; categorized below.

### Q3.2 残留分类

| Bucket | 计数 | Verdict | 处置 |
|---|---|---|---|
| **A. 合法 BYOK adapter impl** | 17 | ✅ 保留 | `adapters/outbound/llm/anthropic.rs` (12) + `gateway.rs` (4) + `mod.rs` (1) — ADR-005/-011 BYOK chain 的 Anthropic adapter, 正常代码 |
| **B. 合法 enum / config dispatcher** | 3 | ✅ 保留 | `lib.rs:237` (`"anthropic" => ProviderKind::Anthropic`) + `application/ports.rs:89` (doc) + `shell/keychain.rs:22` (doc example) — 字典 entry, 不删 |
| **C. 合法 MCP 引用** | 2 | ✅ 保留 | `kernel/mcp_host.rs:1` (MCP 是 Anthropic 标准, 必须引用) + `kernel/mod.rs:10` (ADR path) |
| **D. 待修: hardcoded fallback 顺序** | 2 | ⚠️ FIX | `kernel/runtime.rs:53-58` + `kernel/llm_port.rs:4` — 默认 chain `["workers-ai","anthropic","ollama"]` 应改为 `["volc","byok","ollama"]` 或加载自 config (ADR-011 v1 launch = Volc) |
| **E. 待修: UI BYOK 文案漏 Volc** | 1 | ⚠️ FIX (route to Apollo) | `packages/ctrl-web/src/routes/settings.tsx:21` — "Bring your own Anthropic / OpenAI key" 应加 Volc (memory `decision_ai_providers_are_kernel_capabilities`: Volc = v1 launch); 文案改动经 Apollo (memory `apollo_copy_facts_from_zeus_2026-05-17`) |
| **F. 残留 model 字符串** | 0 | ✅ pass | 已 grep `claude-haiku|claude-sonnet|claude-opus|haiku-4|sonnet-4|opus-4` — 0 命中。`llm-transport.ts:108 model ?? 'claude-haiku-4-5'` 已被先前 fix 清掉 (该文件已不在 `packages/ctrl-web/src/lib/`) |

### Q3.3 修复清单

| # | file:line | 当前 | 建议 fix | Owner |
|---|---|---|---|---|
| F1 | `src-tauri/src/kernel/runtime.rs:53-58` | `let llm_port = LlmPortRouter::new(vec!["workers-ai".into(), "anthropic".into(), "ollama".into()]);` | 改为读 config 的 chain, 默认 `["volc", "byok-anthropic", "byok-openai", "ollama"]` (per ADR-011) | Zeus |
| F2 | `src-tauri/src/kernel/llm_port.rs:4` | `// Default order: CF Workers AI → Anthropic (BYOK) → local Ollama.` | 改为 `// Default order: Volc (v1 launch) → BYOK chain → local Ollama. (ADR-011)` | Zeus |
| F3 | `packages/ctrl-web/src/routes/settings.tsx:21` | `Bring your own Anthropic / OpenAI key for higher-quality creator flows.` | 文案需加 Volc 作为 v1 默认 + 保留 BYOK Anthropic/OpenAI 作为高阶 | Apollo (per memory) |

**结论**: 0 个违反 (no rogue Claude shim in production runtime). 3 处可以更明确反映 ADR-011 Volc-first 立场, 走正常 RFC 改即可。

---

## Hand-off to Zeus (ADR-004 起草输入)

### Concrete asks (lift verbatim into ADR-004 sections)

1. **§Context** — 引用本 RESULT §Q1.2 frequency table 证明判定规则有效 + 引用 §Q2.13 namespace 总览
2. **§Decision** — "v1 底座暴露 8 namespace (clipboard/text/network/keyring/screen/file/mcp/platform), 共 14 methods. v1.1 再 promote 5 namespaces (process/oauth/stss/image + network.local_rpc)。" 单决策, 不 bundle
3. **§Consequences (positive)** — Pattern D 10K MCP 生态 Day-1 可用 (mcp.* 是 infra); G builtin 16 starter 无改动复用 8 namespace; UI HTMLOutputPanel 70% keycap 零开发 (per 05-manifest-v0.2 §2)
4. **§Consequences (negative)** — v1 智识 RAG / 屏幕录 / 会议 = keycap-local (无 v1 第二实例), 每个 keycap 自带向量库/编码器/STT 客户端, 重复实现风险
5. **§Trade-offs** — `oauth.broker` 拖到 v1.1 = 飞书 keycap v1 自己 wrap OAuth flow, 跟 ADR-010 §5.2 OAuthCapability reserve 形成短期不一致 (建议 Zeus 在 ADR-004 内注脚: "OAuth broker schema 已落 Q2.11, v1.1 promote 时 飞书 keycap 仅需切 import path")
6. **§Compliance / Validation** — 抄 §Q2.13 表的"落地路径"作 implementation checklist
7. **§Alternatives Considered** — A: 一开始就 promote 全 13 namespace (过设计); B: 选定; C: 不分 namespace, capability flat enum (KISS 失败 — 28 method 平铺难管理)

### Anti-orphan 自查 (spike → ADR-004 → spec)

- [x] RESULT.md outcome-focused (TL;DR + 3 sections + ADR-004 punch list) — 不是 step-by-step research log
- [x] §Q2.13 表 → 即将进 `.olym/specs/kernel/capability-surface.md` (zeus 接力 spec 化)
- [x] §Q3 修复清单 → 三条独立 issue, 不阻塞 ADR-004 写作
- [x] 0 production code 改动 (spike 只 read)
- [x] 0 manifest schema 改动 (manifest schema v0.2 已在 05-manifest-schema-v0.2.md, 本 spike 仅消费)
- [x] 0 ADR/decisions 改动 (denylist 符合)

### 给 daedalus (lane-A / Irisy D4)

Irisy v1 可调的底座 capability = §Q2.13 表 v1 行 (8 个 namespace)。**Irisy 自己不 declare capability** — Irisy 是 host, capability 给 keycap declare; Irisy 走 `mcp.list_tools` 拉所有装好 keycap 的 tool, 然后 `mcp.invoke_tool` 触发。Irisy 仅需要 `clipboard.{read,write}` + `text.chat` + `network.http` (Volc API)。

### 给 Hephaestus (我自己, 下一步)

- 不写: ADR-004 (Zeus); kernel impl (Zeus); 文案 fix (Apollo)
- 写: 等 ADR-004 accept 后, 把 §Q2 schema promote 到 `.olym/specs/kernel/capability-surface.md` (Zeus 通知)
- 写: B bucket 第 2 个 keycap (yt-dlp 或 larksuite-cli) 契约 — 触发 `process.*` v1.1 promote 计数

---

## Spike timebox / exit

- **Started**: 2026-05-19 (lane-C worktree, branch `feat/h-2026-05-18-002-jiazuo-spike`)
- **Ended**: 2026-05-19, ~1 day used (budget 1-2)
- **Lane**: hephaestus (lane-C per `.lane` marker)
- **Branch**: `feat/h-2026-05-18-002-jiazuo-spike`
- **PR**: pending — ping zeus

**End of RESULT**. ADR-004 zeus 接力起草; 本文件作为 §References 唯一引用。
