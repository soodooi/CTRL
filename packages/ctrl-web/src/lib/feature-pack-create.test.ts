import { describe, it, expect } from 'vitest';
import { draftToManifest, type DraftPack } from './feature-pack-create';

// draftToManifest is the projection a creator-generated draft passes through on
// its way to install_mcp. These assert the systematic fields (ADR-002 §
// composition §7.4) land in the shape the generic runtime + kernel expect, so
// "走 creator" produces a real connector/data pack with zero per-pack code.

describe('draftToManifest — systematic fields (ADR-002 §7.4)', () => {
  it('projects secrets into config_schema + provision.env (keychain + {{secret:}})', () => {
    const draft: DraftPack = {
      name: 'Ghostfolio',
      icon: '📈',
      summary: 'self-hosted portfolio',
      secrets: [
        { key: 'ghostfolio_url', label: 'Ghostfolio URL' },
        { key: 'ghostfolio_token', label: 'Security Token' },
      ],
      actions: [
        {
          id: 'portfolio',
          name: 'Portfolio',
          command: 'curl -s "$GHOSTFOLIO_URL/api" -H "Authorization: Bearer $GHOSTFOLIO_TOKEN"',
        },
      ],
    };
    const m = draftToManifest(draft) as Record<string, unknown>;
    expect(m.config_schema).toEqual({
      fields: [
        { key: 'ghostfolio_url', kind: 'secret', label: 'Ghostfolio URL', required: true },
        { key: 'ghostfolio_token', kind: 'secret', label: 'Security Token', required: true },
      ],
    });
    expect(m.provision).toEqual({
      tools: [],
      env: {
        GHOSTFOLIO_URL: '{{secret:ghostfolio_url}}',
        GHOSTFOLIO_TOKEN: '{{secret:ghostfolio_token}}',
      },
    });
  });

  it('binds a dedicated knowledge base via the generic knowledge_base field', () => {
    const m = draftToManifest({
      name: 'Stocks',
      icon: '📈',
      summary: 's',
      knowledge_base: 'Stocks',
      actions: [{ id: 'a', name: 'A', command: 'echo hi' }],
    }) as Record<string, unknown>;
    expect(m.knowledge_base).toBe('Stocks');
  });

  it('omits config_schema / provision / knowledge_base for a plain tool pack (back-compat)', () => {
    const m = draftToManifest({
      name: 'Disk',
      icon: '💾',
      summary: 'disk',
      actions: [{ id: 'd', name: 'Disk', command: 'df -h' }],
    }) as Record<string, unknown>;
    expect(m.config_schema).toBeUndefined();
    expect(m.provision).toBeUndefined();
    expect(m.knowledge_base).toBeUndefined();
    expect((m.actions as { steps: unknown[] }[])[0]?.steps[0]).toEqual({
      type: 'shell',
      command: 'df -h',
    });
  });

  it('sanitizes a secret key to lowercase_underscore + matching uppercase env var', () => {
    const m = draftToManifest({
      name: 'X',
      icon: '⚡',
      summary: 'x',
      secrets: [{ key: 'API-Key!', label: 'Key' }],
      actions: [{ id: 'a', name: 'A', command: 'echo $API_KEY' }],
    }) as Record<string, unknown>;
    const fields = (m.config_schema as { fields: { key: string }[] }).fields;
    expect(fields[0]?.key).toBe('api_key');
    expect((m.provision as { env: Record<string, string> }).env).toEqual({
      API_KEY: '{{secret:api_key}}',
    });
  });
});
