// DefaultWorkspace — Irisy's home page, rendered through the generic
// <SessionWorkspace> template (T5 session-type).
//
// The template owns the history sidebar + new-button layout; this file
// only supplies Irisy's centered greeting + chat input as the active
// session UI. Any future chat-style keycap (Translate-with-history,
// Email draft, ChatX-keycap) drops into the same template — that's how
// the frontend scales across many keycaps without per-page chrome.

import { useEffect, useState, type ReactElement } from 'react';
import { IrisyMascot } from '@/components/IrisyMascot';
import { useRail } from '@/components/RightRail';
import {
  SessionWorkspace,
  type SessionHistoryGroup,
} from '@/components/workspace/SessionWorkspace';
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

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!input.trim()) return;
    // Phase 1D wires this to the LLM transport.
    setInput('');
  };

  const handleNewChat = (): void => {
    setActiveId(null);
    setInput('');
  };

  return (
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

        <form className={styles.input} onSubmit={handleSubmit}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Irisy, or type / for a keycap…"
            aria-label="Chat with Irisy"
            autoFocus
          />
          <span className={styles.inputHint}>↵</span>
        </form>
      </div>
    </SessionWorkspace>
  );
};
