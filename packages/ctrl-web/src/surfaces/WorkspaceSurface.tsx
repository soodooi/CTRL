// WorkspaceSurface — the "big window" (~1800 px) where advanced keycaps
// render, where the user browses installed keycaps, and where keycap
// composition / output landing happens.
//
// Main window stays a 430-px companion (L1 + Irisy chat). Workspace is a
// separate Tauri window left of main, opened by the L1 ▾ toggle and
// glued to main on drag (see commands/system.rs::spawn_workspace_window).
//
// v0 = browse installed keycaps as a centered grid. Future tabs (Pool /
// Workbench / per-keycap output) layer on as bao validates each.
//
// bao 2026-05-30: "其他高级的 keycap 要用大窗口来呈现更多信息;
// 之前是一共 1800px 宽度，你差不多按照这个标准设计；
// 你也不用改吧，把之前代码修改一下就成了新窗口了。"

import { useQuery } from '@tanstack/react-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
} from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { listKeycaps, type KeycapSummary } from '../lib/kernel';
import { normalizeIcon } from '../lib/icon';
import { IconRenderer } from '../components/primitives';
import styles from './WorkspaceSurface.module.css';

function WorkspaceContent(): ReactElement {
  const { data: keycaps = [], isLoading } = useQuery({
    queryKey: ['keycaps'],
    queryFn: listKeycaps,
  });

  return (
    <div className={styles.surface}>
      <header className={styles.header}>
        <span className={styles.title}>Keycaps</span>
        <span className={styles.count}>
          {isLoading ? '…' : `${keycaps.length} installed`}
        </span>
      </header>

      <main className={styles.main}>
        {keycaps.length === 0 && !isLoading ? (
          <div className={styles.empty}>
            <p>No keycaps installed yet.</p>
            <p className={styles.hint}>
              Use <kbd>Create</kbd> on the main companion to talk Irisy
              through building your first keycap.
            </p>
          </div>
        ) : (
          <div className={styles.grid}>
            {keycaps.map((k: KeycapSummary) => {
              const icon = normalizeIcon(k.icon, k.name);
              return (
                <div
                  key={k.id}
                  className={styles.card}
                  data-color={k.keycap_color}
                  title={k.name}
                >
                  <span className={styles.cardIcon} aria-hidden="true">
                    <IconRenderer icon={icon} size={36} ariaLabel={k.name} />
                  </span>
                  <span className={styles.cardLabel}>{k.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

// Workspace runs in a separate Tauri webview window with its own JS context;
// it needs its own QueryClient + RouterProvider. Routes are minimal here —
// later phases add Pool / Workbench / per-keycap-output tabs.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

const rootRoute = createRootRoute({ component: WorkspaceContent });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: WorkspaceContent,
});
const routeTree = rootRoute.addChildren([indexRoute]);
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  basepath: '/',
});

declare module '@tanstack/react-router' {
  interface Register {
    // Intentionally not registering a second router type here — the main
    // window owns the global Register. Workspace uses an anonymous router
    // so it doesn't fight the main app's route definitions.
  }
}

export const WorkspaceSurface = (): ReactElement => (
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
);
