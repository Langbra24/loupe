/**
 * Operations on Frames — pages-in-progress on the canvas.
 *
 * All pure and total: no ids generated here, no clocks read. Callers supply
 * both, which keeps these functions testable and keeps `core/` free of any
 * ambient dependency. Mirrors the conventions in sequence.ts and the deleted
 * edits.ts.
 */

import { moveItem } from './collections'
import { defaultFrameMargins } from './typography'
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
 * `margins` defaults to `defaultFrameMargins` for `pageSize` (U7) — every
 * frame needs *some* margins for the inspector's margin fields to bind to.
 * That default keeps the Van de Graaf canon's top/bottom split but
 * symmetrizes inner/outer into equal left/right margins, since `Frame` has
 * no recto/verso concept to make the canon's asymmetric inner/outer
 * meaningful (see the comment on `defaultFrameMargins` in typography.ts).
 */
export function createFrame(
  id: string,
  pageSize: Frame['pageSize'],
  position: number,
  elements: readonly PageElement[] = [],
  margins: Margins = defaultFrameMargins(pageSize),
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

/**
 * Insert a new frame at a specific array index, shifting everything from
 * that index onward — the copy/paste and "add a paired page" operations
 * both need to land a frame *next to* a specific one, not appended at the
 * end the way `addFrame` (apps/web) does. `index` is clamped to
 * `[0, frames.length]` rather than throwing on an out-of-range value, the
 * same tolerant-of-a-stale-index stance `frameAt`/`assignToFrame` take —
 * the caller may be racing a frame's removal.
 *
 * Positions are not re-derived here — same division of responsibility as
 * `reorderFrame`: this only reorders the array, callers persisting
 * `Frame.position` re-derive it from the resulting index afterward.
 */
export function insertFrame(frames: readonly Frame[], index: number, frame: Frame): Frame[] {
  const clamped = Math.max(0, Math.min(index, frames.length))
  const next = [...frames]
  next.splice(clamped, 0, frame)
  return next
}

/**
 * One row of the book, grouped for layout purposes: either a solo frame
 * (a cover, or a trailing frame with no partner left over) or a spread — two
 * facing frames meant to sit visually together, à la InDesign, so an image
 * can span the gutter between them (`ImagePreset`'s `'two-page-spread'`
 * below).
 *
 * Purely derived, like `Spread`/`toSpreads` already are for the (currently
 * unused) `Page` model — nothing stores this grouping, it's recomputed from
 * `Frame.position` order and `Frame.isCover` every time it's needed, so a
 * reorder or a newly-marked cover always regroups correctly with no
 * migration step. Distinct from `Spread`: that type pairs `Page`s for the
 * committed-book concept nothing currently populates; this pairs `Frame`s,
 * the pages actually in progress on the canvas.
 */
export type FrameGroup = { kind: 'solo'; frame: Frame } | { kind: 'spread'; left: Frame; right: Frame }

/**
 * Groups frames (already in reading order) into the rows they lay out as:
 * a cover frame is always solo — it interrupts pairing rather than joining
 * one, even mid-sequence, since a cover marked partway through a book (an
 * unusual but not-forbidden use of the flag) still shouldn't drag a
 * neighbor into a spread with it. Every other frame pairs with the next one
 * in sequence; an odd frame out (an unpaired frame left over before a cover
 * or at the very end) is solo too, not silently dropped.
 */
export function groupFramesIntoSpreads(frames: readonly Frame[]): FrameGroup[] {
  const groups: FrameGroup[] = []
  let pending: Frame | null = null

  for (const frame of frames) {
    if (frame.isCover) {
      if (pending) {
        groups.push({ kind: 'solo', frame: pending })
        pending = null
      }
      groups.push({ kind: 'solo', frame })
      continue
    }

    if (pending) {
      groups.push({ kind: 'spread', left: pending, right: frame })
      pending = null
    } else {
      pending = frame
    }
  }

  if (pending) groups.push({ kind: 'solo', frame: pending })

  return groups
}

/**
 * Which half of a spread `frameId` sits in, if any — `null` for a solo frame
 * (a cover, an unpaired trailing frame, or an id not present at all). Used
 * by the `'two-page-spread'` image preset (`presetImageBox` below) to know
 * which direction to span the gutter.
 */
export function spreadSideOf(frames: readonly Frame[], frameId: string): 'left' | 'right' | null {
  for (const group of groupFramesIntoSpreads(frames)) {
    if (group.kind !== 'spread') continue
    if (group.left.id === frameId) return 'left'
    if (group.right.id === frameId) return 'right'
  }
  return null
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
 * - `two-page-spread`: inset by the *outer* margin only, on the true outer
 *   edge of whichever half of a spread this frame is — its far edge
 *   crosses straight through the gutter with no inset at all, into the
 *   facing frame, so a single image visually spans both pages of an actual
 *   `FrameGroup` spread (`groupFramesIntoSpreads`). Requires knowing which
 *   half this frame is (`spreadSideOf`) — falls back to `centered`'s box
 *   when the frame has no partner (a cover, or an unpaired trailing frame),
 *   since there's nothing to span into.
 */
export type ImagePreset = 'full-bleed' | 'centered' | 'left-half' | 'two-page-spread'

/**
 * Compute the normalized `Box` for one of the fixed image presets.
 *
 * All three original presets are expressed in the same 0..1-relative-to-page
 * space `ImageElement.frame` already uses — `full-bleed`'s box legitimately
 * extends outside 0..1 (negative x/y, width/height over 1), since bleed is
 * by definition outside the trim edge. `two-page-spread` extends outside
 * 0..1 for the same reason a spread crosses the gutter: `spreadSide`
 * decides which direction. Nothing about `Box` forbids any of this; it is
 * only ever clamped at render/export time by whatever draws it, not by the
 * type itself.
 *
 * `spreadSide` is only consulted for `'two-page-spread'` — every other
 * preset ignores it, so callers that don't yet know a frame's spread side
 * (or are applying a different preset) can simply omit it.
 */
export function presetImageBox(
  preset: ImagePreset,
  pageSize: PageSize,
  margins: Margins,
  bleedMm: number,
  spreadSide: 'left' | 'right' | null = null,
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

  if (preset === 'left-half') {
    // Same left inset and content height, right edge pinned to the page's
    // horizontal midpoint rather than the outer margin.
    return { x: left, y: top, width: 0.5 - left, height }
  }

  // two-page-spread, no partner to span into — the closest sensible
  // fallback is the same box `centered` produces.
  if (!spreadSide) {
    return { x: left, y: top, width: 1 - left - right, height }
  }

  // Spans from this half's outer edge (`right`, the margin away from the
  // spine — reused for both halves under the assumption, true for every
  // frame `framesForBookSetup` creates, that both pages of a spread share
  // the same page size and margins) all the way to the facing page's outer
  // edge, crossing the gutter itself with zero inset.
  const spanWidth = 2 * (1 - right)
  const x = spreadSide === 'left' ? right : -(1 - right)
  return { x, y: top, width: spanWidth, height }
}
