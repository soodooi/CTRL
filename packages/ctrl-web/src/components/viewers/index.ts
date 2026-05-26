// Viewer modules are loaded via lazy() inside `lib/viewer-registry.ts`
// to keep bundles split. This barrel exposes the eager imports for
// tests and any caller that wants direct access (e.g. preloading the
// markdown viewer when the user hovers a vault file).

export { FallbackViewer } from './Fallback';
export { MarkdownViewer } from './MarkdownViewer';
export { JsonViewer } from './JsonViewer';
export { YamlViewer } from './YamlViewer';
export { TomlViewer } from './TomlViewer';
export { CodeViewer } from './CodeViewer';
export { HtmlViewer } from './HtmlViewer';
export { SvgViewer } from './SvgViewer';
export { MermaidViewer } from './MermaidViewer';
export { ImageViewer } from './ImageViewer';
export { PdfViewer } from './PdfViewer';
export { SmartTableViewer } from './SmartTableViewer';
export { ViewerHost } from './ViewerHost';
export { ViewerChrome } from './ViewerChrome';
export { useViewerResource } from './useViewerResource';
