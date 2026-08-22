import { describe, it, expect } from "vitest"

import {
  FRAME_DISPLAY_WIDTH,
  FRAME_GAP,
  FRAMES_PER_ROW,
  frameGridOriginY,
  frameRectAt,
  layoutFrames,
  nearestFrameIndex,
} from "./frame-grid"

const A5 = { width: 148, height: 210 } // portrait, aspect < 1
const SQUARE = { width: 200, height: 200 }

describe("frameRectAt", () => {
  it("places the first frame at the grid origin", () => {
    const rect = frameRectAt(SQUARE, 0, 0)
    expect(rect).toEqual({ x: 0, y: 0, width: FRAME_DISPLAY_WIDTH, height: FRAME_DISPLAY_WIDTH })
  })

  it("derives height from the page's aspect ratio, at a fixed display width", () => {
    const rect = frameRectAt(A5, 0, 0)
    expect(rect.width).toBe(FRAME_DISPLAY_WIDTH)
    expect(rect.height).toBeCloseTo(FRAME_DISPLAY_WIDTH / (A5.width / A5.height))
  })

  it("offsets later columns within a row by width + gap", () => {
    const first = frameRectAt(SQUARE, 0, 0)
    const second = frameRectAt(SQUARE, 1, 0)
    expect(second.x).toBe(first.x + FRAME_DISPLAY_WIDTH + FRAME_GAP)
    expect(second.y).toBe(first.y)
  })

  it("wraps to a new row after FRAMES_PER_ROW frames", () => {
    const rect = frameRectAt(SQUARE, FRAMES_PER_ROW, 0)
    expect(rect.x).toBe(0)
    expect(rect.y).toBeGreaterThan(0)
  })

  it("offsets every row by the supplied origin Y", () => {
    const atZero = frameRectAt(SQUARE, 0, 0)
    const atOffset = frameRectAt(SQUARE, 0, 500)
    expect(atOffset.y).toBe(atZero.y + 500)
  })

  it("never produces NaN or negative dimensions for a valid page size", () => {
    const rect = frameRectAt(A5, 3, 0)
    expect(Number.isNaN(rect.x)).toBe(false)
    expect(Number.isNaN(rect.y)).toBe(false)
    expect(rect.width).toBeGreaterThan(0)
    expect(rect.height).toBeGreaterThan(0)
  })
})

describe("layoutFrames", () => {
  function frame(id: string, position: number) {
    return { id, pageSize: { name: "A5", ...A5 }, position, elements: [] }
  }

  it("returns an empty array for zero frames without crashing", () => {
    expect(layoutFrames([], 0)).toEqual([])
  })

  it("lays out a single frame at the grid origin", () => {
    const result = layoutFrames([frame("f0", 0)], 0)
    expect(result).toHaveLength(1)
    expect(result[0]?.frameId).toBe("f0")
    expect(result[0]?.bounds.x).toBe(0)
    expect(result[0]?.bounds.y).toBe(0)
  })

  it("lays out frames in array order, matching their reading-order index", () => {
    const frames = [frame("f0", 0), frame("f1", 1)]
    const result = layoutFrames(frames, 0)
    expect(result.map((r) => r.frameId)).toEqual(["f0", "f1"])
    expect(result[1]?.bounds.x).toBeGreaterThan(result[0]?.bounds.x ?? 0)
  })
})

describe("frameGridOriginY", () => {
  it("returns 0 when the pasteboard has no content", () => {
    expect(frameGridOriginY([], [])).toBe(0)
  })

  it("sits below the pasteboard's existing content bounding box", () => {
    const assets = [{ id: "a1", name: "a", width: 100, height: 100, importedAt: 0 }]
    const placements = [{ id: "p1", assetId: "a1", x: 50, y: 50, scale: 1, rotation: 0 }]
    const originY = frameGridOriginY(placements, assets)
    // Bounding box bottom edge is at y=100 (placement centered at 50,50, half-height 50).
    expect(originY).toBeGreaterThan(100)
  })
})

describe("nearestFrameIndex", () => {
  it("returns 0 for an empty layout without crashing", () => {
    expect(nearestFrameIndex([], { x: 500, y: 500 })).toBe(0)
  })

  it("picks the layout whose center is closest to the point", () => {
    const layouts = [
      { frameId: "f0", bounds: { x: 0, y: 0, width: 100, height: 100 } },
      { frameId: "f1", bounds: { x: 200, y: 0, width: 100, height: 100 } },
    ]
    expect(nearestFrameIndex(layouts, { x: 40, y: 40 })).toBe(0)
    expect(nearestFrameIndex(layouts, { x: 240, y: 40 })).toBe(1)
  })
})
