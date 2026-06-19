// P10 — Irisy render filter. Verifies cleanReplyText() actually strips the
// model-side scaffolds / thinking / narration / codenames that must never
// reach the chat bubble (GOAL.md SC3). Asserts against the REAL behaviour of
// irisy-render-filter.ts: note `Pi` is REWRITTEN to a brand-safe label, not
// deleted, and sycophancy ("Sure!") is a persona-prompt constraint, NOT this
// filter's job — so it is asserted in irisy-prompts.test.ts instead.

import { describe, it, expect } from 'vitest';
import { cleanReplyText } from './irisy-render-filter';

describe('cleanReplyText — reply hygiene (P10)', () => {
  it('returns empty input unchanged', () => {
    expect(cleanReplyText('')).toBe('');
  });

  it('keeps a clean reply intact (only trims surrounding whitespace)', () => {
    expect(cleanReplyText('  Your vault is a local folder.  ')).toBe(
      'Your vault is a local folder.',
    );
  });

  it('strips a trailing planner scaffold from its first header to the end', () => {
    const raw = 'Saved your note.\n\nNext Steps\n- review it\n- ship it';
    expect(cleanReplyText(raw)).toBe('Saved your note.');
  });

  it('strips a qwen-style Goal/Progress block that IS the whole reply', () => {
    const raw = 'Goal\nbuild a thing\nProgress\nhalf done';
    expect(cleanReplyText(raw)).toBe('');
  });

  it('removes <thinking> blocks', () => {
    const raw = 'Here.<thinking>should I?</thinking> answer below';
    expect(cleanReplyText(raw)).toBe('Here. answer below');
  });

  it('removes tool-call narration lines', () => {
    const raw = 'Let me check your vault.\nYour note is saved.';
    expect(cleanReplyText(raw)).toBe('Your note is saved.');
  });

  it('rewrites the Pi codename to a brand-safe label (no leak)', () => {
    const out = cleanReplyText('I am routing through Pi to your provider.');
    expect(out).not.toMatch(/\bPi\b/);
    expect(out).toContain('the assistant');
  });

  it('rewrites internal tool names to user-facing verbs', () => {
    expect(cleanReplyText('I will use vault_write now.')).toContain(
      'save to your vault',
    );
  });

  it('collapses 3+ consecutive blank lines to a single paragraph break', () => {
    expect(cleanReplyText('a\n\n\n\nb')).toBe('a\n\nb');
  });
});
