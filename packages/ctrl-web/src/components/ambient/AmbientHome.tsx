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

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
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
// ADR-005 irisy § persona-shell v5 (2026-06-09): humanizePiError shared with
// IrisyChat so brain errors surface instead of being swallowed by the stream.
import { cleanReplyText, humanizePiError } from '@/lib/irisy-render-filter';
// Irisy functional roles (ADR-003 §8.6 + ADR-005 v6): the role switcher above
// the chat box. A role = (persona, toolset, knowledge base); switching swaps
// the persona WITHOUT resetting the conversation. Linked to the L1 scene.
import {
  ROLES,
  DEFAULT_ROLE_ID,
  roleById,
  roleForScene,
  roleForPack,
  packsForRole,
  kbScopeAmbient,
  inKbScope,
  type RoleId,
  type Role,
} from '@/lib/roles';
// ADR-005 irisy §8.6 (unified terminal-essence frontend): the shared agent
// ("shell") selector — embedded hermes vs a BYO-CLI driver (Codex / Claude
// Code). ONE component across every surface, backed by the shared active-agent
// store, so the agent axis is consistent everywhere.
import { AgentSelector } from '@/components/agent/AgentSelector';
// ADR-005 irisy §8.4/§8.6 — durable transcript: the ambient conversation
// survives reload / engine crash and re-hydrates.
import { loadTranscript, saveTranscript } from '@/lib/transcript-store';
// ADR-003 frontend §7.6 v2 (IME input, 2026-06-14): shared CJK IME guard.
import { isImeComposing } from '@/lib/ime';
import { type Capability } from '@/lib/capability-catalog';
import {
  detectPart,
  renderPart,
  stripDetectedPart,
  splitStreamingArtifact,
  type PartSpec,
} from '@/lib/ui-registry';
import {
  loadConnectors,
  invokeConnectorTool,
  type ConnectorTool,
  type ConnectorManifest,
} from '@/lib/connector';
import { Discover } from './Discover';
import {
  FeaturePackScene,
  type FeaturePack,
} from '@/components/featurepack/FeaturePackScene';
import {
  runInstalledPackAction,
  loadPackRecords,
  loadInstalledPacks,
  PACKS_CHANGED_EVENT,
} from '@/lib/feature-pack';
import { NotesSurface } from '@/components/notes/NotesSurface';
import { TablesPanel } from '@/components/tables/TablesPanel';
import { TodayView } from '@/components/today/TodayView';
import { CodingTerminal } from '@/components/coding/CodingTerminal';
import { Sidebar, type SidebarSection } from './Sidebar';
import { WorkspacePanel } from './WorkspacePanel';
import {
  vaultRead,
  vaultWrite,
  vaultSearch,
  vaultList,
  resetEngine,
  captureScreenAndOcr,
  csStdin,
  listMcps,
  type IrisySessionTurn,
  type McpSummary,
} from '@/lib/kernel';
import { listSmartTables } from '@/lib/smart-tables';
import { useActiveAgentStore } from '@/lib/active-agent';
import { platform } from '@/lib/bridge';
import { useCodingSession } from '@/lib/coding-session';
import { extractRunnableBlocks } from '@/lib/runnable-blocks';
import { SessionHistory } from './SessionHistory';
import { APP_VERSION } from '@/lib/app-meta';
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

/** First `.md` string value in a tool's input args (the note path), or null. */
function extractNotePath(input?: string): string | null {
  if (!input) return null;
  try {
    const obj = JSON.parse(input) as Record<string, unknown>;
    for (const v of Object.values(obj)) {
      if (typeof v === 'string' && /\.md$/.test(v)) return v;
    }
  } catch {
    /* input isn't a JSON object — no path to surface */
  }
  return null;
}

/** Note files this turn's tool calls WROTE — so the chat can offer a shortcut to
 *  open them in the Notes workspace (ADR-005 §8.6.2 / output-routing: Irisy is the
 *  pipe that routes output into the owning module's workspace). Notes only (not
 *  tables/sheets). */
function noteTargetsOf(tools?: ToolStepView[]): string[] {
  if (!tools) return [];
  const out = new Set<string>();
  for (const t of tools) {
    if (t.status !== 'completed') continue;
    if (!/vault_write|doc_produce|note_/.test(t.title)) continue;
    const p = extractNotePath(t.input);
    if (p && !/\.sheet\.md$/.test(p) && !p.startsWith('tables/')) out.add(p);
  }
  return [...out];
}

/** Slugify a pack/action name into a command token, e.g. "Record a trade" →
 *  "record-a-trade" (ADR-005 §8.6.2 — registry-driven command surface). */
