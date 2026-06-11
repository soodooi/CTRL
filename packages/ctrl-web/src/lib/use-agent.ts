// useAgent — PWA-side agent lifecycle per ADR-002 substrate §1 v19
// (2026-06-09, 3-agent aggregator).
//
// The kernel installs and launches; it never supervises. This hook owns
// the retry loop ("PWA owns retry" — §1.3): ensure installed → resolve an
// endpoint → expose status + retry() for the reconnect button.
//
// Endpoint resolution per agent (upstreams verified 2026-06-10,
// ADR-002 substrate §1.1 v20):
//   opencode → invoke('launch_agent') → { kind: 'http_port', port }
//   hermes   → install-only; chat goes through invoke('assistant_oneshot')
//              until the kernel ACP streaming client lands
//   kairo    → invoke('launch_agent') → { kind: 'webview', url, workspace_path }

import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';

export type AgentName = 'hermes' | 'opencode' | 'kairo';

export type AgentEndpoint =
  | { kind: 'http_port'; port: number }
  | { kind: 'acp_stdio'; pid: number }
  | { kind: 'webview'; url: string; workspace_path: string }
  | { kind: 'oneshot' };

export type AgentStatus = 'idle' | 'installing' | 'launching' | 'ready' | 'error';

async function resolveEndpoint(name: AgentName): Promise<AgentEndpoint> {
  if (name === 'hermes') {
    // hermes is launched per call (uvx one-shot) — nothing to hold open.
    return { kind: 'oneshot' };
  }
  return invoke<AgentEndpoint>('launch_agent', { name });
}

export function useAgent(name: AgentName) {
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [endpoint, setEndpoint] = useState<AgentEndpoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef(0);

  const start = useCallback(async () => {
    const attempt = ++attemptRef.current;
    const stale = () => attempt !== attemptRef.current;
    setError(null);
    setEndpoint(null);
    try {
      const installed = await invoke<boolean>('agent_status', { name });
      if (stale()) return;
      if (!installed) {
        setStatus('installing');
        await invoke('install_agent', { name, force: false });
        if (stale()) return;
      }
      setStatus('launching');
      const ep = await resolveEndpoint(name);
      if (stale()) return;
      setEndpoint(ep);
      setStatus('ready');
    } catch (err) {
      if (stale()) return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [name]);

  useEffect(() => {
    void start();
    return () => {
      // Invalidate in-flight attempts; stopping the process is the
      // kernel's stop_agent TODO — PWA only stops listening.
      attemptRef.current++;
    };
  }, [start]);

  return { status, endpoint, error, retry: start };
}
