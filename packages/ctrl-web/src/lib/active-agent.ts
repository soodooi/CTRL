// active-agent — which agent backs Irisy (ADR-005 irisy §8; architecture
// byo-cli-driver). One of Irisy's three configurable axes alongside persona +
// feature packs: the AGENT axis picks the ENGINE that runs the loop.
//
// Two kinds (honest, never collapsed — see ADR-005 §8 + the Option A lock):
//   • embedded  (hermes) — CTRL launches + supervises it; it answers IN the
//                          in-app chat box. This is the default.
//   • byo-cli   (Codex / Claude Code) — the user's OWN external CLI. CTRL only
//                          PROJECTS into it (gate + AGENTS.md) and never
//                          supervises its loop. Selecting one records the
//                          active driver + shows projection status; the in-app
//                          chat keeps answering with Irisy (hermes). Driving the
//                          BYO CLI happens in the user's terminal, not here.
//
// The active selection is shared by the env (Settings) selector and the in-chat
// selector so they never drift. Persisted to localStorage (same pattern as
// session-state); the driver LIST comes from the kernel (`list_byo_drivers`)
// with honest presence detection — CTRL never offers a driver the user lacks.

import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from './bridge';

export type AgentKind = 'embedded' | 'byo-cli';

export interface ByoDriver {
  id: string;
  label: string;
  kind: AgentKind;
  present: boolean;
  detail: string;
}

/** The always-available default — Irisy's embedded brain. */
export const DEFAULT_AGENT_ID = 'hermes';

/** Minimal honest list used before the kernel answers (first paint) or when the
 *  `list_byo_drivers` command is unavailable (e.g. pure browser/PWA dev with no
 *  Tauri bridge). hermes is always real; BYO-CLI drivers only appear once the
 *  kernel detects them, so we never fabricate a driver the user lacks. */
const FALLBACK_DRIVERS: ByoDriver[] = [
  {
    id: DEFAULT_AGENT_ID,
    label: 'Irisy (hermes)',
    kind: 'embedded',
    present: true,
    detail: 'In-app brain — answers in this chat.',
  },
];

interface ActiveAgentState {
  activeAgentId: string;
  drivers: ByoDriver[];
  loaded: boolean;
  setActiveAgent: (id: string) => void;
  loadDrivers: () => Promise<void>;
  /** One-click managed install of a BYO engine (ADR-005 §8.8): CTRL installs it
   *  into ~/.ctrl/agents (no terminal/global/sudo) then re-detects. Throws on
   *  failure so the caller can surface it; success flips the driver to present. */
  installAgent: (id: string) => Promise<void>;
}

export const useActiveAgentStore = create<ActiveAgentState>()(
  persist(
    (set, get) => ({
      activeAgentId: DEFAULT_AGENT_ID,
      drivers: FALLBACK_DRIVERS,
      loaded: false,
      setActiveAgent: (id) => set({ activeAgentId: id }),
      loadDrivers: async () => {
        try {
          const drivers = await invoke<ByoDriver[]>('list_byo_drivers');
          // If the persisted active driver is no longer present (e.g. the user
          // uninstalled Codex), fall back to the embedded default so the chat
          // never points at a vanished engine.
          const active = get().activeAgentId;
          const stillThere = drivers.some((d) => d.id === active && d.present);
          set({
            drivers,
            loaded: true,
            activeAgentId: stillThere ? active : DEFAULT_AGENT_ID,
          });
        } catch {
          // Degrade to just the embedded default if the command is unavailable
          // (e.g. browser/PWA dev with no Tauri bridge).
          set({ drivers: FALLBACK_DRIVERS, loaded: true, activeAgentId: DEFAULT_AGENT_ID });
        }
      },
      installAgent: async (id) => {
        await invoke('install_byo_agent', { id });
        await get().loadDrivers();
      },
    }),
    {
      name: 'ctrl:active-agent:v1',
      // Only the user's choice is durable; the detected driver list is
      // re-fetched from the kernel each session (presence can change).
      partialize: (s) => ({ activeAgentId: s.activeAgentId }),
    },
  ),
);

/** Resolve the active driver descriptor (falls back to a synthetic hermes). */
export function activeDriver(s: Pick<ActiveAgentState, 'activeAgentId' | 'drivers'>): ByoDriver {
  return (
    s.drivers.find((d) => d.id === s.activeAgentId) ?? {
      id: DEFAULT_AGENT_ID,
      label: 'Irisy (hermes)',
      kind: 'embedded',
      present: true,
      detail: 'In-app brain.',
    }
  );
}

/**
 * Load the driver list once on mount + expose the active selection. Shared by
 * the Settings card and the in-chat selector so both stay in lockstep.
 */
export function useByoDrivers(): {
  drivers: ByoDriver[];
  loaded: boolean;
  activeId: string;
  active: ByoDriver;
  setActive: (id: string) => void;
} {
  const { drivers, loaded, activeAgentId, setActiveAgent, loadDrivers } =
    useActiveAgentStore();
  useEffect(() => {
    if (!loaded) void loadDrivers();
  }, [loaded, loadDrivers]);
  return {
    drivers,
    loaded,
    activeId: activeAgentId,
    active: activeDriver({ activeAgentId, drivers }),
    setActive: setActiveAgent,
  };
}
