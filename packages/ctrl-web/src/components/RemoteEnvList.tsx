// RemoteEnvList — mobile-first list of remote coding environments,
// grouped by project / lane / agent or shown flat.
//
// Top tab bar drives the grouping mode; each env card surfaces stream_id,
// agent type, project / lane, status pill, last activity, and a primary
// Start/Stop action. Tapping the card body invokes `onOpen(envId)` — the
// caller is responsible for routing.
//
// Mobile-first layout: 1-col stack below 720px, 2-col 720-1080, 3-col
// above. Touch targets ≥ 44pt. Status colors flow through tokens.css
// (--color-success / --color-warning / --color-danger / --color-text-muted).

import { useMemo, useState, type ReactElement } from 'react';
import type { AgentType, EnvStatus, RemoteEnv } from '@/lib/mock-envs';
import { formatRelativeTime } from '@/lib/mock-envs';
import { Button } from '@/components/primitives';
import styles from './RemoteEnvList.module.css';

type GroupBy = 'all' | 'project' | 'lane' | 'agent';

const TABS: ReadonlyArray<{ id: GroupBy; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'project', label: 'By Project' },
  { id: 'lane', label: 'By Lane' },
  { id: 'agent', label: 'By Agent' },
];

interface Props {
  envs: ReadonlyArray<RemoteEnv>;
  /** Tapping a card body. */
  onOpen: (envId: string) => void;
  /** Start / stop the env. UI optimistically renders the toggle; the caller
      decides whether to flip the local store. */
  onToggle: (envId: string, action: 'start' | 'stop') => void;
}

interface Group {
  key: string;
  label: string;
  envs: ReadonlyArray<RemoteEnv>;
}

const groupEnvs = (envs: ReadonlyArray<RemoteEnv>, mode: GroupBy): Group[] => {
  if (mode === 'all') {
    return [{ key: 'all', label: 'All environments', envs: sortByActivity(envs) }];
  }
  const buckets = new Map<string, RemoteEnv[]>();
  for (const env of envs) {
    const key =
      mode === 'project' ? env.project : mode === 'lane' ? env.lane : env.agent_type;
    const list = buckets.get(key) ?? [];
    list.push(env);
    buckets.set(key, list);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({ key, label: key, envs: sortByActivity(list) }));
};

const sortByActivity = <T extends Pick<RemoteEnv, 'last_activity_iso'>>(
  items: ReadonlyArray<T>,
): T[] =>
  [...items].sort(
    (a, b) =>
      new Date(b.last_activity_iso).getTime() - new Date(a.last_activity_iso).getTime(),
  );

const statusVariantClass = (status: EnvStatus): string => {
  switch (status) {
    case 'running':
      return styles.statusRunning ?? '';
    case 'idle':
      return styles.statusIdle ?? '';
    case 'crashed':
      return styles.statusCrashed ?? '';
    case 'stopped':
      return styles.statusStopped ?? '';
  }
};

const isRunning = (status: EnvStatus): boolean => status === 'running' || status === 'idle';

const agentBadge = (agent: AgentType): string => agent.replace('-', ' ');

export const RemoteEnvList = ({ envs, onOpen, onToggle }: Props): ReactElement => {
  const [groupBy, setGroupBy] = useState<GroupBy>('all');
  const groups = useMemo(() => groupEnvs(envs, groupBy), [envs, groupBy]);

  return (
    <div className={styles.layout}>
      <div className={styles.tabs} role="tablist" aria-label="Group remote environments by">
        {TABS.map((tab) => {
          const active = tab.id === groupBy;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${styles.tab} ${active ? styles.tabActive : ''}`}
              onClick={() => setGroupBy(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className={styles.scroll}>
        {groups.map((group) => (
          <section key={group.key} className={styles.group} aria-labelledby={`group-${group.key}`}>
            {groupBy !== 'all' && (
              <header className={styles.groupHead}>
                <h2 id={`group-${group.key}`} className={styles.groupLabel}>
                  {group.label}
                </h2>
                <span className={styles.groupCount}>{group.envs.length}</span>
              </header>
            )}
            <ul className={styles.grid}>
              {group.envs.map((env) => (
                <li key={env.id} className={styles.cell}>
                  <article className={styles.card}>
                    <button
                      type="button"
                      className={styles.cardBody}
                      onClick={() => onOpen(env.id)}
                      aria-label={`Open ${env.stream_id}`}
                    >
                      <header className={styles.cardHead}>
                        <span className={`${styles.statusPill} ${statusVariantClass(env.status)}`}>
                          {env.status}
                        </span>
                        <span className={styles.streamId}>{env.stream_id}</span>
                      </header>
                      <p className={styles.meta}>
                        <span className={styles.agent}>{agentBadge(env.agent_type)}</span>
                        <span className={styles.dot} aria-hidden="true">·</span>
                        <span>{env.project}</span>
                        <span className={styles.dot} aria-hidden="true">/</span>
                        <span>{env.lane}</span>
                      </p>
                      <p className={styles.footer}>
                        {env.host ?? 'no host'} · {formatRelativeTime(env.last_activity_iso)}
                      </p>
                    </button>
                    <div className={styles.cardActions}>
                      <Button
                        size="sm"
                        variant={isRunning(env.status) ? 'ghost' : 'primary'}
                        onClick={() => onToggle(env.id, isRunning(env.status) ? 'stop' : 'start')}
                      >
                        {isRunning(env.status) ? 'Stop' : 'Start'}
                      </Button>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
};
