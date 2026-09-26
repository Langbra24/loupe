import { describe, it, expect } from "vitest"

import {
  FRAME_DISPLAY_WIDTH,
  FRAME_GAP,
  SPREAD_BOX_PADDING,
  frameGridOriginY,
  layoutFrames,
  layoutSpreadBoxes,
  nearestFrameIndex,
} from "./frame-grid"

const A5 = { width: 148, height: 210 } // portrait, aspect < 1
const SQUARE = { width: 200, height: 200 }

function frame(id: string, position: number, extra: { isCover?: boolean; pageSize?: typeof A5 } = {}) {
  return { id, pageSize: { name: "size", ...(extra.pageSize ?? A5) }, position, elements: [], isCover: extra.isCover }
}

describe("layoutFrames", () => {
  it("returns an empty array for zero frames without crashing", () => {
    expect(layoutFrames([], 0)).toEqual([])
  })

  it("lays out a single frame at the grid origin", () => {
    const result = layoutFrames([frame("f0", 0)], 0)
    expect(result).toHaveLength(1)
    expect(result[0]?.frameId).toBe("f0")
    expect(result[0]?.bounds.x).toBe(0)
    expect(result[0]?.bounds.y).toBe(0)
    expect(result[0]?.bounds.width).toBe(FRAME_DISPLAY_WIDTH)
    expect(result[0]?.bounds.height).toBeCloseTo(FRAME_DISPLAY_WIDTH * (A5.height / A5.width))
  })

  it("lays out frames in array order, matching their reading-order index", () => {
    const frames = [frame("f0", 0), frame("f1", 1)]
    const result = layoutFrames(frames, 0)
    expect(result.map((r) => r.frameId)).toEqual(["f0", "f1"])
  })

  it("places a spread's two frames flush against each other, zero gap", () => {
    const frames = [frame("f0", 0), frame("f1", 1)]
    const [left, right] = layoutFrames(frames, 0)
    expect(left?.bounds.x).toBe(0)
    expect(right?.bounds.x).toBe(left!.bounds.width)
    expect(right?.bounds.y).toBe(left?.bounds.y)
  })

  it("stacks each row straight down the canvas, one column wide, not four", () => {
    const frames = [frame("f0", 0), frame("f1", 1), frame("f2", 2), frame("f3", 3)]
    const result = layoutFrames(frames, 0)
    // Every frame starts at x: 0 or x: FRAME_DISPLAY_WIDTH (left/right half of
    // its own row) — never a third or fourth column.
    for (const layout of result) {
      expect([0, FRAME_DISPLAY_WIDTH]).toContain(layout.bounds.x)
    }
    // Second spread's row sits below the first, offset by height + FRAME_GAP.
    const firstRowY = result[0]!.bounds.y
    const firstRowHeight = result[0]!.bounds.height
    const secondRowY = result[2]!.bounds.y
    expect(secondRowY).toBeCloseTo(firstRowY + firstRowHeight + FRAME_GAP)
  })

  it("isolates a cover frame onto its own row, alone", () => {
    const cover = frame("cover", 0, { isCover: true })
    const frames = [cover, frame("f1", 1), frame("f2", 2)]
    const result = layoutFrames(frames, 0)

    const coverLayout = result.find((r) => r.frameId === "cover")!
    const spreadLeft = result.find((r) => r.frameId === "f1")!
    const spreadRight = result.find((r) => r.frameId === "f2")!

    expect(coverLayout.bounds.x).toBe(0)
    expect(spreadLeft.bounds.y).toBeGreaterThan(coverLayout.bounds.y)
    expect(spreadRight.bounds.x).toBe(spreadLeft.bounds.x + spreadLeft.bounds.width)
  })

  it("offsets every row by the supplied origin Y", () => {
    const atZero = layoutFrames([frame("f0", 0)], 0)
    const atOffset = layoutFrames([frame("f0", 0)], 500)
    expect(atOffset[0]?.bounds.y).toBe((atZero[0]?.bounds.y ?? 0) + 500)
  })

  it("never produces NaN or negative dimensions for a valid page size", () => {
    const result = layoutFrames([frame("f0", 0), frame("f1", 1), frame("f2", 2)], 0)
    for (const layout of result) {
      expect(Number.isNaN(layout.bounds.x)).toBe(false)
      expect(Number.isNaN(layout.bounds.y)).toBe(false)
      expect(layout.bounds.width).toBeGreaterThan(0)
      expect(layout.bounds.height).toBeGreaterThan(0)
    }
  })

  it("derives height from each page's own aspect ratio", () => {
    const result = layoutFrames([frame("f0", 0, { pageSize: SQUARE })], 0)
    expect(result[0]?.bounds.width).toBe(FRAME_DISPLAY_WIDTH)
    expect(result[0]?.bounds.height).toBeCloseTo(FRAME_DISPLAY_WIDTH)
  })
})

describe("layoutSpreadBoxes", () => {
  it("returns no box for a solo cover or an unpaired trailing frame", () => {
    const cover = frame("cover", 0, { isCover: true })
    const frames = [cover, frame("f1", 1), frame("f2", 2), frame("f3", 3)]
    const boxes = layoutSpreadBoxes(frames, 0)
    expect(boxes).toHaveLength(1)
    expect(boxes[0]?.frameId).toBe("f1")
  })

  it("wraps a spread's two frames with padding on every side", () => {
    const frames = [frame("f0", 0), frame("f1", 1)]
    const frameLayouts = layoutFrames(frames, 0)
    const [box] = layoutSpreadBoxes(frames, 0)
    const left = frameLayouts[0]!.bounds
    const right = frameLayouts[1]!.bounds

    expect(box?.bounds.x).toBeCloseTo(left.x - SPREAD_BOX_PADDING)
    expect(box?.bounds.y).toBeCloseTo(left.y - SPREAD_BOX_PADDING)
    expect(box?.bounds.width).toBeCloseTo(left.width + right.width + SPREAD_BOX_PADDING * 2)
    expect(box?.bounds.height).toBeCloseTo(left.height + SPREAD_BOX_PADDING * 2)
  })

  it("keeps consecutive spreads' boxes from touching", () => {
    const frames = [frame("f0", 0), frame("f1", 1), frame("f2", 2), frame("f3", 3)]
    const [first, second] = layoutSpreadBoxes(frames, 0)
    const firstBottom = first!.bounds.y + first!.bounds.height
    expect(second!.bounds.y).toBeGreaterThan(firstBottom)
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
