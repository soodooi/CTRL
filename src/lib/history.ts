// Local-only run history. v0.1 stores last 50 entries in localStorage.
// Day 3+ may move to SQLite via tauri-plugin-sql.

const HISTORY_KEY = 'ctrl.history.v1';
const HISTORY_LIMIT = 50;

export type HistoryKind = 'success' | 'error' | 'notify';

export interface HistoryEntry {
  id: string;
  toolId: string;
  toolName: string;
  actionId: string;
  ts: number;
  kind: HistoryKind;
  text: string;
}

function safeReadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryEntry).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function isHistoryEntry(v: unknown): v is HistoryEntry {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.toolId === 'string' &&
    typeof o.toolName === 'string' &&
    typeof o.actionId === 'string' &&
    typeof o.ts === 'number' &&
    (o.kind === 'success' || o.kind === 'error' || o.kind === 'notify') &&
    typeof o.text === 'string'
  );
}

function safeWriteHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {
    // best-effort: storage quota or disabled — history is non-critical
  }
}

export function loadHistory(): HistoryEntry[] {
  return safeReadHistory();
}

export function pushHistory(entry: Omit<HistoryEntry, 'id' | 'ts'>): HistoryEntry[] {
  const next: HistoryEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
  };
  const current = safeReadHistory();
  const updated = [next, ...current].slice(0, HISTORY_LIMIT);
  safeWriteHistory(updated);
  return updated;
}

export function clearHistory(): void {
  safeWriteHistory([]);
}

export function formatRelativeTime(ts: number, now = Date.now()): string {
  const diffSec = Math.floor((now - ts) / 1000);
  if (diffSec < 5) return '刚刚';
  if (diffSec < 60) return `${diffSec} 秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${m}-${day}`;
}
