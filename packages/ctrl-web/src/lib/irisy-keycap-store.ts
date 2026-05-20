// [H-2026-05-18-001] Zustand store for the Irisy keycap-creator pane.
//
// Holds the chat transcript, accumulated slot values, composed manifest
// draft, generated server.ts source, validation results, and the state
// machine flags (generating / ready / installable / installed). The route
// component is a thin renderer over this store.

import { create } from 'zustand';
import {
  composeManifestDraft,
  extractEmittedArtifact,
  parseIrisyOutput,
  type SlotEvent,
} from './irisy-keycap-slots';
import {
  validateManifest,
  type IrisyZodError,
  type KeycapManifest,
} from './irisy-keycap-zod';

export type CreatorPhase =
  | 'empty'
  | 'slot_filling'
  | 'generating'
  | 'ready'
  | 'installing'
  | 'installed'
  | 'install_failed';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  /** Rendered text (control tokens stripped for assistant turns). */
  text: string;
  /** Original text with tokens — kept so we can re-feed Irisy with history. */
  raw: string;
  ts: number;
  /** Streaming assistant turns flip false→true on done. */
  done: boolean;
}

export interface CreatorState {
  // chat
  messages: ChatMessage[];

  // accumulated state
  slots: Record<string, unknown>;
  manifestDraft: Record<string, unknown>;
  serverTs: string | null;
  validated: KeycapManifest | null;
  errors: IrisyZodError[];

  // phase + flags
  phase: CreatorPhase;
  fieldPending: string | null;

  // semantic context — list of already-installed ids, fed in by route
  installedIds: ReadonlySet<string>;

  // actions
  hydratePrefill(prefill: string | null): void;
  setInstalledIds(ids: Iterable<string>): void;

  appendUserMessage(text: string): ChatMessage;
  beginAssistantMessage(): ChatMessage;
  appendAssistantDelta(id: string, delta: string): void;
  finishAssistantMessage(id: string): void;

  setFieldPending(field: string | null): void;

  setGenerating(): void;
  setInstalling(): void;
  setInstalled(): void;
  setInstallFailed(): void;

  discard(): void;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function applySlotsToStore(
  state: CreatorState,
  slots: SlotEvent[],
): Pick<CreatorState, 'slots' | 'manifestDraft' | 'validated' | 'errors' | 'phase'> {
  const nextSlotMap = { ...state.slots };
  for (const slot of slots) nextSlotMap[slot.field] = slot.value;
  const draft = composeManifestDraft(nextSlotMap);
  const result = validateManifest(draft, { installedIds: state.installedIds });
  return {
    slots: nextSlotMap,
    manifestDraft: draft,
    validated: result.ok ? result.manifest : null,
    errors: result.ok ? [] : result.errors,
    phase: state.phase === 'installed' ? state.phase : state.phase, // unchanged here; phase transitions explicit
  };
}

const initialState = (): Pick<
  CreatorState,
  | 'messages'
  | 'slots'
  | 'manifestDraft'
  | 'serverTs'
  | 'validated'
  | 'errors'
  | 'phase'
  | 'fieldPending'
  | 'installedIds'
> => ({
  messages: [],
  slots: {},
  manifestDraft: {},
  serverTs: null,
  validated: null,
  errors: [],
  phase: 'empty',
  fieldPending: null,
  installedIds: new Set<string>(),
});

export const useKeycapCreatorStore = create<CreatorState>((set, get) => ({
  ...initialState(),

  hydratePrefill(prefill) {
    if (!prefill) return;
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: newId(),
          role: 'user',
          text: prefill,
          raw: prefill,
          ts: Date.now(),
          done: true,
        },
      ],
      phase: 'slot_filling',
    }));
  },

  setInstalledIds(ids) {
    set({ installedIds: new Set(ids) });
  },

  appendUserMessage(text) {
    const message: ChatMessage = {
      id: newId(),
      role: 'user',
      text,
      raw: text,
      ts: Date.now(),
      done: true,
    };
    set((s) => ({
      messages: [...s.messages, message],
      phase: s.phase === 'empty' ? 'slot_filling' : s.phase,
    }));
    return message;
  },

  beginAssistantMessage() {
    const message: ChatMessage = {
      id: newId(),
      role: 'assistant',
      text: '',
      raw: '',
      ts: Date.now(),
      done: false,
    };
    set((s) => ({ messages: [...s.messages, message] }));
    return message;
  },

  appendAssistantDelta(id, delta) {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, raw: m.raw + delta } : m,
      ),
    }));
  },

  finishAssistantMessage(id) {
    const state = get();
    const target = state.messages.find((m) => m.id === id);
    if (!target) return;
    const parsed = parseIrisyOutput(target.raw);

    // If the user just sent <emit-manifest/>, the assistant reply is two
    // code blocks; extract them into manifestDraft + serverTs.
    const artifact = extractEmittedArtifact(target.raw);
    let serverTs = state.serverTs;
    let manifestDraft = state.manifestDraft;
    let validated = state.validated;
    let errors = state.errors;
    if (artifact.manifestJson) {
      try {
        manifestDraft = JSON.parse(artifact.manifestJson) as Record<string, unknown>;
        const r = validateManifest(manifestDraft, { installedIds: state.installedIds });
        validated = r.ok ? r.manifest : null;
        errors = r.ok ? [] : r.errors;
      } catch (e: unknown) {
        errors = [
          {
            kind: 'structural',
            path: 'manifest',
            message: e instanceof Error ? e.message : 'manifest JSON parse failed',
          },
        ];
        validated = null;
      }
    }
    if (artifact.serverTs) serverTs = artifact.serverTs;

    // Otherwise (slot/patch turn), merge slots/patches into store.
    const slotUpdate = applySlotsToStore(state, [...parsed.slots, ...parsed.patches]);

    const nextPhase: CreatorPhase = (() => {
      if (artifact.manifestJson && artifact.serverTs && validated) return 'ready';
      if (parsed.ready) return 'generating';
      return state.phase === 'empty' ? 'slot_filling' : state.phase;
    })();

    set({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, text: parsed.cleanText || m.raw, done: true } : m,
      ),
      slots: slotUpdate.slots,
      manifestDraft: artifact.manifestJson ? manifestDraft : slotUpdate.manifestDraft,
      validated: artifact.manifestJson ? validated : slotUpdate.validated,
      errors: artifact.manifestJson ? errors : slotUpdate.errors,
      serverTs,
      phase: nextPhase,
    });
  },

  setFieldPending(field) {
    set({ fieldPending: field });
  },

  setGenerating() {
    set({ phase: 'generating' });
  },
  setInstalling() {
    set({ phase: 'installing' });
  },
  setInstalled() {
    set({ phase: 'installed' });
  },
  setInstallFailed() {
    set({ phase: 'install_failed' });
  },

  discard() {
    set(initialState());
  },
}));

export function selectInstallable(state: CreatorState): boolean {
  return (
    state.phase === 'ready' &&
    state.validated !== null &&
    state.errors.length === 0 &&
    state.serverTs !== null
  );
}
