// Dev-environment variables — local development config (API keys, tokens,
// endpoints) the user sets in Settings → Env. Stored in the OS keychain (never
// plain text, per `.kiro/steering/development-philosophy.md` Hard Rules) and
// injected into the Coding terminal so a CLI like Claude Code picks up ANTHROPIC_API_KEY /
// ANTHROPIC_BASE_URL without the user pasting secrets into the shell.
//
// Storage convention (keychain has no enumeration): each var is one entry
// `env:<NAME>` = value, plus an index entry `env:__index__` = JSON array of
// names so the Settings page and the injector can list them.

import { storeKey, getKey, deleteKey, listMcps } from './kernel';
import { invoke } from './bridge';
import { packSecretFields } from './feature-pack';

const ENV_PREFIX = 'env:';
const ENV_INDEX = 'env:__index__';

/** Common dev vars surfaced as one-tap suggestions on the Env page. */
export const ENV_PRESETS: ReadonlyArray<{ name: string; hint: string }> = [
  { name: 'ANTHROPIC_API_KEY', hint: 'Claude Code / Anthropic API key' },
  { name: 'ANTHROPIC_BASE_URL', hint: 'Custom / proxy endpoint (common in China)' },
  { name: 'OPENAI_API_KEY', hint: 'OpenAI API key' },
];

/** Reject names that aren't valid shell env identifiers. */
export function isValidEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export async function listEnvNames(): Promise<string[]> {
  const raw = await getKey(ENV_INDEX);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(names: string[]): Promise<void> {
  const unique = [...new Set(names)].sort();
  await storeKey(ENV_INDEX, JSON.stringify(unique));
}

export async function setEnvVar(name: string, value: string): Promise<void> {
  if (!isValidEnvName(name)) throw new Error(`invalid env name: ${name}`);
  await storeKey(ENV_PREFIX + name, value);
  const names = await listEnvNames();
  if (!names.includes(name)) await writeIndex([...names, name]);
}

export async function getEnvVar(name: string): Promise<string | null> {
  return getKey(ENV_PREFIX + name);
}

export async function removeEnvVar(name: string): Promise<void> {
  await deleteKey(ENV_PREFIX + name);
  const names = await listEnvNames();
  await writeIndex(names.filter((n) => n !== name));
}

/** Full {NAME: value} map for injecting into a subprocess (Coding terminal). */
export async function loadEnvMap(): Promise<Record<string, string>> {
  const names = await listEnvNames();
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = await getEnvVar(name);
    if (value != null && value.length > 0) out[name] = value;
  }
  return out;
}

/** Page view: name + whether a value is set. Secret values are NOT returned
 *  for rendering — the page masks them and only writes on an explicit save. */
export interface EnvEntryView {
  name: string;
  hasValue: boolean;
}

export async function listEnvEntries(): Promise<EnvEntryView[]> {
  const names = await listEnvNames();
  const out: EnvEntryView[] = [];
  for (const name of names) {
    const value = await getEnvVar(name);
    out.push({ name, hasValue: value != null && value.length > 0 });
  }
  return out;
}

// ── MCP credentials — the OTHER kind of dev-env secret ─────────────────────
//
// Every installed mcp declares its own secret fields in its manifest
// (config_schema.fields with kind: secret), stored at `mcp:<id>:<field>`. This
// scales to any number of mcps with zero hardcoding: we read the fields the
// installed mcps actually declare, never a fixed per-mcp list. The Env page
// renders these alongside the free-form env vars so all dev secrets live in
// one place.

export interface McpCredField {
  mcpId: string;
  mcpName: string;
  fieldKey: string;
  /** keychain account = `mcp:<id>:<field>` */
  account: string;
  label: string;
  description?: string;
  hasValue: boolean;
}

export async function loadMcpCredentials(): Promise<McpCredField[]> {
  const summaries = await listMcps();
  const out: McpCredField[] = [];
  for (const s of summaries) {
    let manifest: Record<string, unknown>;
    try {
      manifest = await invoke<Record<string, unknown>>('read_mcp_manifest', {
        args: { mcp_id: s.id },
      });
    } catch {
      continue; // unreadable manifest — never break the list
    }
    for (const f of packSecretFields(manifest)) {
      const account = `mcp:${s.id}:${f.key}`;
      const value = await getKey(account);
      out.push({
        mcpId: s.id,
        mcpName: s.name ?? s.id,
        fieldKey: f.key,
        account,
        label: f.label,
        description: f.description,
        hasValue: value != null && value.length > 0,
      });
    }
  }
  return out;
}

export async function setMcpCredential(account: string, value: string): Promise<void> {
  await storeKey(account, value);
}

export async function clearMcpCredential(account: string): Promise<void> {
  await deleteKey(account);
}
