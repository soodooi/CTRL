#!/usr/bin/env node
/**
 * Diff-aware repository governance gate.
 *
 * Blocks high-confidence secrets in added lines and requires every substantive
 * architecture hunk to carry a nearby citation that resolves to a real module
 * ADR section/version.
 *
 * Usage:
 *   node scripts/check-governance.mjs
 *   node scripts/check-governance.mjs --worktree
 *   node scripts/check-governance.mjs --base <sha> --head <sha>
 *   node scripts/check-governance.mjs --release-provenance-base <sha> --head <sha>
 *
 * Release mode derives full-delta secret coverage and the forward-effective
 * citation range from one proven source plus the tracked governance policy;
 * callers cannot choose the two ranges independently.
 * (ADR-004 cap § Release governance baselines v7)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const args = process.argv.slice(2);
const valueOptions = new Set(['--base', '--head', '--release-provenance-base']);
const parsedOptions = new Map();
let worktree = false;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--worktree') {
    if (worktree) {
      console.error('[BLOCKED] duplicate option: --worktree');
      process.exit(2);
    }
    worktree = true;
    continue;
  }
  if (!valueOptions.has(arg)) {
    console.error(`[BLOCKED] unknown governance option: ${arg}`);
    process.exit(2);
  }
  if (parsedOptions.has(arg)) {
    console.error(`[BLOCKED] duplicate governance option: ${arg}`);
    process.exit(2);
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`[BLOCKED] missing value for governance option: ${arg}`);
    process.exit(2);
  }
  parsedOptions.set(arg, value);
  index += 1;
}

const requestedBase = parsedOptions.get('--base');
const releaseProvenanceBase = parsedOptions.get('--release-provenance-base');
const requestedHead = parsedOptions.get('--head') ?? 'HEAD';
if (worktree && parsedOptions.size > 0) {
  console.error('[BLOCKED] --worktree cannot be combined with commit-range options');
  process.exit(2);
}
if (requestedBase && releaseProvenanceBase) {
  console.error('[BLOCKED] --base cannot be combined with --release-provenance-base');
  process.exit(2);
}

const governancePolicy = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'governance-policy.json'), 'utf8'));
const citationActivationCommit = governancePolicy.citationActivationCommit;
if (!/^[0-9a-f]{40}$/.test(citationActivationCommit ?? '')) {
  console.error('[BLOCKED] scripts/governance-policy.json has an invalid citationActivationCommit');
  process.exit(2);
}

function git(gitArgs, options = {}) {
  return execFileSync('git', gitArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', options.quiet ? 'ignore' : 'pipe'],
  }).trimEnd();
}

function resolveBase(head, explicitBase) {
  if (explicitBase !== undefined) {
    if (!explicitBase || /^0+$/.test(explicitBase)) {
      console.error(`[BLOCKED] explicit governance base is invalid: ${explicitBase || '<empty>'}`);
      process.exit(2);
    }
    return explicitBase;
  }
  try {
    return git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { quiet: true });
  } catch {}
  try {
    return git(['merge-base', head, 'refs/remotes/origin/main'], { quiet: true });
  } catch {}
  try {
    return git(['rev-parse', `${head}^`], { quiet: true });
  } catch {
    return '';
  }
}

function resolveCommit(revision, label) {
  try {
    return git(['rev-parse', '--verify', `${revision}^{commit}`], { quiet: true });
  } catch {
    console.error(`[BLOCKED] ${label} does not resolve to a commit: ${revision}`);
    process.exit(2);
  }
}

function diffText(explicitBase, label) {
  if (worktree) return git(['diff', '--unified=0', '--no-ext-diff', 'HEAD', '--']);
  const base = resolveBase(requestedHead, explicitBase);
  if (!base) return git(['show', '--format=', '--unified=0', '--no-ext-diff', requestedHead, '--']);
  const baseCommit = resolveCommit(base, `${label} governance base`);
  const headCommit = resolveCommit(requestedHead, 'governance head');
  if (baseCommit === headCommit) {
    console.error(`[BLOCKED] ${label} governance base resolves to head: ${baseCommit}`);
    process.exit(2);
  }
  try {
    git(['merge-base', '--is-ancestor', baseCommit, headCommit], { quiet: true });
  } catch {
    console.error(`[BLOCKED] ${label} governance base is not an ancestor of head: ${baseCommit} !< ${headCommit}`);
    process.exit(2);
  }
  console.log(`[INFO] resolved ${label} governance range: ${baseCommit}...${headCommit}`);
  return git(['diff', '--unified=0', '--no-ext-diff', `${baseCommit}...${headCommit}`, '--']);
}

function parseChangedLines(diff) {
  const files = new Map();
  let file = null;
  let previousFile = null;
  let oldLine = 0;
  let newLine = 0;
  let hunk = 0;
  for (const line of diff.split('\n')) {
    const oldFileMatch = line.match(/^--- a\/(.+)$/);
    if (oldFileMatch) {
      previousFile = oldFileMatch[1];
      continue;
    }
    if (line === '--- /dev/null') {
      previousFile = null;
      continue;
    }
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      file = fileMatch[1];
      hunk = 0;
      if (!files.has(file)) files.set(file, []);
      continue;
    }
    if (line === '+++ /dev/null') {
      file = previousFile;
      hunk = 0;
      if (file && !files.has(file)) files.set(file, []);
      continue;
    }
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      hunk += 1;
      continue;
    }
    if (!file) continue;
    if (line.startsWith('+')) {
      files.get(file).push({ hunk, kind: 'added', line: newLine, oldLine, text: line.slice(1) });
      newLine += 1;
    } else if (line.startsWith('-')) {
      // Anchor a removal at the next surviving new-file line so its nearby
      // current comment can authorize the behavioral deletion.
      files.get(file).push({ hunk, kind: 'removed', line: newLine, oldLine, text: line.slice(1) });
      oldLine += 1;
    } else {
      oldLine += 1;
      newLine += 1;
    }
  }

  if (worktree) {
    let untracked = '';
    try {
      untracked = git(['ls-files', '--others', '--exclude-standard']);
    } catch {}
    for (const candidate of untracked.split('\n').filter(Boolean)) {
      if (!existsSync(candidate)) continue;
      let content;
      try {
        content = readFileSync(candidate, 'utf8');
      } catch {
        continue;
      }
      files.set(candidate, content.split('\n').map((text, index) => ({
        hunk: 1,
        kind: 'added',
        line: index + 1,
        oldLine: 0,
        text,
      })));
    }
  }
  return files;
}

const HIGH_CONFIDENCE_SECRETS = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
];
const SECRET_ASSIGNMENT = /\b(api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password)\b\s*[:=]\s*["'`]([^"'`]{8,})["'`]/i;
const SAFE_LITERAL = /^(?:<|\$\{|process\.env|import\.meta\.env|env::|std::env|os\.environ|mock|test|dummy|example|placeholder|redacted|replace[-_ ]?me|your[-_ ])/i;
const TEST_OR_FIXTURE = /(?:^|\/)(?:tests?|fixtures?|mocks?|examples?)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i;
const LOCKFILE = /(?:package-lock\.json|Cargo\.lock|pnpm-lock\.yaml|yarn\.lock)$/;
const ASSIGNMENT_EXTENSIONS = new Set(['.cjs', '.env', '.go', '.js', '.json', '.jsx', '.mjs', '.py', '.rs', '.toml', '.ts', '.tsx', '.yaml', '.yml']);

const ARCHITECTURE_PATHS = [
  /^src-tauri\/src\/kernel\/.*\.rs$/,
  /^src-tauri\/src\/commands\/(?:provider|irisy|kernel|vault|agents|image|skills)[^/]*\.rs$/,
  /^src-tauri\/src\/shell\/(?:kernel_supervisor|acp_client|agent_installer|agent_launcher)\.rs$/,
  /^packages\/ctrl-web\/src\/routes\/(?:irisy|workbench)\.tsx$/,
  /^packages\/ctrl-web\/src\/components\/irisy\/.*\.(?:ts|tsx)$/,
  /^packages\/ctrl-web\/src\/lib\/(?:kernel|irisy[^/]*)\.ts$/,
  /^packages\/ctrl-mcp-sdk\/src\/.*\.ts$/,
  /^packages\/ctrl-mcps\//,
  /^packages\/ctrl-mesh\//,
  /^worker\/ctrl-relay\/src\//,
  /^worker\/ctrl-relay\/wrangler\.toml$/,
  /^scripts\/release\.sh$/,
];
const ADR_PROXIMITY_LINES = 12;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.go', '.js', '.jsx', '.mjs', '.py', '.rs', '.sh', '.toml', '.ts', '.tsx']);
const ADR_DIRECTORY = join(process.cwd(), 'vault', 'ctrl', 'adrs');
const ADR_CITATION_PATTERN = /ADR-(\d{3})\s+([a-z-]+)\s+§\s*([^\n)]*?)\s+v(\d+)\b/gi;

function normalize(value) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[`*_~§()[\]{}:;,.—–/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadAdrRegistry() {
  const registry = new Map();
  for (const name of readdirSync(ADR_DIRECTORY).filter((entry) => /^\d{3}-.*\.md$/.test(entry))) {
    const content = readFileSync(join(ADR_DIRECTORY, name), 'utf8');
    const id = content.match(/^adr_id:\s*(\d{3})\s*$/m)?.[1];
    const module = content.match(/^module:\s*([a-z-]+)\s*$/m)?.[1];
    const currentVersion = content.match(/^version:\s*(\d+)\s*$/m)?.[1];
    if (!id || !module || !currentVersion) continue;
    const versions = new Set([currentVersion]);
    const versionEntries = new Map();
    for (const match of content.matchAll(/^\s*-\s+v(\d+)\b([^\n]*)/gm)) {
      versions.add(match[1]);
      versionEntries.set(match[1], normalize(match[2]));
    }
    const headings = [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => normalize(match[1]));
    registry.set(id, { content, currentVersion, headings, module, versionEntries, versions });
  }
  return registry;
}

const adrRegistry = loadAdrRegistry();

function citationResolution(text) {
  const failures = [];
  let sawCitation = false;
  for (const match of text.matchAll(ADR_CITATION_PATTERN)) {
    sawCitation = true;
    const [, id, module, section, version] = match;
    const adr = adrRegistry.get(id);
    if (!adr) {
      failures.push(`ADR-${id} does not exist`);
      continue;
    }
    if (adr.module !== module.toLowerCase()) {
      failures.push(`ADR-${id} module is ${adr.module}, not ${module}`);
      continue;
    }
    if (!adr.versions.has(version)) {
      failures.push(`ADR-${id} v${version} is not recorded`);
      continue;
    }
    const normalizedSection = normalize(section);
    if (!normalizedSection || !adr.headings.some((heading) => heading.includes(normalizedSection))) {
      failures.push(`ADR-${id} section '${section.trim()}' does not resolve to a heading`);
      continue;
    }
    const versionEntry = adr.versionEntries.get(version);
    if (!versionEntry) {
      failures.push(`ADR-${id} v${version} has no changelog entry binding it to a section`);
      continue;
    }
    if (!versionEntry.includes(normalizedSection)) {
      failures.push(`ADR-${id} v${version} changelog does not amend section '${section.trim()}'`);
    }
  }
  if (!sawCitation) {
    return { valid: false, failures: ['no citation in hunk/proximity window'] };
  }
  return { valid: failures.length === 0, failures };
}

function substantive(lines) {
  return lines.filter(({ text }) => {
    const value = text.trim();
    return value
      && !value.startsWith('//')
      && !value.startsWith('/*')
      && !value.startsWith('*')
      && !value.startsWith('#')
      && !value.startsWith('import ')
      && !/^[{}()[\],;]+$/.test(value);
  });
}

const releaseMode = Boolean(releaseProvenanceBase);
let secretFiles;
let citationFiles;
if (releaseMode) {
  const provenanceCommit = resolveCommit(releaseProvenanceBase, 'release provenance base');
  const epochCommit = resolveCommit(citationActivationCommit, 'citation activation commit');
  const citationBase = (() => {
    try {
      git(['merge-base', '--is-ancestor', epochCommit, provenanceCommit], { quiet: true });
      return provenanceCommit;
    } catch {
      return epochCommit;
    }
  })();
  secretFiles = parseChangedLines(diffText(provenanceCommit, 'secret'));
  citationFiles = parseChangedLines(diffText(citationBase, 'citation'));
} else {
  const combinedFiles = parseChangedLines(diffText(requestedBase, 'combined'));
  secretFiles = combinedFiles;
  citationFiles = combinedFiles;
}
const changedFiles = new Set([...secretFiles.keys(), ...citationFiles.keys()]);
const secretFindings = [];
const adrFindings = [];

for (const [file, lines] of secretFiles) {
  if (LOCKFILE.test(file)) continue;

  // Secrets are meaningful only on newly introduced text. Removed literals are
  // intentionally ignored so deleting a leaked credential is never blocked.
  for (const added of lines.filter(({ kind }) => kind === 'added')) {
    for (const [kind, pattern] of HIGH_CONFIDENCE_SECRETS) {
      if (pattern.test(added.text)) secretFindings.push({ file, ...added, kind });
    }
    const assignment = added.text.match(SECRET_ASSIGNMENT);
    if (assignment && ASSIGNMENT_EXTENSIONS.has(extname(file)) && !TEST_OR_FIXTURE.test(file) && !SAFE_LITERAL.test(assignment[2])) {
      secretFindings.push({ file, ...added, kind: `literal ${assignment[1]}` });
    }
  }
}

for (const [file, lines] of citationFiles) {
  if (LOCKFILE.test(file)) continue;
  if (!SOURCE_EXTENSIONS.has(extname(file))) continue;
  if (!ARCHITECTURE_PATHS.some((pattern) => pattern.test(file))) continue;

  const byHunk = new Map();
  for (const changedLine of lines) {
    if (!byHunk.has(changedLine.hunk)) byHunk.set(changedLine.hunk, []);
    byHunk.get(changedLine.hunk).push(changedLine);
  }

  let contentLines = [];
  if (existsSync(file)) {
    try {
      contentLines = readFileSync(file, 'utf8').split('\n');
    } catch {}
  }

  const missingHunks = [];
  let substantiveLineCount = 0;
  for (const [hunk, hunkLines] of byHunk) {
    const substantiveLines = substantive(hunkLines);
    if (substantiveLines.length === 0) continue;
    substantiveLineCount += substantiveLines.length;

    const firstLine = Math.min(...substantiveLines.map(({ line }) => line));
    const lastLine = Math.max(...substantiveLines.map(({ line }) => line));
    const start = Math.max(0, firstLine - ADR_PROXIMITY_LINES - 1);
    const end = Math.min(contentLines.length, lastLine + ADR_PROXIMITY_LINES);

    // A deletion may remove the only nearby citation or the entire file. Resolve
    // against both the surviving current-file window and every raw changed line
    // in the hunk, including removed comments.
    const citationText = [
      contentLines.slice(start, end).join('\n'),
      hunkLines.map(({ text }) => text).join('\n'),
    ].filter(Boolean).join('\n');
    const resolution = citationResolution(citationText);
    if (!resolution.valid) {
      missingHunks.push({
        hunk,
        firstLine,
        lastLine,
        reasons: resolution.failures,
      });
    }
  }
  if (missingHunks.length) {
    adrFindings.push({ file, changedLines: substantiveLineCount, missingHunks });
  }
}

if (secretFindings.length) {
  console.error(`[BLOCKED] ${secretFindings.length} possible hardcoded secret(s) in added lines:`);
  for (const finding of secretFindings.slice(0, 20)) {
    console.error(`  ${finding.file}:${finding.line} [${finding.kind}] ${finding.text.trim().slice(0, 120)}`);
  }
}
if (adrFindings.length) {
  console.error(`[BLOCKED] ${adrFindings.length} architecture-critical file(s) have substantive hunks without a nearby, resolvable ADR citation:`);
  for (const finding of adrFindings) {
    console.error(`  ${finding.file} (${finding.changedLines} substantive changed lines)`);
    for (const hunk of finding.missingHunks) {
      console.error(`    hunk ${hunk.hunk}, lines ${hunk.firstLine}-${hunk.lastLine}: ${hunk.reasons.join('; ')}`);
    }
  }
}

if (secretFindings.length || adrFindings.length) process.exit(1);
console.log(`[OK] Governance gate passed for ${changedFiles.size} changed file(s): no added secrets; architecture hunks cite resolvable ADRs.`);
