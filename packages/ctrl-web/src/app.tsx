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
  Link,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
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

const LazyFallback = (): React.ReactElement => (
  <div style={{ padding: 'var(--space-6)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
    Loading…
  </div>
);

const rootRoute = createRootRoute({
  component: () => (
    <div className={styles.shell}>
      <nav className={styles.nav} aria-label="Primary">
        <Link to="/" className={styles.navItem} activeProps={{ className: styles.navItemActive }}>
          Pool
        </Link>
        <Link to="/workspace" className={styles.navItem} activeProps={{ className: styles.navItemActive }}>
          Workspace
        </Link>
        <Link to="/settings" className={styles.navItem} activeProps={{ className: styles.navItemActive }}>
          Settings
        </Link>
      </nav>
      <Outlet />
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
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

const routeTree = rootRoute.addChildren([indexRoute, workspaceRoute, settingsRoute]);

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
