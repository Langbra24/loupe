/**
 * Modular type scale and page-margin canon.
 *
 * Every size in a Loupe book derives from one base size and one ratio, rather
 * than being picked per element. That constraint is the point: it is what
 * keeps a first-time bookmaker's captions and titles in proportion without
 * them having to know why.
 *
 * The ratio is NOT locked in yet — 1.618 is dramatic at caption sizes and may
 * lose to 1.5 or 1.333 once tested at real print dimensions. See open
 * decision 2 in docs/plans/00-initial-build-brief.md.
 */

import type { PageSize, TypeRole } from './types'

export const TYPE_RATIOS = {
  /** Golden ratio. Dramatic — big jumps between steps. */
  golden: 1.618,
  /** Perfect fifth. */
  fifth: 1.5,
  /** Perfect fourth. Subtlest of the three. */
  fourth: 1.333,
} as const

export type TypeRatioName = keyof typeof TYPE_RATIOS

/** Steps away from the base size. Negative steps are smaller than body text. */
const ROLE_STEPS: Record<TypeRole, number> = {
  title: 3,
  subtitle: 2,
  body: 0,
  caption: -1,
  credit: -1,
  folio: -2,
}

/** Size in points for one role, given the project's base size and ratio. */
export function sizeForRole(role: TypeRole, baseSize: number, ratio: number): number {
  const step = ROLE_STEPS[role]
  return round(baseSize * Math.pow(ratio, step))
}

/**
 * The size a `TextElement` actually renders at: its own `fontSize` override
 * when set, `sizeForRole` otherwise. Most text has no override and just
 * takes its role's scale-derived size — this only exists so the sidebar's
 * "Size" field (and a freshly created element's initial, deliberately
 * larger-than-scale default) have somewhere to write a value that actually
 * takes effect, without every element needing one.
 */
export function resolveTextSize(
  role: TypeRole,
  fontSize: number | undefined,
  baseSize: number,
  ratio: number,
): number {
  return fontSize ?? sizeForRole(role, baseSize, ratio)
}

/** The whole scale at once — for rendering a specimen or a type panel. */
export function typeScale(baseSize: number, ratio: number): Record<TypeRole, number> {
  const roles = Object.keys(ROLE_STEPS) as TypeRole[]
  return roles.reduce(
    (scale, role) => {
      scale[role] = sizeForRole(role, baseSize, ratio)
      return scale
    },
    {} as Record<TypeRole, number>,
  )
}

/** Line height that loosens as type gets smaller — captions need more air per
 *  unit than titles do. */
export function leadingForSize(sizeInPoints: number): number {
  if (sizeInPoints >= 24) return 1.15
  if (sizeInPoints >= 14) return 1.3
  return 1.45
}

export interface PageMargins {
  top: number
  inner: number
  outer: number
  bottom: number
}

/**
 * Van de Graaf canon — the margin construction found in medieval manuscripts
 * and early printed books.
 *
 * It divides the page into ninths: the inner margin is 1/9 of the page width,
 * the outer margin twice that, the top margin 1/9 of the height and the bottom
 * twice that. The text block ends up the same proportion as the page itself,
 * and sits noticeably high and toward the spine — which is why old books look
 * settled in a way that centered margins don't.
 *
 * Units follow whatever `pageSize` uses (millimetres, by convention here).
 */
export function vandeGraafMargins(pageSize: PageSize): PageMargins {
  return {
    inner: round(pageSize.width / 9),
    outer: round((pageSize.width * 2) / 9),
    top: round(pageSize.height / 9),
    bottom: round((pageSize.height * 2) / 9),
  }
}

/**
 * Default margins for a newly created frame.
 *
 * Van de Graaf's asymmetry — narrower inner margin, wider outer margin;
 * narrower top, wider bottom — exists to balance a two-page spread bound on
 * one edge and to seat text optically on a single printed page. Both of
 * those conventions only make visual sense once a page knows which side of
 * the spine it's on and how it's bound — but `Frame` has no recto/verso or
 * binding-orientation concept yet (every frame renders identically
 * regardless of its position in the book; see
 * docs/plans/2026-08-22-001-feat-unified-canvas-plan.md). Until that exists,
 * applying the canon's asymmetry as-is just reads as an off-center guide on
 * every page, not a deliberate convention — confirmed directly against a
 * screenshot of the drawn guide, which visibly sat high with far more
 * whitespace below than above.
 *
 * This keeps `vandeGraafMargins` itself untouched — it still documents the
 * real canon for whenever recto/verso/binding-orientation support lands —
 * and instead gives new frames fully symmetric margins on both axes,
 * splitting each of the canon's total horizontal and vertical margins evenly
 * so the live text-block's width and height are unchanged from the canon,
 * just centered.
 */
export function defaultFrameMargins(pageSize: PageSize): PageMargins {
  const canon = vandeGraafMargins(pageSize)
  const horizontal = round((canon.inner + canon.outer) / 2)
  const vertical = round((canon.top + canon.bottom) / 2)
  return { inner: horizontal, outer: horizontal, top: vertical, bottom: vertical }
}

/** The live text area left over after the canon margins. */
export function textBlock(pageSize: PageSize): { width: number; height: number } {
  const margins = vandeGraafMargins(pageSize)
  return {
    width: round(pageSize.width - margins.inner - margins.outer),
    height: round(pageSize.height - margins.top - margins.bottom),
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
