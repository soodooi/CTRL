// DefaultWorkspace — the `/` route.
//
// Layout: chat-stream area + InstallKeycapTile slot + sticky ChatInput.
// Mascot lives in the right-rail Irisy header; cockpit carries no
// hero-portrait.
//
// 2026-05-27 fix (bao "full quick fix"): ChatInput + "New chat" used to
// be stubs (Phase 1D never landed). Now: Enter hands off to /irisy
// via `?text=` URL param so all transport / persistence /
// brain-routing lives in IrisyChat.tsx. "New chat" navigates to
// /irisy?fresh=1. History reads localStorage (storage + focus events).

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

  const handleInstall = (_payload: InstallKeycapTilePayload): void => {
    void navigate({ to: '/pool' });
  };

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
    <div className={styles.cockpit}>
      <div className={styles.stage} aria-hidden="true" />
      <div className={styles.bottomDock}>
        <InstallKeycapTile onActivate={handleInstall} />
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
