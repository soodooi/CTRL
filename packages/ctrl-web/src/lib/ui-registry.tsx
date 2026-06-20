// UI part registry — flexible, on-demand invocation of UI components
// (bao 2026-06-11: the surface must let various UI parts be invoked
// flexibly, incl. business-system data — CRM/ERP records + tables).
//
// ADR-003 §8 v6 + ADR-006 §5: the morphing surface assembles UI PARTS on
// demand. Three callers invoke the same registry: the user (clicks a
// capability card), the agent (emits "render <kind> with <props>" via a
// tool/MCP call — CTRL MCP manifests are already components-as-tool-
// schemas), and content-type routing (output type -> part). Business
// systems (CRM / ERP, connected as local MCP servers, ADR-006 §5) return
// rows/records that render here as table/record parts — system data shows
// up right in the conversation, no foreign app embed (local-is-truth).
//
// Grounded in the generative-UI research: keep our own component registry
// (Camp A), do NOT adopt a hosted GenUI SDK.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';

/** Discriminant for a renderable part. Open set — extend as parts grow. */
export type PartKind =
  | 'html'
  | 'markdown'
  | 'code'
  | 'json'
  | 'table' // rows of records (CRM contacts, ERP inventory/orders)
  | 'record' // a single record's fields (one CRM/ERP entity)
  | 'mermaid' // diagrams / flowcharts / simple charts
  | 'text';

export interface PartSpec {
  kind: PartKind;
  /** Raw payload (HTML/markdown/code string, or JSON for table/record). */
  content: string;
  /** Optional label for the part header / artifact chip. */
  title?: string;
  /** Code language hint (kind === 'code'). */
  language?: string;
}

/** Layout intent per part kind — content drives panel sizing (research:
 *  "content-aware panel sizing"). Consumed by the morph layer. */
export interface PartLayout {
  preferredRatio: number;
  wide: boolean;
}

const LAYOUT: Record<PartKind, PartLayout> = {
  html: { preferredRatio: 0.5, wide: true },
  markdown: { preferredRatio: 0.42, wide: false },
  code: { preferredRatio: 0.46, wide: true },
  json: { preferredRatio: 0.42, wide: false },
  table: { preferredRatio: 0.55, wide: true },
  record: { preferredRatio: 0.4, wide: false },
  mermaid: { preferredRatio: 0.5, wide: true },
  text: { preferredRatio: 0.4, wide: false },
};

export function partLayout(kind: PartKind): PartLayout {
  return LAYOUT[kind] ?? LAYOUT.text;
}

// ── individual part renderers ─────────────────────────────────────────

function MermaidPart({ source }: { source: string }): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
    mermaid
      .render(`m-${Math.abs(hashCode(source))}`, source)
      .then(({ svg }) => {
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [source]);
  if (err) return <pre className="part-code">{`Diagram error: ${err}\n\n${source}`}</pre>;
  return <div className="part-mermaid" ref={ref} />;
}

