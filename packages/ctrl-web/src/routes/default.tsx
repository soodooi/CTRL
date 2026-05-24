// DefaultWorkspace — the `/` route. Per decision_ctrl_is_hermes_workbench
// CTRL is a workshop: persistent multi-tab workspace + Irisy as side
// drawer. When there are NO open tabs, fall back to the Irisy-idle page
// (a friendly chat input — what the user sees the first time).
//
// Per bao 2026-05-23: the session history list that used to live as a
// middle nav column now lives in the right rail as a collapsible level-2
// sub-panel. We push it via useRailSubPanel — the rail clears it on
// route unmount automatically.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { ChatInput, IrisyMascot } from '@/components/primitives';
import { useRail, useRailSubPanel, type RailSubPanel } from '@/components/RightRail';
import type { SessionHistoryGroup } from '@/components/workspace/SessionWorkspace';
import { WorkspaceTabs } from '@/components/workspace/WorkspaceTabs';
import { defaultTransport } from '@/lib/llm-transport';
import styles from './default.module.css';

interface TranscriptTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

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
  const [transcript, setTranscript] = useState<readonly TranscriptTurn[]>([]);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    setIrisyState('idle');
    return () => setIrisyState('idle');
  }, [setIrisyState]);

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
  useRailSubPanel(subPanel);

  const handleSend = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setInput('');
    const userTurn: TranscriptTurn = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    };
    const assistantTurn: TranscriptTurn = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
    };
    setTranscript((prev) => [...prev, userTurn, assistantTurn]);
    setStreaming(true);
    setIrisyState('thinking');
    void (async () => {
      const transport = defaultTransport();
      let accumulated = '';
      let errored = false;
      try {
        for await (const chunk of transport.stream(
          [{ role: 'user', content: trimmed }],
          { temperature: 0.7 },
        )) {
          if (chunk.error) {
            errored = true;
            accumulated += `\n\n[error: ${chunk.error}]`;
            break;
          }
          if (chunk.delta) {
            accumulated += chunk.delta;
            setTranscript((prev) =>
              prev.map((t) =>
                t.id === assistantTurn.id ? { ...t, content: accumulated } : t,
              ),
            );
          }
          if (chunk.done) break;
        }
      } catch (e) {
        errored = true;
        const msg = e instanceof Error ? e.message : String(e);
        setTranscript((prev) =>
          prev.map((t) =>
            t.id === assistantTurn.id
              ? { ...t, content: `${accumulated}\n\n[transport error: ${msg}]` }
              : t,
          ),
        );
      } finally {
        setStreaming(false);
        setIrisyState(errored ? 'idle' : 'idle');
      }
    })();
  };

  const fallback = (
    <div className={styles.center}>
      {transcript.length === 0 ? (
        <>
          <div className={styles.mascotWrap}>
            <div className={styles.mascotHalo} />
            <IrisyMascot state="idle" size={180} />
          </div>
          <h1 className={styles.greeting}>What are we doing today?</h1>
        </>
      ) : (
        <div className={styles.transcript} aria-label="Conversation">
          {transcript.map((turn) => (
            <div
              key={turn.id}
              className={styles.turn}
              data-role={turn.role}
            >
              <span className={styles.turnRole}>
                {turn.role === 'user' ? 'You' : 'Irisy'}
              </span>
              <p className={styles.turnContent}>
                {turn.content || (streaming && turn.role === 'assistant'
                  ? '…'
                  : '')}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className={styles.inputWrap}>
        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          placeholder={
            streaming
              ? 'Irisy is replying…'
              : 'Ask Irisy, or type / for a keycap…'
          }
          ariaLabel="Chat with Irisy"
          autoFocus
          disabled={streaming}
        />
      </div>
    </div>
  );

  return <WorkspaceTabs fallback={fallback} />;
};
