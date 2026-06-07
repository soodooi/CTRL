// Coding — ADR-002 substrate § brain v13 (2026-06-07, retracts v11 §3.11).
//
// L1 chip click → this route → cs_spawn the bundled `pi` binary → xterm.
// No provider resolution, no api-key injection, no SSOT lookup, no error
// page. Pi reads ~/.pi/agent/models.json + ~/.pi/agent/settings.json
// itself; same config the Irisy chat panel uses (chat = `pi --mode rpc`
// via ctrl-pi-bridge, coding tab = `pi` TUI — one binary, one config).
//
// Behavior on mount:
//   1. Look for an existing non-crashed Pi env; if found, navigate to it.
//   2. Otherwise resolve the bundled Pi binary path + cs_spawn it.
//   3. Pi's own startup UX handles "no provider configured" — it prompts
//      via `pi config` or stderr. CTRL does not wrap that.

import { invoke } from '@tauri-apps/api/core';
import { useEffect, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { csList, csSpawn } from '@/lib/kernel';

interface EnvLike {
  stream_id?: string;
  status?: string;
  command?: string;
}

interface PiBinaryPath {
  path: string;
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

export const CodingRoute = (): ReactElement => {
  const navigate = useNavigate();

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

        const { path: piPath } = await invoke<PiBinaryPath>('pi_binary_path');
        if (cancelled) return;

        const reply = await csSpawn({
          command: piPath,
          args: [],
          env: {},
        });
        if (cancelled) return;
        await navigate({
          to: '/code-space/$envId',
          params: { envId: reply.stream_id },
          replace: true,
        });
      } catch {
        // Pi prints its own startup diagnostics to stderr (handled by the
        // xterm stream). No PWA error page — that would be a wrapper.
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
        color: 'var(--color-text-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-mono-sm)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      coding · launching pi…
    </div>
  );
};
