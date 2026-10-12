/**
 * Frame grid layout — pure geometry for placing Frames on the pasteboard.
 *
 * Kept out of `core/` on purpose: this reasons about scene-pixel layout for
 * rendering (how big a frame draws, where it sits relative to other frames),
 * not the abstract page-order math `core/src/frames.ts` owns (`reorderFrame`,
 * `frameAt`, `groupFramesIntoSpreads`). A `Frame`'s `position` says where it
 * sits in the book's reading order; this module turns that order into actual
 * on-canvas rectangles.
 *
 * No Fabric or DOM imports — this is plain arithmetic, which is what makes it
 * unit-testable under Vitest without a browser.
 *
 * Direct follow-up (user-directed): the grid used to be a fixed four-per-row
 * wrap. It's now one row per `FrameGroup` (core/src/frames.ts) stacked straight
 * down the canvas — a cover alone on its own row, every other pair of frames
 * side by side with zero gap between them so they read as a single spread
 * (à la InDesign), an odd trailing frame solo like a cover. `FRAMES_PER_ROW`
 * is gone; there's no fixed column count left to name.
 */

import { boundingBoxOf, groupFramesIntoSpreads, type Asset, type Bounds, type CanvasPlacement, type Frame } from "@loupe/core"

/**
 * Scene-unit width a single page renders at, regardless of its real-world
 * size in millimetres. Frames of different physical page sizes still compare
 * visually on the pasteboard because they share this display width and only
 * their height varies (from aspect ratio). The value is picked to be roughly
 * the same order of magnitude as an imported photograph's scene-unit size
 * (see `core/src/geometry.ts`'s `layoutNewPlacements`), so frames and loose
 * photos read as comparable objects on the light table rather than one
 * dwarfing the other. A spread (two pages) is simply twice this wide.
 */
export const FRAME_DISPLAY_WIDTH = 1200

/** Scene-unit vertical gap between one row (a solo frame, or a spread) and
 *  the next. Generous enough that a spread's own section box (see
 *  `SPREAD_BOX_PADDING`) never touches its neighbor's. */
export const FRAME_GAP = 64

/** Padding, in scene units, between a spread's two frames and the section
 *  box drawn around them (`use-fabric-canvas.ts`'s spread-box rendering) —
 *  "a nice section box to visually separate [it] from the canvas," at
 *  direct user request. Solo rows (a cover, an unpaired trailing frame)
 *  don't get one; only actual pairs do. Kept well under half of `FRAME_GAP`
 *  so two consecutive spreads' boxes never touch. */
export const SPREAD_BOX_PADDING = 20

/** Vertical gap between the pasteboard's loose-photo content and where the
 *  frame grid begins, so imported photographs and frames never overlap by
 *  default. */
const PASTEBOARD_GAP = 120

export interface FrameLayout {
  frameId: string
  bounds: Bounds
}

/** A spread's section-box rectangle, keyed by its left frame's id — stable
 *  across reorders, since a spread is always identified by whichever frame
 *  currently occupies its left half (`groupFramesIntoSpreads`). Solo rows
 *  produce no entry here at all, not a `null` one, since there's nothing to
 *  box. */
export interface SpreadBoxLayout {
  frameId: string
  bounds: Bounds
}

/** One page's rectangle, sized from its aspect ratio at `FRAME_DISPLAY_WIDTH`,
 *  positioned at a specific scene-unit origin — the shared arithmetic both
 *  a solo frame and each half of a spread use below. */
function pageRectAt(pageSize: { width: number; height: number }, x: number, y: number): Bounds {
  const aspect = pageSize.width / pageSize.height
  const width = FRAME_DISPLAY_WIDTH
  return { x, y, width, height: width / aspect }
}

interface RowLayout {
  frames: FrameLayout[]
  spreadBox: SpreadBoxLayout | null
  height: number
}

/**
 * Lays out every row (`groupFramesIntoSpreads`'s groups) from `originY`
 * downward, left-aligned at `x: 0` — a solo frame occupies one page-width
 * row; a spread's two frames sit flush against each other (zero gap: they
 * are meant to read as one continuous surface, gutter included) occupying
 * two page-widths, wrapped in a section box inset by `SPREAD_BOX_PADDING`.
 * Shared by `layoutFrames` and `layoutSpreadBoxes` below so the two never
 * disagree about where anything sits.
 */
function layoutRows(frames: readonly Frame[], originY: number): RowLayout[] {
  const rows: RowLayout[] = []
  let y = originY

  for (const group of groupFramesIntoSpreads(frames)) {
    if (group.kind === "solo") {
      const bounds = pageRectAt(group.frame.pageSize, 0, y)
      rows.push({ frames: [{ frameId: group.frame.id, bounds }], spreadBox: null, height: bounds.height })
      y += bounds.height + FRAME_GAP
      continue
    }

    const left = pageRectAt(group.left.pageSize, 0, y)
    const right = pageRectAt(group.right.pageSize, left.width, y)
    const height = Math.max(left.height, right.height)
    const spreadBox: SpreadBoxLayout = {
      frameId: group.left.id,
      bounds: {
        x: left.x - SPREAD_BOX_PADDING,
        y: y - SPREAD_BOX_PADDING,
        width: left.width + right.width + SPREAD_BOX_PADDING * 2,
        height: height + SPREAD_BOX_PADDING * 2,
      },
    }
    rows.push({
      frames: [
        { frameId: group.left.id, bounds: left },
        { frameId: group.right.id, bounds: right },
      ],
      spreadBox,
      height,
    })
    y += height + FRAME_GAP
  }

  return rows
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
  return layoutRows(frames, originY).flatMap((row) => row.frames)
}

/** Every spread's section-box rectangle — one entry per actual pair, none
 *  for solo rows. See `SpreadBoxLayout`. */
export function layoutSpreadBoxes(frames: readonly Frame[], originY: number): SpreadBoxLayout[] {
  return layoutRows(frames, originY)
    .map((row) => row.spreadBox)
    .filter((box): box is SpreadBoxLayout => box !== null)
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
