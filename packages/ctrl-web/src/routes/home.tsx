// / — Home (default landing). 2-pane layout:
//   左 = 键盘区（Pool 键帽 grid）
//   右 = 工作区，默认放 Irisy；用户点击键帽时切换为该键帽的运行视图（P5+）
//
// 手机端 (max-width: 720px) 自动改为上下 stack。
//
// Athena 拥有 IrisyRoute 实现；Zeus 只放进工作区里。

import { lazy, Suspense } from 'react';
import { PoolRoute } from './pool';
import styles from './home.module.css';

const IrisyRoute = lazy(() =>
  import('./irisy').then((m) => ({ default: m.IrisyRoute })),
);

const WorkspaceFallback = (): React.ReactElement => (
  <div
    style={{
      padding: 'var(--space-6)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      color: 'var(--color-text-muted)',
    }}
  >
    Loading workspace…
  </div>
);

export const HomeRoute = (): React.ReactElement => (
  <div className={styles.layout}>
    <aside className={styles.keyboardPane} aria-label="键盘区">
      <div className={styles.paneLabel}>键盘区</div>
      <PoolRoute />
    </aside>
    <main className={styles.workspacePane} aria-label="工作区">
      <div className={styles.paneLabel}>工作区 · Irisy</div>
      <Suspense fallback={<WorkspaceFallback />}>
        <IrisyRoute />
      </Suspense>
    </main>
  </div>
);
