// DefaultWorkspace — the `/` route.
//
// bao 2026-06-01 full fix: the route content is now empty. The
// shell-level WorkspaceShell (rendered in app.tsx's Tab column) is the
// single mount of the workspace surface — rendering another instance
// here would double-mount and race over the same Zustand state.
// `/` now serves only as a URL anchor; the visible shell is rendered
// by `RootShellInner` regardless of route.

import type { ReactElement } from 'react';

export const DefaultWorkspace = (): ReactElement => <></>;
