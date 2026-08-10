// provenance projection contract. The point of these tests is that the report
// says only what the kernel said: an omitted field must read as absent, never as
// a plausible observation.
// (ADR-002 substrate §15 v83; ADR-005 irisy §12 v42 U11)

import { describe, expect, it } from 'vitest';
import { provenanceReport } from './provenance';
import type { CanonicalResourceDescriptor } from './kernel';

const descriptor = (
  overrides: Partial<CanonicalResourceDescriptor> = {},
): CanonicalResourceDescriptor => ({
  protocol_version: '1',
  resource: 'ctrl://local/note/Budget.md',
  content_type: 'text/markdown',
  presentation: { preferred_columns: [] },
  ...overrides,
});

describe('provenanceReport', () => {
  it('carries the canonical ref verbatim so the user can address it elsewhere', () => {
    const report = provenanceReport(descriptor({ resource: 'ctrl://local/note/a%2Fb.md' }));
    expect(report.resource).toBe('ctrl://local/note/a%2Fb.md');
  });

  it('reports revision and observation time when the kernel sent them', () => {
    const report = provenanceReport(
      descriptor({
        freshness: { revision: 'rev-0182', observed_at: '2026-08-05T10:00:00Z', stale: false },
      }),
    );
    expect(report.facts).toEqual(
      expect.arrayContaining([
        { label: 'Revision', value: 'rev-0182' },
        { label: 'Observed at', value: '2026-08-05T10:00:00Z' },
        { label: 'Freshness', value: 'current' },
      ]),
    );
  });

  it('distinguishes unreported freshness from current freshness', () => {
    const report = provenanceReport(descriptor());
    expect(report.facts).toEqual(
      expect.arrayContaining([{ label: 'Freshness', value: 'not reported' }]),
    );
    expect(report.stale).toBe(false);
  });

  it('surfaces kernel-reported staleness', () => {
    const report = provenanceReport(
      descriptor({ freshness: { revision: null, observed_at: null, stale: true } }),
    );
    expect(report.stale).toBe(true);
    expect(report.facts).toEqual(
      expect.arrayContaining([{ label: 'Freshness', value: 'stale — behind its source' }]),
    );
  });

  it('omits revision and observation rows the kernel did not send', () => {
    const report = provenanceReport(descriptor());
    expect(report.facts.map((fact) => fact.label)).not.toContain('Revision');
    expect(report.facts.map((fact) => fact.label)).not.toContain('Observed at');
  });

  it('passes degradation through verbatim, including retryability', () => {
    const degradation = { code: 'source_unreachable', summary: 'Source did not answer', retryable: true };
    const report = provenanceReport(descriptor({ degradation }));
    expect(report.degradation).toEqual(degradation);
  });

  it('reports an empty provenance chain as the original source', () => {
    expect(provenanceReport(descriptor()).sources).toEqual([]);
  });

  it('exposes the upstream ref chain for drill-down', () => {
    const report = provenanceReport(
      descriptor({ provenance: ['ctrl://local/file/raw.csv', 'ctrl://local/note/Notes.md'] }),
    );
    expect(report.sources).toEqual([
      'ctrl://local/file/raw.csv',
      'ctrl://local/note/Notes.md',
    ]);
  });
});
