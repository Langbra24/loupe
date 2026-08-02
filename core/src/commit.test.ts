import { describe, it, expect } from "vitest"

import { commitEditToPages } from "./commit"
import { createEdit } from "./edits"
import { checkPageCount } from "./sequence"
import type { Asset } from "./types"

function asset(id: string): Asset {
  return { id, name: `${id}.jpg`, width: 4000, height: 3000, importedAt: 0 }
}

const pool = [asset("a1"), asset("a2"), asset("a3")]

describe("commitEditToPages", () => {
  it("produces one page per member, in order", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1", "a2", "a3"])
    const pages = commitEditToPages(edit, pool, "seed")

    expect(pages).toHaveLength(3)
    expect(pages.map((page) => page.elements[0]?.id)).toHaveLength(3)
  })

  it("gives each page exactly one image element referencing the right asset", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a3", "a1"])
    const pages = commitEditToPages(edit, pool, "seed")

    const assetIds = pages.map((page) => {
      const element = page.elements[0]
      return element && element.kind === "image" ? element.assetId : null
    })

    expect(assetIds).toEqual(["a3", "a1"])
    expect(pages.every((page) => page.elements.length === 1)).toBe(true)
  })

  it("names the element from the asset filename", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1"])
    const [page] = commitEditToPages(edit, pool, "seed")

    expect(page?.elements[0]?.name).toBe("a1.jpg")
  })

  it("produces zero pages for an empty edit rather than throwing", () => {
    expect(commitEditToPages(createEdit("e1", "Edit 1", 0), pool, "seed")).toEqual([])
  })

  it("skips a member whose asset is absent from the pool", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1", "ghost", "a2"])
    const pages = commitEditToPages(edit, pool, "seed")

    expect(pages).toHaveLength(2)
  })

  it("produces fresh page ids on a second commit", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1", "a2"])
    const first = commitEditToPages(edit, pool, "seed-a")
    const second = commitEditToPages(edit, pool, "seed-b")

    expect(first.map((p) => p.id)).not.toEqual(second.map((p) => p.id))
  })

  it("produces equal content on a second commit", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1", "a2"])
    const first = commitEditToPages(edit, pool, "seed-a")
    const second = commitEditToPages(edit, pool, "seed-b")

    const assetIdsOf = (pages: ReturnType<typeof commitEditToPages>) =>
      pages.map((p) => (p.elements[0]?.kind === "image" ? p.elements[0].assetId : null))

    expect(assetIdsOf(first)).toEqual(assetIdsOf(second))
  })

  it("gives every page a distinct id within one commit", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1", "a2", "a3"])
    const pages = commitEditToPages(edit, pool, "seed")

    expect(new Set(pages.map((p) => p.id)).size).toBe(3)
  })

  it("does not alias the source edit", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1"])
    const pages = commitEditToPages(edit, pool, "seed")
    pages[0]?.elements.push({
      id: "extra",
      kind: "text",
      name: "extra",
      content: "x",
      role: "caption",
      align: "left",
      frame: { x: 0, y: 0, width: 1, height: 1 },
      locked: false,
      hidden: false,
    })

    expect(edit.memberIds).toEqual(["a1"])
  })

  it("places the image inside the page, not overflowing it", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1"])
    const [page] = commitEditToPages(edit, pool, "seed")
    const frame = page?.elements[0]?.frame

    expect(frame).toBeDefined()
    expect(frame!.x).toBeGreaterThanOrEqual(0)
    expect(frame!.y).toBeGreaterThanOrEqual(0)
    expect(frame!.x + frame!.width).toBeLessThanOrEqual(1)
    expect(frame!.y + frame!.height).toBeLessThanOrEqual(1)
  })
})

describe("commit feeds the saddle-stitch check", () => {
  it("reports a twelve-member edit as valid", () => {
    const members = Array.from({ length: 12 }, (_, i) => `a${i}`)
    const assets = members.map(asset)
    const pages = commitEditToPages(createEdit("e1", "E", 0, members), assets, "seed")

    expect(checkPageCount(pages.length).isValidForSaddleStitch).toBe(true)
  })

  it("reports a ten-member edit as needing two more pages", () => {
    const members = Array.from({ length: 10 }, (_, i) => `a${i}`)
    const assets = members.map(asset)
    const pages = commitEditToPages(createEdit("e1", "E", 0, members), assets, "seed")

    expect(checkPageCount(pages.length).blanksNeeded).toBe(2)
  })
})
