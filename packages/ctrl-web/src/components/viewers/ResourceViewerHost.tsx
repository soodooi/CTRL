// Canonical ResourceRef -> descriptor -> content-type viewer projection.
// The shell never selects a viewer from route, pack, source, or business identity.
//
// Editing is descriptor-driven too: a save handler is attached only when the
// owner advertises `replace_content`, and it goes through the governed `produce`
// verb, so the user's own save is the same operation an agent would propose —
// same revision recheck, same recovery point, same post-write reread. The
// surface reports "saved" only when the kernel verified it; a revision that
// moved underneath the editor becomes a typed `conflict` decision rather than a
// silent overwrite.
// (ADR-002 substrate §15 v83; §15.2 v87; ADR-003 frontend §8.5 v40;
// ADR-005 irisy §12 v42 U6/U11)

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { describeResource, type CanonicalResourceDescriptor } from '@/lib/kernel';
import { conflictFact, unavailableFact } from '@/lib/decision-registry';
import { writeResourceContent, type NoteWriteResult } from '@/lib/note-write';
import {
  outcomeCaptureFact,
  saveOutcomeAsFct,
  CAPTURE_SAVE_OPTION,
  type CapturedOutcome,
} from '@/lib/fct-capture';
import { provenanceReport } from '@/lib/provenance';
import {
  proposeRewrite,
  rewriteApprovalFact,
  rewriteLabel,
  REWRITE_APPLY_OPTION,
  REWRITE_KINDS,
  type RewriteKind,
  type RewriteProposal,
} from '@/lib/content-rewrite';
import { fetchUriAsText } from '@/lib/viewer-uri';
import { DecisionSurface } from '@/components/decisions/DecisionSurface';
import { ProvenanceDrillDown } from './ProvenanceDrillDown';
import { ViewerHost } from './ViewerHost';
import styles from './Viewer.module.css';

interface ResourceViewerHostProps {
  resourceRef: string;
}

const REPLACE_CONTENT = 'replace_content';

/** What the last governed save reported. Never optimistic: the surface cannot
 *  claim a save the kernel did not verify. */
type SaveState =
  | { phase: 'idle' }
  | { phase: 'verified'; verifiedBy: string; revision: string | null }
  | { phase: 'blocked'; result: Exclude<NoteWriteResult, { status: 'verified' }> };

