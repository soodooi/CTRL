// DefaultWorkspace — the `/` route. Per decision_ctrl_is_hermes_workbench
// CTRL is a workshop: persistent multi-tab workspace + Irisy as side
// drawer. When there are NO open tabs, fall back to the Irisy-idle
// page (a friendly chat input — what the user sees the first time).
// When tabs exist (e.g. user clicked Settings → hermes dashboard), the
// tab strip + active tab content take over.

import { useEffect, useState, type ReactElement } from 'react';
import { ChatInput, IrisyMascot } from '@/components/primitives';
import { useRail } from '@/components/RightRail';
import {
  SessionWorkspace,
  type SessionHistoryGroup,
} from '@/components/workspace/SessionWorkspace';
import { WorkspaceTabs } from '@/components/workspace/WorkspaceTabs';
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
  const [input, setInput] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setIrisyState('idle');
    return () => setIrisyState('idle');
  }, [setIrisyState]);

  const handleSend = (_text: string): void => {
    // Phase 1D wires this to the LLM transport.
    setInput('');
  };

  const handleNewChat = (): void => {
    setActiveId(null);
    setInput('');
  };

  const fallback = (
    <SessionWorkspace
      groups={PLACEHOLDER_HISTORY}
      activeId={activeId}
      onSelect={setActiveId}
      onNew={handleNewChat}
      newLabel="New chat"
      emptyText="no past chats"
    >
      <div className={styles.center}>
        <div className={styles.mascotWrap}>
          <div className={styles.mascotHalo} />
          <IrisyMascot state="idle" size={180} />
        </div>

        <h1 className={styles.greeting}>What are we doing today?</h1>

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
    </SessionWorkspace>
  );

  return <WorkspaceTabs fallback={fallback} />;
};
