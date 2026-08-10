// Diagnostics projection contract. The rules under test are the honest ones:
// absent facts are omitted rather than shown as zeros, `live` and `ready` stay
// distinguishable, and capture/export state is never implied.
// (ADR-003 frontend § diagnostics-surface v26; ADR-005 irisy §12 v42 U21)

import { describe, expect, it } from 'vitest';
import {
  diagnosticsExportFacts,
  diagnosticsStatusFacts,
  diagnosticsTraceRows,
} from './diagnostics-view';
import type {
  DiagnosticsEvent,
  DiagnosticsExportPreview,
  DiagnosticsStatus,
} from './kernel';

const status = (overrides: Partial<DiagnosticsStatus> = {}): DiagnosticsStatus => ({
  observed_at_ms: Date.UTC(2026, 7, 5, 10, 0, 0),
  module: 'irisy',
  startup: 'ready',
  live: true,
  ready: true,
  health: 'ok',
  summary: 'engine responded',
  capture_active: false,
  retained_events: 12,
  attributes: {},
  ...overrides,
});

const event = (overrides: Partial<DiagnosticsEvent> = {}): DiagnosticsEvent => ({
  timestamp_ms: Date.UTC(2026, 7, 5, 10, 0, 0),
  module: 'irisy',
  trace_id: 'trace-1',
  kind: 'turn',
  phase: 'start',
  severity: 'info',
  outcome: 'ok',
  attributes: {},
  ...overrides,
});

describe('diagnosticsStatusFacts', () => {
  it('keeps live and ready separate so "running but not usable" is visible', () => {
    const facts = diagnosticsStatusFacts(status({ live: true, ready: false }));
    expect(facts).toEqual(
      expect.arrayContaining([
        { label: 'Live', value: 'yes' },
        { label: 'Ready', value: 'no' },
      ]),
    );
  });

  it('reports capture as off when the kernel did not say it was active', () => {
    const facts = diagnosticsStatusFacts(status());
    expect(facts).toEqual(expect.arrayContaining([{ label: 'Capture', value: 'off' }]));
  });

  it('states the capture expiry when the kernel supplied one', () => {
    const facts = diagnosticsStatusFacts(
      status({ capture_active: true, capture_expires_at_ms: Date.UTC(2026, 7, 5, 10, 1, 0) }),
    );
    expect(facts).toEqual(
      expect.arrayContaining([
        { label: 'Capture', value: 'active until 2026-08-05 10:01:00Z' },
      ]),
    );
  });

  it('says active without an expiry rather than inventing one', () => {
    const facts = diagnosticsStatusFacts(status({ capture_active: true }));
    expect(facts).toEqual(expect.arrayContaining([{ label: 'Capture', value: 'active' }]));
  });

  it('omits an empty summary instead of rendering a blank row', () => {
    const facts = diagnosticsStatusFacts(status({ summary: '' }));
    expect(facts.map((fact) => fact.label)).not.toContain('Summary');
  });

  it('reports a zero retained-event count, which is a real observation', () => {
    const facts = diagnosticsStatusFacts(status({ retained_events: 0 }));
    expect(facts).toEqual(
      expect.arrayContaining([{ label: 'Retained events', value: '0' }]),
    );
  });
});

describe('diagnosticsTraceRows', () => {
  it('orders newest first', () => {
    const rows = diagnosticsTraceRows([
      event({ timestamp_ms: 1000, kind: 'older' }),
      event({ timestamp_ms: 2000, kind: 'newer' }),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(['newer', 'older']);
  });

  it('leaves duration empty when the kernel reported none, never 0ms', () => {
    const [row] = diagnosticsTraceRows([event()]);
    expect(row?.duration).toBe('');
  });

  it('shows a real zero duration when the kernel measured one', () => {
    const [row] = diagnosticsTraceRows([event({ duration_ms: 0 })]);
    expect(row?.duration).toBe('0ms');
  });

  it('carries the correlation id when present and empty when not', () => {
    const [withId] = diagnosticsTraceRows([event({ correlation_id: 'corr-9' })]);
    expect(withId?.correlation).toBe('corr-9');
    const [withoutId] = diagnosticsTraceRows([event()]);
    expect(withoutId?.correlation).toBe('');
  });

  it('gives every row a stable distinct key even at identical timestamps', () => {
    const rows = diagnosticsTraceRows([event(), event()]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });

  it('does not mutate the caller array', () => {
    const events = [event({ timestamp_ms: 1 }), event({ timestamp_ms: 2 })];
    diagnosticsTraceRows(events);
    expect(events[0]?.timestamp_ms).toBe(1);
  });
});

describe('diagnosticsExportFacts', () => {
  const preview: DiagnosticsExportPreview = {
    generated_at_ms: Date.UTC(2026, 7, 5, 10, 0, 0),
    module: 'irisy',
    status: status(),
    trace: { module: 'irisy', retention_seconds: 600, capacity: 500, events: [event()] },
    metadata_only: true,
    destination: 'local_user_selected_file',
    estimated_bytes: 2048,
  };

  it('states that the export is metadata only and stays on the machine', () => {
    const facts = diagnosticsExportFacts(preview);
    expect(facts).toEqual(
      expect.arrayContaining([
        { label: 'Contents', value: 'metadata only' },
        { label: 'Destination', value: 'a local file you choose' },
        { label: 'Estimated size', value: '2048 bytes' },
        { label: 'Events included', value: '1' },
      ]),
    );
  });
});

describe('malformed kernel replies', () => {
  it('reports an unknown timestamp instead of crashing the one surface that must not', () => {
    const facts = diagnosticsStatusFacts(
      status({ observed_at_ms: undefined as unknown as number }),
    );
    expect(facts).toEqual(
      expect.arrayContaining([{ label: 'Observed at', value: 'unknown' }]),
    );
  });

  it('falls back to plain active when the expiry is unusable, never a fake date', () => {
    const facts = diagnosticsStatusFacts(
      status({ capture_active: true, capture_expires_at_ms: Number.NaN }),
    );
    expect(facts).toEqual(expect.arrayContaining([{ label: 'Capture', value: 'active' }]));
  });
});
