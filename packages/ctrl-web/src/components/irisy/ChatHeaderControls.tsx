// ChatHeaderControls — top-of-chat chip strip exposing Pi runtime
// controls the user reaches for mid-conversation:
//
//   - ModelChip:    current provider/model (read-only, click → Settings).
//                   Data source = Pi getState (rpc.md SoT).
//   - ThinkingChip: current thinking level (off/low/medium/high);
//                   click cycles (cycleThinkingLevel).
//   - StatsChip:    turns + token usage from getSessionStats; click
//                   refreshes.
//   - ExportButton: triggers exportHtml; opens path in the OS.
//
// ADR-002 substrate § provider v9 §3.7 (2026-06-06). Retraction of v8
// chip wiring (get_active_providers + active-providers-changed listeners).
// Under v9, Pi spawns with the real BYOK provider+model from SSOT
// (~/.ctrl/state/active-providers.json), so Pi's own getState IS the
// truth — no kernel proxy needed. Provider switching goes through
// Settings → SSOT mutation → provider_set_active → Pi RPC setModel
// (v9 §3.5), and the chip refreshes via the 8 s poll (cheap RPC call).

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  cycleThinkingLevel,
  exportHtml,
  getSessionStats,
  getState,
  setThinkingLevel,
  type ThinkingLevel,
} from '../../lib/usePiRpc';
import styles from './ChatHeaderControls.module.css';

// ── Pi state shape (mirrors @mariozechner/pi-coding-agent rpc.md getState) ──

interface PiCurrentModel {
  provider?: string;
  id?: string;
  name?: string;
  label?: string;
}

interface PiState {
  currentModel?: PiCurrentModel | null;
  provider?: string;
  model?: string;
}

// ── Pi SessionStats (mirrors agent-session.d.ts SessionStats) ──

interface SessionStats {
  userMessages?: number;
  assistantMessages?: number;
  tokens?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  contextUsage?: {
    tokens?: number | null;
    contextWindow?: number;
    percent?: number | null;
  };
}

interface State {
  thinking: ThinkingLevel;
  piState: PiState | null;
  stats: SessionStats | null;
}

export function ChatHeaderControls(): JSX.Element {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({
    thinking: 'off',
    piState: null,
    stats: null,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Both reads are Pi RPC calls (~1 ms IPC + Pi in-memory). Poll every
  // 8 s catches stat changes and any out-of-band model swap that
  // bypassed provider_set_active (e.g. Pi's own cycleModel command).
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [piState, stats] = await Promise.all([
        getState().catch(() => null) as Promise<PiState | null>,
        getSessionStats().catch(() => null) as Promise<SessionStats | null>,
      ]);
      setState((prev) => ({
        ...prev,
        piState,
        stats,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const onCycleThinking = async (): Promise<void> => {
    setBusy('thinking');
    setError(null);
    try {
      const result = (await cycleThinkingLevel()) as { level?: ThinkingLevel } | null;
      const next = result?.level ?? nextThinking(state.thinking);
      setState((prev) => ({ ...prev, thinking: next }));
    } catch {
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
        setError(`Exported to ${result.path}`);
        window.setTimeout(() => setError(null), 4000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Resolve provider/model from Pi state. Pi exposes `currentModel`
  // (post-resolve) on top-level state; we fall back to the raw fields
  // for older Pi versions that didn't surface currentModel.
  const cm = state.piState?.currentModel ?? null;
  const providerId = cm?.provider ?? state.piState?.provider ?? null;
  const modelId = cm?.id ?? state.piState?.model ?? null;
  const modelLabel = cm?.label ?? cm?.name ?? modelId ?? null;
  const providerLabel = providerId ? humanizeProvider(providerId) : null;

  const chipTitle =
    providerLabel && modelLabel
      ? `${providerLabel} · ${modelLabel}`
      : providerLabel ?? 'No provider configured — click to open Settings';

  const turnCount =
    (state.stats?.userMessages ?? 0) + (state.stats?.assistantMessages ?? 0);
  const totalTokens =
    state.stats?.tokens?.total ??
    (state.stats?.tokens?.input ?? 0) + (state.stats?.tokens?.output ?? 0);

  return (
    <div className={styles.bar} role="toolbar" aria-label="Chat runtime controls">
      <button
        type="button"
        className={styles.chip}
        onClick={() => void navigate({ to: '/settings/providers' })}
        title={chipTitle}
        aria-label={chipTitle}
      >
        <span className={styles.chipIcon} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
          </svg>
        </span>
        <span className={styles.chipLabel}>
          {providerLabel && modelLabel
            ? `${providerLabel} · ${modelLabel}`
            : providerLabel ?? 'configure provider'}
        </span>
      </button>

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
        <span className={styles.statValue}>{turnCount > 0 ? turnCount : '—'}</span>
        <span className={styles.statSep}>·</span>
        <span className={styles.statValue}>{formatTokens(totalTokens)}</span>
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

// Provider id → user-facing label. Kept inline (small, no churn risk)
// rather than reaching into provider/registry which is a kernel-side
// concern. Adding a provider here is the same churn as adding it in
// Settings → Providers, where the canonical label lives.
function humanizeProvider(id: string): string {
  const map: Record<string, string> = {
    'claude-oauth': 'Claude (OAuth)',
    'anthropic-api': 'Anthropic API',
    'openai-api': 'OpenAI API',
    'volc': 'CTRL Cloud',
    'volc-byok': 'Volc (BYOK)',
    'kimi': 'Kimi',
    'deepseek': 'DeepSeek',
    'google': 'Google AI',
    'ollama': 'Ollama (local)',
  };
  return map[id] ?? id;
}
