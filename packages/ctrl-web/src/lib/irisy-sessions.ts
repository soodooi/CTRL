// Irisy chat sessions — persisted to the user's vault as plain markdown.
//
// Layout (Obsidian / vim readable per CLAUDE.md design philosophy):
//   <vault>/.irisy-sessions/
//     <sessionId>.md     — YAML frontmatter + turn log
//
// Frontmatter:
//   id: <uuid>
//   title: <first-user-turn-derived>
//   created_at: <ISO 8601>
//   updated_at: <ISO 8601>
//
// Body shape (vim/Obsidian friendly — `## user` / `## assistant` H2 sections):
//   ## user
//   <message>
//
//   ## assistant
//   <reply>
//
//   ## user
//   ...
//
// Per memory `decision_ctrl_obsidian_philosophy.md` — local IS truth; the
// vault file is the canonical store, not a cache. UI state mirrors disk.

import { invoke } from './bridge';
import type { HistoryGroup, HistoryItem } from '@/components/primitives';

const SESSIONS_DIR = '.irisy-sessions';

/** ISO 8601 UTC timestamp (string). */
type IsoString = string;

export interface IrisyTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface IrisySessionMeta {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly createdAt: IsoString;
  readonly updatedAt: IsoString;
  /** Opaque session id returned by `hermes chat` on the FIRST turn of a
   *  chat — passed as `--resume <id>` on subsequent turns so hermes-agent
   *  preserves its own conversation context (separate from our vault id).
   *  Null until the first successful hermes turn; absent when the chat
   *  ran through the chat_stream fallback path. */
  readonly hermesSessionId?: string;
}

export interface IrisySession extends IrisySessionMeta {
  readonly turns: ReadonlyArray<IrisyTurn>;
}

