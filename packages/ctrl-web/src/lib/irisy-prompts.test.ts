// P3 — Irisy system-prompt assembly + persona voice constraints.
//
// SC2: the prompt the runtime ships per turn is assembled correctly
//      (PROMPT_VERSION pin, brain_state block, SOUL.md core-memory injection).
// SC4: the reply constraints that decide "is the reply correct" (no
//      sycophancy / no codename leak / no planner scaffold / brief) actually
//      live in IRISY_SYSTEM_DEFAULT. The model's runtime adherence is an e2e
//      concern (GOAL.md SC12); here we verify the constraints are present in
//      the prompt the model receives.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PROMPT_VERSION,
  IRISY_SYSTEM_DEFAULT,
  renderTemplate,
  formatBrainStateBlock,
  composeSystemPrompt,
  type BrainState,
} from './irisy-prompts';

describe('PROMPT_VERSION (P3 — re-seed pin)', () => {
  it('is pinned to 11 (bump when IRISY_SYSTEM_DEFAULT changes)', () => {
    expect(PROMPT_VERSION).toBe(11);
  });
});

describe('IRISY_SYSTEM_DEFAULT — persona voice constraints (SC4)', () => {
  it('bans sycophantic openers (Great question / Sure! / Of course)', () => {
    expect(IRISY_SYSTEM_DEFAULT).toContain('No sycophancy');
    expect(IRISY_SYSTEM_DEFAULT).toMatch(/Never open with/);
    expect(IRISY_SYSTEM_DEFAULT).toContain('Sure!');
  });

  it('forbids emitting planner scaffolds (Goal / Progress / Done / Next Steps)', () => {
    expect(IRISY_SYSTEM_DEFAULT).toMatch(/Output planner scaffolds \(Goal/);
  });

  it('forbids leaking internal names (Pi / providers / MCP / kernel)', () => {
    expect(IRISY_SYSTEM_DEFAULT).toMatch(/no Pi, providers, MCP, kernel/);
  });

  it('mandates brevity — one short paragraph by default, no help-trailer', () => {
    expect(IRISY_SYSTEM_DEFAULT).toContain('Brief over elaborate');
    expect(IRISY_SYSTEM_DEFAULT).toMatch(/let me know if you need more help/);
  });

  it('leads with the concrete user-facing faces (v10 intro: Notes + Coding)', () => {
    expect(IRISY_SYSTEM_DEFAULT).toContain('Notes');
    expect(IRISY_SYSTEM_DEFAULT).toContain('Coding');
  });
});

describe('renderTemplate', () => {
  it('substitutes {{var}} placeholders', () => {
    expect(renderTemplate('hi {{name}}', { name: 'bao' })).toBe('hi bao');
  });

  it('leaves unmatched placeholders intact so the caller sees what was expected', () => {
    expect(renderTemplate('hi {{missing}}', {})).toBe('hi {{missing}}');
  });
});

describe('formatBrainStateBlock (P3 — brain_state injection)', () => {
  const base: BrainState = {
    engine: { id: 'Hermes', version: '0.3', healthy: true, last_token_ms: null },
    providers: {
      'irisy.primary': {
        id: 'volc',
        label: 'CTRL Cloud',
        endpoint: null,
        binary: null,
        healthy: true,
        managed_by: 'ctrl',
      },
    },
    last_failover: null,
  };

  it('wraps the snapshot in <brain_state> tags', () => {
    const out = formatBrainStateBlock(base);
    expect(out.startsWith('<brain_state>')).toBe(true);
    expect(out.trimEnd().endsWith('</brain_state>')).toBe(true);
  });

  it('renders the engine line and the primary provider brand label', () => {
    const out = formatBrainStateBlock(base);
    expect(out).toContain('engine: id=Hermes version=0.3 healthy=true');
    expect(out).toContain('irisy.primary: CTRL Cloud');
  });

  it('marks a missing fallback role as (unconfigured)', () => {
    expect(formatBrainStateBlock(base)).toContain('irisy.fallback: (unconfigured)');
  });

  it('renders a failover transition when one fired', () => {
    const out = formatBrainStateBlock({
      ...base,
      last_failover: { from: 'volc', to: 'ollama', reason: 'timeout' },
    });
    expect(out).toContain('last_failover: from=volc to=ollama reason=timeout');
  });

  it('says "none" when no failover fired this session', () => {
    expect(formatBrainStateBlock(base)).toContain('last_failover: none');
  });
});

describe('loadIrisySystemPromptWithSoul (P3 — SOUL.md core-memory injection)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('falls back to the base persona when SOUL.md is absent', async () => {
    vi.doMock('./bridge', () => ({
      invoke: vi.fn().mockRejectedValue(new Error('no kernel')),
    }));
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn().mockRejectedValue(new Error('no kernel')),
    }));
    const mod = await import('./irisy-prompts');
    const out = await mod.loadIrisySystemPromptWithSoul();
    expect(out).toBe(mod.IRISY_SYSTEM_DEFAULT);
  });

  it('prepends the SOUL.md core-memory block (body + x-ctrl frontmatter) when present', async () => {
    vi.doMock('./bridge', () => ({
      invoke: vi.fn().mockRejectedValue(new Error('no vault prompt')),
    }));
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn().mockResolvedValue({
        path: 'irisy/SOUL.md',
        frontmatter: { 'x-ctrl:tone': 'brief' },
        body: 'Core: bao prefers path:line citations.',
        soul_md_version: '1.0',
      }),
    }));
    const mod = await import('./irisy-prompts');
    const out = await mod.loadIrisySystemPromptWithSoul();
    expect(out).toContain('## Core memory (vault/irisy/SOUL.md)');
    expect(out).toContain('Core: bao prefers path:line citations.');
    expect(out).toContain('x-ctrl:tone');
  });
});

describe('composeSystemPrompt (P3 — shared assembly, brain_state re-wired)', () => {
  const brain: BrainState = {
    engine: { id: 'Hermes', version: '0.3', healthy: true, last_token_ms: null },
    providers: {
      'irisy.primary': {
        id: 'volc',
        label: 'CTRL Cloud',
        endpoint: null,
        binary: null,
        healthy: true,
        managed_by: 'ctrl',
      },
    },
    last_failover: null,
  };

  it('always leads with the persona base', () => {
    expect(composeSystemPrompt({ base: 'PERSONA-BASE' })).toContain('PERSONA-BASE');
  });

  it('injects the brain_state block when provided (fixes P-2 "which model")', () => {
    const out = composeSystemPrompt({ base: 'P', brainState: brain });
    expect(out).toContain('<brain_state>');
    expect(out).toContain('irisy.primary: CTRL Cloud');
  });

  it('omits brain_state when null so it degrades cleanly offline', () => {
    expect(composeSystemPrompt({ base: 'P', brainState: null })).not.toContain(
      '<brain_state>',
    );
  });

  it('appends core/long-term memory and the installed-mcps list when present', () => {
    const out = composeSystemPrompt({
      base: 'P',
      coreMemory: 'CM-FACT',
      longTermMemory: 'LTM-FACT',
      mcps: [{ id: 'k1', name: 'Slides', icon: 'x', mcp_color: 'red' }],
    });
    expect(out).toContain('# Core memory');
    expect(out).toContain('CM-FACT');
    expect(out).toContain('# Long-term memory');
    expect(out).toContain('# Installed mcps (1)');
    expect(out).toContain('k1');
  });

  it('shows the empty-mcps hint when given an empty array', () => {
    expect(composeSystemPrompt({ base: 'P', mcps: [] })).toContain('none yet');
  });
});
