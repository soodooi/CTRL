// irisy-sessions — multi-session chat state for Irisy's chat surface.
//
// Kiro-style redesign (bao: "Irisy的页面，清修改成跟kiro一样...session，model，
// attachments等等模块都要"). Prior to this, IrisyChat.tsx persisted exactly ONE
// conversation per mode under a single localStorage key (`irisy:chat:v1[:coding]`).
// This store replaces that with a LIST of sessions the user can create, switch
// between, close, and rename via a tab bar (SessionTabs.tsx) — the top-of-page
// module Kiro's screenshot shows ("构建并评估 Irisy 调试" / "ACP attachment ca..."
// / "New Session" tabs).
//
// Scope discipline (explicit, per bao's "先不要 token" + no checkpoint/restore
// this round): this store owns ONLY session identity + message history. It does
// NOT track token/credit usage (out of scope) and does NOT implement
// checkpoint/restore snapshots (separately scoped, not built). Attachments and
// the active engine/model selection remain owned by their existing modules
// (coding-chat.ts's Attachment shape reused verbatim; active-agent.ts's engine
// store) — this store only carries the PER-SESSION message list attachments end
// up rendered into, not a duplicate of either.
//
// Coding mode is explicitly OUT of this store. Coding's workspace-keyed
// conversation state lives in coding-sessions.ts and CodingAgentPanel.tsx.
// Only Irisy's persistent dialog mode uses this store.
// (ADR-003 frontend §8.5 v38) (ADR-003 frontend §8.6 v38)
// (ADR-005 irisy §8.7 v37) (ADR-005 irisy §11 v37)

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
  /** Bumped on every message change — lets the tab bar order by recency if
   *  ever needed; not currently used for ordering (sessions render in
   *  creation order, matching a stable tab bar instead of jumping around). */
  lastActiveAt: number;
}

interface IrisySessionsState {
  sessions: IrisySession[];
  activeSessionId: string | null;

  createSession: (label?: string) => IrisySession;
  closeSession: (id: string) => void;
  activateSession: (id: string) => void;
  renameSession: (id: string, label: string) => void;
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

function makeSession(label: string): IrisySession {
  return {
    id: newId(),
    label,
    messages: [],
    createdAt: now(),
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
      version: 1,
      partialize: (s) => ({
        sessions: s.sessions,
        activeSessionId: s.activeSessionId,
      }),
      migrate: (persisted, version) => {
        // v1 is the first shape for this store — no prior version to
        // migrate FROM here. The legacy single-conversation localStorage
        // key (`irisy:chat:v1`) is migrated separately by
        // `migrateLegacySingleSession` (called once from IrisyChat.tsx's
        // mount effect) rather than here, since that key lives outside
        // this store's own persisted shape entirely.
        if (version < 1) return { sessions: [], activeSessionId: null };
        const p = persisted as Partial<IrisySessionsState>;
        return {
          sessions: p.sessions ?? [],
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
