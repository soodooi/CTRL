// Block AI ops — selection-driven inline rewrite primitives.
//
// (ADR-002 substrate v5 §10 + product spec §5.2 / P2 / P7, 2026-06-03 —
// brainstorm `vault/ctrl/history/brainstorm/vault-irisy-product-design-2026-06-03.md`.)
//
// 6 named actions plus a free-form "custom" path. Each action maps to a
// system prompt that Pi (provider router default) executes against the
// selected text. Streaming via the existing irisyChatTransport so the
// chain stays "Irisy is the brain everywhere" per ADR-005.

import { irisyChatTransport, type LLMMessage } from './llm-transport';

export type BlockActionId =
  | 'tighten'
  | 'formalize'
  | 'extract-actions'
  | 'translate'
  | 'continue'
  | 'custom';

export interface BlockAction {
  id: BlockActionId;
  label: string;
  description: string;
  /** When `requiresInput` is true, the UI prompts for an extra string
   *  (e.g. target language for translate, free-form for custom). */
  requiresInput: boolean;
  /** Optional placeholder for the input field. */
  inputPlaceholder?: string;
}

export const BLOCK_ACTIONS: ReadonlyArray<BlockAction> = [
  {
    id: 'tighten',
    label: 'Tighten',
    description: 'Cut filler, keep meaning. Half the words ideally.',
    requiresInput: false,
  },
  {
    id: 'formalize',
    label: 'Formalize',
    description: 'Rewrite for a formal tone without losing nuance.',
    requiresInput: false,
  },
  {
    id: 'extract-actions',
    label: 'Extract action items',
    description: 'Pull out concrete TODOs as a markdown list.',
    requiresInput: false,
  },
  {
    id: 'translate',
    label: 'Translate',
    description: 'Translate into the target language.',
    requiresInput: true,
    inputPlaceholder: 'Target language (e.g. English, Chinese, Japanese)',
  },
  {
    id: 'continue',
    label: 'Continue writing',
    description: 'Continue the thought in the same voice.',
    requiresInput: false,
  },
  {
    id: 'custom',
    label: 'Custom…',
    description: 'Free-form instruction.',
    requiresInput: true,
    inputPlaceholder: 'What should Irisy do with this selection?',
  },
];

const BASE_SYSTEM = `You are Irisy, the AI companion built into CTRL. You are running a block-level rewrite operation on a piece of the user's note. Output ONLY the rewritten text — no preamble, no commentary, no surrounding quotes. Preserve the user's voice and meaning unless the operation specifically asks otherwise. If the input is in Chinese, keep your output Chinese unless explicitly told otherwise.`;

function actionInstructions(
  action: BlockActionId,
  userInput: string | undefined,
): string {
  switch (action) {
    case 'tighten':
      return `Tighten the following text. Cut filler. Halve the word count if possible without losing meaning.`;
    case 'formalize':
      return `Rewrite the following text in a formal register while preserving meaning and nuance.`;
    case 'extract-actions':
      return `Extract concrete action items from the following text. Output ONLY a markdown list of action items, one per line, each starting with "- [ ] ".`;
    case 'translate':
      return `Translate the following text into ${userInput || 'English'}. Output only the translation.`;
    case 'continue':
      return `Continue the following text in the same voice. Output only the continuation (not a repeat of the input).`;
    case 'custom':
      return userInput || 'Improve the following text.';
  }
}

/** Run a block action, streaming tokens to the supplied callback.
 *  Returns the final full text. The caller is responsible for replacing
 *  the editor selection with the result (or discarding it). */
export async function runBlockAction(
  action: BlockActionId,
  selectedText: string,
  userInput: string | undefined,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const transport = irisyChatTransport();
  const messages: LLMMessage[] = [
    { role: 'system', content: BASE_SYSTEM },
    {
      role: 'user',
      content: `${actionInstructions(action, userInput)}\n\n---\n${selectedText}`,
    },
  ];
  let full = '';
  for await (const chunk of transport.stream(messages, { signal })) {
    if (chunk.error) {
      throw new Error(chunk.error);
    }
    if (chunk.delta) {
      full += chunk.delta;
      onChunk(chunk.delta);
    }
    if (chunk.done) break;
  }
  return full.trim();
}

/** Quick action ids that don't need an input field — used by the
 *  default "Cmd+K with selection" UX to skip the input step. */
export const ACTIONS_WITHOUT_INPUT: ReadonlyArray<BlockActionId> =
  BLOCK_ACTIONS.filter((a) => !a.requiresInput).map((a) => a.id);
