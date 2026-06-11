---
spec: connectors
title: CTRL Connector Specification — connect any system via MCP / Skill / CLI / API-bridge
status: draft
version: 0.2
created: 2026-06-11
updated: 2026-06-11
author: zeus (bao direction 2026-06-11)
related:
  - .olym/decisions/002-substrate.md    # § composition (manifest), § mcp-bus, § subprocess
  - .olym/decisions/003-frontend.md      # §8 morphing surface (render parts / ui-registry)
  - .olym/decisions/006-cross-cutting.md # §5 business-system integration, §4 policy envelope, §3 plain-text
changelog:
  - v0.1 2026-06-11: first draft — 4 channels, unified manifest, generic API-bridge, render contract, keychain auth, gated writes.
  - v0.2 2026-06-11: optimized against a 3-track benchmark (MCP ecosystem · iPaaS platforms · future standards). Replaces crude `gated` with MCP ToolAnnotations 4-hint model + pessimistic defaults; adds OAuth 2.1 + RFC 8707 resource indicators + STDIO-env/HTTP-OAuth split + no-token-passthrough; outputSchema + structuredContent; FastMCP RouteMap api-bridge + curated (not 1:1) tool surface + OpenAPI import as source + provenance; sync/action split (syncs → local KB); JIT/deferred auth via URL-elicitation; intent-based tool search; passthrough-first unified-model-optional; dynamic field discovery; universal filter grammar; local audit + idempotency + dry-run (lead, no iPaaS has it); MCP-Registry-compatible server.json mapping + _meta reverse-DNS namespacing; swappable render contract (MCP Apps / A2UI not hardcoded); reserved A2A discovery + agent-identity extension points.
---

# CTRL Connector Specification (v0.2)

> **一句话**: CTRL 是软件,通用接入任意系统(CRM / ERP / 自研 / SaaS)—— 不为任何一个写死。每个系统通过四条通道之一接入,全部编译成 **MCP 工具**上总线,结果由通用 part registry 渲染。接一个新系统 = 写/导入一份 manifest,不改 CTRL 代码。**护城河 = 托管式接入体验,但回调走 localhost、token 存 Keychain、请求从本机出 —— 这是云 iPaaS 结构上做不到的。**

## 0. Principles (locked)

1. **No hardcoded connectors.** CTRL ships the *mechanism* (manifest schema + generic runtimes + host policy). Connectors are supply (ecosystem / third party / customer IT / AI-drafted by the user); CTRL is the client. (ADR-006 §5)
2. **Compile to MCP.** Every connector — whatever channel — compiles to an MCP **tool** (JSON-Schema input, structured output). The agent and the morphing surface only ever see "tools with typed I/O"; they never know which channel or which system backed a tool. MCP is the load-bearing layer; A2A (agent↔agent) and AG-UI (agent↔UI) are adjacent contracts we reserve extension points for, not bake in now. (ADR-002 § mcp-bus)
3. **Config over code.** Adding a system = a manifest (endpoint map / command / skill file), not a connector package. AI may draft it from natural language; the user reads/edits/versions it (git-diffable text — ADR-006 §3).
4. **Sovereign by inversion.** Managed-auth *UX* without a managed-auth *cloud*: OAuth callback on **localhost loopback**, tokens in the **OS keychain**, every request egresses from the device. Every cloud iPaaS routes callbacks + creds + traffic through its own backend; CTRL inverts that. This is the structural moat. (ADR-006 §3, §5)
5. **Pessimistic write-safety.** A tool with no safety annotation is assumed writing + destructive + open-world and is gated. Real enforcement lives at the **host (kernel) policy layer** — annotations are advisory UX hints, never a security boundary (MCP spec). (ADR-006 §4)
6. **Passthrough-first.** Default to raw API passthrough (vim-test friendly, no lossy normalization); unified/normalized models are an optional derived layer, never imposed.
7. **Render is a swappable contract.** A tool emits a real `outputSchema` + `structuredContent`; the render hint is additive metadata. The UI-return standard is the least-settled layer in the ecosystem (MCP-UI / ChatGPT Apps / MCP Apps SEP-1865 / Google A2UI) — CTRL's part registry is the neutral indirection so the winner can be adopted later without re-spec.

