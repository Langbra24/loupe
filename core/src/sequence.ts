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

/** One page of an exported book: a real page, or a blank added for binding. */
export type ExportPage<T> = { kind: 'page'; frame: T } | { kind: 'blank' }

/**
 * The pages a saddle-stitched book actually prints, in order: every page,
 * plus the blanks `checkPageCount` says are needed to reach a multiple of 4.
 * Blanks go at the end of the book, or just before the back cover when the
 * last page is a cover, so the cover stays on the outside.
 *
 * Export-only: the project keeps its own page count, and the blanks exist
 * only in the exported file. Another binding would need its own rule here
 * (perfect binding usually only needs an even count).
 */
export function padForSaddleStitch<T extends { position: number; isCover?: boolean }>(
  frames: readonly T[],
): ExportPage<T>[] {
  const ordered = [...frames].sort((a, b) => a.position - b.position)
  const pages = ordered.map((frame): ExportPage<T> => ({ kind: 'page', frame }))
  if (pages.length === 0) return pages

  const blanks = Array.from({ length: checkPageCount(pages.length).blanksNeeded }, (): ExportPage<T> => ({
    kind: 'blank',
  }))
  const backCover = ordered.length > 1 && ordered[ordered.length - 1]?.isCover === true
  return backCover ? [...pages.slice(0, -1), ...blanks, ...pages.slice(-1)] : [...pages, ...blanks]
}
