// classifyIntent — the routing pill's keyword pass (ADR-003 §8.2B / §8.3).
// Pins the visible-intent contract: narrow verbs beat the broad 'draft'
// catch-all, a plain question still surfaces "Answering" (never hidden), and
// empty input is safe.

import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intent-routing';

describe('classifyIntent', () => {
  it('defaults a plain question to Answering (routing is never hidden)', () => {
    expect(classifyIntent('what is the capital of France?')).toEqual({
      kind: 'answer',
      label: 'Answering',
    });
  });

  it('reads a build request as Drafting', () => {
    expect(classifyIntent('write me a login page').label).toBe('Drafting');
    expect(classifyIntent('build a react component for a navbar').kind).toBe('draft');
  });

  it('detects translate / summarize / polish / extract / plan', () => {
    expect(classifyIntent('translate this into Spanish').kind).toBe('translate');
    expect(classifyIntent('give me a tldr of this thread').kind).toBe('summarize');
    expect(classifyIntent('proofread and rephrase this paragraph').kind).toBe('polish');
    expect(classifyIntent('extract the action items from these notes').kind).toBe('extract');
    expect(classifyIntent('outline a step-by-step plan').kind).toBe('plan');
  });

  it('lets a narrow verb win over the broad draft catch-all', () => {
    // "summarize ... write-up" contains a draft-ish noun but the intent is to
    // summarize — the narrow rule is ordered first, so it wins.
    expect(classifyIntent('summarize the write-up below').kind).toBe('summarize');
  });

  it('is safe on empty / whitespace input', () => {
    expect(classifyIntent('   ').kind).toBe('answer');
    expect(classifyIntent('')).toEqual({ kind: 'answer', label: 'Answering' });
  });
});
