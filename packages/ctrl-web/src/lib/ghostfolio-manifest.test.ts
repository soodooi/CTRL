// Validates the ctrl-ghostfolio seed feature-pack manifest against the Zod SSOT
// (manifest-schema.ts). The manifest is the "distribute" end of the feature-pack
// pipeline + the config loop-closer: its config_schema keys (ghostfolio_url /
// ghostfolio_token) are stored under `mcp:ctrl-ghostfolio:*`, which the kernel's
// resolve_ghostfolio_creds reads — so this test guards that the seed stays a
// valid, installable pack (GOAL ctrl-ghostfolio SC1).
import { describe, it, expect } from 'vitest';
import { McpManifest } from '../../../ctrl-mcp-sdk/src/manifest-schema';
import manifest from '../../../ctrl-mcps/builtin/ctrl-ghostfolio/manifest.json';

describe('ctrl-ghostfolio manifest', () => {
  it('validates against the McpManifest schema', () => {
    const r = McpManifest.safeParse(manifest);
    const issues = r.success ? '' : JSON.stringify(r.error.issues);
    expect(r.success, issues).toBe(true);
  });

  it('declares the two config keys the kernel resolves for creds', () => {
    const keys = manifest.config_schema.fields.map((f) => f.key);
    expect(keys).toContain('ghostfolio_url');
    expect(keys).toContain('ghostfolio_token');
    // The token must be a keychain secret, never config.json / the model.
    const token = manifest.config_schema.fields.find((f) => f.key === 'ghostfolio_token');
    expect(token?.kind).toBe('secret');
  });
});
