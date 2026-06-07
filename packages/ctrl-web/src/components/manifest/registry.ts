// Manifest component registry — the explicit allowlist of components a
// mcp manifest can name. Untrusted manifests CAN ONLY mount what's
// here; unknown names render a fallback placeholder.
//
// The registry is intentionally separate from the primitives barrel so
// we can: (a) gate which primitives are exposed to manifests (some
// internal components stay private), (b) version the mapping if a
// component name needs an alias (e.g. "Heading" → "Title"), (c) inject
// presentation-only HTML primitives (`Stack`, `Heading`, `Text`).

import type { ComponentType } from 'react';
import {
  BentoGrid,
  BentoTile,
  Button,
  Card,
  ChatInput,
  Field,
  FileDropzone,
  Form,
  Gauge,
  HistorySidebar,
  IconButton,
  IrisyMascot,
  KV,
  Led,
  Sparkline,
  StatusPill,
  TabStrip,
  TextInput,
} from '../primitives';
import { Heading, Stack, Text } from './layout';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyComponent = ComponentType<any>;

/** Allowlisted component names → React components. */
export const MANIFEST_REGISTRY: Readonly<Record<string, AnyComponent>> = {
  // Layout / typography
  Stack,
  Heading,
  Text,
  BentoGrid,
  BentoTile,

  // Atoms
  Button,
  Card,
  TextInput,
  IconButton,

  // Form
  Form,
  Field,

  // Widgets — data viz + state
  Sparkline,
  Gauge,
  Led,
  StatusPill,
  KV,
  IrisyMascot,

  // Widgets — interactive
  ChatInput,
  HistorySidebar,
  TabStrip,
  FileDropzone,

  // CommandBar deliberately omitted — it's a modal overlay, not part
  // of a workspace layout tree. Routes mount it imperatively.
};

export const isRegistered = (name: string): boolean =>
  Object.prototype.hasOwnProperty.call(MANIFEST_REGISTRY, name);
