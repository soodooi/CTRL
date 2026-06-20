import { describe, it, expect, vi } from 'vitest';

// ui-registry.tsx imports mermaid (browser-only) at module load; stub it so the
// pure detectPart / stripDetectedPart logic can be tested in node.
vi.mock('mermaid', () => ({
  default: { initialize: () => {}, render: async () => ({ svg: '' }) },
}));

const { detectPart, stripDetectedPart, splitStreamingArtifact } = await import(
  './ui-registry'
);

describe('detectPart — deterministic artifact routing (model-declared)', () => {
  it('routes a fenced HTML block to an html part', () => {
    expect(detectPart('Here:\n\n```html\n<h1>Hi</h1>\n```')).toMatchObject({
      kind: 'html',
    });
  });

  it('routes a raw (unfenced) HTML page to an html part', () => {
    expect(
      detectPart('<!DOCTYPE html>\n<html><body><h1>Poster</h1></body></html>'),
    ).toMatchObject({ kind: 'html' });
  });

  it('routes a fenced markdown document to a markdown part with a title', () => {
    const p = detectPart(
      "Drafted it:\n\n```markdown\n# Quarterly Plan\n\n## Goals\nship it\n```",
    );
    expect(p?.kind).toBe('markdown');
    expect(p?.title).toBe('Quarterly Plan');
  });

  it('captures a FULL markdown doc that contains nested ``` code blocks', () => {
    const reply =
      'Drafted it:\n\n```markdown\n# Guide\n\n## Example\n' +
      '```python\nprint("hi")\n```\n\n## Wrap up\nthe end.\n```';
    const p = detectPart(reply);
    expect(p?.kind).toBe('markdown');
    // must reach past the nested code block to the real closing fence
    expect(p?.content).toContain('Wrap up');
    expect(p?.content).toContain('print("hi")');
  });

  it('accepts the ```md alias', () => {
    expect(detectPart('```md\n# Title\nbody\n```')).toMatchObject({
      kind: 'markdown',
    });
  });

  it('routes a JSON array to a table part', () => {
    expect(detectPart('```json\n[{"a":1},{"a":2}]\n```')).toMatchObject({
      kind: 'table',
    });
  });

  it('does NOT guess from length — unfenced long prose stays in chat', () => {
    const longProse =
      '# Heading\n\n' + 'Lorem ipsum dolor sit amet. '.repeat(80);
    expect(detectPart(longProse)).toBeNull();
  });

  it('leaves a short chat reply in the bubble', () => {
    expect(detectPart('The capital of France is Paris.')).toBeNull();
  });
});

describe('splitStreamingArtifact — real-time routing to the workspace', () => {
  it('separates intro from an OPEN (not yet closed) markdown fence mid-stream', () => {
    const partial = 'Drafting it:\n\n```markdown\n# Plan\n\n## Goals\nstill writing';
    const s = splitStreamingArtifact(partial);
    expect(s?.part.kind).toBe('markdown');
    expect(s?.intro).toBe('Drafting it:');
    expect(s?.part.content).toContain('## Goals');
    expect(s?.part.content).not.toContain('```'); // body only, no fence markers
  });

  it('routes an open HTML fence mid-stream', () => {
    const s = splitStreamingArtifact('Here:\n```html\n<h1>partial');
    expect(s?.part.kind).toBe('html');
    expect(s?.part.content).toContain('<h1>partial');
  });

  it('routes a raw HTML page with no intro', () => {
    const s = splitStreamingArtifact('<!DOCTYPE html>\n<html><body>');
    expect(s?.part.kind).toBe('html');
    expect(s?.intro).toBe('');
  });

  it('returns null for plain prose (keeps streaming into chat)', () => {
    expect(splitStreamingArtifact('Sure, here is a quick answer about')).toBeNull();
  });

  it('returns null for a plain ``` / ```text fence (not an artifact)', () => {
    expect(splitStreamingArtifact('see:\n```\nplain\n```')).toBeNull();
  });
});

describe('stripDetectedPart — de-duplicate the promoted block from chat', () => {
  it('removes a promoted fence, keeping the intro prose', () => {
    const reply = 'Drafted your report:\n\n```markdown\n# Report\nbody\n```';
    const shown = stripDetectedPart(reply);
    expect(shown).toBe('Drafted your report:');
    expect(shown).not.toContain('# Report');
  });

  it('returns empty when the whole reply was a raw HTML page', () => {
    expect(stripDetectedPart('<!DOCTYPE html>\n<html></html>')).toBe('');
  });

  it('leaves a non-artifact reply untouched', () => {
    expect(stripDetectedPart('Just a chat answer.')).toBe('Just a chat answer.');
  });
});
