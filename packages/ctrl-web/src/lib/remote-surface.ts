// Resolve + load a pack's mobile Surface (ADR-005 §2 describe-driven SDUI).
// A pack describes its own surface via a `*_surface` gate tool (the composition
// lives in the pack). This maps a pack id to that tool and loads it through the
// LOCAL gate — used both by the desktop RemoteHost (to answer a phone) and by
// the desktop Mobile page (to show a live preview with real data, no phone).
import { gateInvoke } from './kernel';
import { engineTransport } from './llm-transport';
import type { ChatHandlers } from './remote-connection';
import type { Surface } from '@/components/remote/SurfaceRenderer';

/** The gate tool a pack exposes to describe its phone surface. Convention: a
 *  pack that opts into mobile ships a tool named `surface`; the gate namespaces
 *  it `<id>_surface` (the installed id drops the `ctrl-` prefix, e.g.
 *  `ctrl-stock-cn` → `stock-cn` → `stock-cn_surface`). Fully generic — any pack
 *  opts in the same way, no core change. Built-in faces have no surface (yet). */
export function surfaceToolFor(pack: string): string | null {
  if (!pack.startsWith('pack.')) return null;
  const id = pack.slice('pack.'.length).replace(/^ctrl-/, '');
  return `${id}_surface`;
}

/** Coerce whatever the gate hands back into a Surface, or null. An MCP tool
 *  that returns a JSON string arrives in several shapes depending on how the
 *  gate unwraps the CallToolResult: the parsed object directly, the raw JSON
 *  string, the `structuredContent` wrapper `{ result: "<json>" }`, or the raw
 *  result `{ content: [{ text: "<json>" }] }`. Peel any of them down to a
 *  Surface (identified by a `parts` array); anything else degrades to null so
 *  the renderer never crashes (SDUI never-crash rule). */
function coerceSurface(res: unknown, depth = 0): Surface | null {
  if (res == null || depth > 4) return null;
  if (typeof res === 'string') {
    try {
      return coerceSurface(JSON.parse(res), depth + 1);
    } catch {
      return null;
    }
  }
  if (typeof res === 'object') {
    const o = res as Record<string, unknown>;
    if (Array.isArray(o.parts)) return o as unknown as Surface;
    if (typeof o.result === 'string') return coerceSurface(o.result, depth + 1);
    const text = (o.content as Array<Record<string, unknown>> | undefined)?.[0]?.text;
    if (typeof text === 'string') return coerceSurface(text, depth + 1);
  }
  return null;
}

/** Load a pack's Surface through the local gate; null if it has no surface. */
export async function loadLocalSurface(pack: string): Promise<Surface | null> {
  const tool = surfaceToolFor(pack);
  if (tool == null) return null;
  try {
    return coerceSurface(await gateInvoke<unknown>(tool));
  } catch {
    return null;
  }
}

/** Run a surface Action through the local gate (the desktop-preview equivalent
 *  of the phone tunneling it back). Fire-and-resolve; the caller re-loads. */
export async function runLocalAction(op: string, args: Record<string, unknown>): Promise<void> {
  await gateInvoke(op, args);
}

/** Stream Irisy locally into the same ChatHandlers the phone uses, so the
 *  preview's conversation is the real assistant — mirrors RemoteHost.streamChat
 *  but without the relay hop (this IS the desktop). */
export function localChat(text: string, h: ChatHandlers): void {
  void (async () => {
    try {
      const stream = engineTransport().stream([{ role: 'user', content: text }], {});
      for await (const chunk of stream) {
        const delta = typeof chunk === 'string' ? chunk : (chunk?.delta ?? '');
        if (delta) h.onChunk(delta);
      }
      h.onDone();
    } catch (e) {
      h.onDone(e instanceof Error ? e.message : String(e));
    }
  })();
}
