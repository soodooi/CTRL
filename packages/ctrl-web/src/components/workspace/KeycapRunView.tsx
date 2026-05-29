// KeycapRunView — the run-time WORKSPACE for a keycap (the 工作区, not the
// 工作台). Generic + reusable: it renders ANY keycap from its manifest —
// an input form derived from manifest.io.inputs, a Run action that calls the
// kernel run pipe, and the produced artifact shown through the content-type
// viewer registry (HtmlViewer for slides, MarkdownViewer for docs, …).
//
// This is substrate, not business logic: it knows nothing about "slides".
// Irisy composes a keycap by declaring io.inputs/outputs in the manifest;
// this view renders + runs whatever was declared. See feedback_build_system_not_business.

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { invoke } from '@/lib/bridge';
import { runKeycap } from '@/lib/kernel';
import { ViewerHost } from '@/components/viewers/ViewerHost';
import { resourceFromVaultPath } from '@/lib/viewer-resource';
import styles from './KeycapRunView.module.css';

interface IoPort {
  id: string;
  label?: string;
  schema?: { type?: string; title?: string };
}

interface KeycapManifest {
  io?: { inputs?: IoPort[] };
}

/** Shape returned by the kernel skill run pipe (commands/skills.rs::run_skill). */
interface RunOutput {
  primary?: string;
  content_type?: string;
  artifacts?: string[];
}

interface KeycapRunViewProps {
  keycapId: string;
}

const FREEFORM_PORT: IoPort = { id: '__input', label: 'Input' };

export const KeycapRunView = ({ keycapId }: KeycapRunViewProps): ReactElement => {
  const [inputs, setInputs] = useState<IoPort[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pull the keycap's declared input ports from its manifest. Falls back to a
  // single freeform field when the manifest declares no io.inputs.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const manifest = await invoke<KeycapManifest>('read_keycap_manifest', {
          args: { keycap_id: keycapId },
        });
        if (alive) setInputs(manifest.io?.inputs ?? []);
      } catch {
        if (alive) setInputs([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [keycapId]);

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
      const res = await runKeycap(keycapId, { text, ...values });
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
  }, [fields, values, keycapId]);

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
          {running ? 'Running… (can take a minute)' : 'Run'}
        </button>
        {error != null && <p className={styles.error}>{error}</p>}
      </form>
    </div>
  );
};
