// Deterministic pipeline-conformance evidence for the two single-truth lists.
//
// ADR-005 irisy §12.3 v43 requires one executable pipeline per user intent and
// ADR-002 substrate §17.6 v86 requires one per capability domain. Status is
// GENERATED, never asserted in prose.
//
// Deliberate design choice: a pipeline must be DECLARED in
// `vault/ctrl/pipelines/intent-pipelines.json` and every artifact it names must
// exist on disk. An earlier draft inferred status by scanning source for `U<n>`
// tokens; that reported intents as `verified` because a test happened to mention
// the id — including one whose entry surface does not exist at all. Inferred
// green is worse than an honest gap, so token inference is not used.
//
// This artifact defines no architecture. The ADRs own the registries; this only
// reports which declared pipeline stages currently resolve.
// (ADR-002 substrate §17.6 v86; ADR-005 irisy §12.3 v43; ADR-003 frontend §8.5 v44)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_REL = 'vault/ctrl/generated/pipeline-conformance.json';
// A readable view of the same data. The JSON is for tooling; this is the file a
// person opens to see, in one place, what CTRL claims it can do and where each
// claim currently stops. Plain Markdown so it passes the vim test.
const REPORT_REL = 'vault/ctrl/generated/pipeline-conformance.md';
const CHECK = process.argv.includes('--check');
const VERSION = 2;

const paths = {
  intentAdr: 'vault/ctrl/adrs/005-irisy.md',
  domainAdr: 'vault/ctrl/adrs/002-substrate.md',
  visibility: 'src-tauri/src/kernel/visibility.rs',
  declarations: 'vault/ctrl/pipelines/intent-pipelines.json',
};

function read(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) throw new Error(`missing required source: ${rel}`);
  return readFileSync(abs, 'utf8');
}

const exists = (rel) => existsSync(join(ROOT, rel));

// ── Registry extraction — the ADR tables are the authority ───────────────────

function parseIntents(markdown) {
  const rows = [...markdown.matchAll(/^\|\s*(U\d+)\s*\|([^|]+)\|([^|]+)\|([^|]+)\|/gm)];
  if (rows.length === 0) throw new Error('no intent rows found in ADR-005 §12.1');
  return rows.map(([, id, job, domains, scope]) => ({
    id,
    job: job.trim(),
    domains: [...domains.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]),
    scope: /^v1/.test(scope.trim()) ? 'v1' : 'later',
  }));
}

function parseDomains(markdown) {
  const start = markdown.indexOf('### §17.1 The registry');
  if (start < 0) throw new Error('ADR-002 §17.1 registry heading not found');
  const section = markdown.slice(start, markdown.indexOf('### §17.2'));
  const rows = [...section.matchAll(/^\|\s*`([a-z_]+)`\s*\|([^|]+)\|([^|]*)\|/gm)];
  if (rows.length === 0) throw new Error('no domain rows found in ADR-002 §17.1');
  return rows.map(([, name, authorizes, notes]) => ({
    name,
    authorizes: authorizes.trim(),
    notes: notes.trim(),
  }));
}

/** Domain vocabulary as the code actually implements it. */
function implementedDomains(visibility) {
  const slice = (from, to) => {
    const a = visibility.indexOf(from);
    const b = visibility.indexOf(to);
    if (a < 0 || b < 0 || b <= a) throw new Error(`visibility.rs anchors moved: ${from}`);
    return visibility.slice(a, b);
  };
  const firstParty = [
    ...slice('const FIRST_PARTY_DOMAINS', 'pub fn is_first_party').matchAll(/^\s*"([a-z_]+)",/gm),
  ].map((match) => match[1]);
  const prefixed = [
    ...slice('const PREFIXES', 'for (prefix, domain) in PREFIXES').matchAll(
      /\(\s*"[a-z_]+_"\s*,\s*"([a-z_]+)"\s*\)/g,
    ),
  ].map((match) => match[1]);
  // Exact-match arms use `=> return "<domain>",` and ALWAYS_ON is a const.
  const exact = [...visibility.matchAll(/=>\s*return\s+"([a-z_]+)"/g)].map((match) => match[1]);
  const alwaysOn = /const ALWAYS_ON: &str = "([a-z_]+)"/.exec(visibility)?.[1];
  // The fallback arm classifies anything unmatched.
  const fallback = /\n\s*"([a-z_]+)"\n\}/.exec(slice('pub fn tool_domain', 'pub fn tool_domain_with_downstream'))?.[1];
  return {
    firstParty: [...new Set(firstParty)].sort(),
    classified: [...new Set([...prefixed, ...exact, ...(fallback ? [fallback] : []), ...(alwaysOn ? [alwaysOn] : [])])].sort(),
    alwaysOn,
  };
}

// ── Build ───────────────────────────────────────────────────────────────────

const intents = parseIntents(read(paths.intentAdr));
const domains = parseDomains(read(paths.domainAdr));
const impl = implementedDomains(read(paths.visibility));
const declared = JSON.parse(read(paths.declarations));

