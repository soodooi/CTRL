// DefaultWorkspace — the `/` route.
//
// Per bao 2026-05-27 "全量快速修复": the homepage ChatInput and the
// "New chat" rail action used to be stubs (commit history said
// "Phase 1D wires this to the LLM transport" — Phase 1D never landed).
// Pressing Enter silently cleared the box; clicking New chat did the
// same. Wires now reuse the `/irisy` chat surface via a `?text=` /
// `?fresh=1` URL param hand-off so all transport / persistence /
// brain-routing logic lives in one place (IrisyChat.tsx).

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ChatInput, IrisyMascot } from '@/components/primitives';
import { useRail, useIrisySubPanel, type RailSubPanel } from '@/components/RightRail';
import type { SessionHistoryGroup } from '@/components/workspace/SessionWorkspace';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import styles from './default.module.css';

const CHAT_STORAGE_KEY = 'irisy:chat:v1';

interface StoredMessage {
  id?: string;
  role?: string;
  content?: string;
}

function readCurrentChatTitle(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const firstUser = (parsed as StoredMessage[]).find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 0,
    );
    if (!firstUser?.content) return null;
    const snippet = firstUser.content.trim().slice(0, 60);
    return snippet.length < firstUser.content.trim().length ? `${snippet}…` : snippet;
  } catch {
    return null;
  }
}

function clearStoredChat(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    // Quota / privacy mode — caller still navigates; IrisyChat will
    // pick up whatever it can on mount.
  }
}

function encodeText(text: string): string {
  return encodeURIComponent(text);
}

export const DefaultWorkspace = (): ReactElement => {
  const { setIrisyState } = useRail();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  // Bumping this re-reads the localStorage-backed history snapshot so
  // the rail picks up updates from the /irisy surface without a page
  // reload. Storage events fire cross-tab; we also listen on focus.
  const [historyTick, setHistoryTick] = useState(0);

  useEffect(() => {
    setIrisyState('idle');
    return () => setIrisyState('idle');
  }, [setIrisyState]);

  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === CHAT_STORAGE_KEY) setHistoryTick((t) => t + 1);
    };
    const onFocus = (): void => setHistoryTick((t) => t + 1);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const historyGroups = useMemo<ReadonlyArray<SessionHistoryGroup>>(() => {
    // historyTick is a re-read trigger; intentionally not used inside
    // the body. eslint-disable-next-line treats it as a no-op dep.
    void historyTick;
    const title = readCurrentChatTitle();
    if (!title) return [];
    return [
      {
        label: 'Current',
        items: [{ id: 'current', title }],
      },
    ];
  }, [historyTick]);

  const subPanel = useMemo<RailSubPanel>(
    () => ({
      groups: historyGroups,
      activeId: historyGroups.length > 0 ? 'current' : null,
      onSelect: () => {
        void navigate({ to: '/irisy' });
      },
      onNew: () => {
        clearStoredChat();
        setHistoryTick((t) => t + 1);
        setInput('');
        void navigate({ to: '/irisy', search: { fresh: 1 } as never });
      },
      newLabel: 'New chat',
      emptyText: 'no past chats',
    }),
    [historyGroups, navigate],
  );
  useIrisySubPanel(subPanel);

  const handleSend = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput('');
    // Hand off to /irisy — IrisyChat reads ?text= on mount, fills the
    // composer, and fires sendMessage once.
    window.location.assign(`/irisy?text=${encodeText(trimmed)}`);
  };

  const fallback = (
    <div className={styles.center}>
      <div className={styles.mascotWrap}>
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
  );

  return <WorkspaceShell fallback={fallback} />;
};
