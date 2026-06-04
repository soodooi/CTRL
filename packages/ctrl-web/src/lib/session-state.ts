// session-state — Pi 3-mode global state (bao 2026-06-04).
//
// CTRL surfaces Pi through three modes that share one Pi process but
// differ in system prompt + working directory + history scope:
//
//   • personal  : default Irisy companion. cwd = vault root. Pi has no
//                 cap, no project — just chats as Irisy persona.
//   • coding    : Pi is a coding agent inside a chosen project dir. The
//                 cwd is injected into Pi's system prompt (we do NOT
//                 restart the Pi process; cwd switch via prompt is
//                 enough for v1, per `feedback_reuse_existing_capability_first`).
//   • cap       : Pi "wears the hat" of a SKILL.md. The kernel prepends
//                 the SKILL.md body as a system message for that turn
//                 (see commands/irisy_chat.rs `load_skill_system_prompt`).
//
// Picking a cap auto-implies cap mode; setting a project dir implies
// coding mode; clearing both returns to personal. Modes are mutually
// exclusive — wearing a cap inside coding mode is v2.x scope.
//
// Persisted to localStorage so a tab close / reload restores the last
// session intent (same pattern as `workspace-store`).

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SessionMode = 'personal' | 'coding' | 'cap';

interface SessionState {
  mode: SessionMode;
  /** Active SKILL.md name when mode === 'cap'; otherwise null. */
  currentSkillId: string | null;
  /** Absolute path of the project directory when mode === 'coding'. */
  projectDir: string | null;
  /** Last picker timestamp — lets the UI animate banner changes. */
  lastChangedAt: number;

  // Actions
  enterPersonalMode: () => void;
  enterCodingMode: (projectDir: string) => void;
  wearCap: (skillId: string) => void;
  removeCap: () => void;
}

export const useSessionStateStore = create<SessionState>()(
  persist(
    (set) => ({
      mode: 'personal',
      currentSkillId: null,
      projectDir: null,
      lastChangedAt: Date.now(),

      enterPersonalMode: () =>
        set({
          mode: 'personal',
          currentSkillId: null,
          projectDir: null,
          lastChangedAt: Date.now(),
        }),
      enterCodingMode: (projectDir) =>
        set({
          mode: 'coding',
          currentSkillId: null,
          projectDir,
          lastChangedAt: Date.now(),
        }),
      wearCap: (skillId) =>
        set({
          mode: 'cap',
          currentSkillId: skillId,
          // Keep projectDir when wearing a cap from coding mode — v2.x
          // will reconcile; for now cap takes over the system prompt.
          lastChangedAt: Date.now(),
        }),
      removeCap: () =>
        set({
          mode: 'personal',
          currentSkillId: null,
          lastChangedAt: Date.now(),
        }),
    }),
    {
      name: 'ctrl:session-state:v1',
      // Don't persist `lastChangedAt` — it's transient UI state.
      partialize: (s) => ({
        mode: s.mode,
        currentSkillId: s.currentSkillId,
        projectDir: s.projectDir,
      }),
    },
  ),
);

/** Stable label for the top banner (mode banner reads this). */
export function sessionLabel(s: Pick<SessionState, 'mode' | 'currentSkillId' | 'projectDir'>): string {
  if (s.mode === 'cap' && s.currentSkillId) {
    return `Cap · ${s.currentSkillId}`;
  }
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
