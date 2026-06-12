// Feature packs at runtime — installed mcps whose manifest declares actions.
// Loads them into FeaturePack shape for the sidebar + scene panel, and runs
// an action through the kernel run_action path (real execution).
// ADR-002 substrate § composition v21 §7.1.

import { invoke } from '@tauri-apps/api/core';
import { listMcps } from './kernel';
import type { FeaturePack } from '@/components/featurepack/FeaturePackScene';

interface ManifestAction {
  id: string;
  name: string;
  description?: string;
}

interface PackManifest {
  id: string;
  name?: string;
  description?: { short?: string };
  actions?: ManifestAction[];
}

/** Installed feature packs = installed mcps whose manifest declares actions.
 *  Each becomes a FeaturePack (name + icon + summary + actions). */
export async function loadInstalledPacks(): Promise<FeaturePack[]> {
  const summaries = await listMcps();
  const packs: FeaturePack[] = [];
  for (const s of summaries) {
    try {
      const m = await invoke<PackManifest>('read_mcp_manifest', {
        args: { mcp_id: s.id },
      });
      if (!m.actions || m.actions.length === 0) continue;
      packs.push({
        id: s.id,
        name: m.name ?? s.name,
        icon: typeof s.icon === 'string' && s.icon ? s.icon : '⚡',
        summary: m.description?.short,
        actions: m.actions.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
        })),
      });
    } catch {
      // Skip an mcp whose manifest is unreadable — never break the list.
    }
  }
  return packs;
}

/** Execute a pack action via the kernel; returns the action's stdout. */
export function runInstalledPackAction(packId: string, actionId: string): Promise<string> {
  return invoke<string>('run_action', {
    args: { mcp_id: packId, action_id: actionId },
  });
}

// ── Install (the user's action — Discover one-click) ──────────────────────

/** Event the sidebar listens for to reload its installed-packs list after
 *  an install/uninstall. */
export const PACKS_CHANGED_EVENT = 'ctrl:packs-changed';

export interface PackListing {
  id: string;
  name: string;
  icon: string;
  summary: string;
  /** Full manifest installed via install_mcp. */
  manifest: Record<string, unknown>;
}

const DEV_BOX_MANIFEST: Record<string, unknown> = {
  manifest_version: 2,
  id: 'dev-box',
  name: 'Dev Box',
  version: '1.0.0',
  author: { name: 'CTRL' },
  description: { short: 'Local dev shortcuts — run common checks' },
  icon: '🧰',
  mcp_color: 'graphite',
  variant: 'builtin',
  actions: [
    { id: 'node', name: 'Node version', input: 'none', output: 'workspace', steps: [{ type: 'shell', command: 'node --version' }] },
    { id: 'sys', name: 'System', input: 'none', output: 'workspace', steps: [{ type: 'shell', command: 'uname -a' }] },
    { id: 'date', name: 'Date', input: 'none', output: 'workspace', steps: [{ type: 'shell', command: 'date' }] },
  ],
};

/** Official feature packs a user can install in one click from Discover.
 *  A real registry / .mcpb listings come later; this is the bundled set. */
export const OFFICIAL_PACKS: PackListing[] = [
  {
    id: 'dev-box',
    name: 'Dev Box',
    icon: '🧰',
    summary: 'Local dev shortcuts — run common checks (node / system / date)',
    manifest: DEV_BOX_MANIFEST,
  },
];

/** Install a feature pack from its manifest (writes to ~/.ctrl/mcps via
 *  install_mcp), then signals the sidebar to reload its pack list. */
export async function installPack(manifest: Record<string, unknown>): Promise<void> {
  await invoke('install_mcp', {
    args: { manifest, server_code: '', server_code_filename: '' },
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PACKS_CHANGED_EVENT));
  }
}
