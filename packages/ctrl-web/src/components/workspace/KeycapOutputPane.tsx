// KeycapOutputPane — the live OUTPUT surface beside Irisy's chat.
//
// Per bao 2026-05-29: conversational keycaps reuse Irisy's sidebar for input;
// this pane is the reusable output half. It reads keycap-output-store (set when
// Irisy runs a keycap), streams the brain's progress live over keycap-<id>
// while the run is in flight, then renders the produced artifact through the
// content-type viewer registry. Idle until the first run.

import { useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';
import { useKeycapOutputStore } from '@/lib/keycap-output-store';
import { useCellStream } from '@/hooks/useCellStream';
import { ViewerHost } from '@/components/viewers/ViewerHost';
import { resourceFromVaultPath } from '@/lib/viewer-resource';
import styles from './KeycapOutputPane.module.css';

export const KeycapOutputPane = (): ReactElement => {
  const keycapId = useKeycapOutputStore((s) => s.keycapId);
  const running = useKeycapOutputStore((s) => s.running);
  const outputPath = useKeycapOutputStore((s) => s.outputPath);
  const error = useKeycapOutputStore((s) => s.error);

  // Subscribe to the keycap's output stream only while a run is in flight.
  const stream = useCellStream(running && keycapId ? `keycap-${keycapId}` : null);
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

  if (running) {
    return (
      <div className={styles.root}>
        <div className={styles.head}>
          <span className={styles.dot} aria-hidden />
          <span>Working…</span>
        </div>
        <pre ref={logRef} className={styles.log}>
          {liveText || 'Starting the brain…'}
        </pre>
      </div>
    );
  }

  if (outputPath) {
    return (
      <div className={styles.root}>
        <div className={styles.bar}>
          <span className={styles.path} title={outputPath}>
            {outputPath}
          </span>
        </div>
        <div className={styles.viewer}>
          <ViewerHost resource={resourceFromVaultPath(outputPath)} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.idle}>
        {error ? (
          <p className={styles.error}>{error}</p>
        ) : (
          <p className={styles.hint}>
            Output appears here when Irisy runs a keycap.
          </p>
        )}
      </div>
    </div>
  );
};
