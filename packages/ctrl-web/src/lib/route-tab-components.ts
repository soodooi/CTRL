// Route → lazy component map for `kind: 'route'` workspace tabs.
//
// The shell's WorkspaceShell `renderTabBody` uses this to render the
// actual route component inside a tab body (instead of the placeholder
// it used to show). Each entry is a `React.lazy` so the chunk only
// loads when the tab is opened — same code-splitting as the file-based
// routes registered in `app.tsx`.

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export const ROUTE_TAB_COMPONENTS: Record<string, LazyExoticComponent<ComponentType>> = {
  '/settings/ctrl': lazy(() =>
    import('@/routes/settings').then((m) => ({ default: m.SettingsCtrlPage })),
  ),
  '/settings/providers': lazy(() =>
    import('@/routes/settings').then((m) => ({ default: m.SettingsProvidersPage })),
  ),
  '/settings/brain': lazy(() =>
    import('@/routes/settings').then((m) => ({ default: m.SettingsBrainPage })),
  ),
  '/settings/logs': lazy(() =>
    import('@/routes/settings').then((m) => ({ default: m.SettingsLogsPage })),
  ),
  '/pool': lazy(() =>
    import('@/routes/pool').then((m) => ({ default: m.PoolRoute })),
  ),
  '/vault': lazy(() =>
    import('@/routes/vault').then((m) => ({ default: m.VaultRoute })),
  ),
  '/workbench': lazy(() =>
    import('@/routes/workbench').then((m) => ({ default: m.WorkbenchRoute })),
  ),
  '/coding': lazy(() =>
    import('@/routes/coding').then((m) => ({ default: m.CodingRoute })),
  ),
};

export function resolveRouteComponent(
  path: string,
): LazyExoticComponent<ComponentType> | null {
  return ROUTE_TAB_COMPONENTS[path] ?? null;
}
