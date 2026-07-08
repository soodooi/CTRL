// Account-derived remote session (ADR-005 §2). A DEV scheme that gives the
// friendly "log in, see your desktop" UX WITHOUT a cloud account service: the
// username + password DETERMINISTICALLY derive the relay room + E2E key, so the
// desktop and the phone that log in with the same credentials land in the same
// room with the same key and connect. The password is the shared secret (via
// PBKDF2), so the relay stays zero-knowledge and CTRL still runs no account DB.
//
// Production (multi-device discovery + real auth) = a ctrl-auth zero-knowledge
// rendezvous (account for reaching your OWN devices, never your data) — needs
// the "no account system" philosophy amended (ADR-006). This dev scheme keeps
// the transport/crypto identical; only where room+key come from changes.
import { toB64url } from './remote-crypto';

export interface Account {
  username: string;
  password: string;
}

export interface DerivedSession {
  room: string;
  keyB64: string;
}

const STORAGE_KEY = 'ctrl.remote.account.v1';

/** Dev default so we don't log in again and again (bao: admin / 898989). */
export const DEV_ACCOUNT: Account = { username: 'admin', password: '898989' };

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/** Derive a stable relay room + E2E key from credentials. Both peers that log in
 *  with the same account derive the SAME session and meet in the same room. */
export async function deriveSession(acc: Account): Promise<DerivedSession> {
  const enc = new TextEncoder();
  // room = a stable id from the username (namespaced so it can't collide with a
  // random device id); NOT secret — it just names the rendezvous room.
  const roomBytes = (await sha256(enc.encode(`ctrl-room:${acc.username}`))).subarray(0, 12);
  const room = toB64url(roomBytes);
  // key = PBKDF2(password, salt=username) → 256-bit AES key. The password never
  // leaves the device; only frames sealed with the derived key cross the relay.
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(acc.password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(`ctrl-key:${acc.username}`) as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    256,
  );
  return { room, keyB64: toB64url(new Uint8Array(bits)) };
}

export function loadAccount(): Account | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw != null) return JSON.parse(raw) as Account;
  } catch {
    // fall through
  }
  return null;
}

export function saveAccount(acc: Account): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(acc));
  } catch {
    // best-effort
  }
}

export function clearAccount(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort
  }
}
