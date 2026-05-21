// RemoteEnvList — flat list of active remote coding environments.
//
// The kernel's `cs_list` currently returns just `string[]` of stream_ids.
// This component renders the minimal display the contract supports today:
// each row shows the stream id and (when the eventual envelope extension
// lands) an optional status pill and relative-time footer. The
// project/lane/agent grouping that lived in the mock data is removed —
// it will return when the C2 metadata contract surfaces those fields.

import type { ReactElement } from 'react';
import { formatRelativeShort } from '@/lib/relative-time';
import { cx } from './primitives/cx';
import styles from './RemoteEnvList.module.css';

/**
 * Process-life status for a remote env. Models kernel-side actor state
 * (does the SubprocessActor still exist on disk?), NOT the frontend's
 * WebSocket bridge state. See `SubprocessChannelStatus` in
 * `@/hooks/useSubprocessChannel` for the channel-lifecycle counterpart —
 * the detail view shows that one because it cares whether the bridge
 * socket is attached, not whether the env actor is alive.
 */
export type EnvLifeStatus = 'running' | 'crashed' | 'stopped';

export interface ListedEnv {
  /** Stable id used by ST-SS / Tauri cs_* commands. */
  stream_id: string;
  /** Optional — present once kernel extends cs_list to an envelope. */
  status?: EnvLifeStatus;
  /** Optional — ISO-8601 spawn moment, when the envelope ships. */
  started_at_iso?: string;
  /** Optional — the command that started this env, for human display. */
  command?: string;
}

interface Props {
  envs: ReadonlyArray<ListedEnv>;
  /** Tapping a card body. */
  onOpen: (streamId: string) => void;
  /** Rendered when the list is empty so the caller can route the user to
      a spawn affordance. Optional — if omitted a plain message renders. */
  onNew?: () => void;
  /** Override the empty-state copy. */
  emptyMessage?: string;
}

const STATUS_CLASS: Record<EnvLifeStatus, string> = {
  running: styles.statusRunning ?? '',
  crashed: styles.statusCrashed ?? '',
  stopped: styles.statusStopped ?? '',
};

export const RemoteEnvList = ({
  envs,
  onOpen,
  onNew,
  emptyMessage = 'No active environments yet.',
}: Props): ReactElement => {
  if (envs.length === 0) {
    return (
      <div className={styles.empty} role="status">
        <p className={styles.emptyMessage}>{emptyMessage}</p>
        {onNew && (
          <button type="button" className={styles.emptyAction} onClick={onNew}>
            + New environment
          </button>
        )}
      </div>
    );
  }

  return (
    <ul className={styles.grid} aria-label="Active remote environments">
      {envs.map((env) => (
        <li key={env.stream_id} className={styles.cell}>
          <button
            type="button"
            className={styles.card}
            onClick={() => onOpen(env.stream_id)}
            aria-label={`Open ${env.stream_id}`}
          >
            <header className={styles.cardHead}>
              {env.status && (
                <span className={cx(styles.statusPill, STATUS_CLASS[env.status])}>
                  {env.status}
                </span>
              )}
              <span className={styles.streamId}>{env.stream_id}</span>
            </header>
            {env.command && <p className={styles.command}>{env.command}</p>}
            {env.started_at_iso && (
              <p className={styles.footer}>{formatRelativeShort(env.started_at_iso)}</p>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
};
