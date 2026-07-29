// Coding — opencode driven over ACP, rendered inline alongside the
// always-resident Irisy column (same [work area | Irisy] shape every other
// CTRL module uses — Notes, Tables, Coding all render LEFT of Irisy, which
// this scene never touches).
//
// CTRL spawns the user's own `opencode acp` process (verified: it speaks
// real Agent Client Protocol — initialize -> session/new -> session/prompt,
// streaming agent_thought_chunk / agent_message_chunk / tool_call /
// tool_call_update) via the SAME AcpClient machinery already driving Irisy's
// engine, in a separate singleton rooted at the selected workspace. CTRL
// renders the structured events with native React (no PTY, no terminal
// emulation) — this is what replaced two failed embedded-xterm attempts and
// the external-terminal launcher's visual overlap with CTRL's own panel.
// Opening a separate OS terminal/editor remains available as a secondary,
// collapsed action (v27's original launcher path).
// (ADR-001 spine §4 v16; ADR-003 frontend §8.5 v32; ADR-005 irisy §8.7 v30)

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { invoke, pickCodingAttachments, platform } from '@/lib/bridge';
import { isImeComposing } from '@/lib/ime';
import {
  codingLauncherStatus,
  launchCodingWorkspace,
  selectTerminalId,
  selectWorkspaceId,
  type CodingLaunchMode,
  type CodingLauncherStatus,
} from '@/lib/coding-launcher';
import { streamCodingChat, resetCodingEngine, type CodingToolStep, type CodingAttachment } from '@/lib/coding-chat';
import { useCodingFileDrop } from '@/lib/coding-drop';
import { loadCodingSessions, saveCodingSessions, type CodingMessage, type CodingToolStepView } from '@/lib/coding-sessions';
import { vaultWrite } from '@/lib/kernel';
import styles from './CodingScene.module.css';

// Drag-and-drop file attachments (ADR-002 substrate §1.8.6 v75; ADR-003
// frontend §8.5 v35) — a dropped file becomes authoring reference material
// for opencode (a competitor screenshot, an API doc), read server-side and
// resolved into an ACP ContentBlock only if the connected engine negotiated
// support for it; unsupported degrades to a text notice, never a silent
// drop. This is NOT a data-import path for an installed feature pack —
// that is Irisy's own, separately-scoped, unbuilt semantic.

