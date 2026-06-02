// vault-conventions — read user-editable feature-layer configs from
// vault/.ctrl/*.yaml.
//
// (ADR-002 substrate § vault v1 §8.4, 2026-06-01 — memory
// `decision_vault_adr_002_section_8`.)
//
// The kernel does NOT know about Daily Notes or Sourcing inboxes; they
// live as plain-text yaml the user owns. This module is the
// authoritative reader, used by L2VaultPanel ("Today" button) and the
// Irisy sourcing routine. Both call `loadDailyNotesConfig()` and
// `loadSourcingConfig()` instead of hard-coding paths.
//
// Parsing strategy: the seeded configs are small flat documents with
// known keys (scalars, string lists, one nested map). A hand-rolled
// reader stays in-bundle without dragging in a YAML library. If a user
// edits the file into a shape we don't recognize, callers see the
// schema-typed defaults instead of failing — vim test still passes.

import { vaultRead } from './kernel';

const DAILY_NOTES_PATH = '.ctrl/daily-notes.yaml';
const SOURCING_PATH = '.ctrl/sourcing.yaml';

export interface DailyNotesConfig {
  pathTemplate: string;
  template: string;
  frontmatterDefault: Record<string, unknown>;
  autoCreateOnFirstWrite: boolean;
}

export interface SourcingConfig {
  inboxDir: string;
  triggers: {
    cron: string;
    countThreshold: number;
    manualCommand: string;
  };
  reviewQueuePath: string;
  defaultTargetRoot: string;
  preserveSourcingOriginals: boolean;
}

const DAILY_NOTES_DEFAULT: DailyNotesConfig = {
  pathTemplate: 'daily/{YYYY}-{MM}-{DD}.md',
  template: 'templates/daily.md',
  frontmatterDefault: { type: 'journal', tags: ['daily'] },
  autoCreateOnFirstWrite: false,
};

const SOURCING_DEFAULT: SourcingConfig = {
  inboxDir: 'sourcing',
  triggers: {
    cron: '0 9 * * *',
    countThreshold: 5,
    manualCommand: '/integrate sourcing',
  },
  reviewQueuePath: '.ctrl/review-queue/{date}.md',
  defaultTargetRoot: 'notes/',
  preserveSourcingOriginals: false,
};

export const loadDailyNotesConfig = async (): Promise<DailyNotesConfig> => {
  const raw = await readConfigText(DAILY_NOTES_PATH);
  if (!raw) return DAILY_NOTES_DEFAULT;
  const map = parseFlatYaml(raw);
  return {
    pathTemplate: stringOrDefault(map.get('path_template'), DAILY_NOTES_DEFAULT.pathTemplate),
    template: stringOrDefault(map.get('template'), DAILY_NOTES_DEFAULT.template),
    frontmatterDefault: readNestedMap(map.get('frontmatter_default')) ?? DAILY_NOTES_DEFAULT.frontmatterDefault,
    autoCreateOnFirstWrite: boolOrDefault(
      map.get('auto_create_on_first_write'),
      DAILY_NOTES_DEFAULT.autoCreateOnFirstWrite,
    ),
  };
};

export const loadSourcingConfig = async (): Promise<SourcingConfig> => {
  const raw = await readConfigText(SOURCING_PATH);
  if (!raw) return SOURCING_DEFAULT;
  const map = parseFlatYaml(raw);
  const triggers = readNestedMap(map.get('triggers')) ?? {};
  return {
    inboxDir: stringOrDefault(map.get('inbox_dir'), SOURCING_DEFAULT.inboxDir),
    triggers: {
      cron: stringOrDefault(triggers.cron, SOURCING_DEFAULT.triggers.cron),
      countThreshold: numberOrDefault(
        triggers.count_threshold,
        SOURCING_DEFAULT.triggers.countThreshold,
      ),
      manualCommand: stringOrDefault(
        triggers.manual_command,
        SOURCING_DEFAULT.triggers.manualCommand,
      ),
    },
    reviewQueuePath: stringOrDefault(
      map.get('review_queue_path'),
      SOURCING_DEFAULT.reviewQueuePath,
    ),
    defaultTargetRoot: stringOrDefault(
      map.get('default_target_root'),
      SOURCING_DEFAULT.defaultTargetRoot,
    ),
    preserveSourcingOriginals: boolOrDefault(
      map.get('preserve_sourcing_originals'),
      SOURCING_DEFAULT.preserveSourcingOriginals,
    ),
  };
};

/**
 * Resolve a Daily Note path from its template + a date.
 * Replaces `{YYYY}` / `{MM}` / `{DD}` placeholders.
 */
export const renderDailyNotePath = (
  template: string,
  date: Date = new Date(),
): string => {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return template
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{MM\}/g, mm)
    .replace(/\{DD\}/g, dd);
};

/**
 * Resolve the review-queue path for a given date — used by Irisy when
 * it writes integration proposals.
 */
