// L1 — minimal icon rail (ADR-003 §8 + ADR-006 §5).
//
// bao 2026-06-12: layout = L1 | Irisy | output bar. L1 is an icon-only rail
// (~52px): the assistant, your tools/packs, Notes, Coding, Discover, Settings,
// model. Labels live in tooltips so the rail stays minimal. Selecting an item
// drives the main area; Irisy is always the conversation column to its right.

import { useEffect, useState, type ReactElement } from 'react';
import { loadConnectors } from '@/lib/connector';
import { type FeaturePack } from '@/components/featurepack/FeaturePackScene';
import { loadInstalledPacks, PACKS_CHANGED_EVENT } from '@/lib/feature-pack';
import styles from './Sidebar.module.css';

export type SidebarSection =
  | { kind: 'irisy' }
  | { kind: 'tool'; connectorId: string; toolName: string; label: string; sub: string }
  | { kind: 'route'; to: string }
  | { kind: 'feature-pack'; pack: FeaturePack }
  | { kind: 'notes' }
  | { kind: 'discover' };

interface SidebarProps {
  active: 'irisy' | 'discover' | string;
  onSelect: (s: SidebarSection) => void;
  modelLabel: string;
  onModel: () => void;
}

export function Sidebar({ active, onSelect, modelLabel, onModel }: SidebarProps): ReactElement {
  const connectors = loadConnectors();
  // Installed feature packs (mcps whose manifest declares actions).
  const [packs, setPacks] = useState<FeaturePack[]>([]);
  useEffect(() => {
    const refresh = (): void => {
      void loadInstalledPacks().then(setPacks).catch(() => {});
    };
    refresh();
    window.addEventListener(PACKS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PACKS_CHANGED_EVENT, refresh);
  }, []);

  const modelBadge = modelLabel.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() || '··';

  return (
    <aside className={styles.rail} data-tauri-drag-region>

      <button
        type="button"
        className={`${styles.ic} ${active === 'irisy' ? styles.active : ''}`}
        onClick={() => onSelect({ kind: 'irisy' })}
        title="Irisy"
      >
        ✦
      </button>

      {connectors.flatMap((c) =>
        c.tools.map((t) => (
          <button
            key={`${c.id}.${t.name}`}
            type="button"
            className={`${styles.ic} ${active === `${c.id}.${t.name}` ? styles.active : ''}`}
            onClick={() =>
              onSelect({
                kind: 'tool',
                connectorId: c.id,
                toolName: t.name,
                label: t.title ?? t.name,
                sub: c.title,
              })
            }
            title={t.title ?? t.name}
          >
            ▸
          </button>
        )),
      )}

      <button
        type="button"
        className={`${styles.ic} ${active === 'notes' ? styles.active : ''}`}
        onClick={() => onSelect({ kind: 'notes' })}
        title="Notes"
      >
        ✎
      </button>
      <button
        type="button"
        className={styles.ic}
        onClick={() => onSelect({ kind: 'route', to: '/coding' })}
        title="Coding"
      >
        {'</>'}
      </button>

      {packs.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`${styles.ic} ${active === `pack.${p.id}` ? styles.active : ''}`}
          onClick={() => onSelect({ kind: 'feature-pack', pack: p })}
          title={p.name}
        >
          {p.icon ?? '⚡'}
        </button>
      ))}

      <div className={styles.spacer} />

      <button
        type="button"
        className={`${styles.ic} ${active === 'discover' ? styles.active : ''}`}
        onClick={() => onSelect({ kind: 'discover' })}
        title="Discover"
      >
        ⊕
      </button>
      <button
        type="button"
        className={styles.ic}
        onClick={() => onSelect({ kind: 'route', to: '/settings' })}
        title="Settings"
      >
        ⚙
      </button>
      <button type="button" className={styles.model} onClick={onModel} title={`Model: ${modelLabel}`}>
        {modelBadge}
      </button>
    </aside>
  );
}
