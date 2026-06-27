# ctrl-websearch

A CTRL feature pack (stdio MCP server) giving Irisy — or any MCP host —
**multi-source web search with automatic failover**.

## Why

hermes 0.16.0 binds a *single* web-search backend per call, and its
ordered failover-chain work is still upstream
([NousResearch/hermes-agent#32159](https://github.com/NousResearch/hermes-agent/issues/32159)).
So a free backend that rate-limits or runs out of quota just fails. This
pack owns the "try several sources, fall through on quota/limit/error"
behaviour instead, so search keeps working with no key.

## The `web_search` tool

Ordered failover chain — first non-empty result wins; each source is
skipped when its key is absent and fallen through on error / rate-limit /
exhausted quota:

| order | source     | cost            | needs                      |
|-------|------------|-----------------|----------------------------|
| 1     | ddgs       | free, no signup | `ddgs` package             |
| 2     | searxng    | free            | `SEARXNG_URL` (defaults to a public instance) |
| 3     | brave-free | free tier       | `BRAVE_SEARCH_API_KEY`     |
| 4     | tavily     | paid / free tier| `TAVILY_API_KEY`           |
| 5     | wikipedia  | free, keyless   | — (always-on floor)        |

Returns `{ source, results: [{title, url, snippet}], tried }`. Search-only
by design; full-page extraction is a separate concern (Tavily/Firecrawl or
the host's browser tool).

## Run standalone

```sh
uvx --from . --with ddgs,httpx ctrl-websearch
```

## In CTRL

Connected over the kernel `mcp_host` like any downstream MCP server; the
call is governed at the `:17873` gate. The manifest declares only the
`network.http` capability — no filesystem, no shell.

## License

MIT.
