// CodingArtifactPane — ADR-002 substrate § brain v16 (2026-06-07).
//
// Left half of the Coding L1 tab. Shows files Pi has Write/Edit'd in the
// `coding-default` Pi session. v15 wired Pi-default coding mode (no Irisy
// persona) but kept the single-pane chat UX, which left code dumped inline
// in the chat bubble (bao 2026-06-07 ask: split layout, code on the left,
// chat as the coding role on the right). This component is the "left" —
// paired with `<IrisyChat forceMode="coding" />` on the right by
// `routes/coding.tsx`.
//
// Data source — Pi `getMessages` RPC. Pi auto-persists every assistant
// message + tool call + tool result to a jsonl session file; we re-fetch
// the full message list after each chat done event and project the
// Write/Edit tool calls into a list of files. No filesystem watcher, no
// kernel side-channel — Pi is the SSOT (memory `feedback_pi_is_core_use_
// upstream_surfaces`).
//
// Polling cadence — listen to the `chat-stream-delta` Tauri event
// (already broadcast by `commands::irisy_chat::irisy_chat_stream`); when
// a delta arrives with `done: true`, schedule a refetch on the next tick
// so Pi has time to flush the final assistant message + tool results
// into its jsonl before we read it back via `getMessages`.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { invoke } from '@/lib/bridge';
import { listen } from '@tauri-apps/api/event';
import styles from './CodingArtifactPane.module.css';

/** One file Pi has written or edited in this Coding session, in the
 *  order Pi emitted the tool call. The latest write of the same path
 *  overwrites the earlier entry (path is the de-dup key). */
interface ArtifactFile {
  path: string;
  content: string;
  /** Tool name as Pi reported it — kept for future ui hints (e.g.
   *  distinguishing first-write from in-place edit). */
  tool: 'Write' | 'Edit';
}

/** Minimal projection of Pi's `getMessages()` return shape. Pi's
 *  AssistantMessage `content` is an array of typed blocks; the entries
 *  we care about are tool calls (`type === 'toolCall'` per pi-agent-core
 *  `types.d.ts` `AgentToolCall = Extract<AssistantMessage["content"]
 *  [number], { type: "toolCall" }>`). We intentionally type the rest
 *  as `unknown` so a future pi-coding-agent bump that adds new block
 *  kinds doesn't break this projection. */
interface PiToolCallBlock {
  type: 'toolCall';
  toolName: string;
  args?: Record<string, unknown>;
}

interface PiMessage {
  role?: string;
  content?: unknown;
}

function isToolCallBlock(v: unknown): v is PiToolCallBlock {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { type?: unknown }).type === 'toolCall' &&
    typeof (v as { toolName?: unknown }).toolName === 'string'
  );
}

/** Walk Pi's transcript and project the latest Write/Edit call for each
 *  unique path. Iteration is forward so later edits overwrite earlier
 *  writes — matches what the user sees if they opened the file in vim
 *  after Pi finished. */
function extractArtifacts(messages: PiMessage[]): ArtifactFile[] {
  const byPath = new Map<string, ArtifactFile>();
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isToolCallBlock(block)) continue;
      const tool = block.toolName;
      if (tool !== 'Write' && tool !== 'Edit') continue;
      const args = block.args ?? {};
      // Pi's builtin Write tool param shape: { file_path, content }
      // (verified against ~/.ctrl/pi/node_modules/@mariozechner/
      // pi-coding-agent/dist/builtin/tools/write.js). Edit uses
      // { file_path, old_string, new_string, replace_all? } — for
      // Edit we render the new_string as the "content" so the user
      // sees what landed in the file (full file body requires a
      // follow-up Read tool call which Pi may not have done).
      const filePath = typeof args.file_path === 'string' ? args.file_path : null;
      if (!filePath) continue;
      let body: string;
      if (tool === 'Write') {
        body = typeof args.content === 'string' ? args.content : '';
      } else {
        const newStr = typeof args.new_string === 'string' ? args.new_string : '';
        const oldStr = typeof args.old_string === 'string' ? args.old_string : '';
        body =
          `// Edit applied (old to new). Open the file on disk for full body.\n` +
          `// --- old ---\n${oldStr}\n// --- new ---\n${newStr}\n`;
      }
      byPath.set(filePath, { path: filePath, content: body, tool });
    }
  }
  return [...byPath.values()];
}

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

