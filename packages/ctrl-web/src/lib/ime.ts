// CJK IME guard for Enter-to-submit (and list-nav) inputs.
//
// ADR-003 frontend §7.6 v2 (IME input, 2026-06-14): §7.6 generalized from
// "IrisyChat.tsx handles IME" to ONE shared guard every Enter-handling input
// reuses. Prior per-component state: 6 of 7 Enter inputs had zero IME guard,
// so CJK candidate-confirm Enter mis-fired submit (bao report 2026-06-14).
//
// An Enter that confirms an input-method candidate (Chinese / Japanese /
// Korean) must NEVER trigger submit. `nativeEvent.isComposing` covers most
// webviews, but some IMEs (observed: Squirrel, macOS Pinyin) confirm a
// candidate without firing compositionend before the keydown — so
// isComposing reads false. The legacy keyCode 229 sentinel that every
// Chromium-based webview still emits during composition is the reliable
// fallback.
//
// Consolidated from IrisyChat.tsx (bao 2026-06-01 / 06-05) so every
// Enter-handling input shares ONE guard instead of per-component patches.
// system-design-first: one rule, not debug-driven patches.

import type { KeyboardEvent } from 'react';

export function isImeComposing(e: KeyboardEvent): boolean {
  const native = e.nativeEvent as globalThis.KeyboardEvent;
  return native.isComposing || native.keyCode === 229;
}