## 0.5 Local-simple tier (the common case — keep it trivial)

Most connections are **local** (your own system on localhost/intranet). For these, drop all the OAuth/RFC machinery — it exists only for **remote/cloud** systems. The local manifest is just:

```toml
[connector]
id = "iris-crm"
title = "Iris CRM"
channel = "api"

[api]
base_url = "http://localhost:3000"

[auth]                      # local = one pasted key, stored once in keychain
type = "bearer"
key_ref = "keychain:com.ctrl/iris-crm"

[[tool]]
name = "list_people"
method = "GET"
path = "/rest/people"
result_path = "data.people"
render = "table"
read_only = true            # auto-runs, no gate
```

That's the whole thing — base URL + one key + endpoint→tool + render. **No OAuth, no loopback dance, no resource indicators** for local. The full §5 OAuth 2.1 / RFC 8707 model is **opt-in, only when `base_url` is a remote host that requires it**. Writes still gate (§6), but a local read connector is: paste key once → tools appear → click → data renders.

## 1. The four connector channels

| Channel | When | User provides | Runtime | Auth |
|---|---|---|---|---|
| **mcp** | system already has an MCP server | source (npm/pypi/oci/local/remote) | `mcp_host` spawns/connects, `tools/list` discovers | STDIO→env; HTTP→OAuth 2.1 |
| **skill** | repeatable workflow + template, no external system | a `SKILL.md` (+ resources) | agent loads on demand; no process | none |
| **cli** | the capability is a command-line tool | command + arg schema + parse hint | kernel wraps argv (subprocess isolation) | env from keychain |
| **api** | system exposes only REST/GraphQL | base URL + auth + route→tool map (or import OpenAPI) | generic **API-bridge** runtime | OAuth 2.1 (HTTP) / API-key |

One system may use several channels (an ERP = `api` for data + `skill` for its report format). All compile to MCP tools.

## 2. Unified connector manifest

A connector is a directory with `manifest.toml` (TOML for hand-editability + comments; importable from / exportable to MCP-Registry `server.json`). Lives at `~/.ctrl/connectors/<id>/`.

