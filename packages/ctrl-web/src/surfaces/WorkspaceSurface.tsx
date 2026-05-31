// WorkspaceSurface — the workspace independent Tauri window content.
//
// bao 2026-05-30 v2 revival: workspace is its own NSWindow, glued left
// of main via NSWindow.addChildWindow. This file is what that window
// renders. v0 = installed keycap grid + close button. Future iterations
// add Pool / Workbench / per-keycap output tabs.
//
// 3 close paths shipped to avoid v0.1.95's "ghost window" rejection:
//   1. ▾ button on main L1 (primary)
//   2. → button in this header (secondary)
//   3. Ctrl hotkey hides main → WindowController cascades to workspace

import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import { invoke } from '../lib/bridge';
import styles from './WorkspaceSurface.module.css';

function CloseButton(): ReactElement {
  const handleClose = async (): Promise<void> => {
    try {
      await invoke('toggle_workspace_window');
    } catch {
      /* browser PWA — nothing to toggle */
    }
  };
  return (
    <button
      type="button"
      className={styles.closeButton}
      onClick={() => void handleClose()}
      title="Close workspace (Ctrl tap also hides; ▾ on main L1 toggles)"
      aria-label="Close workspace"
    >
      →
    </button>
  );
}

function WorkspaceContent(): ReactElement {
  const { data: keycaps = [], isLoading } = useQuery({
    queryKey: ['keycaps'],
    queryFn: listKeycaps,
  });

  return (
    <div className={styles.surface}>
      <header className={styles.header} data-tauri-drag-region>
        <span className={styles.title}>Keycaps</span>
        <span className={styles.count}>
          {isLoading ? '…' : `${keycaps.length} installed`}
        </span>
        <CloseButton />
      </header>

      <main className={styles.main}>
        {keycaps.length === 0 && !isLoading ? (
          <div className={styles.empty}>
            <p>No keycaps installed yet.</p>
            <p className={styles.hint}>
              Use <kbd>Create</kbd> on the main companion to talk Irisy
              through making your first keycap.
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

export const WorkspaceSurface = (): ReactElement => (
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
);
