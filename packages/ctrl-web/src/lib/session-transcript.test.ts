import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  appendSessionMessage,
  messagesFromTranscript,
  pushSessionToKernel,
  sessionFromRow,
  sessionFromTranscript,
  sessionResourceRef,
  sessionsNeedingMigration,
  settledTurns,
  syncSettledTurns,
  transcriptMessageFrom,
  transcriptTimeMs,
  TranscriptAppendError,
  type SessionTranscriptRow,
  type Transcript,
} from './session-transcript';
import type { IrisySession, IrisySessionMessage } from './irisy-sessions';

const invokeMock = vi.fn();

vi.mock('./bridge', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const gateCalls = (): Array<{ tool: string; args: Record<string, unknown> }> =>
  invokeMock.mock.calls
    .filter(([command]) => command === 'gate_invoke')
    .map(([, payload]) => payload as { tool: string; args: Record<string, unknown> });

describe('sessionResourceRef', () => {
  it('addresses a session by its canonical ref', () => {
    expect(sessionResourceRef('chat-1')).toBe('ctrl://local/session/chat-1');
  });
});

describe('transcriptTimeMs', () => {
  it('reads an ISO-8601 UTC stamp', () => {
    expect(transcriptTimeMs('2026-08-05T10:00:00Z')).toBe(Date.parse('2026-08-05T10:00:00Z'));
  });

  // A hand-edited file must not jump to the top of the list just because its
  // timestamp is unreadable.
  it('treats an absent or unreadable stamp as the oldest rather than as now', () => {
    expect(transcriptTimeMs(undefined)).toBe(0);
    expect(transcriptTimeMs('sometime last week')).toBe(0);
  });
});

describe('messagesFromTranscript', () => {
  it('restores text turns as non-streaming with stable ids', () => {
    const messages = messagesFromTranscript('s', [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(messages).toEqual([
      { id: 's-m0', role: 'user', content: 'hi', streaming: false },
      { id: 's-m1', role: 'assistant', content: 'hello', streaming: false },
    ]);
    // Reloading the same file yields the same ids, so React keys stay stable.
    expect(messagesFromTranscript('s', [{ role: 'user', content: 'hi' }])[0]!.id).toBe('s-m0');
  });

  it('round-trips a custom turn through its JSON payload', () => {
    const custom: IrisySessionMessage = {
      id: 'x',
      role: 'custom',
      custom: { kind: 'decision', decision: { id: 'd1' } } as never,
    };
    const stored = transcriptMessageFrom(custom);
    expect(stored.role).toBe('custom');
    const [restored] = messagesFromTranscript('s', [stored]);
    expect(restored).toMatchObject({ role: 'custom', streaming: false });
  });

  /// Losing a turn is worse than showing it plainly.
  it('shows an unparseable custom turn as a reply rather than dropping it', () => {
    const [restored] = messagesFromTranscript('s', [
      { role: 'custom', content: '{ truncated by hand' },
    ]);
    expect(restored).toEqual({
      id: 's-m0',
      role: 'assistant',
      content: '{ truncated by hand',
      streaming: false,
    });
  });

  it('reads an unknown role as a reply so the text survives', () => {
    const [restored] = messagesFromTranscript('s', [{ role: 'narrator', content: 'later…' }]);
    expect(restored).toMatchObject({ role: 'assistant', content: 'later…' });
  });
});

describe('projection', () => {
  const row: SessionTranscriptRow = {
    id: 'chat',
    resource: 'ctrl://local/session/chat',
    label: 'Budget work',
    created_at: '2026-08-01T00:00:00Z',
    last_active_at: '2026-08-05T00:00:00Z',
    turn_count: 3,
    resources: ['ctrl://local/note/Budget.md'],
    selected_fct: 'pack:office',
  };

  it('projects a directory row without pretending to know its turns', () => {
    const session = sessionFromRow(row);
    expect(session).toMatchObject({
      id: 'chat',
      label: 'Budget work',
      messages: [],
      resources: ['ctrl://local/note/Budget.md'],
      selectedFctRef: 'pack:office',
    });
  });

  it('reads Auto as an absent selection, not an empty one', () => {
    expect(sessionFromRow({ ...row, selected_fct: null }).selectedFctRef).toBeUndefined();
  });

  it('falls back to the session id when a transcript carries no label', () => {
    const transcript: Transcript = {
      id: 'chat',
      label: '',
      created_at: '',
      last_active_at: '',
      resources: [],
      messages: [{ role: 'user', content: 'hi' }],
    };
    const session = sessionFromTranscript('chat', transcript);
    expect(session.label).toBe('chat');
    expect(session.messages).toHaveLength(1);
  });
});

describe('appendSessionMessage', () => {
  const verified = {
    effect: { summary: 'appended a user turn', verified_by: 'post-write reread' },
    result: { revision: 'rev2', turn_count: 1 },
  };

  it('sends one bounded append operation and returns the new revision', async () => {
    invokeMock.mockResolvedValue(verified);
    const result = await appendSessionMessage({
      id: 'chat',
      expectedRevision: 'rev1',
      message: { id: 'm', role: 'user', content: 'hi' },
      label: 'Budget work',
      resources: ['ctrl://local/note/Budget.md'],
      selectedFctRef: 'pack:office',
    });
    expect(result).toEqual({ revision: 'rev2', turnCount: 1 });
    const [call] = gateCalls();
    expect(call!.tool).toBe('produce');
    expect(call!.args).toMatchObject({
      ref: 'ctrl://local/session/chat',
      operation: {
        kind: 'append_message',
        expected_revision: 'rev1',
        role: 'user',
        content: 'hi',
        label: 'Budget work',
        selected_fct: 'pack:office',
      },
    });
  });

  it('omits the FCT field entirely when the session is on Auto', async () => {
    invokeMock.mockResolvedValue(verified);
    await appendSessionMessage({
      id: 'chat',
      expectedRevision: 'rev1',
      message: { id: 'm', role: 'user', content: 'hi' },
      selectedFctRef: null,
    });
    const operation = gateCalls()[0]!.args.operation as Record<string, unknown>;
    expect(operation).not.toHaveProperty('selected_fct');
  });

  // A stale revision is a real state the caller can recover from.
  it('raises the owner feedback code so a concurrent append can be retried', async () => {
    invokeMock.mockResolvedValue({
      feedback: {
        code: 'precondition_failed',
        message: 'the conversation changed since it was read',
        retryable: true,
      },
    });
    const failure = await appendSessionMessage({
      id: 'chat',
      expectedRevision: 'stale',
      message: { id: 'm', role: 'user', content: 'hi' },
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TranscriptAppendError);
    expect(failure as TranscriptAppendError).toMatchObject({
      code: 'precondition_failed',
      retryable: true,
    });
  });

  /// An unverified write must not read as saved.
  it('refuses to report success when the owner did not verify the write', async () => {
    invokeMock.mockResolvedValue({
      effect: { summary: 'wrote something', verified_by: null },
      result: { revision: 'rev2', turn_count: 1 },
    });
    await expect(
      appendSessionMessage({
        id: 'chat',
        expectedRevision: 'rev1',
        message: { id: 'm', role: 'user', content: 'hi' },
      }),
    ).rejects.toMatchObject({ code: 'unverified' });
  });
});

describe('migration', () => {
  const session = (id: string, turns: number): IrisySession => ({
    id,
    label: id,
    messages: Array.from({ length: turns }, (_, index) => ({
      id: `${id}-${index}`,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `turn ${index}`,
    })),
    createdAt: 0,
    resources: [],
    lastActiveAt: 0,
  });

  it('migrates only sessions that are not on disk yet, so history cannot double', () => {
    const local = [session('a', 2), session('b', 1), session('empty', 0)];
    const existing = [{ id: 'a' } as SessionTranscriptRow];
    expect(sessionsNeedingMigration(local, existing).map((s) => s.id)).toEqual(['b']);
  });

  it('pushes every turn in order, chaining each append onto the previous revision', async () => {
    let revision = 0;
    invokeMock.mockImplementation((command: string, payload: { tool: string }) => {
      if (command !== 'gate_invoke') throw new Error(`unexpected command ${command}`);
      if (payload.tool === 'query') {
        return Promise.resolve({ revision: 'rev0', transcript: { messages: [] } });
      }
      revision += 1;
      return Promise.resolve({
        effect: { summary: 'appended', verified_by: 'reread' },
        result: { revision: `rev${revision}`, turn_count: revision },
      });
    });

    const finalRevision = await pushSessionToKernel(session('a', 3));
    expect(finalRevision).toBe('rev3');
    const appends = gateCalls().filter((call) => call.tool === 'produce');
    expect(
      appends.map((call) => (call.args.operation as Record<string, string>).expected_revision),
    ).toEqual(['rev0', 'rev1', 'rev2']);
    expect(
      appends.map((call) => (call.args.operation as Record<string, string>).content),
    ).toEqual(['turn 0', 'turn 1', 'turn 2']);
  });

  /// A failed migration stops at the failure instead of skipping turns, so the
  /// gap is visible rather than silently swallowed.
  it('propagates a failed append instead of continuing past the gap', async () => {
    invokeMock.mockImplementation((_command: string, payload: { tool: string }) => {
      if (payload.tool === 'query') {
        return Promise.resolve({ revision: 'rev0', transcript: { messages: [] } });
      }
      return Promise.resolve({
        feedback: { code: 'precondition_failed', message: 'changed', retryable: true },
      });
    });
    await expect(pushSessionToKernel(session('a', 3))).rejects.toBeInstanceOf(
      TranscriptAppendError,
    );
    expect(gateCalls().filter((call) => call.tool === 'produce')).toHaveLength(1);
  });
});

describe('syncSettledTurns', () => {
  const withMessages = (messages: IrisySessionMessage[]): IrisySession => ({
    id: 'chat',
    label: 'Chat',
    messages,
    createdAt: 0,
    resources: [],
    lastActiveAt: 0,
  });

  /** Drive the gate with a transcript that already holds `onDisk` turns. */
  const mockGate = (onDisk: number): void => {
    let revision = 0;
    invokeMock.mockImplementation((_command: string, payload: { tool: string }) => {
      if (payload.tool === 'query') {
        return Promise.resolve({
          revision: 'rev0',
          transcript: {
            messages: Array.from({ length: onDisk }, (_, index) => ({
              role: index % 2 === 0 ? 'user' : 'assistant',
              content: `stored ${index}`,
            })),
          },
        });
      }
      revision += 1;
      return Promise.resolve({
        effect: { summary: 'appended', verified_by: 'reread' },
        result: { revision: `rev${revision}`, turn_count: onDisk + revision },
      });
    });
  };

  it('stops the settled prefix at the turn still streaming', () => {
    const messages: IrisySessionMessage[] = [
      { id: '1', role: 'user', content: 'hi' },
      { id: '2', role: 'assistant', content: 'partial', streaming: true },
    ];
    expect(settledTurns(messages).map((message) => message.id)).toEqual(['1']);
  });

  it('writes only the turns the transcript does not have yet', async () => {
    mockGate(1);
    await syncSettledTurns(
      withMessages([
        { id: '1', role: 'user', content: 'hi' },
        { id: '2', role: 'assistant', content: 'hello' },
      ]),
    );
    const appends = gateCalls().filter((call) => call.tool === 'produce');
    expect(appends).toHaveLength(1);
    expect((appends[0]!.args.operation as Record<string, string>).content).toBe('hello');
  });

  // Calling it after the user's message and again after the reply must not
  // double the conversation.
  it('is idempotent when nothing new has settled', async () => {
    mockGate(2);
    const revision = await syncSettledTurns(
      withMessages([
        { id: '1', role: 'user', content: 'hi' },
        { id: '2', role: 'assistant', content: 'hello' },
      ]),
    );
    expect(revision).toBe('rev0');
    expect(gateCalls().filter((call) => call.tool === 'produce')).toHaveLength(0);
  });

  it('leaves a streaming reply unwritten until it settles', async () => {
    mockGate(1);
    await syncSettledTurns(
      withMessages([
        { id: '1', role: 'user', content: 'hi' },
        { id: '2', role: 'assistant', content: 'partial', streaming: true },
      ]),
    );
    expect(gateCalls().filter((call) => call.tool === 'produce')).toHaveLength(0);
  });

  /// A fork narrows the view, not the record.
  it('writes nothing when the transcript already holds more turns than the view', async () => {
    mockGate(5);
    await syncSettledTurns(withMessages([{ id: '1', role: 'user', content: 'hi' }]));
    expect(gateCalls().filter((call) => call.tool === 'produce')).toHaveLength(0);
  });
});

describe('settledTurns placeholder handling', () => {
  /// The composer inserts an empty assistant turn the moment a turn starts. A
  /// blank reply must never reach the user's history.
  it('treats an empty assistant placeholder as unsettled', () => {
    const messages: IrisySessionMessage[] = [
      { id: '1', role: 'user', content: 'hi' },
      { id: '2', role: 'assistant', content: '' },
    ];
    expect(settledTurns(messages).map((message) => message.id)).toEqual(['1']);
  });

  it('keeps a custom turn even though it carries no text content', () => {
    const messages: IrisySessionMessage[] = [
      { id: '1', role: 'custom', custom: { kind: 'decision' } as never },
      { id: '2', role: 'user', content: 'ok' },
    ];
    expect(settledTurns(messages).map((message) => message.id)).toEqual(['1', '2']);
  });

  it('treats a whitespace-only reply as unsettled rather than as an answer', () => {
    const messages: IrisySessionMessage[] = [
      { id: '1', role: 'user', content: 'hi' },
      { id: '2', role: 'assistant', content: '   \n' },
      { id: '3', role: 'user', content: 'later' },
    ];
    expect(settledTurns(messages).map((message) => message.id)).toEqual(['1']);
  });
});
