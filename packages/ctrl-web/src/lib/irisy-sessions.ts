// irisy-sessions — the sole live and recovery transcript authority for Irisy.
// Sessions own their messages and canonical ResourceRefs; runtime engines are
// projections and never provide a second selectable identity or history store.
// (ADR-003 frontend §8.6 v40; ADR-005 irisy §11 v40)

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { IrisyCustomMessage } from './llm-transport';

export interface IrisyTextMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Persisted messages are always restored as non-streaming. Older ambient
   *  transcripts predate this display hint, so it remains optional.
   *  (ADR-003 frontend §8.6 v38) */
  streaming?: boolean;
}

export interface IrisyCustomDisplayMessage {
  id: string;
  role: 'custom';
  custom: IrisyCustomMessage;
  /** Persisted messages are always restored as non-streaming. Older ambient
   *  transcripts predate this display hint, so it remains optional.
   *  (ADR-003 frontend §8.6 v38) */
  streaming?: boolean;
}

export type IrisySessionMessage = IrisyTextMessage | IrisyCustomDisplayMessage;

export interface IrisySession {
  id: string;
  /** User-editable tab label. Defaults to a short prefix of the first user
   *  message once one arrives (mirrors Kiro's tab titling from the prompt),
   *  "New Session" until then. */
  label: string;
  messages: IrisySessionMessage[];
  createdAt: number;
  /** Canonical ResourceRefs owned by this session's exact runtime context.
   *  (ADR-005 irisy §11 v40) */
  resources: string[];
  /** Stable FCT selection only. Expanded Resources, Skill, scope, and policy
   *  resolve live from the canonical catalog before every turn.
   *  (ADR-002 substrate §15.4 v84; ADR-005 irisy §11 v41) */
  selectedFctRef?: string;
  /** Read-only provenance for a former Coding transcript explicitly imported
   *  into this canonical Irisy session. It never resumes the retired runtime.
   *  (ADR-005 irisy §11 v40) */
  importedFrom?: { kind: 'coding'; projectPath: string };
  /** Bumped on every message change — lets the tab bar order by recency if
   *  ever needed; not currently used for ordering (sessions render in
   *  creation order, matching a stable tab bar instead of jumping around). */
  lastActiveAt: number;
}

// All session mutations remain in the sole canonical transcript authority.
// (ADR-005 irisy §11 v40)
interface IrisySessionsState {
  sessions: IrisySession[];
  activeSessionId: string | null;

  createSession: (label?: string) => IrisySession;
  closeSession: (id: string) => void;
  activateSession: (id: string) => void;
  renameSession: (id: string, label: string) => void;
  setResources: (id: string, resources: string[]) => void;
  setSelectedFct: (id: string, ref: string | null) => void;
  setMessages: (
    id: string,
    updater: (prev: IrisySessionMessage[]) => IrisySessionMessage[],
  ) => void;
  clearSessionMessages: (id: string) => void;
}

