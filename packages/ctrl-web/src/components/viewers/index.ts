// Viewer modules are loaded via lazy() inside `lib/viewer-registry.ts`
// to keep bundles split. This barrel exposes the eager imports for
// tests and any caller that wants direct access.

export { FallbackViewer } from './Fallback';
export { MarkdownViewer } from './MarkdownViewer';
