#!/usr/bin/env node
// Hash npm's install-relevant lock graph while excluding only the three app
// version fields managed by bump-version.mjs. A release-only version bump must
// not invalidate unchanged installed dependencies. (ADR-004 cap § updater v9)

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const input = process.argv[2] ?? 'package-lock.json';
const text = input === '-' ? readFileSync(0, 'utf8') : readFileSync(input, 'utf8');
const lock = JSON.parse(text);

const rootPackage = lock.packages?.[''];
const webPackage = lock.packages?.['packages/ctrl-web'];
if (!rootPackage || !webPackage) {
  throw new Error('package-lock.json is missing CTRL workspace metadata');
}

delete lock.version;
delete rootPackage.version;
delete webPackage.version;

const hash = createHash('sha256').update(JSON.stringify(lock)).digest('hex');
process.stdout.write(`${hash}\n`);
