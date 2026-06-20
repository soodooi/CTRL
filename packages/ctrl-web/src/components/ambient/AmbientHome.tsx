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
import { irisyChatTransport, type LLMMessage } from '@/lib/llm-transport';
// Reply-correctness wiring (parity with the docked IrisyChat): the home
// composer must ship the persona + brain_state system prompt and filter the
// reply, or it leaks internals / monologues / can't name its model.
import {
  composeSystemPrompt,
  loadIrisySystemPromptWithSoul,
  loadBrainState,
} from '@/lib/irisy-prompts';
import { cleanReplyText } from '@/lib/irisy-render-filter';
// ADR-003 frontend §7.6 v2 (IME input, 2026-06-14): shared CJK IME guard.
import { isImeComposing } from '@/lib/ime';
import { floorCapabilities, type Capability } from '@/lib/capability-catalog';
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
import { runInstalledPackAction } from '@/lib/feature-pack';
import { NotesApp } from '@/components/notes/NotesApp';
import { Sidebar, type SidebarSection } from './Sidebar';
import { WorkspacePanel } from './WorkspacePanel';
import {
  vaultRead,
  vaultWrite,
  vaultSearch,
  captureScreenAndOcr,
  type IrisySessionTurn,
} from '@/lib/kernel';
import { platform } from '@/lib/bridge';
import { SessionHistory } from './SessionHistory';
import { APP_VERSION } from '@/lib/app-meta';
import { getVersion } from '@tauri-apps/api/app';
import styles from './AmbientHome.module.css';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// Action shortcuts above the composer (vault/ctrl/strategy/0009). Minimal by
// design (bao 2026-06-13, "ui minimal"): plain-text, no icons / no chip
// borders, <=3 shown, the long tail behind one "More". These are accelerators
// for high-frequency intents — the user can always just type instead. The set
// is curated for now; the ambient-ranked / material-aware version lands with
// the 0007 work (Irisy reads the work area to surface what fits the moment).
const QUICK_HOOKS: { id: string; label: string }[] = [
  { id: 'tone-translate', label: 'Translate' },
  { id: 'draft-polish', label: 'Polish' },
  { id: 'summarize', label: 'Summarize' },
];

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
  /** Bumped to open Notes alongside Irisy (output left, Irisy right). */
  openNotesNonce: number;
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
  openNotesNonce,
  irisyNonce,
  hidden,
  onSidebarSelect,
  activeSection,
  settingUp = false,
}: AmbientHomeProps): ReactElement {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
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
  const [scene, setScene] = useState<FeaturePack | 'notes' | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  // Irisy column width — a fixed default the user can drag via the divider
  // between Irisy and the output bar (bao 2026-06-13). Window resizing keeps
  // this width (the output bar absorbs the change); only dragging changes it.
  const [irisyWidth, setIrisyWidth] = useState(480);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

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
  }, []);

  // Load a past hermes session into the conversation view (read-only). bao:
  // Irisy must have history. New chat / sending clears the "viewing past" flag.
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
        const next = Math.max(300, Math.min(640, startW - (ev.clientX - startX)));
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
    if (!trimmed || streaming) return;
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
    setMessages((prev) => [...prev, userMsg, { id: asstId, role: 'assistant', content: '' }]);
    setStreaming(true);
    setEditing(false);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      // Assemble the per-turn system prompt (persona + SOUL + brain_state) so
      // the model has its identity, guardrails and live provider — without it
      // the home composer leaked internals, monologued, and couldn't name its
      // own model. Shared with IrisyChat via composeSystemPrompt.
      const [base, brain] = await Promise.all([
        loadIrisySystemPromptWithSoul(),
        loadBrainState(),
      ]);
      const history: LLMMessage[] = [
        { role: 'system', content: composeSystemPrompt({ base, brainState: brain }) },
        ...[...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ];
      let acc = '';
      for await (const chunk of irisyChatTransport().stream(history, { signal: ctrl.signal })) {
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
      if (acc.trim().length === 0 && !ctrl.signal.aborted) {
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
      setStreaming(false);
      abortRef.current = null;
    }
  }, [messages, streaming, hasProvider, onOpenPicker]);

  // Stop the in-flight turn (composer Stop button / Esc). Aborts the transport's
  // stream; the textarea stays editable throughout so the user never loses input.
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
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
      body = entry.body;
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
      const hits = await vaultSearch(q, 5);
      const parts: string[] = [];
      for (const p of hits.slice(0, 3)) {
        try {
          const entry = await vaultRead(p);
          parts.push(`# ${p}\n${entry.body.slice(0, 700)}`);
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

  // Open Notes alongside Irisy (output left, Irisy right) when sidebar asks.
  useEffect(() => {
    if (openNotesNonce > 0) setScene('notes');
  }, [openNotesNonce]);

  // Reset the chat when the shell selects "Irisy" (nonce bump). Since this
  // component stays mounted across routes (hidden, not unmounted), the
  // effect fires only on a real bump — never replays on a route return.
  useEffect(() => {
    if (irisyNonce > 0) newChat();
  }, [irisyNonce, newChat]);

  const composer = (
    <form
      className={styles.composer}
      onSubmit={(e) => {
        e.preventDefault();
        void send(input);
      }}
    >
      <textarea
        ref={inputRef}
        className={styles.input}
        value={input}
        rows={1}
        placeholder="Ask Irisy, or pick something above…"
        onChange={(e) => {
          setInput(e.target.value);
          autoGrow();
        }}
        onKeyDown={(e) => {
          if (isImeComposing(e)) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
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
              {m.content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {stripDetectedPart(cleanReplyText(m.content)) ||
                    'Opened in the workspace on the left →'}
                </ReactMarkdown>
              ) : m.id === lastAssistantId && streaming ? (
                <div className={styles.thinking} aria-label="Irisy is thinking">
                  <span>Irisy is thinking</span>
                  <span className={styles.thinkingDots}>
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{'…'}</ReactMarkdown>
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
            </>
          ) : (
            m.content
          )}
        </div>
        ))
      )}
      {notice != null && <div className={styles.notice}>{notice}</div>}
    </div>
  );

  // Always-in-view quicker-style hooks above the composer — the daily
  // high-frequency actions that pull a user back to open CTRL (bao 2026-06-12).
  const floorCaps = floorCapabilities();
  const quickRow = (
    <div className={styles.quickRow}>
      {QUICK_HOOKS.map((h) => {
        const cap = floorCaps.find((c) => c.id === h.id);
        if (!cap) return null;
        return (
          <button
            key={h.id}
            type="button"
            className={styles.quickChip}
            onClick={() => onPickCapability(cap)}
            title={cap.hint}
          >
            {h.label}
          </button>
        );
      })}
      <button
        type="button"
        className={styles.quickMore}
        onClick={() => onView('discover')}
        title="More actions — browse or add feature packs"
      >
        More
      </button>
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
      : scene === 'notes'
      ? 'Notes'
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
            <button
              type="button"
              className={styles.modelMini}
              onClick={onOpenPicker}
              title={hasProvider ? `Model: ${modelLabel}` : 'Connect a model'}
            >
              {hasProvider ? modelLabel : 'Connect'}
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
                    <NotesApp />
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
                      pack={scene}
                      onRunAction={(id) => runInstalledPackAction(scene.id, id)}
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
                {quickRow}
                {composer}
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
