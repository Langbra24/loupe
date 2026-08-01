import { describe, it, expect } from "vitest"

import { moveItem } from "./collections"

describe("moveItem", () => {
  it("moves an element forward", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"])
  })

  it("moves an element backward", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"])
  })

  it("clamps a target index beyond the end rather than throwing", () => {
    expect(moveItem(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"])
  })

  it("clamps a negative target index to the start", () => {
    expect(moveItem(["a", "b", "c"], 2, -5)).toEqual(["c", "a", "b"])
  })

  it("returns the list unchanged for an out-of-range source index", () => {
    expect(moveItem(["a", "b", "c"], 7, 0)).toEqual(["a", "b", "c"])
    expect(moveItem(["a", "b", "c"], -1, 0)).toEqual(["a", "b", "c"])
  })

  it("does not mutate the input", () => {
    const input = ["a", "b", "c"]
    moveItem(input, 0, 2)
    expect(input).toEqual(["a", "b", "c"])
  })
})
