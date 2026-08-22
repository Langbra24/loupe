import { describe, it, expect } from "vitest"

import { MAX_PAGE_DIMENSION_MM, PAGE_SIZE_PRESETS, validateCustomPageSize } from "./page-sizes"

describe("PAGE_SIZE_PRESETS", () => {
  it("offers 3 to 4 presets", () => {
    expect(PAGE_SIZE_PRESETS.length).toBeGreaterThanOrEqual(3)
    expect(PAGE_SIZE_PRESETS.length).toBeLessThanOrEqual(4)
  })

  it("gives every preset a name and positive, sane dimensions", () => {
    for (const preset of PAGE_SIZE_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0)
      expect(preset.width).toBeGreaterThan(0)
      expect(preset.height).toBeGreaterThan(0)
      expect(preset.width).toBeLessThanOrEqual(MAX_PAGE_DIMENSION_MM)
      expect(preset.height).toBeLessThanOrEqual(MAX_PAGE_DIMENSION_MM)
    }
  })

  it("has no duplicate preset names", () => {
    const names = PAGE_SIZE_PRESETS.map((preset) => preset.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe("validateCustomPageSize", () => {
  it("accepts reasonable photobook dimensions", () => {
    expect(validateCustomPageSize(210, 297).valid).toBe(true)
    expect(validateCustomPageSize(150, 150).valid).toBe(true)
  })

  it("rejects zero in either dimension", () => {
    expect(validateCustomPageSize(0, 200).valid).toBe(false)
    expect(validateCustomPageSize(200, 0).valid).toBe(false)
  })

  it("rejects negative dimensions", () => {
    expect(validateCustomPageSize(-10, 200).valid).toBe(false)
    expect(validateCustomPageSize(200, -10).valid).toBe(false)
  })

  it("rejects dimensions beyond the sane upper bound", () => {
    expect(validateCustomPageSize(MAX_PAGE_DIMENSION_MM + 1, 200).valid).toBe(false)
    expect(validateCustomPageSize(200, MAX_PAGE_DIMENSION_MM + 1).valid).toBe(false)
  })

  it("accepts exactly the upper bound", () => {
    expect(validateCustomPageSize(MAX_PAGE_DIMENSION_MM, MAX_PAGE_DIMENSION_MM).valid).toBe(true)
  })

  it("rejects non-finite input", () => {
    expect(validateCustomPageSize(NaN, 200).valid).toBe(false)
    expect(validateCustomPageSize(200, Infinity).valid).toBe(false)
  })
})