const now = (): number => Date.now();
const newId = (): string => `irisy-session-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const DEFAULT_LABEL = 'New Session';
/** Tab label max length before truncation — matches Kiro's compact tab width. */
const LABEL_MAX_CHARS = 40;

/** Derive a tab label from a user's first message, matching Kiro's
 *  auto-titling from the prompt text ("构建并评估 Irisy 调试"-style short
 *  labels). Falls back to DEFAULT_LABEL for an empty/whitespace-only input. */
export function deriveSessionLabel(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim().replace(/\s+/g, ' ');
  if (!trimmed) return DEFAULT_LABEL;
  return trimmed.length > LABEL_MAX_CHARS
    ? `${trimmed.slice(0, LABEL_MAX_CHARS)}…`
    : trimmed;
}

// New tabs are canonical Irisy sessions, never engine-owned sessions.
// (ADR-005 irisy §11 v40)
function makeSession(label: string): IrisySession {
  return {
    id: newId(),
    label,
    messages: [],
    createdAt: now(),
    resources: [],
    lastActiveAt: now(),
  };
}

export const useIrisySessionsStore = create<IrisySessionsState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,

      createSession: (label = DEFAULT_LABEL) => {
        const session = makeSession(label);
        set((s) => ({
          sessions: [...s.sessions, session],
          activeSessionId: session.id,
        }));
        return session;
      },

      closeSession: (id) => {
        set((s) => {
          const idx = s.sessions.findIndex((sess) => sess.id === id);
          if (idx < 0) return {};
          const next = s.sessions.filter((sess) => sess.id !== id);
          let active = s.activeSessionId;
          if (active === id) {
            // Prefer the tab to the left (matches most tabbed-editor UX,
            // including Kiro's own screenshot layout); fall back to the
            // first remaining tab; null when the last session closes.
            active = next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? null;
          }
          return { sessions: next, activeSessionId: active };
        });
      },

      activateSession: (id) => {
        if (!get().sessions.some((s) => s.id === id)) return;
        set((s) => ({
          activeSessionId: id,
          sessions: s.sessions.map((sess) =>
            sess.id === id ? { ...sess, lastActiveAt: now() } : sess,
          ),
        }));
      },

      renameSession: (id, label) => {
        const trimmed = label.trim();
        if (!trimmed) return;
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === id ? { ...sess, label: trimmed } : sess,
          ),
        }));
      },

      // Explicit ResourceRefs are persisted with the canonical session context.
      // (ADR-005 irisy §11 v40)
      setResources: (id, resources) => {
        set((s) => ({
          sessions: s.sessions.map((session) =>
            session.id === id ? { ...session, resources: [...resources], lastActiveAt: now() } : session,
          ),
        }));
      },

      setSelectedFct: (id, ref) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === id
              ? { ...session, selectedFctRef: ref ?? undefined, lastActiveAt: now() }
              : session,
          ),
        }));
      },

      setMessages: (id, updater) => {
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === id
              ? { ...sess, messages: updater(sess.messages), lastActiveAt: now() }
              : sess,
          ),
        }));
      },

      clearSessionMessages: (id) => {
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === id ? { ...sess, messages: [] } : sess,
          ),
        }));
      },
    }),
    {
      name: 'ctrl:irisy-sessions:v1',
      version: 2,
      partialize: (s) => ({
        sessions: s.sessions,
        activeSessionId: s.activeSessionId,
      }),
      // Persist only the stable selection ref. v1's global raw-Skill pin had no
      // session owner, so migration discards it and starts every session at Auto.
      // (ADR-002 substrate §15.4 v84; ADR-005 irisy §11 v41)
      migrate: (persisted, version) => {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('ctrl:irisy-assistant-skill:v1');
        }
        if (version < 1) return { sessions: [], activeSessionId: null };
        const p = persisted as Partial<IrisySessionsState>;
        return {
          sessions: (p.sessions ?? []).map((session) => ({
            ...session,
            resources: session.resources ?? [],
            selectedFctRef: version < 2 ? undefined : session.selectedFctRef,
          })),
          activeSessionId: p.activeSessionId ?? null,
        };
      },
    },
  ),
);

/** The active session, or null when none exists yet. */
export function useActiveIrisySession(): IrisySession | null {
  return useIrisySessionsStore((s) => s.sessions.find((sess) => sess.id === s.activeSessionId) ?? null);
}

/** Ensure at least one session exists and is active — call once on mount.
 *  Returns the resolved active session id. Idempotent: a no-op when a
 *  session (any session) already exists and is active. */
export function ensureActiveIrisySession(): string {
  const state = useIrisySessionsStore.getState();
  if (state.activeSessionId && state.sessions.some((s) => s.id === state.activeSessionId)) {
    return state.activeSessionId;
  }
  if (state.sessions.length > 0) {
    const first = state.sessions[0]!;
    state.activateSession(first.id);
    return first.id;
  }
  return state.createSession().id;
}

/** One-time migration from the legacy single-conversation localStorage key
 *  (`irisy:chat:v1`) into a real first session, so a user upgrading from the
 *  pre-multi-session build doesn't lose their existing conversation. Safe to
 *  call every mount — it is a no-op once the legacy key is gone or a session
 *  store already exists. */
export function migrateLegacySingleSession(legacyKey: string): void {
  if (typeof window === 'undefined') return;
  const state = useIrisySessionsStore.getState();
  if (state.sessions.length > 0) return; // already on the new store
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(legacyKey);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const messages = parsed
      .filter((m): m is IrisySessionMessage => {
        if (typeof m !== 'object' || m === null) return false;
        const role = (m as Record<string, unknown>).role;
        return role === 'user' || role === 'assistant' || role === 'custom';
      })
      .map((m) => ({ ...m, streaming: false }) as IrisySessionMessage);
    if (messages.length === 0) return;
    const firstUser = messages.find((m): m is IrisyTextMessage => m.role === 'user');
    const session = makeSession(firstUser ? deriveSessionLabel(firstUser.content) : DEFAULT_LABEL);
    session.messages = messages;
    useIrisySessionsStore.setState({
      sessions: [session],
      activeSessionId: session.id,
    });
    // Clean up the legacy key now that its content lives in the new store —
    // leaving it around risks re-migrating stale content after the user has
    // since cleared their (new-store) session.
    window.localStorage.removeItem(legacyKey);
  } catch {
    // Malformed legacy payload — nothing to migrate, leave the key alone
    // rather than risk destroying data we can't parse.
  }
}

const LEGACY_CODING_SESSIONS_KEY = 'ctrl:coding-sessions:v1';
const IRISY_SESSIONS_KEY = 'ctrl:irisy-sessions:v1';

/** Explicitly import former workspace-keyed Coding history as read-only source
 * material for new canonical Irisy sessions. Project identities are issued by
 * the kernel owner before canonical state changes. The source is removed only
 * after every project and message is copied and persistence is verified.
 * (ADR-005 irisy §11 v40) */
export async function importLegacyCodingSessions(
  registerProject: (projectPath: string) => Promise<string>,
): Promise<number> {
  if (typeof window === 'undefined') return 0;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(LEGACY_CODING_SESSIONS_KEY);
  } catch {
    return 0;
  }
  if (!raw) return 0;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 0;
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) return 0;
    const imported: IrisySession[] = [];
    for (const [projectPath, value] of entries) {
      if (!Array.isArray(value) || value.length === 0) return 0;
      const messages: IrisyTextMessage[] = [];
      for (const message of value) {
        if (typeof message !== 'object' || message === null) return 0;
        const candidate = message as Record<string, unknown>;
        if (
          typeof candidate.id !== 'string'
          || (candidate.role !== 'user' && candidate.role !== 'assistant')
          || typeof candidate.content !== 'string'
        ) return 0;
        messages.push({ ...candidate, streaming: false } as unknown as IrisyTextMessage);
      }
      const projectName = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? 'Project';
      const session = makeSession(`Imported: ${projectName}`);
      session.messages = messages;
      session.resources = [await registerProject(projectPath)];
      session.importedFrom = { kind: 'coding', projectPath };
      imported.push(session);
    }

    const previous = useIrisySessionsStore.getState();
    try {
      useIrisySessionsStore.setState({
        sessions: [...previous.sessions, ...imported],
        activeSessionId: imported[0]!.id,
      });
      const persisted = window.localStorage.getItem(IRISY_SESSIONS_KEY);
      if (!persisted || !imported.every((session) => persisted.includes(session.id))) {
        throw new Error('Canonical Irisy session persistence verification failed');
      }
      window.localStorage.removeItem(LEGACY_CODING_SESSIONS_KEY);
      return imported.length;
    } catch {
      try {
        useIrisySessionsStore.setState({
          sessions: previous.sessions,
          activeSessionId: previous.activeSessionId,
        });
      } catch {
        // Zustand applies the in-memory state before its persist write. A
        // failing storage backend can therefore throw after rollback succeeds.
      }
      return 0;
    }
  } catch {
    return 0;
  }
}
