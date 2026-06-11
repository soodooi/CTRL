// AmbientHome — the morphing conversation surface (ADR-003 §8 v6).
//
// One ambient surface that morphs between three states via a CSS
// grid-template-areas state machine + Framer Motion layout animation:
//   empty       — centered greeting + big composer + capability floor
//   chat        — conversation + composer
//   chat-part   — conversation | part panel (resizable), when a turn
//                 produces a renderable UI part (html/code/...).
//
// Low-barrier for general users (bao 2026-06-11): the empty state SHOWS
// concrete clickable capabilities (the floor) instead of a blank box;
// the conversation is the flexible ceiling. Real chat via the existing
// irisyChatTransport — no new backend. Parts render through the flexible
// UI registry (lib/ui-registry) so the agent / user / content-type can
// invoke any UI piece on demand.

import { useCallback, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { Group, Panel, Separator } from 'react-resizable-panels';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { irisyChatTransport, type LLMMessage } from '@/lib/llm-transport';
import { floorCapabilities, type Capability } from '@/lib/capability-catalog';
import { detectPart, renderPart, partLayout, type PartSpec } from '@/lib/ui-registry';
import { loadConnectors, invokeConnectorTool, type ConnectorTool, type ConnectorManifest } from '@/lib/connector';
import styles from './AmbientHome.module.css';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

type Surface = 'empty' | 'chat' | 'chat-part';

const SPRING = { type: 'spring', stiffness: 420, damping: 36 } as const;

export function AmbientHome(): ReactElement {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [part, setPart] = useState<PartSpec | null>(null);
  const [routePill, setRoutePill] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const newChat = useCallback(() => {
    setMessages([]);
    setPart(null);
    setRoutePill(null);
    setInput('');
  }, []);

  // Auto-grow the composer to its content (cheap, works in every webview).
  const autoGrow = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const surface: Surface = part ? 'chat-part' : messages.length > 0 ? 'chat' : 'empty';

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setInput('');
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: trimmed };
    const asstId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, userMsg, { id: asstId, role: 'assistant', content: '' }]);
    setStreaming(true);

    // Lightweight intent pill (transparent routing — the agent-driven
    // version lands with the capability router). Heuristic for now.
    const lower = trimmed.toLowerCase();
    setRoutePill(
      /\b(html|page|poster|web|site)\b/.test(lower)
        ? 'Building'
        : /\b(code|refactor|bug|function)\b/.test(lower)
          ? 'Coding'
          : 'Answering',
    );

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
  }, [messages, streaming]);

  const onPickCapability = useCallback((cap: Capability) => {
    setInput(cap.starter ?? `${cap.label}: `);
    inputRef.current?.focus();
  }, []);

  // Connected systems (spec §0.5) — each connector tool is a clickable
  // card; click -> real HTTP call (or mock) -> morph to a table/record.
  const connectors = loadConnectors();
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
        setRoutePill(manifest.title);
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
    <div className={styles.root} data-surface={surface}>
      <div className={styles.topbar} data-tauri-drag-region>
        <span className={styles.brand}>Irisy</span>
        <div className={styles.topActions}>
          {messages.length > 0 && (
            <button type="button" className={styles.topBtn} onClick={newChat} title="New chat">
              New
            </button>
          )}
          <button
            type="button"
            className={styles.topBtn}
            onClick={() => void navigate({ to: '/settings/providers' })}
            title="Settings"
          >
            Settings
          </button>
        </div>
      </div>
      <AnimatePresence mode="wait">
        {surface === 'empty' ? (
          <motion.div
            key="empty"
            className={styles.empty}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={SPRING}
          >
            <h1 className={styles.greeting}>Hi, I&rsquo;m Irisy.</h1>
            <p className={styles.subtitle}>What do you want to do?</p>
            {composer}
            <div className={styles.floor}>
              {floorCapabilities()
                .slice(0, 8)
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
            {connectors.length > 0 && (
              <div className={styles.systems}>
                <div className={styles.systemsLabel}>Connected systems</div>
                <div className={styles.floor}>
                  {connectors.flatMap((m) =>
                    m.tools.map((t) => (
                      <motion.button
                        key={`${m.id}.${t.name}`}
                        type="button"
                        className={styles.card}
                        onClick={() => void runConnectorTool(m, t)}
                        whileHover={{ y: -2 }}
                        transition={SPRING}
                        title={t.description ?? t.name}
                      >
                        <span className={styles.cardLabel}>{t.title ?? t.name}</span>
                        <span className={styles.cardHint}>{m.title}</span>
                      </motion.button>
                    )),
                  )}
                </div>
              </div>
            )}
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
            {part ? (
              <Group orientation="horizontal" className={styles.split}>
                <Panel defaultSize={(1 - partLayout(part.kind).preferredRatio) * 100} minSize={28}>
                  <div className={styles.chatPane}>
                    {routePill && <div className={styles.pill}>{`-> ${routePill}`}</div>}
                    {conversation}
                    {composer}
                  </div>
                </Panel>
                <Separator className={styles.handle} />
                <Panel defaultSize={partLayout(part.kind).preferredRatio * 100} minSize={24}>
                  <div className={styles.partPane}>
                    <div className={styles.partHeader}>
                      <span>{part.title ?? part.kind}</span>
                      <button type="button" className={styles.partClose} onClick={() => setPart(null)}>
                        ✕
                      </button>
                    </div>
                    <div className={styles.partBody}>{renderPart(part)}</div>
                  </div>
                </Panel>
              </Group>
            ) : (
              <div className={styles.chatPaneCentered}>
                {routePill && <div className={styles.pill}>{`-> ${routePill}`}</div>}
                {conversation}
                {composer}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
