// CodingTerminal — the coding area: a real PTY terminal that opens
// straight into the user's own coding CLI (Claude Code flagship).
//
// ADR-001 spine § byo-cli-driver. On mount it runs `claude` if installed,
// otherwise drops to a login shell so the user can
// `npm i -g @anthropic-ai/claude-code` and retry. cwd is the CTRL
// workspace root, where the kernel projector has already written
// `.mcp.json`, so Claude Code auto-discovers the CTRL gate (:17873) on
// launch. CTRL does not supervise the CLI's agent loop.
//
// This component owns ONLY the terminal. It is rendered inside AmbientHome's
// left work area (outbar) as a scene, exactly like Notes / Tables — so Irisy
// stays pinned and resident in the right column beside it.

import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { homeDir } from '@tauri-apps/api/path';
import { csSpawn, csKill } from '@/lib/kernel';
import { loadEnvMap } from '@/lib/dev-env';
import { useTerminalBuffer } from '@/hooks/useTerminalBuffer';
import { useSubprocessChannel } from '@/hooks/useSubprocessChannel';
import { useCodingSession } from '@/lib/coding-session';

const TERMINAL_OPTIONS: ITerminalOptions = {
  fontFamily: '"JetBrains Mono", "SF Mono", Consolas, "Roboto Mono", monospace',
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

// A plain, minimal terminal: an interactive login shell opened at the user's
// home directory. Nothing is auto-run — the user drives it. Installing /
// configuring Claude Code (incl. China npm mirror) is knowledge Irisy holds:
// the user asks Irisy in the resident right column and it guides / installs.
// The login shell (`-l`) loads the user's profile so $PATH matches a normal
// terminal (npm global bin, etc.).
const CODING_COMMAND = 'bash';
const CODING_ARGS: readonly string[] = ['-l'];

const NOOP_ASYNC = async (): Promise<void> => undefined;

export interface CodingTerminalProps {
  /** Program to run in the PTY (default `bash`). e.g. `opencode` for the
   *  coding agent pane. */
  command?: string;
  /** Args for `command` (default `['-l']` — a login shell). */
  args?: readonly string[];
  /** Working directory. Defaults to the user's home; the coding module passes
   *  the configured vault root (via `vault_root_path`) so an MCP-aware CLI finds
   *  the projected `.mcp.json` / `opencode.json` (the gate) on launch. */
  cwd?: string;
  /** Publish this terminal to the resident Irisy companion (its eyes = recent
   *  stdout, its hand = write commands). Default true. The coding-agent pane
   *  (opencode) sets false — it drives itself, not Irisy's run-in-terminal. */
  registerSession?: boolean;
}

export function CodingTerminal({
  command = CODING_COMMAND,
  args = CODING_ARGS,
  cwd: cwdProp,
  registerSession = true,
}: CodingTerminalProps = {}): ReactElement {
  const [streamId, setStreamId] = useState<string | null>(null);
  const [spawnError, setSpawnError] = useState<string | null>(null);

  const termBuffer = useTerminalBuffer();
  const setSession = useCodingSession((s) => s.setSession);
  const clearSession = useCodingSession((s) => s.clearSession);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const writeStdinRef = useRef<(bytes: Uint8Array) => Promise<void>>(NOOP_ASYNC);
  const resizeRef = useRef<(cols: number, rows: number) => Promise<void>>(NOOP_ASYNC);

  // Spawn exactly one terminal for this scene. A ref guard keeps React 18
  // StrictMode's double-mount from spawning two PTYs; if it unmounts before
  // spawn resolves, kill the orphan immediately.
  const spawnedRef = useRef(false);
  useEffect(() => {
    if (spawnedRef.current) return;
    spawnedRef.current = true;

    let cancelled = false;
    let liveStreamId: string | null = null;

    const start = async (): Promise<void> => {
      try {
        // cwd: caller-supplied (coding module → the CTRL workspace so an
        // MCP-aware CLI finds `.mcp.json`), else the user's home.
        const cwd = cwdProp ?? (await homeDir().catch(() => undefined));
        // Inject the dev-env vars (Settings → Env) so a CLI like Claude Code
        // picks up ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL without the user
        // pasting secrets into the shell.
        const env = await loadEnvMap().catch(() => ({}));
        if (cancelled) return;
        const reply = await csSpawn({
          command,
          args: [...args],
          cwd,
          env,
        });
        if (cancelled) {
          void csKill(reply.stream_id).catch(() => undefined);
          return;
        }
        liveStreamId = reply.stream_id;
        setStreamId(reply.stream_id);
      } catch (err: unknown) {
        if (cancelled) return;
        setSpawnError(err instanceof Error ? err.message : String(err));
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (liveStreamId) {
        void csKill(liveStreamId).catch(() => undefined);
      }
    };
  }, []);

  const channel = useSubprocessChannel(streamId, {
    onTerminalOutput: (bytes) => {
      terminalRef.current?.write(bytes);
      termBuffer.append(bytes); // Irisy's eyes — recent stdout
    },
  });

  // Publish this terminal to the resident Irisy (companion P0): the stdout
  // getter is its eyes, the streamId is where its hand writes commands. Clear
  // on unmount so Irisy stops seeing a dead terminal.
  useEffect(() => {
    if (!streamId || !registerSession) return;
    setSession(streamId, termBuffer.getRecentText);
    return () => clearSession();
  }, [streamId, registerSession, setSession, clearSession, termBuffer.getRecentText]);

  writeStdinRef.current = channel.writeStdin;
  resizeRef.current = channel.resize;

  useEffect(() => {
    if (!terminalHostRef.current) return;

    const term = new Terminal(TERMINAL_OPTIONS);
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalHostRef.current);
    fit.fit();

    term.onData((chunk: string) => {
      const bytes = new TextEncoder().encode(chunk);
      void writeStdinRef.current(bytes).catch(() => undefined);
    });
    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      void resizeRef.current(cols, rows).catch(() => undefined);
    });

    terminalRef.current = term;

    const refit = (): void => {
      try {
        fit.fit();
      } catch {
        // terminal might be detached during a scene swap
      }
    };

    // The scene container (flex child of outbar) settles its size AFTER mount
    // — framer-motion's layout animation + the resizable Irisy divider both
    // change it. A one-shot fit() on mount leaves the xterm grid stuck at its
    // initial 80x24, so it paints only the top-left and the rest is black =
    // "half a screen". A ResizeObserver re-fits on every size change so the
    // grid always fills the work area. rAF defers the first fit until the
    // browser has laid the container out.
    const host = terminalHostRef.current;
    const ro = new ResizeObserver(() => refit());
    ro.observe(host);
    requestAnimationFrame(refit);
    window.addEventListener('resize', refit);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', refit);
      term.dispose();
      terminalRef.current = null;
    };
  }, []);

  return (
    <div
      aria-label="Coding terminal"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        background: '#0a0a0a',
      }}
    >
      {spawnError ? (
        <div style={{ padding: 16, color: 'var(--color-danger, #ff6b6b)' }} role="alert">
          Failed to start coding terminal · {spawnError}
        </div>
      ) : (
        <div ref={terminalHostRef} style={{ flex: 1, minHeight: 0, padding: 8 }} />
      )}
    </div>
  );
}
