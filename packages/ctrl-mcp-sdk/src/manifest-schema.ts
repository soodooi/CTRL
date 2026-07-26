// The versioned draft-2020-12 JSON Schema is the sole structural authority for
// feature-pack manifests. This module is only its TypeScript/Ajv consumer and a
// compatibility API for existing SDK callers. (ADR-002 substrate § 7 v73)

// Manifest protocol: (ADR-002 substrate § 7 v73)
import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import manifestJsonSchema from '../schema/manifest-v2.schema.json';

// Manifest protocol: (ADR-002 substrate § 7 v73)
export type WorkspaceUi =
  | 'none'
  | 'notification'
  | 'modal'
  | 'clipboard'
  | 'html-output'
  | 'chat-stream'
  | 'picker'
  | 'form'
  | 'canvas';

// Manifest protocol: (ADR-002 substrate § 7 v73)
export interface L2NavItem {
  id: string;
  label: string;
  href: string;
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
export interface WorkspaceTab {
  id: string;
  label: string;
  viewer: string;
  props?: Record<string, unknown>;
  l2_subnav?: L2NavItem[];
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
export interface WorkspaceDeclaration {
  tabs: WorkspaceTab[];
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
export type UiSurface = WorkspaceUi | { workspace: WorkspaceDeclaration } | Record<string, unknown>;

// Manifest protocol: (ADR-002 substrate § 7 v73)
export type McpVariant =
  | 'builtin'
  | 'mcp-server'
  | 'mcp-tool'
  | 'oauth'
  | 'cli-wrapper'
  | 'local-agent'
  | 'skill'
  | 'stss-publisher';

// Manifest protocol: (ADR-002 substrate § 7 v73)
export interface McpManifest {
  id: string;
  manifest_version?: 1 | 2;
  name?: string;
  version?: string;
  author?: Record<string, unknown>;
  description?: string | { short: string; long?: string };
  variant?: McpVariant;
  pattern?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  server?: { type?: 'local'; command: string; args?: string[] };
  actions?: Array<Record<string, unknown>>;
  record_source?: Record<string, unknown>;
  ui_surface?: UiSurface;
  [key: string]: unknown;
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
export interface ValidationIssue {
  path: string;
  message: string;
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
export interface ValidationResult {
  ok: boolean;
  manifest?: McpManifest;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
export interface CompatibilityIssue {
  path: Array<string | number>;
  message: string;
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
export type CompatibilityParseResult =
  | { success: true; data: McpManifest }
  | { success: false; error: { issues: CompatibilityIssue[] } };

// Manifest protocol: (ADR-002 substrate § 7 v73)
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  useDefaults: true,
});
const validate = ajv.compile(manifestJsonSchema);

// Manifest protocol: (ADR-002 substrate § 7 v73)
function decodePointer(pointer: string): Array<string | number> {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((part) => (/^(0|[1-9]\d*)$/.test(part) ? Number(part) : part));
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
function issuePath(error: ErrorObject): Array<string | number> {
  const path = decodePointer(error.instancePath);
  if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') {
    path.push(error.params.missingProperty);
  } else if (
    error.keyword === 'additionalProperties'
    && typeof error.params.additionalProperty === 'string'
  ) {
    path.push(error.params.additionalProperty);
  }
  return path;
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
function compatibilityIssues(errors: ErrorObject[] | null | undefined): CompatibilityIssue[] {
  return (errors ?? []).map((error) => ({
    path: issuePath(error),
    message: error.message ?? `failed ${error.keyword} validation`,
  }));
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
function cloneInput(input: unknown): unknown {
  return structuredClone(input);
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
/**
 * Validate and normalize a JSON-compatible manifest using only the shipped
 * schema. Ajv applies defaults declared by that schema to the cloned result;
 * the caller's input is never mutated. (ADR-002 substrate § 7 v73)
 */
export function parseManifest(input: unknown): ValidationResult {
  let candidate: unknown;
  try {
    candidate = cloneInput(input);
  } catch (error: unknown) {
    return {
      ok: false,
      errors: [{
        path: '',
        message: error instanceof Error ? error.message : 'manifest is not cloneable JSON data',
      }],
      warnings: [],
    };
  }

// Manifest protocol: (ADR-002 substrate § 7 v73)
  if (!validate(candidate)) {
    return {
      ok: false,
      errors: compatibilityIssues(validate.errors).map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
      warnings: [],
    };
  }

// Manifest protocol: (ADR-002 substrate § 7 v73)
  const manifest = candidate as McpManifest;
  const warnings: ValidationIssue[] = [];
  if (manifest.variant === 'stss-publisher') {
    warnings.push({
      path: 'variant',
      message: 'stss-publisher is retired compatibility data; migrate or disable this manifest before execution',
    });
  }
  if (manifest.pattern === 'F') {
    warnings.push({
      path: 'pattern',
      message: 'Pattern F/ST-SS is retired compatibility data and has no live executor route',
    });
  }
  return { ok: true, manifest, errors: [], warnings };
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
/**
 * Zod-shaped compatibility adapter. Its result is derived exclusively from
 * parseManifest/Ajv; it is not an independent schema. (ADR-002 substrate § 7 v73)
 */
export const McpManifestSchema = Object.freeze({
  safeParse(input: unknown): CompatibilityParseResult {
    const result = parseManifest(input);
    if (result.ok && result.manifest) {
      return { success: true, data: result.manifest };
    }
    return {
      success: false,
      error: {
        issues: result.errors.map((issue) => ({
          path: issue.path === '' ? [] : issue.path.split('.'),
          message: issue.message,
        })),
      },
    };
  },
});
