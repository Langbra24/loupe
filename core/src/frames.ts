/**
 * Operations on Frames — pages-in-progress on the canvas.
 *
 * All pure and total: no ids generated here, no clocks read. Callers supply
 * both, which keeps these functions testable and keeps `core/` free of any
 * ambient dependency. Mirrors the conventions in sequence.ts and the deleted
 * edits.ts.
 */

import { moveItem } from './collections'
import { vandeGraafMargins } from './typography'
import type { BookSetup, Bounds, Box, Frame, Margins, PageElement, PageSize } from './types'

/**
 * Move an element into a frame — a photograph dragged off the pasteboard and
 * dropped onto a frame's bounds becomes a member of that frame's page.
 *
 * Always appends: there is no z-order/stacking model for frame contents yet,
 * so "last dropped lands last in the list" is the only ordering there is.
 * `elements` is `PageElement`, not specifically `ImageElement`, so this stays
 * usable once text elements exist too — the type of thing being assigned is
 * the caller's concern, not this function's.
 *
 * The caller (apps/web) is responsible for converting a `CanvasPlacement`
 * into a `PageElement` before calling this — that conversion is where the
 * rotation/scale decision documented on `CanvasPlacement` in types.ts and in
 * editor-store.ts's `moveToFrame` action applies, not here. This function
 * only ever appends whatever `PageElement` it is given.
 *
 * A frame id that doesn't match any frame leaves the array unchanged (a new
 * array, same contents) rather than throwing — the caller may be racing a
 * frame's removal, and silently doing nothing is the safer failure mode for a
 * drag-and-drop gesture.
 */
export function assignToFrame(frames: readonly Frame[], frameId: string, element: PageElement): Frame[] {
  return frames.map((frame) =>
    frame.id === frameId ? { ...frame, elements: [...frame.elements, element] } : frame,
  )
}

/**
 * Remove an element from a frame by id. The inverse of `assignToFrame`.
 *
 * A no-op (new array, same contents) if the frame or the element isn't
 * found, for the same racing-drag-and-drop reason as `assignToFrame`.
 */
export function removeFromFrame(frames: readonly Frame[], frameId: string, elementId: string): Frame[] {
  return frames.map((frame) =>
    frame.id === frameId
      ? { ...frame, elements: frame.elements.filter((element) => element.id !== elementId) }
      : frame,
  )
}

/**
 * Apply `updater` to one frame by id — the whole-frame counterpart to
 * `assignToFrame`/`removeFromFrame`, added in U7 for the inspector's margin
 * fields. A no-op (new array, same contents) if the frame isn't found, for
 * the same racing-UI-update reason as those two.
 */
export function updateFrame(frames: readonly Frame[], frameId: string, updater: (frame: Frame) => Frame): Frame[] {
  return frames.map((frame) => (frame.id === frameId ? updater(frame) : frame))
}

/**
 * Apply `updater` to one element inside one frame — added in U7 so the
 * inspector's per-element fields (a text element's role/align/width, an
 * image element's fit/position) all go through one function rather than each
 * growing its own bespoke map-and-splice. A no-op (new array, same contents)
 * if the frame or the element isn't found, for the same reason
 * `assignToFrame`/`removeFromFrame` are.
 */
export function updateElement(
  frames: readonly Frame[],
  frameId: string,
  elementId: string,
  updater: (element: PageElement) => PageElement,
): Frame[] {
  return frames.map((frame) =>
    frame.id === frameId
      ? { ...frame, elements: frame.elements.map((element) => (element.id === elementId ? updater(element) : element)) }
      : frame,
  )
}

/**
 * Build one frame. Starts with no elements unless seeded.
 *
 * `margins` defaults to the Van de Graaf canon for `pageSize` (U7) — every
 * frame needs *some* margins for the inspector's margin fields to bind to,
 * and the canon is the same default `vandeGraafMargins` already supplies
 * elsewhere (the old per-page print-properties panel), so a frame's margins
 * start out consistent with what the rest of the app already assumed before
 * `Frame.margins` existed.
 */
export function createFrame(
  id: string,
  pageSize: Frame['pageSize'],
  position: number,
  elements: readonly PageElement[] = [],
  margins: Margins = vandeGraafMargins(pageSize),
): Frame {
  return { id, pageSize, position, elements: [...elements], margins }
}

/**
 * Build the starting set of frames for a new book: `setup.pageCount` frames,
 * all at `setup.pageSize`, positioned in order starting at 0.
 *
 * Takes `ids` rather than generating them so the caller controls id shape —
 * same reasoning as `createFrame`. `ids` must have exactly `pageCount`
 * entries; extra ids are ignored and missing ones simply produce fewer frames,
 * since this is pure and cannot fabricate an id of its own.
 */
export function framesForBookSetup(setup: BookSetup, ids: readonly string[]): Frame[] {
  return ids.slice(0, setup.pageCount).map((id, index) => createFrame(id, setup.pageSize, index))
}

/**
 * Reorder a frame's position in the book's flow, shifting everything between.
 * A thin wrapper around `moveItem` — the same operation `movePage` in
 * sequence.ts performs on `Project['pages']`, applied here to `Project['frames']`.
 *
 * Note this reorders the array only; it does not touch `Frame.position`.
 * Callers that persist `position` as the source of truth should re-derive it
 * from the resulting array index after calling this.
 */
