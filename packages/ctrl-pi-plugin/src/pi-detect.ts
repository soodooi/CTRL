// pi-detect — locate the user's `pi` binary (badlogic/pi-mono coding agent).
//
// Discovery order (first hit wins):
//   1. $CTRL_PI_BIN env var (explicit override)
//   2. $PATH lookup (`where` on Windows, `command -v` on unix)
//   3. per-user global install (%APPDATA%\npm\pi.cmd on Windows,
//      ~/.local/bin/pi on unix)
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
const IS_WIN = process.platform === 'win32';

// Per-user global-install locations checked when PATH lookup misses. Windows
// npm puts global bin shims in %APPDATA%\npm (`pi.cmd`); unix npm with
// `--prefix ~/.local` puts them in ~/.local/bin.
const HOME_LOCAL_CANDIDATES: string[] = IS_WIN
  ? [
      join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'pi.cmd'),
      join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'pi.exe'),
    ]
  : [join(homedir(), '.local', 'bin', 'pi')];

// On Windows, npm global bins are `.cmd`/`.bat` shims that Node's spawn can
// only execute through a shell; native `.exe` / unix binaries do not need one.
function needsShell(command: string): boolean {
  return IS_WIN && /\.(cmd|bat)$/i.test(command);
}

// When running through a shell, the command path is concatenated (not escaped),
// so a path with spaces (e.g. `C:\Users\Jane Doe\...`) must be quoted.
function spawnTarget(command: string): { exe: string; shell: boolean } {
  const shell = needsShell(command);
  return { exe: shell ? `"${command}"` : command, shell };
}

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

  // 3. per-user global install location(s).
  for (const candidate of HOME_LOCAL_CANDIDATES) {
    searched.push(candidate);
    if (existsSync(candidate) && canExecute(candidate)) {
      return finalise({ command: candidate, args: [], via: 'home_local' });
    }
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
    const { exe, shell } = spawnTarget(path);
    const r = spawnSync(exe, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
      shell,
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
  // POSIX `command -v` (run through /bin/sh) has no Windows equivalent — use
  // `where`, which prints one match per line. Take the first hit.
  const r = IS_WIN
    ? spawnSync('where', [name], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 3_000,
      })
    : spawnSync('command', ['-v', name], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: '/bin/sh',
        timeout: 3_000,
      });
  if (r.status !== 0) return null;
  const out = (r.stdout ?? '').toString().trim();
  if (out.length === 0) return null;
  const lines = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  if (IS_WIN) {
    // `where` lists every match, including the extensionless unix shim that
    // Windows cannot execute. Prefer a PATHEXT-runnable variant (.cmd/.exe).
    return lines.find((l) => /\.(cmd|exe|bat|com)$/i.test(l)) ?? lines[0]!;
  }
  return lines[0]!;
}

function finalise(partial: Omit<PiBinary, 'version'>): PiBinary {
  const version = readPiVersion(partial.command, partial.args);
  return { ...partial, version };
}

function readPiVersion(command: string, args: string[]): string {
  try {
    const { exe, shell } = spawnTarget(command);
    const r = spawnSync(exe, [...args, '--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
      shell,
    });
    const out = (r.stdout ?? '').toString().trim();
    if (out.length > 0) return out.split('\n')[0]!;
    const err = (r.stderr ?? '').toString().trim();
    return err.split('\n')[0] ?? '';
  } catch {
    return '';
  }
}
