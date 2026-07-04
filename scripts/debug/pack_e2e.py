#!/usr/bin/env python3
# pack_e2e.py — simulate Irisy operating a feature pack end-to-end over the :17873 gate.
#
# Proves the ctrl-ghostfolio seed (GOAL.md) + ADR-002 §7.5 three properties by driving
# the WHOLE feature-pack chain through the real kernel gate:
#   create (Irisy mcp-creator)  -> scaffold -> validate/evals -> install
#   govern + uplift (the moat)  -> describe / query / produce, per-call review gate
#   share  (Irisy publish)      -> publish (evals-first) to a registry
#
# The Ghostfolio upstream + the registry are MOCKED here (a live self-hosted instance +
# a real public registry need bao's machine — the same honest gap every gate smoke has).
# Everything CTRL-side is real: the kernel, the :17873 gate, the generic §14 connector
# engine, the review gate, the evals. Nothing about the pack is hand-coded per-connector —
# it is pure manifest data through the generic tools, which is the whole proposition.
#
# Needs the kernel running in a DEBUG build (dev endpoints: /debug/secret/set + /debug/review/*).
#   cargo run --manifest-path src-tauri/Cargo.toml --bin ctrl_kernel &
#   python3 scripts/debug/pack_e2e.py
#
# Isolation: installs under id `ctrl-ghostfolio-e2e` so it never touches a real
# ctrl-ghostfolio the user may have configured; cleans itself up on exit.

import json, os, sys, time, threading, http.server, socketserver, shutil

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_all import Gate, _http  # reuse the gate session + /debug transport

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_MANIFEST = os.path.join(HERE, "..", "..", "packages", "ctrl-mcps", "builtin", "ctrl-ghostfolio", "manifest.json")
PACK_ID = "ctrl-ghostfolio-e2e"  # isolated from any real ctrl-ghostfolio install
MCP_DIR = os.path.expanduser(f"~/.ctrl/mcps/{PACK_ID}")

# ---------------------------------------------------------------- mock upstreams
# Ghostfolio's REST surface the manifest declares: bootstrap -> token-exchange ->
# holdings (query) + order (produce). Three holdings so the allocation>10 filter
# has something to prune (GLD at 7.6 must drop out — proves the query really runs).
HOLDINGS = {"holdings": [
    {"symbol": "AAPL", "name": "Apple Inc.", "quantity": 10, "valueInBaseCurrency": 1900, "allocationInPercentage": 62.3, "currency": "USD"},
    {"symbol": "MSFT", "name": "Microsoft",  "quantity": 5,  "valueInBaseCurrency": 2100, "allocationInPercentage": 30.1, "currency": "USD"},
    {"symbol": "GLD",  "name": "Gold ETF",   "quantity": 3,  "valueInBaseCurrency": 600,  "allocationInPercentage": 7.6,  "currency": "USD"},
]}
orders = []       # produce POSTs the connector forwarded to /api/v1/order
published = []     # manifests the publish tool POSTed to the registry


class MockGhostfolio(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n) if n else b"{}"
        if self.path == "/api/v1/user":            # auth.bootstrap: mint a security token
            return self._json({"accessToken": "mock-security-token"})
        if self.path == "/api/v1/auth/anonymous":  # auth.token_exchange: token -> JWT bearer
            return self._json({"authToken": "mock-jwt-bearer"})
        if self.path == "/api/v1/order":           # record_source.produce: record a trade
            try: orders.append(json.loads(body))
            except Exception: pass
            return self._json({"id": f"order-{len(orders)}", "status": "created"})
        self._json({"error": "not found"}, 404)
    def do_GET(self):
        if self.path.startswith("/api/v1/portfolio/holdings"):  # record_source.query
            return self._json(HOLDINGS)
        if self.path.startswith("/api/v1/health"):
            return self._json({"status": "ok"})
        self._json({"error": "not found"}, 404)


class MockRegistry(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n) if n else b"{}"
        try: m = json.loads(body)
        except Exception: m = {}
        published.append(m)
        ref = {"id": m.get("id", "?"), "namespace": "soodooi", "url": "mock://registry/soodooi/" + m.get("id", "?")}
        b = json.dumps(ref).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)


