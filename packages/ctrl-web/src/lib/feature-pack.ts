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
  category: string;
  installs?: string;
  rating?: string;
  /** Full manifest installed via install_mcp. */
  manifest: Record<string, unknown>;
}

// Manifest factory — keeps the bundled catalog terse.
const shellAction = (id: string, name: string, command: string): Record<string, unknown> => ({
  id,
  name,
  input: 'none',
  output: 'workspace',
  steps: [{ type: 'shell', command }],
});
const packManifest = (
  id: string,
  name: string,
  icon: string,
  short: string,
  actions: Record<string, unknown>[],
): Record<string, unknown> => ({
  manifest_version: 2,
  id,
  name,
  version: '1.0.0',
  author: { name: 'CTRL' },
  description: { short },
  icon,
  mcp_color: 'graphite',
  variant: 'builtin',
  actions,
});

/** Official feature packs installable in one click from Discover. A real
 *  registry / .mcpb listings come later; this is the bundled set. */
export const OFFICIAL_PACKS: PackListing[] = [
  {
    id: 'ghostfolio', name: 'Ghostfolio', icon: '📈', category: 'Finance',
    summary: 'Your self-hosted Ghostfolio portfolio — holdings & performance',
    installs: '—', rating: '—',
    // Seed Finance pack for the Stocks role (bao 2026-06-25). Talks to the
    // user's OWN self-hosted Ghostfolio instance (data sovereignty — CTRL is
    // never in the data path). Uses the public-portfolio endpoint so no Bearer
    // exchange is needed: the URL + public access id go through the keychain
    // (secret substitution is the only env-injection path the provision runner
    // supports). Opening this pack switches Irisy to the Stocks role.
    manifest: {
      manifest_version: 2, id: 'ghostfolio', name: 'Ghostfolio', version: '1.0.0',
      author: { name: 'CTRL' }, description: { short: 'Self-hosted portfolio tracker' },
      icon: '📈', mcp_color: 'jade', variant: 'builtin',
      config_schema: {
        fields: [
          {
            key: 'ghostfolio_url', kind: 'secret', label: 'Ghostfolio URL',
            description: 'Your instance, e.g. http://localhost:3333', required: true,
          },
          {
            key: 'ghostfolio_access_id', kind: 'secret', label: 'Public Access ID',
            description: 'Ghostfolio Settings -> grant public access -> copy the id', required: true,
          },
        ],
      },
      provision: {
        tools: [],
        env: {
          GHOSTFOLIO_URL: '{{secret:ghostfolio_url}}',
          GHOSTFOLIO_ACCESS_ID: '{{secret:ghostfolio_access_id}}',
        },
      },
      actions: [
        {
          id: 'portfolio', name: 'Portfolio', input: 'none', output: 'workspace',
          steps: [{
            type: 'shell',
            command: 'curl -s "${GHOSTFOLIO_URL}/api/v1/public/${GHOSTFOLIO_ACCESS_ID}/portfolio"',
          }],
        },
        {
          id: 'performance', name: 'Performance', input: 'none', output: 'workspace',
          steps: [{
            type: 'shell',
            command: 'curl -s "${GHOSTFOLIO_URL}/api/v1/public/${GHOSTFOLIO_ACCESS_ID}/portfolio" | head -c 6000',
          }],
        },
      ],
    },
  },
  {
    id: 'cf-workers', name: 'CF Workers', icon: '⚡', category: 'Dev',
    summary: 'Deploy Cloudflare Workers — needs your CF API token',
    installs: '2.4k', rating: '4.8',
    manifest: {
      manifest_version: 2, id: 'cf-workers', name: 'CF Workers', version: '1.0.0',
      author: { name: 'CTRL' }, description: { short: 'Deploy Cloudflare Workers' },
      icon: '⚡', mcp_color: 'graphite', variant: 'builtin',
      config_schema: {
        fields: [{
          key: 'cf_api_token', kind: 'secret', label: 'Cloudflare API Token',
          description: 'Get it at dash.cloudflare.com/profile/api-tokens', required: true,
        }],
      },
      provision: { tools: [], env: { CLOUDFLARE_API_TOKEN: '{{secret:cf_api_token}}' } },
      actions: [{
        id: 'check', name: 'Check token', input: 'none', output: 'workspace',
        steps: [{ type: 'shell', command: 'echo "Cloudflare token: ${CLOUDFLARE_API_TOKEN:+configured}"' }],
      }],
    },
  },
  {
    id: 'dev-box', name: 'Dev Box', icon: '🧰', category: 'Dev',
    summary: 'Local dev shortcuts — node / system / date',
    installs: '1.1k', rating: '4.6',
    manifest: packManifest('dev-box', 'Dev Box', '🧰', 'Local dev shortcuts', [
      shellAction('node', 'Node version', 'node --version'),
      shellAction('sys', 'System', 'uname -a'),
      shellAction('date', 'Date', 'date'),
    ]),
  },
  {
    id: 'git-box', name: 'Git Box', icon: '🔀', category: 'Dev',
    summary: 'Git status / recent commits / branches',
    installs: '840', rating: '4.5',
    manifest: packManifest('git-box', 'Git Box', '🔀', 'Git shortcuts', [
      shellAction('status', 'Status', 'git status --short'),
      shellAction('log', 'Recent commits', 'git log --oneline -10'),
      shellAction('branch', 'Branches', 'git branch -a'),
    ]),
  },
  {
    id: 'disk-box', name: 'Disk Box', icon: '💾', category: 'System',
    summary: 'Disk / memory / CPU at a glance',
    installs: '610', rating: '4.4',
    manifest: packManifest('disk-box', 'Disk Box', '💾', 'System resources', [
      shellAction('disk', 'Disk usage', 'df -h'),
      shellAction('mem', 'Memory', 'vm_stat'),
      shellAction('cpu', 'CPU', 'sysctl -n machdep.cpu.brand_string'),
    ]),
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

/** Uninstall a feature pack (removes ~/.ctrl/mcps/<id>); signals the sidebar. */
export async function uninstallPack(packId: string): Promise<void> {
  await invoke('uninstall_mcp', { args: { mcp_id: packId } });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PACKS_CHANGED_EVENT));
  }
}

export interface SecretField {
  key: string;
  label: string;
  description?: string;
}

/** Secret fields a pack declares (config_schema fields with kind: secret). */
export function packSecretFields(manifest: Record<string, unknown>): SecretField[] {
  const cs = manifest.config_schema as
    | { fields?: { key: string; kind: string; label: string; description?: string }[] }
    | undefined;
  if (!cs?.fields) return [];
  return cs.fields
    .filter((f) => f.kind === 'secret')
    .map((f) => ({ key: f.key, label: f.label, description: f.description }));
}

/** Store a pack secret in the keychain (account namespaced per the provision
 *  runner: mcp:<id>:<field>); the value never touches the LLM (decision 0004). */
export async function storePackSecret(
  mcpId: string,
  fieldKey: string,
  value: string,
): Promise<void> {
  await invoke('store_key', { account: `mcp:${mcpId}:${fieldKey}`, value });
}
