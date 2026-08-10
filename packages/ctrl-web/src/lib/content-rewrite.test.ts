// Content rewrite contract. The dangerous failure here is applying a change the
// user did not really approve, or applying an empty one — so those are what these
// tests pin, along with the staged text being the real document rather than a
// component-local paraphrase.
// (ADR-002 substrate §15.2 v87; ADR-003 frontend § decision-registry v43;
// ADR-005 irisy §12 v42 U2)

import { describe, expect, it } from 'vitest';
import {
  matchTrailingNewline,
  previewOf,
  rewriteApprovalFact,
  rewriteInstruction,
  rewriteLabel,
  unfence,
  REWRITE_APPLY_OPTION,
  REWRITE_DISCARD_OPTION,
  type RewriteProposal,
} from './content-rewrite';
import { safeDefaultOption } from './decision-registry';

const proposal: RewriteProposal = {
  kind: 'rewrite',
  resource: 'ctrl://local/note/Budget.md',
  target: 'Budget.md',
  revision: 'rev-3',
  before: '# Budget\n\nThe revenue went up by nine percent this quarter.',
  after: '# Budget\n\nRevenue rose nine percent this quarter.',
};

describe('rewriteInstruction', () => {
  it('asks for the document body only, for every kind', () => {
    for (const kind of ['rewrite', 'summarize', 'translate'] as const) {
      const instruction = rewriteInstruction(kind, 'body');
      expect(instruction).toContain('Return ONLY');
      expect(instruction).toContain('body');
    }
  });

  it('preserves structure in every kind, because a rewrite is not a reformat', () => {
    expect(rewriteInstruction('summarize', 'x')).toContain('heading structure');
    expect(rewriteInstruction('translate', 'x')).toContain('Markdown structure');
    expect(rewriteInstruction('rewrite', 'x')).toContain('heading structure');
  });

  it('tells a rewrite to keep every fact', () => {
    expect(rewriteInstruction('rewrite', 'x')).toContain('preserving every fact');
  });
});

describe('unfence', () => {
  it('removes a fence the model added anyway', () => {
    expect(unfence('```markdown\n# Title\n```')).toBe('# Title');
    expect(unfence('```\n# Title\n```')).toBe('# Title');
  });

  it('leaves ordinary content alone, including inner fences', () => {
    const body = '# Title\n\n```js\nconst a = 1;\n```\n\ndone';
    expect(unfence(body)).toBe(body);
  });

  it('trims surrounding whitespace only', () => {
    expect(unfence('  # Title  ')).toBe('# Title');
  });
});

describe('previewOf', () => {
  it('keeps a short document intact', () => {
    expect(previewOf('short')).toBe('short');
  });

  it('truncates visibly and states the real length', () => {
    const preview = previewOf('x'.repeat(1000), 100);
    expect(preview.length).toBeLessThan(160);
    expect(preview).toContain('… (1000 characters)');
  });
});

describe('rewriteApprovalFact', () => {
  it('is an approval decision serving U2', () => {
    const fact = rewriteApprovalFact(proposal);
    expect(fact.kind).toBe('approval');
    expect(fact.intent).toBe('U2');
  });

  it('stages the real document text on both sides', () => {
    const fact = rewriteApprovalFact(proposal);
    expect(fact.staged?.before).toContain('went up by nine percent');
    expect(fact.staged?.after).toContain('rose nine percent');
  });

  it('defaults to discarding, so a stray Enter cannot replace the document', () => {
    const fact = rewriteApprovalFact(proposal);
    expect(safeDefaultOption(fact)?.id).toBe(REWRITE_DISCARD_OPTION);
    const apply = fact.options.find((option) => option.id === REWRITE_APPLY_OPTION);
    expect(apply?.consequence).toBe('commits');
    // Replacing a whole document keeps the danger affordance.
    expect(apply?.destructive).toBe(true);
  });

  it('says plainly that the whole document is replaced', () => {
    const fact = rewriteApprovalFact(proposal);
    expect(fact.facts).toEqual(
      expect.arrayContaining([{ label: 'Replaces', value: 'the whole document' }]),
    );
  });

  it('carries the revision it was proposed against, so a later conflict is explainable', () => {
    expect(rewriteApprovalFact(proposal).preconditions).toEqual([
      { label: 'Revision', value: 'rev-3' },
    ]);
  });

  it('omits the revision precondition rather than inventing one', () => {
    expect(
      rewriteApprovalFact({ ...proposal, revision: undefined }).preconditions,
    ).toEqual([]);
  });

  it('names the operation in the user’s terms for each kind', () => {
    expect(rewriteApprovalFact({ ...proposal, kind: 'summarize' }).subject).toContain(
      'Summarize',
    );
    expect(rewriteApprovalFact({ ...proposal, kind: 'translate' }).subject).toContain(
      'Translate',
    );
    expect(rewriteLabel('rewrite')).toBe('Rewrite');
  });
});

describe('matchTrailingNewline', () => {
  it('keeps a final newline the original had', () => {
    expect(matchTrailingNewline('# Title', '# Old\n')).toBe('# Title\n');
  });

  it('does not add one the original did not have', () => {
    expect(matchTrailingNewline('# Title', '# Old')).toBe('# Title');
  });

  it('collapses several trailing newlines to the original convention', () => {
    expect(matchTrailingNewline('# Title\n\n\n', '# Old\n')).toBe('# Title\n');
    expect(matchTrailingNewline('# Title\n\n\n', '# Old')).toBe('# Title');
  });
});
