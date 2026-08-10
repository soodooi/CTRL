// DefaultWorkspace — the `/` route.
//
// Deliberately empty. `/` is a URL anchor only: the visible shell is rendered by
// `RootShellInner` regardless of route, so rendering anything here would
// double-mount the surface and race over the same Zustand state.
//
// The former multi-instance workspace shell this comment used to name was
// retired with the Ambient shell (ADR-003 frontend §8.5 v40) and its files are
// gone; do not reintroduce a second mount here.
import type { ReactElement } from 'react';
export const DefaultWorkspace = (): ReactElement => <></>;
