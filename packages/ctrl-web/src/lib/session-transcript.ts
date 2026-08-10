// session-transcript — the frontend projection of a kernel-owned transcript.
//
// A conversation used to live only in browser storage, so the user's own history
// was unreachable by ordinary tools and unrecoverable if the profile was lost.
// The kernel now owns it as readable Markdown at `ctrl://local/session/<id>`;
// this module reads and appends through the canonical three verbs and maps
// between the file's shape and what the UI renders. It holds no second copy of
// the truth. (ADR-002 substrate §15 v83; ADR-005 irisy §11.2 v44)

import { invoke } from './bridge';
import { produceResource, queryResource } from './kernel';
import type {
  IrisySession,
  IrisySessionMessage,
  IrisyTextMessage,
} from './irisy-sessions';
import type { IrisyCustomMessage } from './llm-transport';

/** One turn as it appears on disk. */
export interface TranscriptMessage {
  role: string;
  content: string;
}

/** The parsed transcript file. */
export interface Transcript {
  id: string;
  label: string;
  created_at: string;
  last_active_at: string;
  resources: string[];
  selected_fct?: string | null;
  messages: TranscriptMessage[];
}

/** A row from the transcript directory listing. */
export interface SessionTranscriptRow {
  id: string;
  resource: string;
  label: string;
  created_at: string;
  last_active_at: string;
  turn_count: number;
  resources: string[];
  selected_fct?: string | null;
}

export const sessionResourceRef = (id: string): string => `ctrl://local/session/${id}`;

const APPEND_MESSAGE = 'append_message';

/** Milliseconds from the transcript's ISO-8601 UTC stamp. An unparseable or
 *  absent stamp yields 0 rather than "now", so a hand-edited file does not
 *  silently jump to the top of the list. */
export function transcriptTimeMs(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Rebuild the UI message list from the file. Message ids are derived from the
 *  session id and position, so they are stable across reloads without the file
 *  having to carry ids the user would have to look at. */
export function messagesFromTranscript(
  sessionId: string,
  messages: TranscriptMessage[],
): IrisySessionMessage[] {
  return messages.map((message, index) => {
    const id = `${sessionId}-m${index}`;
    if (message.role === 'custom') {
      try {
        const custom = JSON.parse(message.content) as IrisyCustomMessage;
        return { id, role: 'custom', custom, streaming: false };
      } catch {
        // A hand-edited or truncated custom payload still has readable text, so
        // show it as a reply rather than dropping the turn.
        return { id, role: 'assistant', content: message.content, streaming: false };
      }
    }
    return {
      id,
      role: message.role === 'user' ? 'user' : 'assistant',
      content: message.content,
      streaming: false,
    };
  });
}

/** The on-disk form of one UI message. A custom turn is stored as its JSON so it
 *  round-trips; everything else is stored as the text the user can read. */
export function transcriptMessageFrom(message: IrisySessionMessage): TranscriptMessage {
  if (message.role === 'custom') {
    return { role: 'custom', content: JSON.stringify(message.custom) };
  }
  return { role: message.role, content: message.content };
}

/** Project a directory row into the session shape the UI already renders.
 *  Messages are absent here on purpose: the list is metadata, and a transcript's
 *  turns are loaded when it is opened. */
export function sessionFromRow(row: SessionTranscriptRow): IrisySession {
  return {
    id: row.id,
    label: row.label,
    messages: [],
    createdAt: transcriptTimeMs(row.created_at),
    resources: row.resources ?? [],
    selectedFctRef: row.selected_fct ?? undefined,
    lastActiveAt: transcriptTimeMs(row.last_active_at),
  };
}

/** Project a full transcript, including its turns. */
export function sessionFromTranscript(id: string, transcript: Transcript): IrisySession {
  return {
    id,
    label: transcript.label || id,
    messages: messagesFromTranscript(id, transcript.messages ?? []),
    createdAt: transcriptTimeMs(transcript.created_at),
    resources: transcript.resources ?? [],
    selectedFctRef: transcript.selected_fct ?? undefined,
    lastActiveAt: transcriptTimeMs(transcript.last_active_at),
  };
}

/** Every transcript on disk, most recently active first. */
export const listSessionTranscripts = (): Promise<SessionTranscriptRow[]> =>
  invoke<SessionTranscriptRow[]>('list_session_transcripts');

export interface OpenedTranscript {
  revision: string;
  session: IrisySession;
}

/** Read one transcript and the revision an append must be based on. */
export async function readSessionTranscript(id: string): Promise<OpenedTranscript> {
  const reply = await queryResource<{ revision: string; transcript: Transcript }>(
    sessionResourceRef(id),
  );
  return { revision: reply.revision, session: sessionFromTranscript(id, reply.transcript) };
}

/** Mirrors the owner's Outcome for an append. */
interface AppendOutcome {
  effect?: { summary: string; verified_by?: string | null } | null;
  feedback?: { code: string; message: string; retryable: boolean } | null;
  result?: { revision: string; turn_count: number } | null;
}

export interface AppendResult {
  revision: string;
  turnCount: number;
}

export class TranscriptAppendError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'TranscriptAppendError';
  }
}