```toml
# ── identity (MCP-Registry-compatible; reverse-DNS name) ──────────
[connector]
id          = "iris-crm"                      # local kebab-case handle
name        = "com.iris/crm"                  # reverse-DNS, one slash (registry rule)
title       = "Iris CRM"                      # user-facing
channel     = "api"                           # mcp | skill | cli | api
description = "Internal CRM (Twenty fork) — people, companies, opportunities"
version     = "0.1.0"                          # semver, exact
icon        = "assets/icon.svg"
provenance  = "imported+curated"               # hand-written | generated | imported | imported+curated
requires_network = false                       # local-first invariant: true only if it MUST reach the internet

# ── auth (secrets NEVER inline — keychain refs only) ──────────────
[auth]
type        = "oauth2"                          # none | api_key | bearer | basic | oauth2
# OAuth 2.1 (HTTP connectors): RFC 9728 metadata discovery + RFC 8707 resource indicator
issuer      = "http://localhost:3000"           # AS metadata via /.well-known/oauth-protected-resource
resource    = "http://localhost:3000"           # RFC 8707 audience — token bound to THIS connector only
scopes      = ["crm:read", "crm:write"]         # coarse; fine scopes per tool below
grant       = "authorization_code"              # authorization_code (on-behalf-of) | client_credentials (system)
token_ref   = "keychain:com.ctrl/iris-crm"      # where the resolved token caches (loopback flow writes here)
# api_key connectors instead: key_ref = "keychain:com.ctrl/iris-crm/api-key"

# ── channel block (one) ───────────────────────────────────────────
[api]
base_url    = "http://localhost:3000"           # local → data never leaves the machine
# rate_limit = { rpm = 100, batch = 60 }
# pagination = { style = "cursor", cursor_param = "starting_after", page_size_param = "limit" }

# ── route → tool map (FastMCP RouteMap model; ordered, first match wins) ──
# Default verb heuristic if omitted: GET→read tool (GET-with-path-param→record),
# POST/PUT/PATCH/DELETE→write tool. Curate: aggregate + exclude, never 1:1 dump.
[[route_map]]
methods = ["GET"]
pattern = "/rest/.*/\\{id\\}"                   # GET with path param → single record
mcp_type = "record"
[[route_map]]
tags = ["internal", "admin"]
mcp_type = "exclude"                            # never expose to the agent

# ── tools (explicit; or generated from route_map / OpenAPI import) ──
[[tool]]
name        = "list_people"                     # ≤128 chars, [A-Za-z0-9_.-], unique per connector
title       = "List contacts"
description = "List CRM contacts (read-only)"
method      = "GET"
path        = "/rest/people"
params      = [
  { name = "limit",  type = "number", default = 20 },
  { name = "filter", type = "string", required = false },   # see §6 universal filter grammar
]
result_path = "data.people"                     # JSONPath to the row array
# typed output so ANY mcp client can render it:
output_schema = "schemas/person.list.json"      # JSON Schema 2020-12
render      = "table"                            # additive _meta hint (com.ctrl/render); see §7
# safety — MCP ToolAnnotations (pessimistic defaults if omitted):
read_only   = true                              # readOnlyHint

[[tool]]
name        = "create_opportunity"
description = "Create a sales opportunity"
method      = "POST"
path        = "/rest/opportunities"
body_schema = "schemas/opportunity.create.json"
output_schema = "schemas/opportunity.json"
render      = "record"
read_only   = false                             # readOnlyHint=false
destructive = false                             # destructiveHint — additive write, not destructive
idempotent  = false
fine_scope  = "crm:write:opportunity"           # least-privilege scope for THIS tool
idempotency_key = "{clientRequestId}"            # dedupe retries (§6 — CTRL leads here)
dry_run     = true                              # supports dry_run preview (§6)
```

### 2.1 Safety annotations → MCP ToolAnnotations (normative)

Map the manifest's `read_only` / `destructive` / `idempotent` / `open_world` to the MCP `ToolAnnotations` 4-hint model. **There is no single "destructive" boolean** — write-safety is the *combination*:

| Manifest | MCP annotation | Meaning | Gated? |
|---|---|---|---|
| `read_only = true` | `readOnlyHint: true` | does not modify | no (auto-run) |
| `read_only=false, destructive=false` | `destructiveHint: false` | additive write (create) | yes (confirm) |
| `read_only=false, destructive=true` | `destructiveHint: true` | dangerous (delete / mass-update) | yes (strong confirm) |
| (omitted) | spec defaults: write+destructive+open-world | unknown → treat as dangerous | yes |

`idempotent` / `open_world` flow through as `idempotentHint` / `openWorldHint`. The kernel derives its internal enforcement flag from `!readOnlyHint` (so imported third-party tools gate correctly). Annotations are **advisory UX**; real enforcement = §6 host policy.

### 2.2 Per-channel blocks

```toml
# channel = "mcp"  — import an existing MCP server (auto-discovers tools)
[mcp]
source = "npm"            # npm | pypi | oci | local | remote
package = "some-mcp"      # or command (local) / url+headers (remote)
transport = "stdio"       # stdio → secrets via env; streamable-http → OAuth 2.1

# channel = "skill"
[skill]
entry = "SKILL.md"        # instructions + frontmatter; resources alongside

# channel = "cli"
[cli]
command = "rg"            # resolved via PATH augmentation; runs under subprocess isolation
[[tool]]
name = "search"
args_template = ["{pattern}", "{path}"]
render = "code"
read_only = true
```

