#!/usr/bin/env node
// Apply the vendored upstream's pnpm-format dependency patches (patches/*.patch)
// with plain `patch -p1` — npm has no native pnpm-patch support. Each file is
// named `<scoped__name>@<version>.patch` and is a unified diff relative to the
// package root. Idempotent: `patch` with -N skips already-applied hunks.
// (ADR-002 section 1.9 v47 F3; see UPSTREAM.md.)

import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const patchesDir = join(pkgRoot, 'patches');
// Workspace root node_modules (npm hoists).
const repoRoot = join(pkgRoot, '..', '..');

if (!existsSync(patchesDir)) process.exit(0);

for (const f of readdirSync(patchesDir)) {
  if (!f.endsWith('.patch')) continue;
  // `@blocknote__core@0.46.2.patch` -> package `@blocknote/core`
  const base = f.replace(/\.patch$/, '');
  const at = base.lastIndexOf('@');
  const pkgName = base.slice(0, at).replace('__', '/');
  const candidates = [
    join(repoRoot, 'node_modules', pkgName),
    join(pkgRoot, 'node_modules', pkgName),
  ];
  const target = candidates.find((c) => existsSync(c));
  if (!target) {
    console.warn(`[apply-patches] ${pkgName} not installed; skipping ${f}`);
    continue;
  }
  try {
    execFileSync('patch', ['-p1', '-N', '-r', '-', '-d', target], {
      input: readFileSync(join(patchesDir, f)),
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.log(`[apply-patches] applied ${f}`);
  } catch {
    // -N makes re-runs exit non-zero on already-applied patches; treat as ok.
    console.log(`[apply-patches] ${f}: already applied or partially skipped`);
  }
}
