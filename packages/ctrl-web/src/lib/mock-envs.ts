// Mock remote coding environments. Used by the /code-space route until
// the real backend (kernel command list_remote_envs, ctrl-cloud relay
// stream lookup) lands. Shape mirrors what the live API will return so
// swapping the import to a real query is a one-line change.

export type AgentType =
  | 'claude'
  | 'aider'
  | 'cursor-agent'
  | 'gpt-engineer'
  | 'devin';

export type EnvStatus = 'running' | 'idle' | 'crashed' | 'stopped';

export interface RemoteEnv {
  /** Stable id used in URL params. */
  id: string;
  /** ST-SS stream id this env writes to. */
  stream_id: string;
  agent_type: AgentType;
  project: string;
  lane: string;
  status: EnvStatus;
  /** ISO-8601 timestamp of the most recent cell emitted by this env. */
  last_activity_iso: string;
  /** Optional human-readable host (machine name, region). */
  host?: string;
}

const MINUTES = 60_000;

// Anchor every mock timestamp to the module-load instant so all 10 envs
// share the same "now". If Date.now() were called per env, the cards
// would drift by a few microseconds — harmless today, but the fixed
// anchor also makes the mock data stable across HMR re-evaluations
// during dev (otherwise relative times shift on every save).
const MODULE_LOAD_MS = Date.now();

const minutesAgo = (n: number): string =>
  new Date(MODULE_LOAD_MS - n * MINUTES).toISOString();

export const MOCK_ENVS: ReadonlyArray<RemoteEnv> = [
  {
    id: 'env-001',
    stream_id: 'stream-a8f3c2',
    agent_type: 'claude',
    project: 'ctrl',
    lane: 'lane-A',
    status: 'running',
    last_activity_iso: minutesAgo(2),
    host: 'macbook-pro · local',
  },
  {
    id: 'env-002',
    stream_id: 'stream-7b1de9',
    agent_type: 'claude',
    project: 'ctrl',
    lane: 'lane-B',
    status: 'idle',
    last_activity_iso: minutesAgo(18),
    host: 'macbook-pro · local',
  },
  {
    id: 'env-003',
    stream_id: 'stream-4c92ab',
    agent_type: 'aider',
    project: 'ctrl',
    lane: 'lane-C',
    status: 'running',
    last_activity_iso: minutesAgo(1),
    host: 'macbook-pro · local',
  },
  {
    id: 'env-004',
    stream_id: 'stream-d51028',
    agent_type: 'cursor-agent',
    project: 'olym-platform',
    lane: 'lane-A',
    status: 'crashed',
    last_activity_iso: minutesAgo(42),
    host: 'tokyo-vps-1',
  },
  {
    id: 'env-005',
    stream_id: 'stream-9e7f60',
    agent_type: 'claude',
    project: 'olym-platform',
    lane: 'lane-D',
    status: 'running',
    last_activity_iso: minutesAgo(5),
    host: 'tokyo-vps-1',
  },
  {
    id: 'env-006',
    stream_id: 'stream-3a18bc',
    agent_type: 'gpt-engineer',
    project: 'mamamiya',
    lane: 'lane-A',
    status: 'stopped',
    last_activity_iso: minutesAgo(180),
  },
  {
    id: 'env-007',
    stream_id: 'stream-fb2741',
    agent_type: 'claude',
    project: 'mamamiya',
    lane: 'lane-B',
    status: 'running',
    last_activity_iso: minutesAgo(8),
    host: 'tokyo-vps-2',
  },
  {
    id: 'env-008',
    stream_id: 'stream-6c8e35',
    agent_type: 'devin',
    project: 'pandagooo',
    lane: 'lane-A',
    status: 'idle',
    last_activity_iso: minutesAgo(60),
    host: 'singapore-vps-1',
  },
  {
    id: 'env-009',
    stream_id: 'stream-12bd47',
    agent_type: 'aider',
    project: 'pandagooo',
    lane: 'lane-B',
    status: 'running',
    last_activity_iso: minutesAgo(3),
    host: 'singapore-vps-1',
  },
  {
    id: 'env-010',
    stream_id: 'stream-5093fa',
    agent_type: 'claude',
    project: 'ctrl',
    lane: 'lane-E',
    status: 'idle',
    last_activity_iso: minutesAgo(25),
    host: 'macbook-pro · local',
  },
];

/**
 * Format an ISO timestamp as a short relative string ("2m", "1h", "3d").
 * Anchored to Date.now() at call time, so consumers should recompute on
 * each render or via a refreshing query.
 */
export const formatRelativeTime = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / MINUTES);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};
