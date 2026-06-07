// McpRunView — the run-time workspace for a mcp (the run-pane, not the toolbar).
// Generic + reusable: it renders ANY mcp from its manifest —
// ADR-004 cap § execution v1 (2026-06-07 rename: keycap -> mcp).
// kernel run pipe, a LIVE output pane (the brain's progress streamed cell by
// cell over mcp-<id>), and the produced artifact shown through the
// content-type viewer registry (HtmlViewer for slides, MarkdownViewer for
// docs, …).
//
// This is substrate, not business logic: it knows nothing about "slides".
// Irisy composes a mcp by declaring io.inputs/outputs in the manifest;
// this view renders + runs + streams whatever was declared. See
// feedback_build_system_not_business.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { invoke } from '@/lib/bridge';
import { runMcp } from '@/lib/kernel';
import { useCellStream } from '@/hooks/useCellStream';
import { ViewerHost } from '@/components/viewers/ViewerHost';
import { resourceFromVaultPath } from '@/lib/viewer-resource';
import styles from './McpRunView.module.css';

interface IoPort {
  id: string;
  label?: string;
  schema?: { type?: string; title?: string };
}

interface McpManifest {
  io?: { inputs?: IoPort[] };
}

/** Shape returned by the kernel skill run pipe (commands/skills.rs::run_skill). */
interface RunOutput {
  primary?: string;
  content_type?: string;
  artifacts?: string[];
}

interface McpRunViewProps {
  mcpId: string;
}

const FREEFORM_PORT: IoPort = { id: '__input', label: 'Input' };

export const McpRunView = ({ mcpId }: McpRunViewProps): ReactElement => {
  const [inputs, setInputs] = useState<IoPort[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live progress: subscribe to the mcp's output stream only while a run is
  // in flight. The kernel publishes the brain's chunks as llm_response cells on
  // mcp-<id> (commands/skills.rs::publish_delta).
  const stream = useCellStream(running ? `mcp-${mcpId}` : null);
  const liveText = useMemo(
    () =>
      stream.events
        .filter((e) => e.type === 'cell' && e.kind === 'llm_response')
        .map((e) => {
          const p = e.payload as { delta?: string } | null;
          return p?.delta ?? '';
        })
        .join(''),
    [stream.events],
  );

  const logRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveText]);

  // Pull the mcp's declared input ports from its manifest. Falls back to a
  // single freeform field when the manifest declares no io.inputs.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const manifest = await invoke<McpManifest>('read_mcp_manifest', {
          args: { mcp_id: mcpId },
        });
        if (alive) setInputs(manifest.io?.inputs ?? []);
      } catch {
        if (alive) setInputs([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mcpId]);

  const fields = inputs.length > 0 ? inputs : [FREEFORM_PORT];

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setOutputPath(null);
    try {
      // Fold the declared fields into a single task string the brain reads.
      const text = fields
        .map((p) => {
          const v = values[p.id] ?? '';
          return fields.length > 1 ? `${p.label ?? p.id}: ${v}` : v;
        })
        .join('\n')
        .trim();
      const res = await runMcp(mcpId, { text, ...values });
      const out = res.output as RunOutput;
      if (out?.primary) {
        setOutputPath(out.primary);
      } else {
        setError('Run finished but produced no viewable output.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [fields, values, mcpId]);

  // Result view — the produced artifact, with a way back to a fresh run.
  if (outputPath) {
    return (
      <div className={styles.root}>
        <div className={styles.outputBar}>
          <span className={styles.outputPath} title={outputPath}>
            {outputPath}
          </span>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setOutputPath(null)}
          >
            New run
          </button>
        </div>
        <div className={styles.viewer}>
          <ViewerHost resource={resourceFromVaultPath(outputPath)} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {fields.map((p) => (
          <label key={p.id} className={styles.field}>
            <span className={styles.fieldLabel}>{p.label ?? p.id}</span>
            <textarea
              className={styles.input}
              rows={2}
              value={values[p.id] ?? ''}
              onChange={(e) =>
                setValues((v) => ({ ...v, [p.id]: e.target.value }))
              }
              disabled={running}
              placeholder={`Enter ${(p.label ?? p.id).toLowerCase()}…`}
            />
          </label>
        ))}
        <button type="submit" className={styles.run} disabled={running}>
          {running ? 'Running…' : 'Run'}
        </button>
        {error != null && <p className={styles.error}>{error}</p>}
      </form>

      {running && (
        <div className={styles.live}>
          <div className={styles.liveHead}>
            <span className={styles.liveDot} aria-hidden />
            <span>Working…</span>
          </div>
          <pre ref={logRef} className={styles.liveLog}>
            {liveText || 'Starting the brain…'}
          </pre>
        </div>
      )}
    </div>
  );
};
