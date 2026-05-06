// Workspace window root — the result/chat viewer chiclet to the right of
// the keyboard. Subscribes to `workspace:state` from the keyboard window;
// emits `workspace:close` / `workspace:retry` / `workspace:copy` back.

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChatWorkspace } from './components/ChatWorkspace';
import {
  EV_WORKSPACE_CLOSE,
  EV_WORKSPACE_COPY,
  EV_WORKSPACE_RETRY,
  EV_WORKSPACE_STATE,
  emitToKeyboard,
  listenTyped,
  type WorkspaceCopyPayload,
  type WorkspaceResultPayload,
  type WorkspaceStatePayload,
} from './lib/window-events';

export function WorkspaceApp(): JSX.Element | null {
  const [result, setResult] = useState<WorkspaceResultPayload | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    const unlistenPromise = listenTyped<WorkspaceStatePayload>(EV_WORKSPACE_STATE, (payload) => {
      setResult(payload.result);
      setCanRetry(payload.canRetry);
    });
    return () => {
      void unlistenPromise.then((u) => u());
    };
  }, []);

  // Esc closes the workspace.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      void emitToKeyboard(EV_WORKSPACE_CLOSE);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Hide-all-panels when focus leaves the whole app (sibling-window aware).
  useEffect(() => {
    let pending = 0;
    function onBlur(): void {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        void invoke('hide_if_unfocused').catch(() => undefined);
      }, 80);
    }
    function onFocus(): void {
      window.clearTimeout(pending);
    }
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(pending);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (!result) {
    // Nothing to show. Window stays mounted (Rust hides it via NSWindow.hide())
    // but render null so DOM is empty if it ever flashes visible.
    return null;
  }

  function handleClose(): void {
    void emitToKeyboard(EV_WORKSPACE_CLOSE);
  }

  function handleRetry(): void {
    void emitToKeyboard(EV_WORKSPACE_RETRY);
  }

  async function handleCopy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // best-effort
    }
    const payload: WorkspaceCopyPayload = { text };
    void emitToKeyboard(EV_WORKSPACE_COPY, payload);
  }

  if (result.isChat && result.kind === 'success') {
    return (
      <section
        className="panel panel-workspace workspace-success window-fill"
        data-stagger="2"
      >
        <ChatWorkspace
          toolName={result.toolName ?? 'AI'}
          initialReply={result.text}
          contextHint={`原始任务 · ${result.toolName ?? ''}`}
          onClose={handleClose}
          onCopyReply={handleCopy}
          onHoverChange={() => undefined}
        />
      </section>
    );
  }

  const mark = result.kind === 'error' ? '✗' : result.kind === 'notify' ? '·' : '✓';
  return (
    <section
      className={`panel panel-workspace workspace-${result.kind} window-fill`}
      data-stagger="2"
    >
      <header className="panel-header" data-tauri-drag-region>
        <span className="panel-title-group">
          <span className={`workspace-mark workspace-mark-${result.kind}`} aria-hidden>{mark}</span>
          <span className="panel-title">{result.toolName ?? '输出'}</span>
        </span>
        <button
          type="button"
          className="panel-close"
          aria-label="关闭 (Esc)"
          title="Esc 关闭"
          onClick={handleClose}
        >
          ✕
        </button>
      </header>
      <div className="workspace-body">{result.text}</div>
      {(result.kind === 'error' || result.kind === 'success') && (
        <footer className="workspace-actions">
          {result.kind === 'error' && result.retryable && canRetry && (
            <button type="button" className="action-btn primary" onClick={handleRetry}>
              ↻ 重试
            </button>
          )}
          {result.kind === 'success' && (
            <button
              type="button"
              className="action-btn"
              onClick={() => void handleCopy(result.text)}
            >
              复制
            </button>
          )}
          <button type="button" className="action-btn ghost" onClick={handleClose}>
            关闭 <kbd className="action-kbd mono">Esc</kbd>
          </button>
        </footer>
      )}
    </section>
  );
}

