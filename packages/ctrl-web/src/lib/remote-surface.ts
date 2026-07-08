// Resolve + load a pack's mobile Surface (ADR-005 §2 describe-driven SDUI).
// A pack describes its own surface via a `*_surface` gate tool (the composition
// lives in the pack). This maps a pack id to that tool and loads it through the
// LOCAL gate — used both by the desktop RemoteHost (to answer a phone) and by
// the desktop Mobile page (to show a live preview with real data, no phone).
import { gateInvoke } from './kernel';
import type { Surface } from '@/components/remote/SurfaceRenderer';

/** The gate tool a pack exposes to describe its phone surface. v1 knows the
 *  stock pack by convention; the general form is a manifest-declared tool, so
 *  ANY pack opts in the same way (no core changes per pack). */
export function surfaceToolFor(pack: string): string | null {
  if (pack.includes('stock')) return 'stock_surface';
  return null;
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
