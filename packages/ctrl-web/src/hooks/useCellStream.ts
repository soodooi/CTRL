// useCellStream — subscribes to the kernel event-stream bridge for a given stream.
//
// Pulls a fresh bridge URL via the `subscribe` invoke command (which embeds
// the per-process auth token), opens a WebSocket to that URL, and decodes
// the CBOR-framed Cell/Op events into typed objects.
//
// Capped at MAX_CELLS so a chatty stream cannot blow the heap; oldest cells
// are dropped first.

import { useEffect, useRef, useState } from 'react';
import { decode } from 'cbor-x';
import { subscribe } from '@/lib/kernel';

const MAX_CELLS = 100;

export type CellKind =
  | 'user_input'
  | 'clipboard_snapshot'
  | 'screen_snapshot'
  | 'hardware_reading'
  | 'llm_response'
  | 'mcp_tool_result'
  | 'api_response'
  | 'context_snapshot';

export type OpKind =
  | 'mcp_invoked'
  | 'mcp_completed'
  | 'mcp_failed'
  | 'actor_spawned'
  | 'actor_terminated'
  | 'hotkey_triggered'
  | 'llm_call_started'
  | 'llm_call_chunk'
  | 'llm_call_finished'
  | 'app_focus_changed'
  | 'file_saved'
  | 'cursor_moved'
  | 'mesh_device_joined'
  | 'mesh_device_left'
  | 'mesh_mcp_added'
  | 'mesh_mcp_removed'
  | 'mesh_mcp_used_at'
  | 'mesh_preference_updated'
  | 'packs_changed';

export interface CellRecord {
  type: 'cell';
  kind: CellKind;
  ts_ms: number;
  stream_id?: string | null;
  payload: unknown;
}

export interface OpRecord {
  type: 'op';
  kind: OpKind;
  ts_ms: number;
  stream_id?: string | null;
  payload: unknown;
}

export type EventRecord = CellRecord | OpRecord;

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

interface UseCellStreamResult {
  events: EventRecord[];
  status: StreamStatus;
  error: string | null;
}

export const useCellStream = (streamId: string | null): UseCellStreamResult => {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!streamId) {
      setStatus('idle');
      setEvents([]);
      return;
    }

    cancelledRef.current = false;
    let socket: WebSocket | null = null;
    setStatus('connecting');
    setError(null);
    setEvents([]);

    const connect = async (): Promise<void> => {
      try {
        const handle = await subscribe(streamId);
        if (cancelledRef.current) return;

        socket = new WebSocket(handle.bridge_url);
        socket.binaryType = 'arraybuffer';

        socket.onopen = () => {
          if (cancelledRef.current) return;
          setStatus('open');
        };

        socket.onmessage = (msg) => {
          if (cancelledRef.current) return;
          if (!(msg.data instanceof ArrayBuffer)) return;
          try {
            const bytes = new Uint8Array(msg.data);
            const decoded = decode(bytes) as EventRecord;
            if (!decoded || (decoded.type !== 'cell' && decoded.type !== 'op')) return;
            setEvents((prev) => {
              const next = [...prev, decoded];
              if (next.length > MAX_CELLS) next.splice(0, next.length - MAX_CELLS);
              return next;
            });
          } catch (decodeErr) {
            // eslint-disable-next-line no-console
            console.warn('[ctrl/web] cell stream decode failed', decodeErr);
          }
        };

        socket.onerror = () => {
          if (cancelledRef.current) return;
          setStatus('error');
          setError('Bridge connection error');
        };

        socket.onclose = (ev) => {
          if (cancelledRef.current) return;
          setStatus('closed');
          if (ev.code === 1006) setError('Bridge closed unexpectedly');
          if (ev.code === 1008 || ev.code === 4401) setError('Bridge rejected token');
        };
      } catch (err: unknown) {
        if (cancelledRef.current) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Failed to subscribe');
      }
    };

    void connect();

    return () => {
      cancelledRef.current = true;
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        try {
          socket.close(1000, 'route unmount');
        } catch {
          // ignore close errors
        }
      }
    };
  }, [streamId]);

  return { events, status, error };
};
