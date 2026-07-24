#!/usr/bin/env node
// bump-version — bump the app version in every release metadata file that must
// stay in sync, so every change ships a visibly different version number (bao
// 2026-06-11: bump the version on every change so it is obvious from the
// running window whether the build is new).
//
// The UI shows __APP_VERSION__, defined from packages/ctrl-web/package.json
// at build time (vite.config.ts), surfaced in Settings -> Logs. Keeping all
// release manifests and lockfiles in lockstep means the displayed version is
// reproducible from one committed source tree. (ADR-004 cap § updater v6)
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

// [path, kind] — json edits the top-level version, npm-lock edits only the
// root and @ctrl/web workspace package versions, toml edits the package
// version, and lock edits only the `ctrl` package version in Cargo.lock.
const TARGETS = [
  ['package.json', 'json'],
  ['packages/ctrl-web/package.json', 'json'],
  ['package-lock.json', 'npm-lock'],
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
  if (arg && /^\d+\.\d+\.\d+$/.test(arg)) return arg;
  const [maj, min, pat] = current.split('.').map((n) => parseInt(n, 10));
  if (arg === 'major') return `${maj + 1}.0.0`;
  if (arg === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

function replaceRequired(text, pattern, replacement, label) {
  const next = text.replace(pattern, replacement);
  if (next === text) {
    throw new Error(`Could not update ${label}`);
  }
  return next;
}

function applyJson(file, version) {
  const path = join(ROOT, file);
  const text = readFileSync(path, 'utf8');
  const next = replaceRequired(
    text,
    /("version"\s*:\s*)"[^"]+"/,
    `$1"${version}"`,
    `${file} version`
  );
  writeFileSync(path, next);
}

function applyNpmLock(file, version) {
  const path = join(ROOT, file);
  let text = readFileSync(path, 'utf8');
  text = replaceRequired(
    text,
    /^(  "version": )"[^"]+"/m,
    `$1"${version}"`,
    `${file} top-level version`
  );
  text = replaceRequired(
    text,
    /("": \{\n\s+"name": "ctrl",\n\s+"version": )"[^"]+"/,
    `$1"${version}"`,
    `${file} root workspace version`
  );
  text = replaceRequired(
    text,
    /("packages\/ctrl-web": \{\n\s+"name": "@ctrl\/web",\n\s+"version": )"[^"]+"/,
    `$1"${version}"`,
    `${file} web workspace version`
  );
  writeFileSync(path, text);
}

function applyToml(file, version) {
  const path = join(ROOT, file);
  const text = readFileSync(path, 'utf8');
  const next = replaceRequired(
    text,
    /^version\s*=\s*"[^"]+"/m,
    `version = "${version}"`,
    `${file} package version`
  );
  writeFileSync(path, next);
}

function applyLock(file, version) {
  const path = join(ROOT, file);
  const text = readFileSync(path, 'utf8');
  const next = replaceRequired(
    text,
    /(name = "ctrl"\nversion = )"[^"]+"/,
    `$1"${version}"`,
    `${file} ctrl package version`
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
  else if (kind === 'npm-lock') applyNpmLock(file, version);
  else if (kind === 'toml') applyToml(file, version);
  else if (kind === 'lock') applyLock(file, version);
}
console.log(`version: ${current} -> ${version}`);
