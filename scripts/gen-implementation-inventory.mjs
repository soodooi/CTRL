#!/usr/bin/env node
// Deterministic implementation-complexity inventory and monotonic ratchet.
// The generated JSON is the single metric authority; ADRs remain the design
// authority. Ceilings may fall automatically but never rise implicitly.
// (ADR-001 spine §4 v22; ADR-003 frontend §8.5 v40;
// ADR-010 communication § endpoint-spec v14)

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_REL = 'vault/ctrl/generated/implementation-inventory.json';
const OUT = join(ROOT, OUT_REL);
const CHECK = process.argv.includes('--check');
const VERSION = 2;

// Immutable first-introduction bounds apply when the merge-base predates this
// artifact. Once origin/main contains the artifact, its ceilings supersede
// these bootstrap values as the trusted ratchet baseline.
// (ADR-001 spine §4 v22; ADR-010 communication § endpoint-spec v14)
const BOOTSTRAP_CEILINGS = Object.freeze({
  agentVisibleGateTools: 42,
  registeredGateTools: 109,
  missingCanonicalProductGateTools: 3,
  productTauriCommands: 170,
  exactMcpTauriDualSurfaces: 2,
  semanticMcpTauriDualSurfaces: 4,
  querySourceImplementations: 5,
  recordSinkImplementations: 4,
  rawEventPublishers: 14,
  liveShells: 2,
  liveRoutes: 16,
  rolePersonaRegistryEntries: 3,
  directAgentCliSpawns: 66,
  directSkillAgentSpawns: 1,
  perPackUiIdBranches: 2,
  lifecycleToolFamilies: 1,
  orphanLifecycleToolMembers: 0,
});

const paths = {
  mcpSchema: 'vault/ctrl/mcp-schema.json',
  mcpServer: 'src-tauri/src/kernel/mcp_server.rs',
  commands: 'src-tauri/src/commands/mod.rs',
  visibility: 'src-tauri/src/kernel/visibility.rs',
  app: 'packages/ctrl-web/src/app.tsx',
  rust: 'src-tauri/src',
  web: 'packages/ctrl-web/src',
};

function fail(message) {
  throw new Error(message);
}

function gitOutput(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function trustedCeilings() {
  try {
    gitOutput(['rev-parse', '--verify', 'origin/main']);
  } catch {
    return BOOTSTRAP_CEILINGS;
  }

  const mergeBase = gitOutput(['merge-base', 'HEAD', 'origin/main']);
  const artifactAtBase = `${mergeBase}:${OUT_REL}`;
  try {
    gitOutput(['cat-file', '-e', artifactAtBase]);
  } catch {
    return BOOTSTRAP_CEILINGS;
  }

  let trusted;
  try {
    trusted = JSON.parse(gitOutput(['show', artifactAtBase]));
  } catch (error) {
    fail(`trusted inventory at ${artifactAtBase} is not valid JSON: ${error.message}`);
  }
  if (trusted.schemaVersion !== VERSION || typeof trusted.metrics !== 'object') {
    fail(`trusted inventory at ${artifactAtBase} must use schemaVersion ${VERSION}`);
  }
  return Object.fromEntries(
    Object.entries(trusted.metrics).map(([name, value]) => [name, value.ceiling]),
  );
}

function read(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) fail(`required source is missing: ${rel}`);
  return readFileSync(abs, 'utf8');
}

function relPath(abs) {
  return relative(ROOT, abs).split(sep).join('/');
}

function walk(rel, extensions) {
  const root = join(ROOT, rel);
  if (!existsSync(root) || !statSync(root).isDirectory()) fail(`required source directory is missing: ${rel}`);
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['target', 'node_modules', 'dist'].includes(entry.name)) visit(abs);
      } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(abs);
      }
    }
  };
  visit(root);
  return out;
}

