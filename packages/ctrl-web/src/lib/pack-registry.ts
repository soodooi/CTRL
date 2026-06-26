// Discover registry data source (ADR-002 substrate § composition §7.4): pull
// browsable listings from the MCP Registry so Discover is no longer a hardcoded
// list. The kernel fetches (CSP blocks PWA external fetch); this module maps the
// raw response to listings and merges them with the bundled set.
//
// Registry entries are REMOTE MCP servers (streamable-http endpoints). CTRL can
// browse + open them, but running one as a pack needs the remote-MCP runtime
// (a source variant + connection layer not wired yet), so they are kind
// 'remote' — listed and openable, not installed.

import { invoke } from '@tauri-apps/api/core';
import { OFFICIAL_PACKS, type PackListing } from './feature-pack';

interface RegistryRemote {
  type?: string;
  url?: string;
}
interface RegistryServer {
  name?: string;
  title?: string;
  description?: string;
  version?: string;
  remotes?: RegistryRemote[];
}
interface RegistryEntry {
  server?: RegistryServer;
  _meta?: Record<string, { isLatest?: boolean; status?: string } | undefined>;
}
interface RegistryResponse {
  servers?: RegistryEntry[];
}

/** Manifest id charset is `[a-z0-9.\-_]`; map anything else (e.g. the `/` in
 *  `io.github.owner/name`) to a dash. */
function sanitizeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, '-').replace(/^-|-$/g, '') || 'mcp-server';
}

function isLatest(entry: RegistryEntry): boolean {
  return Object.values(entry._meta ?? {}).some((m) => m?.isLatest === true);
}

/** Map a raw MCP Registry response (the official 2025-12 shape:
 *  `{ servers: [{ server: {...}, _meta: {...} }] }`) to browsable Discover
 *  listings. Pure + defensive (the schema evolves); one entry per server id,
 *  preferring the version flagged latest. Unit-tested without network. */
export function mapRegistryServers(rawJson: string): PackListing[] {
  let parsed: RegistryResponse;
  try {
    parsed = JSON.parse(rawJson) as RegistryResponse;
  } catch {
    return [];
  }
  const byId = new Map<string, PackListing>();
  for (const entry of parsed.servers ?? []) {
    const s = entry.server;
    if (!s?.name) continue;
    const id = sanitizeId(s.name);
    // A non-latest version never overwrites an entry we already have.
    if (byId.has(id) && !isLatest(entry)) continue;
    byId.set(id, {
      id,
      name: s.title || s.name.split('/').pop() || s.name,
      icon: '🧩',
      summary: s.description ?? s.name,
      category: 'MCP Registry',
      kind: 'remote',
      remoteUrl: s.remotes?.find((r) => r.url)?.url,
      manifest: {},
    });
  }
  return [...byId.values()];
}

/** Fetch + map registry listings via the kernel. Degrades to [] when offline,
 *  the registry is down, or the running binary lacks the command. */
export async function fetchRegistryListings(limit = 50): Promise<PackListing[]> {
  try {
    const raw = await invoke<string>('fetch_pack_registry', { args: { limit } });
    return mapRegistryServers(raw);
  } catch {
    return [];
  }
}

/** Discover's listings = bundled packs (installable) first, then registry
 *  servers (browsable), de-duplicated against bundled ids. */
export async function loadDiscoverListings(): Promise<PackListing[]> {
  const registry = await fetchRegistryListings();
  const bundledIds = new Set(OFFICIAL_PACKS.map((p) => p.id));
  return [...OFFICIAL_PACKS, ...registry.filter((r) => !bundledIds.has(r.id))];
}
