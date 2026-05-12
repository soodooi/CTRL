/**
 * E-ink rendering profile — CTRL profile slot for ST-SS subscribers
 * rendering to an electronic-paper display (Boox / Supernote / Daylight
 * etc.).
 *
 * E-ink consumers cannot tolerate 60 fps updates. Senders that detect
 * an e-ink subscriber SHOULD:
 * - coalesce updates to the refresh budget implied by `refresh_class`
 * - pre-format text to fit `page_size`
 * - quantise colour to `contrast_class`
 * - prioritise cells in `preferred_cells` over noise
 *
 * Carried in `HelloPayload.capabilities.eink_render_profile`.
 *
 * @see ../../../../.olym/specs/stss-protocol/spec.md §3.3
 * @packageDocumentation
 */

import type { CellKind } from '../protocol/kind.js';

/**
 * E-ink refresh budget.
 *
 * - `static` — render once, hold (annotation overlay, code page)
 * - `partial` — refresh sub-regions independently (typed text)
 * - `full` — full-frame refresh (ghosting tolerated, slow updates)
 *
 * @public
 */
export type EinkRefreshClass = 'static' | 'partial' | 'full' | (string & {});

/**
 * Colour depth the display can render meaningfully.
 *
 * @public
 */
export type EinkContrastClass = 'binary' | '16_grey' | 'full_grey';

/**
 * E-ink profile carried at handshake.
 *
 * @public
 */
export interface EinkRenderProfile {
  /** Pixels per inch. */
  readonly ppi: number;
  readonly refresh_class: EinkRefreshClass;
  /** Page dimensions in pixels. */
  readonly page_size: readonly [width: number, height: number];
  readonly contrast_class: EinkContrastClass;
  /**
   * Cells the subscriber wants prioritised. Senders MAY drop or
   * coalesce cells outside this set to stay within refresh budget.
   *
   * Typical: `['llm_response', 'tool_result']` for coding-companion
   * peripheral; `['context_snapshot']` for reading-companion
   * peripheral.
   */
  readonly preferred_cells?: readonly CellKind[];
}
