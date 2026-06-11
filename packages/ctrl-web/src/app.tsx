// App root — TanStack Router setup + React Query provider + the cockpit
// shell.
//
// ADR-003 frontend §7 v4 (2026-06-01): 4-column shell.
// Column order LEFT -> RIGHT: [Tab | L2 | L1 | Irisy].
// L1 sits immediately left of Irisy and never moves on screen. The
// workspace tab area grows leftward when the chevron expands the main
// window (478 <-> 1600 via Rust `toggle_workspace_window`).
//
// Compact mode (window=478): Tab=0, L2=0, L1=48, Irisy=430 — only L1
// and Irisy render. L1 chips that open a workspace tab (Pool / Coding /
// Settings) do NOT auto-expand the window; the user controls expand
// via the chevron alone (ADR-003 §7.3 + §7.8 anti-pattern).
//
// Outlet stays mounted inside a hidden host so legacy routes don't
// error on lookup; full route retirement = next PR (ADR-003 §7.5).
//
// Irisy chat is SHELL-LEVEL and does NOT unmount on route change — fixed
// assistant resource (bao 2026-05-29; reaffirmed §7).

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type DragEvent,
  type ReactElement,
} from 'react';
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StatusBar } from './components/StatusBar';
import { OllamaSetupBanner } from './components/OllamaSetupBanner';
import { MCP_DRAG_MIME } from './components/Keyboard';
import { RailProvider, PrimaryRail } from './components/PrimaryRail';
import { AmbientHome } from './components/ambient/AmbientHome';

// ADR-003 §8 v6 morphing-conversation rebuild. Default ON — the new
// centered ambient surface replaces the legacy 4-column shell as the home.
// Set localStorage `ctrl:legacy-shell` = '1' to fall back to the old shell.
const USE_AMBIENT =
  typeof window === 'undefined' || window.localStorage.getItem('ctrl:legacy-shell') !== '1';
import { InfraBar } from './components/InfraBar';
import { IrisyChat } from './components/irisy/IrisyChat';
import { WorkspaceShell } from './components/workspace/WorkspaceShell';
import { DefaultWorkspace } from './routes/default';
import { useCompanionWindow } from './hooks/useCompanionWindow';
import { useWorkspaceStore } from './lib/workspace-store';
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createFromMcp = useWorkspaceStore((s) => s.createFromMcp);
  const workspaceOpen = useWorkspaceStore((s) => s.instances.length > 0);
  const [dragOver, setDragOver] = useState(false);
  useCompanionWindow();

  // Drag-over only flips when our custom MIME is present — text drags
  // from outside the cockpit don't paint the drop affordance.
  const hasMcpPayload = (e: DragEvent<HTMLElement>): boolean =>
    Array.from(e.dataTransfer.types).includes(MCP_DRAG_MIME);

  const handleDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    if (!hasMcpPayload(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    if (e.currentTarget === e.target) setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLElement>) => {
      if (!hasMcpPayload(e)) return;
      e.preventDefault();
      setDragOver(false);
      const id = e.dataTransfer.getData(MCP_DRAG_MIME);
      if (!id) return;
      const cache = queryClient.getQueryData<Array<{ id: string; name: string }>>(['mcps']);
      const summary = cache?.find((k) => k.id === id);
      if (!summary) return;
      createFromMcp({ id: summary.id, name: summary.name });
      await navigate({ to: '/workspace' });
    },
    [createFromMcp, navigate, queryClient],
  );

  if (USE_AMBIENT) {
    return <AmbientShell />;
  }

  return (
    <div
      className={styles.shell}
      data-workspace-open={workspaceOpen || undefined}
      data-testid="shell"
    >
      <div className={styles.status} data-testid="grid-status">
        <StatusBar />
        <OllamaSetupBanner />
      </div>
      <div className={styles.l1} data-testid="grid-l1">
        <PrimaryRail />
      </div>
      {/* L2 — reserved for future sub-nav of L1 modules. Width 0 by
          default; future L1 modules can flip `data-l2-open='true'` when
          they declare structured sub-nav. Notes / Pool / Coding use a
          full workspace tab body instead (bao 2026-06-02 — Vault is
          substrate, Notes is an in-tab app). */}
      <div className={styles.l2} data-testid="grid-l2" />
      {/* Tab — workspace tab content (TabBar + active tab body). The
          `--tab-width: 0` default keeps it collapsed until a workspace
          instance opens, at which point `data-workspace-open="true"`
          flips it to `1fr`. */}
      <div className={styles.tab} data-testid="grid-tab">
        <WorkspaceShell fallback={null} />
      </div>
      <div className={styles.irisy} data-testid="grid-irisy">
        <IrisyChat />
        <InfraBar />
      </div>
      {/* Hidden Outlet host — legacy routes still mount here but render
          invisibly. Drag-over handler retained on the hidden node so the
          shell-level mcp drop in `app.tsx` still works during transition;
          full route retirement = next PR (ADR-003 frontend §7.5). */}
      <div
        className={styles.outletHidden}
        data-drag-over={dragOver || undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Outlet />
      </div>
    </div>
  );
}

