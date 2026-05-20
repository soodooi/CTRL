/*
  CF Pages Function: waitlist intake (v0 — log only, no DB binding).
  Returns 200 on accept, 400 on bad payload, 405 on wrong method.
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

  console.log("waitlist_signup", {
    email,
    ip: request.headers.get("cf-connecting-ip") ?? null,
    ua: request.headers.get("user-agent") ?? null,
    ts: new Date().toISOString(),
  });

  return json({ ok: true });
};

export const onRequest: PagesFunction = () => json({ ok: false, error: "method_not_allowed" }, 405);
