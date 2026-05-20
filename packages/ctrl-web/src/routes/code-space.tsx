// /code-space — list of remote coding environments.
//
// Wires <RemoteEnvList> against MOCK_ENVS until the real kernel command
// (list_remote_envs) + ctrl-relay session lookup are in. Status toggles
// flip a local store mirror so the UI feels live; the backend write will
// arrive when zeus exposes the start_env / stop_env commands.

import { useCallback, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { RemoteEnvList } from '@/components/RemoteEnvList';
import { MOCK_ENVS, type EnvStatus, type RemoteEnv } from '@/lib/mock-envs';
import styles from './code-space.module.css';

const nextStatus = (status: EnvStatus, action: 'start' | 'stop'): EnvStatus => {
  if (action === 'start') return 'running';
  // stop preserves crashed (an explicit stop on a crashed env is a no-op
  // from the UI's perspective; the kernel may clear the crash flag).
  return status === 'crashed' ? 'crashed' : 'stopped';
};

export const CodeSpaceRoute = (): ReactElement => {
  const navigate = useNavigate();
  const [envs, setEnvs] = useState<ReadonlyArray<RemoteEnv>>(MOCK_ENVS);

  const handleOpen = useCallback(
    (envId: string): void => {
      void navigate({ to: '/code-space/$envId', params: { envId } });
    },
    [navigate],
  );

  const handleToggle = useCallback(
    (envId: string, action: 'start' | 'stop'): void => {
      setEnvs((prev) =>
        prev.map((env) =>
          env.id === envId
            ? { ...env, status: nextStatus(env.status, action), last_activity_iso: new Date().toISOString() }
            : env,
        ),
      );
    },
    [],
  );

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>Code Space</h1>
        <p className={styles.subtitle}>Remote coding environments across all projects.</p>
      </header>
      <RemoteEnvList envs={envs} onOpen={handleOpen} onToggle={handleToggle} />
    </div>
  );
};

export const CodeSpaceDetailRoute = (): ReactElement => {
  const navigate = useNavigate();
  // `from` anchors the params type to this exact route so envId is
  // string (not string | undefined) per TanStack Router's contract.
  const { envId } = useParams({ from: '/code-space/$envId' });
  return (
    <div className={styles.detail}>
      <button
        type="button"
        className={styles.back}
        onClick={() => void navigate({ to: '/code-space' })}
      >
        ‹ Code Space
      </button>
      <h1 className={styles.title}>Env {envId}</h1>
      <p className={styles.subtitle}>
        Detail view placeholder. Cell stream + controls land when the
        kernel exposes <code className={styles.code}>list_remote_envs</code>
        {' '}and the relay session lookup is wired.
      </p>
    </div>
  );
};
