// Primitives barrel — CTRL's L1 component layer.
//
// Two tiers in this folder:
//   atoms   — Button / Card / Section / FormField / TextInput / KeyInput / Logo / cx
//   widgets — Sparkline / Gauge / Led / ChatInput / HistorySidebar /
//             TabStrip / IrisyMascot
//
// L2 templates (SessionWorkspace / ClusterWorkspace, under
// `../workspace/`) compose these. L3 manifest-driven layouts (future)
// will consume the same primitives via a JSON spec renderer.

// atoms
export { Button } from './Button';
export { Card } from './Card';
export { Section } from './Section';
export { FormField } from './FormField';
export { TextInput } from './TextInput';
export { KeyInput } from './KeyInput';
export { Logo } from './Logo';
export { cx } from './cx';

// widgets (data viz + interaction)
export { Sparkline } from './Sparkline';
export type { SparklineProps } from './Sparkline';
export { Gauge } from './Gauge';
export type { GaugeProps, GaugeTone } from './Gauge';
export { Led } from './Led';
export type { LedProps, LedTone } from './Led';
export { ChatInput } from './ChatInput';
export type { ChatInputProps } from './ChatInput';
export { HistorySidebar } from './HistorySidebar';
export type {
  HistorySidebarProps,
  HistoryGroup,
  HistoryItem,
} from './HistorySidebar';
export { TabStrip } from './TabStrip';
export type { TabStripProps, TabItem } from './TabStrip';
export { IrisyMascot } from './IrisyMascot';
export type { IrisyState } from './IrisyMascot';
export { StatusPill } from './StatusPill';
export type { StatusPillProps } from './StatusPill';
export { IconButton } from './IconButton';
export type {
  IconButtonProps,
  IconButtonVariant,
  IconButtonSize,
} from './IconButton';
export { FileDropzone } from './FileDropzone';
export type { FileDropzoneProps } from './FileDropzone';
export { Form, Field } from './Form';
export type { FormProps, FieldProps } from './Form';
export { KV } from './KV';
export type { KVProps, KVPair } from './KV';
export { BentoGrid, BentoTile } from './BentoGrid';
export type {
  BentoGridProps,
  BentoTileProps,
  BentoSpan,
  BentoRows,
} from './BentoGrid';
export { CommandBar } from './CommandBar';
export type { CommandBarProps, CommandItem } from './CommandBar';
export { IconRenderer } from './IconRenderer';