// ADR-003 §8 v6 — the ambient surface is the home; other routes (settings /
// coding / notes / pool) still render via the router, with a slim back bar.
// Keeps the morphing conversation as the heart while the faces stay reachable.
function AmbientShell(): ReactElement {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === '/' || pathname === '/irisy' || pathname === '';

  if (isHome) {
    return (
      <div className={styles.ambientRoot} data-testid="shell">
        <AmbientHome />
      </div>
    );
  }
  return (
    <div className={styles.ambientRoot} data-testid="shell">
      <div className={styles.routeHost}>
        <button
          type="button"
          className={styles.backBar}
          onClick={() => void navigate({ to: '/' })}
        >
          ← Irisy
        </button>
        <div className={styles.routeBody}>
          <Outlet />
        </div>
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
const SettingsProvidersPage = lazy(() =>
  import('./routes/settings').then((m) => ({ default: m.SettingsProvidersPage })),
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
const CodingRoute = lazy(() =>
  import('./routes/coding').then((m) => ({ default: m.CodingRoute })),
);
const CodeSpaceDetailRoute = lazy(() =>
  import('./routes/code-space').then((m) => ({ default: m.CodeSpaceDetailRoute })),
);
const PoolRoute = lazy(() =>
  import('./routes/pool').then((m) => ({ default: m.PoolRoute })),
);
const NotesRoute = lazy(() =>
  import('./routes/notes').then((m) => ({ default: m.NotesRoute })),
);
const WorkbenchRoute = lazy(() =>
  import('./routes/workbench').then((m) => ({ default: m.WorkbenchRoute })),
);
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
const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notes',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <NotesRoute />
    </Suspense>
  ),
});
const workbenchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workbench',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <WorkbenchRoute />
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
const settingsProvidersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/providers',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <SettingsProvidersPage />
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
// bao 2026-06-01: `/irisy` no longer mounts <IrisyRoute /> through the
// hidden Outlet — the shell-level <IrisyChat /> in the .irisy column is
// the only IrisyChat instance. Mounting a second copy here (even with
// display:none) double-fires irisy_init polling + localStorage writes
// and produces the visible "two chat columns" the user reported.
// Lazy `IrisyRoute` import kept for potential future use.
void IrisyRoute;
const irisyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/irisy',
  component: () => null,
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
const codingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/coding',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <CodingRoute />
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
  notesRoute,
  workbenchRoute,
  workspaceRoute,
  settingsRoute,
  settingsCtrlRoute,
  settingsProvidersRoute,
  settingsLogsRoute,
  irisyRoute,
  codeSpaceRoute,
  codeSpaceDetailRoute,
  codingRoute,
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
