// session-hydration — bring the kernel's transcripts into the live view.
//
// The transcript directory is the truth, so on open the store is rebuilt from it
// rather than from browser storage. Anything the browser holds that the kernel
// has never seen is pushed first, so upgrading cannot lose a conversation. When
// the kernel is unavailable (a plain browser preview), the existing local view is
// kept instead of being blanked: unavailability degrades, it does not erase.
// (ADR-001 spine § local is truth; ADR-005 irisy §11.2 v44)

import { useIrisySessionsStore } from './irisy-sessions';
import {
  listSessionTranscripts,
  pushSessionToKernel,
  readSessionTranscript,
  sessionFromRow,
  sessionsNeedingMigration,
  syncSettledTurns,
} from './session-transcript';

export interface HydrationResult {
  /** How many browser-held conversations were written to disk. */
  migrated: number;
  /** How many transcripts the view now shows. */
  sessions: number;
  /** Set when the kernel could not be reached, so the caller can say so rather
   *  than implying the history on screen is the whole history. */
  unavailable?: string;
}

/** Rebuild the session list from the transcript directory, migrating first. */
export async function hydrateSessionsFromKernel(): Promise<HydrationResult> {
  const local = useIrisySessionsStore.getState().sessions;
  let rows;
  try {
    rows = await listSessionTranscripts();
  } catch (error) {
    return {
      migrated: 0,
      sessions: local.length,
      unavailable: error instanceof Error ? error.message : String(error),
    };
  }

  let migrated = 0;
  for (const session of sessionsNeedingMigration(local, rows)) {
    try {
      await pushSessionToKernel(session);
      migrated += 1;
    } catch {
      // Leave this conversation in the local view rather than dropping it. The
      // turns that landed are already readable on disk, and the next open
      // retries; nothing is deleted on a partial migration.
    }
  }
  if (migrated > 0) {
    try {
      rows = await listSessionTranscripts();
    } catch {
      // Keep the pre-migration listing; it is stale, not wrong.
    }
  }

  const kernelSessions = rows.map(sessionFromRow);
  const onDisk = new Set(kernelSessions.map((session) => session.id));
  // A conversation that failed to migrate stays visible; the truth on disk wins
  // for everything that is there.
  const stranded = local.filter((session) => !onDisk.has(session.id));
  const sessions = [...kernelSessions, ...stranded];

  const previousActive = useIrisySessionsStore.getState().activeSessionId;
  const activeSessionId = sessions.some((session) => session.id === previousActive)
    ? previousActive
    : (sessions[0]?.id ?? null);
  useIrisySessionsStore.setState({ sessions, activeSessionId });

  // Listing carries metadata only, so the conversation being looked at is loaded
  // in full straight away instead of appearing empty.
  if (activeSessionId && onDisk.has(activeSessionId)) {
    await loadSessionMessages(activeSessionId);
  }
  return { migrated, sessions: sessions.length };
}

/** Load one transcript's turns into the view. A session whose turns are already
 *  loaded is re-read, because the file may have changed underneath — including
 *  by the user's own editor. */
export async function loadSessionMessages(id: string): Promise<void> {
  let opened;
  try {
    opened = await readSessionTranscript(id);
  } catch {
    return;
  }
  useIrisySessionsStore.setState((state) => ({
    sessions: state.sessions.map((session) =>
      session.id === id
        ? {
            // Keep the local identity fields the file does not own, and take
            // everything the transcript does own from the transcript.
            ...session,
            ...opened.session,
            importedFrom: session.importedFrom,
            // A transcript with no label of its own reads back as its id. Taking
            // that would erase a label the listing already knew, so the known
            // one wins over the fallback.
            label:
              opened.session.label === id && session.label ? session.label : opened.session.label,
          }
        : session,
    ),
  }));
}

/** One in-flight persist per session.
 *
 *  A turn is persisted twice — once when the question is asked, once when the
 *  answer settles — and a fast turn or a second send can overlap those calls.
 *  Overlapping calls would each read the same on-disk turn count and both append
 *  the same turn, duplicating the user's history. Chaining makes the file's count
 *  authoritative for every call. */
const persistChains = new Map<string, Promise<string | null>>();

/** Persist whatever has settled in one session. Safe to call at any point in a
 *  turn and safe to call twice. Failures are reported to the caller rather than
 *  thrown into a render path. */
export function persistSettledTurns(id: string): Promise<string | null> {
  const previous = persistChains.get(id) ?? Promise.resolve<string | null>(null);
  const next = previous.then(async () => {
    // Read the session inside the chain, so a queued call sees the turns that
    // arrived while it was waiting rather than a stale snapshot.
    const session = useIrisySessionsStore
      .getState()
      .sessions.find((candidate) => candidate.id === id);
    if (!session) return null;
    try {
      return await syncSettledTurns(session);
    } catch {
      // A turn that could not be written is still on screen and still in the
      // local view; the next settle point retries it.
      return null;
    }
  });
  persistChains.set(id, next);
  void next.finally(() => {
    // Drop the chain once it is the last one, so a long-lived tab does not
    // accumulate resolved promises.
    if (persistChains.get(id) === next) persistChains.delete(id);
  });
  return next;
}
