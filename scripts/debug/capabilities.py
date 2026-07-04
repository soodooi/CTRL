#!/usr/bin/env python3
# Irisy capability smoke test (ADR-005 debug harness). Drives every core gate
# capability over the :17873 gate (HTTP MCP) and asserts a correct return.
# Run: python3 scripts/debug/capabilities.py   (kernel must be running / dev build)
import json, urllib.request, os, re, sys
TOKEN = open(os.path.expanduser("~/.ctrl/state/gate-token")).read().strip()
AUTH = "Bearer " + TOKEN
SID = {"v": None}
def rpc(m, p=None, notif=False):
    b = {"jsonrpc": "2.0", "method": m}
    if not notif: b["id"] = 1
    if p is not None: b["params"] = p
    h = {"Authorization": AUTH, "Content-Type": "application/json",
         "Accept": "application/json, text/event-stream", "x-ctrl-caller": "pwa"}
    if SID["v"]: h["Mcp-Session-Id"] = SID["v"]
    r = urllib.request.urlopen(urllib.request.Request(
        "http://127.0.0.1:17873/mcp", data=json.dumps(b).encode(), headers=h, method="POST"), timeout=45)
    if r.headers.get("Mcp-Session-Id"): SID["v"] = r.headers["Mcp-Session-Id"]
    for ln in r.read().decode().splitlines():
        ln = ln.strip()
        if ln.startswith("data:"): ln = ln[5:].strip()
        if ln.startswith("{"):
            try: return json.loads(ln)
            except: pass
    return {}
def call(t, a=None):
    r = rpc("tools/call", {"name": t, "arguments": a or {}})
    if "result" in r:
        c = r["result"].get("content")
        txt = c[0]["text"] if c else json.dumps(r["result"])
        if "SETUP NEEDED" in txt: return "DEGRADE", txt[:70]
        return "PASS", txt[:70].replace("\n", " ")
    return "FAIL", json.dumps(r.get("error", r))[:80]

rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "cap", "version": "1"}})
rpc("notifications/initialized", notif=True)

# throwaway table for smart-table tests
call("smart_table_create", {"name": "captest", "fields": [{"key": "name", "label": "Name", "type": "text"}]})
lr = rpc("tools/call", {"name": "vault_list", "arguments": {"subdir": "tables"}})
tbl = None
if "result" in lr:
    m = re.findall(r'"(tables/[^"]*captest[^"]*\.md)"', lr["result"]["content"][0]["text"])
    tbl = m[0] if m else None

TESTS = [
    ("vault_list", {}), ("vault_read", {"path": "AGENTS.md"}), ("vault_search", {"query": "ctrl"}),
    ("vault_backlinks", {"path": "AGENTS.md"}), ("vault_tags", {}), ("vault_orphans", {}),
    ("vault_broken_links", {}), ("vault_write", {"path": "_captest/n.md", "body": "hi", "frontmatter": "title: T\ntags: [x]"}),
    ("note_map", {"path": "AGENTS.md"}), ("note_periodic", {"period": "daily"}), ("note_recent_changes", {}),
    ("smart_table_describe", {"path": tbl} if tbl else {}), ("smart_table_query", {"path": tbl} if tbl else {}),
    ("web_search", {"query": "tauri"}), ("market_quote", {"symbols": ["AAPL"]}), ("market_screen", {"screen": "day_gainers"}),
    ("discover_packs", {"query": "finance"}), ("discover_skills", {"query": "test"}), ("skill_list", {}),
    ("mcp_pack_list", {}), ("mcp_list_servers", {}), ("irisy_soul_get", {}), ("task_query", {}),
    ("kernel_status", {}), ("providers_query", {}), ("registry_query", {}), ("gate_tool_search", {"query": "note"}),
]
print(f"{'CAPABILITY':<22} STATUS    RETURN")
print("-" * 92)
tally = {}
for t, a in TESTS:
    s, d = call(t, a); tally[s] = tally.get(s, 0) + 1
    print(f"{t:<22} {s:<8} {d}")
for p in ["_captest/n.md", tbl]:
    if p: call("vault_delete", {"path": p})
print("-" * 92)
print(f"TOTAL: {tally.get('PASS',0)} PASS  {tally.get('DEGRADE',0)} DEGRADE(correct)  {tally.get('FAIL',0)} FAIL")
sys.exit(1 if tally.get("FAIL", 0) else 0)
