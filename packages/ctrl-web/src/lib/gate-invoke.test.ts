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

import { gateInvoke, describeSmartTable, vaultWrite } from './kernel';

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

  it('vaultWrite maps frontend `content` onto the gate field `body`', async () => {
    // Regression: the gate's vault_write tool requires `body`; sending the
    // frontend's `content` field dropped a required arg and the gate rejected
    // every write (new smart-table / note save) silently. Lock the mapping.
    invokeMock.mockResolvedValue('wrote tables/x.md');
    await vaultWrite({ path: 'tables/x.md', content: '# hi', frontmatter: { schema: [] } });
    expect(invokeMock).toHaveBeenCalledWith('gate_invoke', {
      tool: 'vault_write',
      args: { path: 'tables/x.md', body: '# hi', frontmatter: { schema: [] } },
    });
    const [, payload] = invokeMock.mock.calls[0];
    expect(payload.args).not.toHaveProperty('content');
  });
});