## 3. Lifecycle

```
import/draft → install → register → connect → (JIT auth?) → invoke → (gate?) → render
                                                                      ↳ audit log (always)
```

1. **import/draft** — from the MCP Registry (`server.json`), an OpenAPI/GraphQL spec (→ draft manifest, then a curation pass), a local folder, or AI-drafted from natural language. `provenance` records which.
2. **install** — copy to `~/.ctrl/connectors/<id>/`; do NOT collect secrets up front.
3. **register** — kernel validates the manifest, registers a `McpServerDescriptor` (ADR-002 § mcp-bus). For api/cli/skill the descriptor points at the **generic runtime**, not a bespoke process.
4. **connect** — `mcp_host.connect(id)`; tools are *declared* (api/cli) or *discovered* (mcp, `tools/list`).
5. **JIT auth** (deferred, Pipedream-style) — first call to an unauthed connector returns a structured "needs-auth" result (MCP `-32042 URLElicitationRequired`); CTRL runs the **localhost-loopback OAuth flow**, stores the token in keychain, retries. No upfront connect wizard.
6. **invoke** — agent calls `mcp_call(server_id, tool, args)`; the runtime executes (HTTP / argv / skill-load / MCP passthrough), attaching auth resolved from keychain at call time (never in the LLM context).
7. **gate** — if not read-only, the policy envelope (§6) shows the parsed intent as a reviewable workflow + dry-run preview; execute only on approval.
8. **render** — `{structuredContent, outputSchema, _meta.render}` → part registry (ADR-003 §8) → table / record / etc.

## 4. The generic API-bridge runtime (the high-value generic piece)

One kernel runtime serves **any** `channel = "api"` connector:

- **OpenAPI import as a source** — `from_openapi(spec)` drafts a manifest. But **never 1:1 dump** (the Stainless lesson: 50+ endpoints blow the context budget and the LLM can't reason over them). Apply FastMCP-style **`route_map`** (ordered `{methods, pattern, tags} → {tool | record | resource_template | exclude}`) to **curate**: aggregate related endpoints into semantic tools (one `manage_opportunity`, not create/update/delete×3), exclude `internal`/`admin`, prune fields. The curation pass is AI-assisted (CTRL's creation assistant) + human-owned.
- **Invoke** — bind path/query/body params; resolve `auth` from keychain; **mint/store a SEPARATE upstream token — never pass the inbound token through** (confused-deputy; MCP forbids token passthrough); validate audience (RFC 8707); issue the request to `base_url`; extract `result_path`; return `{structuredContent, render}`.
- **Owns the proxy concerns locally** (cloud iPaaS centralize these; CTRL must implement in-kernel): retries, **rate-limit** backoff, **pagination** (cursor/page declared in `[api].pagination`).
- **Dynamic field discovery** (Paragon `reload_fields`) — schema-per-tenant systems (Twenty included) differ per instance; a manifest may declare a `fields_refresh` hook so tool schemas reflect the user's actual custom fields at query time.
- REST now; **GraphQL** (operation + variables) is the same model, follow-up.
- **One runtime, N systems** — zero per-system code.

## 5. Auth model (the moat)

**STDIO vs HTTP split (per MCP spec):**
- **STDIO** connectors (`cli`, local `mcp`) — secrets injected as **env vars from keychain** (mirrors registry `environmentVariables[].isSecret`). No OAuth.
- **HTTP** connectors (remote `mcp`, `api`) — **OAuth 2.1** with **PKCE**, **RFC 9728** Protected-Resource-Metadata discovery, **RFC 8707** Resource Indicators (`resource=` on auth+token requests; token audience MUST equal the connector). Bearer in `Authorization` header, **never** in query string. `authorization_code` for on-behalf-of (user consent + scopes), `client_credentials` for system-to-system.

