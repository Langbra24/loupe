/**
 * Whole-book ordering. Pure functions over `Project['pages']` — no mutation,
 * no DOM, no framework. This is the logic behind Sequence view.
 */

import { moveItem } from './collections'
import type { Page, PageId, Project, Spread } from './types'

/**
 * Derive facing-page pairs from reading order.
 *
 * Page 1 is a recto (right-hand page) with nothing facing it — you see it
 * alone when you open the front cover. Every subsequent pair is
 * verso/recto together. If the book has an even number of pages the final
 * page also stands alone.
 *
 *   pages:   [1, 2, 3, 4, 5]
 *   spreads: [_,1] [2,3] [4,5]
 */
export function toSpreads(pages: readonly Page[]): Spread[] {
  if (pages.length === 0) return []

  const spreads: Spread[] = [{ index: 0, left: null, right: pages[0] ?? null }]

  for (let i = 1; i < pages.length; i += 2) {
    spreads.push({
      index: spreads.length,
      left: pages[i] ?? null,
      right: pages[i + 1] ?? null,
    })
  }

  return spreads
}

/** Reading-order position of a page, or -1. */
export function pageNumber(pages: readonly Page[], pageId: PageId): number {
  return pages.findIndex((page) => page.id === pageId)
}

/** Move a page to a new position, shifting everything between. Shares its
 *  implementation with edit-member reordering — the same operation on a
 *  different list. */
export function movePage(pages: readonly Page[], from: number, to: number): Page[] {
  return moveItem(pages, from, to)
}

/** Exchange two pages in place, leaving every other position untouched.
 *  Distinct from `movePage`: swapping is the "compare these two" gesture,
 *  moving is the "this belongs earlier" gesture. */
export function swapPages(pages: readonly Page[], a: number, b: number): Page[] {
  const next = [...pages]
  const pageA = next[a]
  const pageB = next[b]
  if (!pageA || !pageB) return next

  next[a] = pageB
  next[b] = pageA
  return next
}

export interface PageCountCheck {
  count: number
  /** Saddle-stitch binding folds sheets in half, so the page count must be a
   *  multiple of 4 — one sheet yields four pages. */
  isValidForSaddleStitch: boolean
  /** Blank pages needed to reach the next valid count. */
  blanksNeeded: number
  message: string
}

/**
 * Validate page count against saddle-stitch binding.
 *
 * This is the single most common way a first zine goes wrong at the print
 * shop, so Print view surfaces it rather than failing silently at export.
 */
export function checkPageCount(pageCount: number): PageCountCheck {
  const remainder = pageCount % 4
  const blanksNeeded = remainder === 0 ? 0 : 4 - remainder

  if (pageCount === 0) {
    return {
      count: 0,
      isValidForSaddleStitch: false,
      blanksNeeded: 4,
      message: 'Add pages to get started.',
    }
  }

  if (blanksNeeded === 0) {
    return {
      count: pageCount,
      isValidForSaddleStitch: true,
      blanksNeeded: 0,
      message: `${pageCount} pages — ready for saddle stitch.`,
    }
  }

  return {
    count: pageCount,
    isValidForSaddleStitch: false,
    blanksNeeded,
    message: `${pageCount} pages. Saddle stitch needs a multiple of 4 — add ${blanksNeeded} ${
      blanksNeeded === 1 ? 'page' : 'pages'
    }.`,
  }
}

/** Convenience wrapper so callers don't reach into `project.pages` themselves. */
export function projectSpreads(project: Project): Spread[] {
  return toSpreads(project.pages)
}
