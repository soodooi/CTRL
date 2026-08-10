// @vitest-environment jsdom
// (ADR-005 irisy §8.7 v32; ADR-003 frontend §8.6 v36)
// irisy-sessions store tests — multi-session tab semantics for Irisy's chat
// surface (bao "session...都要", Kiro-style tab bar). Covers create/switch/
// close fallback ordering, label derivation, and the legacy single-conversation
// migration path so an upgrading user's existing chat isn't silently dropped.
// Canonical import and rollback behavior follows the sole transcript authority.
// (ADR-005 irisy §11 v40)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deriveSessionLabel,
  ensureActiveIrisySession,
  importLegacyCodingSessions,
  migrateLegacySingleSession,
  useIrisySessionsStore,
} from './irisy-sessions';

const LEGACY_KEY = 'irisy:chat:v1:test';
const LEGACY_CODING_KEY = 'ctrl:coding-sessions:v1';
const IRISY_SESSIONS_KEY = 'ctrl:irisy-sessions:v1';

beforeEach(() => {
  useIrisySessionsStore.setState({ sessions: [], activeSessionId: null });
  window.localStorage.clear();
});

// Store cleanup never introduces another transcript owner.
// (ADR-005 irisy §11 v40)
afterEach(() => {
  vi.restoreAllMocks();
});

describe('deriveSessionLabel', () => {
  it('uses the trimmed first message as the label', () => {
    expect(deriveSessionLabel('  hello there  ')).toBe('hello there');
  });

  it('falls back to New Session for an empty message', () => {
    expect(deriveSessionLabel('   ')).toBe('New Session');
  });

  it('truncates a long first message with an ellipsis', () => {
    const long = 'x'.repeat(60);
    const label = deriveSessionLabel(long);
    expect(label.endsWith('…')).toBe(true);
    expect(label.length).toBeLessThan(long.length);
  });

  it('collapses internal whitespace/newlines into single spaces', () => {
    expect(deriveSessionLabel('line one\nline   two')).toBe('line one line two');
  });
});

