// Locks the cross-language wire contract between the kernel's no-docker guidance
// (pack_provision.rs::NEEDS_CONTAINER_RUNTIME + container_runtime_guidance) and
// the frontend card. The sentinel + JSON tail is the one silent coupling across
// Rust↔TS — this asserts the parser tolerates it (independent-checker suggestion,
// bao 2026-07-05).
import { describe, it, expect } from 'vitest';
import { parseRuntimeGuidance, RUNTIME_SENTINEL as SENTINEL } from './runtimeGuidance';

// Mirrors what pack_provision::install_pack emits: sentinel + a space + compact JSON.
const wire = (obj: unknown): string => `${SENTINEL} ${JSON.stringify(obj)}`;

describe('parseRuntimeGuidance', () => {
  it('parses the kernel sentinel + JSON tail into structured guidance', () => {
    const msg = wire({
      kind: 'needs_container_runtime',
      platform: 'macos',
      headline: 'This pack runs a self-hosted service…',
      steps: ['Install Homebrew', 'brew install colima'],
      commands: ['brew install colima docker docker-compose', 'colima start'],
      docs_url: 'https://github.com/abiosoft/colima#installation',
    });
    const g = parseRuntimeGuidance(msg);
    expect(g).not.toBeNull();
    expect(g?.platform).toBe('macos');
    expect(g?.commands).toEqual([
      'brew install colima docker docker-compose',
      'colima start',
    ]);
    expect(g?.steps).toHaveLength(2);
    expect(g?.docs_url).toMatch(/^https:\/\//);
  });

  it('tolerates a transport-wrapped prefix (JSON is always the tail)', () => {
    const g = parseRuntimeGuidance(
      `Error invoking remote method: ${wire({ commands: ['colima start'] })}`,
    );
    expect(g?.commands).toEqual(['colima start']);
  });

  it('returns null for an unrelated error and never throws on garbage', () => {
    expect(parseRuntimeGuidance('ctrl-ghostfolio not configured — provision or set its credentials')).toBeNull();
    expect(parseRuntimeGuidance(`${SENTINEL} {not valid json`)).toBeNull();
  });

  it('defends against missing/malformed fields', () => {
    const g = parseRuntimeGuidance(wire({ kind: 'needs_container_runtime' }));
    expect(g).not.toBeNull();
    expect(g?.platform).toBe('this machine');
    expect(g?.steps).toEqual([]);
    expect(g?.commands).toEqual([]);
    expect(g?.docs_url).toBe('');
  });
});
