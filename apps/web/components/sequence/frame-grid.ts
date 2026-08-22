/**
 * Frame grid layout — pure geometry for placing Frames on the pasteboard.
 *
 * Kept out of `core/` on purpose: this reasons about scene-pixel layout for
 * rendering (how big a frame draws, where it sits relative to other frames),
 * not the abstract page-order math `core/src/frames.ts` owns (`reorderFrame`,
 * `frameAt`). A `Frame`'s `position` says where it sits in the book's reading
 * order; this module turns that index into an actual on-canvas rectangle.
 *
 * No Fabric or DOM imports — this is plain arithmetic, which is what makes it
 * unit-testable under Vitest without a browser.
 */

import { boundingBoxOf, type Asset, type Bounds, type CanvasPlacement, type Frame } from "@loupe/core"

/**
 * Scene-unit width every frame renders at, regardless of its real-world size
 * in millimetres. Frames of different physical page sizes still compare
 * visually on the pasteboard because they share this display width and only
 * their height varies (from aspect ratio). The value is picked to be roughly
 * the same order of magnitude as an imported photograph's scene-unit size
 * (see `core/src/geometry.ts`'s `layoutNewPlacements`), so frames and loose
 * photos read as comparable objects on the light table rather than one
 * dwarfing the other.
 */
export const FRAME_DISPLAY_WIDTH = 1200

/** Scene-unit gap between adjacent frames in the grid. Matches the gap loose
 *  photos use on import (`IMPORT_GAP` in `core/src/geometry.ts`) for a
 *  consistent rhythm across the pasteboard. */
export const FRAME_GAP = 40

/** Frames per row before the grid wraps to a new row. */
export const FRAMES_PER_ROW = 4

/** Vertical gap between the pasteboard's loose-photo content and where the
 *  frame grid begins, so imported photographs and frames never overlap by
 *  default. */
const PASTEBOARD_GAP = 120

export interface FrameLayout {
  frameId: string
  bounds: Bounds
}

/**
 * The rectangle a frame occupies on the pasteboard, addressed by its index in
 * reading order (its `position`) rather than its id — the caller already
 * knows which frame it wants the rectangle for.
 *
 * `originY` is the scene-unit top of the whole grid; callers get it from
 * `frameGridOriginY` so the grid starts below existing pasteboard content.
 *
 * Frame count of 0 or 1 both fall out of the same arithmetic with no special
 * case: index 0 is always `(0, originY)`, and there is nothing to wrap around
 * for a single frame.
 */
export function frameRectAt(pageSize: { width: number; height: number }, index: number, originY: number): Bounds {
  const aspect = pageSize.width / pageSize.height
  const width = FRAME_DISPLAY_WIDTH
  const height = width / aspect

  const column = index % FRAMES_PER_ROW
  const row = Math.floor(index / FRAMES_PER_ROW)

  return {
    x: column * (width + FRAME_GAP),
    y: originY + row * (height + FRAME_GAP),
    width,
    height,
  }
}

/**
 * Lay out every frame in reading order (array order, which the store keeps in
 * sync with `Frame.position` — see `reorderFrameById` in editor-store.ts)
 * into on-pasteboard rectangles.
 *
 * Returns `[]` for an empty array rather than throwing — an empty book simply
 * has nothing to draw yet.
 */
export function layoutFrames(frames: readonly Frame[], originY: number): FrameLayout[] {
  return frames.map((frame, index) => ({
    frameId: frame.id,
    bounds: frameRectAt(frame.pageSize, index, originY),
  }))
}

/**
 * Where the frame grid begins, in scene units — below the pasteboard's
 * current loose-photo content. Reuses `boundingBoxOf`'s bounding-box logic
 * (the same model `layoutNewPlacements` in `core/src/geometry.ts` uses to
 * place a second import below the first) so the two "start below whatever is
 * already there" behaviors stay consistent.
 *
 * An empty pasteboard (no placements, or none with a resolvable asset)
 * collapses to a zero-size box at the origin, so the grid simply starts at 0.
 */
export function frameGridOriginY(placements: readonly CanvasPlacement[], assets: readonly Asset[]): number {
  const box = boundingBoxOf(placements, assets)
  if (box.width === 0 && box.height === 0) return 0
  return box.y + box.height + PASTEBOARD_GAP
}

/**
 * Which laid-out frame's center is closest to a point — used to turn a drag's
 * drop position into an insertion index for `reorderFrame`, rather than
 * requiring the drop to land exactly inside another frame's rectangle (a
 * frame being dragged is often *between* two others, or past the last one).
 *
 * Returns 0 for an empty layout so the caller always gets a valid index to
 * reorder into, rather than having to special-case "no frames yet".
 */
export function nearestFrameIndex(layouts: readonly FrameLayout[], point: { x: number; y: number }): number {
  let bestIndex = 0
  let bestDistance = Infinity

  layouts.forEach((layout, index) => {
    const centerX = layout.bounds.x + layout.bounds.width / 2
    const centerY = layout.bounds.y + layout.bounds.height / 2
    const distance = (point.x - centerX) ** 2 + (point.y - centerY) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })

  return bestIndex
}
