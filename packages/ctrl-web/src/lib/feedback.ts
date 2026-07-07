// Minimal opt-in feedback. POSTs only what the user typed + their user-agent to
// the CTRL feedback endpoint (stored in S3). No account, no telemetry, no
// silent capture — the user must click and type. Lightweight by design.
// Endpoint comes from VITE_FEEDBACK_URL (see .env); empty = feature off.
const FEEDBACK_URL = (import.meta.env.VITE_FEEDBACK_URL as string | undefined) ?? '';

export const feedbackEnabled = FEEDBACK_URL !== '';

export async function submitFeedback(text: string): Promise<boolean> {
  if (FEEDBACK_URL === '') return false;
  try {
    const res = await fetch(FEEDBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ua: navigator.userAgent, at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
