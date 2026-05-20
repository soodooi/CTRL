// /code-space — two surfaces:
//   - CodeSpaceRoute (list, lane-A PR #14): MOCK_ENVS + RemoteEnvList until
//     `list_remote_envs` and the relay session lookup land.
//   - CodeSpaceDetailRoute (lane-B, ADR-012 §7 tile wire): live xterm
//     viewer for one running SubprocessActor, with structured-cell rail
//     and stdin/resize/signal/kill controls via Tauri cs_* commands.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { RemoteEnvList } from '@/components/RemoteEnvList';
import { MOCK_ENVS, type EnvStatus, type RemoteEnv } from '@/lib/mock-envs';
import {
  useSubprocessChannel,
  type EnvStatusPayload,
  type SubprocessChannelStatus,
  type SubprocessSignal,
  type TerminalExitPayload,
} from '@/hooks/useSubprocessChannel';
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
            ? {
                ...env,
                status: nextStatus(env.status, action),
                last_activity_iso: new Date().toISOString(),
              }
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

// ── Detail viewer ────────────────────────────────────────────────────────

const formatTime = (tsMs: number): string => {
  const d = new Date(tsMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

const STATUS_LABEL: Record<SubprocessChannelStatus, string> = {
  idle: 'idle',
  connecting: 'connecting',
  open: 'connected',
  closed: 'closed',
  error: 'error',
};

const cls = (value: string | undefined): string => value ?? '';

const STATUS_CLASS: Record<SubprocessChannelStatus, string> = {
  idle: cls(styles.csdStatusPill),
  connecting: `${cls(styles.csdStatusPill)} ${cls(styles.csdStatusPill_connecting)}`,
  open: `${cls(styles.csdStatusPill)} ${cls(styles.csdStatusPill_open)}`,
  closed: `${cls(styles.csdStatusPill)} ${cls(styles.csdStatusPill_closed)}`,
  error: `${cls(styles.csdStatusPill)} ${cls(styles.csdStatusPill_error)}`,
};

const TERMINAL_OPTIONS: ITerminalOptions = {
  fontFamily:
    '"JetBrains Mono", "SF Mono", Consolas, "Roboto Mono", monospace',
  fontSize: 13,
  cursorBlink: true,
  convertEol: true,
  scrollback: 5000,
  theme: {
    background: '#0a0a0a',
    foreground: '#e8e8e8',
    cursor: '#7aa2ff',
  },
};

interface RailEntry {
  ts_ms: number;
  text: string;
  tone: 'info' | 'warn' | 'error';
}

const NOOP_PROMISE = async (): Promise<void> => undefined;

export const CodeSpaceDetailRoute = (): ReactElement => {
  const navigate = useNavigate();
  // `from` anchors the params type to this exact route so envId is `string`
  // (not `string | undefined`) per TanStack Router's contract.
  const { envId } = useParams({ from: '/code-space/$envId' });

  const [envStatus, setEnvStatus] = useState<EnvStatusPayload | null>(null);
  const [exit, setExit] = useState<TerminalExitPayload | null>(null);
  const [log, setLog] = useState<RailEntry[]>([]);
  const [draft, setDraft] = useState('');

  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const writeStdinRef = useRef<(bytes: Uint8Array) => Promise<void>>(NOOP_PROMISE);
  const resizeRef = useRef<(cols: number, rows: number) => Promise<void>>(NOOP_PROMISE);

  const pushLog = useCallback(
    (text: string, tone: RailEntry['tone'] = 'info'): void => {
      setLog((prev) => {
        const next = [...prev, { ts_ms: Date.now(), text, tone }];
        if (next.length > 200) next.splice(0, next.length - 200);
        return next;
      });
    },
    [],
  );

  const channel = useSubprocessChannel(envId, {
    onTerminalOutput: (bytes) => {
      terminalRef.current?.write(bytes);
    },
    onTerminalExit: (payload) => {
      setExit(payload);
      pushLog(
        `exit · code=${payload.code ?? '?'}${
          payload.signal !== undefined ? ` · signal=${payload.signal}` : ''
        }`,
        payload.code === 0 ? 'info' : 'error',
      );
    },
    onEnvStatus: (payload) => {
      setEnvStatus(payload);
      pushLog(
        `env · ${payload.state}${payload.detail ? ` · ${payload.detail}` : ''}`,
        payload.state === 'error' ? 'error' : 'info',
      );
    },
    onAgentAction: (payload) => {
      const target = payload.target ? ` ${payload.target}` : '';
      pushLog(`agent · ${payload.action_kind}${target}`);
    },
    onAgentThinking: (payload) => {
      pushLog(`thinking · ${payload.text.slice(0, 80)}`);
    },
  });

  writeStdinRef.current = channel.writeStdin;
  resizeRef.current = channel.resize;

  useEffect(() => {
    if (!terminalHostRef.current) return;

    const term = new Terminal(TERMINAL_OPTIONS);
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalHostRef.current);
    fit.fit();

    // Surface cs_* invoke failures into the rail log instead of letting
    // unhandled-promise-rejection warnings hit the console silently. The
    // user otherwise sees "I typed but nothing happened" with no signal.
    const reportErr = (label: string, tone: RailEntry['tone'] = 'error') =>
      (err: unknown): void => {
        pushLog(
          `${label} · ${err instanceof Error ? err.message : String(err)}`,
          tone,
        );
      };

    term.onData((chunk: string) => {
      const bytes = new TextEncoder().encode(chunk);
      writeStdinRef.current(bytes).catch(reportErr('stdin error'));
    });

    term.onResize(({ cols, rows }) => {
      resizeRef.current(cols, rows).catch(reportErr('resize error', 'warn'));
    });

    terminalRef.current = term;

    const onWindowResize = (): void => {
      try {
        fit.fit();
      } catch {
        // terminal might be detached during route swap
      }
    };
    window.addEventListener('resize', onWindowResize);

    return () => {
      window.removeEventListener('resize', onWindowResize);
      term.dispose();
      terminalRef.current = null;
    };
  }, [envId]);

  const sendDraft = useCallback((): void => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    pushLog(`> ${trimmed}`);
    // C1 vocabulary has reserved space for an `agent_prompt` op kind;
    // until that lands we forward the prompt as stdin so the running
    // subprocess receives it directly.
    const bytes = new TextEncoder().encode(`${trimmed}\n`);
    channel.writeStdin(bytes).catch((err: unknown) => {
      pushLog(
        `stdin error · ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    });
    setDraft('');
  }, [channel, draft, pushLog]);

  const onSignal = useCallback(
    (sig: SubprocessSignal): void => {
      channel.signal(sig).catch((err: unknown) => {
        pushLog(
          `signal error · ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      });
      pushLog(`signal · ${sig}`, sig === 'SIGKILL' ? 'error' : 'warn');
    },
    [channel, pushLog],
  );

  const statusText = useMemo(() => STATUS_LABEL[channel.status], [channel.status]);
  const statusClass = useMemo(() => STATUS_CLASS[channel.status], [channel.status]);

  return (
    <div className={styles.csdLayout}>
      <header className={styles.csdHeader}>
        <h1 className={styles.csdTitle}>
          <button
            type="button"
            className={styles.back}
            onClick={() => void navigate({ to: '/code-space' })}
            aria-label="Back to Code Space list"
          >
            ‹ Code Space
          </button>
          <span className={styles.csdEnvId}>{envId}</span>
        </h1>
        <div className={styles.csdStatusGroup}>
          <span className={statusClass}>{statusText}</span>
          {channel.error && <span>· {channel.error}</span>}
        </div>
      </header>

      <section className={styles.csdTerminal} aria-label="Terminal output">
        <div ref={terminalHostRef} className={styles.csdTerminalMount} />
      </section>

      <aside className={styles.csdRail} aria-label="Structured cells">
        <div className={styles.csdRailCard}>
          <div className={styles.csdRailCardHead}>
            <span>env_status</span>
            <span>{exit ? '◌' : envStatus?.state === 'running' ? '●' : '·'}</span>
          </div>
          <div className={styles.csdRailCardBody}>
            {envStatus ? (
              <>
                state: {envStatus.state}
                {envStatus.detail ? `\n${envStatus.detail}` : ''}
                {exit && (
                  <>
                    {'\n'}exited: code={exit.code ?? '?'}
                  </>
                )}
              </>
            ) : (
              <>waiting for env_status…</>
            )}
          </div>
        </div>

        <div className={styles.csdRailCard}>
          <div className={styles.csdRailCardHead}>
            <span>lsp_state</span>
            <span>—</span>
          </div>
          <div className={styles.csdRailCardBody}>idle</div>
        </div>

        <div className={styles.csdRailCard}>
          <div className={styles.csdRailCardHead}>
            <span>agent log</span>
            <span>tail · {Math.min(log.length, 12)}</span>
          </div>
          <div className={styles.csdAgentLog}>
            {log.slice(-12).map((entry, idx) => (
              <div
                key={`${entry.ts_ms}-${idx}`}
                className={styles.csdAgentLogItem}
                style={{
                  color:
                    entry.tone === 'error'
                      ? 'var(--color-danger, #b00020)'
                      : entry.tone === 'warn'
                        ? 'var(--color-warning, #d4a017)'
                        : undefined,
                }}
              >
                <span className={styles.csdAgentLogTime}>{formatTime(entry.ts_ms)}</span>
                <span>{entry.text}</span>
              </div>
            ))}
            {log.length === 0 && (
              <span className={styles.csdAgentLogTime}>no entries yet</span>
            )}
          </div>
        </div>
      </aside>

      <footer className={styles.csdFooter}>
        <input
          className={styles.csdPromptInput}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              sendDraft();
            }
          }}
          placeholder="Type a prompt and Ctrl+Enter to send (forwarded as stdin until agent_prompt op lands)"
          aria-label="Prompt input"
        />
        <div className={styles.csdControls}>
          <button type="button" className={styles.csdBtn} onClick={sendDraft}>
            Send
          </button>
          <button
            type="button"
            className={styles.csdBtn}
            onClick={() => onSignal('SIGINT')}
            title="Send SIGINT"
          >
            Interrupt
          </button>
          <button
            type="button"
            className={`${styles.csdBtn} ${styles.csdBtnDanger}`}
            onClick={() => onSignal('SIGTERM')}
            title="Send SIGTERM"
          >
            Kill
          </button>
        </div>
      </footer>
    </div>
  );
};
