// AmbientWorkbench — the persistent 3-zone shell (ADR-003 §8 + ADR-006 §5).
//
// CTRL is the one-person company's LOCAL super-app shell. The sidebar
// (your launcher) stays mounted across EVERY route, so opening Notes /
// Coding / Settings never drops you into a bare "back bar" — the company
// cockpit is always there. The main column is either the morphing
// AmbientHome (chat / discover) on home, or the routed workspace.
//
// State that the sidebar drives (active model, mobile drawer, which tool
// to run, discover vs chat) lives here and is forwarded to AmbientHome by
// props, so the sidebar can act from any route (navigating home first
// when needed).

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { type SidebarSection } from './Sidebar';
import { ProviderHub } from './ProviderHub';
import { AmbientHome, type ToolRequest, type PackRequest } from './AmbientHome';
import { useActiveProvider, formatProviderLabel } from '@/hooks/useActiveProvider';
import { useKernelStatus } from '@/hooks/useKernelStatus';
import { isSeedingFirstRun } from '@/lib/kernel';
import {
  initKernelPackEventListener,
  loadInstalledPacks,
  PACKS_CHANGED_EVENT,
  type PacksChangedDetail,
} from '@/lib/feature-pack';
import styles from './AmbientHome.module.css';

export function AmbientWorkbench(): ReactElement {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === '/' || pathname === '/irisy' || pathname === '';

  const [pickerOpen, setPickerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false); // mobile sidebar drawer
  const [view, setView] = useState<'chat' | 'discover'>('chat');
  const [toolRequest, setToolRequest] = useState<ToolRequest | null>(null);
  const [packRequest, setPackRequest] = useState<PackRequest | null>(null);
  const [openTodayNonce, setOpenTodayNonce] = useState(0);
  const [openNotesNonce, setOpenNotesNonce] = useState(0);
  const [openTablesNonce, setOpenTablesNonce] = useState(0);
  const [openCodingNonce, setOpenCodingNonce] = useState(0);
  const [irisyNonce, setIrisyNonce] = useState(0);
  // Which sidebar entry is highlighted on home ('irisy' | 'discover' |
  // `${connectorId}.${toolName}`). Routes own their own nav, so off-home
  // nothing is highlighted.
  const [navSel, setNavSel] = useState<string>('irisy');

  // Active provider feeds the Sidebar model chip + AmbientHome top
  // display. Decision 0007 §display (2026-06-19): single hook replaces
  // the per-component invoke + listen + format-string tangle. The
  // pickerOpen dep stays so the chip refreshes immediately after the
  // user closes the picker (which may have set a new active provider
  // via ProviderHub, whose own reload path also fires the event).
  const { active: activeProvider } = useActiveProvider();
  const modelLabel = formatProviderLabel(activeProvider);

  // Fresh-install seeding hint (ADR-006 § cold-start-loop §6.1 G3): while the
  // kernel copies builtin mcps into ~/.ctrl/mcps/, the Tools/Discover lists are
  // legitimately empty — surface "Setting up CTRL…" so a new user doesn't read
  // it as broken. Once seeded (first_run_state='ready') this goes quiet.
  const kernelSnapshot = useKernelStatus();
  const settingUp = isSeedingFirstRun(kernelSnapshot);

  // The sidebar acts from any route: home-content actions (Irisy / tool /
  // discover) navigate home first, then signal AmbientHome via props.
  const onSidebarSelect = useCallback(
    (s: SidebarSection) => {
      setDrawerOpen(false);
      if (s.kind === 'route') {
        void navigate({ to: s.to });
        return;
      }
      if (!isHome) void navigate({ to: '/' });
      if (s.kind === 'irisy') {
        setView('chat');
        setNavSel('irisy');
        setIrisyNonce((n) => n + 1);
      } else if (s.kind === 'tool') {
        setView('chat');
        setNavSel(`${s.connectorId}.${s.toolName}`);
        setToolRequest({ connectorId: s.connectorId, toolName: s.toolName, nonce: Date.now() });
      } else if (s.kind === 'discover') {
        setView('discover');
        setNavSel('discover');
      } else if (s.kind === 'feature-pack') {
        setView('chat');
        setNavSel(`pack.${s.pack.id}`);
        setPackRequest({ pack: s.pack, nonce: Date.now() });
      } else if (s.kind === 'today') {
        setView('chat');
        setNavSel('today');
        setOpenTodayNonce((n) => n + 1);
      } else if (s.kind === 'notes') {
        setView('chat');
        setNavSel('notes');
        setOpenNotesNonce((n) => n + 1);
      } else if (s.kind === 'tables') {
        setView('chat');
        setNavSel('tables');
        setOpenTablesNonce((n) => n + 1);
      } else if (s.kind === 'coding') {
        setView('chat');
        setNavSel('coding');
        setOpenCodingNonce((n) => n + 1);
      }
    },
    [navigate, isHome],
  );

  // Gap-2: subscribe to kernel-side pack changes on :17872 and bridge them to
  // the browser PACKS_CHANGED_EVENT. A pack installed by Irisy/brain through the
  // gate, or upgraded by the builtin seed, otherwise never reaches the PWA (its
  // own PACKS_CHANGED_EVENT fires only for PWA-initiated installs). Mount-only:
  // the WS connection stays stable across re-renders.
  useEffect(() => initKernelPackEventListener(), []);

  // Auto-open a pack the instant it's installed kernel-side — matching the PWA
  // install flow's "appears + opens" (bao 2026-07-05: a brain/seed install
  // should auto-open just like a Discover install does).
  useEffect(() => {
    const onPacksChanged = (e: Event): void => {
      const detail = (e as CustomEvent<PacksChangedDetail>).detail;
      if (detail?.action !== 'installed' || !detail.id) return;
      const id = detail.id;
      void loadInstalledPacks().then((packs) => {
        const pack = packs.find((p) => p.id === id);
        if (!pack) return;
        if (!isHome) void navigate({ to: '/' });
        setView('chat');
        setNavSel(`pack.${pack.id}`);
        setPackRequest({ pack, nonce: Date.now() });
      });
    };
    window.addEventListener(PACKS_CHANGED_EVENT, onPacksChanged);
    return () => window.removeEventListener(PACKS_CHANGED_EVENT, onPacksChanged);
  }, [isHome, navigate]);

  // Only highlight a sidebar entry on home; routed pages own their own nav.
  const activeSection = isHome ? navSel : '';

  return (
    <div className={styles.workbench} data-drawer={drawerOpen || undefined} data-testid="shell">
      {/* L1 rail moved INTO AmbientHome's layout (ADR-003 §7 `[Tab|L2|L1|Irisy]`,
          bao 2026-06-13: L1 in the middle, glued to Irisy's left — not far-left).
          Route pages navigate back via the route topbar's back bar. */}
      {drawerOpen && <div className={styles.scrim} onClick={() => setDrawerOpen(false)} />}

      {/* AmbientHome stays MOUNTED across every route (collapsed when a
          route owns the column) so chat state survives a Settings/Notes
          visit and the nonce effects never replay on a remount. */}
      <AmbientHome
        view={view}
        onView={setView}
        modelLabel={modelLabel}
        providerId={activeProvider?.id ?? null}
        onOpenPicker={() => setPickerOpen(true)}
        onToggleDrawer={() => setDrawerOpen((v) => !v)}
        toolRequest={toolRequest}
        packRequest={packRequest}
        openTodayNonce={openTodayNonce}
        openNotesNonce={openNotesNonce}
        openTablesNonce={openTablesNonce}
        openCodingNonce={openCodingNonce}
        irisyNonce={irisyNonce}
        hidden={!isHome}
        onSidebarSelect={onSidebarSelect}
        activeSection={activeSection}
        settingUp={settingUp}
      />
      {!isHome && (
        <div className={styles.routeHost}>
          <div className={styles.routeTopbar} data-tauri-drag-region>
            <button
              type="button"
              className={styles.menuBtn}
              onClick={() => setDrawerOpen((v) => !v)}
              title="Menu"
              aria-label="Menu"
            >
              ☰
            </button>
            <button type="button" className={styles.backBar} onClick={() => void navigate({ to: '/' })}>
              ← Irisy
            </button>
          </div>
          <div className={styles.routeBody}>
            <Outlet />
          </div>
        </div>
      )}

      {pickerOpen && (
        <ProviderHub
          onClose={() => setPickerOpen(false)}
          // No onActivated needed — useActiveProvider's event listener
          // refreshes the chip when provider_set_active emits
          // `active-providers-changed`. Old imperative setModelLabel
          // shadowed the SSOT and raced with the event.
          onActivated={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
