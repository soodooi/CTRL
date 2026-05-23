"""Hermes plugin entry point — register() is called by hermes_agent on
plugin discovery. We register 11 tools, each forwarding to the kernel
MCP server via the thin httpx client.

Per ADR-019, the plugin contains zero business logic — each handler is
~3 lines of shim. New kernel tools added in the kernel MCP server are
exposed here by adding a single handler + register_tool call.

The hermes_agent plugin API surface this code targets (subject to
upstream version pin in plugin.yaml requires.hermes_agent):

    from hermes_agent.plugin_api import PluginContext, register_tool

    def register(ctx: PluginContext) -> None: ...

If hermes_agent's plugin_api module path changes in a future version,
update the import below + the plugin.yaml `requires.hermes_agent` field.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

# hermes_agent plugin API (imported lazily so this module is importable
# without hermes_agent installed — useful for tests).
try:  # pragma: no cover — exercised at hermes plugin load time
    from hermes_agent.plugin_api import PluginContext, register_tool
except ImportError:  # pragma: no cover
    PluginContext = Any  # type: ignore[assignment, misc]

    def register_tool(*_args: Any, **_kwargs: Any) -> None:  # type: ignore[misc]
        raise RuntimeError(
            "hermes_agent.plugin_api not available — install hermes-agent >= 0.14.0"
        )


from ctrl_hermes_plugin.mcp_client import call_tool


# ────────────────────────────────────────────────────────────────────
# Tool handlers — each is a thin shim. The hermes_agent plugin API
# binds the handler name as the tool's user-facing name; the kernel-
# side MCP server name is what we pass into `call_tool`.
# ────────────────────────────────────────────────────────────────────


def ctrl_kernel_status() -> Any:
    """Report CTRL kernel health: uptime, registered LLM adapters, MCP server count."""
    return call_tool("kernel_status")


def ctrl_vault_read(path: str) -> Any:
    """Read a markdown file from the user's vault."""
    return call_tool("vault_read", {"path": path})


def ctrl_vault_write(
    path: str,
    body: str,
    frontmatter: Optional[Mapping[str, Any]] = None,
) -> Any:
    """Write a markdown file to the user's vault (creates parent dirs)."""
    args: dict[str, Any] = {"path": path, "body": body}
    if frontmatter is not None:
        args["frontmatter"] = frontmatter
    return call_tool("vault_write", args)


def ctrl_vault_list(subdir: Optional[str] = None) -> Any:
    """List markdown files under a vault subdirectory."""
    args: dict[str, Any] = {}
    if subdir is not None:
        args["subdir"] = subdir
    return call_tool("vault_list", args)


def ctrl_vault_search(query: str, limit: Optional[int] = None) -> Any:
    """Full-text search the vault (FTS5 when available, substring fallback)."""
    args: dict[str, Any] = {"query": query}
    if limit is not None:
        args["limit"] = limit
    return call_tool("vault_search", args)


def ctrl_kv_get(namespace: str, key: str) -> Any:
    """Read a persistent key from per-keycap local storage."""
    return call_tool("kv_get", {"namespace": namespace, "key": key})


def ctrl_kv_set(namespace: str, key: str, value: Any) -> Any:
    """Write a persistent key into per-keycap local storage."""
    return call_tool("kv_set", {"namespace": namespace, "key": key, "value": value})


def ctrl_llm_chat(
    messages: list[Mapping[str, str]],
    model: Optional[str] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> Any:
    """Run a non-streaming LLM chat completion via CTRL kernel's LLM port."""
    args: dict[str, Any] = {"messages": list(messages)}
    if model is not None:
        args["model"] = model
    if temperature is not None:
        args["temperature"] = temperature
    if max_tokens is not None:
        args["max_tokens"] = max_tokens
    return call_tool("llm_chat", args)


def ctrl_mcp_list_servers() -> Any:
    """List external MCP servers the kernel has registered (proxy view)."""
    return call_tool("mcp_list_servers")


def ctrl_mcp_proxy_list_tools(server: str) -> Any:
    """List tools advertised by a downstream MCP server (kernel proxies)."""
    return call_tool("mcp_proxy_list_tools", {"server": server})


def ctrl_mcp_proxy_call_tool(
    server: str,
    tool: str,
    arguments: Optional[Mapping[str, Any]] = None,
) -> Any:
    """Invoke a tool on a downstream MCP server (kernel proxies)."""
    args: dict[str, Any] = {"server": server, "tool": tool}
    if arguments is not None:
        args["arguments"] = dict(arguments)
    return call_tool("mcp_proxy_call_tool", args)


# ────────────────────────────────────────────────────────────────────


_ALL_TOOLS = (
    ctrl_kernel_status,
    ctrl_vault_read,
    ctrl_vault_write,
    ctrl_vault_list,
    ctrl_vault_search,
    ctrl_kv_get,
    ctrl_kv_set,
    ctrl_llm_chat,
    ctrl_mcp_list_servers,
    ctrl_mcp_proxy_list_tools,
    ctrl_mcp_proxy_call_tool,
)


def register(ctx: "PluginContext") -> None:
    """Hermes plugin entry point. Called once on plugin discovery."""
    for handler in _ALL_TOOLS:
        register_tool(ctx, handler)
