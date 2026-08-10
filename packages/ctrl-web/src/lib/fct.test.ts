// FCT override contract. The properties under test are the ones ADR-003 §8.5
// v42 actually constrains: Auto is the resting state, the panel is bounded, the
// full catalogue stays in Library, and the safe default changes nothing.
// (ADR-003 frontend §8.5 v42; ADR-005 irisy §12 v42 U17)

import { describe, expect, it } from 'vitest';
import {
  fctChoiceFact,
  fctOptionSelection,
  fctOwnership,
  FCT_AUTO_OPTION,
  FCT_KEEP_OPTION,
  FCT_LIBRARY_OPTION,
  type FctItem,
} from './fct';
import { safeDefaultOption } from './decision-registry';

const item = (name: string, overrides: Partial<FctItem> = {}): FctItem => ({
  ref: `pack:${name.toLowerCase().replace(/\s+/g, '-')}`,
  name,
  summary: `${name} summary`,
  source_kind: 'package',
  install_state: 'installed',
  selection_kind: 'selectable',
  ...overrides,
});

describe('fctChoiceFact', () => {
  it('serves U17 through the choice kind', () => {
    const fact = fctChoiceFact([], '');
    expect(fact.kind).toBe('choice');
    expect(fact.intent).toBe('U17');
  });

  it('states Auto as the current selection when nothing is overridden', () => {
    const fact = fctChoiceFact([item('Alpha')], '');
    expect(fact.facts).toEqual(
      expect.arrayContaining([{ label: 'Current', value: 'Auto' }]),
    );
    // With nothing overridden there is no Auto option to return to.
    expect(fact.options.map((option) => option.id)).not.toContain(FCT_AUTO_OPTION);
  });

  it('offers a way back to Auto once an FCT is selected', () => {
    const alpha = item('Alpha');
    const fact = fctChoiceFact([alpha], alpha.ref);
    expect(fact.options.map((option) => option.id)).toContain(FCT_AUTO_OPTION);
    expect(fact.facts).toEqual(
      expect.arrayContaining([{ label: 'Current', value: 'Alpha' }]),
    );
  });

  it('defaults to an option that changes nothing', () => {
    const alpha = item('Alpha');
    const fact = fctChoiceFact([alpha], alpha.ref);
    expect(safeDefaultOption(fact)?.id).toBe(FCT_KEEP_OPTION);
    expect(fctOptionSelection(FCT_KEEP_OPTION)).toBeUndefined();
  });

  it('never re-offers the FCT already in use', () => {
    const alpha = item('Alpha');
    const fact = fctChoiceFact([alpha, item('Beta')], alpha.ref);
    const selections = fact.options.map((option) => fctOptionSelection(option.id));
    expect(selections).not.toContain(alpha.ref);
  });

  it('excludes items the catalogue says are not selectable', () => {
    const broken = item('Broken', { selection_kind: 'unavailable' });
    const fact = fctChoiceFact([item('Alpha'), broken], '');
    const selections = fact.options.map((option) => fctOptionSelection(option.id));
    expect(selections).not.toContain(broken.ref);
  });

  it('bounds the shortlist and defers the rest to Library, saying how many', () => {
    const items = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name) => item(name));
    const fact = fctChoiceFact(items, '', 3);
    const offered = fact.options
      .map((option) => fctOptionSelection(option.id))
      .filter((ref): ref is string => typeof ref === 'string');
    expect(offered).toHaveLength(3);
    const library = fact.options.find((option) => option.id === FCT_LIBRARY_OPTION);
    expect(library?.label).toBe('Browse all 7 in Library');
    expect(library?.consequence).toBe('navigates');
  });

  it('always keeps Library reachable even when everything fits', () => {
    const fact = fctChoiceFact([item('Alpha')], '');
    expect(fact.options.find((option) => option.id === FCT_LIBRARY_OPTION)?.label).toBe(
      'Browse in Library',
    );
  });

  it('orders the shortlist by name so the panel is stable between opens', () => {
    const fact = fctChoiceFact([item('Zulu'), item('Alpha')], '');
    const labels = fact.options
      .filter((option) => typeof fctOptionSelection(option.id) === 'string')
      .map((option) => option.label);
    expect(labels).toEqual(['Alpha', 'Zulu']);
  });
});

describe('fctOptionSelection', () => {
  it('maps Auto to a cleared selection rather than a ref', () => {
    expect(fctOptionSelection(FCT_AUTO_OPTION)).toBeNull();
  });

  it('maps a use option back to its exact ref', () => {
    expect(fctOptionSelection('fct:use:pack:alpha')).toBe('pack:alpha');
  });

  it('does not treat browsing as a selection', () => {
    expect(fctOptionSelection(FCT_LIBRARY_OPTION)).toBeUndefined();
  });
});

describe('availability state', () => {
  it('names ownership so the user can tell what Remove would delete', () => {
    expect(fctOwnership(item('Alpha'))).toBe('Installed package');
    expect(fctOwnership(item('Beta', { source_kind: 'skill' }))).toBe('Local Skill');
    // An unknown source is reported verbatim rather than mislabelled.
    expect(fctOwnership(item('Gamma', { source_kind: 'builtin' }))).toBe('builtin');
  });

  it('drops a disabled capability from the override panel', () => {
    const off = item('Off', { selection_kind: 'disabled', enabled: false });
    const fact = fctChoiceFact([item('On'), off], '');
    const selections = fact.options.map((option) => fctOptionSelection(option.id));
    expect(selections).not.toContain(off.ref);
    expect(selections).toContain('pack:on');
  });

  it('counts only selectable items when deciding whether to defer to Library', () => {
    const items = [
      item('A'),
      item('B'),
      item('C', { selection_kind: 'disabled', enabled: false }),
    ];
    const fact = fctChoiceFact(items, '', 5);
    expect(fact.options.find((option) => option.id === FCT_LIBRARY_OPTION)?.label).toBe(
      'Browse in Library',
    );
  });
});
