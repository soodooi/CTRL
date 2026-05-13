// App root — TanStack Router setup + React Query provider.

import { useMemo } from 'react';
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
  Link,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PoolRoute } from './routes/pool';
import { WorkspaceRoute } from './routes/workspace';
import { SettingsRoute } from './routes/settings';
import styles from './app.module.css';

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
  component: WorkspaceRoute,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsRoute,
});

const routeTree = rootRoute.addChildren([indexRoute, workspaceRoute, settingsRoute]);

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createCtrlRouter>;
  }
}

const createCtrlRouter = (): ReturnType<typeof createRouter> =>
  createRouter({
    routeTree,
    defaultPreload: 'intent',
  });

export const App = (): React.ReactElement => {
  const router = useMemo(() => createCtrlRouter(), []);
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
};
