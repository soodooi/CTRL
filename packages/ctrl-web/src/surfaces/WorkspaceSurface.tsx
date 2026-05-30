// WorkspaceSurface — the "big window" (~1370 px) where advanced keycaps
// render and where the user browses installed keycaps.
//
// Architecture (per ECC round-2 research, 2026-05-30 sign-off):
// macOS NSWindow.addChildWindow(.below) makes this an AppKit child of
// main, so position-follow + hide-cascade are handled by AppKit. JS
// glue is defense-in-depth. Phase A is macOS-only; Windows/Linux Phase B
// will use Tauri 2's unified WindowBuilder::parent (PR #8622) +
// WM_WINDOWPOSCHANGED hook on Win.
//
// v0.1.95 fix: the 0.1.95 ship missed the lifecycle wire (no
// addChildWindow + no in-window close button + no Ctrl-cascade), so the
// workspace window became a "ghost" the user couldn't dismiss. v2 ships
// THREE close paths: ▾ on main L1, the → button in this header, and the
// Ctrl hotkey via main hide → child auto-hide.

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
  // Second close path (the ▾ on main L1 is the first; Ctrl hotkey via
  // main hide is the third). Per multi-window UX literature, decoration-
  // less companion windows MUST provide ≥2 close affordances.
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

export const WorkspaceSurface = (): ReactElement => (
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
);
