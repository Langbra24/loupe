/**
 * Operations on Frames — pages-in-progress on the canvas.
 *
 * All pure and total: no ids generated here, no clocks read. Callers supply
 * both, which keeps these functions testable and keeps `core/` free of any
 * ambient dependency. Mirrors the conventions in sequence.ts and the deleted
 * edits.ts.
 */

import { moveItem } from './collections'
import type { BookSetup, Bounds, Frame, PageElement } from './types'

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

/** Build one frame. Starts with no elements unless seeded. */
export function createFrame(
  id: string,
  pageSize: Frame['pageSize'],
  position: number,
  elements: readonly PageElement[] = [],
): Frame {
  return { id, pageSize, position, elements: [...elements] }
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
