// diagnostics-view — projections for the local diagnostics client.
//
// The kernel already composes typed status, smoke checks, trace events, and an
// export PREVIEW, and every one of those commands had no consumer: the accepted
// surface was simply unmounted. These are the pure projections the panel renders,
// kept out of the component so the honest-reporting rules are testable.
//
// Two rules matter here and are enforced by tests: a field the kernel did not
// send is omitted rather than shown as a plausible zero, and capture/export state
// is reported exactly as the kernel described it — this surface never implies a
// capture is running or that data left the machine.
// (ADR-003 frontend § diagnostics-surface v26; ADR-005 irisy §12 v42 U21)

import type {
  DiagnosticsEvent,
  DiagnosticsExportPreview,
  DiagnosticsStatus,
} from './kernel';

export interface DiagnosticsFact {
  label: string;
  value: string;
}

/** A timestamp the kernel did not send, or sent unparseably, reads as unknown.
 *  A diagnostics surface that crashes on malformed input is the one place that
 *  cannot afford to. */
const formatTime = (millis: unknown): string => {
  if (typeof millis !== 'number' || !Number.isFinite(millis)) return 'unknown';
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toISOString().replace('T', ' ').replace(/\..*$/, 'Z');
};

/** Status -> the facts a developer needs before reading any trace. */
export function diagnosticsStatusFacts(status: DiagnosticsStatus): DiagnosticsFact[] {
  const facts: DiagnosticsFact[] = [
    { label: 'Health', value: status.health },
    { label: 'Startup', value: status.startup },
    // `live` and `ready` answer different questions; collapsing them would hide
    // the "running but not usable yet" state this surface exists to show.
    { label: 'Live', value: status.live ? 'yes' : 'no' },
    { label: 'Ready', value: status.ready ? 'yes' : 'no' },
  ];
  if (status.summary) facts.push({ label: 'Summary', value: status.summary });
  facts.push({ label: 'Retained events', value: String(status.retained_events) });
  facts.push({
    label: 'Capture',
    value: status.capture_active
      ? status.capture_expires_at_ms
        ? `active until ${formatTime(status.capture_expires_at_ms)}`
        : 'active'
      : 'off',
  });
  facts.push({ label: 'Observed at', value: formatTime(status.observed_at_ms) });
  return facts;
}

export interface TraceRow {
  id: string;
  time: string;
  kind: string;
  phase: string;
  outcome: string;
  severity: string;
  /** Empty when the kernel reported no duration, never a fabricated 0ms. */
  duration: string;
  correlation: string;
}

/** Trace events -> display rows, newest first. */
export function diagnosticsTraceRows(events: readonly DiagnosticsEvent[]): TraceRow[] {
  return events
    .slice()
    .sort((left, right) => right.timestamp_ms - left.timestamp_ms)
    .map((event, index) => ({
      id: `${event.trace_id}:${event.timestamp_ms}:${index}`,
      time: formatTime(event.timestamp_ms),
      kind: event.kind,
      phase: event.phase,
      outcome: event.outcome,
      severity: event.severity,
      duration:
        typeof event.duration_ms === 'number' ? `${event.duration_ms}ms` : '',
      correlation: event.correlation_id ?? '',
    }));
}

/** Export preview -> what the user is about to write, stated plainly. Nothing
 *  here performs an export; the kernel's preview is metadata only and the
 *  destination is a file the user picks. */
export function diagnosticsExportFacts(preview: DiagnosticsExportPreview): DiagnosticsFact[] {
  return [
    { label: 'Contents', value: preview.metadata_only ? 'metadata only' : 'unknown' },
    {
      label: 'Destination',
      value:
        preview.destination === 'local_user_selected_file'
          ? 'a local file you choose'
          : preview.destination,
    },
    { label: 'Estimated size', value: `${preview.estimated_bytes} bytes` },
    { label: 'Events included', value: String(preview.trace.events.length) },
    { label: 'Generated at', value: formatTime(preview.generated_at_ms) },
  ];
}
