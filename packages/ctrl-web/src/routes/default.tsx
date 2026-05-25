// DefaultWorkspace — the `/` route. Per decision_ctrl_is_hermes_workbench
// CTRL is a workshop: persistent multi-tab workspace + Irisy as side
// drawer. When there are NO open tabs, fall back to the Irisy-idle page
// (a friendly chat input — what the user sees the first time).
//
// Per bao 2026-05-23: the session history list that used to live as a
// middle nav column now lives in the right rail as a collapsible level-2
// sub-panel. We push it via useIrisySubPanel — the rail clears it on
// route unmount automatically.

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ChatInput, IrisyMascot } from '@/components/primitives';
import { useRail, useIrisySubPanel, type RailSubPanel } from '@/components/RightRail';
import { WorkspaceTabs } from '@/components/workspace/WorkspaceTabs';
import { invoke } from '@/lib/bridge';
import { defaultTransport } from '@/lib/llm-transport';
import {
  appendTurns,
  createSession,
  deriveTitle,
  groupSessions,
  listSessions,
  loadSession,
  setHermesSessionId,
  type IrisySessionMeta,
} from '@/lib/irisy-sessions';
import {
  ensurePromptsBootstrap,
  loadIrisySystemPrompt,
} from '@/lib/irisy-prompts';
import { useTabStore } from '@/lib/tab-store';
import styles from './default.module.css';

interface IrisyInitStatus {
  kernel_llm: { ready: boolean; primary_adapter: string | null };
  hermes: {
    binary_path: string | null;
    version: string | null;
    brain_configured: boolean;
    plugin_enabled: boolean;
  };
  app_version: string;
}

interface HermesChatReply {
  session_id: string;
  content: string;
  elapsed_ms: number;
}

interface TranscriptTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export const DefaultWorkspace = (): ReactElement => {
  const { setIrisyState } = useRail();
  const [input, setInput] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<readonly TranscriptTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [sessions, setSessions] = useState<ReadonlyArray<IrisySessionMeta>>([]);
  // Hermes wire — when all three flags below are true we route the chat
  // through `irisy_chat_hermes` (hermes-agent CLI + ctrl-hermes-plugin
  // which carries Irisy's persona). Otherwise fall back to direct
  // `chat_stream` + a manually-prepended system prompt so the upstream
  // model (Volc/Doubao) doesn't introduce itself as "我是豆包".
  // Bao 2026-05-24: "一定要连hermes" — reverses the earlier v1 drop.
  const [hermesReady, setHermesReady] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  // Hermes-side session id for the CURRENT active chat. Distinct from
  // `activeId` (which is our vault session uuid). hermes-agent maintains
  // its own session catalog and requires `--resume <its id>` to continue
  // a multi-turn conversation. Null at chat start; populated after the
  // first successful hermes turn; persisted alongside the vault file.
  const [hermesSessionId, setActiveHermesSessionId] = useState<string | null>(null);

