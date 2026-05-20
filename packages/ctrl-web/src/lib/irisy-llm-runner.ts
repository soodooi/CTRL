// [H-2026-05-18-001] Drives LLM turns for the Irisy keycap-creator pane.
//
// Sits between the route component and the Zustand store so the route
// can stay declarative. Handles: history composition (system prompt +
// few-shots + chat), streaming, store updates, and the automatic
// <emit-manifest/> follow-up after <keycap-ready/>.

import type { IrisyFewShot } from '../personas/irisy/keycap-creator';
import type { LLMMessage, LLMTransport } from './llm-transport';
import { useKeycapCreatorStore } from './irisy-keycap-store';

export interface ChatTurnOptions {
  transport: LLMTransport;
  systemPrompt: string;
  fewShots: IrisyFewShot[];
  userText: string;
  model?: string;
  signal?: AbortSignal;
}

function composeHistory(
  systemPrompt: string,
  fewShots: IrisyFewShot[],
  chatRawTurns: { role: 'user' | 'assistant'; raw: string }[],
): LLMMessage[] {
  const out: LLMMessage[] = [{ role: 'system', content: systemPrompt }];
  for (const shot of fewShots) {
    for (const turn of shot.turns) {
      out.push({ role: turn.role, content: turn.content });
    }
  }
  for (const turn of chatRawTurns) {
    out.push({ role: turn.role, content: turn.raw });
  }
  return out;
}

async function streamOnce(opts: ChatTurnOptions): Promise<void> {
  const store = useKeycapCreatorStore.getState();
  const chatRawTurns = store.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', raw: m.raw }));

  const messages = composeHistory(opts.systemPrompt, opts.fewShots, chatRawTurns);

  const assistant = store.beginAssistantMessage();
  try {
    for await (const chunk of opts.transport.stream(messages, {
      model: opts.model,
      signal: opts.signal,
    })) {
      if (chunk.error) {
        store.appendAssistantDelta(
          assistant.id,
          `\n\n[transport error: ${chunk.error}]`,
        );
        store.finishAssistantMessage(assistant.id);
        return;
      }
      if (chunk.delta) {
        store.appendAssistantDelta(assistant.id, chunk.delta);
      }
      if (chunk.done) break;
    }
    store.finishAssistantMessage(assistant.id);
  } catch (err: unknown) {
    // A transport that throws mid-stream (network failure, AbortError,
    // CBOR decode panic) used to leave the assistant message stuck in
    // `streaming=true`; the store would never settle and the Send button
    // stayed disabled. Annotate + finish so the UI recovers.
    const message = err instanceof Error ? err.message : String(err);
    store.appendAssistantDelta(assistant.id, `\n\n[transport error: ${message}]`);
    store.finishAssistantMessage(assistant.id);
  }
}

export async function runChatTurn(opts: ChatTurnOptions): Promise<void> {
  const store = useKeycapCreatorStore.getState();
  store.appendUserMessage(opts.userText);
  await streamOnce(opts);

  // If Irisy just signalled readiness, auto-follow with <emit-manifest/>
  // so the right pane fills before the user has to ask.
  const after = useKeycapCreatorStore.getState();
  if (after.phase === 'generating' && after.serverTs === null) {
    after.appendUserMessage('<emit-manifest/>');
    await streamOnce(opts);
  }
}
