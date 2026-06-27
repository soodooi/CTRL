// AdaptiveWorkspaceTabs viewer dispatch — the pure adaptation layer.
//
// ADR-003 frontend §8.2 (morph-to-output-type via the content-type viewer
// registry): a mcp manifest declares `ui_surface.workspace.tabs[]`; each tab
// names a `viewer` and (for content surfaces) a `props.uri` source. This module
// turns a tab declaration into a `ViewerResource` the content-type viewer
// registry can resolve — capability-agnostic, no per-pack code. Kept React-free
// + relative-import-only so it runs under the minimal vitest config (which omits
// the `@` alias + JSX transform); the presentation shell
// (AdaptiveWorkspaceTabs.tsx) consumes these.

import type { WorkspaceTab } from '@ctrl/mcp-sdk';
import type { ViewerLocation, ViewerResource } from '../../lib/viewer-registry';
import { SMART_TABLE_CONTENT_TYPE } from '../../modules/smart-table';

// `tab.viewer` is a free string: a viewer-registry content key (markdown /
// code / json / smart-table / svg / …), an explicit MIME, or a legacy
// interactive WorkspaceUi kind. Content keys map to a content-type the registry
// resolves; a value already containing '/' is treated as a MIME verbatim.
const VIEWER_KEY_TO_CONTENT_TYPE: Record<string, string> = {
  markdown: 'text/markdown',
  code: 'text/plain',
  json: 'application/json',
  yaml: 'text/yaml',
  toml: 'text/toml',
  html: 'text/html',
  svg: 'image/svg+xml',
  mermaid: 'text/mermaid',
  image: 'image/png',
  pdf: 'application/pdf',
  'smart-table': SMART_TABLE_CONTENT_TYPE,
};

// Legacy single-renderer WorkspaceUi kinds — interactive / stream surfaces
// (the §8.2 agent-workspace stream path), not content-registry viewers.
// Rendered as a labelled fallback for now (streaming + form rendering inside
// tabs is a follow-up).
export const INTERACTIVE_VIEWERS = new Set<string>([
  'none',
  'notification',
  'modal',
  'clipboard',
  'html-output',
  'chat-stream',
  'picker',
  'form',
  'canvas',
]);

/** Map a tab's `viewer` to a registry content-type. A value with '/' is already
 *  a MIME; an unknown key resolves to the fallback viewer. */
export const contentTypeForViewer = (viewer: string): string =>
  viewer.includes('/')
    ? viewer
    : VIEWER_KEY_TO_CONTENT_TYPE[viewer] ?? 'application/octet-stream';

/** Adapt a tab to a ViewerResource. The mcp declares the content source as
 *  `props.uri` (vault:// / ctrl-asset:// …) plus optional location /
 *  contentType / editable overrides. Returns null when there is no uri to
 *  render — an interactive kind, or a content tab missing its source. */
export const tabToResource = (tab: WorkspaceTab): ViewerResource | null => {
  const props = (tab.props ?? {}) as Record<string, unknown>;
  const uri = typeof props.uri === 'string' ? props.uri : '';
  if (uri === '') return null;
  const contentType =
    typeof props.contentType === 'string'
      ? props.contentType
      : contentTypeForViewer(tab.viewer);
  const location: ViewerLocation =
    props.location === 'vault' || props.location === 'system'
      ? props.location
      : 'mcp';
  return { location, contentType, uri, editable: props.editable === true };
};