/** Append one turn. The owner's Outcome decides whether this succeeded: an
 *  unverified effect is a failure, never a silent success, so a lost turn is
 *  visible instead of appearing to have been saved.
 *  (ADR-002 substrate §15.5.2 v86) */
export async function appendSessionMessage(args: {
  id: string;
  expectedRevision: string;
  message: IrisySessionMessage;
  label?: string;
  resources?: string[];
  selectedFctRef?: string | null;
}): Promise<AppendResult> {
  const turn = transcriptMessageFrom(args.message);
  const operation: Record<string, unknown> = {
    kind: APPEND_MESSAGE,
    expected_revision: args.expectedRevision,
    role: turn.role,
    content: turn.content,
  };
  if (args.label !== undefined) operation.label = args.label;
  if (args.resources !== undefined) operation.resources = args.resources;
  // Auto is the absence of a selection, so an unset FCT sends no field.
  if (args.selectedFctRef) operation.selected_fct = args.selectedFctRef;

  const outcome = await produceResource<AppendOutcome>(
    sessionResourceRef(args.id),
    operation,
  );
  if (outcome.feedback) {
    throw new TranscriptAppendError(
      outcome.feedback.message,
      outcome.feedback.code,
      outcome.feedback.retryable,
    );
  }
  if (!outcome.effect?.verified_by || !outcome.result) {
    throw new TranscriptAppendError(
      'the conversation was not confirmed as saved',
      'unverified',
      true,
    );
  }
  return { revision: outcome.result.revision, turnCount: outcome.result.turn_count };
}

/** Write a whole browser-held session into the kernel, turn by turn, in order.
 *  Returns the revision after the last turn.
 *
 *  Appending rather than writing the file wholesale keeps one write contract and
 *  makes a partial migration self-evident: the turns that landed are on disk and
 *  readable, and the source is only cleared once every session round-trips. */
export async function pushSessionToKernel(session: IrisySession): Promise<string> {
  let revision = (await readSessionTranscript(session.id)).revision;
  for (const message of session.messages) {
    const result = await appendSessionMessage({
      id: session.id,
      expectedRevision: revision,
      message,
      label: session.label,
      resources: session.resources,
      selectedFctRef: session.selectedFctRef ?? null,
    });
    revision = result.revision;
  }
  return revision;
}

/** Whether a turn is still being produced rather than being a record.
 *
 *  An explicit streaming flag says so, and so does an empty text turn: the
 *  composer inserts an empty assistant placeholder the moment a turn starts, and
 *  writing that to disk would leave a blank reply in the user's history. */
function isUnsettled(message: IrisySessionMessage): boolean {
  if (message.streaming) return true;
  return message.role !== 'custom' && message.content.trim().length === 0;
}

/** The turns that have finished arriving, in order.
 *
 *  Everything after an unsettled turn is not in a known final position, so the
 *  prefix stops there. That is what makes persistence safe to attempt at any
 *  moment during a turn instead of only at the end. */
export function settledTurns(messages: IrisySessionMessage[]): IrisySessionMessage[] {
  const firstUnsettled = messages.findIndex(isUnsettled);
  return firstUnsettled < 0 ? messages : messages.slice(0, firstUnsettled);
}

/** Write any settled turns the transcript does not have yet.
 *
 *  Idempotent by construction: the file's own turn count decides what is
 *  missing, so calling this after every user message and again after a reply
 *  never duplicates a turn. When the file already holds more turns than the
 *  session does — after a fork, which shrinks the view but not the record —
 *  nothing is written, because the transcript is a record and a fork is not a
 *  reason to erase history. */
export async function syncSettledTurns(session: IrisySession): Promise<string> {
  const opened = await readSessionTranscript(session.id);
  let revision = opened.revision;
  const onDisk = opened.session.messages.length;
  const pending = settledTurns(session.messages).slice(onDisk);
  for (const message of pending) {
    const result = await appendSessionMessage({
      id: session.id,
      expectedRevision: revision,
      message,
      label: session.label,
      resources: session.resources,
      selectedFctRef: session.selectedFctRef ?? null,
    });
    revision = result.revision;
  }
  return revision;
}

/** Which browser-held sessions are not on disk yet. A session already present as
 *  a transcript is never re-pushed, so calling this twice cannot duplicate
 *  history. */
export function sessionsNeedingMigration(
  local: IrisySession[],
  existing: SessionTranscriptRow[],
): IrisySession[] {
  const onDisk = new Set(existing.map((row) => row.id));
  return local.filter((session) => !onDisk.has(session.id) && session.messages.length > 0);
}
