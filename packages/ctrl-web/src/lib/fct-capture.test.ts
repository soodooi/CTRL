// FCT capture contract. The properties that matter: only a verified outcome is
// offered, the derived pack is selectable rather than executable, and the offer
// does not claim to replay anything.
// (ADR-002 substrate §15.4 v84; §15.5 v86; ADR-005 irisy §12 v42 U23)

import { describe, expect, it } from 'vitest';
import {
  capturedFctId,
  capturedFctName,
  outcomeCaptureFact,
  outcomeToFctManifest,
  saveOutcomeAsFct,
  CAPTURE_DISMISS_OPTION,
  CAPTURE_SAVE_OPTION,
  type CapturedOutcome,
} from './fct-capture';
import { safeDefaultOption } from './decision-registry';

const outcome: CapturedOutcome = {
  resource: 'ctrl://local/note/Budget.md',
  target: 'Budget.md',
  verifiedBy: 'post-write reread matched the expected revision',
};

describe('capturedFctName', () => {
  it('reads as a name, not a filename', () => {
    expect(capturedFctName(outcome)).toBe('Budget');
  });

  it('falls back to the ref when the owner gave no target', () => {
    expect(capturedFctName({ ...outcome, target: undefined })).toBe(
      'ctrl://local/note/Budget',
    );
  });

  it('never produces an empty name', () => {
    expect(capturedFctName({ ...outcome, target: '.md' })).toBe('Saved work');
  });
});

describe('capturedFctId', () => {
  it('slugs the name into a stable pack id', () => {
    expect(capturedFctId('Q3 Budget Review')).toBe('fct-q3-budget-review');
  });

  it('stays a valid id when the name has nothing sluggable', () => {
    expect(capturedFctId('***')).toBe('fct-saved-work');
  });
});

describe('outcomeToFctManifest', () => {
  it('carries exactly the Resource that was changed', () => {
    const manifest = outcomeToFctManifest(outcome);
    expect(manifest['resources']).toEqual(['ctrl://local/note/Budget.md']);
  });

  it('declares no actions, so the pack is selectable rather than executable', () => {
    const manifest = outcomeToFctManifest(outcome);
    expect(manifest['actions']).toEqual([]);
    expect(manifest['provision']).toBeUndefined();
    expect(manifest['config_schema']).toBeUndefined();
    expect(manifest['server']).toBeUndefined();
  });

  it('is installable shape: manifest_version 2 with a stable id and name', () => {
    const manifest = outcomeToFctManifest(outcome);
    expect(manifest['manifest_version']).toBe(2);
    expect(manifest['id']).toBe('fct-budget');
    expect(manifest['name']).toBe('Budget');
  });
});

describe('saveOutcomeAsFct', () => {
  it('refuses an unverified outcome rather than saving something unconfirmed', async () => {
    await expect(
      saveOutcomeAsFct({ ...outcome, verifiedBy: '' }),
    ).rejects.toThrow(/only a verified change/);
  });
});

describe('outcomeCaptureFact', () => {
  it('uses the capture kind for U23', () => {
    const fact = outcomeCaptureFact(outcome);
    expect(fact.kind).toBe('capture');
    expect(fact.intent).toBe('U23');
  });

  it('defaults to not saving, because the user just finished something else', () => {
    const fact = outcomeCaptureFact(outcome);
    expect(safeDefaultOption(fact)?.id).toBe(CAPTURE_DISMISS_OPTION);
    expect(fact.options.find((option) => option.id === CAPTURE_SAVE_OPTION)?.consequence).toBe(
      'commits',
    );
  });

  it('states plainly that it will not replay the steps', () => {
    const fact = outcomeCaptureFact(outcome);
    expect(fact.facts).toEqual(
      expect.arrayContaining([
        { label: 'Does not replay', value: 'the steps you just took' },
        { label: 'Brings back', value: 'ctrl://local/note/Budget.md' },
      ]),
    );
  });

  it('shows the kernel verification as a visible fact, not drill-down', () => {
    const fact = outcomeCaptureFact(outcome);
    expect(fact.facts?.some((entry) => entry.label === 'Verified by')).toBe(true);
    expect(fact.provenance ?? []).toEqual([]);
  });
});
