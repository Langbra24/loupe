import { describe, it, expect } from "vitest"

import { boundingBoxOf, layoutNewPlacements, thumbnailTarget } from "./geometry"
import type { Asset, CanvasPlacement } from "./types"

function asset(id: string, width: number, height: number): Asset {
  return { id, name: `${id}.jpg`, width, height, importedAt: 0 }
}

function placement(id: string, assetId: string, x: number, y: number, scale = 1): CanvasPlacement {
  return { id, assetId, x, y, scale, rotation: 0 }
}

describe("boundingBoxOf", () => {
  it("contains every placement, using scaled half-extents rather than points", () => {
    // Centred at the origin, 100x50 natural, so it spans -50..50 by -25..25.
    const box = boundingBoxOf([placement("p1", "a1", 0, 0)], [asset("a1", 100, 50)])

    expect(box).toEqual({ x: -50, y: -25, width: 100, height: 50 })
  })

  it("accounts for scale when computing extents", () => {
    const box = boundingBoxOf([placement("p1", "a1", 0, 0, 2)], [asset("a1", 100, 50)])

    expect(box).toEqual({ x: -100, y: -50, width: 200, height: 100 })
  })

  it("spans several scattered placements", () => {
    const box = boundingBoxOf(
      [placement("p1", "a1", 0, 0), placement("p2", "a2", 200, 100)],
      [asset("a1", 100, 100), asset("a2", 100, 100)],
    )

    expect(box).toEqual({ x: -50, y: -50, width: 300, height: 200 })
  })

  it("returns a degenerate box at the origin for an empty list", () => {
    expect(boundingBoxOf([], [])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it("skips a placement whose asset is missing from the pool", () => {
    const box = boundingBoxOf(
      [placement("p1", "a1", 0, 0), placement("p2", "ghost", 5000, 5000)],
      [asset("a1", 100, 100)],
    )

    expect(box).toEqual({ x: -50, y: -50, width: 100, height: 100 })
  })

  it("returns a degenerate box when every placement is dangling", () => {
    expect(boundingBoxOf([placement("p1", "ghost", 10, 10)], [])).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    })
  })
})

describe("thumbnailTarget", () => {
  it("scales a landscape image on its width", () => {
    expect(thumbnailTarget(1200, 600, 600)).toEqual({ width: 600, height: 300 })
  })

  it("scales a portrait image on its height", () => {
    expect(thumbnailTarget(600, 1200, 600)).toEqual({ width: 300, height: 600 })
  })

  it("preserves aspect ratio on a non-integer scale", () => {
    const { width, height } = thumbnailTarget(1000, 750, 600)
    expect(width).toBe(600)
    expect(height).toBe(450)
  })

  it("does not upscale an image already under the maximum edge", () => {
    expect(thumbnailTarget(320, 200, 600)).toEqual({ width: 320, height: 200 })
  })

  it("never returns a zero dimension for an extreme aspect ratio", () => {
    const { width, height } = thumbnailTarget(6000, 3, 600)
    expect(width).toBe(600)
    expect(height).toBeGreaterThanOrEqual(1)
  })
})

describe("layoutNewPlacements", () => {
  const incoming = [asset("a1", 100, 100), asset("a2", 100, 100), asset("a3", 100, 100)]

  it("lays the first import out without overlaps", () => {
    const placements = layoutNewPlacements([], incoming, incoming)

    expect(placements).toHaveLength(3)
    const xs = placements.map((p) => p.x)
    expect(new Set(xs).size).toBe(3)
  })

  it("assigns each new asset exactly one placement", () => {
    const placements = layoutNewPlacements([], incoming, incoming)

    expect(placements.map((p) => p.assetId)).toEqual(["a1", "a2", "a3"])
  })

  it("gives every placement a distinct id", () => {
    const placements = layoutNewPlacements([], incoming, incoming)

    expect(new Set(placements.map((p) => p.id)).size).toBe(3)
  })

  it("positions a later import clear of the existing arrangement", () => {
    const existingAssets = [asset("old", 100, 100)]
    const existing = [placement("p-old", "old", 0, 0)]
    const pool = [...existingAssets, ...incoming]

    const placements = layoutNewPlacements(existing, incoming, pool)
    const existingBox = boundingBoxOf(existing, pool)

    for (const p of placements) {
      expect(p.y).toBeGreaterThan(existingBox.y + existingBox.height)
    }
  })

  it("returns an empty list when there is nothing to import", () => {
    expect(layoutNewPlacements([], [], [])).toEqual([])
  })
})
