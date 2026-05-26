// Viewer registry — the workspace's content-rendering surface.
//
// Three dimensions per the architecture review (decided 2026-05-25):
//   - location: vault | keycap | system  (where the resource lives)
//   - editable: boolean                  (can the viewer write back?)
//   - companion: string?                 (sidecar URI, e.g. PDF + .pdf.md)
//
// MIME alone doesn't pick the viewer — `text/markdown` from a vault note
// is editable + persisted to the vault; the same MIME from a keycap
// prompt is editable + persisted as a Config-tier patch; from a system
// log it's read-only. Same Tiptap viewer, three save handlers.
//
// All viewer modules are loaded lazily so the critical-path PWA bundle
// stays under the mobile 200KB cap. A viewer enters the bundle the first
// time its content-type appears in a workspace tab.
//
// VMark compatibility: per ADR-001 amendment (2026-05-25), CTRL uses the
// same open-source stack VMark uses (Tiptap, CodeMirror, mermaid) — no
// runtime dependency on the VMark.app process. A user can switch between
// VMark and CTRL editing the same vault file because both speak plain
// markdown + the same lib semantics.

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export type ViewerLocation = 'vault' | 'keycap' | 'system';

/**
 * The thing a viewer renders. `uri` is the primary handle; `companion`
 * is the sidecar (e.g. `file.pdf` paired with `file.pdf.md` for text
 * search + Irisy citation).
 */
export interface ViewerResource {
  location: ViewerLocation;
  contentType: string;
  uri: string;
  companion?: string;
  editable: boolean;
  /**
   * Called when the viewer commits an edit. Required when `editable` is
   * true; ignored otherwise. The viewer passes back the full new content;
   * the handler is responsible for routing it (vault write / keycap
   * patch / etc). When omitted, the viewer's default save handler
   * dispatches by URI scheme (vault:// → vault_write).
   */
  onSave?: (content: string) => Promise<void>;
}

export interface ViewerProps {
  resource: ViewerResource;
}

export type ViewerComponent = ComponentType<ViewerProps>;
type LazyViewer = LazyExoticComponent<ViewerComponent>;

const FallbackViewer = lazy(() =>
  import('@/components/viewers/Fallback').then((m) => ({
    default: m.FallbackViewer,
  })),
);

// ───── Real viewers ──────────────────────────────────────────────────────
// Each line is its own dynamic import → its own chunk → its own lazy
// load. Adding a viewer should never require touching critical-path
// code.

const MarkdownViewer = lazy(() =>
  import('@/components/viewers/MarkdownViewer').then((m) => ({
    default: m.MarkdownViewer,
  })),
);

const CodeViewer = lazy(() =>
  import('@/components/viewers/CodeViewer').then((m) => ({
    default: m.CodeViewer,
  })),
);

const MermaidViewer = lazy(() =>
  import('@/components/viewers/MermaidViewer').then((m) => ({
    default: m.MermaidViewer,
  })),
);

const HtmlViewer = lazy(() =>
  import('@/components/viewers/HtmlViewer').then((m) => ({
    default: m.HtmlViewer,
  })),
);

const ImageViewer = lazy(() =>
  import('@/components/viewers/ImageViewer').then((m) => ({
    default: m.ImageViewer,
  })),
);

const PdfViewer = lazy(() =>
  import('@/components/viewers/PdfViewer').then((m) => ({
    default: m.PdfViewer,
  })),
);

const SmartTableViewer = lazy(() =>
  import('@/components/viewers/SmartTableViewer').then((m) => ({
    default: m.SmartTableViewer,
  })),
);

/**
 * Content-type → lazy viewer. New viewers register themselves by adding
 * a row here + the module under `src/components/viewers/`.
 *
 * Mappings are intentionally exact (no wildcards) — when a caller hands
 * us a never-before-seen MIME we fall through to FallbackViewer rather
 * than silently apply the wrong renderer.
 */
const VIEWERS: Record<string, LazyViewer> = {
  // Markdown
  'text/markdown': MarkdownViewer,
  'text/x-markdown': MarkdownViewer,

  // Code / config
  'application/json': CodeViewer,
  'text/json': CodeViewer,
  'application/yaml': CodeViewer,
  'text/yaml': CodeViewer,
  'application/x-yaml': CodeViewer,
  'application/toml': CodeViewer,
  'text/toml': CodeViewer,
  'application/x-toml': CodeViewer,
  'application/javascript': CodeViewer,
  'text/javascript': CodeViewer,
  'application/typescript': CodeViewer,
  'text/typescript': CodeViewer,
  'text/x-rust': CodeViewer,
  'text/x-shellscript': CodeViewer,
  'application/x-sh': CodeViewer,
  'text/plain': CodeViewer,

  // Diagrams
  'text/mermaid': MermaidViewer,
  'text/x-mermaid': MermaidViewer,

  // HTML preview
  'text/html': HtmlViewer,
  'application/xhtml+xml': HtmlViewer,

  // Images
  'image/svg+xml': ImageViewer,
  'image/png': ImageViewer,
  'image/jpeg': ImageViewer,
  'image/gif': ImageViewer,
  'image/webp': ImageViewer,
  'image/avif': ImageViewer,

  // PDF (native browser PDF.js)
  'application/pdf': PdfViewer,

  // Smart table — spreadsheet-like editor for tabular data
  'text/csv': SmartTableViewer,
  'application/csv': SmartTableViewer,
  // JSON-array detection happens inside SmartTableViewer; explicit
  // override registry below for callers that know the JSON is tabular.
  'application/x-ctrl-table+json': SmartTableViewer,
};

/**
 * Resolve a viewer for the given content-type. Always returns a
 * component — falls back to a labelled placeholder when no viewer is
 * registered, so callers don't need to null-check.
 */
export const resolveViewer = (contentType: string): LazyViewer =>
  VIEWERS[contentType] ?? FallbackViewer;

/**
 * Convenience to register a viewer at runtime (e.g. from a feature
 * flag or a keycap-supplied custom viewer). Mutates the singleton —
 * call once at module init, not from render.
 */
export const registerViewer = (
  contentType: string,
  viewer: LazyViewer,
): void => {
  VIEWERS[contentType] = viewer;
};

/** Read-only view of the currently registered content-types. */
export const listRegisteredViewers = (): ReadonlyArray<string> =>
  Object.keys(VIEWERS);
