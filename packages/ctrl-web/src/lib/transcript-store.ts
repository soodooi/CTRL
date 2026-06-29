// transcript-store — shared durable conversation persistence.
//
// ADR-005 irisy §8.4 / §8.6: every terminal-essence surface persists its message
// list locally (local-is-truth — plain-text philosophy) under a stable
// sessionKey, so a reload / engine crash re-hydrates the conversation context.
// ONE util for every surface (ambient chat, coding companion, …) so persistence
// isn't reinvented per surface. Generic over the surface's message shape — the
// caller supplies a type-guard for load and strips transient fields (pending /
// streaming / abort handles) before save.

const PREFIX = 'ctrl:transcript:v1:';
// Cap scrollback so a long-lived session can't grow localStorage unbounded.
const MAX_MESSAGES = 200;

export function transcriptKey(sessionKey: string): string {
  return `${PREFIX}${sessionKey}`;
}

/** Restore a surface's transcript. Returns [] on any failure (never throws). */
export function loadTranscript<T>(
  sessionKey: string,
  isValid: (m: unknown) => m is T,
): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(transcriptKey(sessionKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValid);
  } catch {
    return [];
  }
}

/** Persist a surface's transcript (last MAX_MESSAGES). Silent on storage
 *  full / disabled — the in-memory conversation still works. */
export function saveTranscript<T>(sessionKey: string, items: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed =
      items.length > MAX_MESSAGES ? items.slice(items.length - MAX_MESSAGES) : items;
    window.localStorage.setItem(transcriptKey(sessionKey), JSON.stringify(trimmed));
  } catch {
    // storage full / disabled — degrade silently
  }
}

/** Drop a surface's persisted transcript (e.g. an explicit "new chat"). */
export function clearTranscript(sessionKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(transcriptKey(sessionKey));
  } catch {
    // ignore
  }
}
