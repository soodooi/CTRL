// Validates the ctrl-ghostfolio seed against the Zod SSOT (via @ctrl/mcp-sdk)
// and guards that it is fully DECLARATIVE — one-click install + silent auth by
// data, zero manual config (bao 2026-07-01): the generic provision+auth engine
// runs the declared compose + bootstrap + token-exchange. Design:
// feature-pack-provision-auth-engine.md.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { McpManifestSchema } from '@ctrl/mcp-sdk';

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

  it('is one-click + silent by declaration (no manual config_schema)', () => {
    // No manual config wizard — the engine provisions + auto-auths.
    expect(manifest.config_schema).toBeUndefined();

    const provision = manifest.provision as { service?: Record<string, unknown> };
    expect(provision.service?.runtime).toBe('compose');
    expect(provision.service?.compose_inline).toBeTypeOf('string');
    // Secrets the engine generates on first provision (never user-entered).
    expect(provision.service?.generated_secrets).toContain('JWT_SECRET_KEY');

    const auth = manifest.auth as {
      bootstrap?: { path: string; capture: { into_secret: string } };
      token_exchange?: { path: string; capture_bearer: string };
    };
    // bootstrap mints the account/token automatically (no manual token).
    expect(auth.bootstrap?.path).toBe('/api/v1/user');
    expect(auth.bootstrap?.capture.into_secret).toBe('ghostfolio_token');
    // token-exchange mints a JWT per call from that stored secret.
    expect(auth.token_exchange?.path).toBe('/api/v1/auth/anonymous');
    expect(auth.token_exchange?.capture_bearer).toBe('/authToken');
  });
});
