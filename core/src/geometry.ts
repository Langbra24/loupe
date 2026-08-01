/**
 * Scene geometry for the light table.
 *
 * This lives in `core/` rather than inside the canvas component for a reason:
 * it is the only part of the canvas that can be tested without a DOM. Keeping
 * it here is what makes fit-to-view and import layout provable.
 */

import type { Asset, Bounds, CanvasPlacement } from "./types"

/** Columns in the import grid. Beyond this a single import gets unreadably wide. */
const IMPORT_COLUMNS = 6
/** Scene-unit gutter between imported photographs, and below prior work. */
const IMPORT_GAP = 40

/**
 * The rectangle containing every placement.
 *
 * Takes the asset pool because a placement stores no dimensions of its own —
 * without it, placements could only be treated as points and fit-to-view would
 * clip every photograph at the edge of the arrangement.
 *
 * Placements whose asset is missing are skipped rather than contributing a
 * zero-size box at the origin, which would drag the bounds toward 0,0 and make
 * fit-to-view frame empty space.
 */
export function boundingBoxOf(
  placements: readonly CanvasPlacement[],
  assets: readonly Asset[],
): Bounds {
  const byId = new Map(assets.map((asset) => [asset.id, asset]))

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const placement of placements) {
    const asset = byId.get(placement.assetId)
    if (!asset) continue

    const halfWidth = (asset.width * placement.scale) / 2
    const halfHeight = (asset.height * placement.scale) / 2

    minX = Math.min(minX, placement.x - halfWidth)
    minY = Math.min(minY, placement.y - halfHeight)
    maxX = Math.max(maxX, placement.x + halfWidth)
    maxY = Math.max(maxY, placement.y + halfHeight)
  }

  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Thumbnail dimensions for an image, scaled so its long edge meets `maxEdge`.
 *
 * Never upscales — a small image stays small rather than being blown up to the
 * target and losing quality for no benefit.
 */
export function thumbnailTarget(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  if (longEdge <= maxEdge) return { width, height }

  const scale = maxEdge / longEdge
  // Clamp to 1: an extreme aspect ratio can round the short edge to zero,
  // which would produce a canvas that throws on draw.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Where newly imported photographs land on the table.
 *
 * A grid below whatever is already there, so a second import does not bury the
 * first. Deliberately not clever: the user is about to drag these anywhere they
 * like, and the only job here is to avoid a pile at the origin.
 */
export function layoutNewPlacements(
  existing: readonly CanvasPlacement[],
  newAssets: readonly Asset[],
  pool: readonly Asset[],
): CanvasPlacement[] {
  if (newAssets.length === 0) return []

  const existingBox = boundingBoxOf(existing, pool)
  const startY = existing.length > 0 ? existingBox.y + existingBox.height + IMPORT_GAP : 0

  const columns = Math.min(newAssets.length, IMPORT_COLUMNS)
  const cellWidth = Math.max(...newAssets.map((asset) => asset.width)) + IMPORT_GAP
  const cellHeight = Math.max(...newAssets.map((asset) => asset.height)) + IMPORT_GAP

  return newAssets.map((asset, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)

    return {
      id: `placement-${asset.id}`,
      assetId: asset.id,
      // Centre of its cell, since placements are center-anchored.
      x: column * cellWidth + cellWidth / 2,
      y: startY + row * cellHeight + cellHeight / 2,
      scale: 1,
      rotation: 0,
    }
  })
}
