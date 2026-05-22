// [H-2026-05-22-001] useTerminalBuffer — fixed-capacity ring buffer for
// recent terminal stdout/stderr bytes.
//
// CompanionPane reads `getRecentText()` to feed the LLM context block.
// Terminal output arrives at multi-kHz rates during e.g. `npm install`;
// pushing each frame through React state would jank the xterm viewer.
// Instead the buffer lives in a useRef cell, append() is a pure
// O(maxBytes) mutation, and getRecentText() runs only when the
// companion turn is about to fire.

import { useCallback, useRef } from 'react';

export interface UseTerminalBufferOptions {
  maxBytes?: number;
}

export interface TerminalBufferHandle {
  append: (bytes: Uint8Array) => void;
  getRecentText: (maxBytes?: number) => string;
  clear: () => void;
}

const DEFAULT_MAX_BYTES = 32 * 1024;

interface RingState {
  buffer: Uint8Array;
  capacity: number;
  // `length` < capacity until the ring fills; once `length === capacity`
  // the ring is full and writes wrap. `head` is the index of the next
  // byte to write.
  length: number;
  head: number;
}

function newRing(capacity: number): RingState {
  return {
    buffer: new Uint8Array(capacity),
    capacity,
    length: 0,
    head: 0,
  };
}

function appendInto(state: RingState, bytes: Uint8Array): void {
  if (bytes.length === 0) return;
  const cap = state.capacity;
  // If the incoming chunk is itself >= capacity, we can only keep the
  // last `cap` bytes of it — copy that suffix flat and reset the ring
  // to a one-shot full state.
  if (bytes.length >= cap) {
    const start = bytes.length - cap;
    state.buffer.set(bytes.subarray(start, bytes.length), 0);
    state.length = cap;
    state.head = 0;
    return;
  }
  // Otherwise split the write across the wrap boundary if needed.
  const first = Math.min(cap - state.head, bytes.length);
  state.buffer.set(bytes.subarray(0, first), state.head);
  const rest = bytes.length - first;
  if (rest > 0) state.buffer.set(bytes.subarray(first, bytes.length), 0);
  state.head = (state.head + bytes.length) % cap;
  state.length = Math.min(cap, state.length + bytes.length);
}

function readRecent(state: RingState, maxBytes: number): Uint8Array {
  const want = Math.min(maxBytes, state.length);
  if (want === 0) return new Uint8Array(0);
  const out = new Uint8Array(want);
  // Bytes are laid out chronologically as [tail .. head) modulo capacity.
  // The tail of the ring is (head - length) mod capacity.
  const tail = (state.head - state.length + state.capacity) % state.capacity;
  // We want the LAST `want` bytes, i.e. the suffix of the chronological
  // sequence: start at (head - want) mod capacity.
  const readStart = (state.head - want + state.capacity) % state.capacity;
  const first = Math.min(state.capacity - readStart, want);
  out.set(state.buffer.subarray(readStart, readStart + first), 0);
  const rest = want - first;
  if (rest > 0) out.set(state.buffer.subarray(0, rest), first);
  // `tail` is referenced for clarity / future debugging; suppress unused.
  void tail;
  return out;
}

const sharedDecoder = new TextDecoder('utf-8', { fatal: false });

export function useTerminalBuffer(
  opts: UseTerminalBufferOptions = {},
): TerminalBufferHandle {
  const capacity = Math.max(1024, opts.maxBytes ?? DEFAULT_MAX_BYTES);
  const ringRef = useRef<RingState | null>(null);
  if (ringRef.current === null || ringRef.current.capacity !== capacity) {
    ringRef.current = newRing(capacity);
  }

  const append = useCallback((bytes: Uint8Array): void => {
    const ring = ringRef.current;
    if (!ring) return;
    appendInto(ring, bytes);
  }, []);

  const getRecentText = useCallback(
    (maxBytes?: number): string => {
      const ring = ringRef.current;
      if (!ring || ring.length === 0) return '';
      const slice = readRecent(ring, maxBytes ?? ring.capacity);
      return sharedDecoder.decode(slice);
    },
    [],
  );

  const clear = useCallback((): void => {
    const ring = ringRef.current;
    if (!ring) return;
    ring.length = 0;
    ring.head = 0;
  }, []);

  return { append, getRecentText, clear };
}
