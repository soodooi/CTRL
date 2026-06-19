// P5 — Irisy reflection trigger detection (ADR-005 irisy v4 §5). The
// self-evolution loop only fires an episode write when the last exchange
// is notable; getting detection wrong means Irisy either never learns from
// a correction or reflects on every trivial turn. GOAL.md SC7. Pure
// functions, no vault/Tauri — runReflection's vault writes are a follow-up.

import { describe, it, expect } from 'vitest';
import {
  detectReflectTrigger,
  isCorrectionMessage,
  type DetectInput,
} from './irisy-reflection';

function input(over: Partial<DetectInput>): DetectInput {
  return {
    recentTurns: [],
    lastTurnHadToolError: false,
    lastUserTurnIsCorrection: false,
    ...over,
  };
}

describe('detectReflectTrigger (P5)', () => {
  it('fires user-correction (highest-value signal) when the user corrected', () => {
    expect(detectReflectTrigger(input({ lastUserTurnIsCorrection: true }))).toBe(
      'user-correction',
    );
  });

  it('prioritises user-correction over a co-occurring tool failure', () => {
    expect(
      detectReflectTrigger(
        input({ lastUserTurnIsCorrection: true, lastTurnHadToolError: true }),
      ),
    ).toBe('user-correction');
  });

  it('fires tool-failure when only a tool error occurred', () => {
    expect(detectReflectTrigger(input({ lastTurnHadToolError: true }))).toBe(
      'tool-failure',
    );
  });

  it('returns null on an ordinary turn (does not reflect every turn)', () => {
    expect(detectReflectTrigger(input({}))).toBeNull();
  });
});

describe('isCorrectionMessage (P5)', () => {
  it('detects English correction markers case-insensitively', () => {
    expect(isCorrectionMessage('No, that is not what I meant')).toBe(true);
    expect(isCorrectionMessage('ACTUALLY, use the other file')).toBe(true);
    expect(isCorrectionMessage("that's wrong")).toBe(true);
  });

  it('detects Chinese correction markers verbatim', () => {
    expect(isCorrectionMessage('不对,我说的是另一个')).toBe(true);
    expect(isCorrectionMessage('你搞错了')).toBe(true);
    expect(isCorrectionMessage('别这样做')).toBe(true);
  });

  it('returns false for a non-correction message', () => {
    expect(isCorrectionMessage('Please summarise this article')).toBe(false);
    expect(isCorrectionMessage('帮我写一份周报')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(isCorrectionMessage('')).toBe(false);
  });
});
