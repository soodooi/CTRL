// [H-2026-05-20] useSubprocessChannel — bidirectional channel for one
// SubprocessActor (ADR-002 substrate § subprocess v1) using the v0.7 ST-SS wire vocabulary.
//
// Inbound: WebSocket to the kernel ST-SS bridge. The Z1 wire adapter
// translates kernel-internal Op kinds into v0.7 Cell kinds before broadcast,
// so the PWA listens for cells `terminal_output` / `terminal_exit` /
// `env_status` / `lsp_state` / `agent_thinking` / `agent_action` — not the
// raw `subprocess_*` ops.
//
// Outbound: Tauri `cs_stdin` / `cs_resize` / `cs_signal` / `cs_kill`
// commands (PR #16). These route through CodeSpaceRegistry → the actor's
// mailbox; publishing CBOR ops on the WS would silently no-op because the
// bridge's inbound-op callback isn't wired to the registry.
//
// Why a fresh hook (not `useCellStream`): terminal stdout frames can exceed
// thousands per second; pushing each through React state would jank. Callers
// receive bytes via callback and pipe them straight to xterm.write().

import { useEffect, useRef, useState } from 'react';
import { decode } from 'cbor-x';
import { invoke } from '@/lib/bridge';
import { subscribe } from '@/lib/kernel';

export type SubprocessSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL';

export type EnvState = 'spawning' | 'running' | 'exited' | 'error';

export interface EnvStatusPayload {
  state: EnvState;
  detail?: string;
}

export interface TerminalOutputPayload {
  actor: string;
  pid: number;
  data_b64: string;
  len: number;
}

export interface TerminalExitPayload {
  actor: string;
  pid: number | null;
  code: number | null;
  signal?: number;
}

export interface LspStatePayload {
  file?: string;
  function?: string;
  cursor_line?: number;
  selection?: unknown;
}

export interface AgentActionPayload {
  action_kind: string;
  target?: string;
  args?: unknown;
  agent_id?: string;
}

export interface AgentThinkingPayload {
  text: string;
  agent_id?: string;
  ts_ms?: number;
}

export interface UseSubprocessChannelOptions {
  onTerminalOutput?: (bytes: Uint8Array) => void;
  onTerminalExit?: (payload: TerminalExitPayload) => void;
  onEnvStatus?: (payload: EnvStatusPayload) => void;
  onLspState?: (payload: LspStatePayload) => void;
  onAgentAction?: (payload: AgentActionPayload) => void;
  onAgentThinking?: (payload: AgentThinkingPayload) => void;
}

export type SubprocessChannelStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closed'
  | 'error';

export interface SubprocessChannel {
  status: SubprocessChannelStatus;
  error: string | null;
  writeStdin: (bytes: Uint8Array) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  signal: (sig: SubprocessSignal) => Promise<void>;
  kill: () => Promise<void>;
}

const NOOP_ASYNC = async (): Promise<void> => undefined;

const decodeBase64 = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

const encodeBase64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin);
};

interface CellEnvelope {
  type?: string;
  kind?: string;
  stream_id?: string | null;
  payload?: unknown;
}

export const useSubprocessChannel = (
  streamId: string | null,
  opts: UseSubprocessChannelOptions = {},
): SubprocessChannel => {
  const [status, setStatus] = useState<SubprocessChannelStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!streamId) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setStatus('connecting');
    setError(null);

    const connect = async (): Promise<void> => {
      try {
        const handle = await subscribe(streamId);
        if (cancelled) return;

        const ws = new WebSocket(handle.bridge_url);
        ws.binaryType = 'arraybuffer';
        socketRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          setStatus('open');
        };

        ws.onmessage = (msg) => {
          if (cancelled) return;
          if (!(msg.data instanceof ArrayBuffer)) return;
          let decoded: CellEnvelope;
          try {
            decoded = decode(new Uint8Array(msg.data)) as CellEnvelope;
          } catch {
            return;
          }
          if (decoded?.type !== 'cell') return;
          if (decoded.stream_id !== streamId) return;
          const payload = decoded.payload as Record<string, unknown> | undefined;
          if (!payload) return;
          switch (decoded.kind) {
            case 'terminal_output': {
              const b64 = payload['data_b64'];
              if (typeof b64 !== 'string') return;
              optsRef.current.onTerminalOutput?.(decodeBase64(b64));
              return;
            }
            case 'terminal_exit': {
              optsRef.current.onTerminalExit?.(payload as unknown as TerminalExitPayload);
              return;
            }
            case 'env_status': {
              optsRef.current.onEnvStatus?.(payload as unknown as EnvStatusPayload);
              return;
            }
            case 'lsp_state': {
              optsRef.current.onLspState?.(payload as unknown as LspStatePayload);
              return;
            }
            case 'agent_action': {
              optsRef.current.onAgentAction?.(payload as unknown as AgentActionPayload);
              return;
            }
            case 'agent_thinking': {
              optsRef.current.onAgentThinking?.(payload as unknown as AgentThinkingPayload);
              return;
            }
            default:
              return;
          }
        };

        ws.onerror = () => {
          if (cancelled) return;
          setStatus('error');
          setError('Bridge connection error');
          // WebSocket fires `error` without auto-closing for some transport
          // failures; without an explicit close the socket lingers in a
          // half-open state and the FD doesn't free until GC. Close so
          // onclose fires deterministically and the cleanup path runs.
          try {
            ws.close(4000, 'transport error');
          } catch {
            // ignore — close on an already-closed socket throws
          }
        };

        ws.onclose = (ev) => {
          if (cancelled) return;
          setStatus('closed');
          if (ev.code === 1006) setError('Bridge closed unexpectedly');
          if (ev.code === 1008 || ev.code === 4401) setError('Bridge rejected token');
        };
      } catch (err: unknown) {
        if (cancelled) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Failed to subscribe');
      }
    };

    void connect();

    return () => {
      cancelled = true;
      const ws = socketRef.current;
      socketRef.current = null;
      if (ws && ws.readyState !== WebSocket.CLOSED) {
        try {
          ws.close(1000, 'route unmount');
        } catch {
          // ignore close errors
        }
      }
    };
  }, [streamId]);

  if (!streamId) {
    return {
      status,
      error,
      writeStdin: NOOP_ASYNC,
      resize: NOOP_ASYNC,
      signal: NOOP_ASYNC,
      kill: NOOP_ASYNC,
    };
  }

  return {
    status,
    error,
    writeStdin: (bytes) =>
      invoke<void>('cs_stdin', {
        args: { stream_id: streamId, data_b64: encodeBase64(bytes) },
      }),
    resize: (cols, rows) =>
      invoke<void>('cs_resize', { args: { stream_id: streamId, cols, rows } }),
    signal: (sig) =>
      invoke<void>('cs_signal', { args: { stream_id: streamId, signal: sig } }),
    kill: () => invoke<void>('cs_kill', { args: { stream_id: streamId } }),
  };
};
