"""ctrl-websearch — a CTRL feature pack (stdio MCP server).

One tool, `web_search`, backed by an ordered multi-source failover chain.
hermes 0.16.0 binds a single backend per call and its failover-chain work
is still upstream (NousResearch/hermes-agent#32159), so CTRL owns the
"try several free sources, fall through on quota/limit/error" behaviour
here — exactly what the kernel's single-source web_search could not do.

Source order (first non-empty result wins; each is skipped when its key
is absent and fallen through when it errors / rate-limits / runs out of
quota):

    ddgs        DuckDuckGo, free, no key, no signup        (default)
    searxng     public SearXNG instance, free, no key, 70+ engines
    brave-free  Brave Search free tier      (needs BRAVE_SEARCH_API_KEY)
    tavily      full web + freshness        (needs TAVILY_API_KEY)
    wikipedia   keyless encyclopedic floor — always available

Search-only by design (titles + URLs + snippets). Extraction of full page
bodies is a separate concern (Tavily/Firecrawl or the local browser tool).

Zero CTRL business logic leaks in here: this is a self-contained MIT pack
that any MCP host can run; CTRL connects it over its mcp_host like any
other downstream MCP server and governs the call at the :17873 gate.
"""

from __future__ import annotations

import os
from typing import Callable

import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("ctrl-websearch")

# Public SearXNG instance used when the user has not pointed us at their
# own. Overridable via SEARXNG_URL so a privacy-conscious user can self-host.
DEFAULT_SEARXNG = os.environ.get("SEARXNG_URL", "https://searx.be")

_UA = "ctrl-websearch/0.1 (+https://github.com/soodooi/ctrl-websearch)"
_TIMEOUT = httpx.Timeout(12.0)


class SourceUnavailable(Exception):
    """Raised when a source is not configured (no key) — skip, don't fail."""


def _result(title: str, url: str, snippet: str) -> dict:
    return {"title": title or "", "url": url or "", "snippet": snippet or ""}


def _ddgs(query: str, n: int) -> list[dict]:
    # ddgs scrapes DuckDuckGo; availability is package-presence only.
    from ddgs import DDGS  # imported lazily so a missing pkg skips, not crashes

    with DDGS() as ddg:
        hits = ddg.text(query, max_results=n) or []
    return [_result(h.get("title"), h.get("href") or h.get("url"), h.get("body")) for h in hits]


def _searxng(query: str, n: int) -> list[dict]:
    r = httpx.get(
        f"{DEFAULT_SEARXNG.rstrip('/')}/search",
        params={"q": query, "format": "json"},
        headers={"User-Agent": _UA},
        timeout=_TIMEOUT,
        follow_redirects=True,
    )
    r.raise_for_status()
    hits = (r.json().get("results") or [])[:n]
    return [_result(h.get("title"), h.get("url"), h.get("content")) for h in hits]


def _brave_free(query: str, n: int) -> list[dict]:
    key = os.environ.get("BRAVE_SEARCH_API_KEY")
    if not key:
        raise SourceUnavailable("BRAVE_SEARCH_API_KEY not set")
    r = httpx.get(
        "https://api.search.brave.com/res/v1/web/search",
        params={"q": query, "count": n},
        headers={"X-Subscription-Token": key, "Accept": "application/json", "User-Agent": _UA},
        timeout=_TIMEOUT,
    )
    r.raise_for_status()
    hits = ((r.json().get("web") or {}).get("results") or [])[:n]
    return [_result(h.get("title"), h.get("url"), h.get("description")) for h in hits]


def _tavily(query: str, n: int) -> list[dict]:
    key = os.environ.get("TAVILY_API_KEY")
    if not key:
        raise SourceUnavailable("TAVILY_API_KEY not set")
    r = httpx.post(
        "https://api.tavily.com/search",
        json={"api_key": key, "query": query, "max_results": n},
        headers={"User-Agent": _UA},
        timeout=_TIMEOUT,
    )
    r.raise_for_status()
    hits = (r.json().get("results") or [])[:n]
    return [_result(h.get("title"), h.get("url"), h.get("content")) for h in hits]


def _wikipedia(query: str, n: int) -> list[dict]:
    r = httpx.get(
        "https://en.wikipedia.org/w/api.php",
        params={
            "action": "query",
            "list": "search",
            "srsearch": query,
            "srlimit": n,
            "format": "json",
        },
        headers={"User-Agent": _UA},
        timeout=_TIMEOUT,
    )
    r.raise_for_status()
    hits = (r.json().get("query", {}).get("search") or [])[:n]
    return [
        _result(
            h.get("title"),
            f"https://en.wikipedia.org/wiki/{(h.get('title') or '').replace(' ', '_')}",
            # strip the HTML span markup wikipedia returns in snippets
            httpx_strip_tags(h.get("snippet", "")),
        )
        for h in hits
    ]


def httpx_strip_tags(s: str) -> str:
    import re

    return re.sub(r"<[^>]+>", "", s or "")


# Ordered failover chain. Free + keyless first (zero friction), paid keys
# upgrade quality when present, wikipedia is the always-on floor.
SOURCES: list[tuple[str, Callable[[str, int], list[dict]]]] = [
    ("ddgs", _ddgs),
    ("searxng", _searxng),
    ("brave-free", _brave_free),
    ("tavily", _tavily),
    ("wikipedia", _wikipedia),
]


@mcp.tool()
def web_search(query: str, max_results: int = 5) -> dict:
    """Search the web across multiple sources with automatic failover.

    Tries free/keyless sources first and falls through to the next source
    on any error, rate-limit, or exhausted free quota, so search keeps
    working without a key. Returns titles + URLs + snippets.

    Args:
        query: what to look up.
        max_results: max results to return (1-10).
    """
    # Optional call trace for diagnostics — writes only when the host sets
    # CTRL_WEBSEARCH_DEBUG to a path. No-op in normal operation.
    _dbg = os.environ.get("CTRL_WEBSEARCH_DEBUG")
    if _dbg:
        try:
            with open(_dbg, "a") as _f:
                _f.write(f"web_search {query!r}\n")
        except OSError:
            pass

    query = (query or "").strip()
    if not query:
        return {"source": None, "results": [], "error": "query must not be empty"}
    n = max(1, min(int(max_results or 5), 10))

    tried: list[dict] = []
    for name, fn in SOURCES:
        try:
            results = fn(query, n)
        except SourceUnavailable as e:
            tried.append({"source": name, "skipped": str(e)})
            continue
        except Exception as e:  # noqa: BLE001 — any failure = fall through
            tried.append({"source": name, "failed": f"{type(e).__name__}: {e}"})
            continue
        if results:
            return {"source": name, "results": results, "tried": tried}
        tried.append({"source": name, "empty": True})

    return {"source": None, "results": [], "tried": tried,
            "error": "all sources failed or returned nothing"}


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
