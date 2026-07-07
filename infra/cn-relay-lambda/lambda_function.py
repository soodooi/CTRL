# CTRL CN market-data relay (AWS Lambda + Function URL).
# Thin token-authed fetch proxy with a strict host whitelist, deployed to
# ap-east-1 (Hong Kong) to reach mainland financial hosts. No server to manage.
import base64, os, urllib.request, urllib.parse
import socket as _socket

# Lambda has no IPv6 egress; some CN hosts (push2his.eastmoney.com) publish AAAA
# records and Python tries IPv6 first -> [Errno 99] Cannot assign requested
# address. Force IPv4-only resolution.
_orig_gai = _socket.getaddrinfo
def _ipv4_gai(*a, **k):
    res = _orig_gai(*a, **k)
    v4 = [r for r in res if r[0] == _socket.AF_INET]
    return v4 or res
_socket.getaddrinfo = _ipv4_gai

TOKEN = os.environ.get("RELAY_TOKEN", "")
ALLOW = {
    "qt.gtimg.cn", "web.sqt.gtimg.cn",
    "push2his.eastmoney.com", "1.push2his.eastmoney.com", "7.push2his.eastmoney.com",
    "push2.eastmoney.com", "push2delay.eastmoney.com",
    "hq.sinajs.cn",
    "datacenter-web.eastmoney.com", "datacenter.eastmoney.com",
    "push2ex.eastmoney.com",
}

def _resp(code, body, ct="text/plain", b64=False):
    return {"statusCode": code, "headers": {"Content-Type": ct},
            "body": body, "isBase64Encoded": b64}

def handler(event, _ctx):
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    path = event.get("rawPath", "") or ""
    qs = event.get("queryStringParameters") or {}
    if path.endswith("/health"):
        return _resp(200, "ok")
    if headers.get("authorization", "") != f"Bearer {TOKEN}":
        return _resp(401, "unauthorized")
    u = qs.get("u", "")
    if not u:
        return _resp(400, "missing u")
    host = urllib.parse.urlparse(u).hostname or ""
    if host not in ALLOW:
        return _resp(403, f"host not allowed: {host}")
    try:
        req = urllib.request.Request(u, headers={
            "User-Agent": "Mozilla/5.0", "Referer": "https://finance.eastmoney.com/"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = r.read()
            ct = r.headers.get("Content-Type", "application/octet-stream")
        return _resp(200, base64.b64encode(data).decode(), ct, b64=True)
    except Exception as e:
        return _resp(502, f"upstream error: {e}")
