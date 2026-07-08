// Persistent remote identity for this desktop (ADR-005 §2, option B — the
// unattended / "reach my own desktop anytime" model, benchmarked against
// RustDesk/ToDesk's device-id + password + always-registered design).
//
// The device gets a STABLE id (= its relay room) + a stable E2E key generated
// once, plus a passcode the phone must present after the E2E channel is up
// (mirrors RustDesk's ID + password; the relay never sees it — it's inside the
// sealed channel). Rotating the passcode or key REVOKES remembered phones.
//
// v1 persists in localStorage; per CTRL rules the key + passcode are secrets and
// should migrate to the OS keychain — kept behind this module so that's a
// one-file change. (Honest gap noted in the plan.)
import { generateKeyBytes, toB64url } from './remote-crypto';

export interface RemoteIdentity {
  /** Stable device id = the relay room this desktop is always reachable at. */
  deviceId: string;
  /** Stable E2E key (base64url) — transport encryption for this device. */
  keyB64: string;
  /** Access credential the phone proves knowledge of (after E2E). */
  passcode: string;
}

const STORAGE_KEY = 'ctrl.remote.identity.v1';

function randomId(bytes: number): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** 6-digit passcode (ToDesk/RustDesk-style), easy to read off the desktop once. */
function randomPasscode(): string {
  const n = (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 1_000_000;
  return String(n).padStart(6, '0');
}

/** Load the persistent identity, creating (and persisting) it on first use. */
export function getOrCreateIdentity(): RemoteIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw != null) return JSON.parse(raw) as RemoteIdentity;
  } catch {
    // fall through to create
  }
  const id: RemoteIdentity = {
    deviceId: randomId(12),
    keyB64: toB64url(generateKeyBytes()),
    passcode: randomPasscode(),
  };
  save(id);
  return id;
}

function save(id: RemoteIdentity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
  } catch {
    // best-effort
  }
}

/** Rotate the passcode — remembered phones must re-enter it (soft revoke). */
export function rotatePasscode(): RemoteIdentity {
  const id = getOrCreateIdentity();
  const next = { ...id, passcode: randomPasscode() };
  save(next);
  return next;
}

/** Rotate device id + key — hard revoke: every remembered phone must re-pair. */
export function rotateKey(): RemoteIdentity {
  const next: RemoteIdentity = {
    deviceId: randomId(12),
    keyB64: toB64url(generateKeyBytes()),
    passcode: randomPasscode(),
  };
  save(next);
  return next;
}