function DataTable({ rows }: { rows: Array<Record<string, unknown>> }): ReactElement {
  if (rows.length === 0) return <div className="part-text">No rows.</div>;
  const cols = Array.from(
    rows.reduce<Set<string>>((set, r) => {
      Object.keys(r).forEach((k) => set.add(k));
      return set;
    }, new Set()),
  );
  return (
    <div className="part-table-wrap">
      <table className="part-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>{formatCell(r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordCard({ record }: { record: Record<string, unknown> }): ReactElement {
  return (
    <dl className="part-record">
      {Object.entries(record).map(([k, v]) => (
        <div key={k} className="part-record-row">
          <dt>{k}</dt>
          <dd>{formatCell(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/** Render a part. The registry — one place that maps kind -> component. */
export function renderPart(spec: PartSpec): ReactElement {
  switch (spec.kind) {
    case 'html':
      return (
        <iframe
          title={spec.title ?? 'preview'}
          srcDoc={spec.content}
          sandbox="allow-scripts"
          style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
        />
      );
    case 'markdown':
      return (
        <div className="part-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{spec.content}</ReactMarkdown>
        </div>
      );
    case 'mermaid':
      return <MermaidPart source={spec.content} />;
    case 'table': {
      const rows = safeJson<Array<Record<string, unknown>>>(spec.content, []);
      return <DataTable rows={Array.isArray(rows) ? rows : []} />;
    }
    case 'record': {
      const rec = safeJson<Record<string, unknown>>(spec.content, {});
      return <RecordCard record={rec} />;
    }
    case 'json':
      return <pre className="part-code">{prettyJson(spec.content)}</pre>;
    case 'code':
      return (
        <pre className="part-code">
          <code>{spec.content}</code>
        </pre>
      );
    case 'text':
    default:
      return <div className="part-text">{spec.content}</div>;
  }
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Heuristic: detect whether an assistant reply carries a renderable part
 *  worth morphing out of the conversation (vs inline text). First cut:
 *  fenced blocks. The agent declares this explicitly via tool/MCP calls
 *  later (incl. business-system data from CRM/ERP MCPs); this keeps the
 *  prototype real today. JSON array -> table, JSON object -> record. */
// Detect whether a reply carries a self-contained artifact that belongs in the
// workspace pane rather than the chat bubble. DETERMINISTIC by design (ADR-003
// frontend § morphing-conversation v6): routing keys off an explicit signal the
// MODEL emits — a fenced block or a raw HTML page — never a client-side guess
// from text length. This mirrors how Claude Artifacts / OpenAI Canvas work: the
// model decides (it is told to fence documents/pages/code in the persona) and
// the client routes on that signal.
export function detectPart(reply: string): PartSpec | null {
  // Markdown documents legitimately contain nested ``` code blocks, so a
  // ```markdown / ```md fence is matched GREEDILY to the LAST closing fence —
  // a non-greedy match would truncate the doc at its first inner code block.
  // (renderPart's existing markdown case renders it; no new renderer.)
  const md = reply.match(/```(?:markdown|md)[^\n]*\n([\s\S]*)\n```/);
  if (md) {
    const mdBody = (md[1] ?? '').trim();
    if (mdBody) {
      const title = (mdBody.match(/^#{1,6}\s+(.+?)\s*$/m)?.[1] ?? 'document').slice(0, 60);
      return { kind: 'markdown', content: mdBody, title };
    }
  }

  const fence = reply.match(/```(\w+)?\n([\s\S]*?)```/);
  if (fence) {
    const lang = (fence[1] ?? '').toLowerCase();
    const body = (fence[2] ?? '').trim();
    if (lang === 'html') return { kind: 'html', content: body, title: 'preview.html' };
    if (lang === 'mermaid') return { kind: 'mermaid', content: body, title: 'diagram' };
    if (lang === 'json') {
      try {
        const parsed: unknown = JSON.parse(body);
        if (Array.isArray(parsed) && parsed.every((r) => r && typeof r === 'object')) {
          return { kind: 'table', content: body, title: 'data' };
        }
        if (parsed && typeof parsed === 'object') {
          return { kind: 'record', content: body, title: 'record' };
        }
      } catch {
        // fall through to code rendering for malformed json
      }
      return { kind: 'json', content: body, title: 'data.json' };
    }
    if (lang && lang !== 'text') {
      return { kind: 'code', content: body, language: lang, title: `snippet.${lang}` };
    }
    return null;
  }

  // Raw HTML page the model emitted directly (a deterministic signal too).
  const trimmed = reply.trim();
  if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return { kind: 'html', content: trimmed, title: 'preview.html' };
  }

  return null;
}

/** Remove the artifact block detectPart promotes to the workspace pane, so the
 *  chat bubble shows only the surrounding prose (the model's one-line intro) —
 *  no duplicated wall of text. Zero persistence: re-derived from the stored
 *  reply at render time, so it survives reload. Returns '' when the whole reply
 *  was the artifact. */
export function stripDetectedPart(reply: string): string {
  const part = detectPart(reply);
  if (!part) return reply;
  // Markdown docs use the greedy block (nested fences); mirror detectPart so the
  // WHOLE doc is removed from the chat, not just its first fragment.
  if (part.kind === 'markdown') {
    const md = reply.match(/```(?:markdown|md)[^\n]*\n[\s\S]*\n```/);
    if (md) return reply.replace(md[0], '').replace(/\n{3,}/g, '\n\n').trim();
  }
  const fence = reply.match(/```(\w+)?\n[\s\S]*?```/);
  if (fence) {
    return reply.replace(fence[0], '').replace(/\n{3,}/g, '\n\n').trim();
  }
  // Raw HTML page: the entire reply is the artifact.
  return '';
}