describe('useIrisySessionsStore', () => {
  it('createSession adds and activates a new session', () => {
    const session = useIrisySessionsStore.getState().createSession();
    const state = useIrisySessionsStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe(session.id);
  });

  it('createSession accepts a custom label, default is "New Session"', () => {
    useIrisySessionsStore.getState().createSession();
    expect(useIrisySessionsStore.getState().sessions[0]?.label).toBe('New Session');
    useIrisySessionsStore.getState().createSession('Custom');
    const sessions = useIrisySessionsStore.getState().sessions;
    expect(sessions[1]?.label).toBe('Custom');
  });

  it('closeSession falls back to the tab to the LEFT of the closed one', () => {
    const a = useIrisySessionsStore.getState().createSession('A');
    const b = useIrisySessionsStore.getState().createSession('B');
    const c = useIrisySessionsStore.getState().createSession('C');
    useIrisySessionsStore.getState().activateSession(b.id);
    useIrisySessionsStore.getState().closeSession(b.id);
    const state = useIrisySessionsStore.getState();
    expect(state.sessions.map((s) => s.id)).toEqual([a.id, c.id]);
    expect(state.activeSessionId).toBe(a.id);
  });

  it('closeSession on the first tab falls back to the new first tab', () => {
    const a = useIrisySessionsStore.getState().createSession('A');
    const b = useIrisySessionsStore.getState().createSession('B');
    useIrisySessionsStore.getState().activateSession(a.id);
    useIrisySessionsStore.getState().closeSession(a.id);
    const state = useIrisySessionsStore.getState();
    expect(state.sessions.map((s) => s.id)).toEqual([b.id]);
    expect(state.activeSessionId).toBe(b.id);
  });

  it('closeSession on the last remaining session leaves activeSessionId null', () => {
    const a = useIrisySessionsStore.getState().createSession('A');
    useIrisySessionsStore.getState().closeSession(a.id);
    const state = useIrisySessionsStore.getState();
    expect(state.sessions).toHaveLength(0);
    expect(state.activeSessionId).toBeNull();
  });

  it('closing a non-active session does not change activeSessionId', () => {
    const a = useIrisySessionsStore.getState().createSession('A');
    const b = useIrisySessionsStore.getState().createSession('B');
    useIrisySessionsStore.getState().activateSession(a.id);
    useIrisySessionsStore.getState().closeSession(b.id);
    expect(useIrisySessionsStore.getState().activeSessionId).toBe(a.id);
  });

  it('activateSession is a no-op for an unknown id', () => {
    const a = useIrisySessionsStore.getState().createSession('A');
    useIrisySessionsStore.getState().activateSession('does-not-exist');
    expect(useIrisySessionsStore.getState().activeSessionId).toBe(a.id);
  });

  it('renameSession updates the label, ignoring an empty/whitespace rename', () => {
    const a = useIrisySessionsStore.getState().createSession('A');
    useIrisySessionsStore.getState().renameSession(a.id, 'Renamed');
    expect(useIrisySessionsStore.getState().sessions[0]?.label).toBe('Renamed');
    useIrisySessionsStore.getState().renameSession(a.id, '   ');
    expect(useIrisySessionsStore.getState().sessions[0]?.label).toBe('Renamed');
  });

  // Stable selection is session-owned and expanded facts are never persisted.
  // (ADR-005 irisy §11 v41)
  it('setSelectedFct updates only the targeted session and Auto clears it', () => {
    const a = useIrisySessionsStore.getState().createSession('A');
    const b = useIrisySessionsStore.getState().createSession('B');
    useIrisySessionsStore.getState().setSelectedFct(a.id, 'skill:office');
    let state = useIrisySessionsStore.getState();
    expect(state.sessions.find((session) => session.id === a.id)?.selectedFctRef).toBe('skill:office');
    expect(state.sessions.find((session) => session.id === b.id)?.selectedFctRef).toBeUndefined();
    useIrisySessionsStore.getState().setSelectedFct(a.id, null);
    state = useIrisySessionsStore.getState();
    expect(state.sessions.find((session) => session.id === a.id)?.selectedFctRef).toBeUndefined();
  });

  it('setMessages updates only the targeted session', () => {
    const a = useIrisySessionsStore.getState().createSession('A');
    const b = useIrisySessionsStore.getState().createSession('B');
    useIrisySessionsStore.getState().setMessages(a.id, () => [
      { id: 'm1', role: 'user', content: 'hi', streaming: false },
    ]);
    const state = useIrisySessionsStore.getState();
    expect(state.sessions.find((s) => s.id === a.id)?.messages).toHaveLength(1);
    expect(state.sessions.find((s) => s.id === b.id)?.messages).toHaveLength(0);
  });

  it('clearSessionMessages empties only the targeted session', () => {
    const a = useIrisySessionsStore.getState().createSession('A');
    useIrisySessionsStore.getState().setMessages(a.id, () => [
      { id: 'm1', role: 'user', content: 'hi', streaming: false },
    ]);
    useIrisySessionsStore.getState().clearSessionMessages(a.id);
    expect(useIrisySessionsStore.getState().sessions[0]?.messages).toHaveLength(0);
  });
});

describe('ensureActiveIrisySession', () => {
  it('creates a session when none exists', () => {
    const id = ensureActiveIrisySession();
    expect(useIrisySessionsStore.getState().sessions).toHaveLength(1);
    expect(useIrisySessionsStore.getState().activeSessionId).toBe(id);
  });

  it('is a no-op when a valid active session already exists', () => {
    const a = useIrisySessionsStore.getState().createSession('A');
    const id = ensureActiveIrisySession();
    expect(id).toBe(a.id);
    expect(useIrisySessionsStore.getState().sessions).toHaveLength(1);
  });

  it('re-activates the first session when activeSessionId points at nothing', () => {
    const a = useIrisySessionsStore.getState().createSession('A');
    useIrisySessionsStore.setState({ activeSessionId: 'stale-id' });
    const id = ensureActiveIrisySession();
    expect(id).toBe(a.id);
  });
});

