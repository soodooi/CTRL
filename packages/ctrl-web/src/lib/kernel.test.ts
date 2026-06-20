// isSeedingFirstRun — the G3 cold-start gate (ADR-006 § cold-start-loop §6.1).
// Maps the kernel's first_run_state onto the "Setting up CTRL…" hint so a
// brand-new install's empty Tools/Discover lists read as "installing", not
// broken. These assertions pin the exact tri-state the AmbientWorkbench relies
// on: copying → show hint, ready → hide, no-poll-yet → hide (don't flash).

import { describe, it, expect } from 'vitest';
import { isSeedingFirstRun, type KernelStatus } from './kernel';

function status(firstRun: 'copying' | 'ready'): KernelStatus {
  return {
    uptime_ms: 0,
    first_run_state: firstRun,
    llm_adapters: [],
    primary_adapter: null,
    mcp_servers_installed: 0,
    vault_files: 0,
    stss_bridge_addr: '',
    overall: 'ok',
    warnings: [],
    active_brain: '',
  };
}

describe('isSeedingFirstRun', () => {
  it('is true while the kernel is still seeding builtin mcps (copying)', () => {
    expect(isSeedingFirstRun(status('copying'))).toBe(true);
  });

  it('is false once seeding is done (ready)', () => {
    expect(isSeedingFirstRun(status('ready'))).toBe(false);
  });

  it('is false on a null snapshot (no poll yet) — never flash the setup hint', () => {
    expect(isSeedingFirstRun(null)).toBe(false);
  });
});
