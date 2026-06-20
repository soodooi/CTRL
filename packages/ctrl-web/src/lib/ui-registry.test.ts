import { describe, it, expect, vi } from 'vitest';

// ui-registry.tsx imports mermaid (browser-only) at module load; stub it so the
// pure detectPart logic can be tested in the node environment.
vi.mock('mermaid', () => ({
  default: { initialize: () => {}, render: async () => ({ svg: '' }) },
}));

const { detectPart } = await import('./ui-registry');

describe('detectPart — output routing to the workspace pane', () => {
  it('routes a fenced HTML block to an html part', () => {
    const p = detectPart('Here you go:\n\n```html\n<h1>Hi</h1>\n```');
    expect(p).toMatchObject({ kind: 'html' });
  });

  it('routes a raw (unfenced) HTML page to an html part', () => {
    const p = detectPart('<!DOCTYPE html>\n<html><body><h1>Poster</h1></body></html>');
    expect(p).toMatchObject({ kind: 'html' });
  });

  it('routes a long markdown document to a markdown part with a title', () => {
    const doc =
      '# Quarterly Plan\n\n' +
      'Intro paragraph.\n\n## Goals\n' +
      'Lorem ipsum dolor sit amet, '.repeat(40) +
      '\n\n## Risks\nmore text here.';
    const p = detectPart(doc);
    expect(p?.kind).toBe('markdown');
    expect(p?.title).toBe('Quarterly Plan');
    expect(p?.content).toContain('## Goals');
  });

  it('routes a JSON array to a table part', () => {
    const p = detectPart('```json\n[{"a":1},{"a":2}]\n```');
    expect(p).toMatchObject({ kind: 'table' });
  });

  it('leaves a short chat reply in the bubble (no part)', () => {
    expect(detectPart('Sure, the capital of France is Paris.')).toBeNull();
  });

  it('does not promote a short heading-only reply', () => {
    expect(detectPart('# Hi\nshort answer')).toBeNull();
  });
});
