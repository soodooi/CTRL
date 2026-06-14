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
import { floorCapabilities, type Capability } from '@/lib/capability-catalog';
import { detectPart, renderPart, type PartSpec } from '@/lib/ui-registry';
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
import { vaultRead, vaultWrite, vaultSearch } from '@/lib/kernel';
import styles from './AmbientHome.module.css';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// Quick hooks — the quicker-style high-frequency actions kept ALWAYS in view
// above the composer (bao 2026-06-12: integrate the functions users reach for
// daily as the traffic-driver that lifts open-frequency past the weekly-habit
// threshold). Curated from the zero-install floor; short labels for the rail.
const QUICK_HOOKS: { id: string; icon: string; label: string }[] = [
  { id: 'tone-translate', icon: '🌐', label: 'Translate' },
  { id: 'draft-polish', icon: '✍️', label: 'Polish' },
  { id: 'summarize', icon: '⊟', label: 'Summarize' },
  { id: 'extract-actions', icon: '✓', label: 'Actions' },
  { id: 'plan', icon: '🗂', label: 'Plan' },
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
}

const SPRING = { type: 'spring', stiffness: 420, damping: 36 } as const;

export function AmbientHome({
  view,
  onView,
  modelLabel,
  onOpenPicker,
  onToggleDrawer,
  toolRequest,
  packRequest,
  openNotesNonce,
  irisyNonce,
  hidden,
  onSidebarSelect,
  activeSection,
}: AmbientHomeProps): ReactElement {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [part, setPart] = useState<PartSpec | null>(null);
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

    try {
      const history: LLMMessage[] = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      let acc = '';
      for await (const chunk of irisyChatTransport().stream(history)) {
        const delta = typeof chunk === 'string' ? chunk : (chunk?.delta ?? '');
        if (!delta) continue;
        acc += delta;
        setMessages((prev) =>
          prev.map((m) => (m.id === asstId ? { ...m, content: acc } : m)),
        );
        requestAnimationFrame(() => {
          scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
        });
      }
      // Morph a renderable part out of the reply if present.
      const detected = detectPart(acc);
      if (detected) setPart(detected);
      // Empty stream usually means no provider is configured yet.
      if (acc.trim().length === 0) {
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
    }
  }, [messages, streaming, hasProvider, onOpenPicker]);

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
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send(input);
          }
        }}
        disabled={streaming}
      />
      <button type="submit" className={styles.send} disabled={streaming || !input.trim()}>
        {streaming ? '···' : '↑'}
      </button>
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
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || '…'}</ReactMarkdown>
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
            <span className={styles.quickIcon}>{h.icon}</span>
            {h.label}
          </button>
        );
      })}
    </div>
  );

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
      {/* Status bar — the window's first line. Left: CTRL wordmark + current
          location. Right: model/connection status + chat actions. Spans the
          window; reads like an editor chrome row (bao 2026-06-13). */}
      <div className={styles.statusbar} data-tauri-drag-region>
        <div className={styles.statusLeft}>
          <span className={styles.wordmark}>CTRL</span>
          <span className={styles.statusSep} aria-hidden="true" />
          <span className={styles.statusContext}>{contextLabel}</span>
        </div>
        <div className={styles.statusRight}>
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
              <span className={styles.statusSep} aria-hidden="true" />
            </>
          )}
          <button
            type="button"
            className={styles.modelChip}
            onClick={onOpenPicker}
            title="Model & providers"
          >
            <span className={styles.modelDot} data-on={hasProvider || undefined} />
            {hasProvider ? modelLabel : 'Connect AI'}
          </button>
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
                      <button
                        type="button"
                        className={styles.partClose}
                        onClick={() => setPart(null)}
                      >
                        ✕
                      </button>
                    </div>
                    <div className={styles.partBody}>{renderPart(part)}</div>
                  </div>
                ) : (
                  <div className={styles.welcome}>
                    <h1 className={styles.greeting}>Hi, I&rsquo;m Irisy.</h1>
                    <p className={styles.subtitle}>
                      Your private AI workspace — it runs on your machine, your data stays yours.
                    </p>
                    {!hasProvider && (
                      <button type="button" className={styles.ctaPrimary} onClick={onOpenPicker}>
                        Connect your AI to start →
                      </button>
                    )}
                    <div className={styles.tryLabel}>Try one of these</div>
                    <div className={styles.floor}>
                      {floorCapabilities()
                        .slice(0, 6)
                        .map((cap) => (
                          <motion.button
                            key={cap.id}
                            type="button"
                            className={styles.card}
                            onClick={() => onPickCapability(cap)}
                            whileHover={{ y: -2 }}
                            transition={SPRING}
                            title={cap.hint}
                          >
                            <span className={styles.cardLabel}>{cap.label}</span>
                            <span className={styles.cardHint}>{cap.hint}</span>
                          </motion.button>
                        ))}
                    </div>
                    <button type="button" className={styles.ctaSecondary} onClick={() => onView('discover')}>
                      Connect your tools →
                    </button>
                  </div>
                )}
              </div>
            <Sidebar
              active={activeSection}
              onSelect={onSidebarSelect}
              modelLabel={modelLabel}
              onModel={onOpenPicker}
            />
            {!isNarrow && (
              <div
                className={styles.divider}
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
                <div className={styles.irisyTag}>
                  <span className={styles.irisyDot} />
                  Irisy
                </div>
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