export function CodingArtifactPane(): ReactElement {
  const [files, setFiles] = useState<ArtifactFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Refetch generation counter — bumped on each chat-done so the
  // useEffect picks it up; debounced via setTimeout so a burst of `done`
  // events (cap mode, slash command, etc.) collapses to one Pi RPC.
  const [refetchTick, setRefetchTick] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ADR-002 substrate § brain v16: subscribe to the kernel's chat-stream
  // event broadcast. We can't pull events from the IrisyChat component
  // (it's a sibling, not a parent) but Tauri events are pub/sub — every
  // delta passes through the global emitter regardless of which
  // listener consumed it for chat rendering.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const fn = await listen<{
          request_id?: string;
          done?: boolean;
          error?: string;
        }>('chat-stream-delta', (evt) => {
          if (cancelled) return;
          const payload = evt.payload ?? {};
          if (payload.done !== true) return;
          // Debounce — Pi sometimes emits done in quick succession
          // (e.g. slash command path with no LLM turn). One Pi RPC per
          // burst is enough; we let it settle 250 ms then refetch.
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            setRefetchTick((n) => n + 1);
          }, 250);
        });
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      } catch (err) {
        // listen() can fail when running outside Tauri (browser PWA in
        // dev). Surface the error once but don't crash — pane stays in
        // empty state.
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Fetch Pi messages on mount + on every chat done. We don't
  // `switchSession` to coding-default here — IrisyChat's first prompt
  // does that via PiBridge.ensureModeSession. If the user hasn't sent
  // a prompt yet, getMessages returns the messages for whichever
  // session is currently active (typically Irisy's), which won't have
  // any Coding artifacts. extractArtifacts returns [] in that case
  // and the empty state renders — correct behavior.
  //
  // After IrisyChat fires its first coding prompt and the done event
  // arrives, the refetch loops pulls coding-default's messages and the
  // pane populates. Future v17 work: explicitly switchSession on tab
  // mount so artifacts appear even before the first prompt.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const messages = (await invoke<PiMessage[]>('pi_rpc', {
          method: 'getMessages',
          args: [],
        })) ?? [];
        if (cancelled) return;
        const next = extractArtifacts(messages);
        setFiles(next);
        // Preserve the active tab across refetches when the same path
        // still exists; otherwise fall back to the most recent file.
        // ADR-002 substrate § brain v16 — strict noUncheckedIndexedAccess
        // surfaces `next[i]` as `T | undefined`; extract + narrow first.
        const last = next.length > 0 ? next[next.length - 1] : null;
        setActivePath((prev) => {
          if (prev && next.some((f) => f.path === prev)) return prev;
          return last ? last.path : null;
        });
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refetchTick]);

  const activeFile = useMemo(
    () => files.find((f) => f.path === activePath) ?? null,
    [files, activePath],
  );

  const handleTabClick = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  return (
    <div className={styles.pane}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>artifacts · pi writes land here</span>
        <span className={styles.headerCount}>{files.length}</span>
      </div>
      {files.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>no files yet</span>
          <span className={styles.emptyHint}>
            {error
              ? `(${error})`
              : 'Ask the chat on the right to write or edit a file. Pi has Read / Write / Edit / Bash / Grep / Find / LS — anything it Write/Edits shows up here.'}
          </span>
        </div>
      ) : (
        <>
          <div className={styles.tabs} role="tablist">
            {files.map((f) => (
              <button
                key={f.path}
                role="tab"
                type="button"
                aria-selected={f.path === activePath}
                className={`${styles.tab} ${f.path === activePath ? styles.tabActive : ''}`}
                title={f.path}
                onClick={() => handleTabClick(f.path)}
              >
                {basename(f.path)}
              </button>
            ))}
          </div>
          <div className={styles.viewer}>
            {activeFile ? activeFile.content : ''}
          </div>
        </>
      )}
    </div>
  );
}
