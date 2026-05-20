// App root — TanStack Router setup + React Query provider.
// Outlet is referenced inside rootRoute.component below; the linter sees it
// embedded in JSX.

import { lazy, Suspense } from 'react';
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StatusBar } from './components/StatusBar';
import { BottomTab } from './components/BottomTab';
import { HomeRoute } from './routes/home';
import { PoolRoute } from './routes/pool';
import styles from './app.module.css';

// Workspace pulls in cbor-x + the stream feed renderer; both are only needed
// once a keycap activation routes to /workspace. Lazy-load to keep the Pool
// critical path tiny on first paint after a destroy + rebuild summon.
const WorkspaceRoute = lazy(() =>
  import('./routes/workspace').then((m) => ({ default: m.WorkspaceRoute })),
);
const SettingsRoute = lazy(() =>
  import('./routes/settings').then((m) => ({ default: m.SettingsRoute })),
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

const LazyFallback = (): React.ReactElement => (
  <div style={{ padding: 'var(--space-6)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
    Loading…
  </div>
);

const rootRoute = createRootRoute({
  component: () => (
    <div className={styles.shell}>
      <StatusBar />
      <main className={styles.outlet}>
        <Outlet />
      </main>
      <BottomTab />
    </div>
  ),
});

// `/` = the dual iPhone-frame home view (decision_pc_mirrors_mobile_layout).
// `/pool` and `/workspace` remain as standalone routes — used by the Tauri
// dedicated workspace window (per workspace.tsx header) and as deep-links.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeRoute,
});
const poolRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pool',
  component: PoolRoute,
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
      <SettingsRoute />
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  poolRoute,
  workspaceRoute,
  settingsRoute,
  irisyRoute,
  codeSpaceRoute,
  codeSpaceDetailRoute,
]);

// Singleton router so `Register.router = typeof router` is concrete (gives
// type-safe Link path autocompletion). Erased `ReturnType<typeof createRouter>`
// would degrade `to` props to `string`.
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Singleton — created at module load so React Strict Mode dev double-mount
// doesn't construct two QueryClients.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

export const App = (): React.ReactElement => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </ErrorBoundary>
);
