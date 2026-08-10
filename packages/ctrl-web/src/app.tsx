// App root: one Ambient production shell with canonical Work, Library, and
// Settings routes. Remote pairing/browser entry remains an alternate boot mode.
// (ADR-003 frontend §8.5 v40)

import { lazy, Suspense, useEffect, type ReactElement } from 'react';
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { parsePairing } from '@/lib/remote-connection';
import { ReviewGateHost } from './components/ReviewGateHost';
import { RailProvider } from './components/PrimaryRail';
import { AmbientWorkbench } from './components/ambient/AmbientWorkbench';
import { DefaultWorkspace } from './routes/default';
import { useCompanionWindow } from './hooks/useCompanionWindow';
import { useAutoSync } from './hooks/useAutoSync';

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
        if (cancelled) off();
        else unlisten = off;
      } catch {
        // Browser remote entry has no Tauri event API.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [navigate]);
}

function RootShellInner(): ReactElement {
  useCompanionWindow();
  useAutoSync();
  return <AmbientWorkbench />;
}

function RootShell(): ReactElement {
  useTrayBridge();
  return (
    <RailProvider>
      <RootShellInner />
    </RailProvider>
  );
}

const SettingsRedirect = lazy(() =>
  import('./routes/settings').then((module) => ({ default: module.SettingsRedirect })),
);
const SettingsCtrlPage = lazy(() =>
  import('./routes/settings').then((module) => ({ default: module.SettingsCtrlPage })),
);
const SettingsProvidersPage = lazy(() =>
  import('./routes/settings').then((module) => ({ default: module.SettingsProvidersPage })),
);
const SettingsAgentPage = lazy(() =>
  import('./routes/settings').then((module) => ({ default: module.SettingsAgentPage })),
);
const SettingsEnvPage = lazy(() =>
  import('./routes/settings').then((module) => ({ default: module.SettingsEnvPage })),
);
const SettingsLogsPage = lazy(() =>
  import('./routes/settings').then((module) => ({ default: module.SettingsLogsPage })),
);
const RemoteApp = lazy(() =>
  import('./components/remote/RemoteApp').then((module) => ({ default: module.RemoteApp })),
);
const RemoteEntry = lazy(() =>
  import('./components/remote/RemoteEntry').then((module) => ({ default: module.RemoteEntry })),
);

const IconLabRoute = import.meta.env.DEV
  ? lazy(() => import('./routes/icon-lab').then((module) => ({ default: module.IconLabRoute })))
  : null;
const PackLabRoute = import.meta.env.DEV
  ? lazy(() => import('./routes/pack-lab').then((module) => ({ default: module.PackLabRoute })))
  : null;
const TableLabRoute = import.meta.env.DEV
  ? lazy(() => import('./routes/table-lab').then((module) => ({ default: module.TableLabRoute })))
  : null;

const LazyFallback = (): ReactElement => (
  <div style={{ padding: 'var(--space-6)', color: 'var(--color-text-muted)' }}>Loading…</div>
);

const rootRoute = createRootRoute({ component: RootShell });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DefaultWorkspace,
});
const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library',
  component: DefaultWorkspace,
});

// Compatibility redirects contain no data, chat, discovery, or business UI.
// Removal window: delete both after the first release newer than 0.2.x.
// (ADR-003 frontend §8.5 v40)
const codingRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/coding',
  beforeLoad: () => {
    throw redirect({ to: '/' });
  },
});
const poolRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pool',
  beforeLoad: () => {
    throw redirect({ to: '/library' });
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: () => <Suspense fallback={<LazyFallback />}><SettingsRedirect /></Suspense>,
});
const settingsCtrlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/ctrl',
  component: () => <Suspense fallback={<LazyFallback />}><SettingsCtrlPage /></Suspense>,
});
const settingsProvidersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/providers',
  component: () => <Suspense fallback={<LazyFallback />}><SettingsProvidersPage /></Suspense>,
});
const settingsAgentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/agent',
  component: () => <Suspense fallback={<LazyFallback />}><SettingsAgentPage /></Suspense>,
});
const settingsEnvRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/env',
  component: () => <Suspense fallback={<LazyFallback />}><SettingsEnvPage /></Suspense>,
});
const settingsLogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/logs',
  component: () => <Suspense fallback={<LazyFallback />}><SettingsLogsPage /></Suspense>,
});

const devRoutes = import.meta.env.DEV && IconLabRoute && PackLabRoute && TableLabRoute
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/icon-lab',
        component: () => <Suspense fallback={<LazyFallback />}><IconLabRoute /></Suspense>,
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/pack-lab',
        component: () => <Suspense fallback={<LazyFallback />}><PackLabRoute /></Suspense>,
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/table-lab',
        component: () => <Suspense fallback={<LazyFallback />}><TableLabRoute /></Suspense>,
      }),
    ]
  : [];

const routeTree = rootRoute.addChildren([
  indexRoute,
  libraryRoute,
  codingRedirectRoute,
  poolRedirectRoute,
  settingsRoute,
  settingsCtrlRoute,
  settingsProvidersRoute,
  settingsAgentRoute,
  settingsEnvRoute,
  settingsLogsRoute,
  ...devRoutes,
]);

const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

const pairing = parsePairing(window.location.search, window.location.hash);
const inTauri =
  '__TAURI_INTERNALS__' in window ||
  (import.meta.env.DEV && '__ctrlInvokeMock' in window);

export const App = (): ReactElement => {
  if (pairing != null) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<LazyFallback />}>
          <RemoteApp room={pairing.room} keyB64={pairing.key} />
        </Suspense>
      </ErrorBoundary>
    );
  }
  if (!inTauri) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<LazyFallback />}>
          <RemoteEntry />
        </Suspense>
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <ReviewGateHost />
      </QueryClientProvider>
    </ErrorBoundary>
  );
};
