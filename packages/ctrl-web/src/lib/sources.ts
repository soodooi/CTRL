// sources — where an answer came from.
//
// Three intents were unserved for the same reason: nothing in the product showed
// a user the SOURCE of anything. Local knowledge could be searched by the model
// but passages were never cited back to their notes, there was no reachable way
// to find something in your own content and open it, and an external lookup was
// indistinguishable from the model recalling something.
//
// One module, because it is one question. Two rules run through all of it:
//
// 1. A passage is never shown without the note it came from. A quote with no
//    source is worse than no quote, because it looks like knowledge.
// 2. Leaving the machine is explicit. A local search never triggers a web
//    request, and the provider that actually answered is named.
//
// (ADR-002 substrate §1.9 v46; ADR-005 irisy §12 v42 U3/U4/U7)

import { gateInvoke } from './kernel';
import { noteResourceRef } from './note-write';

export interface LocalHit {
  /** Vault-relative path of the note that matched. */
  path: string;
  /** Matched passage, when the kernel returned context. */
  context?: string;
}

export interface ExternalHit {
  title: string;
  url: string;
  snippet?: string;
}

export interface ExternalLookup {
  /** Which provider actually answered. Named because a keyless fallback and a
   *  configured provider are different answers. */
  provider: string;
  results: ExternalHit[];
  /** The kernel's own degradation note, when it degraded. */
  note?: string;
}

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

/** Search the user's own notes. Never performs a network request.
 *  Asks for context so every hit can be cited with its passage. */
export async function searchLocalKnowledge(
  query: string,
  limit = 20,
): Promise<LocalHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const reply = await gateInvoke<unknown>('vault_search', {
    query: trimmed,
    limit,
    with_context: true,
  });
  return normalizeLocalHits(reply);
}

/** The kernel returns rich `{path, context}` rows with context, and plain path
 *  strings on the back-compat path. Both are accepted; neither is guessed at. */
export function normalizeLocalHits(reply: unknown): LocalHit[] {
  if (!Array.isArray(reply)) return [];
  const hits: LocalHit[] = [];
  for (const entry of reply) {
    if (typeof entry === 'string') {
      if (entry.trim().length > 0) hits.push({ path: entry });
      continue;
    }
    if (entry && typeof entry === 'object') {
      const row = entry as { path?: unknown; context?: unknown };
      const path = asText(row.path);
      if (!path) continue;
      const context = asText(row.context);
      hits.push(context ? { path, context } : { path });
    }
  }
  return hits;
}

/** Canonical ref for a local hit, so opening it goes through the same Resource
 *  path as anything else the user works on. */
export function hitResourceRef(hit: LocalHit): string {
  return noteResourceRef(hit.path);
}

/** Look something up outside this machine. Explicit by construction: nothing
 *  calls this as a side effect of a local search. */
export async function lookupExternal(
  query: string,
  maxResults = 5,
): Promise<ExternalLookup> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error('a lookup needs something to look up');
  }
  const reply = await gateInvoke<unknown>('web_search', {
    query: trimmed,
    max_results: maxResults,
  });
  return normalizeExternalLookup(reply);
}

export function normalizeExternalLookup(reply: unknown): ExternalLookup {
  const envelope = (reply ?? {}) as {
    source?: unknown;
    results?: unknown;
    note?: unknown;
  };
  const results: ExternalHit[] = Array.isArray(envelope.results)
    ? envelope.results.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const row = entry as { title?: unknown; url?: unknown; snippet?: unknown };
        const url = asText(row.url);
        // A result with no URL cannot be checked, so it is not a source.
        if (!url) return [];
        const snippet = asText(row.snippet);
        return [
          {
            title: asText(row.title) ?? url,
            url,
            ...(snippet ? { snippet } : {}),
          },
        ];
      })
    : [];
  return {
    // Unknown rather than a plausible provider name: which service answered is
    // exactly the fact the user is being asked to trust.
    provider: asText(envelope.source) ?? 'unknown',
    results,
    ...(asText(envelope.note) ? { note: asText(envelope.note) as string } : {}),
  };
}

/** The host shown for an external source, so the user can judge it at a glance
 *  without parsing a URL. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // An unparseable URL is reported as-is rather than hidden.
    return url;
  }
}
