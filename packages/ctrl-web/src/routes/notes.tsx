// /notes — L1 Notes app entry. Renders the shared NotesSurface (desktop =
// the vendored Tolaria UI in its own window; browser PWA = in-house viewer).
// ADR-002 section 1.9 v47.

import type { ReactElement } from 'react';
import { NotesSurface } from '@/components/notes/NotesSurface';

export const NotesRoute = (): ReactElement => {
  return <NotesSurface />;
};
