// Turn grounding contract. If the user's opened Resource does not reach the
// request, an answer from the model's memory looks exactly like one read out of
// the user's own file — so these assertions are the difference between grounded
// and plausible.
// (ADR-002 substrate §15.4 v84; ADR-005 irisy §11 v40, §12 v42 U1)

import { describe, expect, it } from 'vitest';
import { autoProjection, buildTurnContext, BASE_TURN_SCOPE } from './irisy-turn';
import type { FctSelectionProjection } from './fct';

const NOTE = 'ctrl://local/note/Budget.md';
const TABLE = 'ctrl://local/smart-table/Spend.md';

const projection = (
  overrides: Partial<FctSelectionProjection> = {},
): FctSelectionProjection => ({ ...autoProjection(), ...overrides });

describe('autoProjection', () => {
  it('grants exactly the three canonical verbs and no more', () => {
    expect(autoProjection().capability_scope).toEqual(BASE_TURN_SCOPE);
  });

  it('adds no Resources of its own', () => {
    expect(autoProjection().resources).toEqual([]);
  });

  it('is a fresh object each call, so one turn cannot mutate the next', () => {
    const first = autoProjection();
    first.capability_scope.push('tool:sneaky');
    expect(autoProjection().capability_scope).toEqual(BASE_TURN_SCOPE);
  });
});

describe('buildTurnContext', () => {
  it('carries the explicitly opened Resource, so the answer can be grounded', () => {
    const context = buildTurnContext({
      sessionId: 'session-a',
      workResources: [NOTE],
      projection: projection(),
      task: 'What does this say?',
    });
    expect(context.resources).toEqual([NOTE]);
    expect(context.session_id).toBe('session-a');
    expect(context.task).toBe('What does this say?');
  });

  it('never sends an empty Resource list when the user has something open', () => {
    const context = buildTurnContext({
      sessionId: 's',
      workResources: [NOTE, TABLE],
      projection: projection(),
      task: 't',
    });
    expect(context.resources).toContain(NOTE);
    expect(context.resources).toContain(TABLE);
  });

  it('keeps the user’s Resources first when an FCT appends dependencies', () => {
    const context = buildTurnContext({
      sessionId: 's',
      workResources: [NOTE],
      projection: projection({ resources: ['ctrl://local/note/Method.md'] }),
      task: 't',
    });
    expect(context.resources[0]).toBe(NOTE);
    expect(context.resources).toHaveLength(2);
  });

  it('deduplicates a dependency the user already has open', () => {
    const context = buildTurnContext({
      sessionId: 's',
      workResources: [NOTE],
      projection: projection({ resources: [NOTE] }),
      task: 't',
    });
    expect(context.resources).toEqual([NOTE]);
  });

  it('an FCT can never replace what the user has open', () => {
    const context = buildTurnContext({
      sessionId: 's',
      workResources: [NOTE],
      projection: projection({ resources: [TABLE] }),
      task: 't',
    });
    expect(context.resources).toContain(NOTE);
  });

  it('passes the projection’s scope through without widening it', () => {
    const context = buildTurnContext({
      sessionId: 's',
      workResources: [],
      projection: projection({
        capability_scope: [...BASE_TURN_SCOPE, 'tool:office_read'],
      }),
      task: 't',
    });
    expect(context.capability_scope).toEqual([...BASE_TURN_SCOPE, 'tool:office_read']);
    // A wildcard would mean the turn was never scoped at all.
    expect(context.capability_scope).not.toContain('*');
  });

  it('carries the selected Skill only when the projection resolved one', () => {
    expect(
      buildTurnContext({
        sessionId: 's',
        workResources: [],
        projection: projection(),
        task: 't',
      }).skill_id,
    ).toBeUndefined();
    expect(
      buildTurnContext({
        sessionId: 's',
        workResources: [],
        projection: projection({ skill_id: 'office' }),
        task: 't',
      }).skill_id,
    ).toBe('office');
  });

  it('sends the user’s words verbatim, not a rewritten task', () => {
    const task = '  Summarize   this, please.  ';
    expect(
      buildTurnContext({
        sessionId: 's',
        workResources: [],
        projection: projection(),
        task,
      }).task,
    ).toBe(task);
  });

  it('reports the policy the projection declared', () => {
    expect(
      buildTurnContext({
        sessionId: 's',
        workResources: [],
        projection: projection({ policy: 'review-gated-writes' }),
        task: 't',
      }).policy,
    ).toBe('review-gated-writes');
  });
});