function slugCmd(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'action';
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

// A sidebar tool click, forwarded from the shell. `nonce` makes each
// request a fresh object so the effect runs exactly once per click.
export interface ToolRequest {
  connectorId: string;
  toolName: string;
  nonce: number;
}

// A request to open a feature pack's scene panel alongside Irisy. `nonce`
// makes each open a fresh object so the effect runs once per request.
export interface PackRequest {
  pack: FeaturePack;
  nonce: number;
}

export interface AmbientHomeProps {
  view: 'chat' | 'discover';
  onView: (v: 'chat' | 'discover') => void;
  modelLabel: string;
  /** Active provider slug — feeds Sidebar's semantic 2-letter badge
   *  (decision 0007 §display). Optional only because some test/preview
   *  mounts skip it; production always passes it down from
   *  AmbientWorkbench's useActiveProvider hook. */
  providerId?: string | null;
  onOpenPicker: () => void;
  onToggleDrawer: () => void;
  /** Tool the shell sidebar asked to run (null until a click). */
  toolRequest: ToolRequest | null;
  /** Feature pack to open in the scene panel alongside Irisy (null until a
   *  pack is selected). */
  packRequest: PackRequest | null;
  /** Bumped to open the Today (LifeOS tasks) surface alongside Irisy. */
  openTodayNonce: number;
  /** Bumped to open Notes alongside Irisy (output left, Irisy right). */
  openNotesNonce: number;
  /** Bumped to open the smart-table browser alongside Irisy (same scenePane). */
  openTablesNonce: number;
  /** Bumped to open the coding terminal alongside Irisy (same scenePane). */
  openCodingNonce: number;
  /** Bumped by the shell when "Irisy" is selected, to reset the chat. */
  irisyNonce: number;
  /** Collapsed (display:none) while a route owns the main column. The
   *  component stays MOUNTED so chat state + nonce effects survive route
   *  visits — never unmount it, or the nonce effects replay on remount. */
  hidden: boolean;
  /** L1 rail lives INSIDE the home layout, between the work area and Irisy
   *  (ADR-003 §7 `[Tab | L2 | L1 | Irisy]`). The shell forwards its select
   *  handler + active highlight so the rail drives the same navigation. */
  onSidebarSelect: (s: SidebarSection) => void;
  activeSection: string;
  /** True while the kernel is still seeding builtin mcps on a fresh install
   *  (first_run_state = 'copying'). Surfaces a "Setting up CTRL…" hint so the
   *  empty Tools/Discover lists don't read as broken. ADR-006 § cold-start-loop
   *  §6.1 G3. */
  settingUp?: boolean;
}

const SPRING = { type: 'spring', stiffness: 420, damping: 36 } as const;

export function AmbientHome({
  view,
  onView,
  modelLabel,
  providerId,
  onOpenPicker,
  onToggleDrawer,
  toolRequest,
  packRequest,
  openTodayNonce,
  openNotesNonce,
  openTablesNonce,
  openCodingNonce,
  irisyNonce,
  hidden,
  onSidebarSelect,
  activeSection,
  settingUp = false,
}: AmbientHomeProps): ReactElement {
  const [input, setInput] = useState('');
  // Durable transcript (§8.4): the ambient conversation re-hydrates on load.
  // An empty restore falls through to the greeting; a "new chat" that sets
  // messages back to [] persists [] via the save effect below (clears storage).
  const [messages, setMessages] = useState<Msg[]>(() =>
    loadTranscript<Msg>('ambient', isAmbientMsg),
  );
  useEffect(() => {
    saveTranscript('ambient', messages);
  }, [messages]);
  const [streaming, setStreaming] = useState(false);
  // Abort handle for the in-flight turn so the composer's Stop button can cancel
  // streaming WITHOUT locking the textarea. bao (feedback, repeated): never block
  // input while Irisy is responding — see memory feedback-irisy-never-block-input.
  const abortRef = useRef<AbortController | null>(null);
  // Conversation history drawer (reads hermes session store). bao: Irisy must
  // have a history entry — restores what the AmbientHome rewrite dropped.
  const [showHistory, setShowHistory] = useState(false);
  const [part, setPart] = useState<PartSpec | null>(null);
  const [editing, setEditing] = useState(false);
  // The feature pack shown in the scene panel (right column); Irisy stays in
  // the left column. Independent of `part` (Irisy's own morphed output).
  const [scene, setScene] = useState<FeaturePack | 'today' | 'notes' | 'tables' | 'coding' | null>(
    null,
  );
  // The active Irisy role (ADR-003 §8.6): drives the persona shipped per turn.
  // Shown + switchable in the switcher above the chat box; switching it never
  // touches `messages` (conversation persists). Linked to the L1 scene below.
  const [roleId, setRoleId] = useState<RoleId>(DEFAULT_ROLE_ID);
  // Role switcher is a dropdown (irisy-roles.md sec.3): collapsed it shows the
  // active role; open it lists the role pool. `roleMenuOpen` drives that.
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  // Installed feature packs, shown next to the role dropdown so the role's
  // toolset is visible (bao 2026-06-26: feature packs must show too). The role
  // decides which ones are in scope via packsForRole. Kept in sync on change.
  const [installedPacks, setInstalledPacks] = useState<FeaturePack[]>([]);
  useEffect(() => {
    const load = () => {
      void loadInstalledPacks().then(setInstalledPacks).catch(() => {});
    };
    load();
    window.addEventListener(PACKS_CHANGED_EVENT, load);
    return () => window.removeEventListener(PACKS_CHANGED_EVENT, load);
  }, []);
  // The smart table the user currently has open (lifted from TablesPanel) so
  // Irisy gets it as ambient context — "operate on THIS table" works without
  // the user naming the file. Stable callback so TablesPanel's effect is calm.
  const [activeTablePath, setActiveTablePath] = useState<string | null>(null);
  const onActiveTable = useCallback((p: string | null) => setActiveTablePath(p), []);
  // Coding companion (P0): the resident Irisy reads the live Coding terminal
  // — getRecentStdout is its eyes (ambient context), runInTerminal is its hand
  // (writes an approved command to the PTY via cs_stdin, connection ①).
  const codingStreamId = useCodingSession((s) => s.streamId);
  const getRecentStdout = useCodingSession((s) => s.getRecentStdout);
  const runInTerminal = useCallback((code: string): void => {
    const sid = useCodingSession.getState().streamId;
    if (!sid) return;
    const bytes = new TextEncoder().encode(`${code}\n`);
    let bin = '';
    bytes.forEach((b) => {
      bin += String.fromCharCode(b);
    });
    void csStdin(sid, btoa(bin)).catch(() => undefined);
  }, []);
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
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // ADR-005 §8.6.2 output-routing — note-write tool_call_id → path, so we can
  // auto-open the note the moment its write completes (post review-gate).
  const pendingNoteWrites = useRef<Map<string, string>>(new Map());

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
    setMessages([]);
    setPart(null);
    setScene(null);
    setInput('');
    // ADR-005 §8.4 — the engine's memory must follow the UI: a fresh chat gets a
    // fresh engine session (else it silently carries the old conversation).
    void resetEngine();
  }, []);

  // Load a past hermes session into the conversation view. bao: Irisy must have
  // history. Resetting the engine makes the next turn re-hydrate from THIS loaded
  // transcript (§8.4) rather than continuing the engine's previous context.
  const loadPastSession = useCallback((turns: IrisySessionTurn[], _title: string) => {
    setMessages(
      turns.map((t, i) => ({
        id: `h-${i}`,
        role: t.role === 'assistant' ? 'assistant' : 'user',
        content: t.content,
      })),
    );
    setPart(null);
    setScene(null);
    setShowHistory(false);
    void resetEngine();
  }, []);

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
    void resetEngine();
  }, []);

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

  const surface: Surface =
    part || scene ? 'chat-part' : messages.length > 0 ? 'chat' : 'empty';
  // Gate the first-run CTA on whether any model is wired up yet.
  const hasProvider = modelLabel !== 'Model';

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // ADR-005 irisy § persona-shell v5 (2026-06-09): never block input — if a
    // turn is still streaming, abort it and send the new one (parity with the
    // docked IrisyChat) instead of silently dropping the keystroke.
    abortRef.current?.abort();
    setInput('');
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: trimmed };
    // Readiness gate (bao 2026-06-12: check the env + guide, don't go silent):
    // with no model wired, don't stream into the void — the user would just
    // see a spinner forever if the backend hangs. Irisy speaks up and opens
    // the model picker so it's fixable in one step.
    if (!hasProvider) {
      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content:
            "I don't have a model yet, so I can't reply. I've opened the model picker — pick a provider and paste your key, then ask me again.",
        },
      ]);
      onOpenPicker();
      return;
    }
    const asstId = `a-${Date.now()}`;
    // Show Irisy's read of the intent before the stream starts (ADR-003 §8.2B
    // routing pill; keyword pass, not a model call per §8.2). Transparency, not
    // a backend fork — the turn still streams through the one provider.
    const route = classifyIntent(trimmed);
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: asstId, role: 'assistant', content: '', route },
    ]);
    setStreaming(true);
    setEditing(false);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      // Assemble the per-turn system prompt (persona + SOUL + brain_state) so
      // the model has its identity, guardrails and live provider — without it
      // the home composer leaked internals, monologued, and couldn't name its
      // own model. Shared with IrisyChat via composeSystemPrompt.
      // The active role chooses the persona (ADR-005 v6). The default role keeps
      // its vault override (a user-edited irisy-system.md still wins); other
      // roles supply their persona verbatim. SOUL.md is appended either way.
      const role = roleById(roleId);
      // Persona = the active ROLE's persona (bao 2026-07-03: only TWO personas
      // — personal assistant + coding; a feature pack does NOT carry its own
      // persona, it composes ON TOP of the assistant via its kb + on-demand
      // skills + tools. roleForPack lands an unknown pack on the assistant, so
      // "stocks = assistant + stock pack" falls out naturally).
      const baseOverride = roleId === DEFAULT_ROLE_ID ? undefined : role.persona;
      const [base, brain, allMcps] = await Promise.all([
        loadIrisySystemPromptWithSoul(baseOverride),
        loadBrainState(),
        // listMcps fails in browser-only dev (no kernel) — degrade to no packs.
        listMcps().catch(() => [] as McpSummary[]),
      ]);
      // toolset (ADR-003 §8.6): the role decides which installed packs Irisy
      // sees this turn (empty toolset = all; otherwise a whitelist).
      const roleMcps = packsForRole(role, allMcps);
      // Ambient context: if a smart table is open, tell Irisy which file it is
      // so "filter / sort / AI-fill / add a row to THIS table" resolves to a
      // path without the user naming it (the smart_table.* gate tools need it).
      const ambient: LLMMessage[] = [];
      // Dedicated KB (bao 2026-06-25): an open feature pack's knowledge_base wins
      // (e.g. ghostfolio -> Stocks/), else the role's kbScope. null = whole vault.
      const activeScope =
        scene && typeof scene === 'object' && scene.kbDir ? scene.kbDir : role.kbScope;
      const kb = kbScopeAmbient(activeScope);
      if (kb) ambient.push({ role: 'system', content: kb });
      // Domain skills pointer (bao 2026-07-03: skills load ON DEMAND — inject
      // one line telling Irisy WHERE this pack's skills live, never their
      // contents; it skill_list/skill_read only when the task matches).
      if (scene && typeof scene === 'object' && scene.kbDir) {
        ambient.push({
          role: 'system',
          content:
            `This pack's domain skills live under "${scene.kbDir}/skills" in the vault. ` +
            `When a task matches a skill's territory, load it on demand with skill_list / ` +
            `skill_read (or vault_read on that path) — do not recite skills unprompted.`,
        });
      }
      if (scene === 'tables' && activeTablePath) {
        if (activeTablePath.toLowerCase().endsWith('.sheet.md')) {
          ambient.push({
            role: 'system',
            content:
              `Ambient context: the user is viewing the Univer spreadsheet at "${activeTablePath}" ` +
              `(an Excel-style free grid with 400+ formulas, stored as a workbook snapshot in the .sheet.md body). ` +
              `When they refer to "this sheet" / a cell / a formula, act on that file; it is NOT a smart-table, ` +
              `so smart_table.* tools do not apply — read/edit it via the vault tools on that path.`,
          });
        } else {
          ambient.push({
            role: 'system',
            content:
              `Ambient context: the user is viewing the smart table at "${activeTablePath}". ` +
              `It may have SAVED VIEWS (each a lens = filter + sort + group); before acting on "this view" or ` +
              `a filtered subset, query the table through the gate to see its current rows + view state rather ` +
              `than assuming. When they ask to filter / sort / group / AI-fill a column / add a row / edit ` +
              `"this table" (or refer to it without naming a file), call the smart_table.* gate tools with path="${activeTablePath}".`,
          });
        }
      }
      // Coding companion (A1/A2 eyes + B0/C1/C2): when the Coding terminal is
      // open, Irisy can SEE its recent output and should propose shell commands
      // as fenced bash blocks — each gets a one-click "Run in terminal" button
      // the user approves (B0: propose → approve → run; never auto-run).
      if (scene === 'coding' && codingStreamId) {
        const recent = (getRecentStdout?.() ?? '').slice(-2000);
        ambient.push({
          role: 'system',
          content:
            `The user is in the Coding terminal and you are their coding companion. ` +
            `You can SEE its recent output below. Help debug errors, explain output, and ` +
            `PROPOSE shell commands as fenced \`\`\`bash blocks — each gets a one-click ` +
            `"Run in terminal" button the user approves; you never auto-run. To install ` +
            `Claude Code, prefer the China mirror: ` +
            `npm i -g @anthropic-ai/claude-code --registry=https://registry.npmmirror.com\n\n` +
            `Recent terminal output:\n\`\`\`\n${recent}\n\`\`\``,
        });
      }
      const history: LLMMessage[] = [
        {
          role: 'system',
          content: composeSystemPrompt({
            base,
            brainState: brain,
            // Only inject the mcp list when the role actually exposes packs —
            // an empty list would render a "none yet" section every turn.
            ...(roleMcps.length > 0 ? { mcps: roleMcps } : {}),
          }),
        },
        ...ambient,
        ...[...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ];
      let acc = '';
      // ADR-005 irisy § persona-shell v5 (2026-06-09): the transport does not
      // throw — brain timeout / crash / no-auth arrive as a chunk carrying
      // `error`. Surface it (parity with IrisyChat) instead of `continue`-ing
      // past it, which froze the bubble or misreported "No AI provider".
      let streamError = false;
      for await (const chunk of engineTransport().stream(history, { signal: ctrl.signal })) {
        if (typeof chunk !== 'string' && chunk?.error) {
          if (chunk.error === 'aborted') break;
          const { summary } = humanizePiError(String(chunk.error), modelLabel);
          setMessages((prev) =>
            prev.map((m) => (m.id === asstId ? { ...m, content: summary } : m)),
          );
          streamError = true;
          break;
        }
        // ADR-005 §8.6 — a tool step the engine streamed: fold it into THIS
        // turn's step list so the user sees Irisy's work live (drill-down §6).
        if (typeof chunk !== 'string' && chunk?.tool) {
          const step = chunk.tool;
          // ADR-005 §8.6.2 output-routing — AUTO-open a note Irisy writes (no
          // manual click): remember the path on the `call`, and the moment the
          // write COMPLETES (post-approval), route the workspace to that note.
          if (step.phase === 'call' && /vault_write|doc_produce|note_/.test(step.title)) {
            const p = extractNotePath(step.input);
            if (p && !/\.sheet\.md$/.test(p) && !p.startsWith('tables/')) {
              pendingNoteWrites.current.set(step.tool_call_id, p);
            }
          }
          if (step.phase === 'result') {
            const p = pendingNoteWrites.current.get(step.tool_call_id);
            if (p) {
              pendingNoteWrites.current.delete(step.tool_call_id);
              // Only when the write actually landed (approved, not denied/failed).
              const denied = /denied|declined|not approved|rejected/i.test(step.output ?? '');
              if (step.status !== 'failed' && !denied) openNoteInWorkspace(p);
            }
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstId ? { ...m, tools: applyToolStep(m.tools, step) } : m,
            ),
          );
          requestAnimationFrame(() => {
            scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
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
          scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
        });
      }
      // Finalize: refine the part from the complete reply (e.g. json -> table).
      const detected = detectPart(acc);
      if (detected) setPart(detected);
      // Empty stream usually means no provider is configured yet — but NOT when
      // the user hit Stop (aborted on purpose), so guard on the abort signal.
      if (acc.trim().length === 0 && !ctrl.signal.aborted && !streamError) {
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
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = /provider|no provider|unreachable|configured/i.test(msg)
        ? 'No AI provider is set up yet. Open Settings -> Providers to add one.'
        : `Error: ${msg}`;
      setMessages((prev) =>
        prev.map((m) => (m.id === asstId ? { ...m, content: friendly } : m)),
      );
    } finally {
      // ADR-005 irisy § persona-shell v5 (2026-06-09): only the currently-active
      // turn clears streaming — a superseded (interrupt-redirected) turn must not
      // flip it off or null the new turn's controller under it.
      if (abortRef.current === ctrl) {
        setStreaming(false);
        abortRef.current = null;
      }
    }
  }, [messages, streaming, hasProvider, onOpenPicker, scene, roleId, activeTablePath, codingStreamId, getRecentStdout]);

  // Stop the in-flight turn (composer Stop button / Esc). Aborts the transport's
  // stream; the textarea stays editable throughout so the user never loses input.
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  // ADR-005 §8.6.2 output-routing — open a note Irisy just wrote in the Notes
  // workspace: switch the scene, then best-effort nudge the notes UI (NotesApp /
  // the Tolaria embed both listen for `notes:open`) to the exact note.
  const openNoteInWorkspace = useCallback((path: string) => {
    setScene('notes');
    void import('@tauri-apps/api/event')
      .then(({ emit }) =>
        new Promise((r) => setTimeout(r, 180)).then(() =>
          emit('notes:open', { path, heading: null }),
        ),
      )
      .catch(() => {
        /* browser PWA (no Tauri) — the scene switch alone lands in Notes */
      });
  }, []);

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
      // kbScope (bao 2026-06-25): keep each role's knowledge base relatively
      // independent — search wide, then drop hits outside the active role's
      // scope (null scope = whole vault, so nothing is dropped).
      const role = roleById(roleId);
      // Same dedicated-KB resolution as handleSend: pack's kb wins, else role's.
      const activeScope =
        scene && typeof scene === 'object' && scene.kbDir ? scene.kbDir : role.kbScope;
      const hits = (await vaultSearch(q, 20)).filter((p) => inKbScope(activeScope, p));
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
  }, [messages, send, roleId, scene]);

  const onPickCapability = useCallback((cap: Capability) => {
    setInput(cap.starter ?? `${cap.label}: `);
    inputRef.current?.focus();
  }, []);

  // Run a screenshot OCR: the kernel drives the interactive region capture +
  // on-device Vision recognition, and the recognized text lands in the composer
  // so the user can act on it (ask, translate, save). Only the desktop app can
  // capture the screen — in the browser, fall back to the prompt pre-fill.
  const runScreenshotOcr = useCallback(async () => {
    if (platform() !== 'tauri') {
      setInput('Extract the text from this image:\n\n');
      inputRef.current?.focus();
      setNotice('Screenshot OCR needs the desktop app — paste an image instead.');
      return;
    }
    setNotice('Select a region to capture…');
    try {
      const { text, cancelled } = await captureScreenAndOcr();
      if (cancelled) {
        setNotice(null);
        return;
      }
      if (!text.trim()) {
        setNotice('No text found in that capture.');
        return;
      }
      setInput(text);
      inputRef.current?.focus();
      setNotice(`Captured ${text.length} characters`);
    } catch (e) {
      setNotice(e instanceof Error ? `Capture failed: ${e.message}` : 'Capture failed.');
    }
  }, []);

  // What a workspace-panel card (or its number key) runs. Native utilities like
  // screenshot OCR do real work; everything else pre-fills the composer.
  const runWorkspaceAction = useCallback(
    (cap: Capability) => {
      if (cap.id === 'screenshot-ocr') {
        void runScreenshotOcr();
        return;
      }
      onPickCapability(cap);
    },
    [onPickCapability, runScreenshotOcr],
  );

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

  // Run a connector tool — real HTTP call (or mock) -> morph to a
  // table/record on the surface. Invoked from the sidebar's "Your tools".
  const runConnectorTool = useCallback(
    async (manifest: ConnectorManifest, tool: ConnectorTool) => {
      if (streaming) return;
      setStreaming(true);
      try {
        const out = await invokeConnectorTool(manifest, tool.name);
        const content = JSON.stringify(out.result);
        const kind = Array.isArray(out.result) ? 'table' : 'record';
        setMessages((prev) => [
          ...prev,
          { id: `u-${Date.now()}`, role: 'user', content: `${manifest.title}: ${tool.title ?? tool.name}` },
          { id: `a-${Date.now()}`, role: 'assistant', content: `Here is **${tool.title ?? tool.name}** from ${manifest.title}.` },
        ]);
        setPart({ kind, content, title: `${manifest.title} · ${tool.title ?? tool.name}` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [
          ...prev,
          { id: `u-${Date.now()}`, role: 'user', content: `${manifest.title}: ${tool.name}` },
          { id: `a-${Date.now()}`, role: 'assistant', content: `Could not reach ${manifest.title}: ${msg}` },
        ]);
      } finally {
        setStreaming(false);
      }
    },
    [streaming],
  );

  // Run the tool the shell sidebar requested. Keyed on the request object
  // (fresh per click) via a ref so a streaming toggle never re-fires it.
  const runToolRef = useRef(runConnectorTool);
  runToolRef.current = runConnectorTool;
  useEffect(() => {
    if (!toolRequest) return;
    const m = loadConnectors().find((c) => c.id === toolRequest.connectorId);
    const t = m?.tools.find((x) => x.name === toolRequest.toolName);
    if (m && t) void runToolRef.current(m, t);
  }, [toolRequest]);

  // Open the requested feature pack in the scene panel (Irisy stays alongside
  // in the left column). Keyed on the fresh request object per selection.
  useEffect(() => {
    if (packRequest) setScene(packRequest.pack);
  }, [packRequest]);

  // Open the Today (LifeOS tasks) surface alongside Irisy when sidebar asks.
  useEffect(() => {
    if (openTodayNonce > 0) setScene('today');
  }, [openTodayNonce]);
  // Open Notes alongside Irisy (output left, Irisy right) when sidebar asks.
  useEffect(() => {
    if (openNotesNonce > 0) setScene('notes');
  }, [openNotesNonce]);
  useEffect(() => {
    if (openTablesNonce > 0) setScene('tables');
  }, [openTablesNonce]);
  useEffect(() => {
    if (openCodingNonce > 0) setScene('coding');
  }, [openCodingNonce]);

  // L1 ↔ role linkage (ADR-003 §8.6 lock 5): opening an L1 scene auto-selects
  // its linked role (Notes/Tables -> Knowledge Base, Coding -> Code Companion).
  // A scene with no linked role leaves the user's manual choice untouched.
  // Switching the role here does NOT clear `messages` — conversation persists.
  useEffect(() => {
    let linked: RoleId | null = null;
    if (scene === 'notes' || scene === 'tables' || scene === 'coding') {
      linked = roleForScene(scene);
    } else if (scene && typeof scene === 'object') {
      // A feature pack opened in the scene panel -> switch to the role that
      // can use it (bao 2026-06-25: opening a pack switches the role).
      linked = roleForPack(scene.id);
    }
    if (linked) setRoleId(linked);
  }, [scene]);

  // Reset the chat when the shell selects "Irisy" (nonce bump). Since this
  // component stays mounted across routes (hidden, not unmounted), the
  // effect fires only on a real bump — never replays on a route return.
  useEffect(() => {
    // Selecting Irisy in L1 returns to the conversation view (close any open
    // scene / part panel) but must NOT wipe history — Irisy is the persistent
    // pipe and "Irisy must have history" (ADR-003 §8 / ADR-005 irisy). Clearing
    // is the dedicated New-chat button's job. (bao 2026-06-21: switching L1 back
    // to Irisy was clearing the chat — over-eager newChat.)
    if (irisyNonce > 0) {
      setScene(null);
      setPart(null);
    }
  }, [irisyNonce]);

  // ADR-005 §8.6.2 terminal command surface — `/` slash menu + ↑/↓ history recall.
  const [slashSel, setSlashSel] = useState(0);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  // `:` jump — go to a module workspace (Notes / Tables / Coding / Today / chat).
  const [jumpSel, setJumpSel] = useState(0);
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
  // Status line data — engine + model + state (ADR-005 §8.6.2 ambient chrome).
  const activeAgentId = useActiveAgentStore((s) => s.activeAgentId);
  const drivers = useActiveAgentStore((s) => s.drivers);
  const engineLabel = drivers.find((d) => d.id === activeAgentId)?.label ?? 'Hermes';
  // Run an installed pack's action inline; its output lands as an assistant turn.
  const runPackAction = (pack: FeaturePack, action: { id: string; name: string }): void => {
    const id = `a-${Date.now()}`;
    setMessages((prev) => [...prev, { id, role: 'assistant', content: `Running ${action.name}…` }]);
    void runInstalledPackAction(pack.id, action.id)
      .then((out) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, content: out.trim() || `${action.name} done.` } : m)),
        ),
      )
      .catch((e: unknown) =>
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  content: `Could not run ${action.name}: ${e instanceof Error ? e.message : String(e)}`,
                }
              : m,
          ),
        ),
      );
  };
  // ADR-005 §8.6.2 — the command surface is a MECHANISM; its entries come from the
  // REGISTRY (installed / created / shared / downloaded feature packs), NOT a
  // hardcoded capability list. Core ships only the generic /new; every installed
  // pack contributes its actions automatically (download a pack → its actions
  // appear here, zero code). Irisy's inline abilities (summarize/plan/translate)
  // are NOT commands — you just ask (philosophy #5, AI-is-a-pipe).
  const slashCommands: SlashCommand[] = [
    { cmd: '/new', label: 'New conversation', run: newChat },
    ...installedPacks.flatMap((p) =>
      p.actions.map((a) => ({
        cmd: `/${slugCmd(a.name)}`,
        label: `${a.name} · ${p.name}`,
        run: () => runPackAction(p, a),
      })),
    ),
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
  // `:` jump-to-module (a terminal go-to). Whole-input token, like the slash menu.
  const jumpTargets: { cmd: string; label: string; go: () => void }[] = [
    // Core module workspaces (the platform's own faces).
    { cmd: ':chat', label: 'Conversation', go: () => setScene(null) },
    { cmd: ':notes', label: 'Notes', go: () => setScene('notes') },
    { cmd: ':tables', label: 'Tables', go: () => setScene('tables') },
    { cmd: ':coding', label: 'Coding', go: () => setScene('coding') },
    { cmd: ':today', label: 'Today', go: () => setScene('today') },
    // Installed feature packs are jumpable too (registry-driven, ADR-005 §8.6.2).
    ...installedPacks.map((p) => ({
      cmd: `:${slugCmd(p.name)}`,
      label: p.name,
      go: () => setScene(p),
    })),
  ];
  const jumpQuery = input.startsWith(':') && !/\s/.test(input) ? input.toLowerCase() : null;
  const jumpMatches = jumpQuery ? jumpTargets.filter((j) => j.cmd.startsWith(jumpQuery)) : [];
  const jumpOpen = jumpMatches.length > 0;
  const jumpActive = Math.min(jumpSel, Math.max(0, jumpMatches.length - 1));
  const applyJump = (j: { go: () => void }): void => {
    setInput('');
    setJumpSel(0);
    j.go();
  };
  // `@`-mention: the trailing `@word` at the caret (never when another menu is up).
  const mentionMatch = !slashOpen && !jumpOpen ? input.match(/@([^\s@]*)$/) : null;
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
      {/* Status line — engine · model · state · version (ADR-005 §8.6.2 chrome). */}
      <div className={styles.statusLine}>
        <span className={styles.statusItem}>
          <span className={styles.statusDot} data-state={streaming ? 'working' : 'ready'} />
          {streaming ? 'Working' : 'Ready'}
        </span>
        <span className={styles.statusSep}>·</span>
        <span className={styles.statusItem}>{engineLabel}</span>
        <span className={styles.statusSep}>·</span>
        <span className={styles.statusItem}>{modelLabel}</span>
        <span className={styles.statusGrow} />
        <span className={styles.statusItem}>v{APP_VERSION}</span>
      </div>
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
      {/* `:` jump menu — go to a module workspace (ADR-005 §8.6.2). */}
      {jumpOpen && (
        <div className={styles.slashMenu} role="listbox">
          {jumpMatches.map((j, i) => (
            <button
              type="button"
              key={j.cmd}
              className={styles.slashItem}
              data-sel={i === jumpActive ? 'yes' : 'no'}
              onMouseEnter={() => setJumpSel(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                applyJump(j);
              }}
            >
              <span className={styles.slashCmd}>{j.cmd}</span>
              <span className={styles.slashLabel}>{j.label}</span>
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
      <textarea
        ref={inputRef}
        className={styles.input}
        value={input}
        rows={1}
        placeholder="Ask Irisy, or pick something above…"
        onChange={(e) => {
          setInput(e.target.value);
          setHistIdx(null);
          setSlashSel(0);
          setMentionSel(0);
          setJumpSel(0);
          autoGrow();
        }}
        onKeyDown={(e) => {
          if (isImeComposing(e)) return;
          // `:` jump menu navigation (ADR-005 §8.6.2).
          if (jumpOpen) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setJumpSel((s) => (s + 1) % jumpMatches.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setJumpSel((s) => (s - 1 + jumpMatches.length) % jumpMatches.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              const chosen = jumpMatches[jumpActive];
              if (chosen) applyJump(chosen);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setInput('');
              return;
            }
          }
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
        <button type="submit" className={styles.send} disabled={!input.trim()}>
          ↑
        </button>
      )}
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
              {/* ADR-005 §8.6.2 output-routing — a shortcut to open a note Irisy
                  just wrote in the Notes workspace (bao: slash worked but no jump
                  to the note page). */}
              {noteTargetsOf(m.tools).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={styles.openNoteChip}
                  onClick={() => openNoteInWorkspace(p)}
                >
                  <span aria-hidden>📄</span>
                  <span className={styles.openNoteName}>{p.split('/').pop()}</span>
                  <span className={styles.openNoteGo}>Open in Notes →</span>
                </button>
              ))}
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
              {m.id === lastAssistantId && m.content.trim() && !streaming && (
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
              {codingStreamId && m.content
                ? (() => {
                    const blocks = extractRunnableBlocks(m.content);
                    if (blocks.length === 0) return null;
                    return (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          marginTop: 8,
                        }}
                      >
                        {blocks.map((b, bi) => (
                          <div
                            key={bi}
                            style={{
                              border: '1px solid var(--color-border, #2a2a2a)',
                              borderRadius: 8,
                              overflow: 'hidden',
                            }}
                          >
                            <pre
                              style={{
                                margin: 0,
                                padding: '8px 10px',
                                fontSize: 12,
                                overflowX: 'auto',
                                whiteSpace: 'pre',
                                background: 'rgba(0,0,0,0.25)',
                              }}
                            >
                              {b.code}
                            </pre>
                            <button
                              type="button"
                              onClick={() => runInTerminal(b.code)}
                              style={{
                                display: 'block',
                                width: '100%',
                                padding: '6px 10px',
                                border: 'none',
                                borderTop: '1px solid var(--color-border, #2a2a2a)',
                                background: 'transparent',
                                color: 'var(--color-primary, #7aa2ff)',
                                cursor: 'pointer',
                                fontSize: 12,
                                textAlign: 'left',
                              }}
                            >
                              ▶ Run in terminal
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })()
                : null}
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
      {notice != null && <div className={styles.notice}>{notice}</div>}
    </div>
  );

  // The persona switcher sits directly above the composer (bao 2026-06-26): the
  // row above the chat box IS the persona picker. Translate / polish / summarize
  // used to live here — but those are things Irisy does inline (just ask); they
  // ARE Irisy, not separate personas (philosophy #5), so they don't belong here.
  // Switching a persona swaps the system prompt WITHOUT resetting the
  // conversation; one brand voice stays (ADR-005 single-brand lock).
  const activeRole = roleById(roleId);
  // Above the composer shows TWO things bound to the current L1 (bao 2026-06-26):
  // (1) the persona (dropdown) and (2) the feature pack(s) of the L1 in scope.
  // The packs follow the open scene — NOT all-installed (would pin ghostfolio
  // everywhere) and NOT the role's toolset whitelist (would hide ghostfolio
  // even on the Stocks L1, since Stocks = KB-assistant + ghostfolio is a config,
  // not a role). When an L1 opens a pack (Stocks -> ghostfolio) scene IS that
  // pack, so it shows; a built-in scene (coding) falls back to that role's
  // installed toolset packs; plain home/notes shows none.
  // One scene = one pack (bao 2026-07-03: a pack IS the scenario; no hardcoded
  // same-category aggregation). The open pack scene shows exactly that pack;
  // a built-in scene falls back to the role's toolset packs.
  const contextPacks: FeaturePack[] =
    scene && typeof scene === 'object'
      ? [scene]
      : activeRole.toolset.length === 0
      ? []
      : installedPacks.filter((p) => activeRole.toolset.includes(p.id));
  const personaRow = (
    // Order (bao 2026-06-28): agent FIRST, then persona, then feature packs.
    <div className={styles.quickRow} role="group" aria-label="Irisy agent, persona, and feature packs">
      <AgentSelector />
      <div className={styles.roleSwitch}>
        <button
          type="button"
          className={styles.roleChip}
          aria-haspopup="menu"
          aria-expanded={roleMenuOpen}
          onClick={() => setRoleMenuOpen((o) => !o)}
          title={activeRole.hint}
        >
          <span className={styles.modelDot} data-on />
          <span className={styles.roleChipLabel}>{activeRole.label}</span>
          <span className={styles.roleCaret}>▾</span>
        </button>
        {roleMenuOpen && (
          <>
            <div
              className={styles.roleBackdrop}
              onClick={() => setRoleMenuOpen(false)}
            />
            <div className={styles.roleMenu} role="menu">
              {ROLES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={r.id === roleId}
                  className={`${styles.roleItem} ${
                    r.id === roleId ? styles.roleItemActive : ''
                  }`}
                  onClick={() => {
                    setRoleId(r.id);
                    setRoleMenuOpen(false);
                  }}
                >
                  <span className={styles.roleItemLabel}>{r.label}</span>
                  <span className={styles.roleItemHint}>{r.hint}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {contextPacks.length > 0 && (
        <div className={styles.packChips} aria-label="Feature packs for this L1">
          {contextPacks.map((p) => (
            <button
              key={p.id}
              type="button"
              className={styles.packChip}
              onClick={() => setScene(p)}
              title={p.summary ?? p.name}
            >
              {p.icon ? <span className={styles.packIcon}>{p.icon}</span> : null}
              <span className={styles.packChipLabel}>{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // Running version lives on the first line next to the CTRL wordmark — one
  // place, visible at a glance for "is this build fresh" (bao 2026-06-13: was
  // duplicated on the L1 rail alongside a second brand mark; pulled here so
  // the brand appears exactly once and L1 stays a pure icon rail). Runtime
  // version from Tauri in the app; APP_VERSION (live in dev) as the fallback.
  const [version, setVersion] = useState(APP_VERSION);
  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
  }, []);

  const contextLabel =
    view === 'discover'
      ? 'Discover'
      : scene === 'today'
      ? 'Today'
      : scene === 'notes'
      ? 'Notes'
      : scene === 'tables'
      ? 'Smart Tables'
      : scene === 'coding'
      ? 'Coding'
      : scene
      ? scene.name
      : part
      ? part.title ?? part.kind
      : 'Home';

  return (
    <div className={styles.root} data-surface={surface} hidden={hidden}>
      <SessionHistory
        open={showHistory}
        onClose={() => setShowHistory(false)}
        onSelect={loadPastSession}
      />
      {/* The window's FIRST LINE (bao 2026-06-13): two first-class names —
          CTRL on the left (the whole app), Irisy on the right (the AI). The
          right segment is the SAME width as the Irisy pane below it, so the
          Irisy name sits directly above its window, a peer of CTRL. */}
      <div className={styles.statusbar} data-tauri-drag-region>
        <div className={styles.statusLeft} data-tauri-drag-region>
          <span className={styles.wordmark} data-tauri-drag-region>
            CTRL
          </span>
          <span
            className={styles.statusVersion}
            data-tauri-drag-region
            title={`CTRL v${version}`}
          >
            {version}
          </span>
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
          <span className={styles.irisyName} data-tauri-drag-region>
            <span className={styles.irisyDot} data-on={hasProvider || undefined} />
            Irisy
          </span>
          <div className={styles.statusActions}>
            {/* Persona switcher moved above the composer (bao 2026-06-26) —
                see `personaRow`. The status bar keeps only chrome actions. */}
            <button
              type="button"
              className={styles.statusBtn}
              onClick={() => setShowHistory(true)}
              title="Conversation history"
              aria-label="Conversation history"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
                <path d="M12 7v5l3 2" />
              </svg>
            </button>
            {view === 'chat' && messages.length > 0 && (
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
            {/* Right-corner provider/model picker REMOVED (bao, repeated): it
                duplicated the L1-bound agent/persona pickers in `personaRow`
                above the composer. Provider choice follows the L1 selection
                there; this corner pill was redundant. onOpenPicker still fires
                programmatically when no provider is connected (send path). */}
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
                {view === 'discover' ? (
                  <div className={styles.scenePane}>
                    <button
                      type="button"
                      className={styles.sceneClose}
                      onClick={() => onView('chat')}
                      aria-label="Close Discover"
                    >
                      ✕
                    </button>
                    <Discover onInstalled={() => onView('discover')} styles={styles} />
                  </div>
                ) : scene === 'today' ? (
                  <div className={styles.scenePane}>
                    <button
                      type="button"
                      className={styles.sceneClose}
                      onClick={() => setScene(null)}
                      aria-label="Close Today"
                    >
                      ✕
                    </button>
                    <TodayView />
                  </div>
                ) : scene === 'notes' ? (
                  <div className={styles.scenePane}>
                    <button
                      type="button"
                      className={styles.sceneClose}
                      onClick={() => setScene(null)}
                      aria-label="Close Notes"
                    >
                      ✕
                    </button>
                    <NotesSurface />
                  </div>
                ) : scene === 'tables' ? (
                  <div className={styles.scenePane}>
                    <button
                      type="button"
                      className={styles.sceneClose}
                      onClick={() => setScene(null)}
                      aria-label="Close Tables"
                    >
                      ✕
                    </button>
                    <TablesPanel onActiveTable={onActiveTable} />
                  </div>
                ) : scene === 'coding' ? (
                  <div className={styles.scenePane}>
                    <button
                      type="button"
                      className={styles.sceneClose}
                      onClick={() => setScene(null)}
                      aria-label="Close Coding"
                    >
                      ✕
                    </button>
                    <CodingTerminal />
                  </div>
                ) : scene ? (
                  <div className={styles.scenePane}>
                    <button
                      type="button"
                      className={styles.sceneClose}
                      onClick={() => setScene(null)}
                      aria-label="Close pack"
                    >
                      ✕
                    </button>
                    <FeaturePackScene
                      // Key by pack id so switching packs fully resets scene
                      // state (no stale records flash before the refetch).
                      key={scene.id}
                      pack={scene}
                      onRunAction={(id) => runInstalledPackAction(scene.id, id)}
                      loadRecords={
                        scene.hasRecords ? () => loadPackRecords(scene.id) : undefined
                      }
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
                            onClick={() => setEditing((v) => !v)}
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
                          className={styles.partAction}
                          onClick={() => void captureToNotes(part.content)}
                          title="Save to Notes"
                        >
                          ↳ Save
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
                          onChange={(e) => setPart({ ...part, content: e.target.value })}
                          aria-label="Edit artifact source"
                          spellCheck={false}
                        />
                      ) : (
                        renderPart(part)
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={styles.welcome}>
                    <h1 className={styles.greeting}>Hi, I&rsquo;m Irisy.</h1>
                    {settingUp && (
                      <p className={styles.setupHint} role="status">
                        Setting up CTRL… installing your tools.
                      </p>
                    )}
                    {!hasProvider && (
                      <button type="button" className={styles.ctaPrimary} onClick={onOpenPicker}>
                        Connect your AI to start →
                      </button>
                    )}
                    <WorkspacePanel
                      onRun={runWorkspaceAction}
                      onConnectTools={() => onView('discover')}
                    />
                  </div>
                )}
              </div>
            <Sidebar
              active={activeSection}
              onSelect={onSidebarSelect}
              modelLabel={modelLabel}
              providerId={providerId}
              onModel={onOpenPicker}
            />
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
            >
              <div className={styles.chatPane}>
                {conversation}
                {personaRow}
                {composer}
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