  useEffect(() => {
    setIrisyState('idle');
    return () => setIrisyState('idle');
  }, [setIrisyState]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 1) Probe hermes via `irisy_init`. Kernel auto-wires the brain
      //    config (writes ctrl-volc custom provider into ~/.hermes/config.yaml)
      //    + enables the ctrl plugin idempotently.
      try {
        const status = await invoke<IrisyInitStatus>('irisy_init');
        if (cancelled) return;
        setHermesReady(
          status.hermes.binary_path != null &&
            status.hermes.plugin_enabled &&
            status.hermes.brain_configured,
        );
      } catch {
        if (!cancelled) setHermesReady(false);
      }
      // 2) Bootstrap + load the Irisy system prompt as fallback persona
      //    for the direct chat_stream path. Idempotent vault write.
      try {
        await ensurePromptsBootstrap();
      } catch {
        /* vault unwritable — fall through to in-repo default */
      }
      const prompt = await loadIrisySystemPrompt();
      if (!cancelled) setSystemPrompt(prompt);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshSessions = useCallback(async (): Promise<void> => {
    const list = await listSessions();
    setSessions(list);
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const groups = useMemo(() => groupSessions(sessions), [sessions]);

  const handleSelect = useCallback(
    (id: string): void => {
      setActiveId(id);
      void (async () => {
        const session = await loadSession(id);
        if (!session) return;
        const restored: TranscriptTurn[] = session.turns.map((t) => ({
          id: crypto.randomUUID(),
          role: t.role,
          content: t.content,
        }));
        setTranscript(restored);
        setStreaming(false);
        setInput('');
        // Restore hermes-side session id so subsequent turns `--resume`.
        // Absent for chats that ran through the chat_stream fallback.
        setActiveHermesSessionId(session.hermesSessionId ?? null);
        // Drop any persisted workspace tab so the transcript surfaces.
        useTabStore.getState().reset();
      })();
    },
    [],
  );

  const subPanel = useMemo<RailSubPanel>(
    () => ({
      groups,
      activeId,
      onSelect: handleSelect,
      onNew: () => {
        setActiveId(null);
        setInput('');
        setTranscript([]);
        setStreaming(false);
        setIrisyState('idle');
        // Reset hermes session — next send creates a fresh hermes session.
        setActiveHermesSessionId(null);
        // Reset persisted workspace tabs (Hermes Settings, Code Space env,
        // embeds the user opened earlier) — otherwise WorkspaceTabs keeps
        // showing the active tab content instead of falling back to the
        // mascot + chat input. Bug bao 2026-05-24: "你看到对话框了？我没看到"
        // — turned out Hermes Settings tab persisted in localStorage and
        // hid the chat input.
        useTabStore.getState().reset();
      },
      newLabel: 'New chat',
      emptyText: 'no past chats',
    }),
    [groups, activeId, handleSelect, setIrisyState],
  );
  useIrisySubPanel(subPanel);

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
    const isFirstSendOfChat = activeId === null;
    // Generate session id up front so the in-flight stream + the file we
    // write afterwards agree on the same id, even if the user clicks New
    // chat mid-stream (we still finish persisting the started session).
    const sessionId: string = isFirstSendOfChat
      ? crypto.randomUUID()
      : (activeId as string);
    if (isFirstSendOfChat) setActiveId(sessionId);
    setTranscript((prev) => [...prev, userTurn, assistantTurn]);
    setStreaming(true);
    setIrisyState('thinking');
    void (async () => {
      // Create the session file (frontmatter only) BEFORE the assistant
      // reply arrives — that way a crash mid-stream still leaves a
      // valid vault file the user can find later.
      if (isFirstSendOfChat) {
        try {
          await createSession(sessionId, deriveTitle(trimmed));
          void refreshSessions();
        } catch (e) {
          // Persisting failed — log + continue with in-memory chat so the
          // user still gets a reply. Vault may be read-only / disk full.
          // eslint-disable-next-line no-console
          console.warn('[irisy] createSession failed:', e);
        }
      }

      let accumulated = '';
      let errored = false;
      // Hybrid routing (bao 2026-05-25 "先用混合"): default = fast
      // streaming via chat_stream + SOUL persona; explicit slash prefix
      // (`/hermes ` or `/tools `) routes to hermes for tool calling.
      // Hermes path is ~2-4s blocking (Python cold start each turn), so
      // we only pay that cost when the user opts in.
      const hermesPrefix = /^\/(hermes|tools)\s+(.*)/i;
      const prefixMatch = hermesPrefix.exec(trimmed);
      const userWantsHermes = prefixMatch != null;
      const effectivePrompt = prefixMatch ? prefixMatch[2]!.trim() : trimmed;
      const routeHermes = hermesReady && userWantsHermes;
      if (routeHermes) {
        // Hermes path — blocking call, returns the full reply at once.
        // No streaming yet (hermes-agent CLI doesn't expose a stream API
        // in v0.14). Identity comes from ~/.hermes/SOUL.md (synced by
        // ensure_hermes_soul_identity on every boot) so we never see
        // "我是豆包" or "我是 Hermes" here.
        //
        // Session id contract: pass our `hermesSessionId` (hermes-side,
        // populated after first turn) so multi-turn context survives.
        // NEVER pass the vault session id — hermes rejects it with
        // "Session not found" because the id namespaces are disjoint.
        try {
          const reply = await invoke<HermesChatReply>('irisy_chat_hermes', {
            args: {
              prompt: effectivePrompt,
              session_id: hermesSessionId ?? undefined,
              max_turns: 10,
            },
          });
          accumulated = reply.content;
          setTranscript((prev) =>
            prev.map((t) =>
              t.id === assistantTurn.id ? { ...t, content: accumulated } : t,
            ),
          );
          // Persist the hermes-side session id on first turn so the next
          // turn can `--resume` instead of starting a fresh hermes session
          // (which would lose all prior context).
          if (reply.session_id && reply.session_id !== hermesSessionId) {
            setActiveHermesSessionId(reply.session_id);
            try {
              await setHermesSessionId(sessionId, reply.session_id);
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('[irisy] persist hermes session id failed:', e);
            }
          }
        } catch (e) {
          errored = true;
          const msg = e instanceof Error ? e.message : String(e);
          accumulated = `[hermes error: ${msg}]`;
          setTranscript((prev) =>
            prev.map((t) =>
              t.id === assistantTurn.id ? { ...t, content: accumulated } : t,
            ),
          );
        }
      } else {
        // Default path: direct chat_stream + Irisy SOUL as system prompt.
        // Fast streaming (~0.5s to first token vs hermes 2-4s blocking).
        //
        // Lazy-load the prompt if the mount-time useEffect hasn't settled
        // by the time the user sends their first message. Without this,
        // a fast first send slips through with no system role and the
        // model defaults to "我是豆包". Subsequent sends reuse the state.
        let activePrompt = systemPrompt;
        if (!activePrompt) {
          try {
            activePrompt = await loadIrisySystemPrompt();
            setSystemPrompt(activePrompt);
          } catch {
            /* offline / vault unreachable — fall through with no system role */
          }
        }
        const messages = activePrompt
          ? [
              { role: 'system' as const, content: activePrompt },
              { role: 'user' as const, content: effectivePrompt },
            ]
          : [{ role: 'user' as const, content: effectivePrompt }];
        const transport = defaultTransport();
        try {
          for await (const chunk of transport.stream(messages, {
            temperature: 0.7,
          })) {
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
          accumulated = `${accumulated}\n\n[transport error: ${msg}]`;
          setTranscript((prev) =>
            prev.map((t) =>
              t.id === assistantTurn.id ? { ...t, content: accumulated } : t,
            ),
          );
        }
      }
      setStreaming(false);
      setIrisyState('idle');
      // Append both turns to the session file. Errors here are non-fatal —
      // the user already saw the reply in the transcript; we just lose the
      // turn in the persisted log. We persist the trimmed user input
      // verbatim (including any `/hermes` prefix) so re-loading shows what
      // the user actually typed.
      try {
        await appendTurns(
          sessionId,
          { role: 'user', content: trimmed },
          { role: 'assistant', content: accumulated },
        );
        void refreshSessions();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[irisy] appendTurns failed:', e);
      }
      // Errored flag intentionally unused beyond the inner catches above —
      // kept so future state work (red badge etc.) has the hook in place.
      void errored;
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
              : hermesReady
                ? 'Ask Irisy · prefix /hermes to invoke tools…'
                : 'Ask Irisy…'
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
