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
import { invoke } from '@tauri-apps/api/core';
import { Sidebar, type SidebarSection } from './Sidebar';
import { ProviderPicker } from './ProviderPicker';
import { AmbientHome, type ToolRequest } from './AmbientHome';
import styles from './AmbientHome.module.css';

export function AmbientWorkbench(): ReactElement {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === '/' || pathname === '/irisy' || pathname === '';

  const [modelLabel, setModelLabel] = useState<string>('Model');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false); // mobile sidebar drawer
  const [view, setView] = useState<'chat' | 'discover'>('chat');
  const [toolRequest, setToolRequest] = useState<ToolRequest | null>(null);
  const [irisyNonce, setIrisyNonce] = useState(0);

  // Show the active model in the sidebar chip (click to switch).
  useEffect(() => {
    void invoke<{ roles: Record<string, { label: string; model_id: string | null }> }>(
      'get_active_providers',
    )
      .then((v) => {
        const p = v.roles['irisy.primary'];
        if (p) setModelLabel(p.model_id ? `${p.label} · ${p.model_id}` : p.label);
      })
      .catch(() => {});
  }, [pickerOpen]);

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
        setIrisyNonce((n) => n + 1);
      } else if (s.kind === 'tool') {
        setView('chat');
        setToolRequest({ connectorId: s.connectorId, toolName: s.toolName, nonce: Date.now() });
      } else if (s.kind === 'discover') {
        setView('discover');
      }
    },
    [navigate, isHome],
  );

  // Only highlight a sidebar entry on home; routed pages own their own nav.
  const activeSection = isHome ? (view === 'discover' ? 'discover' : 'irisy') : '';

  return (
    <div className={styles.workbench} data-drawer={drawerOpen || undefined} data-testid="shell">
      <Sidebar
        active={activeSection}
        onSelect={onSidebarSelect}
        modelLabel={modelLabel}
        onModel={() => setPickerOpen(true)}
        styles={styles}
      />
      {drawerOpen && <div className={styles.scrim} onClick={() => setDrawerOpen(false)} />}

      {isHome ? (
        <AmbientHome
          view={view}
          onView={setView}
          modelLabel={modelLabel}
          onOpenPicker={() => setPickerOpen(true)}
          onToggleDrawer={() => setDrawerOpen((v) => !v)}
          toolRequest={toolRequest}
          irisyNonce={irisyNonce}
        />
      ) : (
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
        <ProviderPicker
          onClose={() => setPickerOpen(false)}
          onActivated={(label, m) => setModelLabel(`${label} · ${m}`)}
        />
      )}
    </div>
  );
}