const declaredNames = new Set(domains.map((domain) => domain.name));
for (const domain of [...impl.classified, ...impl.firstParty]) {
  if (!declaredNames.has(domain)) {
    throw new Error(
      `capability domain "${domain}" exists in code but not in ADR-002 §17.1 — amend the registry first (ADR-002 substrate §17.2 v85)`,
    );
  }
}

const intentIds = new Set(intents.map((intent) => intent.id));
for (const pipeline of declared.pipelines) {
  if (!intentIds.has(pipeline.intent)) {
    throw new Error(
      `declared pipeline references unknown intent "${pipeline.intent}" — amend ADR-005 §12.1 first`,
    );
  }
  for (const domain of pipeline.domains) {
    if (!declaredNames.has(domain)) {
      throw new Error(
        `pipeline ${pipeline.intent} names unknown capability domain "${domain}" — amend ADR-002 §17.1 first`,
      );
    }
  }
}

const domainReport = domains.map((domain) => {
  const classified = impl.classified.includes(domain.name);
  const granted = impl.firstParty.includes(domain.name) || domain.name === impl.alwaysOn;
  // `net` is excluded from every default grant by design (§17.2), so absence of
  // a grant is conformance, not a gap.
  const excludedByDesign = domain.name === 'net';
  const ownerSideOnly = !classified && granted;
  let status = 'verified';
  const failingStages = [];
  if (!classified && !ownerSideOnly && !excludedByDesign) {
    status = 'declared';
    failingStages.push('classification');
  }
  if (ownerSideOnly) {
    // Enforcement lives in an owner, so the evidence must name that owner's
    // authorization test and it must exist on disk. (ADR-002 §17.6 v87)
    const declaredEvidence = declared.domainEvidence?.[domain.name];
    const paths = [declaredEvidence?.owner, declaredEvidence?.test].filter(Boolean);
    const resolved = paths.filter((rel) => exists(rel));
    const openGaps = declaredEvidence?.gaps ?? [];
    if (resolved.length === 0 || openGaps.length > 0) {
      status = 'partial';
      failingStages.push('ownerEvidence');
    }
  }
  return {
    domain: domain.name,
    authorizes: domain.authorizes,
    classified,
    grantedByDefault: granted,
    excludedByDesign,
    ownerSideOnly,
    status,
    failingStages,
  };
});

const domainStatus = new Map(domainReport.map((entry) => [entry.domain, entry.status]));
const declaredByIntent = new Map(declared.pipelines.map((pipeline) => [pipeline.intent, pipeline]));

const intentReport = intents.map((intent) => {
  const pipeline = declaredByIntent.get(intent.id);
  if (intent.scope === 'later') {
    return {
      intent: intent.id,
      job: intent.job,
      scope: intent.scope,
      status: 'declared',
      failingStages: ['scope'],
      notes: 'accepted but deferred scope; must not be presented as available',
    };
  }
  if (!pipeline) {
    return {
      intent: intent.id,
      job: intent.job,
      scope: intent.scope,
      status: 'declared',
      failingStages: ['entry', 'domains', 'operation', 'outcomeFacts', 'rendering', 'evidence'],
      notes: 'no pipeline declared in vault/ctrl/pipelines/intent-pipelines.json',
    };
  }

  const missingArtifacts = [];
  const stages = {
    entry: pipeline.entry?.surface && exists(pipeline.entry.surface) ? [pipeline.entry.surface] : [],
    domains: pipeline.domains ?? [],
    operation: pipeline.operation ? [pipeline.operation] : [],
    outcomeFacts: pipeline.outcomeFacts ?? [],
    // A rendering stage resolves through either registry: a decision `kind` or
    // a content `viewer`. (ADR-003 frontend §8.5 v43/v44)
    rendering: [pipeline.rendering?.kind, pipeline.rendering?.viewer].filter(Boolean),
    evidence: [...(pipeline.evidence?.unit ?? []), ...(pipeline.evidence?.e2e ?? [])].filter(
      (rel) => {
        if (exists(rel)) return true;
        missingArtifacts.push(rel);
        return false;
      },
    ),
  };
  if (pipeline.entry?.surface && !exists(pipeline.entry.surface)) {
    missingArtifacts.push(pipeline.entry.surface);
  }

  const failingStages = Object.entries(stages)
    .filter(([, value]) => value.length === 0)
    .map(([name]) => name);
  let status = failingStages.length === 0 ? 'verified' : 'partial';

  // An intent cannot outrank the domains it depends on. (ADR-005 §12.3 v43)
  const blockingDomains = (pipeline.domains ?? []).filter(
    (domain) => domainStatus.get(domain) !== 'verified',
  );
  if (status === 'verified' && blockingDomains.length > 0) {
    status = 'partial';
    failingStages.push('domains');
  }
  // A declared gap keeps the pipeline honest even when every artifact resolves.
  const gaps = pipeline.gaps ?? [];
  if (status === 'verified' && gaps.length > 0) {
    status = 'partial';
    failingStages.push('declaredGaps');
  }

  return {
    intent: intent.id,
    job: intent.job,
    scope: intent.scope,
    stages,
    blockingDomains,
    missingArtifacts,
    gaps,
    status,
    failingStages,
  };
});

