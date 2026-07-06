// CodingScene — the coding module's left work area (bao 2026-07-06, trial "B"):
// TWO panes behind tabs — OpenCode (the coding agent) + a plain Terminal — both
// opened in the projected CTRL workspace (`~/Documents/CTRL`, where the kernel
// projector wrote `.mcp.json`, so an MCP-aware CLI auto-discovers the :17873
// gate). Irisy's chat stays pinned + resident in the RIGHT column (AmbientHome),
// unchanged — this component owns only the left panes.
//
// Design: BYO-CLI driver (ADR-001 spine §4) — CTRL runs the user's own OSS
// coding CLI (OpenCode, MIT, model-agnostic) in its workspace and projects the
// gate; it does NOT supervise the agent loop. Plan: plan-opencode-coding-engine.md.
//
// Both panes stay MOUNTED across tab switches (toggled via `display`) so neither
// PTY dies when you flip tabs — the CodingTerminal's ResizeObserver re-fits the
// xterm grid the moment its pane becomes visible again.

import { useEffect, useState, type ReactElement } from 'react';
import { vaultRootPath } from '@/lib/kernel';
import { CodingTerminal } from './CodingTerminal';

type Pane = 'opencode' | 'terminal';

export function CodingScene(): ReactElement {
  // Resolve the projected workspace = the configured VAULT ROOT (not a hardcoded
  // ~/Documents/CTRL — the user may point the vault elsewhere). This is exactly
  // where the kernel projector wrote `.mcp.json` + `opencode.json`, so an
  // MCP-aware CLI launched here auto-discovers the gate. Hold the panes back
  // until known (a PTY's cwd is fixed at spawn).
  const [workspace, setWorkspace] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void vaultRootPath()
      .then((root) => {
        if (alive) setWorkspace(root || '');
      })
      .catch(() => {
        if (alive) setWorkspace('');
      });
    return () => {
      alive = false;
    };
  }, []);

  const [active, setActive] = useState<Pane>('opencode');

  return (
    <div
      aria-label="Coding module"
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
      <div
        role="tablist"
        aria-label="Coding panes"
        style={{ display: 'flex', gap: 4, padding: '6px 8px', borderBottom: '1px solid #1a1a1a' }}
      >
        {(['opencode', 'terminal'] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={p === active}
            onClick={() => setActive(p)}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid transparent',
              cursor: 'pointer',
              background: p === active ? '#1c1c1c' : 'transparent',
              color: p === active ? '#e8e8e8' : '#8a8a8a',
            }}
          >
            {p === 'opencode' ? 'OpenCode' : 'Terminal'}
          </button>
        ))}
      </div>

      {workspace != null && (
        <>
          {/* OpenCode — the coding agent. Runs its own TUI; drives itself, so it
              does NOT register as Irisy's run-in-terminal companion. */}
          <div style={{ flex: 1, minHeight: 0, display: active === 'opencode' ? 'flex' : 'none' }}>
            <CodingTerminal
              command="opencode"
              args={[]}
              cwd={workspace || undefined}
              registerSession={false}
            />
          </div>
          {/* Plain shell — kept as a peer pane (bao 2026-07-06). This one IS
              Irisy's resident companion (eyes = stdout, hand = run-in-terminal). */}
          <div style={{ flex: 1, minHeight: 0, display: active === 'terminal' ? 'flex' : 'none' }}>
            <CodingTerminal
              command="bash"
              args={['-l']}
              cwd={workspace || undefined}
              registerSession
            />
          </div>
        </>
      )}
    </div>
  );
}
