// keycap-output-store — the bridge between Irisy running a keycap and the
// workspace output pane that shows the result.
//
// Per bao 2026-05-29: a keycap that needs conversation reuses Irisy's chat
// (the sidebar); the OUTPUT shows live beside it. When Irisy invokes
// run_keycap, it records the run here; KeycapOutputPane reads this store to
// stream live progress (keycap-<id>) and then render the produced artifact.
//
// One run at a time — the latest run wins (matches the single output pane).

import { create } from 'zustand';

interface KeycapOutputState {
  /** Keycap currently shown in the output pane (null = nothing run yet). */
  keycapId: string | null;
  /** A run is in flight — the pane streams keycap-<id> live. */
  running: boolean;
  /** Vault-relative path of the produced artifact, once the run succeeds. */
  outputPath: string | null;
  /** Human-readable failure, if the run errored. */
  error: string | null;
  startRun: (keycapId: string) => void;
  finishRun: (outputPath: string | null, error?: string | null) => void;
  clear: () => void;
}

export const useKeycapOutputStore = create<KeycapOutputState>((set) => ({
  keycapId: null,
  running: false,
  outputPath: null,
  error: null,
  startRun: (keycapId) =>
    set({ keycapId, running: true, outputPath: null, error: null }),
  finishRun: (outputPath, error = null) =>
    set({ running: false, outputPath, error }),
  clear: () => set({ keycapId: null, running: false, outputPath: null, error: null }),
}));
