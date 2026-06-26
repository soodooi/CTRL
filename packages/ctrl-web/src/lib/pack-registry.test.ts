import { describe, it, expect } from 'vitest';
import { mapRegistryServers } from './pack-registry';

// Fixture mirrors the official MCP Registry shape (2025-12 schema) captured
// from registry.modelcontextprotocol.io/v0/servers — entries nest under
// `server`, freshness under `_meta[...].isLatest`, and the same server name
// appears once per version.
const FIXTURE = JSON.stringify({
  servers: [
    {
      server: {
        name: 'ac.inference.sh/mcp',
        title: 'inference.sh',
        description: 'Run 150+ AI apps — image, video, audio, LLMs, 3D and more.',
        version: '1.0.0',
        remotes: [{ type: 'streamable-http', url: 'https://api.inference.sh/mcp' }],
      },
      _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: false } },
    },
    {
      server: {
        name: 'ac.inference.sh/mcp',
        title: 'inference.sh',
        description: 'Run 150+ AI apps — newer.',
        version: '1.0.1',
        remotes: [{ type: 'streamable-http', url: 'https://api.inference.sh/mcp' }],
      },
      _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true } },
    },
    {
      server: {
        name: 'io.github.acme/weather',
        description: 'Weather lookups.',
        version: '2.1.0',
      },
      _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
    },
  ],
});

describe('mapRegistryServers (ADR-002 §7.4 Discover data source)', () => {
  it('maps registry entries to browsable remote listings', () => {
    const out = mapRegistryServers(FIXTURE);
    const weather = out.find((p) => p.id === 'io.github.acme-weather');
    expect(weather).toBeDefined();
    expect(weather?.kind).toBe('remote');
    expect(weather?.category).toBe('MCP Registry');
    expect(weather?.name).toBe('weather'); // last path segment when no title
    expect(weather?.summary).toBe('Weather lookups.');
  });

  it('dedupes by server id, keeping the version flagged latest', () => {
    const out = mapRegistryServers(FIXTURE);
    const inf = out.filter((p) => p.id === 'ac.inference.sh-mcp');
    expect(inf).toHaveLength(1);
    expect(inf[0]?.summary).toBe('Run 150+ AI apps — newer.'); // the isLatest one
    expect(inf[0]?.remoteUrl).toBe('https://api.inference.sh/mcp');
  });

  it('sanitizes the server name into a valid manifest id', () => {
    const out = mapRegistryServers(FIXTURE);
    // `/` and other non-[a-z0-9.-_] chars become dashes.
    expect(out.map((p) => p.id)).toContain('ac.inference.sh-mcp');
    for (const p of out) expect(p.id).toMatch(/^[a-z0-9.\-_]+$/);
  });

  it('returns [] on malformed JSON (graceful — degrades to bundled)', () => {
    expect(mapRegistryServers('not json')).toEqual([]);
    expect(mapRegistryServers('{}')).toEqual([]);
  });
});
