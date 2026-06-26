import { describe, it, expect } from 'vitest';
import {
  ROLES,
  DEFAULT_ROLE_ID,
  roleById,
  roleForScene,
  packsForRole,
  kbScopeAmbient,
  type Role,
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
