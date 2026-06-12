// Sidebar — the one-person company's app launcher (ADR-003 §8 + ADR-006 §5).
//
// CTRL = the OPC's LOCAL super-app shell. The sidebar is "your company":
// the assistant, your tools/products (local apps — connectors), Notes,
// Coding, Discover (the share-and-be-shared commons), and the model.
// Curated, not a feature dump (the Coze "feature-overwhelm" anti-pattern).
//
// Selecting an item drives the main area: Irisy -> conversation; a tool ->
// its app UI; Notes/Coding -> their faces (routes); Discover -> the commons.

import { useEffect, useState, type ReactElement } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { loadConnectors } from '@/lib/connector';
import { APP_VERSION } from '@/lib/app-meta';
import { type FeaturePack } from '@/components/featurepack/FeaturePackScene';
import { loadInstalledPacks, PACKS_CHANGED_EVENT } from '@/lib/feature-pack';

export type SidebarSection =
  | { kind: 'irisy' }
  | { kind: 'tool'; connectorId: string; toolName: string; label: string; sub: string }
  | { kind: 'route'; to: string }
  | { kind: 'feature-pack'; pack: FeaturePack }
  | { kind: 'discover' };

interface SidebarProps {
  active: 'irisy' | 'discover' | string;
  onSelect: (s: SidebarSection) => void;
  modelLabel: string;
  onModel: () => void;
  styles: Record<string, string>;
}

export function Sidebar({ active, onSelect, modelLabel, onModel, styles }: SidebarProps): ReactElement {
  const connectors = loadConnectors();
  // Show the running version right in the brand so bao can see at a glance
  // whether the app updated (the point of bump-version). Runtime version from
  // Tauri (updates on kernel rebuild); falls back to the build-time constant.
  const [version, setVersion] = useState(APP_VERSION);
  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
  }, []);
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
  return (
    <aside className={styles.sidebar} data-tauri-drag-region>
      <div className={styles.sideBrand}>
        CTRL <span className={styles.sideVersion}>v{version}</span>
      </div>

      <button
        type="button"
        className={`${styles.sideItem} ${active === 'irisy' ? styles.sideItemActive : ''}`}
        onClick={() => onSelect({ kind: 'irisy' })}
      >
        <span className={styles.sideIcon}>✦</span> Irisy
      </button>

      {connectors.length > 0 && (
        <>
          <div className={styles.sideLabel}>Your tools</div>
          {connectors.flatMap((c) =>
            c.tools.map((t) => (
              <button
                key={`${c.id}.${t.name}`}
                type="button"
                className={`${styles.sideItem} ${active === `${c.id}.${t.name}` ? styles.sideItemActive : ''}`}
                onClick={() =>
                  onSelect({
                    kind: 'tool',
                    connectorId: c.id,
                    toolName: t.name,
                    label: t.title ?? t.name,
                    sub: c.title,
                  })
                }
                title={t.description ?? t.name}
              >
                <span className={styles.sideIcon}>▸</span> {t.title ?? t.name}
              </button>
            )),
          )}
        </>
      )}

      <div className={styles.sideLabel}>Workspaces</div>
      <button type="button" className={styles.sideItem} onClick={() => onSelect({ kind: 'route', to: '/notes' })}>
        <span className={styles.sideIcon}>✎</span> Notes
      </button>
      <button type="button" className={styles.sideItem} onClick={() => onSelect({ kind: 'route', to: '/coding' })}>
        <span className={styles.sideIcon}>{'</>'}</span> Coding
      </button>

      {packs.length > 0 && (
        <>
          <div className={styles.sideLabel}>Packs</div>
          {packs.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`${styles.sideItem} ${active === `pack.${p.id}` ? styles.sideItemActive : ''}`}
              onClick={() => onSelect({ kind: 'feature-pack', pack: p })}
              title={p.summary}
            >
              <span className={styles.sideIcon}>{p.icon ?? '⚡'}</span> {p.name}
            </button>
          ))}
        </>
      )}

      <div className={styles.sideSpacer} />

      <button
        type="button"
        className={`${styles.sideItem} ${active === 'discover' ? styles.sideItemActive : ''}`}
        onClick={() => onSelect({ kind: 'discover' })}
      >
        <span className={styles.sideIcon}>⊕</span> Discover
      </button>
      <button
        type="button"
        className={styles.sideItem}
        onClick={() => onSelect({ kind: 'route', to: '/settings' })}
      >
        <span className={styles.sideIcon}>⚙</span> Settings
      </button>
      <button type="button" className={styles.sideModel} onClick={onModel} title="Switch model">
        {modelLabel}
      </button>
    </aside>
  );
}
