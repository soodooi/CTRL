// Coding — ADR-002 substrate § brain v16 (2026-06-07).
//
// L1 Coding tab — 2-column split:
//   left  ~40% = `<CodingArtifactPane />` (files Pi has Write/Edit'd,
//                 fetched via `pi_rpc('getMessages')` after each chat
//                 done event)
//   right ~60% = `<IrisyChat forceMode="coding" />` (Pi default
//                 coding-agent persona — Irisy persona extension
//                 short-circuits on the `coding-` session name prefix
//                 set by `PiBridge.ensureModeSession`)
//
// v15 shipped the Pi-native routing (forceMode + mode wire + per-mode
// session + persona dual-skip) but kept the chat as a single pane,
// which left code dumped inline in the chat bubble. v16 splits the UX
// so the chat stays focused on dialog while file output lands in a
// dedicated viewer (bao 2026-06-07 ask: split layout for Coding).

import type { ReactElement } from 'react';
import { IrisyChat } from '@/components/irisy/IrisyChat';
import { CodingArtifactPane } from '@/components/coding/CodingArtifactPane';

export const CodingRoute = (): ReactElement => {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'row',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: '0 0 40%',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <CodingArtifactPane />
      </div>
      <div
        style={{
          flex: '1 1 auto',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <IrisyChat forceMode="coding" />
      </div>
    </div>
  );
};
