// Coding — ADR-002 substrate § provider v11 §3.11 (2026-06-07).
//
// L1 chip click → this route → resolve coding.primary from kernel SSOT →
// spawn `pi --provider <id> --model <model>` in native TUI mode via the
// existing Code Space PTY plumbing → navigate to /code-space/$envId
// where xterm.js renders the live stream.
//
// bao 2026-06-07: the Coding L1 chip uses Pi natively (separate provider
// from Irisy chat). Click toggles a side workspace tab; click again
// closes it.
//
// Behavior on mount:
//   1. Reuse an existing non-crashed Pi coding session if one exists
//      (avoids spawning 3 Pi processes when the user clicks the chip
//      repeatedly).
//   2. Otherwise resolve coding.primary via `coding_resolve_spawn`, then
//      cs_spawn into a fresh Pi TUI.
//   3. If coding.primary is not configured (or the key is missing),
//      surface the kernel's error inline + link to Settings.
//
// No persona override, no Irisy prompt, no wrapper layer — Pi runs its
// native coding-agent CLI exactly as the upstream ships it (7 builtin
// file tools + bash + skills + native function calling all live).

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { csList, csSpawn } from '@/lib/kernel';

interface EnvLike {
  stream_id?: string;
  status?: string;
  command?: string;
}

interface CodingSpawnSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  provider_id: string;
  model_id: string | null;
  provider_label: string;
}

const pickExistingCodingEnv = (raw: unknown): string | null => {
  if (!Array.isArray(raw)) return null;
  for (const item of raw as EnvLike[]) {
    if (item?.status === 'crashed') continue;
    const cmd = item?.command ?? '';
    if (cmd.endsWith('/pi') || cmd === 'pi') {
      if (typeof item.stream_id === 'string') return item.stream_id;
    }
  }
  return null;
};

type Phase = 'checking' | 'resolving' | 'spawning';

export const CodingRoute = (): ReactElement => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const envs = await csList();
        if (cancelled) return;
        const existing = pickExistingCodingEnv(envs);
        if (existing) {
          await navigate({
            to: '/code-space/$envId',
            params: { envId: existing },
            replace: true,
          });
          return;
        }

        setPhase('resolving');
        const spec = await invoke<CodingSpawnSpec>('coding_resolve_spawn', {
          args: { provider_id_override: null },
        });
        if (cancelled) return;

        setPhase('spawning');
        const reply = await csSpawn({
          command: spec.command,
          args: spec.args,
          env: spec.env,
        });
        if (cancelled) return;
        await navigate({
          to: '/code-space/$envId',
          params: { envId: reply.stream_id },
          replace: true,
        });
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        color: 'var(--color-text-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-mono-sm)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {error ? (
        <>
          <span style={{ color: 'var(--color-danger)' }}>coding · failed</span>
          <span style={{ textTransform: 'none', letterSpacing: 0, maxWidth: 480, textAlign: 'center' }}>
            {error}
          </span>
          <a
            href="/settings/providers"
            style={{
              textTransform: 'none',
              letterSpacing: 0,
              color: 'var(--color-accent)',
              textDecoration: 'underline',
            }}
            onClick={(e) => {
              e.preventDefault();
              void navigate({ to: '/settings/providers', replace: true });
            }}
          >
            Open Settings → Providers
          </a>
        </>
      ) : phase === 'spawning' ? (
        <span>coding · launching pi…</span>
      ) : phase === 'resolving' ? (
        <span>coding · resolving provider…</span>
      ) : (
        <span>coding · opening session…</span>
      )}
    </div>
  );
};
