// Coding — a dedicated coding surface (bao 2026-05-27: "单独做个 coding
// 页面"). Standalone route, NOT tied to /code-space (which manages
// environments). This page is the visual showcase of CTRL's coding
// aesthetic — opencode-inspired dark IDE feel, mono-first typography,
// terminal at the bottom.
//
// Force-dark scope: the page sets `data-theme='dark'` on its own root
// so the coding aesthetic stands even when the user's global theme is
// light. Other surfaces (rail / keyboard / status bar) keep the global
// theme — the dark scope only paints the workspace pane.
//
// Phase 1: pure presentation. No editor wire-up, no terminal pty —
// these placeholders sketch where the coding companion lives. The next
// pass wires up read-only file browsing + a portable-pty terminal.

import { useEffect, type ReactElement } from 'react';
import styles from './coding.module.css';

interface FileNode {
  name: string;
  kind: 'dir' | 'file';
  children?: ReadonlyArray<FileNode>;
}

const FILE_TREE: ReadonlyArray<FileNode> = [
  {
    name: 'src',
    kind: 'dir',
    children: [
      { name: 'app.tsx', kind: 'file' },
      { name: 'main.tsx', kind: 'file' },
      {
        name: 'routes',
        kind: 'dir',
        children: [
          { name: 'default.tsx', kind: 'file' },
          { name: 'coding.tsx', kind: 'file' },
          { name: 'pool.tsx', kind: 'file' },
        ],
      },
      {
        name: 'components',
        kind: 'dir',
        children: [
          { name: 'RightRail.tsx', kind: 'file' },
          { name: 'Keyboard.tsx', kind: 'file' },
        ],
      },
    ],
  },
  { name: 'package.json', kind: 'file' },
  { name: 'vite.config.ts', kind: 'file' },
  { name: 'tsconfig.json', kind: 'file' },
];

const SAMPLE_LINES: ReadonlyArray<{ tokens: ReadonlyArray<[string, string]> }> = [
  { tokens: [['kw', 'import'], ['pl', ' { '], ['id', 'useState'], ['pl', ' } '], ['kw', 'from'], ['st', " 'react'"], ['pl', ';']] },
  { tokens: [] },
  { tokens: [['kw', 'export const'], ['id', ' Coding'], ['pl', ' = ()'], ['pl', ': '], ['ty', 'ReactElement'], ['pl', ' => {']] },
  { tokens: [['pl', '  '], ['kw', 'const'], ['pl', ' ['], ['id', 'count'], ['pl', ', '], ['id', 'setCount'], ['pl', '] = '], ['fn', 'useState'], ['pl', '('], ['nm', '0'], ['pl', ');']] },
  { tokens: [['pl', '  '], ['kw', 'return'], ['pl', ' (']] },
  { tokens: [['pl', '    <'], ['ty', 'button'], ['pl', ' '], ['at', 'onClick'], ['pl', '={() => '], ['fn', 'setCount'], ['pl', '('], ['id', 'count'], ['pl', ' + '], ['nm', '1'], ['pl', ')}>']] },
  { tokens: [['pl', '      Pressed '], ['pl', '{'], ['id', 'count'], ['pl', '} times']] },
  { tokens: [['pl', '    </'], ['ty', 'button'], ['pl', '>']] },
  { tokens: [['pl', '  );']] },
  { tokens: [['pl', '};']] },
];

const TERMINAL_LINES: ReadonlyArray<{ kind: 'cmd' | 'out' | 'ok' | 'warn'; text: string }> = [
  { kind: 'cmd', text: 'pnpm tauri dev' },
  { kind: 'out', text: '   VITE v5.4.10  ready in 412 ms' },
  { kind: 'out', text: '   ➜  Local:   http://localhost:1420/' },
  { kind: 'ok', text: '   ✓ compiled · 23 modules transformed' },
  { kind: 'cmd', text: 'pnpm typecheck' },
  { kind: 'ok', text: '   ✓ 0 errors · packages/ctrl-web' },
];

const FileTree = ({ nodes, depth = 0 }: { nodes: ReadonlyArray<FileNode>; depth?: number }): ReactElement => (
  <ul className={styles.tree} data-depth={depth}>
    {nodes.map((node) => (
      <li key={node.name} className={styles.treeNode}>
        <button
          type="button"
          className={styles.treeRow}
          data-kind={node.kind}
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
        >
          <span className={styles.treeIcon} aria-hidden="true">
            {node.kind === 'dir' ? '▸' : ' '}
          </span>
          <span className={styles.treeName}>{node.name}</span>
        </button>
        {node.children && <FileTree nodes={node.children} depth={depth + 1} />}
      </li>
    ))}
  </ul>
);

export const CodingRoute = (): ReactElement => {
  useEffect(() => {
    document.title = 'CTRL · Coding';
    return () => {
      document.title = 'CTRL';
    };
  }, []);

  return (
    <div className={styles.root} data-theme="dark">
      <header className={styles.header}>
        <div className={styles.crumb}>
          <span className={styles.crumbDim}>~/Documents/coding/CTRL</span>
          <span className={styles.crumbSep}>/</span>
          <span>packages</span>
          <span className={styles.crumbSep}>/</span>
          <span>ctrl-web</span>
          <span className={styles.crumbSep}>/</span>
          <span>src</span>
          <span className={styles.crumbSep}>/</span>
          <span>routes</span>
          <span className={styles.crumbSep}>/</span>
          <span className={styles.crumbActive}>coding.tsx</span>
        </div>
        <div className={styles.headerMeta}>
          <span className={styles.lang}>TSX</span>
          <span className={styles.dot} />
          <span>UTF-8</span>
          <span className={styles.dot} />
          <span>LF</span>
          <span className={styles.dot} />
          <span>Ln 1, Col 1</span>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.explorer}>
          <div className={styles.explorerHead}>EXPLORER</div>
          <FileTree nodes={FILE_TREE} />
        </aside>

        <section className={styles.editor}>
          <div className={styles.tabs}>
            <div className={styles.tab} data-active="true">
              <span className={styles.tabDot} />
              <span>coding.tsx</span>
            </div>
            <div className={styles.tab}>
              <span>app.tsx</span>
            </div>
            <div className={styles.tab}>
              <span>RightRail.tsx</span>
            </div>
          </div>

          <pre className={styles.code}>
            {SAMPLE_LINES.map((line, idx) => (
              <div key={idx} className={styles.codeLine}>
                <span className={styles.lineNo}>{idx + 1}</span>
                <span className={styles.lineText}>
                  {line.tokens.length === 0
                    ? ' '
                    : line.tokens.map(([cls, text], i) => (
                        <span key={i} data-tok={cls}>
                          {text}
                        </span>
                      ))}
                </span>
              </div>
            ))}
          </pre>
        </section>
      </div>

      <footer className={styles.terminal}>
        <div className={styles.terminalHead}>
          <span className={styles.terminalTitle}>TERMINAL</span>
          <span className={styles.terminalSession}>zsh · ~/Documents/coding/CTRL</span>
        </div>
        <div className={styles.terminalBody}>
          {TERMINAL_LINES.map((line, idx) => (
            <div key={idx} className={styles.terminalLine} data-kind={line.kind}>
              {line.kind === 'cmd' && <span className={styles.prompt}>$</span>}
              <span>{line.text}</span>
            </div>
          ))}
          <div className={styles.terminalLine} data-kind="cmd">
            <span className={styles.prompt}>$</span>
            <span className={styles.cursor} aria-hidden="true" />
          </div>
        </div>
      </footer>
    </div>
  );
};
