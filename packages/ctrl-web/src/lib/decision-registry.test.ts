// Decision surface registry contract tests.
// (ADR-003 frontend § decision-registry v43)

import { describe, expect, it } from 'vitest';
import {
  DECISION_KINDS,
  approvalFact,
  conflictFact,
  decisionPresentation,
  isDecisionKind,
  safeDefaultOption,
  unavailableFact,
  type DecisionKind,
} from './decision-registry';

describe('kind set', () => {
  it('is closed to exactly the accepted six kinds', () => {
    expect([...DECISION_KINDS]).toEqual([
      'approval',
      'unavailable',
      'conflict',
      'progress',
      'choice',
      'capture',
    ]);
  });

  it('registers a renderer for every kind', () => {
    for (const kind of DECISION_KINDS) {
      const presentation = decisionPresentation(kind);
      expect(presentation.title.length).toBeGreaterThan(0);
      expect(['modal', 'inline']).toContain(presentation.placement);
    }
  });

  it('throws rather than silently rendering an unregistered kind', () => {
    expect(() => decisionPresentation('workflow' as DecisionKind)).toThrow(
      /No decision renderer registered/,
    );
  });

  it('rejects an unknown kind string', () => {
    expect(isDecisionKind('approval')).toBe(true);
    expect(isDecisionKind('schedule')).toBe(false);
  });
});

describe('approval fact', () => {
  const request = {
    id: 'r1',
    caller: 'hermes',
    tool: 'doc_produce',
    arg_summary: '{"path":"notes/a.md"}',
  };

  it('keeps the gate-derived facts visible rather than behind a disclosure', () => {
    const fact = approvalFact(request);
    expect(fact.kind).toBe('approval');
    expect(fact.intent).toBe('U10');
    // These are the only injection-resistant facts the kernel request carries,
    // so they must not be demoted into drill-down.
    const facts = (fact.facts ?? []).map((row) => row.value);
    expect(facts).toContain('hermes');
    expect(facts).toContain('doc_produce');
    expect(facts).toContain('{"path":"notes/a.md"}');
    expect(fact.provenance ?? []).toEqual([]);
  });

  it('marks the committing option destructive for a high-blast external call', () => {
    const approve = approvalFact(request).options.find((option) => option.id === 'approve');
    expect(approve?.destructive).toBe(true);
    expect(approve?.consequence).toBe('commits');
  });

  it('surfaces target, staged change, and preconditions from the staged Outcome', () => {
    const fact = approvalFact({
      ...request,
      outcome: {
        resource: 'ctrl://local/note/notes/a.md',
        target: 'a.md',
        before: 'no total',
        after: 'TOTAL 42,680',
        preconditions: [{ label: 'Revision', value: 'rev-0182' }],
      },
    });
    expect(fact.target).toBe('a.md');
    expect(fact.staged).toEqual({ before: 'no total', after: 'TOTAL 42,680' });
    expect(fact.preconditions).toEqual([{ label: 'Revision', value: 'rev-0182' }]);
    // The subject now names what changes, not just that something is high-impact.
    expect(fact.subject).toContain('a.md');
  });

  it('never fabricates a staged change the kernel did not provide', () => {
    const fact = approvalFact(request);
    expect(fact.staged).toBeUndefined();
    expect(fact.preconditions).toEqual([]);
  });

  it('states plainly when an operation staged no preview', () => {
    const values = (approvalFact(request).facts ?? []).map((row) => row.value);
    expect(values).toContain('none — this operation did not stage a change');
  });

  it('falls back to the resource when the owner named no target', () => {
    const fact = approvalFact({
      ...request,
      outcome: {
        resource: 'ctrl://local/note/notes/a.md',
        before: 'x',
        after: 'y',
      },
    });
    expect(fact.target).toBe('ctrl://local/note/notes/a.md');
    expect(fact.preconditions).toEqual([]);
  });

  it('offers deny and approve with stated consequences', () => {
    const fact = approvalFact(request);
    expect(fact.options.map((option) => [option.id, option.consequence])).toEqual([
      ['deny', 'discards'],
      ['approve', 'commits'],
    ]);
  });

  it('defaults focus to a non-committing option', () => {
    const fallback = safeDefaultOption(approvalFact(request));
    expect(fallback?.id).toBe('deny');
    expect(fallback?.consequence).not.toBe('commits');
  });
});