def serve(handler):
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)  # ephemeral port
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


# ---------------------------------------------------------------- gate helpers
def call_full(g, tool, args=None):
    """Call a gate tool, return (ok, parsed_json_or_text). Full result, not the 70-char snippet."""
    r = g._rpc("tools/call", {"name": tool, "arguments": args or {}})
    if "result" not in r:
        return False, json.dumps(r.get("error", r))
    c = r["result"].get("content")
    txt = c[0]["text"] if c else json.dumps(r["result"])
    try: return True, json.loads(txt)
    except Exception: return True, txt


def secret_set(account, value):
    return _http("/debug/secret/set", {"account": account, "value": value})


FAILS = []
def check(cond, label, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}" + (f"  — {str(detail)[:110]}" if detail else ""))
    if not cond:
        FAILS.append(label)


def produce_with_review(caller, source_id, inp, auto_approve):
    """Drive source_produce as `caller`. If the review gate fires, a background poll
    approves it (auto_approve). Returns (saw_pending, ok, result)."""
    hold = {}
    def do():
        try:
            g = Gate(caller=caller)
            hold["r"] = call_full(g, "source_produce", {"source_id": source_id, "input": inp})
        except Exception as e:
            hold["r"] = (False, f"exception: {e}")
    t = threading.Thread(target=do)
    t.start()
    saw_pending = False
    for _ in range(40):  # ~20s; well under the gate's 120s fail-closed
        if "r" in hold:
            break
        time.sleep(0.5)
        try:
            p = _http("/debug/review/pending")
            if p:
                saw_pending = True
                if auto_approve:
                    _http("/debug/review/resolve", {"id": p[0]["id"], "approved": True})
        except Exception:
            pass
    t.join(timeout=5)
    ok, res = hold.get("r", (False, "no result"))
    return saw_pending, ok, res


# ---------------------------------------------------------------- the scenario
OPENAPI = {
    "openapi": "3.0.0",
    "info": {"title": "Ghostfolio", "version": "1"},
    "paths": {
        "/api/v1/portfolio/holdings": {
            "get": {
                "responses": {"200": {"content": {"application/json": {"schema": {
                    "type": "object",
                    "properties": {"holdings": {"type": "array", "items": {"type": "object", "properties": {
                        "symbol": {"type": "string"},
                        "quantity": {"type": "number"},
                        "allocationInPercentage": {"type": "number"},
                    }}}},
                }}}}},
            }
        }
    },
}


