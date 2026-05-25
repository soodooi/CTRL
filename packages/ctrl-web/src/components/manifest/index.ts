// L3 manifest layer — JSON-driven UI rendering.
//
//   schema.ts            — Zod schema for the WorkspaceLayout JSON
//   registry.ts          — name → component allowlist
//   ManifestRenderer.tsx — runtime that walks the tree
//   layout.tsx           — Stack / Heading / Text presentation primitives
//                          (kept here so they're registry-private; not
//                          re-exported into the primitives barrel)

export { ManifestRenderer } from './ManifestRenderer';
export { MANIFEST_REGISTRY, isRegistered } from './registry';
export type {
  ManifestNode,
  ManifestElement,
  WorkspaceLayout,
} from './schema';
export {
  manifestNodeSchema,
  manifestElementSchema,
  workspaceLayoutSchema,
} from './schema';
