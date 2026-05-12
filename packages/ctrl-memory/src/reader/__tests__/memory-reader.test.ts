import {
  createCell,
  createDelta,
  createHeartbeat,
  createKeyframe,
} from '@ctrl/stss';
import { describe, expect, it } from 'vitest';

import { InMemoryLog } from '../../log/in-memory.js';
import { DefaultMemoryReader } from '../memory-reader.js';

async function seed(log: InMemoryLog): Promise<void> {
  await log.append(
    createKeyframe({
      source: 's1',
      seq: 1,
      ts_ms: 1_000,
      cells: [createCell({ id: 'a', kind: 'user_input', payload: { text: 'one' }, ts_ms: 950 })],
    }),
  );
  await log.append(
    createDelta({
      source: 's1',
      seq: 2,
      ref: 1,
      ts_ms: 1_100,
      cells: [createCell({ id: 'a', kind: 'user_input', payload: { text: 'two' }, ts_ms: 1_050 })],
    }),
  );
  await log.append(createHeartbeat({ source: 's2', seq: 5, ts_ms: 1_200 }));
  await log.append(
    createDelta({
      source: 's1',
      seq: 3,
      ref: 1,
      ts_ms: 1_300,
      cells: [createCell({ id: 'a', kind: 'user_input', payload: { text: 'three' }, ts_ms: 1_250 })],
    }),
  );
}

describe('DefaultMemoryReader', () => {
  it('iterates the full log without a filter', async () => {
    const log = new InMemoryLog();
    await seed(log);
    const reader = new DefaultMemoryReader(log);

    const seqs: number[] = [];
    for await (const env of reader.iterate()) seqs.push(env.seq);
    expect(seqs).toEqual([1, 2, 5, 3]);
  });

  it('filters by source', async () => {
    const log = new InMemoryLog();
    await seed(log);
    const reader = new DefaultMemoryReader(log);

    const seqs: number[] = [];
    for await (const env of reader.iterate({ source: 's1' })) seqs.push(env.seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it('filters by type', async () => {
    const log = new InMemoryLog();
    await seed(log);
    const reader = new DefaultMemoryReader(log);

    const seqs: number[] = [];
    for await (const env of reader.iterate({ types: ['delta'] })) seqs.push(env.seq);
    expect(seqs).toEqual([2, 3]);
  });

  it('filters by ts_ms window', async () => {
    const log = new InMemoryLog();
    await seed(log);
    const reader = new DefaultMemoryReader(log);

    const seqs: number[] = [];
    for await (const env of reader.iterate({ fromTsMs: 1_100, toTsMs: 1_250 })) seqs.push(env.seq);
    expect(seqs).toEqual([2, 5]);
  });

  it('seekToSeq replays envelopes whose seq <= target', async () => {
    const log = new InMemoryLog();
    await seed(log);
    const reader = new DefaultMemoryReader(log);

    await reader.seekToSeq(2);
    const snap = reader.current();
    expect(snap.cells.size).toBe(1);
    expect((snap.cells.get('a')?.payload as { text: string }).text).toBe('two');
    expect(snap.lastSeq).toBe(2);
  });

  it('seekToTime replays envelopes whose ts_ms <= target', async () => {
    const log = new InMemoryLog();
    await seed(log);
    const reader = new DefaultMemoryReader(log);

    await reader.seekToTime(1_100);
    const snap = reader.current();
    expect((snap.cells.get('a')?.payload as { text: string }).text).toBe('two');
  });

  it('reset clears the snapshot but keeps the log', async () => {
    const log = new InMemoryLog();
    await seed(log);
    const reader = new DefaultMemoryReader(log);

    await reader.seekToSeq(3);
    expect(reader.current().cells.size).toBe(1);
    reader.reset();
    expect(reader.current().cells.size).toBe(0);

    // log is intact — replay still works
    await reader.seekToSeq(1);
    expect(reader.current().cells.size).toBe(1);
  });

  it('applyEnvelope advances the reducer on a caller-controlled stream', async () => {
    const log = new InMemoryLog();
    await seed(log);
    const reader = new DefaultMemoryReader(log);

    for await (const env of reader.iterate({ source: 's1' })) {
      reader.applyEnvelope(env);
    }
    const snap = reader.current();
    expect((snap.cells.get('a')?.payload as { text: string }).text).toBe('three');
    expect(snap.lastSeq).toBe(3);
  });
});
