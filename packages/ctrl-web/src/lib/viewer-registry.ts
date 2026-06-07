// Viewer registry — the workspace's content-rendering surface.
//
// Three dimensions per the architecture review (decided 2026-05-25):
//   - location: vault | mcp | system  (where the resource lives)
//   - editable: boolean                  (can the viewer write back?)
//   - companion: string?                 (sidecar URI, e.g. PDF + .pdf.md)
//
// MIME alone doesn't pick the viewer — `text/markdown` from a vault note
// is editable + persisted to the vault; the same MIME from a mcp
// prompt is editable + persisted as a Config-tier patch; from a system
// log it's read-only. Same viewer body, three save handlers.
//
// All viewer modules are loaded lazily so the critical-path PWA bundle
// stays under the mobile 200KB cap. A viewer enters the bundle the first
// time its content-type appears in a workspace tab.
//
// VMark compatibility: per ADR-001 spine amendment (2026-05-25), CTRL uses the
// same open-source stack VMark uses (Tiptap, CodeMirror, mermaid) — no
// runtime dependency on the VMark.app process. A user can switch between
// VMark and CTRL editing the same vault file because both speak plain
// markdown + the same lib semantics.

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export type ViewerLocation = 'vault' | 'mcp' | 'system';

export interface ViewerResource {
  location: ViewerLocation;
  contentType: string;
  uri: string;
  companion?: string;
  editable: boolean;
  /** Called when the viewer commits an edit. Required when `editable`
   *  is true; ignored otherwise. */
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
const JsonViewer = lazy(() =>
  import('@/components/viewers/JsonViewer').then((m) => ({
    default: m.JsonViewer,
  })),
);
const YamlViewer = lazy(() =>
  import('@/components/viewers/YamlViewer').then((m) => ({
    default: m.YamlViewer,
  })),
);
const TomlViewer = lazy(() =>
  import('@/components/viewers/TomlViewer').then((m) => ({
    default: m.TomlViewer,
  })),
);
const CodeViewer = lazy(() =>
  import('@/components/viewers/CodeViewer').then((m) => ({
    default: m.CodeViewer,
  })),
);
const HtmlViewer = lazy(() =>
  import('@/components/viewers/HtmlViewer').then((m) => ({
    default: m.HtmlViewer,
  })),
);
const SvgViewer = lazy(() =>
  import('@/components/viewers/SvgViewer').then((m) => ({
    default: m.SvgViewer,
  })),
);
const MermaidViewer = lazy(() =>
  import('@/components/viewers/MermaidViewer').then((m) => ({
    default: m.MermaidViewer,
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
 * Content-type → lazy viewer. Aliases: any image/* uses ImageViewer; any
 * text/* without a more specific match uses CodeViewer.
 */
const VIEWERS: Record<string, LazyViewer> = {
  // Structured text — primary viewers
  'text/markdown': MarkdownViewer,
  'application/json': JsonViewer,
  'text/yaml': YamlViewer,
  'text/toml': TomlViewer,
  'text/html': HtmlViewer,
  'image/svg+xml': SvgViewer,
  'text/mermaid': MermaidViewer,
  // Smart-table — a markdown table with a frontmatter schema, rendered
  // via Tanstack Table. File on disk is still markdown (vim test).
  'text/x-ctrl-smart-table': SmartTableViewer,
  // Binary
  'application/pdf': PdfViewer,
  // Code (generic — registers individual lang aliases below)
  'text/typescript': CodeViewer,
  'text/javascript': CodeViewer,
  'text/css': CodeViewer,
  'text/rust': CodeViewer,
  'text/python': CodeViewer,
  'text/shell': CodeViewer,
  'text/plain': CodeViewer,
};

const isImageType = (contentType: string): boolean =>
  contentType.startsWith('image/') && contentType !== 'image/svg+xml';

/**
 * Resolve a viewer for the given content-type. Always returns a
 * component — falls back to a labelled placeholder when no viewer is
 * registered, so callers don't need to null-check.
 */
export const resolveViewer = (contentType: string): LazyViewer => {
  if (VIEWERS[contentType]) return VIEWERS[contentType];
  if (isImageType(contentType)) return ImageViewer;
  return FallbackViewer;
};

/**
 * Convenience to register a viewer at runtime (e.g. from a feature
 * flag or a mcp-supplied custom viewer). Mutates the singleton —
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
