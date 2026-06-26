// Create a feature pack from a natural-language description (the "create one"
// flow, ADR-002 substrate § composition v21 §7.3). Irisy/the LLM drafts a pack
// manifest from one sentence; the user reviews and installs. No JSON by hand.

import { irisyChatTransport, type LLMMessage } from './llm-transport';

export interface DraftSecret {
  /** Lowercase + underscore key — the keychain field + the env-var source. */
  key: string;
  /** Human label shown when the user fills it in after install. */
  label: string;
}

export interface DraftPack {
  name: string;
  icon: string;
  summary: string;
  actions: { id: string; name: string; command: string }[];
  /** Secrets the pack needs (API key / token / the URL of the user's OWN
   *  self-hosted service). Each becomes a config_schema secret field +
   *  a provision.env var (ADR-002 § composition §7.2). Optional. */
  secrets?: DraftSecret[];
  /** Dedicated knowledge base = a vault subpath this pack's data lives in
   *  (ADR-002 § composition §7.4). Data-backed packs only; optional. */
  knowledge_base?: string;
}

const genPrompt = (desc: string): string =>
  `You generate a CTRL "feature pack" for a local AI workbench. The user wants: "${desc}".
Reply with ONLY a JSON object — no prose, no markdown fence:
{"name":"short name","icon":"one emoji","summary":"one line","secrets":[{"key":"service_token","label":"API Token"}],"knowledge_base":"Stocks","actions":[{"id":"kebab-id","name":"Button Label","command":"a shell command"}]}
Rules:
- 2 to 4 actions; macOS or Linux shell; concrete and useful.
- Commands are READ-ONLY: never rm / sudo / write / move / delete files.
- Secrets (API key, token, or the URL of the user's OWN self-hosted service): list them in "secrets" with a lowercase_underscore key + a human label. A secret with key "foo_bar" is available to commands as the env var $FOO_BAR. NEVER hardcode a key, token, or host in a command — reference its env var. Omit "secrets" when none are needed.
- Network: only call a host supplied via a secret URL env var (the user's own service). Never call a hardcoded external host.
- knowledge_base: if the pack tracks the user's own data (a portfolio, a reading list…), set it to a short vault folder name like "Stocks". Omit for pure tool/utility packs.`;

/** Stream the LLM, extract the JSON object, validate the shape. */
export async function generatePack(desc: string): Promise<DraftPack> {
  const messages: LLMMessage[] = [{ role: 'user', content: genPrompt(desc) }];
  let acc = '';
  for await (const chunk of irisyChatTransport().stream(messages)) {
    acc += typeof chunk === 'string' ? chunk : (chunk?.delta ?? '');
  }
  const start = acc.indexOf('{');
  const end = acc.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('No model is set up, or it returned no pack. Set a model in Settings → Providers and try again.');
  }
  const draft = JSON.parse(acc.slice(start, end + 1)) as DraftPack;
  if (!draft.name || !Array.isArray(draft.actions) || draft.actions.length === 0) {
    throw new Error('The draft was incomplete — try rephrasing.');
  }
  return draft;
}

/** Config keys must be lowercase + underscore (ConfigField Zod regex); env
 *  vars are the uppercase form. Keeping both derivations here means a
 *  creator-generated secret always lands as a valid, run-resolvable pair. */
const sanitizeSecretKey = (k: string): string =>
  k.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'secret';

/** Project a draft into a full v2 mcp manifest installable via install_mcp.
 *  Systematic fields (config_schema secrets / provision.env / knowledge_base)
 *  appear only when the draft declares them — a plain tool pack stays minimal
 *  (ADR-002 § composition §7.4: manifest = data, zero code per pack). */
export function draftToManifest(draft: DraftPack): Record<string, unknown> {
  const id =
    draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pack';
  const secrets = (draft.secrets ?? []).map((s) => ({ ...s, key: sanitizeSecretKey(s.key) }));
  return {
    manifest_version: 2,
    id,
    name: draft.name,
    version: '1.0.0',
    author: { name: 'You (via Irisy)' },
    description: { short: draft.summary },
    icon: draft.icon || '✨',
    mcp_color: 'graphite',
    variant: 'builtin',
    // Dedicated KB (data, not code) — generic manifest field; the assistant
    // scopes retrieval here when the pack is open.
    ...(draft.knowledge_base ? { knowledge_base: draft.knowledge_base } : {}),
    // Secrets → config_schema (keychain) + provision.env. {{secret:<key>}} is
    // resolved kernel-side at run time and never reaches the LLM (decision 0004);
    // the command reads it as the uppercase env var.
    ...(secrets.length > 0
      ? {
          config_schema: {
            fields: secrets.map((s) => ({
              key: s.key,
              kind: 'secret',
              label: s.label,
              required: true,
            })),
          },
          provision: {
            tools: [],
            env: Object.fromEntries(
              secrets.map((s) => [s.key.toUpperCase(), `{{secret:${s.key}}}`]),
            ),
          },
        }
      : {}),
    actions: draft.actions.map((a) => ({
      id: a.id,
      name: a.name,
      input: 'none',
      output: 'workspace',
      steps: [{ type: 'shell', command: a.command }],
    })),
  };
}
