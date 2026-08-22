/**
 * Named page-size presets and custom-dimension validation for the book-setup
 * flow — the one-time prompt (apps/web's book-setup-dialog.tsx) that asks a
 * new project for its page size and starting page count.
 *
 * `PageSize` itself lives in types.ts; this module only supplies concrete
 * values and the bound that keeps a custom size sane.
 */

import type { PageSize } from './types'

/**
 * Upper bound on either dimension of a custom page size, in millimetres.
 * 1000mm (1 metre) is comfortably past any realistic photobook or zine —
 * large-format art prints top out well under that — so it exists purely to
 * catch fat-fingered input (an extra digit, a unit mix-up) rather than to
 * constrain a real use case.
 */
export const MAX_PAGE_DIMENSION_MM = 1000

/**
 * Three to four named presets spanning the common photobook shapes: a small
 * portrait format, the ubiquitous A4, and two square formats at different
 * scales (squares are a popular photobook convention because they sidestep
 * the "landscape or portrait" question for mixed orientation photo sets).
 *
 * Values are in millimetres, matching `PageSize`'s documented convention
 * (see types.ts and typography.ts's `vandeGraafMargins`).
 */
export const PAGE_SIZE_PRESETS: readonly PageSize[] = [
  { name: '8×8 in Square', width: 203, height: 203 },
  { name: 'A5 Portrait', width: 148, height: 210 },
  { name: 'A4 Portrait', width: 210, height: 297 },
  { name: '12×12 in Square', width: 305, height: 305 },
]

export interface PageSizeValidation {
  valid: boolean
  /** Human-readable reason, present only when `valid` is false — a form can
   *  show it directly next to the offending field. */
  reason?: string
}

/**
 * Validate a custom page size before it becomes a `PageSize`.
 *
 * Rejects zero, negative, non-finite (NaN/Infinity — a form field can produce
 * either while it's being edited), and absurdly large values in either
 * dimension. Anything else is accepted: this deliberately does not enforce
 * an aspect ratio or a minimum, since a zine can legitimately be tiny or
 * extremely elongated.
 */
export function validateCustomPageSize(width: number, height: number): PageSizeValidation {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { valid: false, reason: 'Width and height must be numbers' }
  }
  if (width <= 0 || height <= 0) {
    return { valid: false, reason: 'Width and height must be greater than zero' }
  }
  if (width > MAX_PAGE_DIMENSION_MM || height > MAX_PAGE_DIMENSION_MM) {
    return { valid: false, reason: `Width and height must be at most ${MAX_PAGE_DIMENSION_MM}mm` }
  }
  return { valid: true }
}
