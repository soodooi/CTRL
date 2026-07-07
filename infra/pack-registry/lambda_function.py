# CTRL pack share registry (minimal, MCP-Registry-compatible).
#   POST /            -> publish: store a pack manifest in S3, return {id,namespace,url}
#   GET  /v0/servers  -> list packs in the MCP-Registry shape Discover reads:
#                        {servers:[{server:{name,description,title,remotes:[{url}]}}]}
import base64, json, os, urllib.parse
import boto3

S3 = boto3.client("s3")
BUCKET = os.environ["REGISTRY_BUCKET"]
NS = os.environ.get("REGISTRY_NAMESPACE", "soodooi")
PREFIX = "packs/"

def _resp(code, obj):
    return {"statusCode": code, "headers": {"Content-Type": "application/json"},
            "body": json.dumps(obj, ensure_ascii=False)}

def _list():
    out = []
    for o in S3.list_objects_v2(Bucket=BUCKET, Prefix=PREFIX).get("Contents", []):
        try:
            m = json.loads(S3.get_object(Bucket=BUCKET, Key=o["Key"])["Body"].read())
        except Exception:
            continue
        name = m.get("name") or m.get("id") or "pack"
        desc = m.get("description")
        if isinstance(desc, dict):
            desc = desc.get("long") or desc.get("short") or ""
        out.append({"server": {"name": name, "title": name, "description": desc or "",
                               "remotes": [], "_ctrl_pack_id": m.get("id"),
                               "_ctrl_category": m.get("category")}})
    return out

def handler(event, _ctx):
    method = (event.get("requestContext", {}).get("http", {}) or {}).get("method") \
        or event.get("httpMethod") or "GET"
    path = event.get("rawPath", "") or event.get("path", "") or ""
    if method == "GET" and path.startswith("/bundle/"):
        pid = path[len("/bundle/"):].strip("/")
        pre = "bundles/%s/" % pid
        files = {}
        manifest = None
        for o in S3.list_objects_v2(Bucket=BUCKET, Prefix=pre).get("Contents", []):
            rel = o["Key"][len(pre):]
            if not rel:
                continue
            body = S3.get_object(Bucket=BUCKET, Key=o["Key"])["Body"].read().decode("utf-8", "replace")
            if rel == "manifest.json":
                try:
                    manifest = json.loads(body)
                except Exception:
                    manifest = None
            else:
                files[rel] = body
        if manifest is None:
            return _resp(404, {"error": "bundle not found: %s" % pid})
        return _resp(200, {"id": pid, "manifest": manifest, "files": files})
    if method == "GET":
        servers = _list()
        q = (event.get("queryStringParameters") or {}).get("search", "")
        if q:
            ql = q.lower()
            servers = [s for s in servers
                       if ql in (s["server"]["name"] + s["server"]["description"]).lower()]
        return _resp(200, {"servers": servers})
    if method == "POST":
        raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode()
        try:
            m = json.loads(raw)
        except Exception as e:
            return _resp(400, {"error": "bad manifest json: %s" % e})
        pid = m.get("id")
        if not pid:
            return _resp(400, {"error": "manifest missing id"})
        S3.put_object(Bucket=BUCKET, Key=PREFIX + pid + ".json",
                      Body=json.dumps(m, ensure_ascii=False).encode(),
                      ContentType="application/json")
        return _resp(200, {"id": pid, "namespace": NS,
                           "url": "ctrl://registry/%s/%s" % (NS, pid)})
    return _resp(405, {"error": "method not allowed"})
