// Resolve + load a pack's mobile Surface (ADR-005 §2 describe-driven SDUI).
// A pack describes its own surface via a `*_surface` gate tool (the composition
// lives in the pack). This maps a pack id to that tool and loads it through the
// LOCAL gate — used both by the desktop RemoteHost (to answer a phone) and by
// the desktop Mobile page (to show a live preview with real data, no phone).
import { gateInvoke } from './kernel';
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

/** Load a pack's Surface through the local gate; null if it has no surface. */
export async function loadLocalSurface(pack: string): Promise<Surface | null> {
  const tool = surfaceToolFor(pack);
  if (tool == null) return null;
  try {
    return await gateInvoke<Surface>(tool);
  } catch {
    return null;
  }
}
