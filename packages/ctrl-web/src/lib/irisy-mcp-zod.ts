// Compatibility adapter for the Irisy pack creator. Structural validation is
// delegated exclusively to the SDK's Ajv consumer of the shipped JSON Schema;
// this module owns only creator-context semantics. (ADR-002 substrate § 7 v73)

// Manifest protocol: (ADR-002 substrate § 7 v73)
import { parseManifest, type McpManifest } from '@ctrl/mcp-sdk';

// Manifest protocol: (ADR-002 substrate § 7 v73)
export type { McpManifest } from '@ctrl/mcp-sdk';

// Manifest protocol: (ADR-002 substrate § 7 v73)
export type IrisyZodErrorKind = 'structural' | 'semantic';

// Manifest protocol: (ADR-002 substrate § 7 v73)
export interface IrisyZodError {
  kind: IrisyZodErrorKind;
  path: string;
  message: string;
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
export interface ValidateContext {
  installedIds: ReadonlySet<string>;
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
export function validateManifest(
  draft: unknown,
  ctx: ValidateContext,
): { ok: true; manifest: McpManifest } | { ok: false; errors: IrisyZodError[] } {
  const parsed = parseManifest(draft);
  if (!parsed.ok || !parsed.manifest) {
    return {
      ok: false,
      errors: parsed.errors.map((issue) => ({
        kind: 'structural',
        path: issue.path,
        message: issue.message,
      })),
    };
  }

// Manifest protocol: (ADR-002 substrate § 7 v73)
  if (ctx.installedIds.has(parsed.manifest.id)) {
    return {
      ok: false,
      errors: [{
        kind: 'semantic',
        path: 'id',
        message: `mcp id "${parsed.manifest.id}" already exists — pick another name.`,
      }],
    };
  }

// Manifest protocol: (ADR-002 substrate § 7 v73)
  return { ok: true, manifest: parsed.manifest };
}
