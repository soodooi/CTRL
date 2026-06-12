// /notes — L1 Notes app entry.
//
// Notes = your local markdown folder (~/Documents/CTRL/Notes/, including the
// ctrl/ project brain). The IN-HOUSE NotesApp is the default viewer — no
// dependency on kairo (bao 2026-06-12 converged architecture: Notes is the
// DATA; the viewer is built-in and always works; kairo is just one optional
// viewer). kairo (SilverBullet) re-attaches later as an optional notes
// feature pack once the three engines are packaged (ADR-002 §1) — no hardcoded
// agent embed, no blank-iframe failure mode in between.

import type { ReactElement } from 'react';
import { NotesApp } from '@/components/notes/NotesApp';

export const NotesRoute = (): ReactElement => {
  return <NotesApp />;
};
