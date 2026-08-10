import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  interpretRecordWrite,
  readRevision,
  resourceRefFor,
  writeRecord,
} from './record-write';
import { setTableCell, tableResourceRef } from './table-write';

const invokeMock = vi.fn();

vi.mock('./bridge', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeEach(() => {
  invokeMock.mockReset();
});

const gateCalls = (): Array<{ tool: string; args: Record<string, unknown> }> =>
  invokeMock.mock.calls
    .filter(([command]) => command === 'gate_invoke')
    .map(([, payload]) => payload as { tool: string; args: Record<string, unknown> });

describe('resourceRefFor', () => {
  it('keeps a path separator a separator and encodes the rest', () => {
    expect(resourceRefFor('table', 'tables/budget.md')).toBe(
      'ctrl://local/table/tables/budget.md',
    );
    expect(resourceRefFor('task', 'Work notes/My tasks.md')).toBe(
      'ctrl://local/task/Work%20notes/My%20tasks.md',
    );
    expect(tableResourceRef('tables/budget.md')).toBe('ctrl://local/table/tables/budget.md');
  });
});

describe('interpretRecordWrite', () => {
  it('reads a verified outcome as verified, carrying the owner’s own verification', () => {
    expect(
      interpretRecordWrite({
        effect: { summary: 'set status', verified_by: 'post-write reread returned the new value' },
        result: { revision: 'rev2', row: { status: 'done' } },
      }),
    ).toEqual({
      kind: 'verified',
      verifiedBy: 'post-write reread returned the new value',
      revision: 'rev2',
      row: { status: 'done' },
    });
  });

  /// A write that reported no verification must not read as done.
  it('refuses to call an unverified outcome a success', () => {
    expect(
      interpretRecordWrite({ effect: { summary: 'wrote something', verified_by: null } }),
    ).toMatchObject({ kind: 'failed', code: 'unverified', retryable: true });
  });

  it('treats an outcome with no effect at all as unverified', () => {
    expect(interpretRecordWrite({})).toMatchObject({ kind: 'failed', code: 'unverified' });
  });

  /// The source changed, so what was addressed may not be what was meant. That is
  /// a conflict the user can act on, not a generic error.
  it('reads a stale source as a conflict carrying both revisions', () => {
    expect(
      interpretRecordWrite({
        feedback: {
          code: 'precondition_failed',
          message: 'the table changed since it was read, so nothing was written',
          retryable: true,
          details: { expected_revision: 'aaa', current_revision: 'bbb' },
        },
      }),
    ).toMatchObject({ kind: 'conflict', expected: 'aaa', current: 'bbb' });
  });

  it('reports a conflict even when the owner omitted the revisions', () => {
    expect(
      interpretRecordWrite({
        feedback: { code: 'precondition_failed', message: 'changed', retryable: true },
      }),
    ).toEqual({ kind: 'conflict', message: 'changed', expected: undefined, current: undefined });
  });

  /// A rolled-back write can be retried; one the owner could not restore cannot,
  /// and the caller must take the owner's word for that rather than guessing.
  it('carries the owner’s retryability for a rollback and for a failed rollback', () => {
    expect(
      interpretRecordWrite({
        feedback: {
          code: 'write_rolled_back',
          message: 'the previous content was restored',
          retryable: true,
        },
      }),
    ).toMatchObject({ kind: 'failed', code: 'write_rolled_back', retryable: true });

    expect(
      interpretRecordWrite({
        feedback: {
          code: 'rollback_failed',
          message: 'the previous content could not be restored',
          retryable: false,
        },
      }),
    ).toMatchObject({ kind: 'failed', code: 'rollback_failed', retryable: false });
  });

  it('keeps any other owner failure typed rather than flattening it to a string', () => {
    expect(
      interpretRecordWrite({
        feedback: {
          code: 'write_unverified',
          message: 'the change did not read back with the new value',
          retryable: false,
        },
      }),
    ).toMatchObject({ kind: 'failed', code: 'write_unverified', retryable: false });
  });
});

describe('readRevision', () => {
  it('returns the revision the source reported', async () => {
    invokeMock.mockResolvedValue({ freshness: { revision: 'rev-seen' }, presentation: {} });
    await expect(readRevision('ctrl://local/table/tables/budget.md')).resolves.toBe('rev-seen');
  });

  /// Without a revision there is nothing safe to write against.
  it('refuses a source that reported no revision', async () => {
    invokeMock.mockResolvedValue({ freshness: {}, presentation: {} });
    await expect(readRevision('ctrl://local/table/tables/budget.md')).rejects.toThrow(
      /no revision/,
    );
  });
});

describe('writeRecord', () => {
  it('reads the revision first and conditions the operation on it', async () => {
    invokeMock.mockImplementation((_command: string, payload: unknown) => {
      const call = payload as { tool: string };
      if (call.tool === 'describe') {
        return Promise.resolve({ freshness: { revision: 'rev-seen' }, presentation: {} });
      }
      return Promise.resolve({
        effect: { summary: 'set cell', verified_by: 'reread' },
        result: { revision: 'rev-next' },
      });
    });

    const result = await setTableCell('tables/budget.md', 0, 'status', 'paid');
    expect(result).toMatchObject({ kind: 'verified', revision: 'rev-next' });
    const write = gateCalls().find((call) => call.tool === 'produce');
    expect(write!.args).toMatchObject({
      ref: 'ctrl://local/table/tables/budget.md',
      operation: {
        kind: 'set_cell',
        expected_revision: 'rev-seen',
        row: 0,
        field: 'status',
        value: 'paid',
      },
    });
  });

  it('does not attempt the write when the revision could not be read', async () => {
    invokeMock.mockResolvedValue({ freshness: {}, presentation: {} });
    const result = await setTableCell('tables/budget.md', 0, 'status', 'paid');
    expect(result).toMatchObject({ kind: 'failed', code: 'unavailable' });
    expect(gateCalls().some((call) => call.tool === 'produce')).toBe(false);
  });

  /// A thrown transport or authorization error is still a typed failure; it must
  /// never surface as a completed write.
  it('reports a thrown write as a typed failure rather than letting it escape', async () => {
    invokeMock.mockImplementation((_command: string, payload: unknown) => {
      const call = payload as { tool: string };
      if (call.tool === 'describe') {
        return Promise.resolve({ freshness: { revision: 'rev-seen' }, presentation: {} });
      }
      return Promise.reject(new Error('resource access was denied'));
    });
    const result = await setTableCell('tables/budget.md', 0, 'status', 'paid');
    expect(result).toMatchObject({
      kind: 'failed',
      code: 'write_failed',
      retryable: true,
    });
    expect((result as { message: string }).message).toContain('denied');
  });

  it('passes an owner conflict straight through to the caller', async () => {
    invokeMock.mockImplementation((_command: string, payload: unknown) => {
      const call = payload as { tool: string };
      if (call.tool === 'describe') {
        return Promise.resolve({ freshness: { revision: 'rev-seen' }, presentation: {} });
      }
      return Promise.resolve({
        feedback: {
          code: 'precondition_failed',
          message: 'the table changed since it was read, so nothing was written',
          retryable: true,
          details: { expected_revision: 'rev-seen', current_revision: 'rev-moved' },
        },
      });
    });
    const result = await writeRecord('ctrl://local/table/tables/budget.md', (revision) => ({
      kind: 'set_cell',
      expected_revision: revision,
      row: 0,
      field: 'status',
      value: 'paid',
    }));
    expect(result).toMatchObject({
      kind: 'conflict',
      expected: 'rev-seen',
      current: 'rev-moved',
    });
  });
});
