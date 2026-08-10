// Sources contract. The rule these tests defend: a passage is never presented
// without the note it came from, and an external result is never presented
// without a checkable URL and the provider that answered.
// (ADR-002 substrate §1.9 v46; ADR-005 irisy §12 v42 U3/U4/U7)

import { describe, expect, it } from 'vitest';
import {
  hitResourceRef,
  normalizeExternalLookup,
  normalizeLocalHits,
  sourceHost,
} from './sources';

describe('normalizeLocalHits', () => {
  it('keeps the path and the matched passage together', () => {
    expect(
      normalizeLocalHits([{ path: 'Notes/Budget.md', context: '…revenue rose…' }]),
    ).toEqual([{ path: 'Notes/Budget.md', context: '…revenue rose…' }]);
  });

  it('accepts the back-compat shape of plain path strings', () => {
    expect(normalizeLocalHits(['Notes/A.md', 'Notes/B.md'])).toEqual([
      { path: 'Notes/A.md' },
      { path: 'Notes/B.md' },
    ]);
  });

  it('omits an absent passage rather than inventing an empty one', () => {
    const [hit] = normalizeLocalHits([{ path: 'Notes/A.md' }]);
    expect(hit).toEqual({ path: 'Notes/A.md' });
    expect('context' in (hit ?? {})).toBe(false);
  });

  it('drops a row with no path, because a passage with no source is not a citation', () => {
    expect(normalizeLocalHits([{ context: 'orphan passage' }])).toEqual([]);
    expect(normalizeLocalHits([{ path: '   ', context: 'blank source' }])).toEqual([]);
  });

  it('treats a non-list reply as no hits rather than crashing the surface', () => {
    expect(normalizeLocalHits(null)).toEqual([]);
    expect(normalizeLocalHits({ hits: [] })).toEqual([]);
  });
});

describe('hitResourceRef', () => {
  it('addresses a hit as a canonical Resource so opening it uses one path', () => {
    expect(hitResourceRef({ path: 'Notes/Budget.md' })).toBe(
      'ctrl://local/note/Notes/Budget.md',
    );
  });

  it('encodes each segment, so a space in a name cannot widen the identity', () => {
    expect(hitResourceRef({ path: 'My Notes/Q3 Budget.md' })).toBe(
      'ctrl://local/note/My%20Notes/Q3%20Budget.md',
    );
  });
});

describe('normalizeExternalLookup', () => {
  it('names the provider that actually answered', () => {
    const lookup = normalizeExternalLookup({ source: 'tavily', results: [] });
    expect(lookup.provider).toBe('tavily');
  });

  it('reports an unnamed provider as unknown rather than guessing one', () => {
    expect(normalizeExternalLookup({ results: [] }).provider).toBe('unknown');
  });

  it('keeps the kernel degradation note when it degraded', () => {
    const lookup = normalizeExternalLookup({
      source: 'duckduckgo',
      results: [],
      note: 'no keyed provider configured',
    });
    expect(lookup.note).toBe('no keyed provider configured');
  });

  it('omits an absent note instead of an empty string', () => {
    expect(normalizeExternalLookup({ source: 'x', results: [] }).note).toBeUndefined();
  });

  it('drops a result without a URL, because it cannot be checked', () => {
    const lookup = normalizeExternalLookup({
      source: 'x',
      results: [{ title: 'No link', snippet: 'trust me' }, { url: 'https://a.test/p' }],
    });
    expect(lookup.results).toEqual([{ title: 'https://a.test/p', url: 'https://a.test/p' }]);
  });

  it('falls back to the URL as the title rather than showing an untitled row', () => {
    const lookup = normalizeExternalLookup({
      source: 'x',
      results: [{ url: 'https://a.test/page' }],
    });
    expect(lookup.results[0]?.title).toBe('https://a.test/page');
  });

  it('survives a malformed envelope', () => {
    expect(normalizeExternalLookup(null)).toEqual({ provider: 'unknown', results: [] });
    expect(normalizeExternalLookup({ results: 'nope' }).results).toEqual([]);
  });
});

describe('sourceHost', () => {
  it('shows the host so a source can be judged at a glance', () => {
    expect(sourceHost('https://en.wikipedia.org/wiki/X')).toBe('en.wikipedia.org');
  });

  it('reports an unparseable URL as-is rather than hiding it', () => {
    expect(sourceHost('not a url')).toBe('not a url');
  });
});
