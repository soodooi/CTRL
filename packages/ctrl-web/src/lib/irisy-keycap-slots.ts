// [H-2026-05-18-001] Parser for Irisy's keycap-creator control tokens.
//
// Tokens (one per line, mid-message OK):
//   <keycap-slot field="dot.path">value-or-json</keycap-slot>
//   <keycap-ready/>
//   <keycap-patch field="dot.path">new-value-or-json</keycap-patch>
//
// Values are JSON-decoded if they parse as valid JSON; otherwise treated
// as raw strings. The PWA writes these into the Zustand store, which then
// composes the manifest draft.

export interface SlotEvent {
  field: string;
  value: unknown;
}

export interface PatchEvent {
  field: string;
  value: unknown;
}

export interface ParsedIrisyOutput {
  /** Slot tokens accumulated in order. */
  slots: SlotEvent[];
  /** Patch tokens accumulated in order. */
  patches: PatchEvent[];
  /** True if <keycap-ready/> was emitted in this segment. */
  ready: boolean;
  /** Prose with all control tokens stripped — what to render in the chat bubble. */
  cleanText: string;
}

const SLOT_RE = /<keycap-slot\s+field="([^"]+)">([\s\S]*?)<\/keycap-slot>/g;
const PATCH_RE = /<keycap-patch\s+field="([^"]+)">([\s\S]*?)<\/keycap-patch>/g;
const READY_RE = /<keycap-ready\s*\/>/g;

function tryJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  // Cheap pre-check before paying for JSON.parse on every value.
  const first = trimmed[0];
  if (first === '{' || first === '[' || first === '"' || first === 't' || first === 'f' || first === 'n' || (first !== undefined && first >= '0' && first <= '9') || first === '-') {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export function parseIrisyOutput(text: string): ParsedIrisyOutput {
  const slots: SlotEvent[] = [];
  const patches: PatchEvent[] = [];
  let ready = false;

  for (const match of text.matchAll(SLOT_RE)) {
    const field = match[1];
    const raw = match[2];
    if (field === undefined || raw === undefined) continue;
    slots.push({ field, value: tryJson(raw) });
  }
  for (const match of text.matchAll(PATCH_RE)) {
    const field = match[1];
    const raw = match[2];
    if (field === undefined || raw === undefined) continue;
    patches.push({ field, value: tryJson(raw) });
  }
  if (READY_RE.test(text)) ready = true;

  const cleanText = text
    .replace(SLOT_RE, '')
    .replace(PATCH_RE, '')
    .replace(READY_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { slots, patches, ready, cleanText };
}

// ── Manifest draft composition ────────────────────────────────────────
//
// Slots arrive flat with dot-notation field paths. Compose them into a
// nested manifest object so Zod can validate it.

export function composeManifestDraft(slots: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(slots)) {
    setByPath(out, path.split('.'), value);
  }
  return out;
}

function setByPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  if (path.length === 0) return;
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  const existing = target[head];
  const next: Record<string, unknown> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  target[head] = next;
  setByPath(next, rest, value);
}

// ── Manifest + code extraction from <emit-manifest/> response ─────────
//
// After Irisy receives <emit-manifest/>, she replies with exactly two
// fenced code blocks: ```json (manifest) then ```typescript (server.ts).

const JSON_BLOCK_RE = /```json\s*\n([\s\S]*?)\n```/;
const TS_BLOCK_RE = /```typescript\s*\n([\s\S]*?)\n```/;

export interface EmittedArtifact {
  manifestJson: string | null;
  serverTs: string | null;
}

export function extractEmittedArtifact(text: string): EmittedArtifact {
  const j = text.match(JSON_BLOCK_RE);
  const t = text.match(TS_BLOCK_RE);
  return {
    manifestJson: j?.[1]?.trim() ?? null,
    serverTs: t?.[1]?.trim() ?? null,
  };
}
