// PackEvals — presentational evals result for the pack-authoring flow (ADR-002
// §7.4/§7.5 mcp-builder review+evals). Renders a PackValidationReport: a clean
// pass line, or a list of structured issues (error/warn + field + fix). Pure, so
// it visually verifies at /pack-lab with mock reports (the live validate path
// needs the kernel).

import { type ReactElement } from 'react';
import type { PackValidationReport } from '@/lib/kernel';
import styles from './PackEvals.module.css';

export function PackEvals({ report }: { report: PackValidationReport }): ReactElement {
  const errors = report.issues.filter((i) => i.severity === 'error');
  const warns = report.issues.filter((i) => i.severity === 'warn');

  if (errors.length === 0 && warns.length === 0) {
    return (
      <div className={styles.evals}>
        <div className={styles.evalOk}>
          ✓ Checks passed
          {report.record_source_fields != null && ` — ${report.record_source_fields} data fields`}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.evals}>
      <ul className={styles.issues}>
        {errors.concat(warns).map((iss, i) => (
          <li key={i} className={iss.severity === 'error' ? styles.issueError : styles.issueWarn}>
            <span className={styles.issueField}>{iss.field}</span> {iss.message}
            {iss.fix != null && <span className={styles.issueFix}> → {iss.fix}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