def main():
    manifest = json.load(open(REAL_MANIFEST))
    manifest["id"] = PACK_ID  # isolate from a real ctrl-ghostfolio install

    gf, gf_port = serve(MockGhostfolio)
    reg, reg_port = serve(MockRegistry)
    base = f"http://127.0.0.1:{gf_port}"
    registry_url = f"http://127.0.0.1:{reg_port}/"

    g = Gate(caller="irisy")  # Irisy is the assistant surface driving creation + reads

    print("== simulate Irisy: ctrl-ghostfolio end-to-end ==")

    # -- SETUP: represents the user having configured the connector + provision having
    #    bootstrapped a security token. The docker `provision.service` (Ghostfolio's
    #    compose stack) is the bao-machine gap; here we point the connector at the mock.
    secret_set(f"mcp:{PACK_ID}:_base_url", base)
    secret_set(f"mcp:{PACK_ID}:ghostfolio_token", "mock-security-token")

    # ============================================================ 1. CREATE
    print("\n-- create (Irisy mcp-creator) --")
    ok, scaf = call_full(g, "mcp_pack_scaffold", {"openapi": OPENAPI, "path": "/api/v1/portfolio/holdings"})
    fields = (scaf.get("record_source", {}).get("fields") if isinstance(scaf, dict) else None) or []
    keys = [f.get("key") for f in fields]
    check(ok and "symbol" in keys, "scaffold drafts a record_source from OpenAPI", f"fields={keys}")

    ok, rep = call_full(g, "mcp_pack_validate", {"manifest": manifest})
    valid = isinstance(rep, dict) and rep.get("ok") is True
    errs = [i for i in (rep.get("issues") or []) if i.get("severity") == "error"] if isinstance(rep, dict) else []
    check(valid and not errs, "validate/evals pass (the quality moat)", f"fields={rep.get('record_source_fields') if isinstance(rep,dict) else rep}")

    ok, ins = call_full(g, "mcp_pack_install", {"manifest": manifest})
    on_disk = os.path.isfile(os.path.join(MCP_DIR, "manifest.json"))
    check(ok and on_disk, "install writes the pack to ~/.ctrl/mcps", ins)

    # ============================================================ 2. OPERATE (§14 uplift)
    print("\n-- operate: §14 describe / query / produce (the AI-native uplift) --")
    ok, desc = call_full(g, "source_describe", {"source_id": PACK_ID})
    dfields = (desc.get("fields") if isinstance(desc, dict) else None) or []
    check(ok and len(dfields) == 6, "describe returns the 6 §14 fields + operators", f"n={len(dfields)}")

    ok, q = call_full(g, "source_query", {
        "source_id": PACK_ID,
        "filters": [{"field": "allocation", "op": "gt", "value": "10"}],
    })
    rows = (q.get("rows") if isinstance(q, dict) else None) or []
    syms = sorted(r.get("symbol") for r in rows if isinstance(r, dict))
    # AAPL(62.3) + MSFT(30.1) pass; GLD(7.6) must be pruned -> proves the query really executed
    check(ok and syms == ["AAPL", "MSFT"], "query fetches live + filters (allocation>10 prunes GLD)", f"rows={syms}")

    trade = {"symbol": "AAPL", "kind": "buy", "quantity": "3", "unitPrice": "195",
             "currency": "USD", "date": "2026-07-04", "dataSource": "YAHOO"}

    # 2a. produce as irisy (a user surface) — review gate EXEMPT, passes silently
    before = len(orders)
    saw, ok, res = produce_with_review("irisy", PACK_ID, trade, auto_approve=False)
    check(ok and not saw and len(orders) == before + 1,
          "produce as irisy: user-surface EXEMPT, no review, trade recorded", res)

    # 2b. produce as hermes (the brain) — review gate MUST fire; approve -> then recorded
    before = len(orders)
    saw, ok, res = produce_with_review("hermes", PACK_ID, trade, auto_approve=True)
    check(saw, "produce as hermes: review gate FIRES (moat covers the brain)", "" if saw else "no pending seen")
    check(ok and len(orders) == before + 1, "produce as hermes: recorded AFTER approval", res)

    # the connector really mapped kind->type uppercased (§14 produce body transform)
    last = orders[-1] if orders else {}
    check(last.get("type") == "BUY", "produce body-map applied (kind->type uppercased)", last)

    # ============================================================ 3. SHARE
    print("\n-- share (Irisy publish to a commons, evals-first) --")
    ok, pub = call_full(g, "mcp_pack_publish", {"mcp_id": PACK_ID, "registry": registry_url})
    ref = pub if isinstance(pub, dict) else {}
    check(ok and published and ref.get("namespace"),
          "publish evals then POSTs the manifest to the registry", ref)

    # ---------------------------------------------------------------- cleanup
    try:
        gg = Gate(caller="pwa")
        gg.call("mcp_pack_uninstall", {"id": PACK_ID})
    except Exception:
        pass
    if os.path.isdir(MCP_DIR):
        shutil.rmtree(MCP_DIR, ignore_errors=True)
    secret_set(f"mcp:{PACK_ID}:_base_url", "")
    secret_set(f"mcp:{PACK_ID}:ghostfolio_token", "")

    print(f"\n===== {'ALL GREEN' if not FAILS else 'FAILURES: ' + ', '.join(FAILS)} =====")
    print("     create -> govern -> uplift(describe/query/produce) -> share, whole chain over the real gate")
    print("     (mock Ghostfolio + mock registry — a live instance needs bao's machine, same honest gap)")
    sys.exit(0 if not FAILS else 1)


if __name__ == "__main__":
    main()
