// EmbedView — workspace tab content for an external embed (iframe).
//
// First consumer = hermes dashboard (http://127.0.0.1:9119). Per
// decision_ctrl_is_hermes_workbench, hermes brings its own admin UI;
// CTRL just gives it a tab. Tauri CSP frame-src must allowlist the
// origin (already done in tauri.conf.json for 127.0.0.1:9119).
//
// Sandbox attrs allow scripts + same-origin + forms + popups so the
// hermes dashboard works fully, but `allow-top-navigation` is omitted
// so the embedded page can't escape into the parent window.

import { useState, type ReactElement } from 'react';
import { Led } from '@/components/primitives';
import styles from './EmbedView.module.css';

interface EmbedViewProps {
  url: string;
  /** Pretty title shown in the strip (independent of tab title). */
  label?: string;
}

export const EmbedView = ({ url, label }: EmbedViewProps): ReactElement => {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={styles.shell}>
      <div className={styles.statusStrip} aria-label="Embed status">
        <Led tone={loaded ? 'nominal' : 'caution'} size="sm" />
        <span>{label ?? 'EMBED'}</span>
        <span className={styles.statusUrl}>{url}</span>
        <div className={styles.spacer} />
        <span>{loaded ? 'CONNECTED' : 'LOADING…'}</span>
      </div>
      <div className={styles.frameWrap}>
        <iframe
          className={styles.frame}
          src={url}
          title={label ?? 'External embed'}
          // No `allow-top-navigation` → the embed can't replace CTRL's window.
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
          onLoad={() => setLoaded(true)}
        />
        {/* Dark loading overlay — hides the iframe's white initial paint
            until the embedded app has rendered. Without this the cockpit
            shows a jarring white slab whenever a tab first opens. */}
        {!loaded && (
          <div className={styles.loadingVeil} aria-hidden="true">
            <div className={styles.loadingPulse} />
            <span className={styles.loadingText}>Loading embed…</span>
          </div>
        )}
      </div>
    </div>
  );
};
