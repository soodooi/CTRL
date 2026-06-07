// Coding — ADR-002 substrate § brain v14 (2026-06-07).
//
// Clean placeholder during the Pi-native coding module rebuild.
// v11 (cs_spawn pi TUI inside xterm) + v13 (slim cs_spawn) both wrapped
// what Pi already provides as `pi-coding-agent`. v14 rebuilds the
// Coding tab as a 2nd `pi --mode rpc` process with its own bridge
// extension (mirrors the Irisy chat pattern, no wrapper layer).
//
// Until v14 ships, the tab renders this notice so the L1 chip remains
// discoverable but never throws "no tab renderer".

import type { ReactElement } from 'react';

export const CodingRoute = (): ReactElement => {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-6)',
        color: 'var(--color-text-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-mono-sm)',
        textAlign: 'center',
        maxWidth: 520,
        margin: '0 auto',
      }}
    >
      <span style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        coding · rebuilding
      </span>
      <span style={{ letterSpacing: 0 }}>
        Pi-native coding module is being rebuilt as a 2nd pi --mode rpc
        process (mirrors Irisy). For now, ask Irisy directly — Pi has
        read/write/edit/bash built in, so coding requests work in the
        chat panel.
      </span>
    </div>
  );
};
