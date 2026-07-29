// Durable Coding session state shared by the routed and ambient Coding surfaces.
// (ADR-003 frontend §8.5 v35; ADR-005 irisy §8.7 v32)

import type { CodingToolStep } from './coding-chat';

export interface CodingToolStepView extends CodingToolStep {
  id: string;
}

export interface CodingMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: CodingToolStepView[];
  reasoning?: string;
}

const STORAGE_KEY = 'ctrl:coding-sessions:v1';
const MAX_MESSAGES = 200;

type CodingSessions = Record<string, CodingMessage[]>;

function isMessage(value: unknown): value is CodingMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    (record.role === 'user' || record.role === 'assistant') &&
    typeof record.content === 'string'
  );
}

/** Restore Coding conversations without making browser-only routes fail. */
export function loadCodingSessions(): CodingSessions {
  if (typeof window === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([path, value]) => [
        path,
        Array.isArray(value) ? value.filter(isMessage).slice(-MAX_MESSAGES) : [],
      ]),
    );
  } catch {
    return {};
  }
}

/** Persist only completed display data; transient stream handles stay in React. */
export function saveCodingSessions(sessions: CodingSessions): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = Object.fromEntries(
      Object.entries(sessions).map(([path, messages]) => [path, messages.slice(-MAX_MESSAGES)]),
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Local storage can be unavailable or full; the in-memory session remains usable.
  }
}

export const codingSessionStorageKey = STORAGE_KEY;
