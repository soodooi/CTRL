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
   * patch / etc).
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

const MarkdownViewer = lazy(() =>
  import('@/components/viewers/MarkdownViewer').then((m) => ({
    default: m.MarkdownViewer,
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
  'text/markdown': MarkdownViewer,
  // ↓ planned, file in subsequent commits as viewers are written
  // 'application/json': JsonViewer,
  // 'text/yaml': YamlViewer,
  // 'text/toml': TomlViewer,
  // 'text/html': HtmlViewer,
  // 'image/svg+xml': SvgViewer,
  // 'text/mermaid': MermaidViewer,
  // 'application/pdf': PdfViewer,
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