**The sovereignty inversion (what no cloud iPaaS can do):**
- OAuth callback on **localhost loopback** (`http://127.0.0.1:<ephemeral>/callback`) — not a vendor cloud URL.
- Tokens cached in the **OS keychain**, device-only; refresh-token rotation; resolved at call time.
- **Secrets NEVER enter the LLM context / prompt / trace / logs.**
- **Secret capture via URL-mode elicitation** (MCP form-mode is forbidden for secrets) → a local CTRL page → keychain.
- Every API request **egresses from the user's machine**; ctrl-cloud is never in the credential or data path (ADR-006 §5, §3.8).

## 6. Write-safety & host policy

Annotations (§2.1) drive the *UX* (auto-run reads; confirm writes; strong-confirm destructive). **Enforcement lives at the kernel host policy layer** because OAuth validates single calls but cannot stop an agent chaining legitimate tools into a bad outcome:

- **Sequence-aware policy point** — the kernel is the gateway (ADR-006 §4 autonomy ladder + blast-radius). Per-action **capability tokens**, **action budgets**, allowlist-bound hosts.
- **Human-in-the-loop via MCP elicitation** — gated tools emit `elicitation/create` (accept/decline/cancel) rendered as an inline approval card in the conversation (ADR-003 §8), showing the parsed intent before execution.
- **Dry-run** — gated write tools SHOULD support `dry_run = true`: preview the effect (the diff / the records that would change) before committing. *No iPaaS surfaces this — CTRL leads.*
- **Idempotency keys** — write tools declare an `idempotency_key` so retries don't double-apply. *Also an iPaaS gap.*
- **Local audit log** — every action (and its approval) appends to CTRL's event-sourced SQLite (ADR-002 § persistence), queryable, replay-able. Vim-readable.

## 7. Render contract (swappable)

A tool result is `{ content[], structuredContent, outputSchema }` + an additive `_meta` render hint. The morphing surface (ADR-003 §8 ui-registry) maps:

| `_meta.render` | structuredContent shape | part |
|---|---|---|
| `table` | array of objects | data table (sortable/filterable — §8 universal filter) |
| `record` | object | key-value record card |
| `markdown`/`html`/`code`/`json`/`mermaid` | string / typed | matching viewer |

- **Always emit a real `outputSchema` (JSON Schema 2020-12) + `structuredContent`** so any MCP client (not just CTRL) can type the result; also serialize JSON into a `text` content block for back-compat.
- **Rich UI is swappable, not hardcoded.** For tools that ship a widget, the standard convention is `_meta.ui.resourceUri` → an HTML resource (`text/html;profile=mcp-app`), shared by MCP Apps *and* the ChatGPT Apps SDK; render it in CTRL's existing iframe+CSP viewer. But the UI-return layer is the least-settled in the ecosystem (Google A2UI's declarative component-tree is philosophically closer to CTRL's plain-text ethos) — so CTRL's part registry stays the neutral indirection; never make a single iframe API a manifest dependency.

## 8. Sync vs Action, and the knowledge base

Two tool kinds (Nango split), mapped to CTRL's local-is-truth model:

- **`sync`** — scheduled/triggered **pull** (`runs` cron, full/incremental) that lands data **into the local Notes/vault** as plain files, indexed by the kernel FTS5 + backlink + embedding index (ADR-002 §8/§10). Synced CRM/ERP data thus becomes part of CTRL's **knowledge base** — queryable offline, vim-readable, and feedable to the agent. (This is how business-system data joins the KB without leaving the machine.)
- **`action`** — on-demand, side-effecting (the gated writes of §6).

**Universal filter grammar** (Paragon) — all `list`/`search` tools accept one filter schema (`{ field, op: contains|equals|gt|lt|in, value }`) the agent learns once and applies across every connector.

**Intent-based tool surfacing** (Composio) — with a long tail of connectors, the kernel surfaces tools to the agent **just-in-time by intent** (a `search_tools` meta-tool), not by injecting thousands of schemas into context.

## 9. MCP-Registry interoperability

