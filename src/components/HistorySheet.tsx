import { useCallback, useEffect, useMemo, useState } from 'react';
import { clearHistory, formatRelativeTime, loadHistory, type HistoryEntry } from '../lib/history';

interface HistorySheetProps {
  onClose: () => void;
  onRerun: (toolId: string, actionId: string) => void;
}

export function HistorySheet({ onClose, onRerun }: HistorySheetProps): JSX.Element {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => loadHistory());
  const [tick, setTick] = useState(0);

  // refresh relative time every 30s while open
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const onClear = useCallback(() => {
    clearHistory();
    setEntries([]);
  }, []);

  const onCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore — best-effort copy
    }
  }, []);

  const grouped = useMemo(() => entries, [entries, tick]);

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="历史">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <h2 className="sheet-title">最近运行</h2>
          <div className="sheet-header-actions">
            {entries.length > 0 && (
              <button type="button" className="action-btn ghost" onClick={onClear}>
                清空
              </button>
            )}
            <button
              type="button"
              className="panel-close"
              aria-label="关闭"
              title="Esc 关闭"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </header>

        <section className="sheet-section sheet-section-scroll">
          {grouped.length === 0 ? (
            <div className="sheet-empty">
              <p>还没有运行记录。按 <kbd className="action-kbd mono">1-9</kbd> 触发任意工具,记录会出现在这里。</p>
            </div>
          ) : (
            <ul className="history-list">
              {grouped.map((e) => (
                <HistoryRow
                  key={e.id}
                  entry={e}
                  onRerun={() => {
                    onRerun(e.toolId, e.actionId);
                    onClose();
                  }}
                  onCopy={() => onCopy(e.text)}
                />
              ))}
            </ul>
          )}
        </section>

        <footer className="sheet-footer mono">
          按 <kbd className="action-kbd mono">Esc</kbd> 关闭 · 最多保留 50 条
        </footer>
      </div>
    </div>
  );
}

interface HistoryRowProps {
  entry: HistoryEntry;
  onRerun: () => void;
  onCopy: () => void;
}

function HistoryRow({ entry, onRerun, onCopy }: HistoryRowProps): JSX.Element {
  const mark = entry.kind === 'error' ? '✗' : entry.kind === 'notify' ? '·' : '✓';
  const preview = entry.text.length > 80 ? `${entry.text.slice(0, 80)}…` : entry.text;
  return (
    <li className={`history-item history-item-${entry.kind}`}>
      <header className="history-item-header">
        <span className={`workspace-mark workspace-mark-${entry.kind}`} aria-hidden>
          {mark}
        </span>
        <span className="history-item-name">{entry.toolName}</span>
        <span className="history-item-time mono">{formatRelativeTime(entry.ts)}</span>
      </header>
      {preview && <div className="history-item-preview">{preview}</div>}
      <footer className="history-item-actions">
        <button type="button" className="action-btn" onClick={onRerun}>
          ↻ 重做
        </button>
        {entry.text && (
          <button type="button" className="action-btn ghost" onClick={onCopy}>
            复制
          </button>
        )}
      </footer>
    </li>
  );
}
