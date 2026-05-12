import { createHeartbeat, createKeyframe } from '@ctrl/stss';
import { describe, expect, it } from 'vitest';

import { InMemoryLog } from '../in-memory.js';

describe('InMemoryLog', () => {
  it('appends and reads back in order', async () => {
    const log = new InMemoryLog();
    await log.append(createKeyframe({ source: 's', seq: 1, ts_ms: 1, cells: [] }));
    await log.append(createHeartbeat({ source: 's', seq: 2, ts_ms: 2 }));
    await log.append(createHeartbeat({ source: 's', seq: 3, ts_ms: 3 }));

    expect(await log.size()).toBe(3);

    const seen: number[] = [];
    for await (const env of log.open()) seen.push(env.seq);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('open() returns a snapshot — later appends are not visible to existing iterator', async () => {
    const log = new InMemoryLog();
    await log.append(createHeartbeat({ source: 's', seq: 1, ts_ms: 1 }));

    const iter = log.open();
    await log.append(createHeartbeat({ source: 's', seq: 2, ts_ms: 2 }));

    const seen: number[] = [];
    for await (const env of iter) seen.push(env.seq);
    expect(seen).toEqual([1]);

    const iter2 = log.open();
    const seen2: number[] = [];
    for await (const env of iter2) seen2.push(env.seq);
    expect(seen2).toEqual([1, 2]);
  });

  it('rejects appends after close', async () => {
    const log = new InMemoryLog();
    await log.close();
    await expect(
      log.append(createHeartbeat({ source: 's', seq: 1, ts_ms: 1 })),
    ).rejects.toThrow(/closed/);
  });
});
