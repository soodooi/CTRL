// Validates the ctrl-ghostfolio seed feature-pack manifest against the Zod SSOT
// (via @ctrl/mcp-sdk). The manifest is the "distribute" end of the feature-pack
// pipeline + the config loop-closer: its config_schema keys (ghostfolio_url /
// ghostfolio_token) are stored under `mcp:ctrl-ghostfolio:*`, which the kernel's
// resolve_ghostfolio_creds reads — so this guards that the seed stays a valid,
// installable pack whose Configure wizard collects the creds (GOAL SC1).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { McpManifestSchema } from '@ctrl/mcp-sdk';
import { packConfigFields } from './feature-pack';

// Read the manifest via fs (not a cross-package TS import, which would break
// ctrl-web's rootDir) — it lives in packages/ctrl-mcps/, outside src/.
const manifest = JSON.parse(
  readFileSync(
    new URL('../../../ctrl-mcps/builtin/ctrl-ghostfolio/manifest.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

describe('ctrl-ghostfolio manifest', () => {
  it('validates against the McpManifest schema', () => {
    const r = McpManifestSchema.safeParse(manifest);
    const issues = r.success ? '' : JSON.stringify(r.error.issues);
    expect(r.success, issues).toBe(true);
  });

  it('the config wizard walks all fields (url + secret), not only secrets', () => {
    const fields = packConfigFields(manifest);
    expect(fields.map((f) => f.key)).toEqual(['ghostfolio_url', 'ghostfolio_token']);
    // url is not a secret but MUST still be collected (kernel reads both).
    expect(fields.find((f) => f.key === 'ghostfolio_url')?.kind).toBe('url');
    // The token is a keychain secret, never config.json / the model.
    expect(fields.find((f) => f.key === 'ghostfolio_token')?.kind).toBe('secret');
    expect(fields.every((f) => f.required)).toBe(true);
  });
});
