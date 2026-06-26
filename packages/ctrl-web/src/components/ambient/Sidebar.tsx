// L1 — minimal icon rail (ADR-003 §8 + ADR-006 §5).
//
// bao 2026-06-12: layout = L1 | Irisy | output bar. L1 is an icon-only rail
// (~52px): the assistant, your tools/packs, Notes, Coding, Discover, Settings,
// model. Labels live in tooltips so the rail stays minimal. Selecting an item
// drives the main area; Irisy is always the conversation column to its right.

import { useEffect, useState, type ReactElement } from 'react';
import { loadConnectors } from '@/lib/connector';
import { providerBadge } from '@/lib/provider-badge';
import { type FeaturePack } from '@/components/featurepack/FeaturePackScene';
import { loadInstalledPacks, PACKS_CHANGED_EVENT } from '@/lib/feature-pack';
import { packsForRole, roleById, type RoleId } from '@/lib/roles';
import styles from './Sidebar.module.css';

// Unified line-icon set (bao 2026-06-16: L1 icons must all be the SAME size).
// Raw unicode glyphs (✦ ✎ ⚙ …) render at wildly different visual sizes — ⚙ in
// particular looked tiny. One 24-viewBox + one stroke width → identical optical
// size, controlled by `.ic svg` in the CSS. Zero deps (matches the inline-SVG
// precedent in PrimaryRail / the history button). ADR-003 frontend §7.6.
type IconProps = { d: string };
function Ico({ d }: IconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
// Sparkle (Irisy), dot-arrow (tool), pencil (Notes), code (Coding),
// plus-circle (Discover), gear (Settings).
const IRISY_D = 'M12 3l1.9 5.6L19.5 10l-5.6 1.4L12 17l-1.9-5.6L4.5 10l5.6-1.4z';
const TOOL_D = 'M9 6l6 6-6 6';
const NOTES_D = 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4';
const DISCOVER_D = 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v8M8 12h8';
function GearIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  );
}
function CodeIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 9l-4 3 4 3M16 9l4 3-4 3" />
    </svg>
  );
}
function TableIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M3 14.5h18M9 4v16" />
    </svg>
  );
}

export type SidebarSection =
  | { kind: 'irisy' }
  | { kind: 'tool'; connectorId: string; toolName: string; label: string; sub: string }
  | { kind: 'route'; to: string }
  | { kind: 'feature-pack'; pack: FeaturePack }
  | { kind: 'notes' }
  | { kind: 'tables' }
  | { kind: 'coding' }
  | { kind: 'discover' };

interface SidebarProps {
  active: 'irisy' | 'discover' | string;
  onSelect: (s: SidebarSection) => void;
  modelLabel: string;
  /** Provider slug (keychain account / toml stem). Drives the semantic
   *  2-letter badge via `providerBadge()` — passes null when AmbientHome
   *  doesn't know it (legacy call sites), and the helper falls back to
   *  the legacy first-2-letters-of-label slice. Decision 0007 §display. */
  providerId?: string | null;
  onModel: () => void;
  /** Active Irisy role — filters the feature packs shown to those the role
   *  exposes (ADR-003 §8.6 toolset). Omitted = show all installed packs. */
  roleId?: RoleId;
}

export function Sidebar({ active, onSelect, modelLabel, providerId, onModel, roleId }: SidebarProps): ReactElement {
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

  const modelBadge = providerBadge(providerId ?? '', modelLabel);
  // Packs the active role exposes (ADR-003 §8.6 toolset). No role = show all.
  const visiblePacks = roleId ? packsForRole(roleById(roleId), packs) : packs;

  return (
    <aside className={styles.rail} data-tauri-drag-region>

      <button
        type="button"
        className={`${styles.ic} ${active === 'irisy' ? styles.active : ''}`}
        onClick={() => onSelect({ kind: 'irisy' })}
        title="Irisy"
      >
        <Ico d={IRISY_D} />
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
            <Ico d={TOOL_D} />
          </button>
        )),
      )}

      <button
        type="button"
        className={`${styles.ic} ${active === 'notes' ? styles.active : ''}`}
        onClick={() => onSelect({ kind: 'notes' })}
        title="Notes"
      >
        <Ico d={NOTES_D} />
      </button>
      <button
        type="button"
        className={`${styles.ic} ${active === 'tables' ? styles.active : ''}`}
        onClick={() => onSelect({ kind: 'tables' })}
        title="Tables"
      >
        <TableIcon />
      </button>
      <button
        type="button"
        className={`${styles.ic} ${active === 'coding' ? styles.active : ''}`}
        onClick={() => onSelect({ kind: 'coding' })}
        title="Coding"
      >
        <CodeIcon />
      </button>

      {visiblePacks.map((p) => (
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
        <Ico d={DISCOVER_D} />
      </button>
      <button
        type="button"
        className={styles.ic}
        onClick={() => onSelect({ kind: 'route', to: '/settings' })}
        title="Settings"
      >
        <GearIcon />
      </button>
      <button type="button" className={styles.model} onClick={onModel} title={`Model: ${modelLabel}`}>
        {modelBadge}
      </button>
    </aside>
  );
}
