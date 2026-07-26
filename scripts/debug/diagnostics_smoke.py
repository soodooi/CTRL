#!/usr/bin/env python3
"""Read-only Irisy/Coding/Notes diagnostics smoke over the :17873 gate.

The harness prints health summaries and event counts only. It never enables
capture, exports data, starts an owner, or prints event attributes.
(ADR-003 frontend § diagnostics-surface v26)
"""

import json
import os
import sys
import urllib.request

ENDPOINT = "http://127.0.0.1:17873/mcp"
SESSION_ID = None


def token() -> str:
    path = os.path.expanduser("~/.ctrl/state/gate-token")
    with open(path, encoding="utf-8") as handle:
        return handle.read().strip()


def rpc(method: str, params=None, notification: bool = False):
    global SESSION_ID
    payload = {"jsonrpc": "2.0", "method": method}
    if not notification:
        payload["id"] = 1
    if params is not None:
        payload["params"] = params
    headers = {
        "Authorization": f"Bearer {token()}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "x-ctrl-caller": "pwa",
        "x-ctrl-intent": "diagnostics",
    }
    if SESSION_ID:
        headers["Mcp-Session-Id"] = SESSION_ID
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        SESSION_ID = response.headers.get("Mcp-Session-Id", SESSION_ID)
        for line in response.read().decode().splitlines():
            line = line.strip()
            if line.startswith("data:"):
                line = line[5:].strip()
            if line.startswith("{"):
                return json.loads(line)
    return {}


def call(name: str, arguments: dict) -> dict:
    response = rpc("tools/call", {"name": name, "arguments": arguments})
    if "error" in response:
        raise RuntimeError(response["error"])
    content = response.get("result", {}).get("content", [])
    if not content:
        raise RuntimeError(f"{name} returned no content")
    return json.loads(content[0]["text"])


def main() -> int:
    rpc(
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "ctrl-diagnostics-smoke", "version": "1"},
        },
    )
    rpc("notifications/initialized", notification=True)

    failed = False
    for module in ("irisy", "coding", "notes"):
        status = call("diagnostics_status", {"module": module})
        smoke = call("diagnostics_smoke", {"module": module})
        trace = call("diagnostics_trace", {"module": module, "limit": 20})
        required_status = {"startup", "live", "ready", "health", "summary"}
        if not required_status.issubset(status) or "checks" not in smoke or "events" not in trace:
            raise RuntimeError(f"{module} diagnostics response is incomplete")
        health = smoke["health"]
        failed = failed or health == "failed"
        print(
            f"{module:<7} status={status['health']:<8} "
            f"startup={status['startup']:<8} smoke={health:<8} "
            f"events={len(trace['events'])} summary={status['summary']}"
        )

    return 1 if failed else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print(f"diagnostics smoke failed: {error}", file=sys.stderr)
        raise SystemExit(1)
