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
