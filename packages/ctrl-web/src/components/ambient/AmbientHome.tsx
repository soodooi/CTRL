// AmbientHome — the morphing conversation surface (ADR-003 §8 v6).
//
// This is the MAIN COLUMN content (chat / discover) that sits to the
// right of the persistent sidebar. The shell chrome (sidebar, model
// picker, mobile drawer) lives in AmbientWorkbench so it survives route
// changes; AmbientHome is driven by props and owns only chat state.
//
// One ambient surface that morphs between three states via a CSS
// grid-template-areas state machine + Framer Motion layout animation:
//   empty       — centered greeting + big composer + capability floor
//   chat        — conversation + composer
//   chat-part   — conversation | part panel (resizable, vertical on
//                 narrow screens), when a turn produces a renderable UI
//                 part (html/code/...).
//
// Low-barrier for general users (bao 2026-06-11): the empty state SHOWS
// concrete clickable capabilities (the floor) instead of a blank box;
// the conversation is the flexible ceiling. Real chat via the existing
// irisyChatTransport — no new backend. Parts render through the flexible
// UI registry (lib/ui-registry) so the agent / user / content-type can
// invoke any UI piece on demand.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { engineTransport, type LLMMessage } from '@/lib/llm-transport';
import { classifyIntent, type RouteHint } from '@/lib/intent-routing';
// Reply-correctness wiring (parity with the docked IrisyChat): the home
// composer must ship the persona + brain_state system prompt and filter the
// reply, or it leaks internals / monologues / can't name its model.
import {
  composeSystemPrompt,
  loadIrisySystemPromptWithSoul,
  loadBrainState,
} from '@/lib/irisy-prompts';
// ADR-005 irisy §11 v40 (2026-06-09): humanizePiError shared with
// IrisyChat so brain errors surface instead of being swallowed by the stream.
import { cleanReplyText, humanizePiError } from '@/lib/irisy-render-filter';
import { SessionTabs } from '@/components/irisy/SessionTabs';
import {
  deriveSessionLabel,
  ensureActiveIrisySession,
  migrateLegacySingleSession,
  useIrisySessionsStore,
} from '@/lib/irisy-sessions';
// The conversation is a kernel-owned Resource; the store is its projection.
// (ADR-005 irisy §11.2 v44)
import {
  hydrateSessionsFromKernel,
  loadSessionMessages,
  persistSettledTurns,
} from '@/lib/session-hydration';
// ADR-003 frontend §7.6 v2 (IME input, 2026-06-14): shared CJK IME guard.
import { isImeComposing } from '@/lib/ime';
import {
  detectPart,
  renderPart,
  stripDetectedPart,
  splitStreamingArtifact,
  type PartSpec,
} from '@/lib/ui-registry';
import { type FeaturePack } from '@/components/featurepack/FeaturePackScene';
import { loadInstalledPacks, PACKS_CHANGED_EVENT } from '@/lib/feature-pack';
import {
  fctChoiceFact,
  fctOptionSelection,
  listFcts,
  mergeFctResources,
  resolveFctSelection,
  FCT_LIBRARY_OPTION,
  type FctItem,
  type FctSelectionProjection,
} from '@/lib/fct';
import { DecisionSurface } from '@/components/decisions/DecisionSurface';
import { unavailableFact, type DecisionFact } from '@/lib/decision-registry';
import type { LocalAppConnector, SelectionFact } from '@/lib/local-apps';
import { autoProjection, buildTurnContext } from '@/lib/irisy-turn';

/** A queued decision plus the handler its `navigates` option runs, so recovery
 *  routes per fact instead of every fact landing on one destination.
 *  (ADR-003 frontend § decision-registry v43) */
interface PendingDecision {
  fact: DecisionFact;
  recover?: () => void;
}
import { Discover } from './Discover';
import { TodayPanel } from './TodayPanel';
import { SourcesPanel } from '@/components/sources/SourcesPanel';
import { CodingAgentPanel } from '@/components/coding/CodingAgentPanel';
import { ResourceViewerHost } from '@/components/viewers/ResourceViewerHost';
import { Sidebar, type SidebarSection } from './Sidebar';
import {
  vaultRead,
  vaultWrite,
  vaultSearch,
  vaultList,
  resetEngine,
} from '@/lib/kernel';
import { listSmartTables } from '@/lib/smart-tables';
import { platform } from '@/lib/bridge';
import { APP_VERSION, useUpdateStatus } from '@/lib/app-meta';
import { getVersion } from '@tauri-apps/api/app';
import styles from './AmbientHome.module.css';

// Type-guard for restoring a persisted transcript (ADR-005 §8.4).
function isAmbientMsg(m: unknown): m is Msg {
  if (typeof m !== 'object' || m === null) return false;
  const r = m as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    (r.role === 'user' || r.role === 'assistant') &&
    typeof r.content === 'string'
  );
}

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Visible-intent pill shown above an assistant turn (ADR-003 §8.2B). Set
   *  when the turn is created so routing is shown BEFORE work starts, never
   *  hidden (§8.3 #1 anti-pattern). */
  route?: RouteHint;
  /** ADR-005 §8.6 terminal-essence transparency — the tool calls the engine ran
   *  during THIS turn, in order, each drill-down-able to raw input/output (§6). */
  tools?: ToolStepView[];
  /** ADR-005 §8.6 — the engine's accumulated reasoning for this turn, shown as a
   *  collapsible "thinking" trace (see it think, not just the final answer). */
  reasoning?: string;
  /** The turn ended before Irisy finished. Partial output is preserved for
   *  transparency, but it is not a result: no content actions are offered on it,
   *  and the failure itself is reported as a decision fact.
   *  (ADR-003 frontend § decision-registry v44; ADR-005 §12 U12) */
  failed?: boolean;
}

/** Humanize an engine tool id for the step summary: `mcp_ctrl_vault_search` →
 *  "vault search". The raw id stays available in the drill-down for power users. */
function prettyToolTitle(t: string): string {
  return t
    .replace(/^mcp_ctrl_/, '')
    .replace(/^mcp_/, '')
    .replace(/_/g, ' ')
    .trim();
}

/** A tool call folded from the engine's `call` + `result` steps (ADR-005 §8.6). */
interface ToolStepView {
  id: string;
  title: string;
  status: 'running' | 'completed' | 'failed';
  input?: string;
  output?: string;
}

/** Fold one streamed ToolStep into a turn's step list: `call` appends a running
 *  step, `result` completes the matching one (by id). Pure — returns a new array. */
function applyToolStep(
  prev: ToolStepView[] | undefined,
  step: {
    tool_call_id: string;
    phase: 'call' | 'result';
    title: string;
    status?: string;
    input?: string;
    output?: string;
  },
): ToolStepView[] {
  const list = prev ? [...prev] : [];
  const i = list.findIndex((s) => s.id === step.tool_call_id);
  const cur = i >= 0 ? list[i] : undefined;
  if (step.phase === 'call') {
    const view: ToolStepView = {
      id: step.tool_call_id,
      title: step.title || 'tool',
      status: 'running',
      input: step.input,
    };
    if (cur) list[i] = { ...cur, ...view };
    else list.push(view);
    return list;
  }
  // result: complete the matching step (or create one if we missed the call).
  const status: ToolStepView['status'] = step.status === 'failed' ? 'failed' : 'completed';
  if (cur) {
    list[i] = { ...cur, status, output: step.output };
  } else {
    list.push({ id: step.tool_call_id, title: step.title || 'tool', status, output: step.output });
  }
  return list;
}

