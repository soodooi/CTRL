import { describe, it, expect } from 'vitest';
import {
  addAction,
  availableActions,
  defaultWorkspaceLayout,
  indexForKey,
  MAX_SLOTS,
  moveAction,
  parseLayout,
  removeAction,
  resolveAction,
  serializeLayout,
  slotKey,
} from './workspace-layout';

describe('default layout', () => {
  it('every default action id resolves to a real catalog capability', () => {
    const { slots } = defaultWorkspaceLayout();
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThanOrEqual(MAX_SLOTS);
    for (const id of slots) expect(resolveAction(id), id).toBeTruthy();
  });

  it('leads with the screenshot grab', () => {
    expect(defaultWorkspaceLayout().slots[0]).toBe('screenshot-ocr');
  });
});

describe('keyboard number row mapping', () => {
  it('slotKey numbers 1-9 then 0 for the tenth key', () => {
    expect(slotKey(0)).toBe('1');
    expect(slotKey(8)).toBe('9');
    expect(slotKey(9)).toBe('0');
    expect(slotKey(10)).toBeNull();
  });

  it('indexForKey is the inverse: "1"->0, "9"->8, "0"->9', () => {
    expect(indexForKey('1')).toBe(0);
    expect(indexForKey('9')).toBe(8);
    expect(indexForKey('0')).toBe(9);
    expect(indexForKey('a')).toBeNull();
  });
});

describe('availableActions', () => {
  it('excludes placed actions and keeps only non-empty categories', () => {
    const layout = defaultWorkspaceLayout();
    const placed = new Set(layout.slots);
    const offered = availableActions(layout).flatMap((c) => c.capabilities.map((x) => x.id));
    expect(offered.length).toBeGreaterThan(0);
    for (const id of offered) expect(placed.has(id)).toBe(false);
    expect(availableActions(layout).every((c) => c.capabilities.length > 0)).toBe(true);
  });
});

describe('mutations are pure and correct', () => {
  it('addAction appends, is idempotent, and respects the cap', () => {
    const base = { version: 2 as const, slots: ['summarize', 'plan'] };
    const once = addAction(base, 'how-to');
    expect(once.slots).toEqual(['summarize', 'plan', 'how-to']);
    expect(addAction(once, 'how-to').slots).toEqual(once.slots); // idempotent
    expect(base.slots).not.toContain('how-to'); // purity

    const full = { version: 2 as const, slots: Array.from({ length: MAX_SLOTS }, (_, i) => `x${i}`) };
    expect(addAction(full, 'how-to')).toBe(full); // cap reached → unchanged
  });

  it('removeAction drops the action', () => {
    const base = defaultWorkspaceLayout();
    expect(removeAction(base, 'plan').slots).not.toContain('plan');
  });

  it('moveAction relocates within the row at the target index', () => {
    const base = { version: 2 as const, slots: ['a', 'b', 'c', 'd'] };
    expect(moveAction(base, 'd', 0).slots).toEqual(['d', 'a', 'b', 'c']);
    expect(moveAction(base, 'a', 2).slots).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('persistence round-trip', () => {
  it('serialize -> parse preserves the layout', () => {
    const layout = defaultWorkspaceLayout();
    expect(parseLayout(serializeLayout(layout))).toEqual(layout);
  });

  it('parse drops stale ids and caps the row', () => {
    const raw = JSON.stringify({
      version: 2,
      slots: ['summarize', 'ghost-action', 'plan'],
    });
    expect(parseLayout(raw)!.slots).toEqual(['summarize', 'plan']);
  });

  it('parse rejects malformed or wrong-version input', () => {
    expect(parseLayout('not json')).toBeNull();
    expect(parseLayout('{"version":1,"groups":[]}')).toBeNull();
    expect(parseLayout('{"version":2}')).toBeNull();
  });
});
