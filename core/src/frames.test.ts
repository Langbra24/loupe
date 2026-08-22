import { describe, it, expect } from "vitest"

import {
  assignToFrame,
  createFrame,
  frameAt,
  framesForBookSetup,
  removeFromFrame,
  reorderFrame,
  type FrameBounds,
} from "./frames"
import type { BookSetup, Frame, ImageElement, PageSize } from "./types"

const A5: PageSize = { name: "A5 portrait", width: 148, height: 210 }

function frame(id: string, position: number): Frame {
  return createFrame(id, A5, position)
}

function bounds(frameId: string, x: number, y: number, width: number, height: number): FrameBounds {
  return { frameId, bounds: { x, y, width, height } }
}

describe("createFrame", () => {
  it("starts with an empty element list unless seeded", () => {
    expect(createFrame("f1", A5, 0)).toEqual({ id: "f1", pageSize: A5, position: 0, elements: [] })
  })
})

describe("framesForBookSetup", () => {
  it("produces the expected page size and empty element list for every frame", () => {
    const setup: BookSetup = { pageSize: A5, pageCount: 3 }
    const frames = framesForBookSetup(setup, ["f1", "f2", "f3"])

    expect(frames).toHaveLength(3)
    for (const f of frames) {
      expect(f.pageSize).toEqual(A5)
      expect(f.elements).toEqual([])
    }
  })

  it("positions frames in order starting at 0", () => {
    const setup: BookSetup = { pageSize: A5, pageCount: 3 }
    const frames = framesForBookSetup(setup, ["f1", "f2", "f3"])

    expect(frames.map((f) => f.position)).toEqual([0, 1, 2])
  })

  it("caps at pageCount even if more ids are supplied", () => {
    const setup: BookSetup = { pageSize: A5, pageCount: 2 }
    const frames = framesForBookSetup(setup, ["f1", "f2", "f3"])

    expect(frames.map((f) => f.id)).toEqual(["f1", "f2"])
  })
})

describe("reorderFrame", () => {
  it("shifts the moved frame and everything between it and the target", () => {
    const frames = Array.from({ length: 12 }, (_, i) => frame(`f${i}`, i))

    // Drag the frame at index 8 to land between indices 1 and 2.
    const reordered = reorderFrame(frames, 8, 2)

    expect(reordered.map((f) => f.id)[2]).toBe("f8")
    // Frames formerly at 2..7 each shift one position later, to 3..8.
    expect(reordered.map((f) => f.id).slice(3, 9)).toEqual(["f2", "f3", "f4", "f5", "f6", "f7"])
    // Everything before the drop point, and after the vacated slot, is untouched.
    expect(reordered.map((f) => f.id).slice(0, 2)).toEqual(["f0", "f1"])
    expect(reordered.map((f) => f.id).slice(9)).toEqual(["f9", "f10", "f11"])
  })

  it("clamps a target before the first frame to index 0", () => {
    const frames = [frame("f0", 0), frame("f1", 1), frame("f2", 2)]

    expect(reorderFrame(frames, 2, -5).map((f) => f.id)).toEqual(["f2", "f0", "f1"])
  })

  it("clamps a target after the last frame to the end", () => {
    const frames = [frame("f0", 0), frame("f1", 1), frame("f2", 2)]

    expect(reorderFrame(frames, 0, 99).map((f) => f.id)).toEqual(["f1", "f2", "f0"])
  })
})

describe("frameAt", () => {
  const grid: FrameBounds[] = [bounds("left", 0, 0, 100, 100), bounds("right", 100, 0, 100, 100)]

  it("finds the frame containing a point well inside its bounds", () => {
    expect(frameAt(grid, { x: 50, y: 50 })).toBe("left")
    expect(frameAt(grid, { x: 150, y: 50 })).toBe("right")
  })

  it("attributes a shared-boundary point to the later frame, whose edge it sits on", () => {
    // x=100 is the right frame's left edge and the left frame's right edge.
    // Documented convention: min-inclusive/max-exclusive, so the later frame wins.
    expect(frameAt(grid, { x: 100, y: 50 })).toBe("right")
  })

  it("stays on the pasteboard when no frame is under the point", () => {
    expect(frameAt(grid, { x: 500, y: 500 })).toBeNull()
    expect(frameAt([], { x: 0, y: 0 })).toBeNull()
  })
})

function image(id: string): ImageElement {
  return {
    id,
    name: "photo.jpg",
    frame: { x: 0, y: 0, width: 1, height: 1 },
    locked: false,
    hidden: false,
    kind: "image",
    assetId: `asset-${id}`,
    fit: "cover",
  }
}

describe("assignToFrame", () => {
  it("appends the element to the target frame's list", () => {
    const frames = [frame("f0", 0), frame("f1", 1)]
    const result = assignToFrame(frames, "f0", image("e1"))

    expect(result.find((f) => f.id === "f0")?.elements).toEqual([image("e1")])
    // The other frame is untouched.
    expect(result.find((f) => f.id === "f1")?.elements).toEqual([])
  })

  it("leaves the frame array unchanged (new array, same length) when the frame id is not found", () => {
    const frames = [frame("f0", 0)]
    const result = assignToFrame(frames, "missing", image("e1"))

    expect(result).toEqual(frames)
    expect(result).not.toBe(frames)
  })

  it("appends without issue when the frame already holds many elements", () => {
    const withTen: Frame = { ...frame("f0", 0), elements: Array.from({ length: 10 }, (_, i) => image(`e${i}`)) }
    const result = assignToFrame([withTen], "f0", image("e10"))

    expect(result[0]?.elements).toHaveLength(11)
    expect(result[0]?.elements.at(-1)).toEqual(image("e10"))
  })
})

describe("removeFromFrame", () => {
  it("removes the named element from the frame's list", () => {
    const withTwo: Frame = { ...frame("f0", 0), elements: [image("e1"), image("e2")] }
    const result = removeFromFrame([withTwo], "f0", "e1")

    expect(result[0]?.elements).toEqual([image("e2")])
  })

  it("is a no-op if the element id is not present", () => {
    const withOne: Frame = { ...frame("f0", 0), elements: [image("e1")] }
    const result = removeFromFrame([withOne], "f0", "missing")

    expect(result[0]?.elements).toEqual([image("e1")])
  })
})
