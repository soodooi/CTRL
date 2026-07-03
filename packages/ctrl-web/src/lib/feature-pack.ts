// Feature packs at runtime — installed mcps whose manifest declares actions.
// Loads them into FeaturePack shape for the sidebar + scene panel, and runs
// an action through the kernel run_action path (real execution).
// ADR-002 substrate § composition v21 §7.1.

// ADR-003 frontend §1 (PWA bridge): invoke via ./bridge so web/PWA mode
// degrades to the WS transport instead of bypassing it through the raw
// Tauri core import (desktop behavior unchanged).
import { invoke } from './bridge';
import { listMcps, gateInvoke, describeSource, querySource } from './kernel';
import type { FeaturePack } from '@/components/featurepack/FeaturePackScene';
import type { SourceData } from '@/components/featurepack/SourceDataView';

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
  /** Dedicated knowledge base = vault subpath the pack's data lives in. */
  knowledge_base?: string;
  /** §14 record_source (ADR-002 §14.12) → the scene leads with the pack's
   *  records. Presence is all the frontend needs; the shape lives kernel-side. */
  record_source?: unknown;
  /** Domain grouping (e.g. "stocks") — same-category packs surface together. */
  category?: string;
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
      // A feature pack = declares ANY capability surface: actions (shell
      // steps), a `server` (mcp-server variant — its tools ARE the surface),
      // or a §14 record_source. Tools-only packs (Irisy-written services) must
      // show WITHOUT a fake action (bao 2026-07-03: no hardcoded workarounds).
      const hasAction = Array.isArray(m.actions) && m.actions.length > 0;
      const hasServer = (m as { server?: unknown }).server != null;
      const hasRecordSource = m.record_source != null;
      if (!hasAction && !hasServer && !hasRecordSource) continue;
      packs.push({
        id: s.id,
        name: m.name ?? s.name,
        icon: typeof s.icon === 'string' && s.icon ? s.icon : '⚡',
        summary: m.description?.short,
        actions: (m.actions ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
        })),
        // Generic: ANY pack that declares knowledge_base gets a dedicated kb —
        // no per-pack code (bao 2026-06-25: systematic, not edit-per-pack).
        kbDir: m.knowledge_base,
        category: m.category,
        // Generic: ANY pack declaring config_schema gets a Configure wizard.
        configFields: packConfigFields(m as unknown as Record<string, unknown>),
        // Declares a service to bring up and/or bootstrap auth → one-click
        // "Set up" (silent provision) instead of a manual wizard.
        needsProvision: manifestNeedsProvision(m as unknown as Record<string, unknown>),
        // Generic: ANY pack declaring a §14 record_source leads with its records
        // (product-grade data table) — no per-pack code (ADR-002 §14.12).
        hasRecords: m.record_source != null,
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

/** Load a pack's §14 records for the product-grade data view (ADR-002 §14.12):
 *  describe (fields) + query (rows) through the same :17873 gate an external
 *  agent uses. Generic — works for any pack that declares a record_source. */
export async function loadPackRecords(sourceId: string): Promise<SourceData> {
  const [describe, result] = await Promise.all([
    describeSource(sourceId),
    querySource(sourceId, {}),
  ]);
  return { fields: describe.fields, rows: result.rows, matchCount: result.match_count };
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
  /** Full manifest installed via install_mcp. Empty for browse-only entries. */
  manifest: Record<string, unknown>;
  /** 'pack' (default) = an installable CTRL feature pack. 'remote' = a remote
   *  MCP server from the registry — browsable/openable, but running it as a
   *  pack needs the remote-MCP runtime (not wired), so it is not installed
   *  here (ADR-002 § composition §7.4). */
  kind?: 'pack' | 'remote';
  /** For kind 'remote': the server's endpoint / repo to open. */
  remoteUrl?: string;
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

/** One field a pack asks the user to fill post-install (config_schema). */
export interface PackConfigField {
  key: string;
  /** ConfigFieldKind — `secret` renders masked; `url`/`string`/… render text. */
  kind: string;
  label: string;
  description?: string;
  required: boolean;
}

/** ALL config fields a pack declares (not only secrets) — the config wizard
 *  walks these; every value is stored under `mcp:<id>:<key>`, where the kernel
 *  resolves a pack's creds (e.g. resolve_ghostfolio_creds reads url + token). */
export function packConfigFields(manifest: Record<string, unknown>): PackConfigField[] {
  const cs = manifest.config_schema as
    | {
        fields?: {
          key: string;
          kind: string;
          label: string;
          description?: string;
          required?: boolean;
        }[];
      }
    | undefined;
  if (!cs?.fields) return [];
  return cs.fields.map((f) => ({
    key: f.key,
    kind: f.kind,
    label: f.label,
    description: f.description,
    required: f.required ?? true,
  }));
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

/** True when the pack declares a service to bring up or a bootstrap auth — i.e.
 *  it can be set up one-click + silently (provision engine) rather than via the
 *  manual config wizard. */
export function manifestNeedsProvision(manifest: Record<string, unknown>): boolean {
  const provision = manifest.provision as { service?: unknown } | undefined;
  const auth = manifest.auth as { bootstrap?: unknown; oauth?: unknown } | undefined;
  return Boolean(provision?.service || auth?.bootstrap || auth?.oauth);
}

/** One-click, silent setup of an installed pack: run the generic provision+auth
 *  engine (bring up its service + bootstrap auth) via the :17873 gate. */
export function provisionPack(mcpId: string): Promise<string> {
  return gateInvoke('mcp_pack_provision', { mcp_id: mcpId });
}

/** A scaffolded record_source draft + spec-repair notes (from mcp_pack_scaffold). */
export interface OpenApiScaffold {
  record_source: Record<string, unknown>;
  notes: string[];
}

/** Draft a §14 record_source from an OpenAPI operation (AutoMCP, §7.4). The draft
 *  is best-effort — refine it, then evals, before install. */
export function scaffoldFromOpenApi(
  openapi: unknown,
  path: string,
  method = 'GET',
): Promise<OpenApiScaffold> {
  return gateInvoke('mcp_pack_scaffold', { openapi, path, method });
}

/** The reference a registry returns after publishing (what a peer discovers). */
export interface PackPublishRef {
  id: string;
  namespace?: string;
  url?: string;
}

/** Publish an installed pack to a registry/commons (share-and-be-shared, §7.6).
 *  The gate evals it first (a broken pack is rejected, not published). */
export function publishPack(mcpId: string, registry?: string): Promise<PackPublishRef> {
  return gateInvoke('mcp_pack_publish', { mcp_id: mcpId, registry });
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
