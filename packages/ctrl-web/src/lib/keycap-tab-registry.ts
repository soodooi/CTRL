// Keycap workspace-tab registry — maps `manifest.workspace.custom_component_path`
// to a lazy-loaded React component. Per ADR-002 amendment 2026-05-22:
// LifecycleShell never hardcodes keycap-specific UI; keycaps that need a
// custom tab type ship a React component and declare its path in their
// manifest. The registry resolves the path at activation time.
//
// Resolution rules:
//   1. `manifest.workspace.ui` ∈ {none, notification, modal, clipboard,
//      html-output, chat-stream, picker, form, canvas} → handled by
//      LifecycleShell built-in renderers (not this registry's concern).
//   2. `manifest.workspace.ui === "custom"` → registry looks up
//      `manifest.workspace.custom_component_path` and returns a lazy
//      React.LazyExoticComponent. If the path is not registered, the
//      registry returns null and LifecycleShell falls back to a
//      "missing keycap UI" warning tab.
//
// Path convention: relative to `packages/ctrl-web/src/components/keycaps/`,
// e.g. `"CodeSpaceTab.tsx"` resolves to a lazy import of that file.
//
// To register a new keycap's custom tab component, add an entry below.
// In production, the registry can be code-generated from installed
// manifests at kernel-supervisor boot; this hand-maintained map is the
// development-time source of truth (and the ship target for v1 starters).

import { type ComponentType, lazy } from 'react';

export interface KeycapTabProps {
  /** Stable keycap id (manifest.id) — used to scope LocalStorage etc. */
  keycapId: string;
  /** User config materialized from manifest.config_schema. */
  config: Readonly<Record<string, unknown>>;
  /**
   * Workspace tab id assigned by LifecycleShell. Stable for the lifetime
   * of the tab; the keycap component can use it as the key for scoped
   * subscriptions or stream IDs.
   */
  tabId: string;
}

type KeycapTabComponent = ComponentType<KeycapTabProps>;
type LazyKeycapTabComponent = ReturnType<typeof lazy<KeycapTabComponent>>;

/**
 * Hand-maintained registry. Each entry pairs the manifest-declared path
 * with a lazy import that LifecycleShell will mount when the tab opens.
 *
 * Adding a new keycap: drop your component at
 * `packages/ctrl-web/src/components/keycaps/<Name>Tab.tsx` (default export
 * a React component matching `KeycapTabComponent`) and register here.
 */
const REGISTRY: Record<string, LazyKeycapTabComponent> = {
  // Example wiring (Code Space — ADR-012). Uncomment once the component
  // file lands; left declared to make the convention concrete.
  // 'CodeSpaceTab.tsx': lazy(() => import('../components/keycaps/CodeSpaceTab')),
};

/**
 * Resolve a `manifest.workspace.custom_component_path` to a lazy React
 * component. Returns null when the path isn't registered — callers
 * (LifecycleShell) should render a "keycap UI missing" placeholder
 * rather than crash.
 */
export function resolveKeycapTab(
  customComponentPath: string | undefined,
): LazyKeycapTabComponent | null {
  if (!customComponentPath) {
    return null;
  }
  return REGISTRY[customComponentPath] ?? null;
}

/**
 * Test-only: snapshot the registry keys. Used by Vitest to assert that
 * every installed keycap with `workspace.ui === "custom"` has its path
 * registered (smoke check; not a hard install gate).
 */
export function listRegisteredKeycapTabs(): readonly string[] {
  return Object.keys(REGISTRY);
}
