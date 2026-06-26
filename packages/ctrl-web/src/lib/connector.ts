// Connector runtime — local-simple tier (spec §0.5).
//
// Connect any local system (CRM / ERP / internal API) by config, not code:
// a manifest declares base_url + one keychain-stored key + endpoint->tool
// map + render hint. This runtime turns each tool into a real HTTP call and
// returns { result, render } for the morphing surface (ADR-003 §8) to
// render as a table / record part. No OAuth for local — that's remote-only.
//
// Prototype storage: connectors live in localStorage (key ctrl:connectors)
// for now; the kernel-side ~/.ctrl/connectors/ runtime is the production
// home. Auth key resolves from a keychain ref via the kernel; for the
// browser prototype it falls back to a localStorage-held key.
//
// bao 2026-06-11: local connection simplified — minimal, working features.

// ADR-003 frontend §1 (PWA bridge): invoke via ./bridge so web/PWA mode
// degrades to the WS transport instead of bypassing it (desktop unchanged).
import { invoke } from './bridge';

export type RenderKind = 'table' | 'record' | 'json' | 'markdown' | 'text';

export interface ConnectorTool {
  name: string;
  title?: string;
  description?: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string; // may contain {param} placeholders
  params?: Array<{ name: string; in?: 'query' | 'path'; required?: boolean; default?: unknown }>;
  result_path?: string; // dot-path into the response JSON
  render: RenderKind;
  read_only?: boolean; // default false -> gated write
  /** Demo fixture returned instead of a real call (prototype/offline). */
  mock?: unknown;
}

export interface ConnectorManifest {
  id: string;
  title: string;
  base_url: string;
  auth?: { type: 'none' | 'bearer' | 'apikey'; key_ref?: string; header?: string };
  tools: ConnectorTool[];
  /** When true, serve `tool.mock` instead of hitting base_url (offline demo). */
  use_mock?: boolean;
}

export interface ToolResult {
  result: unknown;
  render: RenderKind;
  tool: string;
  connector: string;
}

const LS_KEY = 'ctrl:connectors';

/** Load installed connectors (localStorage prototype + bundled defaults). */
export function loadConnectors(): ConnectorManifest[] {
  const bundled = BUNDLED_CONNECTORS;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return bundled;
    const user = JSON.parse(raw) as ConnectorManifest[];
    const byId = new Map<string, ConnectorManifest>();
    for (const c of [...bundled, ...user]) byId.set(c.id, c);
    return [...byId.values()];
  } catch {
    return bundled;
  }
}

export function saveConnector(manifest: ConnectorManifest): void {
  const existing = (() => {
    try {
      return JSON.parse(window.localStorage.getItem(LS_KEY) ?? '[]') as ConnectorManifest[];
    } catch {
      return [] as ConnectorManifest[];
    }
  })();
  const next = existing.filter((c) => c.id !== manifest.id).concat(manifest);
  window.localStorage.setItem(LS_KEY, JSON.stringify(next));
}

// ── share & be shared: DEFINITIONS travel, data/keys never do ─────────
// (ADR-006 §5) A tool definition is the manifest with all auth secrets and
// fixtures stripped — it already only holds a keychain key_ref, never a key
// or any user data. The receiver installs the definition and supplies their
// OWN key + data. Like sharing a recipe, not the meal.

/** Strip everything user-specific (mock data, key_ref) — share only the
 *  shape: id / title / base_url / auth type / endpoint->tool map / render. */
export function exportConnector(manifest: ConnectorManifest): string {
  const clean: ConnectorManifest = {
    ...manifest,
    use_mock: false,
    auth: manifest.auth
      ? { type: manifest.auth.type, header: manifest.auth.header } // drop key_ref
      : undefined,
    tools: manifest.tools.map(({ mock: _mock, ...t }) => t),
  };
  return JSON.stringify(clean, null, 2);
}

/** Install a shared definition (be-shared). Validates the shape, then it
 *  appears in "Your tools" — the user wires their own key + base_url. */
export function importConnector(json: string): ConnectorManifest {
  const m = JSON.parse(json) as ConnectorManifest;
  if (!m.id || !m.title || !Array.isArray(m.tools)) {
    throw new Error('not a valid CTRL tool definition');
  }
  saveConnector(m);
  return m;
}

/** Resolve the auth key. Kernel keychain first (Tauri), else a local fallback. */
async function resolveKey(manifest: ConnectorManifest): Promise<string | null> {
  const ref = manifest.auth?.key_ref;
  if (!ref) return null;
  try {
    const key = await invoke<string>('keychain_get', { ref });
    if (key) return key;
  } catch {
    // not in Tauri / no kernel — fall back to a local dev key
  }
  return window.localStorage.getItem(`ctrl:connkey:${manifest.id}`);
}

function dotGet(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[k];
    return undefined;
  }, obj);
}

/** Invoke a connector tool — the working local-simple call (spec §0.5). */
export async function invokeConnectorTool(
  manifest: ConnectorManifest,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const tool = manifest.tools.find((t) => t.name === toolName);
  if (!tool) throw new Error(`tool not found: ${toolName}`);

  // Offline / demo: serve the fixture.
  if (manifest.use_mock && tool.mock !== undefined) {
    return {
      result: dotGet(tool.mock, undefined),
      render: tool.render,
      tool: tool.name,
      connector: manifest.id,
    };
  }

  // Build path (bind {param}) + query string.
  let path = tool.path;
  const query = new URLSearchParams();
  for (const p of tool.params ?? []) {
    const v = args[p.name] ?? p.default;
    if (v === undefined) continue;
    if (path.includes(`{${p.name}}`)) {
      path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
    } else if (p.in !== 'path') {
      query.set(p.name, String(v));
    }
  }
  const qs = query.toString();
  const url = `${manifest.base_url}${path}${qs ? `?${qs}` : ''}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (manifest.auth && manifest.auth.type !== 'none') {
    const key = await resolveKey(manifest);
    if (key) {
      const headerName = manifest.auth.header ?? 'Authorization';
      headers[headerName] = manifest.auth.type === 'bearer' ? `Bearer ${key}` : key;
    }
  }

  const res = await fetch(url, {
    method: tool.method,
    headers: tool.method === 'GET' ? headers : { ...headers, 'Content-Type': 'application/json' },
    body: tool.method === 'GET' ? undefined : JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`${manifest.title} ${tool.name}: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as unknown;
  return {
    result: dotGet(json, tool.result_path),
    render: tool.render,
    tool: tool.name,
    connector: manifest.id,
  };
}

// CTRL ships with NO bundled business connectors (bao 2026-06-11). CTRL does
// not embed a CRM or any business tool — embedding `iris-crm` was a violation
// of CTRL's own rule ("don't build a CRM") and of the positioning (the user
// searches / installs / configures their own connectors; CTRL is the access
// layer, not a bundled product). The user installs connectors themselves from
// Discover (share-and-be-shared). Empty by default.
const BUNDLED_CONNECTORS: ConnectorManifest[] = [];
