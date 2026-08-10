// Coding launcher bridge. CTRL owns projection; OpenCode owns its process
// and agent loop whether run as CodingScene's embedded PTY or via the
// secondary external-launch action. The configured CTRL root and any
// installed feature-pack scope that carries opencode.json are valid
// OpenCode workspaces. (ADR-001 spine §4 v15;
// ADR-003 frontend §8.5 v31; ADR-005 irisy §8.7 v29)

import { invoke } from './bridge';

export interface CodingWorkspace {
  id: string;
  label: string;
  path: string;
  opencodeConfigPresent: boolean;
}

export interface LauncherTarget {
  id: string;
  label: string;
  available: boolean;
  supportsCommand: boolean;
}

export interface CodingLauncherStatus {
  workspaces: CodingWorkspace[];
  terminals: LauncherTarget[];
  editors: LauncherTarget[];
  opencodeAvailable: boolean;
  launchCommand: string | null;
}

export type CodingLaunchMode = 'open_code' | 'shell' | 'editor';

export interface CodingLaunchReply {
  workspace: string;
  target: string;
  mode: string;
}

export const codingLauncherStatus = (): Promise<CodingLauncherStatus> =>
  invoke<CodingLauncherStatus>('coding_launcher_status');

export const registerProjectResource = (path: string): Promise<string> =>
  invoke<string>('register_project_resource', { path });

export const launchCodingWorkspace = (args: {
  target: string;
  workspace: string;
  mode: CodingLaunchMode;
}): Promise<CodingLaunchReply> =>
  invoke<CodingLaunchReply>('launch_coding_workspace', { args });

// --- Pure selection helpers (extracted for unit testing without a Tauri/WS
// mock — CodingScene's refresh() delegates here) ---------------------------

/**
 * Keep the current workspace selection across a refresh when it still
 * exists in the new status; otherwise fall back to the first workspace
 * (the configured root, always index 0), or '' when none are known yet.
 */
export const selectWorkspaceId = (
  current: string,
  workspaces: readonly CodingWorkspace[],
): string =>
  workspaces.some((w) => w.id === current) ? current : (workspaces[0]?.id ?? '');

export interface WorkspaceReconciliation {
  nextId: string;
  requiresReset: boolean;
}

/**
 * Reconcile a refreshed workspace list without conflating first selection with
 * actor handoff. Losing a non-empty current workspace always requires an ACP
 * reset before the fallback id becomes visible. (ADR-005 irisy §11 v37)
 */
export const reconcileWorkspaceId = (
  current: string,
  workspaces: readonly CodingWorkspace[],
): WorkspaceReconciliation => {
  const nextId = selectWorkspaceId(current, workspaces);
  return {
    nextId,
    requiresReset: current !== '' && nextId !== current,
  };
};

/**
 * Keep the current terminal selection across a refresh when it is still
 * available; otherwise fall back to the first available terminal, or ''
 * when none are available.
 */
export const selectTerminalId = (
  current: string,
  terminals: readonly LauncherTarget[],
): string => {
  const currentTarget = terminals.find((t) => t.id === current);
  return currentTarget?.available ? current : (terminals.find((t) => t.available)?.id ?? '');
};
