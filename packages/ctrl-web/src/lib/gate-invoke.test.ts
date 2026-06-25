// gateInvoke — the platform-API client (comms-system-design Phase B).
//
// These pin the wire shape of the bridge: a capability call must reach the
// kernel as `invoke('gate_invoke', { tool, args })` with the MCP arguments
// passed through unwrapped (NOT the `{ args: ... }` envelope a Tauri command
// takes). The runtime path (Tauri -> loopback gate -> tool) is verified in the
// real app; here we lock the JS-side contract.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('./bridge', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { gateInvoke, describeSmartTable } from './kernel';

describe('gateInvoke', () => {
  beforeEach(() => invokeMock.mockReset());

  it('routes through the gate_invoke command with tool + unwrapped args', async () => {
    invokeMock.mockResolvedValue({ ok: true });
    const out = await gateInvoke('vault_read', { path: 'note.md' });
    expect(invokeMock).toHaveBeenCalledWith('gate_invoke', {
      tool: 'vault_read',
      args: { path: 'note.md' },
    });
    expect(out).toEqual({ ok: true });
  });

  it('defaults args to an empty object', async () => {
    invokeMock.mockResolvedValue(null);
    await gateInvoke('kernel_status');
    expect(invokeMock).toHaveBeenCalledWith('gate_invoke', {
      tool: 'kernel_status',
      args: {},
    });
  });

  it('describeSmartTable goes through the platform API, not a private command', async () => {
    invokeMock.mockResolvedValue({ fields: [], operators: [] });
    await describeSmartTable('tables/leads.md');
    // The capability now rides gate_invoke — NOT invoke('smart_table_describe').
    expect(invokeMock).toHaveBeenCalledWith('gate_invoke', {
      tool: 'smart_table_describe',
      args: { path: 'tables/leads.md' },
    });
  });
});
