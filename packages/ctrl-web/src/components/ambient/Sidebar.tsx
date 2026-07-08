// L1 — minimal icon rail (ADR-003 §8 + ADR-006 §5).
//
// bao 2026-06-12: layout = L1 | Irisy | output bar. L1 is an icon-only rail
// (~52px): the assistant, Notes / Tables / Coding, the Feature Pack Library,
// your installed packs, Settings, model. Labels live in tooltips so the rail
// stays minimal. Selecting an item drives the main area; Irisy is always the
// conversation column to its right.

import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { loadConnectors } from '@/lib/connector';
import { providerBadge } from '@/lib/provider-badge';
import { type FeaturePack } from '@/components/featurepack/FeaturePackScene';
import { loadInstalledPacks, PACKS_CHANGED_EVENT } from '@/lib/feature-pack';
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
// Remote Window — a phone glyph (mobile co-view config).
function RemoteIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" />
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
// Today (LifeOS home) — a checkmark-in-circle for the task/day surface.
function TodayIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  );
}

export type SidebarSection =
  | { kind: 'irisy' }
  | { kind: 'tool'; connectorId: string; toolName: string; label: string; sub: string }
  | { kind: 'route'; to: string }
  | { kind: 'feature-pack'; pack: FeaturePack }
  | { kind: 'today' }
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
}

export function Sidebar({ active, onSelect, modelLabel, providerId, onModel }: SidebarProps): ReactElement {
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

  // One unified L1 feature-pack list (bao 2026-06-26: a single pack list, no
  // hardcoded faces interleaved with packs). Built-in faces (Notes / Tables /
  // Coding) are entries of the SAME list as installed packs, rendered the same
  // way; opening still routes to each one's rich scene via its `section` (the
  // editor / grid / terminal aren't a generic action bar, so they keep their
  // own viewer — unification is the list, not the renderer). The L1 rail is
  // EVERY installed capability's entry point, so it is role-independent: all
  // installed packs always show here (bao 2026-06-27: role-filtering the rail
  // made the Stocks/ghostfolio entry vanish when a code role opened — you
  // could no longer get back to it). Role scoping lives where it belongs —
  // Irisy's per-turn toolset and the composer's context-pack row — not the rail.
  interface L1Entry {
    key: string;
    title: string;
    icon: ReactNode;
    section: SidebarSection;
  }
  const builtinFaces: L1Entry[] = [
    { key: 'today', title: 'Today', icon: <TodayIcon />, section: { kind: 'today' } },
    { key: 'notes', title: 'Notes', icon: <Ico d={NOTES_D} />, section: { kind: 'notes' } },
    { key: 'tables', title: 'Tables', icon: <TableIcon />, section: { kind: 'tables' } },
    { key: 'coding', title: 'Coding', icon: <CodeIcon />, section: { kind: 'coding' } },
  ];
  const packEntries: L1Entry[] = packs.map((p) => ({
    key: `pack.${p.id}`,
    title: p.name,
    icon: p.icon ?? '⚡',
    section: { kind: 'feature-pack', pack: p },
  }));
  // The Feature Pack Library — the one resident entry to browse / install /
  // uninstall packs (bao 2026-06-26: replaces a stray installed pack like the
  // old dev-box sitting in L1). Opens the Discover view; keyed 'discover' so it
  // highlights when that view is active. The bottom rail no longer needs a
  // separate Discover button.
  const libraryEntry: L1Entry = {
    key: 'discover',
    title: 'Feature Packs',
    icon: <Ico d={DISCOVER_D} />,
    section: { kind: 'discover' },
  };
  const packList: L1Entry[] = [...builtinFaces, libraryEntry, ...packEntries];

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

      {packList.map((e) => (
        <button
          key={e.key}
          type="button"
          className={`${styles.ic} ${active === e.key ? styles.active : ''}`}
          onClick={() => onSelect(e.section)}
          title={e.title}
        >
          {e.icon}
        </button>
      ))}

      <div className={styles.spacer} />

      <button
        type="button"
        className={styles.ic}
        onClick={() => onSelect({ kind: 'route', to: '/remote' })}
        title="Remote Window"
      >
        <RemoteIcon />
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
