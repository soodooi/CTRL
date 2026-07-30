// Coding chat transport — CodingScene's bridge to `coding_chat_stream`
// (the opencode-over-ACP Tauri command, ADR-001 spine §4 v16). Mirrors
// `ChatStreamTransport` in llm-transport.ts (same three-channel event
// contract: chat-stream-delta / chat-stream-tool / chat-stream-thought) but
// deliberately separate — this wire carries `workspace` instead of
// model/agent/skill_id, and drives a different Rust-side singleton so
// switching Coding's workspace never touches Irisy's own engine session.
// (ADR-003 frontend §8.5 v32; ADR-005 irisy §8.7 v30)

import { invoke } from './bridge';
import type { LLMMessage } from './llm-transport';

export interface CodingToolStep {
  tool_call_id: string;
  phase: 'call' | 'result';
  title: string;
  status?: string;
  input?: string;
  output?: string;
}

export interface CodingChatChunk {
  delta: string;
  done: boolean;
  error?: string;
  tool?: CodingToolStep;
  thought?: string;
}

/** One file dropped into the Coding composer, sent alongside a turn's text
 *  (ADR-002 substrate §1.8.6 v75; ADR-003 frontend §8.5 v35). Only carries
 *  an absolute path — the kernel reads the file, classifies it, and builds
 *  the matching ACP ContentBlock; the frontend never reads file bytes. */
export interface CodingAttachment {
  path: string;
  name: string;
}

interface WireDelta {
  request_id: string;
  delta: string;
  done: boolean;
  error?: string;
}

interface WireTool extends CodingToolStep {
  request_id: string;
}

interface WireThought {
  request_id: string;
  delta: string;
}

/**
 * Stream one turn to opencode (via ACP) for the given workspace. The
 * returned async iterable yields text / tool-step / thought chunks in the
 * order the engine produced them, same shape as `ChatStreamTransport` so
 * CodingScene's rendering can mirror AmbientHome's ToolStepView pattern.
 */
export async function* streamCodingChat(
  workspace: string,
  messages: LLMMessage[],
  signal?: AbortSignal,
  attachments?: CodingAttachment[],
): AsyncIterable<CodingChatChunk> {
  if (signal?.aborted) {
    yield { delta: '', done: true, error: 'aborted' };
    return;
  }
  const requestId = crypto.randomUUID();
  const { listen } = await import('@tauri-apps/api/event');

  type QueueItem = { delta: WireDelta } | { tool: WireTool } | { thought: string };
  const queue: QueueItem[] = [];
  let resolveNext: (() => void) | null = null;
  const wake = (): void => {
    const w = resolveNext;
    if (w) {
      resolveNext = null;
      w();
    }
  };

  const unlistenDelta = await listen<WireDelta>('chat-stream-delta', (event) => {
    if (event.payload.request_id !== requestId) return;
    queue.push({ delta: event.payload });
    wake();
  });
  const unlistenTool = await listen<WireTool>('chat-stream-tool', (event) => {
    if (event.payload.request_id !== requestId) return;
    queue.push({ tool: event.payload });
    wake();
  });
  const unlistenThought = await listen<WireThought>('chat-stream-thought', (event) => {
    if (event.payload.request_id !== requestId) return;
    queue.push({ thought: event.payload.delta });
    wake();
  });
  const unlisten = (): void => {
    unlistenDelta();
    unlistenTool();
    unlistenThought();
  };
  let cancellationRequested = false;
  let backendStarted = false;
  let backendCancellationSent = false;
  const cancelBackendTurn = (): void => {
    if (!backendStarted || backendCancellationSent) return;
    backendCancellationSent = true;
    // Browser abort only stops local iteration. Tell the ACP owner to cancel
    // and drain this exact prompt before another Coding turn can reuse stdout.
    // (ADR-005 irisy §8.3 v7)
    void invoke<void>('coding_cancel_stream', {
      args: { request_id: requestId },
    }).catch(() => undefined);
  };
  const onAbort = (): void => {
    if (cancellationRequested) return;
    cancellationRequested = true;
    cancelBackendTurn();
    wake();
  };
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) onAbort();

  try {
    await invoke('coding_chat_stream', {
      args: { request_id: requestId, workspace, messages, attachments: attachments ?? [] },
    });
    backendStarted = true;
    if (cancellationRequested) cancelBackendTurn();
    while (true) {
      if (signal?.aborted) {
        yield { delta: '', done: true, error: 'aborted' };
        return;
      }
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
        continue;
      }
      const item = queue.shift();
      if (!item) continue;
      if ('tool' in item) {
        const { request_id: _rid, ...tool } = item.tool;
        yield { delta: '', done: false, tool };
        continue;
      }
      if ('thought' in item) {
        yield { delta: '', done: false, thought: item.thought };
        continue;
      }
      const next = item.delta;
      if (next.error) {
        yield { delta: '', done: true, error: next.error };
        return;
      }
      if (next.delta) yield { delta: next.delta, done: false };
      if (next.done) {
        yield { delta: '', done: true };
        return;
      }
    }
  } finally {
    queue.length = 0;
    signal?.removeEventListener('abort', onAbort);
    unlisten();
  }
}

/** Reset the Coding engine's ACP session — call before sending a turn in a
 *  different workspace (a fresh cwd needs a fresh `opencode` process). */
export const resetCodingEngine = (): Promise<void> => invoke<void>('coding_reset_engine');
