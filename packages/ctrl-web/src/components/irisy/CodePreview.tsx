// [H-2026-05-18-001] CodePreview — right bottom pane.
//
// Static <pre> rendering of the generated TS MCP server source. No syntax
// highlighting in v1 (Athena's setup didn't either); JetBrains Mono +
// brand tokens carry the visual weight.

import { useKeycapCreatorStore } from '@/lib/irisy-keycap-store';
import styles from './CodePreview.module.css';

export function CodePreview(): React.ReactElement {
  const serverTs = useKeycapCreatorStore((s) => s.serverTs);

  return (
    <section className={styles.pane} aria-label="MCP server source preview">
      <header className={styles.header}>
        <span className={styles.title}>server.ts</span>
        <span className={styles.meta}>
          {serverTs ? `${serverTs.split('\n').length} lines` : 'pending'}
        </span>
      </header>
      <pre className={styles.body}>
        {serverTs ?? <span className={styles.placeholder}>// awaiting all-slots-filled signal</span>}
      </pre>
    </section>
  );
}