function uniqueSorted(values, label) {
  const sorted = [...values].sort((a, b) => a.localeCompare(b));
  const duplicate = sorted.find((value, index) => index > 0 && value === sorted[index - 1]);
  if (duplicate) fail(`${label} contains duplicate identity: ${duplicate}`);
  return sorted;
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function ownerAt(source, index) {
  const prefix = source.slice(0, index);
  const matches = [...prefix.matchAll(/(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(/g)];
  return matches.at(-1)?.[1] ?? '<module>';
}

function productionRust(abs) {
  const source = readFileSync(abs, 'utf8');
  const testBoundary = source.search(/^\s*#\[cfg\(test\)\]/m);
  return testBoundary >= 0 ? source.slice(0, testBoundary) : source;
}

function isProductionWeb(path) {
  return !/(?:^|\/)(?:__tests__|test|tests|e2e)(?:\/|$)/.test(path)
    && !/\.(?:test|spec|stories)\.[cm]?[jt]sx?$/.test(path)
    && !/(?:^|\/)(?:icon-lab|pack-lab|table-lab)\.[jt]sx?$/.test(path);
}

function metric(definition, sources, exclusions, identities, target) {
  const normalized = uniqueSorted(identities, definition);
  return {
    definitionVersion: VERSION,
    definition,
    sources,
    exclusions,
    identities: normalized,
    count: normalized.length,
    ceiling: normalized.length,
    target,
  };
}

const schema = JSON.parse(read(paths.mcpSchema));
if (!Array.isArray(schema.tools) || schema.toolCount !== schema.tools.length) {
  fail(`${paths.mcpSchema} has an invalid or stale toolCount`);
}
const gateTools = uniqueSorted(schema.tools.map((tool) => tool.name), 'registered gate tools');
const missingCanonicalProductTools = ['describe', 'query', 'produce']
  .filter((name) => !gateTools.includes(name));

// The committed schema is protocol truth, while the #[tool] router is its real
// generator owner. Cross-check both so a Rust registration change cannot pass
// against a stale schema artifact. (ADR-010 communication § endpoint-spec v14)
const mcpServerSource = read(paths.mcpServer);
const mcpLines = mcpServerSource.split('\n');
const sourceGateTools = [];
for (let index = 0; index < mcpLines.length; index += 1) {
  const method = mcpLines[index].match(/^\s*async fn (\w+)\s*\(/);
  if (method == null) continue;
  for (let cursor = index - 1; cursor >= Math.max(0, index - 12); cursor -= 1) {
    if (/#\[tool\b/.test(mcpLines[cursor])) {
      sourceGateTools.push(method[1]);
      break;
    }
    if (/async fn /.test(mcpLines[cursor])) break;
  }
}
const normalizedSourceGateTools = uniqueSorted(sourceGateTools, 'Rust #[tool] methods');
if (JSON.stringify(normalizedSourceGateTools) !== JSON.stringify(gateTools)) {
  const sourceOnly = normalizedSourceGateTools.filter((name) => !gateTools.includes(name));
  const schemaOnly = gateTools.filter((name) => !normalizedSourceGateTools.includes(name));
  fail(`MCP schema drift from Rust #[tool] owner; regenerate mcp-schema.json (source-only: ${sourceOnly.join(', ') || 'none'}; schema-only: ${schemaOnly.join(', ') || 'none'})`);
}

const visibility = read(paths.visibility);
const brainBody = visibility.match(/pub const BRAIN_TOOLSET:\s*&\[&str\]\s*=\s*&\[([\s\S]*?)\];/)?.[1];
if (brainBody == null) fail('could not parse BRAIN_TOOLSET');
const brainTools = [...brainBody.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

const commandSource = read(paths.commands);
const activeCommandSource = commandSource
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n');
const commandRegistrations = [...activeCommandSource.matchAll(/\$crate::commands::(\w+)::(\w+),/g)]
  .map((match) => `${match[1]}::${match[2]}`);
const commandNames = commandRegistrations.map((identity) => identity.split('::')[1]);
uniqueSorted(commandNames, 'Tauri command names');
const commandNameSet = new Set(commandNames);
// Canonical Resource verbs are intentionally global MCP names. A namespaced
// Tauri command such as memory::query sharing only that generic leaf is not a
// duplicate business surface; real semantic aliases remain explicitly marked.
// (ADR-010 communication § canonical-endpoints v14)
const canonicalGenericVerbs = new Set(['describe', 'query', 'produce']);
const exactDual = gateTools.filter(
  (name) => !canonicalGenericVerbs.has(name) && commandNameSet.has(name),
);
const declaredSemanticDual = [];
for (const match of commandSource.matchAll(/ctrl-inventory:\s*semantic-dual=(\w+)[\s\S]{0,240}?\$crate::commands::(\w+)::(\w+),/g)) {
  const [, gateTool, moduleName, commandName] = match;
  if (!gateTools.includes(gateTool)) fail(`semantic dual annotation references unknown gate tool: ${gateTool}`);
  const registration = `${moduleName}::${commandName}`;
  if (!commandRegistrations.includes(registration)) fail(`semantic dual annotation references unregistered Tauri command: ${registration}`);
  declaredSemanticDual.push(`${registration}->${gateTool}`);
}
const semanticDual = [
  ...exactDual.map((name) => `${commandRegistrations.find((identity) => identity.endsWith(`::${name}`))}->${name}`),
  ...declaredSemanticDual,
];

const rustFiles = walk(paths.rust, ['.rs']);
const querySources = [];
const recordSinks = [];
const rawPublishers = [];
for (const abs of rustFiles) {
  const path = relPath(abs);
  const source = productionRust(abs);
  for (const match of source.matchAll(/impl\s+(?:[\w:]+::)?QuerySource\s+for\s+(\w+)/g)) {
    querySources.push(`${path}::${match[1]}`);
  }
  for (const match of source.matchAll(/impl\s+(?:[\w:]+::)?RecordSink\s+for\s+(\w+)/g)) {
    recordSinks.push(`${path}::${match[1]}`);
  }
  for (const match of source.matchAll(/\.publish_(cell|op)\s*\(/g)) {
    rawPublishers.push(`${path}:${lineAt(source, match.index)}::${ownerAt(source, match.index)}::publish_${match[1]}`);
  }
}

const appSource = read(paths.app);
const routeIdentities = [];
for (const match of appSource.matchAll(/const\s+(\w+Route)\s*=\s*createRoute\(\{[\s\S]*?\n\s*path:\s*'([^']+)'/g)) {
  if (!['iconLabRoute', 'packLabRoute', 'tableLabRoute'].includes(match[1])) {
    routeIdentities.push(`${match[1]}:${match[2]}`);
  }
}
if (routeIdentities.length === 0) fail('could not parse production routes from app.tsx');
const shellIdentities = [];
if (/return\s+<AmbientWorkbench\s*\/>/.test(appSource)) shellIdentities.push('AmbientWorkbench');
if (/ctrl:legacy-shell/.test(appSource) && /className=\{styles\.shell\}/.test(appSource)) {
  shellIdentities.push('RootShellInner:legacy-four-column');
}

const productionWebFiles = walk(paths.web, ['.ts', '.tsx'])
  .filter((abs) => isProductionWeb(relPath(abs)));
const roles = [];
for (const abs of productionWebFiles) {
  const source = readFileSync(abs, 'utf8');
  const roleConstants = new Map(
    [...source.matchAll(/const\s+(\w+):\s*Role\s*=\s*\{[\s\S]*?\n\s*id:\s*'([^']+)'/g)]
      .map((match) => [match[1], match[2]]),
  );
  for (const registry of source.matchAll(/export const ROLES:\s*Role\[\]\s*=\s*\[([^\]]*)\]/g)) {
    for (const name of registry[1].split(',').map((entry) => entry.trim()).filter(Boolean)) {
      const id = roleConstants.get(name);
      if (id == null) fail(`${relPath(abs)} ROLES references unparseable role constant: ${name}`);
      roles.push(`${relPath(abs)}::${id}`);
    }
  }
}

const directSpawns = [];
const directSkillSpawns = [];
for (const abs of rustFiles) {
  const path = relPath(abs);
  const source = productionRust(abs);
  for (const match of source.matchAll(/(?:TokioCommand|Command)::new\s*\(/g)) {
    directSpawns.push(`${path}:${lineAt(source, match.index)}::${ownerAt(source, match.index)}`);
  }
  for (const marker of source.matchAll(/ctrl-inventory:\s*direct-skill-agent-spawn/g)) {
    const following = source.slice(marker.index, marker.index + 400);
    if (!/(?:TokioCommand|Command)::new\s*\(/.test(following)) {
      fail(`${path}:${lineAt(source, marker.index)} direct-skill marker has no adjacent process spawn`);
    }
    directSkillSpawns.push(`${path}:${lineAt(source, marker.index)}::${ownerAt(source, marker.index)}`);
  }
}

const GENERIC_UI_CTRL_LITERAL_ALLOWLIST = new Set([
  'ctrl-asset',
  'ctrl-asset:',
  'ctrl-asset://...',
  'ctrl-tab-store',
  'ctrl-workspace-store',
]);
const perPackBranches = [];
for (const abs of productionWebFiles) {
  const path = relPath(abs);
  const source = readFileSync(abs, 'utf8');
  // Pack ids are namespaced ctrl-*. Inventory every non-infrastructure literal,
  // not only same-line comparisons, so multiline switches/maps cannot evade the
  // ratchet. The tiny allowlist contains URI/storage infrastructure, not packs.
  for (const match of source.matchAll(/['"](ctrl-[^'"\s]+)['"]/g)) {
    const literal = match[1];
    if (GENERIC_UI_CTRL_LITERAL_ALLOWLIST.has(literal)) continue;
    perPackBranches.push(`${path}:${lineAt(source, match.index)}::${literal}`);
  }
}

const lifecycle = new Map();
for (const name of gateTools) {
  const match = name.match(/^(.*)_(start|status|cancel)$/);
  if (match == null) continue;
  if (!lifecycle.has(match[1])) lifecycle.set(match[1], new Set());
  lifecycle.get(match[1]).add(match[2]);
}
const lifecycleFamilies = [];
const lifecycleOrphans = [];
for (const [base, members] of [...lifecycle.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  // A lone *_status endpoint is ordinary introspection, not evidence of an
  // async lifecycle family. A family candidate must expose start/cancel or at
  // least two lifecycle suffixes before incomplete members become debt.
  const isFamilyCandidate = members.has('start') || members.has('cancel') || members.size >= 2;
  if (!isFamilyCandidate) continue;
  const sortedMembers = [...members].sort();
  if (['cancel', 'start', 'status'].every((member) => members.has(member))) {
    lifecycleFamilies.push(`${base}:{start,status,cancel}`);
  } else {
    lifecycleOrphans.push(`${base}:{${sortedMembers.join(',')}}`);
  }
}

const computed = {
  agentVisibleGateTools: metric(
    'Static tools projected to the capped embedded brain by BRAIN_TOOLSET.',
    [paths.visibility],
    ['First-party PWA projection', 'dynamic downstream MCP tools'],
    brainTools,
    3,
  ),
  registeredGateTools: metric(
    'Static tools registered in the authoritative :17873 MCP schema and cross-checked against Rust #[tool] owners.',
    [paths.mcpSchema, paths.mcpServer],
    ['dynamic downstream MCP tools'],
    gateTools,
    null,
  ),
  missingCanonicalProductGateTools: metric(
    'Canonical product verbs absent from the registered gate: describe, query, and produce.',
    [paths.mcpSchema, paths.mcpServer],
    ['diagnostics', 'transport infrastructure', 'time-bounded compatibility aliases'],
    missingCanonicalProductTools,
    0,
  ),
  productTauriCommands: metric(
    'Commands registered in the single Tauri generate_handler list.',
    [paths.commands],
    ['commented retirements', 'unregistered command functions'],
    commandRegistrations,
    null,
  ),
  exactMcpTauriDualSurfaces: metric(
    'Exact-name overlap between registered MCP tools and registered Tauri commands; this does not claim semantic equivalence.',
    [paths.mcpSchema, paths.commands],
    ['semantic equivalents with different names', 'generic canonical verb leaf collisions with unrelated namespaced Tauri commands'],
    exactDual,
    0,
  ),
  semanticMcpTauriDualSurfaces: metric(
    'Business-equivalent MCP/Tauri surfaces derived from exact identity or explicit ctrl-inventory semantic-dual annotations.',
    [paths.mcpSchema, paths.commands],
    ['unrelated shell, OS, diagnostics, and UI-only Tauri commands'],
    semanticDual,
    0,
  ),
  querySourceImplementations: metric(
    'Production Rust implementations of QuerySource.',
    [`${paths.rust}/**/*.rs`],
    ['cfg(test) modules', 'trait declaration'],
    querySources,
    null,
  ),
  recordSinkImplementations: metric(
    'Production Rust implementations of RecordSink.',
    [`${paths.rust}/**/*.rs`],
    ['cfg(test) modules', 'trait declaration', 'manifest connector generic produce path'],
    recordSinks,
    null,
  ),
  rawEventPublishers: metric(
    'Production calls that publish Cell or Op directly through EventWsBridge instead of typed EventBus authority.',
    [`${paths.rust}/**/*.rs`],
    ['EventWsBridge method definitions', 'cfg(test) modules'],
    rawPublishers,
    0,
  ),
  liveShells: metric(
    'Production shell implementations reachable through RootShellInner.',
    [paths.app],
    ['hosted remote entry', 'test shells'],
    shellIdentities,
    1,
  ),
  liveRoutes: metric(
    'Production TanStack routes registered in app.tsx.',
    [paths.app],
    ['icon-lab', 'pack-lab', 'table-lab'],
    routeIdentities,
    3,
  ),
  rolePersonaRegistryEntries: metric(
    'Role/persona ids registered by any production ROLES array; deleting the registry yields zero.',
    [`${paths.web}/**/*.{ts,tsx}`],
    ['engine drivers', 'protocol message roles', 'tests and documentation'],
    roles,
    0,
  ),
  directAgentCliSpawns: metric(
    'All direct production Rust process constructions, a conservative superset that catches moved agent/CLI spawns.',
    [`${paths.rust}/**/*.rs`],
    ['cfg(test) modules'],
    directSpawns,
    null,
  ),
  directSkillAgentSpawns: metric(
    'Explicitly marked Skill-owned headless agent process constructions across production Rust.',
    [`${paths.rust}/**/*.rs`],
    ['shared Irisy ACP engine', 'explicit user coding launcher'],
    directSkillSpawns,
    0,
  ),
  perPackUiIdBranches: metric(
    'Every literal ctrl-* pack id in production UI source; zero literals prevents comparisons, switches, and lookup maps.',
    [`${paths.web}/**/*.{ts,tsx}`],
    ['tests', 'stories', 'labs', 'ctrl-asset', 'ctrl-asset:', 'ctrl-asset://...', 'ctrl-tab-store', 'ctrl-workspace-store', 'generic manifest data outside the UI source root'],
    perPackBranches,
    0,
  ),
  lifecycleToolFamilies: metric(
    'Registered MCP basename families containing all _start, _status, and _cancel members.',
    [paths.mcpSchema],
    ['non-MCP lifecycle APIs'],
    lifecycleFamilies,
    0,
  ),
  orphanLifecycleToolMembers: metric(
    'Registered MCP basenames with an incomplete subset of _start, _status, and _cancel suffixes.',
    [paths.mcpSchema],
    ['ordinary words ending in these suffixes remain visible intentionally'],
    lifecycleOrphans,
    0,
  ),
};

let tracked = null;
if (existsSync(OUT)) {
  try {
    tracked = JSON.parse(readFileSync(OUT, 'utf8'));
  } catch (error) {
    fail(`tracked inventory is not valid JSON: ${error.message}`);
  }
  if (tracked.schemaVersion !== VERSION || typeof tracked.metrics !== 'object') {
    fail(`tracked inventory schemaVersion must be ${VERSION}`);
  }
}

const trusted = trustedCeilings();
for (const [name, value] of Object.entries(computed)) {
  const trustedCeiling = trusted[name] ?? BOOTSTRAP_CEILINGS[name];
  if (!Number.isInteger(trustedCeiling) || trustedCeiling < 0) {
    fail(`${name} has no valid trusted ceiling`);
  }

  const old = tracked?.metrics?.[name];
  if (old != null) {
    if (!Number.isInteger(old.ceiling) || old.ceiling < 0) {
      fail(`${name} has invalid tracked ceiling`);
    }
    if (old.ceiling > trustedCeiling) {
      fail(`${name} tracked ceiling ${old.ceiling} exceeds trusted baseline ${trustedCeiling}`);
    }
  }

  const effectiveCeiling = old?.ceiling ?? trustedCeiling;
  if (value.count > effectiveCeiling) {
    fail(`${name} grew ${effectiveCeiling} -> ${value.count}; ceilings cannot rise implicitly`);
  }
  value.ceiling = Math.min(effectiveCeiling, value.count);
}

const artifact = {
  schemaVersion: VERSION,
  generatedBy: 'scripts/gen-implementation-inventory.mjs',
  authority: 'Owning ADRs define architecture; this artifact is the single executable complexity metric authority.',
  metrics: computed,
};
const rendered = `${JSON.stringify(artifact, null, 2)}\n`;

if (CHECK) {
  if (!existsSync(OUT)) fail(`tracked inventory is missing: ${OUT_REL}`);
  const current = readFileSync(OUT, 'utf8');
  if (current !== rendered) {
    const tightened = Object.entries(computed)
      .filter(([name, value]) => tracked.metrics[name] && value.count < tracked.metrics[name].ceiling)
      .map(([name, value]) => `${name} ${tracked.metrics[name].ceiling} -> ${value.count}`);
    const suffix = tightened.length > 0 ? `; lower ceilings by regenerating: ${tightened.join(', ')}` : '';
    fail(`inventory artifact drift: run node scripts/gen-implementation-inventory.mjs${suffix}`);
  }
  console.log(`implementation-inventory: PASS (${Object.keys(computed).length} metrics)`);
} else {
  writeFileSync(OUT, rendered);
  console.log(`implementation-inventory: wrote ${OUT_REL} (${Object.keys(computed).length} metrics)`);
}
