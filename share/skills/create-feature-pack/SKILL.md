---
name: create-feature-pack
description: The mandatory flow to follow whenever the user asks to create, build, make, or set up a feature pack (功能包), a tool, a connector, or "a thing that does X". Research first, never invent endpoints, always smoke-test before reporting done.
category: development
---

# Create a Feature Pack — mandatory flow

When the user asks to create / build / make / set up a feature pack (功能包), a
tool, or a connector, follow these five steps **in order**. Do NOT skip research.
Do NOT jump straight to install. Do NOT invent API endpoints.

The gate tools you use here are namespaced `mcp_ctrl_*`.

## EXECUTION RULE — act, do not narrate (read this first)

Do NOT say "I will now search…" and then stop. Announcing the plan is NOT a turn.
The moment you start this flow, **immediately CALL the Step 1 tools in the same
turn** — actually invoke `mcp_ctrl_discover_packs` (and the other research tools),
do not just describe that you are about to. Keep calling tools and chaining steps
without pausing. The ONLY point where you stop and hand control back to the user
is **Step 2** (to report findings and get confirmation) — and you only reach it
*after* the research tools have returned real results. If you ever find yourself
ending a turn with just text and no tool call before Step 2, you have stalled —
call the next tool instead.

## Step 0 — Open a knowledge base for this pack (so research compounds)

Before researching, give this pack a knowledge base so you never start cold and
never lose what you find. The KB is a plain vault folder — the user owns it.

- Pick a vault subpath for the pack's domain, e.g. `Packs/<pack-name>/` (or a
  natural domain folder like `Stocks/`).
- **Read it first** with `mcp_ctrl_vault_search` / `mcp_ctrl_vault_read`: if a
  prior session already researched this domain, recall those findings instead of
  re-searching from scratch.
- If it is empty, seed one short note with the user's goal and constraints (e.g.
  "free, no API key") via `mcp_ctrl_vault_write`.

This is the capture → recall → supply loop: each pack accumulates a dossier, so
the next round (and the next session) builds on it rather than relearning.

## Step 1 — Research first (take stock, never invent)

Find what already exists, then **write what you find into the Step 0 KB** so it
persists:

- `mcp_ctrl_discover_packs` with a keyword — searches the MCP Registry **and**
  Smithery (2000+ servers) for an existing server you can reuse.
- `mcp_ctrl_discover_skills` — searches published skills (degrade gracefully and
  say so if there is no GitHub token; do not treat that as a hard failure).
- `mcp_ctrl_web_search` with a query — full-web search for mature products, APIs,
  and docs you do not already know.

For every candidate worth keeping, append a line to the KB (via
`mcp_ctrl_vault_write`): its name + URL, what it does, whether it needs a key,
and — once chosen — the exact endpoint, auth scheme, and a sample request /
response. Ground every later choice in what you actually found and wrote down.
Never fabricate an API endpoint, base URL, or auth scheme — if you did not find
it, search again or ask.

## Step 2 — Report findings and confirm

Tell the user, in plain language:

- what candidate sources you found (name + what each does),
- which one you propose to use and why,
- what the pack will do.

If a source needs an API key or secret, say so and ask the user to provide it.
Secrets are stored in the system keychain and never shown to you — you only ever
see "configured ✓". Wait for the user's go-ahead before building.

## Step 3 — Compose the manifest (zero-code action pack)

The DEFAULT and simplest feature pack is a **shell-step action pack**: an action
whose step runs a local command and returns its stdout. A pack does **NOT** have
to be a remote MCP server, and it does **NOT** have to need an API key. You can
wrap ANY local command — `curl` a free HTTP endpoint, run a `python`/`node`
one-liner, call a CLI. Never refuse by saying "I can only connect to remote
services" or hand the user install instructions instead of a pack — wrap the
command in a shell step yourself.

