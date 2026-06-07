// IrisyCustomMessage — dispatch + 5 renderers for Pi `role=custom`
// messages emitted by ctrl-pi-bridge slash command handlers (ADR-009 P3
// / P5). The chat UI inserts one of these inline alongside text bubbles
// so user slash intents (open Discover, write to vault, switch mode...)
// produce visible feedback even when no LLM turn ran.
//
// Each renderer is intentionally tiny — these are status chips and
// banner affordances, not full UI surfaces. Heavier flows
// (cap browsing, vault editing) live in their own routes / workspace
// tabs; the chip is the handoff, not the destination.

import { useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { useWorkspaceStore } from '../../lib/workspace-store';
import { writeVault } from '../../lib/viewer-uri';
import type { IrisyCustomMessage } from '../../lib/llm-transport';

import styles from './IrisyCustomMessage.module.css';

interface Props {
  msg: IrisyCustomMessage;
  /** Parent-supplied dismiss handler that removes this custom message
   *  from the chat list. Optional so the dispatch site can pass it
   *  only for messages that have a "skip / dismiss" affordance. */
  onDismiss?: () => void;
}

// ── Dispatch ────────────────────────────────────────────────────────────

export function IrisyCustomMessageView({ msg, onDismiss }: Props): JSX.Element {
  switch (msg.customType) {
    case 'irisy-curator-nudge':
      return <CuratorNudge msg={msg} onDismiss={onDismiss} />;
    case 'irisy-vault-write-ack':
      return <VaultWriteAck msg={msg} />;
    case 'irisy-open-discover':
      return <OpenDiscover msg={msg} />;
    case 'irisy-open-vault-tab':
      return <OpenVaultTab msg={msg} />;
    case 'irisy-mode-switch':
      return <ModeSwitch msg={msg} />;
    default:
      // Forward-compatible: unknown customType from a newer bridge
      // shows the display summary instead of breaking the chat.
      return <UnknownCustom msg={msg} />;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function expandWorkspace(): void {
  void invoke<boolean>('ensure_workspace_window_expanded').catch(() => {
    // Browser PWA / unsupported platform — non-fatal.
  });
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

// One-shot effect guard — React StrictMode double-invokes effects in
// dev; an auto-nav that fires twice would push two workspace tabs and
// flicker the active selection. The ref pins the side-effect to a
// single execution per mounted component instance.
function useOnceOnMount(fn: () => void): void {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    fn();
    // fn is intentionally NOT in deps — captured at mount, not re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ── Renderers ───────────────────────────────────────────────────────────

interface CuratorNudgeContent {
  reason?: string;
  shutdownReason?: string;
  requestedAt?: string;
}

function CuratorNudge({ msg, onDismiss }: Props): JSX.Element {
  const content = (msg.content ?? {}) as CuratorNudgeContent;
  const summary =
    msg.display?.summary ??
    (content.reason === 'session_end'
      ? 'Session ending — consider distilling 1 lasting lesson.'
      : 'Worth distilling a lesson from this stretch?');

  const accept = (): void => {
    const today = new Date().toISOString().slice(0, 10);
    const stubPath = `irisy/playbook/${today}-lesson.md`;
    const body = [
      '# Lesson',
      '',
      '_(replace this stub with the lesson you want to keep)_',
      '',
      '## What happened',
      '- ',
      '',
      '## Why it matters',
      '- ',
      '',
      '## Next time',
      '- ',
    ].join('\n');
    void writeVault(stubPath, body, {
      kind: 'irisy-playbook',
      reason: content.reason ?? 'curator-accept',
      created_at: new Date().toISOString(),
    })
      .then(() => {
        useWorkspaceStore.getState().openSystemTab({
          id: `vault-${stubPath}`,
          kind: 'vault-md',
          vaultPath: stubPath,
          title: basename(stubPath),
        });
        expandWorkspace();
      })
      .catch(() => {
        /* vault not writable — keep the nudge interactive so user can retry */
      });
  };

  return (
    <div className={styles.banner}>
      <div className={styles.bannerText}>
        <span className={styles.bannerTitle}>Curator</span>
        <span className={styles.bannerSummary}>{summary}</span>
      </div>
      <div className={styles.bannerActions}>
        <button type="button" className={styles.primaryBtn} onClick={accept}>
          Distill one
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => onDismiss?.()}
          disabled={!onDismiss}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

interface VaultWriteAckContent {
  path?: string;
}

function VaultWriteAck({ msg }: Props): JSX.Element {
  const content = (msg.content ?? {}) as VaultWriteAckContent;
  const path = content.path ?? msg.display?.summary ?? '';
  const title = path ? basename(path) : 'Saved';

  const openTab = (): void => {
    if (!path) return;
    useWorkspaceStore.getState().openSystemTab({
      id: `vault-${path}`,
      kind: 'vault-md',
      vaultPath: path,
      title,
    });
    expandWorkspace();
  };

  return (
    <button type="button" className={styles.chip} onClick={openTab} disabled={!path}>
      <span className={styles.chipIcon} aria-hidden>
        ✓
      </span>
      <span className={styles.chipLabel}>Saved</span>
      <span className={styles.chipPath}>{path || 'no path'}</span>
    </button>
  );
}

interface OpenDiscoverContent {
  query?: string;
}

function OpenDiscover({ msg }: Props): JSX.Element {
  const content = (msg.content ?? {}) as OpenDiscoverContent;
  const query = content.query?.trim() ?? '';

  // ADR-009 P3: a `/discover <query>` slash auto-opens the Mcp pool
  // tab (CTRL's current "browse caps" surface — bao 2026-06-03 lockdown
  // §1 unifies pool + discover under the same workspace surface).
  useOnceOnMount(() => {
    useWorkspaceStore.getState().openSystemTab({
      id: 'pool',
      kind: 'route',
      path: '/pool',
      title: 'Mcp pool',
    });
    expandWorkspace();
  });

  return (
    <div className={styles.chip}>
      <span className={styles.chipIcon} aria-hidden>
        ◎
      </span>
      <span className={styles.chipLabel}>Discover</span>
      <span className={styles.chipPath}>{query || 'browsing all caps'}</span>
    </div>
  );
}

interface OpenVaultTabContent {
  path?: string;
}

function OpenVaultTab({ msg }: Props): JSX.Element {
  const content = (msg.content ?? {}) as OpenVaultTabContent;
  const path = content.path ?? '';
  const title = path ? basename(path) : 'Vault';

  useOnceOnMount(() => {
    if (!path) return;
    useWorkspaceStore.getState().openSystemTab({
      id: `vault-${path}`,
      kind: 'vault-md',
      vaultPath: path,
      title,
    });
    expandWorkspace();
  });

  return (
    <div className={styles.chip}>
      <span className={styles.chipIcon} aria-hidden>
        ✎
      </span>
      <span className={styles.chipLabel}>Opened</span>
      <span className={styles.chipPath}>{path || 'vault'}</span>
    </div>
  );
}

interface ModeSwitchContent {
  mode?: string;
}

function ModeSwitch({ msg }: Props): JSX.Element {
  const content = (msg.content ?? {}) as ModeSwitchContent;
  const mode = content.mode?.trim() ?? 'personal';
  const label = useMemo(() => {
    switch (mode) {
      case 'coding':
        return 'Coding mode — file tools enabled';
      case 'cap':
        return 'Cap mode';
      case 'personal':
        return 'Personal mode';
      default:
        return `Mode: ${mode}`;
    }
  }, [mode]);

  return (
    <div className={styles.pill}>
      <span className={styles.pillDot} aria-hidden />
      <span className={styles.pillLabel}>{label}</span>
    </div>
  );
}

function UnknownCustom({ msg }: Props): JSX.Element {
  const summary = msg.display?.summary ?? msg.display?.title ?? msg.customType;
  return (
    <div className={styles.chip}>
      <span className={styles.chipIcon} aria-hidden>
        •
      </span>
      <span className={styles.chipLabel}>{msg.customType}</span>
      <span className={styles.chipPath}>{summary}</span>
    </div>
  );
}
