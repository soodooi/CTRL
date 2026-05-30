// App root — TanStack Router setup + React Query provider + the cockpit
// shell.
//
// 2026-05-29 restructure (bao): shell is a 4-column grid (left → right):
//   [ Display (route Outlet) | Irisy chat (fixed) | L2 nav | L1 nav (icons) ]
// + StatusBar (top, full width) and a version pill anchored bottom-left.
//
// Irisy chat is SHELL-LEVEL and does NOT unmount on route change — it is
// the fixed assistant resource across assistant / workbench / workspace
// surfaces (bao 2026-05-29).
//
// The Keyboard component used to live in a fixed left rail; it is now
// route content (rendered into the display area where appropriate).

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
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StatusBar } from './components/StatusBar';
import { Keyboard, KEYCAP_DRAG_MIME } from './components/Keyboard';
import { KeycapNav } from './components/KeycapNav';
import { RailProvider, RightRail, useRail } from './components/RightRail';
import { L2Panel } from './components/L2Panel';
import { VersionPill } from './components/VersionPill';
import { IrisyChat } from './components/irisy/IrisyChat';
import { DefaultWorkspace } from './routes/default';
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
  const { l2Open } = useRail();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createFromKeycap = useWorkspaceStore((s) => s.createFromKeycap);
  const [dragOver, setDragOver] = useState(false);

  // Drag-over only flips when our custom MIME is present — text drags
  // from outside the cockpit don't paint the drop affordance.
  const hasKeycapPayload = (e: DragEvent<HTMLElement>): boolean =>
    Array.from(e.dataTransfer.types).includes(KEYCAP_DRAG_MIME);

  const handleDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    if (!hasKeycapPayload(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    if (e.currentTarget === e.target) setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLElement>) => {
      if (!hasKeycapPayload(e)) return;
      e.preventDefault();
      setDragOver(false);
      const id = e.dataTransfer.getData(KEYCAP_DRAG_MIME);
      if (!id) return;
      const cache = queryClient.getQueryData<Array<{ id: string; name: string }>>(['keycaps']);
      const summary = cache?.find((k) => k.id === id);
      if (!summary) return;
      createFromKeycap({ id: summary.id, name: summary.name });
      await navigate({ to: '/workspace' });
    },
    [createFromKeycap, navigate, queryClient],
  );

  return (
    <div className={styles.shell} data-l2={l2Open ? 'open' : 'closed'}>
      <div className={styles.status}>
        <StatusBar />
      </div>
      <div className={styles.l1}>
        <RightRail />
      </div>
      <div className={styles.l2}>
        <L2Panel />
      </div>
      <aside className={styles.keycap} aria-label="Keycap panel">
        <Keyboard />
      </aside>
      <main
        className={styles.main}
        data-drag-over={dragOver || undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Outlet />
        <VersionPill />
      </main>
      <div className={styles.irisy}>
        <IrisyChat />
      </div>
      <div className={styles.l1b}>
        <KeycapNav />
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
const SettingsBrainPage = lazy(() =>
  import('./routes/settings').then((m) => ({ default: m.SettingsBrainPage })),
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
const VaultRoute = lazy(() =>
  import('./routes/vault').then((m) => ({ default: m.VaultRoute })),
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
const vaultRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/vault',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <VaultRoute />
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
const settingsBrainRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/brain',
  component: () => (
    <Suspense fallback={<LazyFallback />}>
      <SettingsBrainPage />
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
  vaultRoute,
  workbenchRoute,
  workspaceRoute,
  settingsRoute,
  settingsCtrlRoute,
  settingsBrainRoute,
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