For a data-lookup pack (quotes, weather, exchange rates…), prefer the simplest
reliable shape: a shell step that `curl`s a **free, keyless** HTTP endpoint.
Reach for a remote MCP server (from Step 1) or an API-key source only if no
keyless option exists or the user asks for it.

Build the manifest with a top-level `id` (kebab-case), `name`, `version`,
`manifest_version: 2`, `variant: "builtin"`, `description`, and an `actions[]`
array; each action is `{ id, name, input (none|clipboard|selection|screen|
prompt), output (workspace|clipboard|modal|notification|silent), steps[] }`, and
a shell step is `{ "type": "shell", "command": "..." }`. Use
`mcp_ctrl_mcp_pack_write_file` only for multi-line scripts the command calls.

Declare `"knowledge_base": "<the Step 0 vault subpath>"` so the dossier ships
with the pack and the assistant's retrieval scopes there whenever this pack is
used — the pack travels with its own knowledge.

### Worked example — keyless A-share quote pack

```json
{
  "id": "a-share-quote",
  "name": "A-Share Quote",
  "version": "0.1.0",
  "manifest_version": 2,
  "variant": "builtin",
  "description": "Look up A-share stock quotes (keyless, via Tencent finance).",
  "actions": [
    {
      "id": "quote",
      "name": "Quote",
      "input": "none",
      "output": "modal",
      "steps": [
        { "type": "shell", "command": "curl -s 'http://qt.gtimg.cn/q=sh600519,sz000001'" }
      ]
    }
  ]
}
```

`http://qt.gtimg.cn/q=sh600519` is keyless and returns a line with the name,
price and change for 贵州茅台 (600519). Generalize the codes to whatever the
user wants. This is the kind of small, working, keyless pack to default to.

## Step 4 — Install

Call `mcp_ctrl_mcp_pack_install` with the composed manifest.

## Step 5 — Smoke test (mandatory — the job is NOT done until it runs)

Call `mcp_ctrl_mcp_pack_run` to actually exercise the pack end to end.

- If it errors, fix the manifest / script and retry — do not report success on a
  red run.
- Only after a green smoke run, tell the user the pack is installed and show the
  real result it produced.

## Screening / aggregation — keyless ≠ single-lookup only

Do NOT conclude that "the free endpoint only returns one record, so screening /
filtering / ranking needs a paid API key." That conclusion is almost always
wrong. Keyless **bulk / list / market-wide** endpoints exist for most data
domains. Screening is just: fetch the bulk list from a keyless endpoint, then
filter / sort it inside the shell step (`jq`, `awk`, or a `python -c` one-liner).

Before declaring a capability needs a paid key, research specifically how the
established **open-source** tools in that domain pull the data without one, and
reuse the same underlying endpoint. For A-share / stock data, that means
searching how libraries like `akshare` / `efinance` fetch market-wide lists
(they call public, keyless list endpoints) — ground your screening action in the
endpoint you find that way, then smoke-test it. Never fabricate the URL; never
fall back to "you need a key" without doing this search first.

## A comprehensive "workbench" = ONE multi-action pack

When the user asks for a comprehensive project (e.g. a stock-investor workbench)
rather than a single lookup, build **ONE pack with MULTIPLE actions** — each
action still atomic / one-shot (quote, screen, add-to-watchlist, log-trade) —
not a single wizard with a dialog tree. Stateful lists (a watchlist, a trade
log) live as Markdown in the vault via the `mcp_ctrl_vault_*` tools, so the user
owns them as plain files. Deliver this as one installed pack; do not hand the
user a list of separate things to set up by hand.

## Notes

- Research-first is non-negotiable: a pack built on a guessed endpoint will fail
  the smoke test and waste the user's time.
- Each action is one atomic one-shot operation; a pack may bundle several of
  them (see workbench above), but no action is a multi-step wizard.
- Use `mcp_ctrl_mcp_pack_list` first to check whether a similar pack is already
  installed before creating a duplicate.
