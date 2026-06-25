// Coding session — the bridge that lets the resident Irisy see + act on the
// Coding terminal (companion P0, vault/ctrl/irisy-coding-companion.md).
//
// CodingTerminal registers its live PTY here (streamId + a getter for recent
// stdout) on mount and clears it on unmount. AmbientHome's Irisy reads it: the
// stdout getter is its "eyes" (ambient context), the streamId is where its
// "hand" writes commands (cs_stdin). Connection ① in the architecture table —
// CTRL-internal, no external protocol, since both live in the same app.

import { create } from 'zustand';

interface CodingSessionState {
  /** Active Coding terminal PTY stream id, or null when none is open. */
  streamId: string | null;
  /** Returns the terminal's recent stdout text (Irisy's eyes). */
  getRecentStdout: (() => string) | null;
  setSession: (streamId: string, getRecentStdout: () => string) => void;
  clearSession: () => void;
}

export const useCodingSession = create<CodingSessionState>((set) => ({
  streamId: null,
  getRecentStdout: null,
  setSession: (streamId, getRecentStdout) => set({ streamId, getRecentStdout }),
  clearSession: () => set({ streamId: null, getRecentStdout: null }),
}));
