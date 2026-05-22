// Manifest component registry — the explicit allowlist of components a
// keycap manifest can name. Untrusted manifests CAN ONLY mount what's
// here; unknown names render a fallback placeholder.
//
// The registry is intentionally separate from the primitives barrel so
// we can: (a) gate which primitives are exposed to manifests (some
// internal components stay private), (b) version the mapping if a
// component name needs an alias (e.g. "Heading" → "Title"), (c) inject
// presentation-only HTML primitives (`Stack`, `Heading`, `Text`).

import type { ComponentType } from 'react';
import {
  Button,
  Card,
  ChatInput,
  Gauge,
  HistorySidebar,
  IconButton,
  IrisyMascot,
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

  // Atoms
  Button,
  Card,
  TextInput,
  IconButton,

  // Widgets
  Sparkline,
  Gauge,
  Led,
  ChatInput,
  HistorySidebar,
  TabStrip,
  StatusPill,
  IrisyMascot,
};

export const isRegistered = (name: string): boolean =>
  Object.prototype.hasOwnProperty.call(MANIFEST_REGISTRY, name);