export function ResourceViewerHost({ resourceRef }: ResourceViewerHostProps): ReactElement {
  const [descriptor, setDescriptor] = useState<CanonicalResourceDescriptor | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Drill path into upstream provenance refs. The entry ref is the base; opening
  // a source pushes, Back pops. Kept local so walking the chain never mutates the
  // route or the caller's selection. (ADR-005 irisy §12 v42 U11)
  const [drillPath, setDrillPath] = useState<string[]>([]);
  const [save, setSave] = useState<SaveState>({ phase: 'idle' });
  // A reuse offer raised by the last verified change, plus the result of acting
  // on it. (ADR-005 irisy §12 v42 U23)
  const [capture, setCapture] = useState<CapturedOutcome | null>(null);
  const [captureNote, setCaptureNote] = useState<string | null>(null);
  // A proposed rewrite, staged and awaiting the user's decision. Nothing is
  // written until they approve. (ADR-005 irisy §12 v42 U2)
  const [proposal, setProposal] = useState<RewriteProposal | null>(null);
  const [proposing, setProposing] = useState<RewriteKind | null>(null);
  // Bumped after a committed or abandoned write so the viewer refetches what is
  // actually on disk instead of keeping the buffer that lost the race.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setDrillPath([]);
  }, [resourceRef]);

  const activeRef = drillPath.length > 0 ? drillPath[drillPath.length - 1]! : resourceRef;

  useEffect(() => {
    setSave({ phase: 'idle' });
  }, [activeRef]);

  useEffect(() => {
    let cancelled = false;
    setDescriptor(null);
    setError(null);
    void describeResource(activeRef)
      .then((next) => {
        if (!cancelled) setDescriptor(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [activeRef, reloadKey]);

  const report = useMemo(
    () => (descriptor ? provenanceReport(descriptor) : null),
    [descriptor],
  );

  const writable = Boolean(
    descriptor?.produce?.some((operation) => operation.kind === REPLACE_CONTENT),
  );
  // The revision this write is conditioned on comes from the descriptor the
  // viewer rendered, so the recheck compares against what the user actually saw.
  const stagedRevision = descriptor?.freshness?.revision ?? undefined;

  // The owner's own title is the target a captured FCT should be named after.
  const descriptorTarget = descriptor?.presentation.title ?? undefined;

  const commit = useCallback(
    async (content: string): Promise<void> => {
      let result: NoteWriteResult;
      try {
        result = await writeResourceContent(activeRef, content, stagedRevision ?? undefined);
      } catch (reason: unknown) {
        // A transport or addressing failure is still a failure to write and must
        // not leave the surface looking saved.
        result = {
          status: 'failed',
          code: 'write_unreachable',
          message: reason instanceof Error ? reason.message : String(reason),
          retryable: true,
        };
      }
      if (result.status === 'verified') {
        setSave({ phase: 'verified', verifiedBy: result.verifiedBy, revision: result.revision });
        // Only a verified change is worth offering for reuse, and the offer is
        // derived from this Outcome alone. (ADR-005 irisy §12 v42 U23)
        setCapture({
          resource: activeRef,
          target: descriptorTarget,
          verifiedBy: result.verifiedBy,
        });
        // Pick up the revision the kernel observed, so the next save rechecks
        // against it rather than the pre-write value.
        setReloadKey((key) => key + 1);
        return;
      }
      setSave({ phase: 'blocked', result });
    },
    [activeRef, descriptorTarget, stagedRevision],
  );

  // Ask the model for a replacement and STAGE it. The write happens only if the
  // user approves the staged change below. (ADR-005 irisy §12 v42 U2)
  const propose = useCallback(
    async (kind: RewriteKind): Promise<void> => {
      setProposing(kind);
      setProposal(null);
      setSave({ phase: 'idle' });
      try {
        // Read what is on disk right now, not the editor buffer: the proposal must
        // be a change to the real document.
        const current = await fetchUriAsText(activeRef);
        const after = await proposeRewrite(kind, current);
        setProposal({
          kind,
          resource: activeRef,
          target: descriptorTarget,
          revision: stagedRevision ?? undefined,
          before: current,
          after,
        });
      } catch (reason: unknown) {
        setSave({
          phase: 'blocked',
          result: {
            status: 'failed',
            code: 'rewrite_unavailable',
            message: reason instanceof Error ? reason.message : String(reason),
            retryable: true,
          },
        });
      } finally {
        setProposing(null);
      }
    },
    [activeRef, descriptorTarget, stagedRevision],
  );

  if (error) {
    return <div className={styles.fallback} role="alert">Resource unavailable: {error}</div>;
  }
  if (!descriptor || !report) {
    return <div className={styles.fallback} role="status">Loading Resource…</div>;
  }

  if (
    typeof descriptor.resource !== 'string' ||
    typeof descriptor.content_type !== 'string'
  ) {
    return <div className={styles.fallback} role="alert">Resource unavailable: invalid descriptor</div>;
  }

  // A blocked save is a decision, not a toast: the user holds content that did
  // not land and has to choose what to do about the state on disk.
  const blocked = save.phase === 'blocked' ? save.result : null;
  const decision =
    blocked?.status === 'conflict'
      ? conflictFact({
          id: `resource-write:${activeRef}`,
          subject: 'This changed on disk, so nothing was written.',
          target: report.resource,
          expected: blocked.expected,
          current: blocked.actual,
        })
      : blocked
        ? unavailableFact({
            id: `resource-write:${activeRef}`,
            subject: 'The change was not saved.',
            target: report.resource,
            reason: `${blocked.code}: ${blocked.message}`,
            retryable: blocked.retryable,
          })
        : null;

  return (
    <div className={styles.frame}>
      {decision ? (
        <DecisionSurface
          fact={decision}
          onResolve={(optionId) => {
            setSave({ phase: 'idle' });
            // `review` and `retry` both mean "show me what is on disk now".
            if (optionId === 'review' || optionId === 'retry') {
              setReloadKey((key) => key + 1);
            }
          }}
        />
      ) : null}
      {save.phase === 'verified' ? (
        <p className={styles.savedNotice} role="status" data-testid="resource-save-verified">
          Saved and verified
          {save.revision ? ` · ${save.revision}` : ''} — {save.verifiedBy}
        </p>
      ) : null}
      {writable ? (
        <div className={styles.rewriteBar} role="group" aria-label="Content actions">
          {REWRITE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={styles.rewriteAction}
              disabled={proposing !== null}
              onClick={() => void propose(kind)}
            >
              {proposing === kind ? '…' : rewriteLabel(kind)}
            </button>
          ))}
        </div>
      ) : null}
      {proposal ? (
        <DecisionSurface
          fact={rewriteApprovalFact(proposal)}
          onResolve={(optionId) => {
            const pending = proposal;
            setProposal(null);
            if (optionId !== REWRITE_APPLY_OPTION || !pending) return;
            // Approval routes into the same governed write as any other change:
            // revision recheck, atomic commit, post-write reread.
            void commit(pending.after);
          }}
        />
      ) : null}
      {captureNote ? (
        <p className={styles.savedNotice} role="status" data-testid="resource-capture-note">
          {captureNote}
        </p>
      ) : null}
      {capture ? (
        <DecisionSurface
          fact={outcomeCaptureFact(capture)}
          onResolve={(optionId) => {
            const pending = capture;
            setCapture(null);
            if (optionId !== CAPTURE_SAVE_OPTION || !pending) return;
            void saveOutcomeAsFct(pending)
              .then((name) =>
                setCaptureNote(`Saved "${name}" to Installed FCTs. It was not activated.`),
              )
              .catch((reason: unknown) =>
                setCaptureNote(
                  `Could not save it for reuse: ${
                    reason instanceof Error ? reason.message : String(reason)
                  }`,
                ),
              );
          }}
        />
      ) : null}
      <div className={styles.frameBody}>
        <ViewerHost
          key={`${descriptor.resource}:${reloadKey}`}
          resource={{
            location: 'local',
            contentType: descriptor.content_type,
            uri: descriptor.resource,
            editable: writable,
            onSave: writable ? commit : undefined,
          }}
        />
      </div>
      <ProvenanceDrillDown
        report={report}
        onOpenSource={(next) => setDrillPath((path) => [...path, next])}
        onBack={
          drillPath.length > 0
            ? () => setDrillPath((path) => path.slice(0, -1))
            : undefined
        }
      />
    </div>
  );
}
