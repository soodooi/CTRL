// Create a feature pack from a natural-language description (the "create one"
// flow, ADR-002 substrate § composition v21 §7.3). Irisy/the LLM drafts a pack
// manifest from one sentence; the user reviews and installs. No JSON by hand.

import { irisyChatTransport, type LLMMessage } from './llm-transport';

export interface DraftPack {
  name: string;
  icon: string;
  summary: string;
  actions: { id: string; name: string; command: string }[];
}

const genPrompt = (desc: string): string =>
  `You generate a CTRL "feature pack" for a local AI workbench. The user wants: "${desc}".
Reply with ONLY a JSON object — no prose, no markdown fence:
{"name":"short name","icon":"one emoji","summary":"one line","actions":[{"id":"kebab-id","name":"Button Label","command":"a safe shell command"}]}
Rules: 2 to 4 actions; commands are READ-ONLY shell (never rm / sudo / write / curl to unknown hosts); macOS or Linux; keep it useful and concrete.`;

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

/** Project a draft into a full v2 mcp manifest installable via install_mcp. */
export function draftToManifest(draft: DraftPack): Record<string, unknown> {
  const id =
    draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pack';
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
    actions: draft.actions.map((a) => ({
      id: a.id,
      name: a.name,
      input: 'none',
      output: 'workspace',
      steps: [{ type: 'shell', command: a.command }],
    })),
  };
}
