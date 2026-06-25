#!/usr/bin/env node
// bump-version — bump the app version in the 4 places that must stay in
// sync, so every change ships a visibly different version number (bao
// 2026-06-11: bump the version on every change so it is obvious from the
// running window whether the build is new).
//
// The UI shows __APP_VERSION__, defined from packages/ctrl-web/package.json
// at build time (vite.config.ts), surfaced in Settings -> Logs. Keeping all
// four in lockstep means the number in the window === the code you built.
//
// Usage:
//   node scripts/bump-version.mjs            # bump patch (0.1.188 -> 0.1.189)
//   node scripts/bump-version.mjs minor      # 0.1.x -> 0.2.0
//   node scripts/bump-version.mjs 0.2.5      # set explicit version
//   node scripts/bump-version.mjs --print    # show current, no change

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// [path, kind] — json edits the "version" field, toml edits the first
// top-level `version = "..."` line, lock edits the `ctrl` package version
// in Cargo.lock (keeps the lockfile in sync with Cargo.toml so the working
// tree stays clean after every bump).
const TARGETS = [
  ['package.json', 'json'],
  ['packages/ctrl-web/package.json', 'json'],
  ['src-tauri/tauri.conf.json', 'json'],
  ['src-tauri/Cargo.toml', 'toml'],
  ['src-tauri/Cargo.lock', 'lock'],
];

function readVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

function nextVersion(current, arg) {
  if (arg === '--print') return current;
  if (arg && /^\d+\.\d+\.\d+/.test(arg)) return arg; // explicit
  const [maj, min, pat] = current.split('.').map((n) => parseInt(n, 10));
  if (arg === 'major') return `${maj + 1}.0.0`;
  if (arg === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`; // patch (default)
}

function applyJson(file, version) {
  const path = join(ROOT, file);
  const text = readFileSync(path, 'utf8');
  // Replace only the first top-level "version": "..." to avoid touching
  // nested deps. JSON files here put it at the top object level.
  const next = text.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${version}"`);
  writeFileSync(path, next);
}

function applyToml(file, version) {
  const path = join(ROOT, file);
  const text = readFileSync(path, 'utf8');
  const next = text.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
  writeFileSync(path, next);
}

function applyLock(file, version) {
  const path = join(ROOT, file);
  const text = readFileSync(path, 'utf8');
  // Update the version of the `ctrl` workspace package. Cargo.lock has a
  // `[[package]]` block whose `name = "ctrl"` is immediately followed by
  // its `version = "..."`. The name+version adjacency is unique in the
  // lockfile, so this won't touch dependency versions.
  const next = text.replace(
    /(name = "ctrl"\nversion = )"[^"]+"/,
    `$1"${version}"`
  );
  writeFileSync(path, next);
}

const arg = process.argv[2];
const current = readVersion();

if (arg === '--print') {
  console.log(current);
  process.exit(0);
}

const version = nextVersion(current, arg);
for (const [file, kind] of TARGETS) {
  if (kind === 'json') applyJson(file, version);
  else if (kind === 'toml') applyToml(file, version);
  else if (kind === 'lock') applyLock(file, version);
}
console.log(`version: ${current} -> ${version}`);
