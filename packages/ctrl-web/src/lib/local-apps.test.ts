// Local-app selection projection contract. The properties worth pinning are the
// honest ones: an absent field is omitted rather than invented, a large range is
// visibly truncated, and "nothing selected" stays a recoverable state.
// (ADR-002 substrate §14.12; ADR-005 irisy §12 v42 U19/U22)

import { describe, expect, it, vi } from 'vitest';
import {
  localAppSelectionFacts,
  localAppUnavailableFact,
  type LocalAppConnector,
} from './local-apps';

const connector: LocalAppConnector = {
  id: 'ctrl-libreoffice',
  name: 'LibreOffice Companion',
  summary: 'Reads the explicit selection',
  connected: true,
  requires: 'LibreOffice',
};

describe('localAppSelectionFacts', () => {
  it('reports nothing when the connector returned no rows', () => {
    expect(localAppSelectionFacts([])).toEqual([]);
  });

  it('shows the selection identity and content in decision order', () => {
    const facts = localAppSelectionFacts([
      {
        document_id: 'Budget.ods',
        document_type: 'calc',
        selection_kind: 'range',
        target: 'A1:C4',
        revision: 'rev-7',
        content_hash: 'abc123',
        content: '1,2,3',
      },
    ]);
    expect(facts.map((fact) => fact.label)).toEqual([
      'Document',
      'Type',
      'Selection',
      'Target',
      'Revision',
      'Content hash',
      'Selected content',
    ]);
    expect(facts.at(-1)?.value).toBe('1,2,3');
  });

  it('omits fields the connector did not send instead of showing blanks', () => {
    const facts = localAppSelectionFacts([{ document_id: 'Notes.odt', content: 'hi' }]);
    expect(facts.map((fact) => fact.label)).toEqual(['Document', 'Selected content']);
  });

  it('treats an empty string as absent', () => {
    const facts = localAppSelectionFacts([{ document_id: '', target: 'A1' }]);
    expect(facts.map((fact) => fact.label)).toEqual(['Target']);
  });

  it('truncates a large selection visibly, stating the real length', () => {
    const content = 'x'.repeat(1000);
    const facts = localAppSelectionFacts([{ content }]);
    const value = facts[0]?.value ?? '';
    expect(value.length).toBeLessThan(500);
    expect(value).toContain('… (1000 characters)');
  });

  it('does not truncate content that already fits', () => {
    const facts = localAppSelectionFacts([{ content: 'short' }]);
    expect(facts[0]?.value).toBe('short');
  });

  it('reads only the first row, because one selection is the unit of work', () => {
    const facts = localAppSelectionFacts([{ target: 'A1' }, { target: 'B2' }]);
    expect(facts).toEqual([{ label: 'Target', value: 'A1' }]);
  });

  it('shows formulas separately from values when Calc sent both', () => {
    const facts = localAppSelectionFacts([{ content: '3', formulas: '=1+2' }]);
    expect(facts).toEqual([
      { label: 'Selected content', value: '3' },
      { label: 'Selected formulas', value: '=1+2' },
    ]);
  });
});

describe('localAppUnavailableFact', () => {
  it('keeps nothing-selected recoverable and names the application', () => {
    const fact = localAppUnavailableFact(connector, 'Make an explicit selection, then retry.');
    expect(fact.kind).toBe('unavailable');
    expect(fact.retryable).toBe(true);
    expect(fact.target).toBe('LibreOffice');
    expect(fact.subject).toContain('nothing selected');
    // The connector's own message stays available as drill-down.
    expect(fact.provenance).toEqual([
      { label: 'Reason', value: 'Make an explicit selection, then retry.' },
    ]);
    expect(fact.options.map((option) => option.id)).toContain('retry');
  });

  it('falls back to the connector name when no application is declared', () => {
    const fact = localAppUnavailableFact({ ...connector, requires: null }, 'no selection');
    expect(fact.target).toBe('LibreOffice Companion');
  });
});

describe('readLocalAppSelection narrowing', () => {
  it('names the connector it addresses, so one grant is not every connector', async () => {
    const calls: unknown[] = [];
    vi.resetModules();
    vi.doMock('./bridge', () => ({
      invoke: (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return Promise.resolve({ rows: [] });
      },
    }));
    const { readLocalAppSelection } = await import('./local-apps');
    await readLocalAppSelection('ctrl-libreoffice');
    vi.doUnmock('./bridge');
    vi.resetModules();

    expect(calls).toEqual([
      {
        command: 'gate_invoke',
        args: {
          tool: 'source_query',
          args: { source_id: 'ctrl-libreoffice' },
          // The `source` domain alone authorizes no connector; this call names
          // exactly the one it reads. (ADR-002 substrate §17.5 v85)
          intent: 'source,source:ctrl-libreoffice',
        },
      },
    ]);
  });
});
