// /notes — L1 Notes app entry.
//
// ADR-002 substrate §1 v20 (2026-06-10): the notes editor is owned by
// kairo (SilverBullet, MIT — single binary serving a web UI over the
// plain ~/Documents/CTRL/Notes/ markdown folder). When the agent is
// installed + launched we embed its UI; while it is installing or when
// it fails, the in-house NotesApp keeps working on the same folder —
// local truth, graceful degradation (CLAUDE.md derived rule #1).

import type { ReactElement } from 'react';
import { NotesApp } from '@/components/notes/NotesApp';
import { useAgent } from '@/lib/use-agent';

export const NotesRoute = (): ReactElement => {
  const agent = useAgent('kairo');

  if (agent.status === 'ready' && agent.endpoint?.kind === 'webview') {
    return (
      <iframe
        src={agent.endpoint.url}
        title="Notes (kairo)"
        style={{ width: '100%', height: '100%', border: 'none' }}
      />
    );
  }
  // Installing / launching / error — the in-house viewer stays usable on
  // the same markdown folder; no hard dependency on the agent.
  return <NotesApp />;
};
