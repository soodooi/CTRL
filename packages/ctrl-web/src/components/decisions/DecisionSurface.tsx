// DecisionSurface — renders one pending decision by kind.
//
// A caller supplies a `DecisionFact` adapted from a kernel-typed fact plus a
// resolver; the kind's registered presentation decides modal vs inline, tone,
// and which fact blocks are shown. `facts` are always visible because the user
// needs them to choose; `provenance` is drill-down only.
//
// Migration state (honest): the review gate and the Ambient FCT failure paths
// route through here. `ProviderHub` and `SmartTableViewer` still hand-build
// approval dialogs and are tracked as open Design Acceptance in ADR-003, not
// silently claimed as migrated.
// (ADR-003 frontend § decision-registry v43)

import { useRef, type ReactElement } from 'react';
import { Button } from '../primitives/Button';
import { Modal } from '../primitives/Modal';
import { cx } from '../primitives/cx';
import {
  decisionPresentation,
  safeDefaultOption,
  type DecisionFact,
  type DecisionOption,
  type DecisionResolver,
} from '@/lib/decision-registry';
import styles from './DecisionSurface.module.css';

interface DecisionSurfaceProps {
  fact: DecisionFact;
  onResolve: DecisionResolver;
  /** Disables options while the parent commits the choice. */
  pending?: boolean;
  /** Extra count shown when more decisions are queued behind this one. */
  queued?: number;
}

const StagedChange = ({ fact }: { fact: DecisionFact }): ReactElement | null => {
  if (!fact.staged) return null;
  return (
    <div className={styles.staged}>
      <div className={styles.pane}>
        <div className={styles.paneLabel}>Before</div>
        <div className={styles.paneValue}>{fact.staged.before}</div>
      </div>
      <div className={cx(styles.pane, styles.paneAfter)}>
        <div className={styles.paneLabel}>After</div>
        <div className={styles.paneValue}>{fact.staged.after}</div>
      </div>
    </div>
  );
};

const FactRows = ({
  rows,
}: {
  rows: { label: string; value: string }[];
}): ReactElement | null => {
  if (rows.length === 0) return null;
  return (
    <div className={styles.facts}>
      {rows.map((row) => (
        <div key={`${row.label}:${row.value}`} style={{ display: 'contents' }}>
          <span className={styles.factLabel}>{row.label}</span>
          <span className={styles.factValue}>{row.value}</span>
        </div>
      ))}
    </div>
  );
};

const Progress = ({ ratio }: { ratio?: number }): ReactElement => {
  const known = typeof ratio === 'number' && Number.isFinite(ratio);
  const clamped = known ? Math.min(1, Math.max(0, ratio)) : 0;
  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? Math.round(clamped * 100) : undefined}
    >
      <div
        className={cx(styles.fill, !known && styles.indeterminate)}
        style={known ? { width: `${clamped * 100}%` } : undefined}
      />
    </div>
  );
};

const Actions = ({
  fact,
  onResolve,
  pending,
  defaultRef,
}: {
  fact: DecisionFact;
  onResolve: DecisionResolver;
  pending: boolean;
  defaultRef?: React.RefObject<HTMLButtonElement>;
}): ReactElement | null => {
  if (fact.options.length === 0) return null;
  const fallback = safeDefaultOption(fact);
  return (
    <div className={styles.actions}>
      {fact.options.map((option: DecisionOption) => (
        <Button
          key={option.id}
          ref={option.id === fallback?.id ? defaultRef : undefined}
          size="sm"
          variant={
            option.destructive ? 'danger' : option.primary ? 'primary' : 'ghost'
          }
          disabled={pending}
          onClick={() => onResolve(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
};

export const DecisionSurface = ({
  fact,
  onResolve,
  pending = false,
  queued = 0,
}: DecisionSurfaceProps): ReactElement => {
  const presentation = decisionPresentation(fact.kind);
  // Initial focus parks on the non-committing option so a stray Enter cannot
  // approve a mutation. (ADR-003 frontend § decision-registry v43)
  const defaultRef = useRef<HTMLButtonElement>(null);

  // Every kind carries its tone, including the modal placement.
  const toneClass = styles[`tone_${presentation.tone}`];
  const preconditionRows = presentation.showsPreconditions ? (fact.preconditions ?? []) : [];
  const provenanceRows = fact.provenance ?? [];

  const body = (
    <div className={styles.head}>
      <div className={styles.subject}>{fact.subject}</div>
      {fact.target && <div className={styles.target}>{fact.target}</div>}
      {presentation.showsStagedChange && <StagedChange fact={fact} />}
      {fact.kind === 'progress' && <Progress ratio={fact.ratio} />}
      {/* Decision-critical facts stay on screen; only provenance collapses. */}
      <FactRows rows={fact.facts ?? []} />
      <FactRows rows={preconditionRows} />
      {fact.retryable === false && (
        <div className={styles.retry}>This cannot be retried automatically.</div>
      )}
      {provenanceRows.length > 0 && (
        <details className={styles.disclosure}>
          <summary>View details</summary>
          <FactRows rows={provenanceRows} />
        </details>
      )}
      {queued > 0 && <div className={styles.retry}>+{queued} more waiting</div>}
    </div>
  );

  if (presentation.placement === 'modal') {
    return (
      <Modal
        open
        onClose={() => {
          const fallback = safeDefaultOption(fact);
          if (fallback && !pending) onResolve(fallback.id);
        }}
        title={presentation.title}
        maxWidth={520}
        dismissOnBackdropClick={!pending}
        dismissOnEsc={!pending}
        initialFocusRef={defaultRef}
        footer={
          <Actions fact={fact} onResolve={onResolve} pending={pending} defaultRef={defaultRef} />
        }
      >
        <div
          className={cx(styles.modalBody, toneClass)}
          data-decision-kind={fact.kind}
          data-decision-intent={fact.intent}
        >
          {body}
        </div>
      </Modal>
    );
  }

  return (
    <section
      className={cx(styles.card, toneClass)}
      aria-label={presentation.title}
      data-decision-kind={fact.kind}
      data-decision-intent={fact.intent}
    >
      <div className={styles.title}>{presentation.title}</div>
      {body}
      <Actions fact={fact} onResolve={onResolve} pending={pending} />
    </section>
  );
};