/** A `/` slash command (ADR-005 §8.6.2 terminal command surface). `run` = an
 *  immediate local action; `template` = prefill the composer for the user to
 *  complete then send (a natural-language shortcut Irisy handles via its tools —
 *  menu, not memorization). */
interface SlashCommand {
  cmd: string;
  label: string;
  template?: string;
  run?: () => void;
}

type Surface = 'empty' | 'chat' | 'chat-part';

export interface AmbientHomeProps {
  section: SidebarSection;
  modelLabel: string;
  onOpenProviderSettings: () => void;
  onHideLauncher: () => void;
  /** Routed content occupies the left workspace without replacing the persistent shell. */
  workspaceContent?: ReactNode;
  onSidebarSelect: (section: SidebarSection) => void;
  settingUp?: boolean;
}

const SPRING = { type: 'spring', stiffness: 420, damping: 36 } as const;

export function AmbientHome({
  section,
  modelLabel,
  onOpenProviderSettings,
  onHideLauncher,
  workspaceContent,
  onSidebarSelect,
  settingUp = false,
}: AmbientHomeProps): ReactElement {

  const [input, setInput] = useState('');
  const sessions = useIrisySessionsStore((state) => state.sessions);
  const activeSessionId = useIrisySessionsStore((state) => state.activeSessionId);
  const setSessionMessages = useIrisySessionsStore((state) => state.setMessages);
  const setSessionResources = useIrisySessionsStore((state) => state.setResources);
  const setSelectedFct = useIrisySessionsStore((state) => state.setSelectedFct);
  const createSession = useIrisySessionsStore((state) => state.createSession);
  const renameSession = useIrisySessionsStore((state) => state.renameSession);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const selectedFctRef = activeSession?.selectedFctRef ?? '';
  const [fcts, setFcts] = useState<FctItem[]>([]);
  const [fctSwitching, setFctSwitching] = useState(false);
  // The override panel is opened explicitly; Auto stays the resting state.
  // (ADR-003 frontend §8.5 v42; ADR-005 irisy §12 v42 U17)
  const [fctChoiceOpen, setFctChoiceOpen] = useState(false);
  // One refetch path, so an availability change in Library and a pack event both
  // show the kernel's state rather than a local guess.
  // (ADR-005 irisy §12 v42 U15)
  const refreshFcts = useCallback((): void => {
    void listFcts().then(setFcts).catch(() => setFcts([]));
  }, []);
  useEffect(() => {
    const refresh = (): void => {
      refreshFcts();
    };
    refresh();
    window.localStorage.removeItem('ctrl:irisy-assistant-skill:v1');
    window.addEventListener(PACKS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PACKS_CHANGED_EVENT, refresh);
  }, [refreshFcts]);
  const activeResources = activeSession?.resources ?? [];
  const codingResourceRef = activeResources.find((resource) =>
    resource.startsWith('ctrl://local/project/'),
  ) ?? null;
  // Any other Work Resource the session owns renders through the same canonical
  // descriptor -> content-type projection. The pane does not branch on kind, so a
  // note, a table, or anything else the user is working on becomes visible and,
  // when its owner advertises a write, editable through the governed path.
  // (ADR-003 frontend §8.5 v40; ADR-005 irisy §12 v42 U1/U6)
  const workResourceRef = activeResources.find(
    (resource) => !resource.startsWith('ctrl://local/project/'),
  ) ?? null;
  const messages = (activeSession?.messages ?? []).filter(isAmbientMsg);
  const setMessages = useCallback(
    (updater: Msg[] | ((previous: Msg[]) => Msg[])): void => {
      if (!activeSessionId) return;
      setSessionMessages(activeSessionId, (previous) => {
        const ambient = previous.filter(isAmbientMsg);
        return typeof updater === 'function' ? updater(ambient) : updater;
      });
    },
    [activeSessionId, setSessionMessages],
  );

  useEffect(() => {
    migrateLegacySingleSession('ctrl:transcript:v1:ambient');
    // The transcript directory is the truth, so the view is rebuilt from it and
    // anything the browser still holds alone is written there first. A session
    // is only created when the kernel has none, so hydration never races an
    // empty new tab into existence ahead of the real history.
    // (ADR-005 irisy §11.2 v44)
    void hydrateSessionsFromKernel().finally(() => {
      ensureActiveIrisySession();
    });
  }, []);



  const [streaming, setStreaming] = useState(false);
  // Abort handle for the in-flight turn so the composer's Stop button can cancel
  // streaming WITHOUT locking the textarea. bao (feedback, repeated): never block
  // input while Irisy is responding — see memory feedback-irisy-never-block-input.
  const abortRef = useRef<AbortController | null>(null);

  // Opening a conversation reads it from disk, so switching back to a tab shows
  // what the transcript actually holds — including edits the user made in their
  // own editor. Skipped while a turn is in flight: the file does not have the
  // streaming reply yet, so loading then would blank it. (ADR-005 irisy §11.2 v44)
  useEffect(() => {
    if (!activeSessionId || abortRef.current) return;
    void loadSessionMessages(activeSessionId);
  }, [activeSessionId]);
  // Every transcript-owner change queues one runtime reset. A send awaits the
  // queue, so a newly visible Irisy transcript can never race the stale ACP
  // owner from the prior tab. (ADR-005 irisy §8.7/§11 v38)
  const engineResetRef = useRef<Promise<void>>(Promise.resolve());
  const queueEngineReset = useCallback((): Promise<void> => {
    const next = engineResetRef.current
      .catch(() => undefined)
      .then(() => resetEngine());
    engineResetRef.current = next;
    return next;
  }, []);
  // Pending decisions, rendered one at a time by the decision surface registry.
  // Plain confirmations (copied/saved/exported) stay notices; anything the user
  // must decide or recover from becomes a fact. The queue exists so a second
  // failure cannot silently discard the first one the user has not seen.
  // (ADR-003 frontend § decision-registry v43)
  const [decisions, setDecisions] = useState<PendingDecision[]>([]);
  const raiseDecision = useCallback((fact: DecisionFact, recover?: () => void) => {
    setDecisions((queue) =>
      queue.some((entry) => entry.fact.id === fact.id) ? queue : [...queue, { fact, recover }],
    );
  }, []);
  // Ids must be unique per raise: the queue dedupes by id, so a clock-based id
  // would let two same-class failures inside one millisecond collapse into one.
  const decisionIdRef = useRef(0);
  const nextDecisionId = useCallback((prefix: string): string => {
    decisionIdRef.current += 1;
    return `${prefix}-${decisionIdRef.current}`;
  }, []);
  const pendingDecision = decisions[0] ?? null;

  const selectFct = useCallback(async (ref: string): Promise<boolean> => {
    if (!activeSessionId || ref === selectedFctRef || fctSwitching) return false;
    setFctSwitching(true);
    try {
      // Selection commits only after the live catalog proves that the stable ref
      // resolves into exact turn facts. Expanded facts are never persisted.
      // (ADR-002 substrate §15.4 v84; ADR-003 frontend §8.5 v41)
      if (ref) await resolveFctSelection(ref);
      abortRef.current?.abort();
      setStreaming(false);
      await queueEngineReset();
      setSelectedFct(activeSessionId, ref || null);
      return true;
    } catch (error: unknown) {
      // A failed selection is a decision fact, not an assistant turn. Rendering
      // it as prose fabricated a reply Irisy never produced and dropped the
      // recovery path. (ADR-003 frontend § decision-registry v43; U12)
      raiseDecision(
        unavailableFact({
          id: nextDecisionId('fct-select'),
          subject: 'That FCT could not be used, so the session is unchanged.',
          target: ref,
          reason: error instanceof Error ? error.message : String(error),
          retryable: true,
          recoveryLabel: 'Manage in Library',
        }),
        () => onSidebarSelect('library'),
      );
      return false;
    } finally {
      setFctSwitching(false);
    }
  }, [activeSessionId, fctSwitching, queueEngineReset, raiseDecision, selectedFctRef, setSelectedFct]);
  // A tab switch changes the sole Irisy ACP context owner. Abort the active
  // transport and re-prime from the selected durable transcript.
  const previousSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousSessionIdRef.current;
    previousSessionIdRef.current = activeSessionId;
    if (!activeSessionId || previous === null || previous === activeSessionId) return;
    abortRef.current?.abort();
    void queueEngineReset().catch(() => undefined);
  }, [activeSessionId, queueEngineReset]);
  const [part, setPart] = useState<PartSpec | null>(null);
  const [editing, setEditing] = useState(false);
  // Project Resource registration writes through the canonical Irisy session.
  // Read current store state inside this stable callback so a resource write
  // cannot retrigger the child registration effect through callback identity.
  // (ADR-003 frontend §8.5 v40; ADR-005 irisy §11 v40)
  const onCodingResourceChange = useCallback(
    (resourceRef: string | null): void => {
      if (!activeSessionId) return;
      const current = useIrisySessionsStore
        .getState()
        .sessions.find((session) => session.id === activeSessionId)
        ?.resources ?? [];
      const otherResources = current.filter(
        (resource) => !resource.startsWith('ctrl://local/project/'),
      );
      const next = resourceRef ? [...otherResources, resourceRef] : otherResources;
      if (current.length === next.length && current.every((resource, index) => resource === next[index])) {
        return;
      }
      setSessionResources(activeSessionId, next);
    },
    [activeSessionId, setSessionResources],
  );
  // Installed packs are retained only as Library input.
  const [installedPacks, setInstalledPacks] = useState<FeaturePack[]>([]);
  useEffect(() => {
    const load = () => {
      void loadInstalledPacks().then(setInstalledPacks).catch(() => {});
    };
    load();
    window.addEventListener(PACKS_CHANGED_EVENT, load);
    return () => window.removeEventListener(PACKS_CHANGED_EVENT, load);
  }, []);
  const assistantResourceKey = useMemo(
    () => activeResources.join('\u0000'),
    [activeResources],
  );
  const previousAssistantResourceKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousAssistantResourceKeyRef.current;
    previousAssistantResourceKeyRef.current = assistantResourceKey;
    if (previous === null || previous === assistantResourceKey) return;
    abortRef.current?.abort();
    setStreaming(false);
    // Resource changes re-prime the sole Irisy runtime before its next turn.
    // (ADR-003 frontend §8.6 v40; ADR-005 irisy §11 v40)
    void queueEngineReset().catch((error: unknown) => {
      raiseDecision(
        unavailableFact({
          id: nextDecisionId('resource-switch'),
          subject: 'Irisy could not switch to this resource.',
          reason: error instanceof Error ? error.message : String(error),
          retryable: true,
        }),
      );
    });
  }, [assistantResourceKey, queueEngineReset, raiseDecision]);
  const [isNarrow, setIsNarrow] = useState(false);
  // Irisy column width — a fixed default the user can drag via the divider
  // between Irisy and the output bar (bao 2026-06-13). Window resizing keeps
  // this width (the output bar absorbs the change); only dragging changes it.
  // Irisy dialog ("creator") column width. Default kept narrow so the workspace
  // (outbar) stays the primary surface — a 480px dialog ate ~half the page on
  // smaller screens (bao 2026-07-03). Draggable 260..560 via the divider.
  // Irisy dialog width. The chat is the primary surface most of the time, so a
  // comfortable default (bao 2026-07-04: 360 read too narrow); draggable wider
  // for pure chat or narrower to give a workspace scene room.
  const [irisyWidth, setIrisyWidth] = useState(440);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const useFctFromLibrary = useCallback(async (ref: string): Promise<void> => {
    if (!(await selectFct(ref))) return;
    onSidebarSelect('work');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [onSidebarSelect, selectFct]);
  // Opening a search hit makes it the session's Work Resource, so search-to-open
  // uses the same Resource path as everything else and the turn that follows is
  // grounded in it. (ADR-005 irisy §12 v42 U4)
  const openWorkResource = useCallback(
    (resourceRef: string): void => {
      if (!activeSessionId) return;
      const current = useIrisySessionsStore
        .getState()
        .sessions.find((session) => session.id === activeSessionId)
        ?.resources ?? [];
      if (current.includes(resourceRef)) return;
      // Replace a previously opened non-project Resource rather than accumulating
      // every note the user ever looked at.
      const kept = current.filter((resource) =>
        resource.startsWith('ctrl://local/project/'),
      );
      setSessionResources(activeSessionId, [...kept, resourceRef]);
    },
    [activeSessionId, setSessionResources],
  );
  // A local application's explicit selection becomes editable context for the
  // next turn. It is prefilled into the composer rather than sent as a message,
  // so the user still says what they want done and can see exactly what CTRL
  // read. No assistant turn is fabricated.
  // (ADR-002 substrate §14.12; ADR-005 irisy §12 v42 U22)
  const useLocalAppSelection = useCallback(
    (connector: LocalAppConnector, facts: SelectionFact[]): void => {
      const body = facts.map((fact) => `${fact.label}: ${fact.value}`).join('\n');
      setInput(
        (current) =>
          `${current ? `${current}\n\n` : ''}Selection from ${connector.name}:\n${body}\n\n`,
      );
      onSidebarSelect('work');
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [onSidebarSelect],
  );
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Keep the newest message pinned to the bottom. The stream loop scrolls on
  // each token, but segment gaps (tool calls), the trailing "working" row, and
  // late-rendering markdown grow the height afterwards — so also pin whenever
  // the message list or streaming flag changes (bao 2026-07-04: chat didn't
  // show the bottom). Double rAF so we scroll AFTER layout has settled.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight });
      }),
    );
  }, [messages, streaming]);

  // Stack the part panel below the chat (vertical resize) on phones
  // instead of side-by-side — the real fix for the prior CSS override.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 720px)');
    const update = (): void => setIsNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const newChat = useCallback(() => {
    createSession();
    setPart(null);
    setInput('');
    // The new Irisy tab gets a fresh engine session.
    // (ADR-005 irisy §11 v40)
    void queueEngineReset().catch(() => undefined);
  }, [createSession, queueEngineReset]);

  // ADR-005 §8.6.2 fork / checkpoint (Claude /rewind · Gemini /restore): rewind to
  // a past turn and continue in a NEW direction. Truncate the transcript to that
  // message and reset the engine, so it re-hydrates from the checkpoint (§8.4).
  // The prior full conversation stays in Irisy's session history (drawer).
  const forkFromHere = useCallback((msgId: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msgId);
      return idx >= 0 ? prev.slice(0, idx + 1) : prev;
    });
    setPart(null);
    void queueEngineReset().catch(() => undefined);
  }, [queueEngineReset, setMessages]);

  // Auto-grow the composer to its content (cheap, works in every webview).
  const autoGrow = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  // Drag the divider between Irisy and the output bar to resize Irisy.
  // Pass the pointer's start X; we listen on document so the drag continues
  // even if the cursor leaves the thin handle. Clamped to a sane range.
  const startIrisyDrag = useCallback(
    (startX: number) => {
      const startW = irisyWidth;
      const onMove = (ev: MouseEvent): void => {
        // Irisy sits on the RIGHT (CSS order), so dragging the divider left
        // (clientX decreases) widens Irisy — hence startW minus the delta.
        const next = Math.max(300, Math.min(680, startW - (ev.clientX - startX)));
        setIrisyWidth(next);
      };
      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [irisyWidth],
  );

  const surface: Surface = part ? 'chat-part' : messages.length > 0 ? 'chat' : 'empty';
  // Gate the first-run CTA on whether any model is wired up yet.
  const hasProvider = modelLabel !== 'Model';

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !activeSessionId) return;

    // Claim visible turn ownership before the first await. Session, Work
    // Resources, FCT selection, Stop, and interrupt transitions abort this
    // controller, so a stale closure cannot dispatch captured context.
    // (ADR-005 irisy §11 v41)
    const sessionId = activeSessionId;
    const workResources = [...activeResources];
    const resourceKey = workResources.join('\u0000');
    const fctRef = selectedFctRef;
    const previousController = abortRef.current;
    previousController?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const ownsTurn = (): boolean => {
      if (abortRef.current !== ctrl || ctrl.signal.aborted) return false;
      const state = useIrisySessionsStore.getState();
      const current = state.sessions.find((session) => session.id === state.activeSessionId);
      return state.activeSessionId === sessionId
        && (current?.resources ?? []).join('\u0000') === resourceKey
        && (current?.selectedFctRef ?? '') === fctRef;
    };
    const releaseTurn = (): void => {
      if (abortRef.current === ctrl) abortRef.current = null;
    };

    // Serialize canonical transcript ownership with ACP ownership. Every await
    // is followed by the same monotonic request-owner check.
    try {
      await engineResetRef.current;
    } catch (error: unknown) {
      if (ownsTurn()) {
        raiseDecision(
          unavailableFact({
            id: nextDecisionId('session-switch'),
            subject: 'Irisy could not switch to this session, so nothing was sent.',
            reason: error instanceof Error ? error.message : String(error),
            retryable: true,
          }),
        );
      }
      releaseTurn();
      return;
    }
    if (!ownsTurn()) return;

    // Interrupt-and-redirect crosses the cancel-and-drain boundary before this
    // owner may create a new turn. (ADR-005 irisy §11 v40)
    if (previousController) {
      try {
        await queueEngineReset();
      } catch (error: unknown) {
        if (ownsTurn()) {
          raiseDecision(
            unavailableFact({
              id: nextDecisionId('turn-stop'),
              subject: 'Irisy could not stop the previous turn, so nothing was sent.',
              reason: error instanceof Error ? error.message : String(error),
              retryable: true,
            }),
          );
        }
        releaseTurn();
        return;
      }
      if (!ownsTurn()) return;
    }

    let projection: FctSelectionProjection = autoProjection();
    if (fctRef) {
      try {
        projection = await resolveFctSelection(fctRef);
      } catch (error: unknown) {
        if (ownsTurn()) {
          // Report the stale selection once as a decision fact and return the
          // session to Auto; the turn is not sent under stale context.
          // (ADR-002 substrate §15.4 v84; ADR-003 § decision-registry v43; U12)
          raiseDecision(
            unavailableFact({
              id: nextDecisionId('fct-stale'),
              subject: 'The selected FCT is no longer available. This session is back on Auto.',
              target: fctRef,
              reason: error instanceof Error ? error.message : String(error),
              retryable: true,
              recoveryLabel: 'Manage in Library',
            }),
            () => onSidebarSelect('library'),
          );
          setSelectedFct(sessionId, null);
          void queueEngineReset().catch(() => undefined);
        }
        releaseTurn();
        return;
      }
      if (!ownsTurn()) return;
    }
    // One place decides what the turn is grounded in, and it is asserted in
    // lib/irisy-turn.test.ts. (ADR-005 irisy §12 v42 U1)
    const turnContext = buildTurnContext({
      sessionId,
      workResources,
      projection,
      task: trimmed,
    });

    setInput('');
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: trimmed };
    if (!messages.some((message) => message.role === 'user')) {
      renameSession(sessionId, deriveSessionLabel(trimmed));
    }
    // Readiness gate (bao 2026-06-12: check the env + guide, don't go silent).
    // No configured provider is an `unavailable` decision with an explicit
    // recovery, not an assistant turn Irisy never produced. The user message is
    // kept so the request is not lost.
    // (ADR-003 frontend § decision-registry v43; ADR-005 §12 U12)
    if (!hasProvider) {
      setMessages((prev) => [...prev, userMsg]);
      raiseDecision(
        unavailableFact({
          id: nextDecisionId('provider-missing'),
          subject: 'No model is configured yet, so this cannot be answered.',
          reason: 'no provider is bound for the Irisy role',
          retryable: true,
          recoveryLabel: 'Open provider settings',
        }),
        onOpenProviderSettings,
      );
      releaseTurn();
      return;
    }
    const asstId = `a-${Date.now()}`;
    const route = classifyIntent(trimmed);
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: asstId, role: 'assistant', content: '', route },
    ]);
    setStreaming(true);
    setEditing(false);
    // Record the question before the answer is attempted, so a crash or a killed
    // process during the turn cannot lose what the user asked. The empty
    // assistant placeholder is not written; only settled turns are.
    // (ADR-005 irisy §11.2 v44)
    void persistSettledTurns(sessionId);

    try {
      // Identity is fixed; Resource and optional Skill carry per-turn context.
      // (ADR-005 irisy §11 v40)
      const [base, brain] = await Promise.all([
        loadIrisySystemPromptWithSoul(),
        loadBrainState(),
      ]);
      if (!ownsTurn()) return;
      const history: LLMMessage[] = [
        {
          role: 'system',
          content: composeSystemPrompt({
            base,
            brainState: brain,
          }),
        },
        ...[...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ];
      let acc = '';
      // ADR-005 irisy §11 v40 (2026-06-09): the transport does not
      // throw — brain timeout / crash / no-auth arrive as a chunk carrying
      // `error`. Surface it (parity with IrisyChat) instead of `continue`-ing
      // past it, which froze the bubble or misreported "No AI provider".
      let streamError = false;
      for await (const chunk of engineTransport().stream(history, {
        signal: ctrl.signal,
        context: turnContext,
      })) {
        // Only the current request owner may route results or mutate visible UI.
        // (ADR-003 frontend §8.5 v40; ADR-005 irisy §11 v40)
        if (!ownsTurn()) break;
        if (typeof chunk !== 'string' && chunk?.error) {
          if (chunk.error === 'aborted') break;
          const { summary } = humanizePiError(String(chunk.error), modelLabel);
          setMessages((prev) =>
            prev.map((m) => (m.id === asstId ? { ...m, content: summary } : m)),
          );
          streamError = true;
          break;
        }
        // Tool/result routing remains transcript-only until an owning Resource
        // descriptor is returned. Notes and pack scenes have no Work authority.
        if (typeof chunk !== 'string' && chunk?.tool) {
          const step = chunk.tool;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstId ? { ...m, tools: applyToolStep(m.tools, step) } : m,
            ),
          );
          requestAnimationFrame(() => {
            if (ownsTurn()) {
              scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
            }
          });
          continue;
        }
        // ADR-005 §8.6 — a reasoning chunk: accumulate into THIS turn's thinking
        // trace (see it think), kept separate from the answer text.
        if (typeof chunk !== 'string' && chunk?.thought) {
          const t = chunk.thought;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstId ? { ...m, reasoning: (m.reasoning ?? '') + t } : m,
            ),
          );
          continue;
        }
        const delta = typeof chunk === 'string' ? chunk : (chunk?.delta ?? '');
        if (!delta) continue;
        acc += delta;
        // Stream artifacts (docs / pages / code) straight into the workspace
        // pane in REAL TIME — the chat bubble only keeps the one-line intro, so
        // the document never piles up in the conversation first.
        const split = splitStreamingArtifact(acc);
        if (split) {
          setPart(split.part);
          const intro = split.intro || 'Writing it in the workspace on the left…';
          setMessages((prev) =>
            prev.map((m) => (m.id === asstId ? { ...m, content: intro } : m)),
          );
        } else {
          setMessages((prev) =>
            prev.map((m) => (m.id === asstId ? { ...m, content: acc } : m)),
          );
        }
        requestAnimationFrame(() => {
          if (ownsTurn()) {
            scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
          }
        });
      }
      if (!ownsTurn()) return;
      // Finalize only while this request still owns the visible turn.
      const detected = detectPart(acc);
      if (detected) setPart(detected);
      if (acc.trim().length === 0 && !streamError) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstId
              ? {
                  ...m,
                  content:
                    'No AI provider is set up yet. Open **Settings -> Providers** to add one (your own API key, or CTRL Cloud).',
                }
              : m,
          ),
        );
      }
    } catch (err) {
      if (!ownsTurn()) return;
      // A failed turn is a decision fact, not an answer. Writing the raw error
      // into the transcript made Irisy appear to say it, and offering the content
      // actions invited saving a stack trace into a note.
      // (ADR-003 frontend § decision-registry v43/v44; ADR-005 §12 U12)
      const msg = err instanceof Error ? err.message : String(err);
      const missingProvider = /provider|no provider|unreachable|configured/i.test(msg);
      setMessages((prev) =>
        prev.flatMap((m) => {
          if (m.id !== asstId) return [m];
          // Keep partial output the engine did produce, marked as unfinished;
          // drop an empty placeholder rather than leaving a blank reply.
          return m.content.trim() ? [{ ...m, failed: true }] : [];
        }),
      );
      raiseDecision(
        unavailableFact({
          id: nextDecisionId('turn-failed'),
          subject: missingProvider
            ? 'No model is configured, so this could not be answered.'
            : 'Irisy could not finish this answer.',
          reason: msg,
          retryable: true,
          recoveryLabel: missingProvider ? 'Open provider settings' : undefined,
        }),
        missingProvider
          ? onOpenProviderSettings
          : // Retry through the ref, not this closure: a captured `send` would
            // replay with the session/resource state of the failed turn.
            () => void sendRef.current?.(trimmed),
      );
    } finally {
      // ADR-005 irisy §11 v40 (2026-06-09): only the currently-active
      // turn clears streaming — a superseded (interrupt-redirected) turn must not
      // flip it off or null the new turn's controller under it.
      if (abortRef.current === ctrl) {
        setStreaming(false);
        abortRef.current = null;
      }
      // The turn has settled, so record it. This runs for a cancelled or failed
      // turn too: what the user actually said and whatever the engine actually
      // produced is history either way. Writing only settled turns keeps the
      // file free of half-streamed text. (ADR-005 irisy §11.2 v44)
      void persistSettledTurns(sessionId);
    }
  }, [messages, hasProvider, onOpenProviderSettings, queueEngineReset, activeSessionId, activeResources, selectedFctRef, renameSession, setMessages, setSelectedFct]);

  // Latest `send`, so a retry raised by an earlier turn's failure runs against
  // current session/resource state. (ADR-003 frontend § decision-registry v44)
  const sendRef = useRef<((text: string) => Promise<void>) | null>(null);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Stop crosses the same request-owned cancel-and-drain boundary before the
  // Hermes owner can be reused. The composer remains editable while it drains.
  // (ADR-005 irisy §11 v40)
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
    void queueEngineReset().catch(() => undefined);
  }, [queueEngineReset]);

  // Irisy capture/recall (bao 2026-06-12: the two AI chips under a reply).
  // Capture = append this reply to today's Irisy log note (vault is truth).
  // Recall = answer the last question grounded in matching notes (light RAG).
  const [notice, setNotice] = useState<string | null>(null);

  // Auto-dismiss the notice (copy/save feedback) so it doesn't linger.
  useEffect(() => {
    if (notice == null) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const captureToNotes = useCallback(async (content: string) => {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const path = `irisy/log-${day}.md`;
    let body = '';
    try {
      const entry = await vaultRead(path);
      body = entry.content;
    } catch {
      // New log file for today.
    }
    const next = `${body.trimEnd()}\n\n## ${time}\n\n${content}\n`.replace(/^\n+/, '');
    try {
      await vaultWrite({
        path,
        content: next,
        frontmatter: { title: `Irisy log ${day}`, tags: ['irisy-log'] },
      });
      setNotice(`Saved to Notes — ${path}`);
    } catch (e) {
      setNotice(e instanceof Error ? `Could not save: ${e.message}` : 'Could not save.');
    }
  }, []);

  const askKnowledgeBase = useCallback(async () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const q = lastUser?.content.trim();
    if (!q) return;
    let context = '';
    try {
      const hits = await vaultSearch(q, 20);
      const parts: string[] = [];
      for (const p of hits.slice(0, 3)) {
        try {
          const entry = await vaultRead(p);
          parts.push(`# ${p}\n${entry.content.slice(0, 700)}`);
        } catch {
          // Skip unreadable hit.
        }
      }
      context = parts.join('\n\n---\n\n');
    } catch {
      // Search index not ready — fall through to a plain answer.
    }
    const prompt = context
      ? `Answer using my notes below. Cite the file names you used. If the notes don't cover it, say so.\n\n=== MY NOTES ===\n${context}\n\n=== QUESTION ===\n${q}`
      : `Answer from my knowledge base. (No notes matched "${q}" yet — answer from general knowledge and say the notes were empty.)\n\n${q}`;
    void send(prompt);
  }, [messages, send]);

  // Copy to clipboard (bao 2026-06-13: copying a reply / the whole chat is a
  // basic must-have). Uses the webview clipboard API; notice gives feedback.
  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Copied to clipboard');
    } catch {
      setNotice('Copy failed — select the text and copy manually');
    }
  }, []);

  // Export an artifact as a file (download = the local-first "share": the user
  // Today cockpit loader for the stock pack — calls its tools through the
  // :17873 gate (gateInvoke returns each tool's native object incl. its `card`
  // gets a real plain-text file they own and can send anywhere).
  const downloadPart = useCallback((p: PartSpec) => {
    const ext =
      p.kind === 'html'
        ? 'html'
        : p.kind === 'markdown'
          ? 'md'
          : p.kind === 'json'
            ? 'json'
            : p.kind === 'code'
              ? (p.language ?? 'txt')
              : 'txt';
    const base = (p.title ?? p.kind)
      .replace(/\.(html|md|json)$/i, '')
      .replace(/[^\w.-]+/g, '-')
      .slice(0, 60) || 'artifact';
    const blob = new Blob([p.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setNotice(`Exported ${a.download}`);
  }, []);

  const copyConversation = useCallback(() => {
    if (messages.length === 0) return;
    const text = messages
      .map((m) => `${m.role === 'user' ? 'You' : 'Irisy'}: ${m.content}`)
      .join('\n\n');
    void copyText(text);
  }, [messages, copyText]);

  // ADR-005 §8.6.2 terminal command surface — `/` slash menu + ↑/↓ history recall.
  const [slashSel, setSlashSel] = useState(0);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  // `@`-mention — reference a note / table (fetched once; filtered as you type).
  const [mentionSel, setMentionSel] = useState(0);
  const [mentionItems, setMentionItems] = useState<{ label: string; kind: string }[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const [paths, tables] = await Promise.all([vaultList(), listSmartTables()]);
        const notes = paths
          .filter((p) => p.endsWith('.md') && !p.endsWith('.sheet.md'))
          .map((p) => ({ label: p.replace(/\.md$/, '').split('/').pop() ?? p, kind: 'note' }));
        const tbls = tables.map((t) => ({ label: t.title || t.path, kind: 'table' }));
        const seen = new Set<string>();
        const merged = [...notes, ...tbls].filter((i) =>
          seen.has(i.label) ? false : (seen.add(i.label), true),
        );
        setMentionItems(merged.slice(0, 400));
      } catch {
        /* browser/no-vault — mention menu stays empty */
      }
    })();
  }, []);
  const slashCommands: SlashCommand[] = [
    { cmd: '/new', label: 'New conversation', run: newChat },
  ];
  const userHistory = messages.filter((m) => m.role === 'user').map((m) => m.content);
  const slashQuery = input.startsWith('/') && !/\s/.test(input) ? input.toLowerCase() : null;
  const slashMatches = slashQuery
    ? slashCommands.filter((c) => c.cmd.startsWith(slashQuery))
    : [];
  const slashOpen = slashMatches.length > 0;
  const slashActive = Math.min(slashSel, Math.max(0, slashMatches.length - 1));
  const applySlash = (c: SlashCommand): void => {
    setHistIdx(null);
    setSlashSel(0);
    if (c.run) {
      setInput('');
      c.run();
    } else {
      setInput(c.template ?? `${c.cmd} `);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        autoGrow();
      });
    }
  };
  // `@`-mention: the trailing `@word` at the caret.
  const mentionMatch = !slashOpen ? input.match(/@([^\s@]*)$/) : null;
  const mentionQuery = mentionMatch ? (mentionMatch[1] ?? '').toLowerCase() : null;
  const mentionMatches =
    mentionQuery !== null
      ? mentionItems.filter((i) => i.label.toLowerCase().includes(mentionQuery)).slice(0, 8)
      : [];
  const mentionOpen = mentionMatches.length > 0;
  const mentionActive = Math.min(mentionSel, Math.max(0, mentionMatches.length - 1));
  const applyMention = (label: string): void => {
    setInput(input.replace(/@[^\s@]*$/, `@${label} `));
    setMentionSel(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      autoGrow();
    });
  };

  const composer = (
    <div className={styles.composerWrap}>
      {/* Status line removed — state merged into the single personaRow line
          above; version is on the CTRL wordmark; provider/model is in Settings
          (bao 2026-07-07: only one line above the input). */}
      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
      {/* `/` slash menu — filterable, teaches its own commands (ADR-005 §8.6.2). */}
      {slashOpen && (
        <div className={styles.slashMenu} role="listbox">
          {slashMatches.map((c, i) => (
            <button
              type="button"
              key={c.cmd}
              className={styles.slashItem}
              data-sel={i === slashActive ? 'yes' : 'no'}
              onMouseEnter={() => setSlashSel(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                applySlash(c);
              }}
            >
              <span className={styles.slashCmd}>{c.cmd}</span>
              <span className={styles.slashLabel}>{c.label}</span>
            </button>
          ))}
        </div>
      )}
      {/* `@`-mention menu — reference a note or table (ADR-005 §8.6.2). */}
      {mentionOpen && (
        <div className={styles.slashMenu} role="listbox">
          {mentionMatches.map((it, i) => (
            <button
              type="button"
              key={`${it.kind}:${it.label}`}
              className={styles.slashItem}
              data-sel={i === mentionActive ? 'yes' : 'no'}
              onMouseEnter={() => setMentionSel(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                applyMention(it.label);
              }}
            >
              <span className={styles.slashCmd}>@{it.label}</span>
              <span className={styles.slashLabel}>{it.kind}</span>
            </button>
          ))}
        </div>
      )}
      <div className={styles.composerInputRow}>
        <textarea
          ref={inputRef}
          className={styles.input}
          data-workspace-shortcuts="when-empty"
          value={input}
          rows={1}
          placeholder="Ask Irisy…"
          onChange={(e) => {
            setInput(e.target.value);
            setHistIdx(null);
            setSlashSel(0);
            setMentionSel(0);
            autoGrow();
          }}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            // Slash menu navigation (ADR-005 §8.6.2).
            if (slashOpen) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSlashSel((s) => (s + 1) % slashMatches.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSlashSel((s) => (s - 1 + slashMatches.length) % slashMatches.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const chosen = slashMatches[slashActive];
                if (chosen) applySlash(chosen);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setInput('');
                return;
              }
            }
            // `@`-mention menu navigation.
            if (mentionOpen) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionSel((s) => (s + 1) % mentionMatches.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionSel((s) => (s - 1 + mentionMatches.length) % mentionMatches.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const chosen = mentionMatches[mentionActive];
                if (chosen) applyMention(chosen.label);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setInput(input.replace(/@[^\s@]*$/, ''));
                return;
              }
            }
            // ↑/↓ history recall — walk previous inputs when the caret is at the
            // very start (so multi-line editing still works normally).
            const ta = e.currentTarget;
            const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
            if (!slashOpen && userHistory.length > 0 && e.key === 'ArrowUp' && (input === '' || atStart)) {
              e.preventDefault();
              const next = histIdx === null ? userHistory.length - 1 : Math.max(0, histIdx - 1);
              setHistIdx(next);
              setInput(userHistory[next] ?? '');
              requestAnimationFrame(autoGrow);
              return;
            }
            if (!slashOpen && histIdx !== null && e.key === 'ArrowDown') {
              e.preventDefault();
              if (histIdx >= userHistory.length - 1) {
                setHistIdx(null);
                setInput('');
              } else {
                const next = histIdx + 1;
                setHistIdx(next);
                setInput(userHistory[next] ?? '');
              }
              requestAnimationFrame(autoGrow);
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              setHistIdx(null);
              void send(input);
            }
          }}
        />
      </div>
      <PersonaRow />
      </form>
    </div>
  );

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const conversation = (
    <div className={styles.scroller} ref={scrollerRef}>
      {messages.length === 0 ? (
        <div className={styles.irisyEmpty}>
          <span className={styles.irisyEmptyIcon}>✦</span>
          <p className={styles.irisyEmptyText}>
            I can see what&rsquo;s open on the left — ask me to summarize it, save it
            to a note, or search your knowledge base. You won&rsquo;t have to re-explain.
          </p>
        </div>
      ) : (
        messages.map((m) => (
        <div key={m.id} className={`${styles.msg} ${styles[m.role]}`}>
          {m.role === 'assistant' ? (
            <>
              {m.route && (
                <span className={styles.routePill} data-kind={m.route.kind}>
                  {m.route.label}
                </span>
              )}
              {/* ADR-005 §8.6 — the engine's REASONING, streamed live: a
                  collapsible "thinking" trace (see it think), never the answer. */}
              {m.reasoning && m.reasoning.trim() && (
                <details className={styles.reasoning}>
                  <summary>
                    <span className={styles.reasoningGlyph} aria-hidden>
                      {m.id === lastAssistantId && streaming ? '◐' : '✦'}
                    </span>
                    <span>{m.id === lastAssistantId && streaming ? 'Thinking…' : 'Thought process'}</span>
                  </summary>
                  <div className={styles.reasoningBody}>{m.reasoning.trim()}</div>
                </details>
              )}
              {/* ADR-005 §8.6 — the engine's WORK, streamed live: each tool call
                  as a step (running → done/failed), drill-down to raw I/O (§6). */}
              {m.tools && m.tools.length > 0 && (
                <div className={styles.toolSteps}>
                  {m.tools.map((s) => (
                    <details key={s.id} className={styles.toolStep} data-status={s.status}>
                      <summary>
                        <span className={styles.toolGlyph} aria-hidden>
                          {s.status === 'running' ? '◐' : s.status === 'failed' ? '✗' : '✓'}
                        </span>
                        <span className={styles.toolTitle}>{prettyToolTitle(s.title)}</span>
                      </summary>
                      {s.input && (
                        <pre className={styles.toolIo}>
                          <span className={styles.toolIoLabel}>input</span>
                          {s.input}
                        </pre>
                      )}
                      {s.output && (
                        <pre className={styles.toolIo}>
                          <span className={styles.toolIoLabel}>output</span>
                          {s.output}
                        </pre>
                      )}
                    </details>
                  ))}
                </div>
              )}
              {m.content && (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {stripDetectedPart(cleanReplyText(m.content)) ||
                    'Opened in the workspace on the left →'}
                </ReactMarkdown>
              )}
              {/* Keep the working indicator visible for the WHOLE streaming turn,
                  not only before the first token — Irisy emits text segment by
                  segment with tool calls in between, and the user must be able to
                  tell it is still working vs done (bao 2026-07-04). Empty content
                  → "thinking"; mid-output → a trailing "working" row under the
                  text; both animate until the turn ends (streaming flips false). */}
              {m.id === lastAssistantId && streaming ? (
                <div className={styles.thinking} aria-label="Irisy is working">
                  <span>{m.content.trim() ? 'Irisy is working' : 'Irisy is thinking'}</span>
                  <span className={styles.thinkingDots}>
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              ) : (
                !m.content && <ReactMarkdown remarkPlugins={[remarkGfm]}>{'…'}</ReactMarkdown>
              )}
              {/* Content actions belong to a RESULT. A failed turn offers none —
                  copying or saving a partial/erroring reply is not a useful
                  affordance. (ADR-003 frontend § decision-registry v44) */}
              {m.id === lastAssistantId && m.content.trim() && !streaming && !m.failed && (
                <div className={styles.aiChips}>
                  <button
                    type="button"
                    className={styles.aiChip}
                    onClick={() => void copyText(m.content)}
                  >
                    ⧉ Copy
                  </button>
                  <button
                    type="button"
                    className={styles.aiChip}
                    onClick={() => void captureToNotes(m.content)}
                  >
                    ↳ Save to a note
                  </button>
                  <button
                    type="button"
                    className={styles.aiChip}
                    onClick={() => void askKnowledgeBase()}
                  >
                    ⌕ Ask my knowledge base
                  </button>
                </div>
              )}

            </>
          ) : (
            <>
              {m.content}
              {/* Blocks (ADR-005 §8.6.2) — an addressable turn: re-run this input
                  (terminal `!!`). Shown on hover so it never clutters. */}
              {!streaming && (
                <div className={styles.blockActions}>
                  <button
                    type="button"
                    className={styles.blockAction}
                    title="Re-run this message"
                    onClick={() => void send(m.content)}
                  >
                    ↻ Re-run
                  </button>
                  <button
                    type="button"
                    className={styles.blockAction}
                    title="Rewind here and continue in a new direction"
                    onClick={() => forkFromHere(m.id)}
                  >
                    ⑂ Fork from here
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        ))
      )}
      {pendingDecision != null && (
        <DecisionSurface
          fact={pendingDecision.fact}
          queued={decisions.length - 1}
          onResolve={(optionId) => {
            setDecisions((queue) =>
              queue.filter((entry) => entry.fact.id !== pendingDecision.fact.id),
            );
            // Any option that is not a plain dismissal runs the fact's handler,
            // so `retry` and `recover` both lead somewhere instead of only
            // closing the card. (ADR-003 frontend § decision-registry v44)
            if (optionId !== 'dismiss') pendingDecision.recover?.();
          }}
        />
      )}
      {notice != null && <div className={styles.notice}>{notice}</div>}
    </div>
  );

  function PersonaRow(): ReactElement {
    const selected = fcts.find((fct) => fct.ref === selectedFctRef);
    return (
      // Composer owns per-session Use; Library owns creation and availability.
      // The control is an Auto-first OVERRIDE: the chip states what the next turn
      // will use, and the catalogue is only reachable through an explicitly
      // opened, bounded `choice` panel or Library. Enumerating the installed
      // inventory as ordinary chrome is forbidden.
      // (ADR-003 frontend §8.5 v41/v42; ADR-005 irisy §11 v41, §12 v42 U17)
      <>
      {fctChoiceOpen ? (
        <DecisionSurface
          fact={fctChoiceFact(fcts, selectedFctRef)}
          pending={fctSwitching}
          onResolve={(optionId) => {
            if (optionId === FCT_LIBRARY_OPTION) {
              setFctChoiceOpen(false);
              onSidebarSelect('library');
              return;
            }
            const next = fctOptionSelection(optionId);
            setFctChoiceOpen(false);
            // `Keep current` resolves to no selection change at all.
            if (next === undefined) return;
            void selectFct(next ?? '');
          }}
        />
      ) : null}
      <div className={styles.quickRow} role="group" aria-label="FCT and turn action">
        <button
          type="button"
          className={styles.agentModeSelect}
          aria-label="FCT"
          aria-haspopup="dialog"
          aria-expanded={fctChoiceOpen}
          disabled={fctSwitching}
          title={selected?.summary || 'Let Irisy choose the FCT for this turn'}
          onClick={() => setFctChoiceOpen((open) => !open)}
        >
          FCT · {selected ? selected.name : 'Auto'}
        </button>
        <span className={styles.statusGrow} />
        {streaming ? (
          <button
            type="button"
            className={styles.send}
            onClick={stopGeneration}
            title="Stop generating"
            aria-label="Stop generating"
          >
            ■
          </button>
        ) : (
          <button type="submit" className={styles.send} disabled={!input.trim()} aria-label="Send">
            ↑
          </button>
        )}
      </div>
      </>
    );
  }

  // Running version lives on the first line next to the CTRL wordmark — one
  // place, visible at a glance for "is this build fresh" (bao 2026-06-13: was
  // duplicated on the L1 rail alongside a second brand mark; pulled here so
  // the brand appears exactly once and L1 stays a pure icon rail). Runtime
  // version from Tauri in the app; APP_VERSION (live in dev) as the fallback.
  const [version, setVersion] = useState(APP_VERSION);
  const update = useUpdateStatus();
  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
  }, []);
  const updateBusy = update.checking || update.updating;
  const updateDisabled = !update.supported || updateBusy;
  const versionLabel = update.updating
    ? 'Updating…'
    : update.checking
      ? 'Checking…'
      : update.error
        ? 'Update failed'
        : update.available
          ? `${version} ↑`
          : version;
  const versionTitle = !update.supported
    ? `CTRL v${version} · updates are available in the desktop app`
    : update.error
    ? `Update failed: ${update.error}`
    : update.updating
      ? 'Updating CTRL and restarting…'
      : update.available
        ? `Update to CTRL v${update.latestVersion ?? 'latest'}`
        : `CTRL v${version} · click to check for updates`;

  const contextLabel = section === 'library'
    ? 'Library'
    : section === 'settings'
      ? 'Settings'
      : part
        ? part.title ?? part.kind
        : 'Work';

  return (
    <div className={styles.root} data-surface={surface}>
      {/* The window's FIRST LINE (bao 2026-06-13): two first-class names —
          CTRL on the left (the whole app), Irisy on the right (the AI). The
          right segment is the SAME width as the Irisy pane below it, so the
          Irisy name sits directly above its window, a peer of CTRL. */}
      <div className={styles.statusbar} data-tauri-drag-region>
        <div className={styles.statusLeft} data-tauri-drag-region>
          <span className={styles.wordmark} data-tauri-drag-region>
            CTRL
          </span>
          {/* Layer-1 updater entry: background polling exposes availability;
              one click checks, atomically updates, and safely relaunches CTRL.
              (ADR-004 cap § auto-update v10) */}
          <button
            type="button"
            className={styles.statusVersion}
            onClick={() => void update.checkAndUpdate()}
            disabled={updateDisabled}
            data-busy={updateBusy || undefined}
            aria-busy={updateBusy}
            aria-label={versionTitle}
            title={versionTitle}
          >
            <span aria-live="polite">{versionLabel}</span>
            {(update.available || update.error) && !update.updating ? (
              <span
                className={styles.updateIndicator}
                data-error={update.error ? '' : undefined}
                aria-hidden="true"
              />
            ) : null}
          </button>
          <span className={styles.statusSep} data-tauri-drag-region aria-hidden="true" />
          <span className={styles.statusContext} data-tauri-drag-region>
            {contextLabel}
          </span>
        </div>
        <div
          className={styles.statusRight}
          data-tauri-drag-region
          style={isNarrow ? undefined : { width: irisyWidth }}
        >
          <div className={styles.statusActions}>
            {section === 'work' && messages.length > 0 && (
              <>
                <button
                  type="button"
                  className={styles.statusBtn}
                  onClick={copyConversation}
                  title="Copy the whole conversation"
                >
                  Copy
                </button>
                <button
                  type="button"
                  className={styles.statusBtn}
                  onClick={newChat}
                  title="New chat"
                >
                  New
                </button>
              </>
            )}
            {/* Provider configuration lives only in Settings. The send path
                navigates there when no provider is available. */}
            <button
              type="button"
              className={`${styles.statusBtn} ${styles.statusClose}`}
              onClick={onHideLauncher}
              title="Hide CTRL"
              aria-label="Hide CTRL"
            >
              ×
            </button>
          </div>
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key="working"
          className={styles.working}
          layout
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={SPRING}
        >
          {/* Unified layout (bao 2026-06-13): Irisy is ALWAYS the fixed left
              column — even on the home/empty screen. The output bar on the
              right shows Discover / Notes / pack / part, or a welcome +
              capability floor when nothing is open. Narrow screens stack. */}
          {/* ADR-003 §7 `[Tab | L2 | L1 | Irisy]` (bao 2026-06-13): work area
              LEFT (L2 inside, collapsed by default) | L1 rail MIDDLE | Irisy
              ALWAYS pinned far-right (wide + draggable). DOM = visual order. */}
          <div className={`${styles.fourCol} ${isNarrow ? styles.splitVertical : ''}`}>
              <div className={styles.outbar}>
                {section === 'settings' ? (
                  <div className={styles.scenePane}>{workspaceContent}</div>
                ) : section === 'library' ? (
                  <div className={styles.scenePane}>
                    <Discover
                      installed={installedPacks}
                      fcts={fcts}
                      onUseFct={useFctFromLibrary}
                      onFctsChanged={refreshFcts}
                      onUseSelection={useLocalAppSelection}
                    />
                  </div>
                ) : part ? (
                  <div className={styles.partPane}>
                    <div className={styles.partHeader}>
                      <span>{part.title ?? part.kind}</span>
                      <div className={styles.partActions}>
                        {(part.kind === 'markdown' ||
                          part.kind === 'html' ||
                          part.kind === 'code' ||
                          part.kind === 'json') && (
                          <button
                            type="button"
                            className={styles.partAction}
                            data-active={editing}
                            onClick={() => setEditing((value) => !value)}
                            title={editing ? 'Done editing' : 'Edit the source'}
                          >
                            {editing ? 'Done' : '✎ Edit'}
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.partAction}
                          onClick={() => void copyText(part.content)}
                          title="Copy to clipboard"
                        >
                          ⧉ Copy
                        </button>
                        <button
                          type="button"
                          className={styles.partAction}
                          onClick={() => downloadPart(part)}
                          title="Export as a file to share"
                        >
                          ↧ Share
                        </button>
                        <button
                          type="button"
                          className={styles.partClose}
                          onClick={() => {
                            setPart(null);
                            setEditing(false);
                          }}
                          aria-label="Close"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <div className={styles.partBody}>
                      {editing ? (
                        <textarea
                          className={styles.partEditor}
                          value={part.content}
                          onChange={(event) => setPart({ ...part, content: event.target.value })}
                          aria-label="Edit artifact source"
                          spellCheck={false}
                        />
                      ) : (
                        renderPart(part)
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={styles.scenePane}>
                    {settingUp && (
                      <p className={styles.setupHint} role="status">
                        Setting up CTRL… updating your tools.
                      </p>
                    )}
                    {!hasProvider && (
                      <button
                        type="button"
                        className={styles.ctaPrimary}
                        onClick={onOpenProviderSettings}
                      >
                        Connect your AI to start →
                      </button>
                    )}
                    {workResourceRef ? (
                      <ResourceViewerHost resourceRef={workResourceRef} />
                    ) : (
                      // With no Resource open the Work pane showed nothing. The
                      // user's own content and day are better than empty chrome.
                      // (ADR-005 irisy §12 v42 U3/U4/U5/U7)
                      <>
                        <SourcesPanel onOpen={openWorkResource} />
                        <TodayPanel />
                      </>
                    )}
                    <CodingAgentPanel onResourceChange={onCodingResourceChange} />
                    {codingResourceRef && (
                      <ResourceViewerHost resourceRef={codingResourceRef} />
                    )}
                  </div>
                )}
              </div>
            <Sidebar active={section} onSelect={onSidebarSelect} />
            {!isNarrow && (
              <div
                className={styles.divider}
                style={{ right: irisyWidth }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  startIrisyDrag(e.clientX);
                }}
                role="separator"
                aria-label="Resize Irisy column"
              />
            )}
            <div
              className={styles.irisyCol}
              style={isNarrow ? undefined : { width: irisyWidth }}
              aria-label="Persistent agent dialog"
            >
              <div className={styles.chatPane}>
                <SessionTabs />
                {conversation}
                {composer}
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
