// ProvenanceDrillDown — the transparency strip under a rendered Resource.
//
// Collapsed it states only what is decision-relevant at a glance (content type,
// short revision, a stale warning when the kernel reports one). Expanded it
// shows the descriptor facts verbatim and the upstream ref chain, each of which
// can be opened in place so the user can walk a result back to the local source
// it was projected from.
//
// It renders only kernel-sent facts. A field the descriptor omitted is reported
// as absent, because a plausible-looking default here would be indistinguishable
// from a real observation.
// (ADR-002 substrate §15 v83; ADR-003 frontend §8.5 v44; ADR-005 irisy §12 v42 U11)

import type { ReactElement } from 'react';
import type { ProvenanceReport } from '@/lib/provenance';
import styles from './ProvenanceDrillDown.module.css';

interface ProvenanceDrillDownProps {
  report: ProvenanceReport;
  /** Open an upstream ref in place. Omitted when the host cannot navigate. */
  onOpenSource?: (resourceRef: string) => void;
  /** Return to the Resource the user drilled in from. */
  onBack?: () => void;
}

const shortRevision = (value: string): string =>
  value.length > 12 ? `${value.slice(0, 12)}…` : value;

export function ProvenanceDrillDown({
  report,
  onOpenSource,
  onBack,
}: ProvenanceDrillDownProps): ReactElement {
  const revision = report.facts.find((fact) => fact.label === 'Revision');

  return (
    <details className={styles.root} data-testid="provenance-drilldown">
      <summary className={styles.summary}>
        <span className={styles.summaryLabel}>Source</span>
        <span className={styles.summaryRef} title={report.resource}>
          {report.resource}
        </span>
        {revision ? (
          <span className={styles.summaryRevision}>rev {shortRevision(revision.value)}</span>
        ) : null}
        {report.stale ? (
          <span className={styles.summaryStale} data-testid="provenance-stale">
            stale
          </span>
        ) : null}
        {onBack ? (
          <button
            type="button"
            className={styles.back}
            data-testid="provenance-back"
            onClick={(event) => {
              // The summary would otherwise toggle the disclosure.
              event.preventDefault();
              event.stopPropagation();
              onBack();
            }}
          >
            Back
          </button>
        ) : null}
      </summary>

      <div className={styles.body}>
        {report.degradation ? (
          <p className={styles.degradation} role="status">
            <span className={styles.degradationCode}>{report.degradation.code}</span>
            {report.degradation.summary}
            {report.degradation.retryable ? ' (retryable)' : ''}
          </p>
        ) : null}

        <dl className={styles.facts}>
          {report.facts.map((fact) => (
            <div className={styles.factRow} key={fact.label}>
              <dt className={styles.factLabel}>{fact.label}</dt>
              <dd className={styles.factValue}>{fact.value}</dd>
            </div>
          ))}
        </dl>

        <div className={styles.sources} data-testid="provenance-sources">
          <span className={styles.sourcesLabel}>Derived from</span>
          {report.sources.length === 0 ? (
            <span className={styles.sourcesEmpty}>
              nothing — this is the original local source
            </span>
          ) : (
            <ul className={styles.sourcesList}>
              {report.sources.map((ref) => (
                <li key={ref}>
                  {onOpenSource ? (
                    <button
                      type="button"
                      className={styles.sourceLink}
                      onClick={() => onOpenSource(ref)}
                    >
                      {ref}
                    </button>
                  ) : (
                    <span className={styles.sourceRef}>{ref}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
}