export function reorderFrame(frames: readonly Frame[], from: number, to: number): Frame[] {
  return moveItem(frames, from, to)
}

/** A frame's rectangle on the pasteboard, for hit-testing. Kept separate from
 *  `Frame` itself because where a frame sits on the canvas is a rendering
 *  concern for a later unit — this module only needs the id and the rectangle. */
export interface FrameBounds {
  frameId: string
  bounds: Bounds
}

/**
 * Which frame (if any) a point falls inside — used to decide whether a
 * dragged element should snap into a frame or stay loose on the pasteboard.
 *
 * Boundary tie-break: a frame's rectangle is treated as inclusive on its
 * top/left edges and exclusive on its bottom/right edges — `[x, x+width)` and
 * `[y, y+height)`. For two frames that tile edge-to-edge with no gap, a point
 * exactly on the shared seam therefore belongs to the *later* frame (the one
 * whose top/left edge the point sits on), never to both or neither. This
 * mirrors the usual convention for tiled/gridded regions and keeps the result
 * a single unambiguous frame id instead of requiring a further tie-break rule
 * at the call site.
 *
 * Returns `null` when the point is outside every frame, i.e. it stays on the
 * pasteboard.
 */
export function frameAt(frames: readonly FrameBounds[], point: { x: number; y: number }): string | null {
  for (const { frameId, bounds } of frames) {
    const inX = point.x >= bounds.x && point.x < bounds.x + bounds.width
    const inY = point.y >= bounds.y && point.y < bounds.y + bounds.height
    if (inX && inY) return frameId
  }

  return null
}

/**
 * Carry a frame's elements across a page-size change (R26).
 *
 * `Box` is already normalized 0..1 relative to the page, so an element's
 * position and size need no conversion at all when the page changes size —
 * a caption at `{x: 0.25, y: 0.1}` sits at the same relative spot on an A4
 * page as it did on an A5 one. That is what makes this function an identity
 * on `frame`: there is nothing to recompute.
 *
 * What actually changes on a page-size change is aspect ratio, and that is
 * handled entirely by `ImageElement.fit` at render time — a `'contain'` fit
 * re-letterboxes to the new aspect automatically because it is drawn fresh
 * against the new page dimensions, not because anything here mutates the
 * element. This function exists as the named, tested place that documents
 * the decision ("position/size survive unchanged; distortion is handled by
 * fit, not by this function") rather than to perform real computation —
 * `oldSize`/`newSize` are accepted so a future revision that needs to react
 * to a specific size transition has an obvious place to do it, and so the
 * decision doesn't quietly live only in a code comment with no call site.
 */
export function refitElementsForPageSize(
  oldSize: PageSize,
  newSize: PageSize,
  elements: readonly PageElement[],
): PageElement[] {
  void oldSize
  void newSize
  return [...elements]
}

/**
 * Fixed layout choices for dropping an image into a frame, offered from a
 * right-click on the image itself — a small, opinionated set rather than
 * free-form positioning, since the point is a print-safe starting layout the
 * user can still drag/resize from afterward.
 *
 * - `full-bleed`: fills the page and extends past the trim edge into the
 *   bleed margin on every side, so trimming the printed sheet never leaves a
 *   white sliver.
 * - `centered`: inset from every edge by the frame's own content margins
 *   (`Frame.margins`, or the Van de Graaf canon default) — "clean padding
 *   all the way around."
 * - `left-half`: inset by the same margins, but only occupies the page's
 *   left half — its right edge sits exactly on the page's horizontal
 *   midpoint, for a diptych-style layout across a spread.
 */
export type ImagePreset = 'full-bleed' | 'centered' | 'left-half'

/**
 * Compute the normalized `Box` for one of the fixed image presets.
 *
 * All three presets are expressed in the same 0..1-relative-to-page space
 * `ImageElement.frame` already uses — `full-bleed`'s box legitimately extends
 * outside 0..1 (negative x/y, width/height over 1), since bleed is by
 * definition outside the trim edge. Nothing about `Box` forbids that; it is
 * only ever clamped at render/export time by whatever draws it, not by the
 * type itself.
 */
export function presetImageBox(
  preset: ImagePreset,
  pageSize: PageSize,
  margins: Margins,
  bleedMm: number,
): Box {
  const bleedX = bleedMm / pageSize.width
  const bleedY = bleedMm / pageSize.height

  if (preset === 'full-bleed') {
    return { x: -bleedX, y: -bleedY, width: 1 + 2 * bleedX, height: 1 + 2 * bleedY }
  }

  const left = margins.inner / pageSize.width
  const right = margins.outer / pageSize.width
  const top = margins.top / pageSize.height
  const bottom = margins.bottom / pageSize.height
  const height = 1 - top - bottom

  if (preset === 'centered') {
    return { x: left, y: top, width: 1 - left - right, height }
  }

  // left-half: same left inset and content height, right edge pinned to the
  // page's horizontal midpoint rather than the outer margin.
  return { x: left, y: top, width: 0.5 - left, height }
}
