import { describe, it, expect } from 'vitest';
import {
  ROLES,
  DEFAULT_ROLE_ID,
  roleById,
  roleForScene,
  roleForPack,
  packsForRole,
  kbScopeAmbient,
  inKbScope,
  type Role,
  type RoleId,
  type SceneKind,
} from './roles';

describe('role pool', () => {
  it('default role is the personal KB assistant (bao 2026-06-25)', () => {
    expect(DEFAULT_ROLE_ID).toBe('kb-assistant');
    expect(roleById('kb-assistant').label).toBe('Knowledge Base');
  });

  it('ships exactly the initial set; v1 has no user-created roles', () => {
    expect(ROLES.map((r) => r.id)).toEqual([
      'kb-assistant',
      'code-companion',
      'tool-maker',
      'stocks',
    ]);
  });

  it('roleById falls back to the default for an unknown id', () => {
    // Cast: exercising the runtime fallback path with an id outside the union.
    expect(roleById('nope' as Role['id']).id).toBe('kb-assistant');
  });
});

describe('roleForScene (L1 linkage)', () => {
  it('links notes and tables to the KB assistant', () => {
    expect(roleForScene('notes')).toBe('kb-assistant');
    expect(roleForScene('tables')).toBe('kb-assistant');
  });
  it('links coding to the code companion', () => {
    expect(roleForScene('coding')).toBe('code-companion');
  });
  it('returns null for no scene (keeps the user choice)', () => {
    expect(roleForScene(null)).toBeNull();
  });
});

describe('roleForPack (opening a pack switches the role)', () => {
  it('routes a dev pack to the code companion (its toolset owner)', () => {
    expect(roleForPack('dev-box')).toBe('code-companion');
    expect(roleForPack('git-box')).toBe('code-companion');
    expect(roleForPack('cf-workers')).toBe('code-companion');
  });
  it('routes the ghostfolio pack to the stocks role', () => {
    expect(roleForPack('ghostfolio')).toBe('stocks');
  });
  it('routes an unowned pack to the default role (sees all packs)', () => {
    expect(roleForPack('some-random-pack')).toBe('kb-assistant');
  });
});

describe('packsForRole (toolset)', () => {
  const installed = [
    { id: 'dev-box' },
    { id: 'git-box' },
    { id: 'notes-helper' },
    { id: 'cf-workers' },
  ];

  it('empty toolset = unconstrained (all installed packs)', () => {
    const kb = roleById('kb-assistant');
    expect(kb.toolset).toEqual([]);
    expect(packsForRole(kb, installed)).toEqual(installed);
  });

  it('non-empty toolset is a whitelist', () => {
    const code = roleById('code-companion');
    const ids = packsForRole(code, installed).map((p) => p.id);
    expect(ids).toEqual(['dev-box', 'git-box', 'cf-workers']);
    expect(ids).not.toContain('notes-helper');
  });

  it('returns a fresh array (does not alias the input)', () => {
    const kb = roleById('kb-assistant');
    const out = packsForRole(kb, installed);
    expect(out).not.toBe(installed);
  });
});

// The L1 -> (role, toolset, kbScope) binding matrix. This is the test PLAN for
// "what role + which packs does each L1 get": one row per L1 that links a role,
// asserted end-to-end. A new L1 that should carry a role adds a row here, so the
// binding is never implicit. L1s NOT listed (irisy / discover / settings / a
// single feature-pack) intentionally do NOT auto-switch the role — the user's
// current role is kept (roleForScene returns null).
describe('L1 -> role + toolset matrix (test plan)', () => {
  interface L1Binding {
    scene: SceneKind;
    role: RoleId;
    /** Expected packs the linked role exposes: [] = all installed (no filter). */
    toolset: string[];
    kbScope: string | null;
  }
  const MATRIX: L1Binding[] = [
    { scene: 'notes', role: 'kb-assistant', toolset: [], kbScope: null },
    { scene: 'tables', role: 'kb-assistant', toolset: [], kbScope: null },
    {
      scene: 'coding',
      role: 'code-companion',
      toolset: ['dev-box', 'git-box', 'cf-workers', 'disk-box'],
      kbScope: null,
    },
  ];

  it.each(MATRIX)(
    'L1 "$scene" links role "$role" with the expected toolset + kbScope',
    ({ scene, role, toolset, kbScope }) => {
      expect(roleForScene(scene)).toBe(role);
      const r = roleById(role);
      expect(r.toolset).toEqual(toolset);
      expect(r.kbScope).toBe(kbScope);
    },
  );

  it('L1 entries with no role binding keep the current role', () => {
    // null scene stands in for irisy / discover / settings / feature-pack:
    // roleForScene returns null, so AmbientHome leaves roleId untouched.
    expect(roleForScene(null)).toBeNull();
  });

  it('every role is reachable: scene-linked, pack-linked, or manual-only', () => {
    const sceneLinked = new Set(MATRIX.map((m) => m.role));
    // tool-maker is intentionally manual-only (no L1 / pack link — reached via
    // the switcher / Discover). Everything else must be reachable some way.
    const manualOnly = new Set<RoleId>(['tool-maker']);
    for (const r of ROLES) {
      const packLinked = r.toolset.length > 0; // reachable via roleForPack
      expect(sceneLinked.has(r.id) || packLinked || manualOnly.has(r.id)).toBe(true);
    }
  });
});

describe('inKbScope (relatively independent knowledge bases)', () => {
  it('null scope spans the whole vault (every path is in scope)', () => {
    const kb = roleById('kb-assistant');
    expect(kb.kbScope).toBeNull();
    expect(inKbScope(kb, 'anything/at/all.md')).toBe(true);
  });
  it('the Stocks data role is scoped to Stocks/ (worked example)', () => {
    const stocks = roleById('stocks');
    expect(stocks.kbScope).toBe('Stocks');
    expect(stocks.toolset).toEqual(['ghostfolio']);
    expect(inKbScope(stocks, 'Stocks/aapl.md')).toBe(true);
    expect(inKbScope(stocks, 'Stocks')).toBe(true);
    expect(inKbScope(stocks, 'Notes/diary.md')).toBe(false);
    // No false prefix match: "StocksOld/" must not count as inside "Stocks".
    expect(inKbScope(stocks, 'StocksOld/x.md')).toBe(false);
  });
});

describe('kbScopeAmbient', () => {
  it('returns null when the role spans the whole vault', () => {
    expect(kbScopeAmbient(roleById('kb-assistant'))).toBeNull();
  });
  it('emits a scoped context line when kbScope is set (e.g. a stocks role)', () => {
    const stocks: Role = { ...roleById('kb-assistant'), id: 'kb-assistant', kbScope: 'Stocks' };
    const line = kbScopeAmbient(stocks);
    expect(line).toContain('Stocks');
    expect(line).toMatch(/knowledge base/i);
  });
});
