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
import { Group, Panel, Separator } from 'react-resizable-panels';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { irisyChatTransport, type LLMMessage } from '@/lib/llm-transport';
import { floorCapabilities, type Capability } from '@/lib/capability-catalog';
import { detectPart, renderPart, partLayout, type PartSpec } from '@/lib/ui-registry';
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
import styles from './AmbientHome.module.css';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
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
}: AmbientHomeProps): ReactElement {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [part, setPart] = useState<PartSpec | null>(null);
  // The feature pack shown in the scene panel (right column); Irisy stays in
  // the left column. Independent of `part` (Irisy's own morphed output).
  const [scene, setScene] = useState<FeaturePack | 'notes' | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
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

  const surface: Surface =
    part || scene ? 'chat-part' : messages.length > 0 ? 'chat' : 'empty';
  // Right-column width: scene panels sit a touch wider than text parts.
  const rightRatio = scene === 'notes' ? 0.62 : scene ? 0.52 : part ? partLayout(part.kind).preferredRatio : 0.42;
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

  const onPickCapability = useCallback((cap: Capability) => {
    setInput(cap.starter ?? `${cap.label}: `);
    inputRef.current?.focus();
  }, []);

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

  const conversation = (
    <div className={styles.scroller} ref={scrollerRef}>
      {messages.map((m) => (
        <div key={m.id} className={`${styles.msg} ${styles[m.role]}`}>
          {m.role === 'assistant' ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || '…'}</ReactMarkdown>
          ) : (
            m.content
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className={styles.root} data-surface={surface} hidden={hidden}>
      <div className={styles.topbar} data-tauri-drag-region>
        <button
          type="button"
          className={styles.menuBtn}
          onClick={onToggleDrawer}
          title="Menu"
          aria-label="Menu"
        >
          ☰
        </button>
        <span className={styles.brand}>Irisy</span>
        <div className={styles.topActions}>
          {view === 'chat' && messages.length > 0 && (
            <button type="button" className={styles.topBtn} onClick={newChat} title="New chat">
              New
            </button>
          )}
        </div>
      </div>
      {view === 'discover' && (
        <Discover onInstalled={() => onView('discover')} styles={styles} />
      )}
      <AnimatePresence mode="wait">
        {view === 'chat' && (surface === 'empty' ? (
          <motion.div
            key="empty"
            className={styles.empty}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={SPRING}
          >
            <h1 className={styles.greeting}>Hi, I&rsquo;m Irisy.</h1>
            <p className={styles.subtitle}>
              Your private AI workspace — it runs on your machine, your data stays yours.
            </p>

            {/* Non-blocking nudge: the chat may already answer via the
                managed fallback route, so never hide the composer — just
                invite connecting a BYOK model when none is set as primary. */}
            {!hasProvider && (
              <button type="button" className={styles.ctaPrimary} onClick={onOpenPicker}>
                Connect your AI to start →
              </button>
            )}
            {composer}
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
          </motion.div>
        ) : (
          <motion.div
            key="working"
            className={styles.working}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={SPRING}
          >
            {part || scene ? (
              <Group
                key={isNarrow ? 'v' : 'h'}
                orientation={isNarrow ? 'vertical' : 'horizontal'}
                className={styles.split}
              >
                {/* Output / scene LEFT (F-pattern focus), Irisy chat RIGHT —
                    ergonomics (bao 2026-06-12). */}
                <Panel defaultSize={rightRatio * 100} minSize={24}>
                  {scene === 'notes' ? (
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
                  ) : (
                    part && (
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
                    )
                  )}
                </Panel>
                <Separator className={styles.handle} />
                <Panel defaultSize={(1 - rightRatio) * 100} minSize={28}>
                  <div className={styles.chatPane}>
                    {conversation}
                    {composer}
                  </div>
                </Panel>
              </Group>
            ) : (
              <div className={styles.chatPaneCentered}>
                {conversation}
                {composer}
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