- The manifest maps losslessly to/from MCP-Registry **`server.json`**: reverse-DNS `name` (one slash), exact-semver `version`, `description`, `repository`, `icons`, `websiteUrl`. The 4 channels map onto `packages[].transport` (`stdio`/`streamable-http`) + `remotes[]`.
- All CTRL-proprietary fields (`render`, `channel`, gating policy, `provenance`) live under a **reverse-DNS `_meta` namespace `com.ctrl/...`** so they never collide with the spec or break other MCP clients.
- Result: CTRL connectors are **publishable to / importable from** the official registry + aggregators (Smithery / PulseMCP / Glama). CTRL consumes the ecosystem and contributes back.

## 10. Reserved extension points (design-for-later, don't commit)

- **`[discovery]`** — well-known-URL advertisement (`/.well-known/agent.json`) so a CTRL connector can later expose itself over **A2A** as an agent. Reserve the block; no implementation v0.2.
- **`[identity]`** — delegated / on-behalf-of agent identity (OAuth token-exchange, workload identity). Optional field; the agent-identity standards (DIDs etc.) are pre-1.0 — reserve, don't pick a scheme.
- **`execution.task_support`** — mark long-running connector calls (ERP batch jobs) `"optional"` for async polling instead of blocking.
- **Generative UI return** — keep the render contract (§7) abstract enough to later target MCP Apps OR Google A2UI without re-spec.

## 11. Security & sovereignty (summary)

- Secrets: keychain only; injected at call time; never logged / in-prompt / in ctrl-cloud.
- Local boundary: `requires_network=false` is the default invariant; `api.base_url` typically localhost/intranet; data does not transit ctrl-cloud.
- Sandboxing: `cli` under subprocess isolation (ADR-002 § subprocess); `api` allowlist-bound by `base_url` host.
- Writes: pessimistic annotations + host policy + dry-run + idempotency + audit (§6). Separate read/write keychain entries where the system supports scoped keys.
- No token passthrough (§5). RFC 8707 audience-binding on every HTTP connector.

## 12. Worked example — iris-crm (Twenty, schema-per-tenant)

Twenty exposes `/rest/{object}` with `Authorization: Bearer`, schema-per-tenant (custom fields per workspace). The connector is the §2 manifest: `list_people`→table (read-only, auto-run), `get_company`→record, `create_opportunity`→gated additive write (dry-run + idempotency + inline approval). `fields_refresh` re-pulls the workspace's custom fields at query time so the agent sees the real schema. Auth = OAuth 2.1 to `localhost:3000`, callback on loopback, token in keychain, requests egress from the device. **No CTRL code** — start Twenty, run the loopback auth once, drop the manifest in `~/.ctrl/connectors/iris-crm/`. The same shape connects any other REST system next.

## 13. v0.2 scope / out of scope

- **In**: manifest schema (§2) incl. ToolAnnotations + outputSchema; 4 channels (§1); generic REST api-bridge with route_map curation + OpenAPI import (§4); OAuth 2.1 + RFC 8707 + loopback/keychain (§5); host policy + dry-run + idempotency + audit (§6); swappable render contract (§7); sync→KB + universal filter + intent tool-search (§8); server.json interop (§9).
- **Out (follow-up)**: GraphQL bridge; A2A discovery + agent identity (reserved §10); generative-UI return; connector marketplace UI; webhooks/subscriptions (push triggers); unified/normalized category models (passthrough-first for now).

## 14. Open questions (for bao)

1. **Manifest format** — TOML (this draft, hand-edit-friendly) with a lossless `server.json` converter? Confirmed direction.
2. **Connector home** — `~/.ctrl/connectors/<id>/` for user-installed; a bundled first-party set shipped with CTRL for common systems? 
3. **Unified models** — stay passthrough-first (recommended), or invest in per-category normalized models (Merge-style) for cross-system portability later?
4. **Curation authorship** — OpenAPI import → AI-drafted curation pass → user edits. Confirm the AI-drafts-human-owns flow as the connector authoring model.
