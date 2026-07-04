#!/usr/bin/env python3
# CTRL master autonomous test (ADR-005 debug harness). One script:
#   Part A — capability smoke: drive every core gate tool, assert a correct return.
#   Part B — chat-turn E2E: drive full Irisy turns (think -> tool -> review -> answer).
# Needs the kernel running (dev build); gate token from ~/.ctrl/state/gate-token.
# Run:  python3 scripts/debug/test_all.py            (both parts)
#       python3 scripts/debug/test_all.py --no-turns (Part A only, fast)
import json, urllib.request, os, re, sys, time, threading
TOKEN = open(os.path.expanduser("~/.ctrl/state/gate-token")).read().strip()
AUTH = "Bearer " + TOKEN
BASE = "http://127.0.0.1:17873"

# ---- transports ----
def _http(path, data=None, timeout=180):
    h = {"Authorization": AUTH, "Content-Type": "application/json"}
    r = urllib.request.urlopen(urllib.request.Request(
        BASE + path, data=(json.dumps(data).encode() if data is not None else None),
        headers=h, method=("POST" if data is not None else "GET")), timeout=timeout)
    return json.loads(r.read().decode())

class Gate:
    """One MCP session over the :17873 gate."""
    def __init__(self, caller="pwa"):
        self.sid = None; self.caller = caller
        self._rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}})
        self._rpc("notifications/initialized", notif=True)
    def _rpc(self, m, p=None, notif=False):
        b = {"jsonrpc": "2.0", "method": m}
        if not notif: b["id"] = 1
        if p is not None: b["params"] = p
        h = {"Authorization": AUTH, "Content-Type": "application/json",
             "Accept": "application/json, text/event-stream", "x-ctrl-caller": self.caller}
        if self.sid: h["Mcp-Session-Id"] = self.sid
        r = urllib.request.urlopen(urllib.request.Request(BASE + "/mcp", data=json.dumps(b).encode(), headers=h, method="POST"), timeout=45)
        if r.headers.get("Mcp-Session-Id"): self.sid = r.headers["Mcp-Session-Id"]
        for ln in r.read().decode().splitlines():
            ln = ln.strip()
            if ln.startswith("data:"): ln = ln[5:].strip()
            if ln.startswith("{"):
                try: return json.loads(ln)
                except: pass
        return {}
    def call(self, tool, args=None):
        r = self._rpc("tools/call", {"name": tool, "arguments": args or {}})
        if "result" in r:
            c = r["result"].get("content")
            txt = c[0]["text"] if c else json.dumps(r["result"])
            return ("DEGRADE" if "SETUP NEEDED" in txt else "PASS"), txt[:70].replace("\n", " ")
        return "FAIL", json.dumps(r.get("error", r))[:80]

# ---- Part A: capabilities ----
def part_a():
    g = Gate()
    g.call("vault_write", {"path": "_fixture/seed.md", "body": "# Seed\nfixture body for reads.", "frontmatter": {"title": "seed", "tags": ["fixture"]}})
    g.call("smart_table_create", {"name": "captest", "fields": [{"key": "name", "label": "Name", "type": "text"}]})
    lr = g._rpc("tools/call", {"name": "vault_list", "arguments": {"subdir": "tables"}})
    tbl = None
    if "result" in lr:
        m = re.findall(r'"(tables/[^"]*captest[^"]*\.md)"', lr["result"]["content"][0]["text"])
        tbl = m[0] if m else None
    TESTS = [
        ("vault_list", {}), ("vault_read", {"path": "_fixture/seed.md"}), ("vault_search", {"query": "ctrl"}),
        ("vault_backlinks", {"path": "_fixture/seed.md"}), ("vault_tags", {}), ("vault_orphans", {}), ("vault_broken_links", {}),
        ("vault_write", {"path": "_captest/n.md", "body": "hi", "frontmatter": "title: T\ntags: [x]"}),
        ("note_map", {"path": "_fixture/seed.md"}), ("note_periodic", {"period": "daily"}), ("note_recent_changes", {}),
        ("smart_table_describe", {"path": tbl} if tbl else {}), ("smart_table_query", {"path": tbl} if tbl else {}),
        ("web_search", {"query": "tauri"}), ("market_quote", {"symbols": ["AAPL"]}), ("market_screen", {"screen": "day_gainers"}),
        ("discover_packs", {"query": "finance"}), ("discover_skills", {"query": "test"}), ("skill_list", {}),
        ("mcp_pack_list", {}), ("mcp_list_servers", {}), ("irisy_soul_get", {}), ("task_query", {}),
        ("kernel_status", {}), ("providers_query", {}), ("registry_query", {}), ("gate_tool_search", {"query": "note"}),
    ]
    print("== Part A: capabilities ==")
    tally = {}
    for t, a in TESTS:
        s, d = g.call(t, a); tally[s] = tally.get(s, 0) + 1
        print(f"  {t:<22} {s:<8} {d}")
    for p in ["_captest/n.md", "_fixture/seed.md", tbl]:
        if p: g.call("vault_delete", {"path": p})
    print(f"  -> {tally.get('PASS',0)} PASS  {tally.get('DEGRADE',0)} DEGRADE  {tally.get('FAIL',0)} FAIL")
    return tally.get("FAIL", 0) == 0

# ---- Part B: chat turns ----
def _turn(msg):
    hold = {}
    threading.Thread(target=lambda: hold.__setitem__("r", _http("/debug/irisy/turn", {"message": msg}))).start()
    for _ in range(150):
        time.sleep(1)
        if "r" in hold: break
        try:
            p = _http("/debug/review/pending")
            if p: _http("/debug/review/resolve", {"id": p[0]["id"], "approved": True})
        except: pass
    while "r" not in hold: time.sleep(1)
    return hold["r"]

def part_b():
    print("\n== Part B: chat-turn E2E (drive full Irisy turns) ==")
    ok = True
    # read/tool turn
    r = _turn("Search my notes vault for CTRL and tell me roughly how many, one sentence.")
    calls = [x.get("call") for x in r.get("tools", []) if x.get("call")]
    good = bool(calls) and bool((r.get("text") or "").strip())
    ok = ok and good
    print(f"  READ   tools={calls} -> {'OK' if good else 'FAIL'}: {(r.get('text') or r.get('error') or '').strip()[:90]}")
    # write turn (through the review gate) + verify on disk
    r = _turn("Create a note at _testall/e2e.md with body: master test. Confirm in one sentence.")
    calls = [x.get("call") for x in r.get("tools", []) if x.get("call")]
    g = Gate()
    on_disk = "result" in g._rpc("tools/call", {"name": "vault_read", "arguments": {"path": "_testall/e2e.md"}})
    g.call("vault_delete", {"path": "_testall/e2e.md"})
    good = ("mcp_ctrl_vault_write" in calls) and on_disk
    ok = ok and good
    print(f"  WRITE  tools={calls} on_disk={on_disk} -> {'OK' if good else 'FAIL'}: {(r.get('text') or r.get('error') or '').strip()[:90]}")
    return ok

def main():
    no_turns = "--no-turns" in sys.argv
    t0 = time.time()
    a = part_a()
    b = True if no_turns else part_b()
    print(f"\n===== {'ALL GREEN' if (a and b) else 'FAILURES'} =====  (capabilities:{'ok' if a else 'FAIL'}  chat-turns:{'skipped' if no_turns else ('ok' if b else 'FAIL')})  {time.time()-t0:.0f}s")
    sys.exit(0 if (a and b) else 1)

if __name__ == "__main__":
    main()
