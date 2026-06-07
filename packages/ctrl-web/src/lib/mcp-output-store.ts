// mcp-output-store — the bridge between Irisy running a mcp and the
// workspace output pane that shows the result.
//
// Per bao 2026-05-29: a mcp that needs conversation reuses Irisy's chat
// (the sidebar); the OUTPUT shows live beside it. When Irisy invokes
// run_mcp, it records the run here; McpOutputPane reads this store to
// stream live progress (mcp-<id>) and then render the produced artifact.
//
// One run at a time — the latest run wins (matches the single output pane).

import { create } from 'zustand';

interface McpOutputState {
  /** Mcp currently shown in the output pane (null = nothing run yet). */
  mcpId: string | null;
  /** A run is in flight — the pane streams mcp-<id> live. */
  running: boolean;
  /** Vault-relative path of the produced artifact, once the run succeeds. */
  outputPath: string | null;
  /** Human-readable failure, if the run errored. */
  error: string | null;
  startRun: (mcpId: string) => void;
  finishRun: (outputPath: string | null, error?: string | null) => void;
  clear: () => void;
}

export const useMcpOutputStore = create<McpOutputState>((set) => ({
  mcpId: null,
  running: false,
  outputPath: null,
  error: null,
  startRun: (mcpId) =>
    set({ mcpId, running: true, outputPath: null, error: null }),
  finishRun: (outputPath, error = null) =>
    set({ running: false, outputPath, error }),
  clear: () => set({ mcpId: null, running: false, outputPath: null, error: null }),
}));
