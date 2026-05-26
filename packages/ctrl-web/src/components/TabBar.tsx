// TabBar — horizontal tab strip for a single workspace instance.
//
// Per the multi-instance refactor (2026-05-25): TabBar no longer reads
// the store directly. Each instance renders its own TabBar via
// WorkspaceShell, passing in its tabs + handlers. This decouples the
// strip from any single store layer (workspace-store today, anything
// later) and makes the component drop-in testable.
//
// Icons render through IconRenderer so a tab can carry a static glyph
// (zero-byte) or an animated lottie when the kind earns the motion.
// `session-stream` is the only default that animates — a live signal
// pulse hints that something is actually flowing.

import type { ReactElement } from 'react';
import type { Tab } from '@/lib/tab-store';
import type { Icon } from '@/lib/icon';
import { IconRenderer } from '@/components/primitives';
import styles from './TabBar.module.css';

interface TabBarProps {
  tabs: ReadonlyArray<Tab>;
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

const KIND_LABEL: Record<Tab['kind'], string> = {
  'external-embed': 'EMBED',
  'vault-md': 'DOC',
  'keycap-output': 'OUT',
  'session-stream': 'LIVE',
  route: 'PAGE',
};

// Static glyphs render natively (zero deps). `session-stream` gets the
// pulse lottie because the LIVE label is the one moment motion is honest.
const KIND_ICON: Record<Tab['kind'], Icon> = {
  'external-embed': { kind: 'glyph', char: '⤢' },
  'vault-md': { kind: 'glyph', char: '⌬' },
  'keycap-output': { kind: 'glyph', char: '◉' },
  'session-stream': { kind: 'lottie', src: '/lottie/pulse.json' },
  route: { kind: 'glyph', char: '⌘' },
};

const TAB_ICON_SIZE = 16;

const resolveIcon = (tab: Tab): Icon => {
  const raw = tab.icon;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return { kind: 'glyph', char: raw.trim() };
  }
  return KIND_ICON[tab.kind];
};

export const TabBar = ({
  tabs,
  activeId,
  onActivate,
  onClose,
}: TabBarProps): ReactElement | null => {
  if (tabs.length === 0) return null;

  return (
    <div className={styles.bar} role="tablist" aria-label="Workspace tabs">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active}
            className={styles.tab}
            onClick={() => onActivate(tab.id)}
            onAuxClick={(e) => {
              // Middle click closes (browser/VS Code convention).
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab.id);
              }
            }}
            title={tab.title}
          >
            <span className={styles.tabIcon} aria-hidden="true">
              <IconRenderer
                icon={resolveIcon(tab)}
                size={TAB_ICON_SIZE}
                playing={active}
                ariaLabel={`${KIND_LABEL[tab.kind]} ${tab.title}`}
              />
            </span>
            <span className={styles.tabKind}>{KIND_LABEL[tab.kind]}</span>
            <span className={styles.tabLabel}>{tab.title}</span>
            <span
              role="button"
              className={styles.close}
              aria-label={`Close ${tab.title}`}
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onClose(tab.id);
                }
              }}
            >
              ×
            </span>
          </button>
        );
      })}
      <div className={styles.spacer} />
    </div>
  );
};
