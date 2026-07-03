// NotesSurface — the ONE notes entry point (ADR-002 section 1.9 v47,
// bao 2026-07-02 "the frontend uses tolaria" + "放在 ctrl 显示"): on desktop
// every notes entry (L1 scene, /notes route) renders the vendored Tolaria UI
// EMBEDDED in the CTRL workspace (iframe + IPC bridge — see NotesEmbed); the
// in-house NotesApp remains only as the browser-PWA fallback.

import type { ReactElement } from 'react';
import { NotesApp } from '@/components/notes/NotesApp';
import { NotesEmbed } from '@/components/notes/NotesEmbed';
import { platform } from '@/lib/bridge';

export const NotesSurface = (): ReactElement => {
  if (platform() === 'web') {
    return <NotesApp />;
  }
  return <NotesEmbed />;
};
