// note-write contract. These tests exist to pin the one property that matters:
// the surface may only report a verified save when the kernel proved it, and a
// typed conflict must stay a conflict rather than collapsing into an error
// string. (ADR-002 substrate §15.2 v87; §15.5 v86; ADR-005 irisy §12 v42 U6)

import { describe, expect, it } from 'vitest';
import { interpretNoteWrite, noteResourceRef } from './note-write';

describe('noteResourceRef', () => {
  it('builds a canonical local note ref from a vault path', () => {
    expect(noteResourceRef('Budget.md')).toBe('ctrl://local/note/Budget.md');
  });

  it('keeps nested paths as separate id segments', () => {
    expect(noteResourceRef('work/2026/Budget.md')).toBe(
      'ctrl://local/note/work/2026/Budget.md',
    );
  });

  it('encodes each segment independently so a name cannot widen the identity', () => {
    // A literal separator inside a name must not become a new segment.
    expect(noteResourceRef('odd name/a b.md')).toBe(
      'ctrl://local/note/odd%20name/a%20b.md',
    );
  });

  it('ignores empty segments from leading or duplicated separators', () => {
    expect(noteResourceRef('/work//Budget.md')).toBe('ctrl://local/note/work/Budget.md');
  });

  it('refuses a path with no segments rather than addressing the note root', () => {
    expect(() => noteResourceRef('/')).toThrow(/at least one path segment/);
  });
});

describe('interpretNoteWrite', () => {
  it('reports verified only with the kernel post-write proof', () => {
    const result = interpretNoteWrite({
      effect: { summary: 'replaced the note content', verified_by: 'post-write reread matched' },
      result: { revision: 'rev-2' },
    });
    expect(result).toEqual({
      status: 'verified',
      revision: 'rev-2',
      verifiedBy: 'post-write reread matched',
      summary: 'replaced the note content',
    });
  });

  it('treats a missing verification as unknown, never as success', () => {
    const result = interpretNoteWrite({ effect: { summary: 'wrote' } });
    expect(result).toEqual({
      status: 'failed',
      code: 'unverified',
      message: 'the kernel returned no verification for this write',
      retryable: true,
    });
  });

  it('treats an empty Outcome as unverified rather than a silent success', () => {
    expect(interpretNoteWrite({}).status).toBe('failed');
  });

  it('keeps a precondition failure typed, with both revision operands', () => {
    const result = interpretNoteWrite({
      feedback: {
        code: 'precondition_failed',
        message: 'the note changed since it was staged; nothing was written',
        retryable: true,
        field: 'expected_revision',
        details: { expected: 'rev-1', actual: 'rev-9' },
      },
    });
    expect(result).toEqual({
      status: 'conflict',
      expected: 'rev-1',
      actual: 'rev-9',
      message: 'the note changed since it was staged; nothing was written',
    });
  });

  it('reports unknown operands instead of inventing a revision', () => {
    const result = interpretNoteWrite({
      feedback: { code: 'precondition_failed', message: 'stale', details: {} },
    });
    expect(result).toMatchObject({ status: 'conflict', expected: 'unknown', actual: 'unknown' });
  });

  it('passes a rollback failure through with its own code and retryability', () => {
    const result = interpretNoteWrite({
      feedback: {
        code: 'rollback_failed',
        message: 'the note could not be verified or restored',
        retryable: false,
      },
    });
    expect(result).toEqual({
      status: 'failed',
      code: 'rollback_failed',
      message: 'the note could not be verified or restored',
      retryable: false,
    });
  });

  it('defaults retryability to false when the kernel did not say', () => {
    const result = interpretNoteWrite({ feedback: { code: 'write_failed', message: 'x' } });
    expect(result).toMatchObject({ status: 'failed', retryable: false });
  });

  it('prefers feedback over a stray effect so a rolled-back write never reads as saved', () => {
    const result = interpretNoteWrite({
      effect: { verified_by: 'should be ignored' },
      feedback: { code: 'write_rolled_back', message: 'restored previous content', retryable: true },
    });
    expect(result.status).toBe('failed');
  });
});

describe('canonical ref classification', () => {
  it('routes a ResourceRef to the governed read path, not the asset scheme', async () => {
    const { classifyUri } = await import('./viewer-uri');
    expect(classifyUri('ctrl://local/note/Budget.md')).toBe('resource');
    // The pre-existing schemes keep their own dispatch.
    expect(classifyUri('vault://Budget.md')).toBe('vault');
    expect(classifyUri('https://example.com/a.md')).toBe('http');
  });

  it('still reports a genuinely unknown scheme as unknown', async () => {
    const { classifyUri } = await import('./viewer-uri');
    expect(classifyUri('gopher://example.com')).toBe('unknown');
  });
});
