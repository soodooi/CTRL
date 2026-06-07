// Manifest layout schema — the JSON shape a mcp (or any consumer)
// uses to declare its workspace UI.
//
// Inspirations: Microsoft Adaptive Cards, Slack Block Kit, Airbnb SDUI.
// Kept intentionally narrow for v0 — a tree of {component, props, children}
// nodes where `component` is a string name resolved by the runtime
// registry. Bindings / events come in v0.2 once we have a real LLM
// transport to drive them; today we keep it static + presentational.

import { z } from 'zod';

// A node is either a plain string (text leaf) or an element with a
// component name + optional props + optional children. The recursive
// `lazy` is required because Zod can't infer a self-reference.
export type ManifestNode = string | ManifestElement;

export interface ManifestElement {
  component: string;
  props?: Record<string, unknown>;
  children?: ReadonlyArray<ManifestNode>;
  /** Optional stable key, useful when the same component repeats in a
   *  list and consumers want React to reuse instances across renders. */
  key?: string;
}

export const manifestNodeSchema: z.ZodType<ManifestNode> = z.lazy(() =>
  z.union([z.string(), manifestElementSchema]),
);

export const manifestElementSchema: z.ZodType<ManifestElement> = z.lazy(() =>
  z.object({
    component: z.string().min(1),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(manifestNodeSchema).optional(),
    key: z.string().optional(),
  }),
);

export interface WorkspaceLayout {
  /** Schema version — frontend rejects unknown major versions. */
  version: 1;
  root: ManifestElement;
}

export const workspaceLayoutSchema: z.ZodType<WorkspaceLayout> = z.object({
  version: z.literal(1),
  root: manifestElementSchema,
});
