import { describe, it, expect } from "vitest"

import { defaultFrameMargins, vandeGraafMargins } from "./typography"
import type { PageSize } from "./types"

const A5: PageSize = { name: "A5 portrait", width: 148, height: 210 }

describe("vandeGraafMargins", () => {
  it("divides the page into ninths, asymmetric inner/outer and top/bottom", () => {
    const margins = vandeGraafMargins(A5)

    expect(margins.inner).toBeCloseTo(148 / 9)
    expect(margins.outer).toBeCloseTo((148 * 2) / 9)
    expect(margins.top).toBeCloseTo(210 / 9)
    expect(margins.bottom).toBeCloseTo((210 * 2) / 9)

    // The canon's whole point: outer is twice inner, bottom is twice top.
    expect(margins.outer).toBeCloseTo(margins.inner * 2, 1)
    expect(margins.bottom).toBeCloseTo(margins.top * 2, 1)
  })
})

describe("defaultFrameMargins", () => {
  it("symmetrizes inner/outer into equal left/right margins", () => {
    const margins = defaultFrameMargins(A5)
    expect(margins.inner).toBe(margins.outer)
  })

  it("also symmetrizes top/bottom into equal margins — the guide reads as centered, not just left/right", () => {
    const margins = defaultFrameMargins(A5)
    expect(margins.top).toBe(margins.bottom)
  })

  it("preserves the canon's total horizontal margin (same text-block width, just centered)", () => {
    const canon = vandeGraafMargins(A5)
    const margins = defaultFrameMargins(A5)
    expect(margins.inner + margins.outer).toBeCloseTo(canon.inner + canon.outer, 1)
  })

  it("preserves the canon's total vertical margin (same text-block height, just centered)", () => {
    const canon = vandeGraafMargins(A5)
    const margins = defaultFrameMargins(A5)
    expect(margins.top + margins.bottom).toBeCloseTo(canon.top + canon.bottom, 1)
  })

  it("splits the total horizontal margin evenly", () => {
    const canon = vandeGraafMargins(A5)
    const margins = defaultFrameMargins(A5)
    expect(margins.inner).toBeCloseTo((canon.inner + canon.outer) / 2, 1)
  })

  it("splits the total vertical margin evenly", () => {
    const canon = vandeGraafMargins(A5)
    const margins = defaultFrameMargins(A5)
    expect(margins.top).toBeCloseTo((canon.top + canon.bottom) / 2, 1)
  })
})