describe('unavailable fact', () => {
  it('preserves kernel retryability instead of flattening it', () => {
    const retryable = unavailableFact({
      id: 'u1',
      subject: 'Cannot read the selection',
      reason: 'owner unavailable',
      retryable: true,
    });
    expect(retryable.retryable).toBe(true);
    expect(retryable.options.map((option) => option.id)).toEqual(['dismiss', 'retry']);

    const terminal = unavailableFact({
      id: 'u2',
      subject: 'Cannot read the selection',
      reason: 'expired',
      retryable: false,
    });
    expect(terminal.retryable).toBe(false);
    expect(terminal.options.map((option) => option.id)).toEqual(['dismiss']);
  });

  it('prefers an explicit recovery action and maps it to the connect intent', () => {
    const fact = unavailableFact({
      id: 'u3',
      subject: 'That FCT could not be used',
      reason: 'removed',
      retryable: true,
      recoveryLabel: 'Manage in Library',
    });
    expect(fact.intent).toBe('U19');
    const recover = fact.options.find((option) => option.id === 'recover');
    expect(recover).toMatchObject({ label: 'Manage in Library', consequence: 'navigates' });
    expect(fact.options.some((option) => option.id === 'retry')).toBe(false);
  });

  it('omits dismissal when nothing sits behind the failure', () => {
    // A pane with no fallback must not offer a control that resolves to an empty
    // screen; the only option is the one that can actually help.
    const fact = unavailableFact({
      id: 'u6',
      subject: 'CTRL could not inspect your local projects.',
      reason: 'workspaces unavailable',
      retryable: true,
      dismissible: false,
    });
    expect(fact.options.map((option) => option.id)).toEqual(['retry']);
    expect(safeDefaultOption(fact)?.id).toBe('retry');
  });

  it('keeps dismissal by default so an incidental failure can be waved away', () => {
    const fact = unavailableFact({
      id: 'u7',
      subject: 'Something transient failed.',
      reason: 'timeout',
      retryable: true,
    });
    expect(fact.options.map((option) => option.id)).toEqual(['dismiss', 'retry']);
  });

  it('never carries a decision-critical fact only in provenance', () => {
    // A surface may collapse provenance, so a fact needed to choose must also be
    // stated in the subject or in `facts`.
    const fact = unavailableFact({
      id: 'u5',
      subject: 'Irisy could not switch to this resource.',
      reason: 'engine reset failed',
      retryable: true,
    });
    expect(fact.subject.length).toBeGreaterThan(0);
    expect(fact.options.some((option) => option.consequence === 'retries')).toBe(true);
  });

  it('exposes the reason as provenance rather than the headline', () => {
    const fact = unavailableFact({
      id: 'u4',
      subject: 'Cannot reach the app',
      reason: 'bridge closed',
      retryable: true,
    });
    expect(fact.subject).not.toContain('bridge closed');
    expect(fact.provenance).toEqual([{ label: 'Reason', value: 'bridge closed' }]);
  });
});

describe('conflict fact', () => {
  it('shows expected versus current and offers a review path', () => {
    const fact = conflictFact({
      id: 'c1',
      subject: 'The selection changed, so nothing was written.',
      target: 'Sheet1!A19:D19',
      expected: 'rev-0182',
      current: 'rev-0183',
    });
    expect(fact.kind).toBe('conflict');
    expect(fact.staged).toEqual({ before: 'rev-0182', after: 'rev-0183' });
    expect(fact.retryable).toBe(true);
    expect(fact.options.map((option) => option.id)).toEqual(['dismiss', 'review']);
    expect(safeDefaultOption(fact)?.id).toBe('dismiss');
  });

  it('renders a conflict inline with staged facts and preconditions visible', () => {
    const presentation = decisionPresentation('conflict');
    expect(presentation.placement).toBe('inline');
    expect(presentation.showsStagedChange).toBe(true);
    expect(presentation.showsPreconditions).toBe(true);
  });
});
