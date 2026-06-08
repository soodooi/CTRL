// Unit tests for the Pi bridge extension's `register()` entry point.
//
// Contract under test (ADR-002 substrate § provider v9/v10 + brain v15):
// the extension was rewritten away from registering an LLM provider
// (`registerProvider` + `streamSimple`) toward a THIN extension that only
// wires Pi's published `ExtensionAPI`: `pi.on(...)` event hooks (persona,
// vault-RAG, audit), `pi.registerTool(...)` for vault + skill tools,
// `pi.registerFlag(...)`, and `pi.registerCommand(...)`. These tests assert
// that new surface — register() must NOT call registerProvider, and it must
// wire the expected event handlers + tools.

import { describe, expect, it, vi } from 'vitest';
import register from '../index.js';

// Structural mirror of the subset of Pi's ExtensionAPI that register()
// touches. The real interface is not exported from index.ts (it is a local
// contract snapshot), so we mirror it here for the mock.
interface ToolLike {
  name: string;
  execute: (...a: unknown[]) => Promise<unknown>;
}
interface MockApi {
  on: ReturnType<typeof vi.fn>;
  registerTool: ReturnType<typeof vi.fn>;
  registerCommand: ReturnType<typeof vi.fn>;
  registerFlag: ReturnType<typeof vi.fn>;
  registerProvider: ReturnType<typeof vi.fn>;
}

function makeMockApi(): MockApi {
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerFlag: vi.fn(),
    registerProvider: vi.fn(),
  };
}

/** Collect the event names register() subscribed via pi.on(). */
function subscribedEvents(api: MockApi): string[] {
  return api.on.mock.calls.map((c) => c[0] as string);
}

/** Find the handler register() bound for a given pi.on() event. */
function handlerFor(
  api: MockApi,
  event: string,
): (event: unknown, ctx: unknown) => Promise<unknown> | unknown {
  const call = api.on.mock.calls.find((c) => c[0] === event);
  if (!call) throw new Error(`no handler registered for "${event}"`);
  return call[1] as (event: unknown, ctx: unknown) => Promise<unknown> | unknown;
}

/** Collect registered tool names. */
function registeredToolNames(api: MockApi): string[] {
  return api.registerTool.mock.calls.map((c) => (c[0] as ToolLike).name);
}

describe('register — new ExtensionAPI contract', () => {
  it('does NOT register an LLM provider (provider was retired in v9)', () => {
    const api = makeMockApi();
    register(api as never);
    expect(api.registerProvider).not.toHaveBeenCalled();
  });

  it('wires the core event hooks (persona, RAG, audit, lifecycle)', () => {
    const api = makeMockApi();
    register(api as never);
    const events = subscribedEvents(api);
    // Persona override + auto-RAG + the audit/lifecycle hooks the extension
    // depends on must all be present.
    for (const required of [
      'before_agent_start',
      'before_provider_request',
      'after_provider_response',
      'tool_call',
      'tool_result',
      'turn_end',
      'user_bash',
      'agent_start',
      'agent_end',
      'session_start',
    ]) {
      expect(events).toContain(required);
    }
  });

  it('registers the vault + skill tools', () => {
    const api = makeMockApi();
    register(api as never);
    const names = registeredToolNames(api);
    // Vault tool surface.
    for (const vaultTool of [
      'vault_write',
      'vault_read',
      'vault_list',
      'vault_search',
      'vault_tags',
      'vault_backlinks',
    ]) {
      expect(names).toContain(vaultTool);
    }
    // Skill tool surface.
    expect(names).toContain('list_skills');
    expect(names).toContain('read_skill');
  });

  it('registers the irisy-paths slash command and the vault-root flag', () => {
    const api = makeMockApi();
    register(api as never);
    const commandNames = api.registerCommand.mock.calls.map((c) => c[0] as string);
    expect(commandNames).toContain('irisy-paths');
    const flagNames = api.registerFlag.mock.calls.map((c) => c[0] as string);
    expect(flagNames).toContain('ctrl-vault-root');
  });
});

describe('before_agent_start — persona override', () => {
  it('returns a systemPrompt override in the default (assistant) session', () => {
    const api = makeMockApi();
    register(api as never);
    const handler = handlerFor(api, 'before_agent_start');
    // No sessionManager → not a coding session → persona applies.
    const result = handler({ type: 'before_agent_start' }, {}) as
      | { systemPrompt?: string }
      | undefined;
    expect(result).toBeDefined();
    expect(typeof result?.systemPrompt).toBe('string');
    expect(result?.systemPrompt).toContain('You are Irisy');
  });

  it('skips the persona override for a coding-* session (Pi keeps its default prompt)', () => {
    const api = makeMockApi();
    register(api as never);
    const handler = handlerFor(api, 'before_agent_start');
    const ctx = {
      sessionManager: { getSessionName: () => 'coding-default' },
    };
    const result = handler({ type: 'before_agent_start' }, ctx);
    expect(result).toBeUndefined();
  });
});

describe('before_provider_request — auto-RAG', () => {
  it('does not inject when the user text is too short to RAG', async () => {
    const api = makeMockApi();
    register(api as never);
    const handler = handlerFor(api, 'before_provider_request');
    const evt = { messages: [{ role: 'user', content: 'hi' }] };
    // Short query (<6 chars) → vaultSearchTopK returns [] → no injection.
    const result = await handler(evt, {});
    expect(result).toBeUndefined();
  });

  it('skips RAG entirely for a coding-* session', async () => {
    const api = makeMockApi();
    register(api as never);
    const handler = handlerFor(api, 'before_provider_request');
    const ctx = {
      sessionManager: { getSessionName: () => 'coding-default' },
    };
    const evt = {
      messages: [{ role: 'user', content: 'a sufficiently long query string' }],
    };
    const result = await handler(evt, ctx);
    expect(result).toBeUndefined();
  });
});
