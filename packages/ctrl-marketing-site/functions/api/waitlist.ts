/*
  CF Pages Function: waitlist intake (v0 — log only, no DB binding).
  Returns 200 on accept, 400 on bad payload, 405 on wrong method.

  v0 themis APPROVE_WITH_WARNINGS — both HIGHs bao-waived 2026-05-21, ticketed to H-2026-05-19-004 v0.1:
    HIGH-1 (line ~50, OPTIONS catch-all 405): v0 is same-origin only; cross-origin embed will need
           an explicit OPTIONS handler. Will silently fail for any browser preflight.
    HIGH-2 (line ~38, console.log PII): v0 logs email + IP + UA to CF Worker logs (≤7d retention)
           for early-signup observability. Replace with structured Tail Worker sink + D1/KV at-rest
           encryption before real traffic.
*/

interface WaitlistBody {
  email?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const onRequestPost: PagesFunction = async ({ request }) => {
  let payload: WaitlistBody;
  try {
    payload = (await request.json()) as WaitlistBody;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: "invalid_email" }, 400);
  }

  // Log a non-identifying signup marker only. Raw email / IP / UA are PII and
  // must not land in CF Worker logs (retained ~7d). Email domain is coarse
  // enough for funnel analytics without identifying the signer.
  const emailDomain = email.slice(email.indexOf("@") + 1);
  console.log("waitlist_signup", {
    emailDomain,
    ts: new Date().toISOString(),
  });

  return json({ ok: true });
};

export const onRequest: PagesFunction = () => json({ ok: false, error: "method_not_allowed" }, 405);
