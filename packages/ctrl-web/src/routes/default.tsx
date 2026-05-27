// DefaultWorkspace — the `/` route. Per bao 2026-05-25 (Pi sole brain /
// CTRL = AI workshop): no chat-shell hero. The empty state is a quiet
// cockpit floor with the chat input pinned at the bottom and a single
// install-keycap slot sitting just above it.
//
// Layout (bao 2026-05-26):
//   ┌─────────────────────────────────┐
//   │                                 │
//   │  (chat messages stream here     │
//   │   once Phase 1D wires the LLM)  │
//   │                                 │
//   │            ┌─────┐              │  ← InstallKeycapTile (slot)
//   │            │  +  │  Install     │
//   │            └─────┘              │
//   │  ┌───────────────────────────┐  │  ← ChatInput (sticky)
//   │  │ Ask Irisy…                │  │
//   │  └───────────────────────────┘  │
//   └─────────────────────────────────┘
//
// Mascot moved to the right rail's Irisy header slot — the cockpit no
// longer carries a hero-portrait, the rail does.
//
// History list remains pushed into the rail level-2 panel via
// useIrisySubPanel — clears automatically on route unmount.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  ChatInput,
  InstallKeycapTile,
  type InstallKeycapTilePayload,
} from '@/components/primitives';
import { useRail, useIrisySubPanel, type RailSubPanel } from '@/components/RightRail';
import type { SessionHistoryGroup } from '@/components/workspace/SessionWorkspace';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import styles from './default.module.css';

// Placeholder history — Phase 1D swaps this for a real persisted query.
const PLACEHOLDER_HISTORY: ReadonlyArray<SessionHistoryGroup> = [
  {
    label: 'Today',
    items: [{ id: 'today-1', title: 'What can you do?' }],
  },
  {
    label: 'This week',
    items: [
      { id: 'wk-1', title: 'Install Notion keycap' },
      { id: 'wk-2', title: 'Browse the pool' },
    ],
  },
  {
    label: 'May',
    items: [
      { id: 'may-1', title: 'First session' },
      { id: 'may-2', title: 'Translate workflow' },
    ],
  },
];

export const DefaultWorkspace = (): ReactElement => {
  const { setIrisyState } = useRail();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setIrisyState('idle');
    return () => setIrisyState('idle');
  }, [setIrisyState]);

  // All three install paths funnel through one handler — click navigates
  // to /pool, dropped keycap ids / URIs / files also navigate to /pool
  // (Phase 1D will pass the payload as a router search param so Pool
  // can pre-open its install drawer). Single source of truth keeps the
  // tile presentational. */
  const handleInstall = (_payload: InstallKeycapTilePayload): void => {
    void navigate({ to: '/pool' });
  };

  const subPanel = useMemo<RailSubPanel>(
    () => ({
      groups: PLACEHOLDER_HISTORY,
      activeId,
      onSelect: setActiveId,
      onNew: () => {
        setActiveId(null);
        setInput('');
      },
      newLabel: 'New chat',
      emptyText: 'no past chats',
    }),
    [activeId],
  );
  useIrisySubPanel(subPanel);

  const handleSend = (_text: string): void => {
    // Phase 1D wires this to the LLM transport.
    setInput('');
  };

  const fallback = (
    <div className={styles.cockpit}>
      <div className={styles.stage} aria-hidden="true" />
      <div className={styles.bottomDock}>
        <InstallKeycapTile onActivate={handleInstall} size={72} />
        <div className={styles.inputWrap}>
          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            placeholder="Ask Irisy, or type / for a keycap…"
            ariaLabel="Chat with Irisy"
            autoFocus
          />
        </div>
      </div>
    </div>
  );

  return <WorkspaceShell fallback={fallback} />;
};