interface VaultEntry {
  path: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

interface VaultWriteReply {
  absolute_path: string;
  path: string;
}

/** Title derived from the first user turn — short, single-line, ≤60 chars. */
export const deriveTitle = (firstUserMessage: string): string => {
  const oneLine = firstUserMessage.replace(/\s+/g, ' ').trim();
  if (oneLine.length === 0) return 'Untitled chat';
  return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine;
};

const sessionPath = (sessionId: string): string =>
  `${SESSIONS_DIR}/${sessionId}.md`;

/** Build the markdown body from a list of turns. */
const renderBody = (turns: ReadonlyArray<IrisyTurn>): string =>
  turns
    .map((t) => `## ${t.role}\n${t.content.trim()}`)
    .join('\n\n');

/** Parse `## user` / `## assistant` H2 sections back into turns. Tolerant
 *  of stray whitespace and unknown role headings (skipped). */
export const parseTurns = (body: string): IrisyTurn[] => {
  const lines = body.split(/\r?\n/);
  const out: IrisyTurn[] = [];
  let role: 'user' | 'assistant' | null = null;
  let buffer: string[] = [];
  const flush = (): void => {
    if (role !== null && buffer.length > 0) {
      const content = buffer.join('\n').trim();
      if (content.length > 0) out.push({ role, content });
    }
    buffer = [];
  };
  for (const line of lines) {
    const heading = /^##\s+(user|assistant)\s*$/i.exec(line);
    const matched = heading?.[1];
    if (matched) {
      flush();
      role = matched.toLowerCase() as 'user' | 'assistant';
      continue;
    }
    if (role !== null) buffer.push(line);
  }
  flush();
  return out;
};

/**
 * Create a new session file with frontmatter only (empty body). Called
 * on the first user send in a fresh chat. Subsequent turns are appended
 * via `appendTurns`.
 */
export const createSession = async (
  sessionId: string,
  title: string,
): Promise<IrisySessionMeta> => {
  const now: IsoString = new Date().toISOString();
  const path = sessionPath(sessionId);
  await invoke<VaultWriteReply>('vault_write', {
    args: {
      path,
      content: '',
      frontmatter: {
        kind: 'irisy-session',
        id: sessionId,
        title,
        created_at: now,
        updated_at: now,
      },
    },
  });
  return { id: sessionId, path, title, createdAt: now, updatedAt: now };
};

/**
 * Append a user turn + assistant turn pair to an existing session.
 * Re-reads the file, appends to the body, updates `updated_at` in the
 * frontmatter, writes back. Returns the refreshed meta.
 */
export const appendTurns = async (
  sessionId: string,
  userTurn: IrisyTurn,
  assistantTurn: IrisyTurn,
): Promise<IrisySessionMeta> => {
  const path = sessionPath(sessionId);
  const entry = await invoke<VaultEntry>('vault_read', { args: { path } });
  const existingBody = entry.content.trim();
  const newSegment = renderBody([userTurn, assistantTurn]);
  const nextBody = existingBody.length === 0
    ? newSegment
    : `${existingBody}\n\n${newSegment}`;

  const fm = entry.frontmatter ?? {};
  const now: IsoString = new Date().toISOString();
  const createdAt = (typeof fm.created_at === 'string' ? fm.created_at : now);
  const title = (typeof fm.title === 'string' ? fm.title : deriveTitle(userTurn.content));
  const nextFrontmatter = {
    ...fm,
    kind: 'irisy-session',
    id: sessionId,
    title,
    created_at: createdAt,
    updated_at: now,
  };

  await invoke<VaultWriteReply>('vault_write', {
    args: { path, content: nextBody, frontmatter: nextFrontmatter },
  });
  return { id: sessionId, path, title, createdAt, updatedAt: now };
};

/**
 * Persist the hermes-side session id alongside the vault session id.
 * Called once after the first successful hermes turn so subsequent turns
 * in the same chat can `--resume`. Idempotent — safe to call repeatedly
 * with the same value.
 */
export const setHermesSessionId = async (
  vaultSessionId: string,
  hermesSessionId: string,
): Promise<void> => {
  const path = sessionPath(vaultSessionId);
  const entry = await invoke<VaultEntry>('vault_read', { args: { path } });
  const fm = entry.frontmatter ?? {};
  if (typeof fm.hermes_session_id === 'string' && fm.hermes_session_id === hermesSessionId) {
    return; // already up to date
  }
  await invoke<VaultWriteReply>('vault_write', {
    args: {
      path,
      content: entry.content,
      frontmatter: {
        ...fm,
        hermes_session_id: hermesSessionId,
        updated_at: new Date().toISOString(),
      },
    },
  });
};

const readHermesSessionId = (fm: Record<string, unknown>): string | undefined => {
  const v = fm.hermes_session_id;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};

/** List every session file's metadata. Skips entries that fail to read
 *  rather than hard-failing the whole list — a corrupt file shouldn't
 *  hide the rest of the user's chat history. */
export const listSessions = async (): Promise<IrisySessionMeta[]> => {
  let paths: string[] = [];
  try {
    paths = await invoke<string[]>('vault_list', {
      args: { subdir: SESSIONS_DIR },
    });
  } catch {
    return [];
  }
  const metas: IrisySessionMeta[] = [];
  for (const path of paths) {
    if (!path.endsWith('.md')) continue;
    try {
      const entry = await invoke<VaultEntry>('vault_read', { args: { path } });
      const fm = entry.frontmatter ?? {};
      if (fm.kind !== 'irisy-session') continue;
      const id = typeof fm.id === 'string' && fm.id.length > 0
        ? fm.id
        : path.replace(`${SESSIONS_DIR}/`, '').replace(/\.md$/, '');
      const title = typeof fm.title === 'string' && fm.title.length > 0
        ? fm.title
        : 'Untitled chat';
      const createdAt = typeof fm.created_at === 'string'
        ? fm.created_at
        : new Date(0).toISOString();
      const updatedAt = typeof fm.updated_at === 'string'
        ? fm.updated_at
        : createdAt;
      metas.push({ id, path, title, createdAt, updatedAt, hermesSessionId: readHermesSessionId(fm) });
    } catch {
      /* skip unreadable entries */
    }
  }
  // Newest first — UI groups by date but within each group we want recent on top.
  metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return metas;
};

/** Read a session's full transcript (frontmatter + parsed turns). */
export const loadSession = async (
  sessionId: string,
): Promise<IrisySession | null> => {
  const path = sessionPath(sessionId);
  try {
    const entry = await invoke<VaultEntry>('vault_read', { args: { path } });
    const fm = entry.frontmatter ?? {};
    if (fm.kind !== 'irisy-session') return null;
    const id = typeof fm.id === 'string' ? fm.id : sessionId;
    const title = typeof fm.title === 'string' ? fm.title : 'Untitled chat';
    const createdAt = typeof fm.created_at === 'string'
      ? fm.created_at
      : new Date(0).toISOString();
    const updatedAt = typeof fm.updated_at === 'string'
      ? fm.updated_at
      : createdAt;
    return {
      id,
      path,
      title,
      createdAt,
      updatedAt,
      hermesSessionId: readHermesSessionId(fm),
      turns: parseTurns(entry.content),
    };
  } catch {
    return null;
  }
};

// --- Grouping by relative date (Today / This week / Older) ---

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Group sessions into Today / This week / Older buckets for the sidebar.
 * Anchors to `now` at call time — recompute on render or when sessions change.
 */
export const groupSessions = (
  sessions: ReadonlyArray<IrisySessionMeta>,
  now: Date = new Date(),
): HistoryGroup[] => {
  const today = startOfDay(now).getTime();
  const weekStart = today - 6 * DAY_MS;

  const todayItems: HistoryItem[] = [];
  const weekItems: HistoryItem[] = [];
  const olderItems: HistoryItem[] = [];

  for (const s of sessions) {
    const ts = new Date(s.updatedAt).getTime();
    const item: HistoryItem = { id: s.id, title: s.title };
    if (ts >= today) todayItems.push(item);
    else if (ts >= weekStart) weekItems.push(item);
    else olderItems.push(item);
  }

  return [
    { label: 'Today', items: todayItems },
    { label: 'This week', items: weekItems },
    { label: 'Older', items: olderItems },
  ];
};
