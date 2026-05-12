/**
 * Stream identifier helpers — structure on top of the wire-level
 * `Envelope.source` string.
 *
 * Convention: `<publisher>:<instance>`. Publisher is the keycap /
 * extension / device family (e.g. `clipboard-ai`, `vscode-companion`,
 * `eink-boox-mira5`); instance is a stable per-running-process or
 * per-device identifier. Implementations MAY use any string for
 * either part as long as the combined id is globally unique across
 * concurrent streams on the same kernel.
 *
 * @see ../../../../.olym/specs/stss-protocol/spec.md §3.1
 * @packageDocumentation
 */

/**
 * Parsed view of a stream id.
 *
 * @public
 */
export interface StreamIdParts {
  readonly publisher: string;
  readonly instance?: string;
}

/**
 * Compose a stream id from its parts.
 *
 * @example
 * ```ts
 * formatStreamId({ publisher: 'clipboard-ai', instance: 'pid-42' })
 *   === 'clipboard-ai:pid-42';
 * formatStreamId({ publisher: 'eink-boox' })
 *   === 'eink-boox';
 * ```
 *
 * @public
 */
export function formatStreamId(parts: StreamIdParts): string {
  if (parts.instance === undefined || parts.instance.length === 0) {
    return parts.publisher;
  }
  return `${parts.publisher}:${parts.instance}`;
}

/**
 * Parse a stream id, splitting on the FIRST `:`. Returns `publisher`
 * only when there is no separator.
 *
 * @example
 * ```ts
 * parseStreamId('clipboard-ai:pid-42')
 *   === { publisher: 'clipboard-ai', instance: 'pid-42' };
 * parseStreamId('eink-boox')
 *   === { publisher: 'eink-boox' };
 * ```
 *
 * @public
 */
export function parseStreamId(streamId: string): StreamIdParts {
  const idx = streamId.indexOf(':');
  if (idx < 0) {
    return { publisher: streamId };
  }
  return {
    publisher: streamId.slice(0, idx),
    instance: streamId.slice(idx + 1),
  };
}
