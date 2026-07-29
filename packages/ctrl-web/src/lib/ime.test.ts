// isImeComposing — the shared CJK IME guard every Enter-handling input reuses
// (ADR-003 frontend §7.6 v24). This had zero test coverage anywhere in the
// codebase before the Coding composer shipped without calling it at all
// (2026-07-27 bug report: pinyin composition confirmed with Enter fired
// submit instead of confirming the candidate) — covering the guard itself so
// a future input can't silently skip it without a compile-time reminder that
// the function exists and behaves as documented.

import { describe, it, expect } from 'vitest';
import { isImeComposing } from './ime';

function fakeKeyboardEvent(opts: { isComposing?: boolean; keyCode?: number }): KeyboardEvent {
  return {
    isComposing: opts.isComposing ?? false,
    keyCode: opts.keyCode ?? 0,
  } as KeyboardEvent;
}

function fakeReactEvent(opts: { isComposing?: boolean; keyCode?: number }) {
  return { nativeEvent: fakeKeyboardEvent(opts) } as unknown as Parameters<typeof isImeComposing>[0];
}

describe('isImeComposing', () => {
  it('is true when nativeEvent.isComposing is true (standard compositionstart path)', () => {
    expect(isImeComposing(fakeReactEvent({ isComposing: true }))).toBe(true);
  });

  it('is true on the legacy keyCode 229 sentinel even when isComposing reads false', () => {
    // Some IMEs (macOS Pinyin, Squirrel) confirm a candidate without firing
    // compositionend before keydown, so isComposing can read false while the
    // browser still reports the 229 sentinel — this is the fallback that
    // catches that case.
    expect(isImeComposing(fakeReactEvent({ isComposing: false, keyCode: 229 }))).toBe(true);
  });

  it('is false for an ordinary (non-IME) Enter press', () => {
    expect(isImeComposing(fakeReactEvent({ isComposing: false, keyCode: 13 }))).toBe(false);
  });

  it('reads a raw (non-React) KeyboardEvent directly, not via nativeEvent', () => {
    expect(isImeComposing(fakeKeyboardEvent({ isComposing: true }))).toBe(true);
    expect(isImeComposing(fakeKeyboardEvent({ isComposing: false, keyCode: 13 }))).toBe(false);
  });
});
