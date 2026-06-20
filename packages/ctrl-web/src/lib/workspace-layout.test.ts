import { describe, it, expect } from 'vitest';
import {
  addAction,
  availableActions,
  defaultWorkspaceLayout,
  moveAction,
  parseLayout,
  PINNED_GROUP_ID,
  removeAction,
  resolveAction,
  serializeLayout,
  togglePinned,
} from './workspace-layout';

describe('default layout', () => {
  it('every default action id resolves to a real catalog capability', () => {
    const layout = defaultWorkspaceLayout();
    const ids = layout.groups.flatMap((g) => g.actionIds);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(resolveAction(id), id).toBeTruthy();
  });

  it('leads with a Pinned group', () => {
    const [first] = defaultWorkspaceLayout().groups;
    expect(first?.id).toBe(PINNED_GROUP_ID);
  });
});

describe('availableActions', () => {
  it('excludes already-placed actions and keeps only non-empty categories', () => {
    const layout = defaultWorkspaceLayout();
    const placed = new Set(layout.groups.flatMap((g) => g.actionIds));
    const offered = availableActions(layout).flatMap((c) => c.capabilities.map((x) => x.id));
    expect(offered.length).toBeGreaterThan(0);
    for (const id of offered) expect(placed.has(id)).toBe(false);
    expect(availableActions(layout).every((c) => c.capabilities.length > 0)).toBe(true);
  });
});

describe('mutations are pure and correct', () => {
  it('addAction appends and is idempotent', () => {
    const base = defaultWorkspaceLayout();
    const once = addAction(base, 'create', 'image-generate');
    const twice = addAction(once, 'create', 'image-generate');
    const create = (l: typeof base) => l.groups.find((g) => g.id === 'create')!.actionIds;
    expect(create(once)).toContain('image-generate');
    expect(create(twice).filter((id) => id === 'image-generate')).toHaveLength(1);
    // original untouched (purity)
    expect(create(base)).not.toContain('image-generate');
  });

  it('removeAction drops only from the named group', () => {
    const base = defaultWorkspaceLayout();
    const next = removeAction(base, 'ai-actions', 'how-to');
    expect(next.groups.find((g) => g.id === 'ai-actions')!.actionIds).not.toContain('how-to');
  });

  it('togglePinned moves an action into Pinned exactly once, then unpins', () => {
    const base = defaultWorkspaceLayout();
    const pinned = togglePinned(base, 'how-to');
    const pin = (l: typeof base) => l.groups.find((g) => g.id === PINNED_GROUP_ID)!.actionIds;
    const ai = (l: typeof base) => l.groups.find((g) => g.id === 'ai-actions')!.actionIds;
    expect(pin(pinned)[0]).toBe('how-to');
    expect(ai(pinned)).not.toContain('how-to');
    // an action lives in exactly one group
    const all = pinned.groups.flatMap((g) => g.actionIds).filter((id) => id === 'how-to');
    expect(all).toHaveLength(1);
    const unpinned = togglePinned(pinned, 'how-to');
    expect(pin(unpinned)).not.toContain('how-to');
  });

  it('moveAction relocates across groups at the target index', () => {
    const base = defaultWorkspaceLayout();
    const next = moveAction(base, 'plan', 'create', 0);
    const create = next.groups.find((g) => g.id === 'create')!.actionIds;
    expect(create[0]).toBe('plan');
    expect(next.groups.find((g) => g.id === PINNED_GROUP_ID)!.actionIds).not.toContain('plan');
  });
});

describe('persistence round-trip', () => {
  it('serialize -> parse preserves the layout', () => {
    const layout = defaultWorkspaceLayout();
    expect(parseLayout(serializeLayout(layout))).toEqual(layout);
  });

  it('parse drops action ids that no longer exist in the catalog', () => {
    const raw = JSON.stringify({
      version: 1,
      groups: [{ id: 'pinned', title: 'Pinned', actionIds: ['summarize', 'ghost-action'] }],
    });
    const parsed = parseLayout(raw);
    expect(parsed?.groups[0]?.actionIds).toEqual(['summarize']);
  });

  it('parse rejects malformed input', () => {
    expect(parseLayout('not json')).toBeNull();
    expect(parseLayout('{"version":2,"groups":[]}')).toBeNull();
    expect(parseLayout('{"version":1}')).toBeNull();
  });
});
