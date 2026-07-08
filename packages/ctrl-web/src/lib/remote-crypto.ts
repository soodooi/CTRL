// E2E frame crypto for remote windows (ADR-005 §2, option B: relay-only + E2E).
//
// The relay is zero-knowledge: every frame is sealed with a key established
// during phone<->desktop PAIRING (not any relay-owned cert), so the relay — and
// CTRL's own cloud — only ever forward ciphertext. This is the concrete way
// CTRL's relay beats Home Assistant Cloud's disclosed "we own the trust root,
// so we *could* MITM" hole (2026-07-07 HA benchmark research).
//
// v1 = AES-256-GCM with a shared random key carried in the pairing code. Forward
// secrecy (an Olm/vodozemac handshake, which the kernel spike already has) is a
// documented upgrade; AES-GCM-with-shared-key is a legitimate E2E-over-relay
// baseline (Syncthing/DERP forward ciphertext the same way).
//
// Browser SubtleCrypto only (phone PWA side). The desktop kernel does the
// matching seal/open in Rust.

const IV_BYTES = 12;

/** Generate a fresh 256-bit session key (desktop side, at pairing). */
export function generateKeyBytes(): Uint8Array {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}

/** base64url encode/decode — how the key rides in the pairing code / URL. */
export function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Seal a plaintext frame: returns [iv(12) | ciphertext+tag] as one buffer. */
export async function seal(key: CryptoKey, plaintext: Uint8Array): Promise<ArrayBuffer> {
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );
  const out = new Uint8Array(IV_BYTES + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), IV_BYTES);
  return out.buffer;
}

/** Open a sealed frame; throws if auth fails (tampered / wrong key). */
export async function open(key: CryptoKey, frame: ArrayBuffer): Promise<Uint8Array> {
  const buf = new Uint8Array(frame);
  const iv = buf.subarray(0, IV_BYTES);
  const ct = buf.subarray(IV_BYTES);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return new Uint8Array(pt);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function sealJson(key: CryptoKey, value: unknown): Promise<ArrayBuffer> {
  return seal(key, enc.encode(JSON.stringify(value)));
}

export async function openJson<T>(key: CryptoKey, frame: ArrayBuffer): Promise<T> {
  return JSON.parse(dec.decode(await open(key, frame))) as T;
}
