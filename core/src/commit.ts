/**
 * Committing an Edit to the book — the stage two to stage three transition.
 *
 * One-way by design. Committing copies the edit's order into pages and the two
 * become independent: refining a spread in Design does not reach back into the
 * table, and rearranging the table afterwards does not silently rewrite the
 * book. There is one editable representation of an ordering at a time.
 */

import { vandeGraafMargins } from './typography'
import type { Asset, Edit, Page, PageSize } from './types'

/** A5 portrait, matching the default project. The canon is proportional, so the
 *  normalized frame it produces is the same for any page of similar shape. */
const REFERENCE_PAGE: PageSize = { name: 'reference', width: 148, height: 210 }

/**
 * Turn an ordered Edit into book pages: one photograph per page, in order.
 *
 * Members whose asset is missing from the pool are skipped rather than
 * producing a page with a dangling reference — a page that renders as a
 * permanent grey box is worse than no page.
 *
 * `idSeed` makes page ids unique per commit without reading a clock here.
 * Re-committing produces equal content with fresh ids, so the new book never
 * aliases the previous one.
 */
export function commitEditToPages(
  edit: Edit,
  assets: readonly Asset[],
  idSeed: string,
): Page[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  const frame = imageFrame()

  return edit.memberIds.flatMap((assetId, index) => {
    const asset = byId.get(assetId)
    if (!asset) return []

    const pageId = `page-${idSeed}-${index + 1}`

    return [
      {
        id: pageId,
        elements: [
          {
            id: `${pageId}-image`,
            kind: 'image' as const,
            name: asset.name,
            assetId: asset.id,
            fit: 'contain' as const,
            frame,
            locked: false,
            hidden: false,
          },
        ],
      },
    ]
  })
}

/**
 * The normalized box a committed photograph occupies.
 *
 * Derived from the Van de Graaf canon rather than an arbitrary inset, so a
 * committed book sits in the same proportions as its typography from the first
 * moment — high on the page and toward the spine, the way an old book does.
 */
function imageFrame() {
  const margins = vandeGraafMargins(REFERENCE_PAGE)

  return {
    x: margins.inner / REFERENCE_PAGE.width,
    y: margins.top / REFERENCE_PAGE.height,
    width: (REFERENCE_PAGE.width - margins.inner - margins.outer) / REFERENCE_PAGE.width,
    height: (REFERENCE_PAGE.height - margins.top - margins.bottom) / REFERENCE_PAGE.height,
  }
}
