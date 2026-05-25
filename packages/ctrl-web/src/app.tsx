// App root — TanStack Router setup + React Query provider + the cockpit
// shell (StatusBar / Keyboard / Workspace / RightRail).
//
// Per decision_pwa_two_panel_layout (bao 2026-05-22): the shell is a
// 3-column grid — keyboard on the left always, workspace in the middle
// hosting the active route, right rail on the right for context items.
// No iPhone bezels, no bottom tab.

import { lazy, Suspense, useEffect, type ReactElement } from 'react';
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
  useNavigate,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StatusBar } from './components/StatusBar';
import { Keyboard } from './components/Keyboard';
import { RailProvider, RightRail, useRail } from './components/RightRail';
import { DefaultWorkspace } from './routes/default';
import styles from './app.module.css';

const TRAY_OPEN_CONFIG = 'tray:open-config';

function useTrayBridge(): void {
  const navigate = useNavigate();
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        if (cancelled) return;
        const off = await listen(TRAY_OPEN_CONFIG, () => {
          void navigate({ to: '/settings' });
        });
        if (cancelled) {
          off();
          return;
        }
        unlisten = off;
      } catch {
        // Browser-only PWA: no Tauri event API, skip.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [navigate]);
}

function RootShellInner(): ReactElement {
  const { items, irisySubPanel, activeRailId } = useRail();
  // Per bao 2026-05-23: level-2 visibility = active level-1 item has a
  // sub-panel. Two-state grid: hidden (80px primary only) vs open
  // (240px panel + 80px primary). No explicit "collapsed but visible"
  // tab — clicking the active item itself toggles.
  const irisyHasPanel = irisySubPanel != null;
  const activeItemHasPanel =
    activeRailId === 'irisy'
      ? irisyHasPanel
      : items.some((i) => i.id === activeRailId && i.subPanel != null);
  const subPanelState = activeItemHasPanel ? 'open' : 'none';
  return (
    <div className={styles.shell} data-sub-panel={subPanelState}>
      <div className={styles.status}>
        <StatusBar />
      </div>
      <div className={styles.keyboard}>
        <Keyboard />
      </div>
      <main className={styles.workspace}>
        <Outlet />
      </main>
      <div className={styles.rail}>
        <RightRail />
      </div>
    </div>
  );
}

function RootShell(): ReactElement {
  useTrayBridge();
  return (
    <RailProvider>
      <RootShellInner />
    </RailProvider>
  );
}

// Workspace + code-space + irisy chunks stay lazy — they pull xterm /
// cbor-x and an LLM transport that the keyboard view doesn't need.
const WorkspaceRoute = lazy(() =>
  import('./routes/workspace').then((m) => ({ default: m.WorkspaceRoute })),
);
const SettingsRedirect = lazy(() =>
  import('./routes/settings').then((m) => ({ default: m.SettingsRedirect })),
);
const SettingsCtrlPage = lazy(() =>
  import('./routes/settings').then((m) => ({ default: m.SettingsCtrlPage })),
);
const SettingsHermesPage = lazy(() =>
  import('./routes/settings').then((m) => ({ default: m.SettingsHermesPage })),
);
const SettingsLogsPage = lazy(() =>
  import('./routes/settings').then((m) => ({ default: m.SettingsLogsPage })),
);
const IrisyRoute = lazy(() =>
  import('./routes/irisy').then((m) => ({ default: m.IrisyRoute })),
);
const CodeSpaceRoute = lazy(() =>
  import('./routes/code-space').then((m) => ({ default: m.CodeSpaceRoute })),
);
const CodeSpaceDetailRoute = lazy(() =>
  import('./routes/code-space').then((m) => ({ default: m.CodeSpaceDetailRoute })),
);
const PoolRoute = lazy(() =>
  import('./routes/pool').then((m) => ({ default: m.PoolRoute })),
);
// icon-lab is a development-only renderer bake-off. It imports
// `lottie-react` for the side-by-side comparison — having that second
// engine in a production chunk violates SKILL.md §7. Gating the dynamic
// import behind `import.meta.env.DEV` lets Vite tree-shake the entire
// route + its `lottie-react` dependency out of production builds.
const IconLabRoute = import.meta.env.DEV
  ? lazy(() =>
      import('./routes/icon-lab').then((m) => ({ default: m.IconLabRoute })),
    )
  : lazy(() =>
      Promise.resolve({
        default: (): ReactElement => (
          <div
            style={{
              padding: 'var(--space-6)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-muted)',
            }}
          >
            icon-lab is dev-only.
          </div>
        ),
      }),
    );

const LazyFallback = (): ReactElement => (
  <div style={{
    padding: 'var(--space-6)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-muted)',
  }}>
    Loading…
  </div>
);

const rootRoute = createRootRoute({ component: RootShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DefaultWorkspace,
});
const poolRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pool',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <PoolRoute />
    </Suspense>
  ),
});
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspace',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <WorkspaceRoute />
    </Suspense>
  ),
});
// /settings — three sub-pages selected from the right-rail level-2
// panel. Bare /settings is a redirect shim to /settings/ctrl so old
// tray-bridge / keyboard system-key flows that pointed at the legacy
// single page keep working.
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <SettingsRedirect />
    </Suspense>
  ),
});
const settingsCtrlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/ctrl',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <SettingsCtrlPage />
    </Suspense>
  ),
});
const settingsHermesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/hermes',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <SettingsHermesPage />
    </Suspense>
  ),
});
const settingsLogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/logs',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <SettingsLogsPage />
    </Suspense>
  ),
});
const irisyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/irisy',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <IrisyRoute />
    </Suspense>
  ),
});
const codeSpaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/code-space',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <CodeSpaceRoute />
    </Suspense>
  ),
});
const codeSpaceDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/code-space/$envId',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <CodeSpaceDetailRoute />
    </Suspense>
  ),
});
const iconLabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/icon-lab',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <IconLabRoute />
    </Suspense>
  ),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  poolRoute,
  workspaceRoute,
  settingsRoute,
  settingsCtrlRoute,
  settingsHermesRoute,
  settingsLogsRoute,
  irisyRoute,
  codeSpaceRoute,
  codeSpaceDetailRoute,
  iconLabRoute,
]);

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

export const App = (): ReactElement => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </ErrorBoundary>
);
