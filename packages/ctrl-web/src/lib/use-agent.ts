// useAgent — PWA-side agent lifecycle per ADR-002 substrate §1.
//
// The kernel installs and launches; it never supervises. This hook owns
// the retry loop ("PWA owns retry" — §1.3): ensure installed → resolve an
// endpoint → expose status + retry() for the reconnect button.
//
// Only hermes (Irisy's brain) remains here. opencode was retired/unwired
// (bao 2026-06-25) and its frontend chat surface deleted; kairo/KB is the
// user's own Obsidian, not a launched agent. hermes is install-only — chat
// goes through invoke('assistant_oneshot') until the ACP streaming client
// lands, so resolveEndpoint returns a oneshot marker (no launch_agent call).

import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';

export type AgentName = 'hermes';

export type AgentEndpoint = { kind: 'oneshot' };

export type AgentStatus = 'idle' | 'installing' | 'launching' | 'ready' | 'error';

async function resolveEndpoint(_name: AgentName): Promise<AgentEndpoint> {
  // hermes is launched per call (uvx one-shot) — nothing to hold open.
  return { kind: 'oneshot' };
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
