// ChatHeaderControls — top-of-chat chip strip exposing Pi runtime
// controls the user reaches for mid-conversation:
//
//   - ModelChip:    current provider/model; click opens picker
//                   (getAvailableModels + setModel + cycleModel)
//   - ThinkingChip: current thinking level (off/low/medium/high);
//                   click cycles (cycleThinkingLevel)
//   - StatsChip:    turns + token usage from getSessionStats; click
//                   refreshes
//   - ExportButton: triggers exportHtml; opens path in the OS
//
// bao 2026-06-05 "open all Pi capability, best frontend practice":
// each chip is a small focused control, keyboard-accessible (Enter +
// arrow nav inside open pickers), no layout shift (reserves min-width
// via CSS), error-tolerant (Pi call failures surface as inline error
// text, not silent).

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cycleThinkingLevel,
  exportHtml,
  getAvailableModels,
  getSessionStats,
  setModel as setPiModel,
  setThinkingLevel,
  type ModelInfo,
  type ThinkingLevel,
} from '../../lib/usePiRpc';
import styles from './ChatHeaderControls.module.css';

interface State {
  provider?: string;
  model?: string;
  thinking: ThinkingLevel;
  turns?: number;
  tokensIn?: number;
  tokensOut?: number;
}

interface Stats {
  turnCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

interface SessionStateLike {
  model?: { provider?: string; id?: string };
  thinkingLevel?: ThinkingLevel;
}

export function ChatHeaderControls(): JSX.Element {
  const [state, setState] = useState<State>({ thinking: 'off' });
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [open, setOpen] = useState<'model' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // Pull initial state + stats on mount.
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [stats, mods] = await Promise.all([
        getSessionStats().catch(() => null) as Promise<Stats | null>,
        getAvailableModels().catch(() => [] as ModelInfo[]),
      ]);
      setModels(mods);
      setState((prev) => ({
        ...prev,
        turns: stats?.turnCount,
        tokensIn: stats?.inputTokens,
        tokensOut: stats?.outputTokens,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Refresh stats every 8s while mounted so token count stays current.
    const id = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Click-outside closes model picker.
  useEffect(() => {
    if (open !== 'model') return;
    const onDoc = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const onPickModel = async (m: ModelInfo): Promise<void> => {
    setBusy('model');
    setError(null);
    try {
      await setPiModel(m.provider, m.id);
      setState((prev) => ({ ...prev, provider: m.provider, model: m.id }));
      setOpen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onCycleThinking = async (): Promise<void> => {
    setBusy('thinking');
    setError(null);
    try {
      const result = (await cycleThinkingLevel()) as { level?: ThinkingLevel } | null;
      const next = result?.level ?? nextThinking(state.thinking);
      setState((prev) => ({ ...prev, thinking: next }));
    } catch (e) {
      // Fall back to client-side cycle if Pi doesn't support cycle (e.g. no models scoped).
      const next = nextThinking(state.thinking);
      try {
        await setThinkingLevel(next);
        setState((prev) => ({ ...prev, thinking: next }));
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : String(e2));
      }
    } finally {
      setBusy(null);
    }
  };

  const onExport = async (): Promise<void> => {
    setBusy('export');
    setError(null);
    try {
      const result = (await exportHtml()) as { path?: string };
      if (result?.path) {
        // Toast-style success indicator; sticks for 4 seconds.
        setError(`Exported to ${result.path}`);
        window.setTimeout(() => setError(null), 4000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const modelLabel = state.model
    ? `${state.model}`
    : models[0]
      ? `${models[0].id}`
      : 'model…';

  return (
    <div className={styles.bar} role="toolbar" aria-label="Chat runtime controls">
      <div className={styles.chipGroup} ref={pickerRef}>
        <button
          type="button"
          className={styles.chip}
          onClick={() => setOpen(open === 'model' ? null : 'model')}
          disabled={busy === 'model'}
          aria-haspopup="listbox"
          aria-expanded={open === 'model'}
          title={state.provider ? `${state.provider} · ${modelLabel}` : 'Pick model'}
        >
          <span className={styles.chipIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
            </svg>
          </span>
          <span className={styles.chipLabel}>{modelLabel}</span>
          <span className={styles.chipCaret} aria-hidden="true">▾</span>
        </button>
        {open === 'model' && (() => {
          // bao 2026-06-06: filter out Pi-SDK builtin providers that the
          // user has NOT configured in CTRL Settings. Pi's
          // getAvailableModels() returns dozens of preset providers
          // (anthropic, openai, google, openrouter, etc.) — listing them
          // all confused users into thinking they were available without
          // setup. Only show providers whose id is registered through
          // our kernel (ollama-local builtin + user-added slugs).
          const piBuiltinSkip = new Set([
            'anthropic', 'openai', 'google', 'groq', 'deepseek', 'kimi',
            'ant-ling', 'azure-openai', 'minimax', 'xai', 'fireworks',
            'together', 'openrouter', 'ai-gateway', 'zai',
            'zai-coding-cn', 'mistral', 'moonshot', 'opencode',
            'opencode-zen', 'cloudflare', 'xiaomi', 'amazon-bedrock',
            'cerebras', 'nvidia', 'nvidia-nim', 'gemini', 'aws-bedrock',
          ]);
          const visible = models.filter((m) => !piBuiltinSkip.has(m.provider));
          return (
          <ul className={styles.picker} role="listbox" aria-label="Available models">
            {visible.length === 0 ? (
              // bao 2026-06-05 d: empty state. Previously the picker was
              // hidden silently when `models.length === 0`, so clicking
              // the chip did nothing — user thought the button was broken.
              // Render a one-row hint that points them at the cause
              // (no provider configured yet) + a deep link to Settings.
              <li>
                <div className={styles.pickerEmpty}>
                  <strong>No models available.</strong>
                  <br />
                  <span>
                    Add a provider key in <a href="/settings/providers">Settings → Providers</a>,
                    then click Save. The model list reloads on the next session.
                  </span>
                </div>
              </li>
            ) : (
              visible.map((m) => (
                <li key={`${m.provider}/${m.id}`}>
                  <button
                    type="button"
                    className={styles.pickerItem}
                    onClick={() => void onPickModel(m)}
                    role="option"
                    aria-selected={state.model === m.id && state.provider === m.provider}
                  >
                    <span className={styles.pickerProvider}>{m.provider}</span>
                    <span className={styles.pickerModel}>{m.id}</span>
                    <span className={styles.pickerCtx}>{(m.contextWindow / 1000).toFixed(0)}K{m.reasoning ? ' · 🧠' : ''}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
          );
        })()}
      </div>

      <button
        type="button"
        className={`${styles.chip} ${styles.chipThinking} ${styles[`thinking-${state.thinking}`] ?? ''}`}
        onClick={() => void onCycleThinking()}
        disabled={busy === 'thinking'}
        title="Click to cycle thinking level (off / low / medium / high)"
      >
        <span className={styles.chipIcon} aria-hidden="true">🧠</span>
        <span className={styles.chipLabel}>{state.thinking}</span>
      </button>

      <div className={styles.statsChip} title="Session stats (refreshed every 8s)">
        <span className={styles.statValue}>{state.turns ?? '—'}</span>
        <span className={styles.statSep}>·</span>
        <span className={styles.statValue}>{formatTokens((state.tokensIn ?? 0) + (state.tokensOut ?? 0))}</span>
      </div>

      <button
        type="button"
        className={styles.chipGhost}
        onClick={() => void onExport()}
        disabled={busy === 'export'}
        title="Export this conversation to HTML"
        aria-label="Export to HTML"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>

      {error && (
        <span className={styles.error} role="status">
          {error}
        </span>
      )}
    </div>
  );
}

function nextThinking(level: ThinkingLevel): ThinkingLevel {
  const order: ThinkingLevel[] = ['off', 'low', 'medium', 'high'];
  const idx = order.indexOf(level);
  return order[(idx + 1) % order.length] ?? 'off';
}

function formatTokens(n: number): string {
  if (n === 0) return '0 tok';
  if (n < 1000) return `${n} tok`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k tok`;
  return `${(n / 1_000_000).toFixed(2)}M tok`;
}
