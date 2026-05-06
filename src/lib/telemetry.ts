// Per-tool usage stats — drives "keycap wear" visual: high-frequency keys
// get progressively dimmer top highlight + deeper bevel, like real PBT keycaps
// after months of pounding.
//
// Privacy: all stats live in localStorage. Nothing leaves the device.

const TELEMETRY_KEY = 'ctrl.telemetry.v1';

export interface ToolStat {
  count: number;
  lastUsedAt: number;
}

export type ToolStats = Record<string, ToolStat>;

function safeRead(): ToolStats {
  try {
    const raw = localStorage.getItem(TELEMETRY_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: ToolStats = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) continue;
      const o = v as Record<string, unknown>;
      if (typeof o.count === 'number' && typeof o.lastUsedAt === 'number') {
        result[k] = { count: o.count, lastUsedAt: o.lastUsedAt };
      }
    }
    return result;
  } catch {
    return {};
  }
}

function safeWrite(stats: ToolStats): void {
  try {
    localStorage.setItem(TELEMETRY_KEY, JSON.stringify(stats));
  } catch {
    // best-effort: telemetry is non-critical
  }
}

export function loadStats(): ToolStats {
  return safeRead();
}

export function recordUse(toolId: string): ToolStats {
  const stats = safeRead();
  const prev = stats[toolId];
  stats[toolId] = {
    count: (prev?.count ?? 0) + 1,
    lastUsedAt: Date.now(),
  };
  safeWrite(stats);
  return stats;
}

export function clearStats(): void {
  safeWrite({});
}

/**
 * Wear band 0..3:
 *   0 — pristine, count < 3
 *   1 — light wear, 3 ≤ count < 8
 *   2 — moderate wear, 8 ≤ count < 20
 *   3 — heavy wear, count ≥ 20
 *
 * Discrete bands keep visual stable (vs. continuous interpolation that
 * shifts visibly on every press).
 */
export function wearBandFor(toolId: string, stats: ToolStats): 0 | 1 | 2 | 3 {
  const c = stats[toolId]?.count ?? 0;
  if (c >= 20) return 3;
  if (c >= 8) return 2;
  if (c >= 3) return 1;
  return 0;
}
