// Coding — ADR-002 substrate § brain v15 (2026-06-07).
//
// Pi-native coding tab. Shares the same Pi RPC process as the Irisy
// homepage chat (port 17874) but pins `forceMode="coding"` so the
// IrisyChat component:
//   1. Sends `mode:"coding"` to the kernel `irisy_chat_stream` command,
//      which forwards it through the MCP `text.chat` tool arguments.
//   2. PiBridge.ensureModeSession routes the prompt to a named session
//      `coding-default` (created on first use, reused across PWA reloads
//      via listSessions lookup so the on-disk history stays in one file).
//   3. Both persona extensions (CTRL-bundled `packages/ctrl-pi-bridge` +
//      external `irisy-persona`) read `ctx.sessionManager.getSessionName()`
//      and short-circuit on the `coding-` prefix, leaving Pi with its
//      default coding-agent system prompt + 7 builtin tools
//      (Read / Write / Edit / Bash / Grep / Find / LS) untouched.
//   4. Chat history persists under its own `irisy:chat:v1:coding`
//      localStorage key so the two tabs never bleed into each other.
//
// v11 (cs_spawn pi TUI inside xterm) + v13 (slim cs_spawn) + v14 (clean
// placeholder) baselined the rebuild. This is the Pi-native ship.

import type { ReactElement } from 'react';
import { IrisyChat } from '@/components/irisy/IrisyChat';

export const CodingRoute = (): ReactElement => {
  return <IrisyChat forceMode="coding" />;
};
