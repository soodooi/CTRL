// session-state — Pi 2-mode global state.
//
// ADR-002 substrate § brain v17 (2026-06-07): the cap mode (Pi "wears the
// hat" of a SKILL.md) is RETIRED along with the keycap concept it was
// derived from (memory `decision_keycap_collapses_to_mcp_meta_ux_layer`,
// bao 2026-06-07 "去掉 keycap 概念 你会更加清晰"). Skills survive as
// invocable references that Irisy reads on demand via the `list_skills` /
// `read_skill` tools — they are not a session mode and they do not get
// pinned to the next turn via UI state. To use a skill, the user names
// it in the prompt ("use the foo skill to ..."); Irisy looks it up + acts.
//
// Remaining modes:
//
//   • personal  : default Irisy companion. cwd = vault root. Pi runs as
//                 Irisy persona.
//   • coding    : Coding L1 tab. Pi runs as its default coding agent
//                 (Irisy persona extension short-circuits on the
//                 `coding-` session-name prefix per v15 §brain).
//                 The `projectDir` field is reserved for the not-yet-
//                 shipped project picker; until then Pi uses its launch
//                 cwd.
//
// Persisted to localStorage so a tab close / reload restores the last
// session intent (same pattern as `workspace-store`).

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SessionMode = 'personal' | 'coding';

interface SessionState {
  mode: SessionMode;
  /** Absolute path of the project directory when mode === 'coding'. */
  projectDir: string | null;
  /** Last picker timestamp — lets the UI animate banner changes. */
  lastChangedAt: number;

  // Actions
  enterPersonalMode: () => void;
  enterCodingMode: (projectDir: string) => void;
}

export const useSessionStateStore = create<SessionState>()(
  persist(
    (set) => ({
      mode: 'personal',
      projectDir: null,
      lastChangedAt: Date.now(),

      enterPersonalMode: () =>
        set({
          mode: 'personal',
          projectDir: null,
          lastChangedAt: Date.now(),
        }),
      enterCodingMode: (projectDir) =>
        set({
          mode: 'coding',
          projectDir,
          lastChangedAt: Date.now(),
        }),
    }),
    {
      name: 'ctrl:session-state:v1',
      // Don't persist `lastChangedAt` — it's transient UI state.
      partialize: (s) => ({
        mode: s.mode,
        projectDir: s.projectDir,
      }),
    },
  ),
);

/** Stable label for the top banner (mode banner reads this). */
export function sessionLabel(
  s: Pick<SessionState, 'mode' | 'projectDir'>,
): string {
  if (s.mode === 'coding' && s.projectDir) {
    // Shorten ~/long/path/to/X to ~/.../X for the banner.
    const parts = s.projectDir.split('/').filter(Boolean);
    if (parts.length > 3) {
      return `Coding · ${parts[0]}/.../${parts[parts.length - 1]}`;
    }
    return `Coding · ${s.projectDir}`;
  }
  return 'Personal';
}
