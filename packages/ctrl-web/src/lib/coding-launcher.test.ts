// selectWorkspaceId / selectTerminalId — the pure fallback-selection helpers
// CodingScene's refresh() delegates to (ADR-001 spine §4 v14; ADR-003 frontend
// §8.5 v28). Extracted so the launcher's cross-refresh selection semantics —
// "keep the current pick if it still exists, else fall back to the first
// available one, else ''" — are unit-testable without a Tauri/WS mock.

import { describe, it, expect, vi } from 'vitest';

vi.mock('./bridge', () => ({ invoke: vi.fn() }));

import { selectTerminalId, selectWorkspaceId } from './coding-launcher';
import type { CodingWorkspace, LauncherTarget } from './coding-launcher';

const workspace = (id: string, opencodeConfigPresent = true): CodingWorkspace => ({
  id,
  label: id,
  path: `/workspace/${id}`,
  opencodeConfigPresent,
});

const target = (id: string, available: boolean): LauncherTarget => ({
  id,
  label: id,
  available,
  supportsCommand: true,
});

describe('selectWorkspaceId', () => {
  it('keeps the current selection when it still exists after refresh', () => {
    const workspaces = [workspace('ctrl'), workspace('ctrl-ghostfolio')];
    expect(selectWorkspaceId('ctrl-ghostfolio', workspaces)).toBe('ctrl-ghostfolio');
  });

  it('falls back to the first workspace (the configured root) when the current one is gone', () => {
    // e.g. a pack was uninstalled between refreshes.
    const workspaces = [workspace('ctrl'), workspace('ctrl-stock-cn')];
    expect(selectWorkspaceId('ctrl-ghostfolio', workspaces)).toBe('ctrl');
  });

  it('returns empty when there are no workspaces yet', () => {
    expect(selectWorkspaceId('ctrl', [])).toBe('');
  });

  it('selects the sole workspace on first load (current starts empty)', () => {
    expect(selectWorkspaceId('', [workspace('ctrl')])).toBe('ctrl');
  });
});

describe('selectTerminalId', () => {
  it('keeps the current terminal when it is still available', () => {
    const terminals = [target('terminal', true), target('iterm2', true)];
    expect(selectTerminalId('iterm2', terminals)).toBe('iterm2');
  });

  it('falls back to the first available terminal when the current one becomes unavailable', () => {
    const terminals = [target('terminal', true), target('iterm2', false)];
    expect(selectTerminalId('iterm2', terminals)).toBe('terminal');
  });

  it('returns empty when no terminal is available', () => {
    const terminals = [target('terminal', false), target('iterm2', false)];
    expect(selectTerminalId('terminal', terminals)).toBe('');
  });

  it('does not resurrect a selection once nothing is available, even if the id matches', () => {
    const terminals = [target('terminal', false)];
    expect(selectTerminalId('terminal', terminals)).toBe('');
  });
});
