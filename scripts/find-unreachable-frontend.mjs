#!/usr/bin/env node
// Reachability analysis over the PWA module graph.
//
// Written because "is this file still used?" was being answered by grepping for
// the symbol name, which cannot distinguish a live import from one dead module
// importing another. This walks the real import graph from the single browser
// entry, so an island of files that only import each other is correctly reported
// as unreachable.
//
// Static analysis, deliberately: it resolves `import`, `export ... from`, and
// `import(...)` specifiers. A module reached only through a runtime string would
// not be found, so the output is a CANDIDATE list to verify, not a delete script.
// (ADR-003 frontend §8.5 v40)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'packages/ctrl-web');
const srcRoot = join(root, 'src');
const entries = [join(srcRoot, 'main.tsx')];

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const CODE = new Set(EXTENSIONS);

/** Every specifier this file imports, including dynamic and re-exports. */
function specifiersOf(source) {
  const found = new Set();
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

function resolveSpecifier(fromFile, specifier) {
  let base;
  if (specifier.startsWith('@/')) base = join(srcRoot, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null; // package import

  const candidates = [
    base,
    ...EXTENSIONS.map((extension) => `${base}${extension}`),
    ...EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

const reachable = new Set();
const queue = [...entries];
while (queue.length > 0) {
  const file = queue.pop();
  if (reachable.has(file)) continue;
  reachable.add(file);
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const specifier of specifiersOf(source)) {
    const target = resolveSpecifier(file, specifier);
    if (target && !reachable.has(target)) queue.push(target);
  }
}

function walk(directory, out = []) {
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    const info = statSync(full);
    if (info.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const all = walk(srcRoot).filter((file) => {
  const dot = file.lastIndexOf('.');
  const extension = dot < 0 ? '' : file.slice(dot);
  if (!CODE.has(extension)) return false;
  // Tests and type declarations are not product modules.
  if (/\.(test|spec)\.[tj]sx?$/.test(file)) return false;
  if (file.endsWith('.d.ts')) return false;
  return true;
});

const unreachable = all.filter((file) => !reachable.has(file)).sort();
console.log(`entry: ${entries.map((file) => relative(root, file)).join(', ')}`);
console.log(`reachable modules: ${reachable.size}`);
console.log(`unreachable candidates: ${unreachable.length}`);
for (const file of unreachable) console.log(`  ${relative(root, file)}`);