// The CTRL launcher window is an always-on-top, all-Spaces NSPanel (ADR-003
// §1.1) so a Ctrl tap can summon it over anything, including another app's
// full-screen Space. That means it keeps floating over an external
// Terminal/iTerm/editor window the secondary "Open externally" actions just
// opened, visually overlapping it. Hide CTRL right after one of those
// succeeds — same `hide_window` command the StatusBar (×) button and Ambient
// launcher already use. Never called for the primary opencode-over-ACP path
// (nothing external opens there — CTRL should stay visible).
const hideCtrlWindow = (): void => {
  if (platform() !== 'tauri') return;
  void invoke<void>('hide_window').catch(() => {
    // Best-effort: if this fails, CTRL simply stays visible.
  });
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function applyToolStep(prev: CodingToolStepView[] | undefined, step: CodingToolStep): CodingToolStepView[] {
  const list = prev ? [...prev] : [];
  const i = list.findIndex((s) => s.tool_call_id === step.tool_call_id);
  if (step.phase === 'call') {
    const view: CodingToolStepView = { id: step.tool_call_id, ...step };
    if (i >= 0) list[i] = { ...list[i], ...view };
    else list.push(view);
    return list;
  }
  if (i >= 0) {
    const cur = list[i]!;
    list[i] = { ...cur, status: step.status, output: step.output };
  } else {
    list.push({ id: step.tool_call_id, ...step });
  }
  return list;
}

function prettyToolTitle(t: string): string {
  return t.replace(/^mcp_ctrl_/, '').replace(/^mcp_/, '').replace(/_/g, ' ').trim();
}

const PACK_INTENT = /(?:feature\s*pack|capability\s*pack|mcp\s*pack|[\u529f\u80fd\u80fd\u529b\u5de5\u4f5c]\s*[\u5305])/i;

function packResearchSlug(intent: string): string {
  const slug = intent
    .replace(PACK_INTENT, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return slug || 'new-feature-pack';
}

async function savePackResearchNote(intent: string, paths: string[]): Promise<string> {
  const path = `Research/feature-packs/${packResearchSlug(intent)}.md`;
  const sources = paths.length > 0 ? paths.map((source) => `- ${source}`).join('\n') : '- No source path supplied';
  await vaultWrite({
    path,
    content: `# Feature pack research\n\n## Intent\n${intent}\n\n## User-provided sources\n${sources}\n\n## Authoring instruction\nRead every listed local source through CTRL before designing the pack. Use the governed create-feature-pack skill, then produce the corresponding manifest and evaluation plan.\n`,
    frontmatter: { title: `Feature pack research: ${packResearchSlug(intent)}`, tags: ['feature-pack', 'research'] },
  });
  return path;
}

interface Msg extends CodingMessage {
  tools?: CodingToolStepView[];
}

export function CodingScene(): ReactElement {
  const [status, setStatus] = useState<CodingLauncherStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('ctrl:coding-active-workspace:v1') ?? '';
  });
  const [terminalId, setTerminalId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Pending workspace switch while a live opencode session exists — switching
  // needs a fresh ACP process rooted at the new cwd, so this is a deliberate
  // confirm step rather than a silent kill-and-restart.
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  // Per-workspace conversation. Keyed by workspace path so switching back to
  // a workspace you already talked to restores that transcript instead of
  // losing it (each workspace's opencode session is independent).
  const [messagesByWorkspace, setMessagesByWorkspace] = useState<Record<string, Msg[]>>(() => loadCodingSessions());
  const [input, setInput] = useState('');
  const [referencePaths, setReferencePaths] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const chatAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveCodingSessions(messagesByWorkspace);
  }, [messagesByWorkspace]);

  useEffect(() => {
    if (typeof window === 'undefined' || !workspaceId) return;
    window.localStorage.setItem('ctrl:coding-active-workspace:v1', workspaceId);
  }, [workspaceId]);

  // Files dropped since the last send — authoring reference material for
  // opencode (a competitor screenshot, an API doc), not a data-import path
  // (ADR-002 substrate §1.8.6 v75; ADR-003 frontend §8.5 v35). Cleared once
  // sent; the backend reads each path itself, so this only tracks display
  // name + path, never file bytes.
  const [pendingAttachments, setPendingAttachments] = useState<CodingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const handleFileDrop = useCallback((paths: string[]): void => {
    setPendingAttachments((prev) => {
      const existing = new Set(prev.map((a) => a.path));
      const added = paths
        .filter((p) => !existing.has(p))
        .map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p }));
      return added.length > 0 ? [...prev, ...added] : prev;
    });
    setDragOver(false);
  }, []);
  const dropHandlers = useMemo(
    () => ({
      onDrop: handleFileDrop,
      onDragOver: () => setDragOver(true),
      onDragLeave: () => setDragOver(false),
    }),
    [handleFileDrop],
  );
  useCodingFileDrop(chatAreaRef, dropHandlers);

  const removeAttachment = useCallback((path: string): void => {
    setPendingAttachments((prev) => prev.filter((a) => a.path !== path));
  }, []);

  // Directories remain explicit paths because ACP attachments are regular
  // files only; OpenCode can inspect the selected directory with its own
  // filesystem tools. Files use the shared ACP attachment path below.
  // (ADR-002 substrate §1.8.6 v75; ADR-003 frontend §8.5 v37)
  const addDirectoryReferences = useCallback((paths: string[]): void => {
    const additions = paths.filter((path) => !referencePaths.includes(path));
    if (additions.length === 0) return;
    setReferencePaths((prev) => [...prev, ...additions]);
    setInput((prev) => [prev.trim(), ...additions].filter(Boolean).join(' '));
  }, [referencePaths]);

  const pickAttachments = useCallback(async (): Promise<void> => {
    try {
      const selection = await pickCodingAttachments();
      handleFileDrop(selection.files);
      addDirectoryReferences(selection.directories);
    } catch (error: unknown) {
      setFeedback({ kind: 'error', text: errorMessage(error) });
    }
  }, [addDirectoryReferences, handleFileDrop]);

  const refresh = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setRefreshing(true);
    setLoadError(null);
    try {
      const next = await codingLauncherStatus();
      if (requestId !== requestIdRef.current) return;
      setStatus(next);
      setWorkspaceId((current) => selectWorkspaceId(current, next.workspaces));
      setTerminalId((current) => selectTerminalId(current, next.terminals));
    } catch (error: unknown) {
      if (requestId === requestIdRef.current) setLoadError(errorMessage(error));
    } finally {
      if (requestId === requestIdRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

  const workspace = useMemo(
    () => status?.workspaces.find((candidate) => candidate.id === workspaceId) ?? status?.workspaces[0] ?? null,
    [status, workspaceId],
  );
  const terminal = useMemo(
    () => status?.terminals.find((candidate) => candidate.id === terminalId) ?? null,
    [status, terminalId],
  );
  const messages = (workspace && messagesByWorkspace[workspace.path]) ?? [];

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }));
  }, [messages, streaming]);

  const launch = async (target: string, mode: CodingLaunchMode): Promise<void> => {
    if (!workspace) return;
    const operation = `${mode}:${target}`;
    setBusy(operation);
    setFeedback(null);
    try {
      await launchCodingWorkspace({ target, workspace: workspace.path, mode });
      setFeedback({
        kind: 'success',
        text:
          mode === 'open_code'
            ? `OpenCode launched in ${workspace.label}.`
            : `Workspace opened (${workspace.label}).`,
      });
      hideCtrlWindow();
      await refresh();
    } catch (error: unknown) {
      setFeedback({ kind: 'error', text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const copyCommand = async (): Promise<void> => {
    if (!status?.launchCommand) return;
    try {
      await navigator.clipboard.writeText(status.launchCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setFeedback({
        kind: 'error',
        text: 'Clipboard access was denied. Select the command and copy it manually.',
      });
    }
  };

  const send = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if ((!trimmed && pendingAttachments.length === 0) || !workspace) return;
    abortRef.current?.abort();
    setInput('');
    const attachmentsForTurn = pendingAttachments;
    setPendingAttachments([]);
    const workspacePath = workspace.path;
    let prompt = trimmed;
    if (PACK_INTENT.test(trimmed)) {
      try {
        const researchPath = await savePackResearchNote(trimmed, referencePaths);
        prompt += `\n\nCTRL has prepared the durable research note at ${researchPath}. Read it and every listed source path before authoring the feature pack.`;
        setReferencePaths([]);
        setFeedback({ kind: 'success', text: `Saved pack research to ${researchPath}.` });
      } catch (error: unknown) {
        setFeedback({ kind: 'error', text: `Could not save pack research: ${errorMessage(error)}` });
      }
    }
    const attachmentSuffix = attachmentsForTurn.length > 0
      ? `\n\n[Attached: ${attachmentsForTurn.map((a) => a.name).join(', ')}]`
      : '';
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: `${prompt}${attachmentSuffix}` };
    const asstId = `a-${Date.now()}`;
    setMessagesByWorkspace((prev) => ({
      ...prev,
      [workspacePath]: [...(prev[workspacePath] ?? []), userMsg, { id: asstId, role: 'assistant', content: '' }],
    }));
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const update = (fn: (m: Msg) => Msg): void => {
      setMessagesByWorkspace((prev) => ({
        ...prev,
        [workspacePath]: (prev[workspacePath] ?? []).map((m) => (m.id === asstId ? fn(m) : m)),
      }));
    };

    try {
      const history = [...(messagesByWorkspace[workspacePath] ?? []), userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      for await (const chunk of streamCodingChat(workspacePath, history, ctrl.signal, attachmentsForTurn)) {
        if (chunk.error) {
          if (chunk.error === 'aborted') break;
          update((m) => ({ ...m, content: `Error: ${chunk.error}` }));
          break;
        }
        if (chunk.tool) {
          update((m) => ({ ...m, tools: applyToolStep(m.tools, chunk.tool!) }));
          continue;
        }
        if (chunk.thought) {
          update((m) => ({ ...m, reasoning: (m.reasoning ?? '') + chunk.thought }));
          continue;
        }
        if (chunk.delta) {
          update((m) => ({ ...m, content: m.content + chunk.delta }));
        }
      }
    } catch (err) {
      update((m) => ({ ...m, content: `Error: ${err instanceof Error ? err.message : String(err)}` }));
    } finally {
      if (abortRef.current === ctrl) {
        setStreaming(false);
        abortRef.current = null;
      }
    }
  }, [workspace, messagesByWorkspace, pendingAttachments, referencePaths]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  if (loadError && !status) {
    return (
      <div className={styles.root}>
        <div className={styles.content}>
          <p className={styles.eyebrow}>Coding</p>
          <h1 className={styles.title}>Coding module unavailable</h1>
          <p className={styles.error} role="alert">{loadError}</p>
          <button type="button" className={styles.secondary} onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!status || !workspace) {
    return (
      <div className={styles.root}>
        <div className={styles.content}>
          <p className={styles.notice} role="status" aria-live="polite">
            Inspecting the configured CTRL workspace…
          </p>
        </div>
      </div>
    );
  }

  const opencodeReady = status.opencodeAvailable;
  const hasSession = messages.length > 0;
  const pendingWorkspace = pendingWorkspaceId
    ? status.workspaces.find((candidate) => candidate.id === pendingWorkspaceId) ?? null
    : null;

  // Switching workspace while there is a live conversation needs a fresh ACP
  // process rooted at the new cwd — confirm before resetting rather than
  // silently dropping context.
  const requestWorkspaceChange = (nextId: string): void => {
    if (nextId === workspace.id) return;
    if (hasSession) {
      setPendingWorkspaceId(nextId);
      return;
    }
    setWorkspaceId(nextId);
  };
  const confirmWorkspaceChange = (): void => {
    if (pendingWorkspaceId) {
      void resetCodingEngine().catch(() => undefined);
      setWorkspaceId(pendingWorkspaceId);
    }
    setPendingWorkspaceId(null);
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <div className={styles.root} aria-label="Coding module">
      <div className={styles.sessionBar} role="tablist" aria-label="Coding sessions">
        <span className={styles.sessionHeading}>Coding</span>
        <div className={styles.sessionTabs}>
          {status.workspaces.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={candidate.id === workspace.id}
              className={`${styles.sessionTab} ${candidate.id === workspace.id ? styles.sessionTabActive : ''}`}
              onClick={() => requestWorkspaceChange(candidate.id)}
              title={candidate.path}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.toolbar}>
        <span className={styles.toolbarPath}>{workspace.path}</span>
        <span className={styles.toolbarSpacer} />
        <button type="button" className={styles.ghost} disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {pendingWorkspace && (
        <div className={styles.confirmBar} role="alert">
          <span>
            Switching to <strong>{pendingWorkspace.label}</strong> will end the running OpenCode
            session in {workspace.label}.
          </span>
          <div className={styles.confirmActions}>
            <button type="button" className={styles.secondary} onClick={() => setPendingWorkspaceId(null)}>
              Stay in {workspace.label}
            </button>
            <button type="button" className={styles.primary} onClick={confirmWorkspaceChange}>
              Switch anyway
            </button>
          </div>
        </div>
      )}

      {!opencodeReady && (
        <p className={styles.notice}>
          OpenCode was not found on PATH. Install it, then Refresh.
        </p>
      )}
      {loadError && <p className={styles.error} role="alert">Refresh failed: {loadError}</p>}
      {feedback?.kind === 'error' && <p className={styles.error} role="alert">{feedback.text}</p>}
      {feedback?.kind === 'success' && <p className={styles.success} role="status">{feedback.text}</p>}

      <div className={styles.chatArea} ref={chatAreaRef} data-drag-over={dragOver ? 'true' : undefined}>
        {dragOver && (
          <div className={styles.dropOverlay} aria-hidden>
            Drop to attach as reference material
          </div>
        )}
        <div className={styles.scroller} ref={scrollerRef}>
          {messages.length === 0 ? (
            <div className={styles.chatEmpty}>
              <span className={styles.chatEmptyIcon} aria-hidden>{'</>'}</span>
              <p>
                {opencodeReady
                  ? `Ask OpenCode to build, fix, or explain something in ${workspace.label}.`
                  : 'Install OpenCode to start coding here.'}
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`${styles.msg} ${styles[m.role]}`}>
                {m.role === 'assistant' ? (
                  <>
                    {m.reasoning && m.reasoning.trim() && (
                      <details className={styles.reasoning}>
                        <summary>
                          {m.id === lastAssistantId && streaming ? 'Thinking…' : 'Thought process'}
                        </summary>
                        <div className={styles.reasoningBody}>{m.reasoning.trim()}</div>
                      </details>
                    )}
                    {m.tools && m.tools.length > 0 && (
                      <div className={styles.toolSteps}>
                        {m.tools.map((s) => (
                          <details key={s.id} className={styles.toolStep} data-status={s.status ?? 'running'}>
                            <summary>
                              <span aria-hidden>
                                {s.status === undefined ? '◐' : s.status === 'failed' ? '✗' : '✓'}
                              </span>
                              <span className={styles.toolTitle}>{prettyToolTitle(s.title)}</span>
                            </summary>
                            {s.input && <pre className={styles.toolIo}>{s.input}</pre>}
                            {s.output && <pre className={styles.toolIo}>{s.output}</pre>}
                          </details>
                        ))}
                      </div>
                    )}
                    {m.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    ) : m.id === lastAssistantId && streaming ? (
                      <div className={styles.thinking} aria-label="OpenCode is working">
                        <span>OpenCode is thinking</span>
                      </div>
                    ) : null}
                  </>
                ) : (
                  m.content
                )}
              </div>
            ))
          )}
        </div>
        {pendingAttachments.length > 0 && (
          <div className={styles.attachmentChips} role="list" aria-label="Attached files">
            {pendingAttachments.map((a) => (
              <span key={a.path} className={styles.attachmentChip} role="listitem">
                <span className={styles.attachmentChipName}>{a.name}</span>
                <button
                  type="button"
                  className={styles.attachmentChipRemove}
                  onClick={() => removeAttachment(a.path)}
                  aria-label={`Remove ${a.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <form
          className={styles.composer}
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <button
            type="button"
            className={styles.addPathButton}
            aria-label="Add files or folders"
            title="Add files or folders"
            onClick={() => void pickAttachments()}
          >
            +
          </button>
          <textarea
            className={styles.composerInput}
            value={input}
            rows={1}
            placeholder={opencodeReady ? `Ask OpenCode in ${workspace.label}…` : 'Install OpenCode first…'}
            disabled={!opencodeReady}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // ADR-003 frontend §7.6 v33 — every Enter-handling input shares
              // this guard: an Enter that confirms a CJK IME candidate must
              // never fire submit (the composition underline in the field —
              // e.g. pinyin mid-composition — means the keystroke belongs to
              // the IME, not to this form).
              if (isImeComposing(e)) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          {streaming ? (
            <button type="button" className={styles.composerSend} onClick={stopGeneration} aria-label="Stop">
              ■
            </button>
          ) : (
            <button
              type="submit"
              className={styles.composerSend}
              disabled={(!input.trim() && pendingAttachments.length === 0) || !opencodeReady}
            >
              ↑
            </button>
          )}
        </form>
      </div>

      <details className={styles.externalDisclosure}>
        <summary>Open externally instead</summary>
        <div className={styles.externalBody}>
          <label className={styles.field}>
            <span className={styles.label}>Terminal / editor target</span>
            <select
              className={styles.select}
              value={terminalId}
              onChange={(event) => setTerminalId(event.target.value)}
            >
              {status.terminals.map((target) => (
                <option key={target.id} value={target.id} disabled={!target.available}>
                  {target.label}{target.available ? '' : ' — Not installed'}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={!opencodeReady || !terminal?.available || busy != null}
              onClick={() => void launch(terminalId, 'open_code')}
            >
              {busy === `open_code:${terminalId}` ? 'Launching…' : 'Launch OpenCode here'}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={!terminal?.available || busy != null}
              onClick={() => void launch(terminalId, 'shell')}
            >
              Open shell
            </button>
            {status.editors.map((editor) => (
              <button
                key={editor.id}
                type="button"
                className={styles.ghost}
                disabled={!editor.available || busy != null}
                onClick={() => void launch(editor.id, 'editor')}
              >
                {editor.label}{editor.available ? '' : ' — Not installed'}
              </button>
            ))}
          </div>
          {status.launchCommand && (
            <div className={styles.commandBox}>
              <code className={styles.command}>{status.launchCommand}</code>
              <button type="button" className={styles.ghost} onClick={() => void copyCommand()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
