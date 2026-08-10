import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useIrisySessionsStore, type IrisySession } from './irisy-sessions';
import { hydrateSessionsFromKernel, persistSettledTurns } from './session-hydration';

const invokeMock = vi.fn();

vi.mock('./bridge', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const session = (id: string, turns: string[]): IrisySession => ({
  id,
  label: id,
  messages: turns.map((content, index) => ({
    id: `${id}-${index}`,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content,
  })),
  createdAt: 0,
  resources: [],
  lastActiveAt: 0,
});

beforeEach(() => {
  invokeMock.mockReset();
  useIrisySessionsStore.setState({ sessions: [], activeSessionId: null });
});

const produceCalls = (): Array<Record<string, unknown>> =>
  invokeMock.mock.calls
    .filter(([command, payload]) => command === 'gate_invoke' && (payload as { tool: string }).tool === 'produce')
    .map(([, payload]) => (payload as { args: { operation: Record<string, unknown> } }).args.operation);

/** A kernel holding `stored` turns for every session, counting appends. */
const mockKernel = (rows: unknown[], stored = 0): void => {
  const turns = new Map<string, number>();
  let revision = 0;
  invokeMock.mockImplementation((command: string, payload: unknown) => {
    if (command === 'list_session_transcripts') return Promise.resolve(rows);
    const { tool, args } = payload as { tool: string; args: Record<string, unknown> };
    const ref = String(args.ref ?? '');
    if (tool === 'query') {
      const count = turns.get(ref) ?? stored;
      return Promise.resolve({
        revision: `rev${revision}`,
        transcript: {
          messages: Array.from({ length: count }, (_, index) => ({
            role: 'user',
            content: `stored ${index}`,
          })),
        },
      });
    }
    turns.set(ref, (turns.get(ref) ?? stored) + 1);
    revision += 1;
    return Promise.resolve({
      effect: { summary: 'appended', verified_by: 'reread' },
      result: { revision: `rev${revision}`, turn_count: turns.get(ref) },
    });
  });
};

describe('hydrateSessionsFromKernel', () => {
  it('rebuilds the view from the transcript directory', async () => {
    mockKernel([
      {
        id: 'chat',
        resource: 'ctrl://local/session/chat',
        label: 'Budget work',
        created_at: '2026-08-01T00:00:00Z',
        last_active_at: '2026-08-05T00:00:00Z',
        turn_count: 1,
        resources: [],
      },
    ], 1);
    const result = await hydrateSessionsFromKernel();
    expect(result).toMatchObject({ migrated: 0, sessions: 1 });
    const state = useIrisySessionsStore.getState();
    expect(state.activeSessionId).toBe('chat');
    // Loading the turns must not erase a label the listing already knew.
    expect(state.sessions[0]!.label).toBe('Budget work');
    // The opened conversation is loaded in full, not left looking empty.
    expect(state.sessions[0]!.messages).toHaveLength(1);
  });

  it('writes a browser-held conversation to disk before rebuilding', async () => {
    useIrisySessionsStore.setState({
      sessions: [session('local-only', ['hi', 'hello'])],
      activeSessionId: 'local-only',
    });
    mockKernel([]);
    const result = await hydrateSessionsFromKernel();
    expect(result.migrated).toBe(1);
    expect(produceCalls().map((operation) => operation.content)).toEqual(['hi', 'hello']);
  });

  /// An unreachable kernel must not look like an empty history.
  it('keeps the local view and reports unavailability when the kernel cannot be reached', async () => {
    useIrisySessionsStore.setState({
      sessions: [session('local', ['hi'])],
      activeSessionId: 'local',
    });
    invokeMock.mockRejectedValue(new Error('kernel is not running'));
    const result = await hydrateSessionsFromKernel();
    expect(result.unavailable).toContain('kernel is not running');
    expect(useIrisySessionsStore.getState().sessions).toHaveLength(1);
  });

  it('keeps a conversation that failed to migrate visible instead of dropping it', async () => {
    useIrisySessionsStore.setState({
      sessions: [session('stranded', ['hi'])],
      activeSessionId: 'stranded',
    });
    invokeMock.mockImplementation((command: string, payload: unknown) => {
      if (command === 'list_session_transcripts') return Promise.resolve([]);
      const { tool } = payload as { tool: string };
      if (tool === 'query') {
        return Promise.resolve({ revision: 'rev0', transcript: { messages: [] } });
      }
      return Promise.resolve({
        feedback: { code: 'precondition_failed', message: 'changed', retryable: true },
      });
    });
    const result = await hydrateSessionsFromKernel();
    expect(result.migrated).toBe(0);
    expect(useIrisySessionsStore.getState().sessions.map((s) => s.id)).toEqual(['stranded']);
  });
});

describe('persistSettledTurns', () => {
  /// Two settle points in one fast turn must not duplicate history.
  it('serializes overlapping calls so a turn is never written twice', async () => {
    useIrisySessionsStore.setState({
      sessions: [session('chat', ['hi'])],
      activeSessionId: 'chat',
    });
    mockKernel([], 0);
    await Promise.all([persistSettledTurns('chat'), persistSettledTurns('chat')]);
    expect(produceCalls()).toHaveLength(1);
  });

  it('lets a queued call see turns that arrived while it waited', async () => {
    useIrisySessionsStore.setState({
      sessions: [session('chat', ['hi'])],
      activeSessionId: 'chat',
    });
    mockKernel([], 0);
    const first = persistSettledTurns('chat');
    useIrisySessionsStore.setState({ sessions: [session('chat', ['hi', 'hello'])] });
    await Promise.all([first, persistSettledTurns('chat')]);
    expect(produceCalls().map((operation) => operation.content)).toEqual(['hi', 'hello']);
  });

  it('reports nothing rather than throwing when the session is gone', async () => {
    await expect(persistSettledTurns('missing')).resolves.toBeNull();
  });
});