const count = (report, status) => report.filter((entry) => entry.status === status).length;

const artifact = {
  schemaVersion: VERSION,
  generatedBy: 'scripts/gen-pipeline-conformance.mjs',
  authority:
    'ADR-005 §12 owns the intent registry and ADR-002 §17 owns the capability domains. Pipelines are declared in vault/ctrl/pipelines/intent-pipelines.json. This artifact reports which declared stages resolve and never infers status from token matches.',
  intents: {
    total: intentReport.length,
    v1: intentReport.filter((entry) => entry.scope === 'v1').length,
    statusCounts: {
      verified: count(intentReport, 'verified'),
      partial: count(intentReport, 'partial'),
      declared: count(intentReport, 'declared'),
    },
    items: intentReport,
  },
  domains: {
    total: domainReport.length,
    statusCounts: {
      verified: count(domainReport, 'verified'),
      partial: count(domainReport, 'partial'),
      declared: count(domainReport, 'declared'),
    },
    items: domainReport,
  },
};

/** Human-readable report of the same generated facts. */
function renderReport(artifact) {
  const mark = { verified: 'ready', partial: 'partial', declared: 'not built' };
  const lines = [];
  lines.push('# What CTRL can do — generated pipeline report');
  lines.push('');
  lines.push('> Generated by `scripts/gen-pipeline-conformance.mjs`. Do not hand-edit.');
  lines.push('> Intents are owned by ADR-005 §12; capability domains by ADR-002 §17.');
  lines.push('> A row is `ready` only when every stage of its declared pipeline resolves.');
  lines.push('');
  const counts = artifact.intents.statusCounts;
  lines.push(
    `**User intents:** ${counts.verified} ready · ${counts.partial} partial · ${counts.declared} not built (of ${artifact.intents.total}, ${artifact.intents.v1} in scope now)`,
  );
  const domainCounts = artifact.domains.statusCounts;
  lines.push('');
  lines.push(
    `**Capability domains:** ${domainCounts.verified} ready · ${domainCounts.partial} partial · ${domainCounts.declared} not built (of ${artifact.domains.total})`,
  );
  lines.push('');
  lines.push('## User intents');
  lines.push('');
  lines.push('| # | What the user wants | Scope | State | Stops at | Why it is not ready |');
  lines.push('|---|---|---|---|---|---|');
  for (const item of artifact.intents.items) {
    const stops = item.failingStages?.length ? item.failingStages.join(', ') : '—';
    const why = item.gaps?.length
      ? item.gaps.join(' ')
      : (item.notes ?? (item.status === 'verified' ? '—' : ''));
    lines.push(
      `| ${item.intent} | ${item.job} | ${item.scope} | ${mark[item.status]} | ${stops} | ${why || '—'} |`,
    );
  }
  lines.push('');
  lines.push('## Capability domains');
  lines.push('');
  lines.push('| Domain | Authorizes | State | Notes |');
  lines.push('|---|---|---|---|');
  for (const item of artifact.domains.items) {
    const notes = [];
    if (item.excludedByDesign) notes.push('never granted by default, by design');
    if (item.ownerSideOnly) notes.push('owner-side scope only, no generated evidence path');
    if (!item.classified && !item.ownerSideOnly && !item.excludedByDesign)
      notes.push('no tool classifies into it');
    lines.push(
      `| \`${item.domain}\` | ${item.authorizes} | ${mark[item.status]} | ${notes.join('; ') || '—'} |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
const report = renderReport(artifact);
const outAbs = join(ROOT, OUT_REL);
const reportAbs = join(ROOT, REPORT_REL);

if (CHECK) {
  const current = existsSync(outAbs) ? readFileSync(outAbs, 'utf8') : '';
  const currentReport = existsSync(reportAbs) ? readFileSync(reportAbs, 'utf8') : '';
  if (current !== serialized || currentReport !== report) {
    console.error(`[FAIL] ${OUT_REL} is stale. Regenerate: node scripts/gen-pipeline-conformance.mjs`);
    process.exit(1);
  }
  console.log(
    `[OK] ${OUT_REL} current — intents verified ${artifact.intents.statusCounts.verified}/${artifact.intents.v1} v1, domains verified ${artifact.domains.statusCounts.verified}/${artifact.domains.total}`,
  );
  process.exit(0);
}

writeFileSync(outAbs, serialized);
writeFileSync(reportAbs, report);
console.log(`[OK] wrote ${REPORT_REL} — open this one to read the state`);
console.log(
  `[OK] wrote ${OUT_REL} — intents verified ${artifact.intents.statusCounts.verified} / partial ${artifact.intents.statusCounts.partial} / declared ${artifact.intents.statusCounts.declared} (of ${artifact.intents.v1} v1); domains verified ${artifact.domains.statusCounts.verified} / partial ${artifact.domains.statusCounts.partial} / declared ${artifact.domains.statusCounts.declared}`,
);
