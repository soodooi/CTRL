// Coding — thin entry into the coding workspace.
//
// bao 2026-05-28 "you now have all the basic facilities, just compose it directly" +
// "do you think I need a purely static coding page?".
//
// Replaced the v0.1.49 static demo (hardcoded file tree, fake syntax-
// highlighted code, fake terminal mock). /coding's job is to drop the
// user straight into a live coding session — it doesn't render any
// content itself.
//
// Behavior:
//   1. Read cs_list. If a non-crashed session exists, navigate to the
//      most recent one (cs_list sorts started_at_iso desc already).
//   2. If none, spawn a default login shell (`$SHELL -l`) at $HOME
//      and navigate into the new env.
//   3. Errors surface inline so the user isn't stuck on a spinner.
//
// All real coding surfaces (xterm + CompanionPane + view-mode switcher
// + cs_* wire + opencode dark via global [data-theme='dark']) already
// live in /code-space/$envId — this route just routes you there.

import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { csList, csSpawn } from '@/lib/kernel';

interface EnvLike {
  stream_id?: string;
  status?: string;
}

const pickActiveEnv = (raw: unknown): string | null => {
  if (!Array.isArray(raw)) return null;
  for (const item of raw as EnvLike[]) {
    if (typeof item?.stream_id === 'string' && item.status !== 'crashed') {
      return item.stream_id;
    }
  }
  return null;
};

const defaultShell = (): { command: string; args: ReadonlyArray<string> } => {
  const shell =
    (typeof process !== 'undefined' && process.env?.SHELL) || '/bin/zsh';
  return { command: shell, args: ['-l'] };
};

export const CodingRoute = (): ReactElement => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'checking' | 'spawning'>('checking');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const envs = await csList();
        if (cancelled) return;
        const existing = pickActiveEnv(envs);
        if (existing) {
          await navigate({
            to: '/code-space/$envId',
            params: { envId: existing },
            replace: true,
          });
          return;
        }
        setPhase('spawning');
        const { command, args } = defaultShell();
        const home =
          (typeof process !== 'undefined' && process.env?.HOME) || undefined;
        const reply = await csSpawn({ command, args, cwd: home });
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
          <span style={{ textTransform: 'none', letterSpacing: 0 }}>
            {error}
          </span>
        </>
      ) : phase === 'spawning' ? (
        <span>coding · starting shell…</span>
      ) : (
        <span>coding · opening session…</span>
      )}
    </div>
  );
};
