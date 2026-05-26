"""Minimal MCP client over HTTP — forwards `tools/call` requests to the
kernel MCP server at the handshake URL.

We don't use the full rmcp Python client because the plugin only needs a
single method (`tools/call`) and pulling in a heavy dependency would bloat
the plugin install. JSON-RPC over POST with a Bearer header is enough.
"""

from __future__ import annotations

import json
from typing import Any, Mapping, Optional

import httpx

from ctrl_hermes_plugin.handshake import get_handshake, invalidate_handshake


class KernelCallError(Exception):
    """Raised when the kernel MCP server returns an error or HTTP failure."""


def call_tool(
    tool_name: str,
    arguments: Optional[Mapping[str, Any]] = None,
    *,
    timeout: float = 60.0,
) -> Any:
    """Invoke a tool on the kernel MCP server.

    Refreshes the handshake on 401 (token rotated by a kernel restart)
    and retries once. Returns the tool's structured result.
    """
    return _call_with_retry(tool_name, arguments, timeout, attempt=1)


def _call_with_retry(
    tool_name: str,
    arguments: Optional[Mapping[str, Any]],
    timeout: float,
    *,
    attempt: int,
) -> Any:
    handshake = get_handshake()
    request_id = f"ctrl-plugin-{tool_name}-{attempt}"
    body = {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": dict(arguments or {}),
        },
    }
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {handshake.token}",
    }
    try:
        response = httpx.post(
            handshake.url,
            content=json.dumps(body),
            headers=headers,
            timeout=timeout,
        )
    except httpx.HTTPError as e:
        raise KernelCallError(f"HTTP failure invoking {tool_name}: {e}") from e

    if response.status_code == 401 and attempt == 1:
        invalidate_handshake()
        return _call_with_retry(tool_name, arguments, timeout, attempt=attempt + 1)

    if response.status_code >= 400:
        raise KernelCallError(
            f"kernel {tool_name} returned HTTP {response.status_code}: {response.text}"
        )

    try:
        payload = response.json()
    except ValueError as e:
        raise KernelCallError(f"kernel {tool_name} returned non-JSON: {e}") from e

    if "error" in payload:
        err = payload["error"]
        raise KernelCallError(
            f"kernel {tool_name} error {err.get('code')}: {err.get('message')}"
        )

    return payload.get("result")
