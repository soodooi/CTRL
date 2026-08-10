// Read-only Project Resource viewer selected by the canonical descriptor's
// application/vnd.ctrl.project+json content type.
// (ADR-002 substrate §15 v83; ADR-003 frontend §8.5 v40)

import { useEffect, useState, type ReactElement } from 'react';
import { queryResource } from '@/lib/kernel';
import type { ViewerProps } from '@/lib/viewer-registry';
import { DecisionSurface } from '@/components/decisions/DecisionSurface';
import { unavailableFact } from '@/lib/decision-registry';
import styles from './Viewer.module.css';

interface ProjectSummary {
  resource: string;
  content_type: 'application/vnd.ctrl.project+json';
  title: string;
}

export function ProjectViewer({ resource }: ViewerProps): ReactElement {
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Retry re-runs this viewer's own read. Reloading the app would be a far
  // heavier recovery than the failure warrants.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setError(null);
    void queryResource<ProjectSummary>(resource.uri)
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [resource.uri, attempt]);

  return (
    <div className={styles.frame}>
      <div className={styles.meta}>
        <span className={styles.metaLocation}>Project</span>
        <span className={styles.metaPath}>{resource.uri}</span>
        <span className={styles.metaSpacer} />
        <span className={styles.metaReadOnly}>read-only</span>
      </div>
      <div className={styles.fallback}>
        {error ? (
          // The owner's reason is drill-down, not the headline; the viewer says
          // plainly what it cannot show.
          // (ADR-003 frontend § decision-registry v44; ADR-005 §12 U9)
          <DecisionSurface
            fact={unavailableFact({
              id: `project-viewer-${resource.uri}`,
              subject: 'This project could not be read.',
              target: resource.uri,
              reason: error,
              retryable: true,
              dismissible: false,
            })}
            onResolve={() => setAttempt((value) => value + 1)}
          />
        ) : summary ? (
          <>
            <div className={styles.fallbackKind}>{summary.title}</div>
            <p className={styles.fallbackHint}>This explicit Project Resource is active in Irisy.</p>
          </>
        ) : (
          <p className={styles.fallbackHint} role="status">Loading Project…</p>
        )}
      </div>
    </div>
  );
}