describe('migrateLegacySingleSession', () => {
  it('migrates a legacy conversation into a new first session and clears the old key', () => {
    const legacy = [
      { id: 'u-1', role: 'user', content: 'hello world', streaming: false },
      { id: 'a-1', role: 'assistant', content: 'hi there', streaming: true },
    ];
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    migrateLegacySingleSession(LEGACY_KEY);
    const state = useIrisySessionsStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.messages).toHaveLength(2);
    // streaming flags are reset false on restore (no message resumes streaming).
    expect(state.sessions[0]?.messages.every((m) => m.streaming === false)).toBe(true);
    expect(state.sessions[0]?.label).toBe('hello world');
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('is a no-op when no legacy key exists', () => {
    migrateLegacySingleSession(LEGACY_KEY);
    expect(useIrisySessionsStore.getState().sessions).toHaveLength(0);
  });

  it('is a no-op when a session already exists (never overwrites live state)', () => {
    useIrisySessionsStore.getState().createSession('Existing');
    window.localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([{ id: 'u-1', role: 'user', content: 'old', streaming: false }]),
    );
    migrateLegacySingleSession(LEGACY_KEY);
    const state = useIrisySessionsStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.label).toBe('Existing');
  });

  it('leaves a malformed legacy payload untouched rather than guessing', () => {
    window.localStorage.setItem(LEGACY_KEY, '{ not json');
    migrateLegacySingleSession(LEGACY_KEY);
    expect(useIrisySessionsStore.getState().sessions).toHaveLength(0);
    expect(window.localStorage.getItem(LEGACY_KEY)).toBe('{ not json');
  });

  it('is a no-op when the legacy payload has no messages', () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify([]));
    migrateLegacySingleSession(LEGACY_KEY);
    expect(useIrisySessionsStore.getState().sessions).toHaveLength(0);
  });
});

// Former Coding history is import material only; these tests prove lossless
// canonical migration and source preservation on failure.
// (ADR-005 irisy §11 v40)
describe('importLegacyCodingSessions', () => {
  const registerProject = async (_projectPath: string): Promise<string> =>
    'ctrl://local/project/opaque-project-id';
  const message = (id: string, role: 'user' | 'assistant' = 'user') => ({
    id,
    role,
    content: `content-${id}`,
  });

  it('imports every project and message without truncation', async () => {
    const legacy: Record<string, unknown> = {};
    for (let project = 0; project < 21; project += 1) {
      legacy[`/Users/example/project-${project}`] = project === 0
        ? Array.from({ length: 201 }, (_, index) => message(`m-${index}`, index % 2 === 0 ? 'user' : 'assistant'))
        : [message(`project-${project}`)];
    }
    window.localStorage.setItem(LEGACY_CODING_KEY, JSON.stringify(legacy));

    expect(await importLegacyCodingSessions(registerProject)).toBe(21);
    const state = useIrisySessionsStore.getState();
    expect(state.sessions).toHaveLength(21);
    expect(state.sessions[0]?.messages).toHaveLength(201);
    expect(window.localStorage.getItem(LEGACY_CODING_KEY)).toBeNull();
  });

  it('leaves mixed malformed source untouched and imports nothing', async () => {
    const existing = useIrisySessionsStore.getState().createSession('Existing');
    const legacy = {
      '/Users/example/valid': [message('valid')],
      '/Users/example/broken': [message('valid-2'), { id: 'broken', role: 'tool' }],
    };
    const raw = JSON.stringify(legacy);
    window.localStorage.setItem(LEGACY_CODING_KEY, raw);

    expect(await importLegacyCodingSessions(registerProject)).toBe(0);
    const state = useIrisySessionsStore.getState();
    expect(state.sessions.map((session) => session.id)).toEqual([existing.id]);
    expect(window.localStorage.getItem(LEGACY_CODING_KEY)).toBe(raw);
  });

  it('binds each imported project as a canonical session ResourceRef', async () => {
    const projectPath = '/Users/example/My Project';
    window.localStorage.setItem(
      LEGACY_CODING_KEY,
      JSON.stringify({ [projectPath]: [message('one')] }),
    );

    expect(await importLegacyCodingSessions(registerProject)).toBe(1);
    const imported = useIrisySessionsStore.getState().sessions[0];
    expect(imported?.resources).toEqual(['ctrl://local/project/opaque-project-id']);
    expect(imported?.resources[0]).not.toContain('/Users');
    expect(imported?.resources[0]).not.toContain('My%20Project');
    expect(imported?.importedFrom).toEqual({ kind: 'coding', projectPath });
  });

  it('rolls state back and preserves source when canonical persistence fails', async () => {
    const existing = useIrisySessionsStore.getState().createSession('Existing');
    const raw = JSON.stringify({ '/Users/example/project': [message('one')] });
    window.localStorage.setItem(LEGACY_CODING_KEY, raw);
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === IRISY_SESSIONS_KEY) throw new DOMException('quota exceeded', 'QuotaExceededError');
      originalSetItem.call(this, key, value);
    });

    expect(await importLegacyCodingSessions(registerProject)).toBe(0);
    const state = useIrisySessionsStore.getState();
    expect(state.sessions.map((session) => session.id)).toEqual([existing.id]);
    expect(state.activeSessionId).toBe(existing.id);
    expect(window.localStorage.getItem(LEGACY_CODING_KEY)).toBe(raw);
  });
});