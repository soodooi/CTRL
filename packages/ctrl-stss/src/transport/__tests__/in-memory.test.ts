import { describe, expect, it } from 'vitest';

import { TransportClosedError, createInMemoryTransportPair } from '../../index.js';

describe('InMemoryTransport pair', () => {
  it('starts open on both ends', () => {
    const [a, b] = createInMemoryTransportPair();
    expect(a.state).toBe('open');
    expect(b.state).toBe('open');
  });

  it('delivers bytes sent on one end to the other end on a microtask', async () => {
    const [a, b] = createInMemoryTransportPair();
    const received: Uint8Array[] = [];
    b.onMessage((bytes) => received.push(bytes));

    const payload = new TextEncoder().encode('hello');
    a.send(payload);
    expect(received).toHaveLength(0); // async delivery
    await Promise.resolve();
    expect(received).toHaveLength(1);
    expect(new TextDecoder().decode(received[0])).toBe('hello');
  });

  it('is bidirectional', async () => {
    const [a, b] = createInMemoryTransportPair();
    const fromA: Uint8Array[] = [];
    const fromB: Uint8Array[] = [];
    a.onMessage((bytes) => fromB.push(bytes));
    b.onMessage((bytes) => fromA.push(bytes));

    a.send(new TextEncoder().encode('A1'));
    b.send(new TextEncoder().encode('B1'));
    await Promise.resolve();
    // fromA collects what B received (i.e. what A sent)
    expect(new TextDecoder().decode(fromA[0])).toBe('A1');
    // fromB collects what A received (i.e. what B sent)
    expect(new TextDecoder().decode(fromB[0])).toBe('B1');
  });

  it('throws TransportClosedError when sending after close', () => {
    const [a, b] = createInMemoryTransportPair();
    a.close();
    expect(a.state).toBe('closed');
    expect(b.state).toBe('closed');
    expect(() => a.send(new Uint8Array([1, 2, 3]))).toThrow(TransportClosedError);
  });

  it('emits state changes through onStateChange', () => {
    const [a] = createInMemoryTransportPair();
    const transitions: string[] = [];
    a.onStateChange((s) => transitions.push(s));
    a.close();
    expect(transitions).toEqual(['closing', 'closed']);
  });
});
