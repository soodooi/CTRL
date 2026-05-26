// pi-detect — locate the user's `pi` binary (badlogic/pi-mono coding agent).
//
// Discovery order (first hit wins):
//   1. $CTRL_PI_BIN env var (explicit override)
//   2. $PATH lookup via `which pi`
//   3. ~/.local/bin/pi (default for `npm i -g --prefix ~/.local`)
//   4. `npx pi` (lazy resolve through npm registry)
//
// Per CTRL Obsidian philosophy: never bundle the agent runtime. Pi is a
// user-owned tool the user installs once (`npm i -g @earendil-works/pi-coding-agent`).
// We just locate it and pipe through.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface PiBinary {
  /** Resolved invocation. `command` + `args` form the spawn prefix. */
  command: string;
  args: string[];
  /** How we found it — surfaces in healthz + diagnostics. */
  via: 'env' | 'path' | 'home_local' | 'npx';
  /** Version string from `pi --version` (best-effort; empty on failure). */
  version: string;
}

export class PiNotFoundError extends Error {
  readonly searched: string[];

  constructor(searched: string[]) {
    super(
      'pi binary not found. Install with `npm i -g @earendil-works/pi-coding-agent` ' +
        'or `npx pi` (one-time download). ' +
        `Searched: ${searched.join(', ')}.`,
    );
    this.name = 'PiNotFoundError';
    this.searched = searched;
  }
}

const PI_ENV_VAR = 'CTRL_PI_BIN';
const HOME_LOCAL_PI = join(homedir(), '.local', 'bin', 'pi');

/**
 * Locate the Pi binary. Throws `PiNotFoundError` with a list of searched
 * paths when no candidate is usable. The MCP server returns this error to
 * the PWA so the user gets a clear install hint instead of an opaque 500.
 */
export function detectPi(): PiBinary {
  const searched: string[] = [];

  // 1. explicit env override.
  const envBin = process.env[PI_ENV_VAR];
  if (envBin && envBin.length > 0) {
    searched.push(`$${PI_ENV_VAR}=${envBin}`);
    if (canExecute(envBin)) {
      return finalise({ command: envBin, args: [], via: 'env' });
    }
  }

  // 2. PATH lookup.
  const pathHit = whichPi();
  searched.push(pathHit ? `$PATH:${pathHit}` : '$PATH (no pi)');
  if (pathHit) {
    return finalise({ command: pathHit, args: [], via: 'path' });
  }

  // 3. ~/.local/bin/pi
  searched.push(HOME_LOCAL_PI);
  if (existsSync(HOME_LOCAL_PI) && canExecute(HOME_LOCAL_PI)) {
    return finalise({ command: HOME_LOCAL_PI, args: [], via: 'home_local' });
  }

  // 4. npx pi (still works if npm is installed; we don't pre-validate
  //    because `which npx` ≠ `npx pi`).
  const npxHit = whichBin('npx');
  searched.push(npxHit ? `npx pi (via ${npxHit})` : 'npx (not installed)');
  if (npxHit) {
    return finalise({ command: npxHit, args: ['pi'], via: 'npx' });
  }

  throw new PiNotFoundError(searched);
}

function canExecute(path: string): boolean {
  try {
    const r = spawnSync(path, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
    });
    // Treat exit 0 OR any stdout/stderr emission as evidence the binary
    // ran. Pi may print version on stderr depending on version.
    if (r.error) return false;
    if (r.status === 0) return true;
    const stdoutLen = r.stdout ? (r.stdout as Buffer).length : 0;
    const stderrLen = r.stderr ? (r.stderr as Buffer).length : 0;
    return stdoutLen + stderrLen > 0;
  } catch {
    return false;
  }
}

function whichPi(): string | null {
  return whichBin('pi');
}

function whichBin(name: string): string | null {
  const r = spawnSync('command', ['-v', name], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: '/bin/sh',
    timeout: 3_000,
  });
  if (r.status !== 0) return null;
  const out = (r.stdout ?? '').toString().trim();
  return out.length > 0 ? out : null;
}

function finalise(partial: Omit<PiBinary, 'version'>): PiBinary {
  const version = readPiVersion(partial.command, partial.args);
  return { ...partial, version };
}

function readPiVersion(command: string, args: string[]): string {
  try {
    const r = spawnSync(command, [...args, '--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
    });
    const out = (r.stdout ?? '').toString().trim();
    if (out.length > 0) return out.split('\n')[0]!;
    const err = (r.stderr ?? '').toString().trim();
    return err.split('\n')[0] ?? '';
  } catch {
    return '';
  }
}