export const renderReviewQueuePath = (
  template: string,
  date: Date = new Date(),
): string => {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return template.replace(/\{date\}/g, `${yyyy}-${mm}-${dd}`);
};

// ---------- internals ----------

const readConfigText = async (path: string): Promise<string | null> => {
  try {
    const entry = await vaultRead(path);
    return typeof entry.body === 'string' ? entry.body : null;
  } catch {
    // Either the file doesn't exist (seed didn't run yet) or
    // permissions reject — callers fall back to defaults silently
    // because the feature must keep working without the config.
    return null;
  }
};

type YamlValue = string | number | boolean | string[] | Map<string, YamlValue>;

/**
 * Minimal YAML reader for the seeded schema:
 *   - top-level scalars (string | number | bool)
 *   - inline string arrays `key: [a, b, c]`
 *   - block string arrays:
 *       key:
 *         - a
 *         - b
 *   - one level of nested map (block style):
 *       key:
 *         child_a: 1
 *         child_b: foo
 *
 * Comments (`#`) and blank lines are skipped. Indentation must be 2
 * spaces; mixing tabs/spaces is rejected silently (returns the
 * partial map up to the divergent line).
 */
const parseFlatYaml = (raw: string): Map<string, YamlValue> => {
  const out = new Map<string, YamlValue>();
  let currentMapKey: string | null = null;
  let currentMap: Map<string, YamlValue> | null = null;
  let currentListKey: string | null = null;
  let currentList: string[] = [];

  const flushBlock = (): void => {
    if (currentMapKey !== null && currentMap) {
      out.set(currentMapKey, currentMap);
      currentMapKey = null;
      currentMap = null;
    }
    if (currentListKey !== null) {
      out.set(currentListKey, currentList);
      currentListKey = null;
      currentList = [];
    }
  };

  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmedEnd = line.replace(/\s+$/, '');
    if (trimmedEnd === '' || trimmedEnd.trim().startsWith('#')) {
      continue;
    }
    // Block-list continuation: `  - value`
    if (currentListKey && /^ {2,}- /.test(trimmedEnd)) {
      currentList.push(parseScalarString(trimmedEnd.replace(/^ {2,}- /, '').trim()));
      continue;
    }
    // Nested map continuation: `  key: value`
    if (currentMapKey && /^ {2,}\w/.test(trimmedEnd)) {
      const inner = trimmedEnd.replace(/^ {2,}/, '');
      const colon = inner.indexOf(':');
      if (colon > 0) {
        const k = inner.slice(0, colon).trim();
        const v = inner.slice(colon + 1).trim();
        const inlineArr = parseInlineArray(v);
        if (currentMap) {
          if (inlineArr !== null) currentMap.set(k, inlineArr);
          else if (v === '') currentMap.set(k, '');
          else currentMap.set(k, parseScalar(v));
        }
        continue;
      }
    }
    // Top-level line — flush any open block first.
    flushBlock();
    if (line.startsWith(' ') || line.startsWith('\t')) continue;
    const colon = trimmedEnd.indexOf(':');
    if (colon < 0) continue;
    const key = trimmedEnd.slice(0, colon).trim();
    const value = trimmedEnd.slice(colon + 1).trim();
    if (value === '') {
      // Next lines decide whether this opens a list or a map. Stage as
      // potential list; if a nested map line follows, switch.
      currentListKey = key;
      currentList = [];
      currentMapKey = key;
      currentMap = new Map();
      continue;
    }
    const inline = parseInlineArray(value);
    if (inline !== null) {
      out.set(key, inline);
      continue;
    }
    out.set(key, parseScalar(value));
  }
  // Decide list vs map for any open block: the one we actually
  // populated wins.
  if (currentListKey !== null && currentList.length > 0) {
    out.set(currentListKey, currentList);
    currentListKey = null;
  }
  if (currentMapKey !== null && currentMap && currentMap.size > 0) {
    out.set(currentMapKey, currentMap);
    currentMapKey = null;
  }
  // Empty block — drop both staged keys.
  return out;
};

const parseInlineArray = (s: string): string[] | null => {
  if (!s.startsWith('[') || !s.endsWith(']')) return null;
  const inner = s.slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map((v) => parseScalarString(v.trim()));
};

const parseScalar = (s: string): YamlValue => {
  if (s === 'true' || s === 'True') return true;
  if (s === 'false' || s === 'False') return false;
  const n = Number(s);
  if (!Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(s)) return n;
  return parseScalarString(s);
};

const parseScalarString = (s: string): string => {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
};

const stringOrDefault = (v: unknown, def: string): string =>
  typeof v === 'string' ? v : def;
const numberOrDefault = (v: unknown, def: number): number =>
  typeof v === 'number' ? v : def;
const boolOrDefault = (v: unknown, def: boolean): boolean =>
  typeof v === 'boolean' ? v : def;

const readNestedMap = (v: unknown): Record<string, unknown> | null => {
  if (v instanceof Map) {
    return Object.fromEntries(v.entries());
  }
  return null;
};
