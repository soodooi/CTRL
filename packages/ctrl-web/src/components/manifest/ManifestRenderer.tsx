// ManifestRenderer — walk a JSON layout tree, mount components by
// name from the registry. The L3 piece of the layer model.
//
// Safety posture: the renderer NEVER eval()s a string. Unknown
// component names render a visible "?" placeholder so authors notice
// typos / unknown bindings. Schema validation runs once on entry
// (Zod) so the tree we hand React is structurally sound.
//
// Out of scope for v0 (deliberate — keep the renderer minimal):
//   - Event handlers in the manifest. There's no safe sandbox for
//     arbitrary JS yet; events come back when we add a binding layer.
//   - Data bindings. Today props are static literals from the JSON;
//     a future `bind: "$.path"` syntax fetches from a runtime store.

import { useMemo, type ReactElement, type ReactNode } from 'react';
import {
  workspaceLayoutSchema,
  type ManifestNode,
  type ManifestElement,
  type WorkspaceLayout,
} from './schema';
import { MANIFEST_REGISTRY } from './registry';
import styles from './ManifestRenderer.module.css';

interface ManifestRendererProps {
  /** Either a parsed WorkspaceLayout or a JSON string awaiting parse. */
  layout: WorkspaceLayout | string;
  /** Surface validation / parse failures as a banner. Defaults to
   *  rendering the error inline; pass false to silently render null
   *  (useful in test harnesses). */
  showErrors?: boolean;
}

const UnknownComponent = ({ name }: { name: string }): ReactElement => (
  <span className={styles.unknown} aria-label={`unknown component ${name}`}>
    ? {name}
  </span>
);

const renderNode = (node: ManifestNode, idx: number): ReactNode => {
  if (typeof node === 'string') return node;
  return renderElement(node, String(node.key ?? idx));
};

const renderElement = (
  element: ManifestElement,
  reactKey: string,
): ReactNode => {
  const Component = MANIFEST_REGISTRY[element.component];
  const children = element.children?.map((child, i) => renderNode(child, i));

  if (!Component) {
    return <UnknownComponent key={reactKey} name={element.component} />;
  }

  return (
    <Component key={reactKey} {...(element.props ?? {})}>
      {children && children.length > 0 ? children : undefined}
    </Component>
  );
};

export const ManifestRenderer = ({
  layout,
  showErrors = true,
}: ManifestRendererProps): ReactElement | null => {
  const parsed = useMemo<
    | { kind: 'ok'; layout: WorkspaceLayout }
    | { kind: 'error'; message: string }
  >(() => {
    try {
      const json =
        typeof layout === 'string'
          ? (JSON.parse(layout) as unknown)
          : layout;
      const result = workspaceLayoutSchema.safeParse(json);
      if (!result.success) {
        return {
          kind: 'error',
          message: `manifest schema · ${result.error.issues[0]?.path.join('.') ?? ''} ${result.error.issues[0]?.message ?? ''}`,
        };
      }
      return { kind: 'ok', layout: result.data };
    } catch (e: unknown) {
      return {
        kind: 'error',
        message: e instanceof Error ? e.message : 'parse failed',
      };
    }
  }, [layout]);

  if (parsed.kind === 'error') {
    if (!showErrors) return null;
    return (
      <div className={styles.error} role="alert">
        manifest invalid · {parsed.message}
      </div>
    );
  }

  return <>{renderElement(parsed.layout.root, 'root')}</>;
};
