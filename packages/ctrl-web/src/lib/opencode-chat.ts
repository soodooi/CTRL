// Opencode chat stream hook — opencode HTTP API → PWA streaming.
//
// H-2026-06-09-001 — opencode (coding) + Hermes (assistant) as peer agent processes.
//
// Wire format (mirrors irisy_chat's wire so ChatStreamTransport works unchanged):
//   invoke('opencode_chat_stream', { args: { request_id, session_id?, message, model?,
//                                            temperature?, max_tokens? } })
//   listen('opencode-chat-delta', payload => { request_id, delta, done, error? })

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface OpencodeChatStreamArgs {
  request_id: string;
  session_id?: string;
  message: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface StreamDelta {
  request_id: string;
  delta: string;
  done: boolean;
  error?: string;
}

export function useOpencodeChatStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stream = useCallback(
    async (args: OpencodeChatStreamArgs) => {
      setIsStreaming(true);
      setError(null);

      try {
        await invoke<void>('opencode_chat_stream', { args });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setError(errMsg);
        setIsStreaming(false);
        return;
      }

      // Listen for streaming deltas
      const unlisten = await listen<StreamDelta>('opencode-chat-delta', (event) => {
        if (event.payload.request_id === args.request_id) {
          if (event.payload.error) {
            setError(event.payload.error);
          }
          if (event.payload.done) {
            setIsStreaming(false);
            unlisten(); // Unlisten
          }
        }
      });

      return unlisten;
    },
    []
  );

  return {
    stream,
    isStreaming,
    error,
  };
}