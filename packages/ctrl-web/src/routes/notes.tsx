// /notes — L1 Notes app entry.
//
// (ADR-002 substrate § vault v1 §8.6 v4, 2026-06-02 — bao 2026-06-02
// realignment: Vault is substrate, Notes is the L1 app.)
//
// The L1 Notes chip in PrimaryRail opens a workspace `route` tab
// pointing here; the route-tab-components map resolves `/notes` to
// `<NotesRoute />` lazily, and this file renders the composition
// root.

import type { ReactElement } from 'react';
import { NotesApp } from '@/components/notes/NotesApp';

export const NotesRoute = (): ReactElement => <NotesApp />;
