#!/usr/bin/env python3
# Drive ONE full Irisy conversation turn end-to-end (ADR-005 debug harness):
# message -> think -> tool selection -> review pause -> auto-approve -> answer.
# Uses the dev-only /debug/irisy/turn endpoint (isolated engine, never the user's
# live session) + /debug/review/* to approve any write the turn triggers.
# Run: python3 scripts/debug/chat_turn.py "your message to Irisy"
import json, urllib.request, os, sys, time, threading
TOKEN = open(os.path.expanduser("~/.ctrl/state/gate-token")).read().strip()
AUTH = "Bearer " + TOKEN
def http(path, data=None):
    h = {"Authorization": AUTH, "Content-Type": "application/json"}
    r = urllib.request.urlopen(urllib.request.Request(
        "http://127.0.0.1:17873" + path,
        data=(json.dumps(data).encode() if data is not None else None),
        headers=h, method=("POST" if data is not None else "GET")), timeout=180)
    return json.loads(r.read().decode())

msg = sys.argv[1] if len(sys.argv) > 1 else "Search my notes for CTRL and tell me the count in one sentence."
hold = {}
threading.Thread(target=lambda: hold.__setitem__("r", http("/debug/irisy/turn", {"message": msg}))).start()
print(f"driving Irisy: {msg!r}\n(auto-approving any write the turn triggers)")
for _ in range(120):
    time.sleep(1)
    if "r" in hold:
        break
    try:
        pend = http("/debug/review/pending")
        if pend:
            print(f"  review fired: {pend[0]['tool']} -> approving")
            http("/debug/review/resolve", {"id": pend[0]["id"], "approved": True})
    except Exception:
        pass
while "r" not in hold:
    time.sleep(1)
r = hold["r"]
print("\nTHOUGHTS:", (r.get("thoughts") or "(none)")[:200])
print("TOOLS:   ", [json.dumps(x)[:90] for x in r.get("tools", [])])
print("ANSWER:  ", (r.get("text") or r.get("error") or "(none)")[:400])
print("stop:", r.get("stop_reason"))
