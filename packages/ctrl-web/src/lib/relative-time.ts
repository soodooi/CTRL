// Short relative-time formatter. Anchors to Date.now() at call time so
// consumers should recompute on each render (or via a refreshing query).
// Used by RemoteEnvList and the eventual workspace activity rail.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const formatRelativeShort = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < MINUTE_MS) return 'just now';
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}m ago`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}h ago`;
  return `${Math.floor(diffMs / DAY_MS)}d ago`;
};
