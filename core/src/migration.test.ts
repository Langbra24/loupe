import { describe, it, expect } from "vitest"

import { migrateProject, validateMigratedFrames, type LegacyProject } from "./migration"
import type { Asset, CanvasState, Frame, ImageElement, Page, PageSize } from "./types"

const A5: PageSize = { name: "A5 portrait", width: 148, height: 210 }

function asset(id: string): Asset {
  return { id, name: `${id}.jpg`, width: 1000, height: 1000, importedAt: 0 }
}

function imageElement(id: string, assetId: string, frame = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }): ImageElement {
  return { id, name: id, frame, locked: false, hidden: false, kind: "image", assetId, fit: "cover" }
}

function page(id: string, elements: ImageElement[] = []): Page {
  return { id, elements }
}

const emptyCanvas: CanvasState = { placements: [] }

function baseLegacy(overrides: Partial<LegacyProject> = {}): LegacyProject {
  return {
    name: "Test Project",
    pageSize: A5,
    assets: [],
    canvas: emptyCanvas,
    edits: [],
    pages: [],
    typeBaseSize: 16,
    typeRatio: 1.5,
    ...overrides,
  }
}

describe("migrateProject — happy paths", () => {
  it("migrates 5 committed pages to 5 frames with elements intact and positions 0-4", () => {
    const assets = [asset("a1"), asset("a2"), asset("a3"), asset("a4"), asset("a5")]
    const pages = assets.map((a, i) => page(`p${i}`, [imageElement(`el${i}`, a.id)]))
    const legacy = baseLegacy({ assets, pages })

    const result = migrateProject(legacy)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.frames).toHaveLength(5)
    expect(result.project.frames.map((f) => f.position)).toEqual([0, 1, 2, 3, 4])
    result.project.frames.forEach((f, i) => {
      expect(f.elements).toEqual(pages[i]?.elements)
    })
  })

  it("migrates a project with only edits and no pages to an empty frame set, dropping edits data", () => {
    const legacy = baseLegacy({
      edits: [{ id: "e1", name: "Draft", memberIds: ["a1", "a2"], createdAt: 123 }],
      assets: [asset("a1"), asset("a2")],
    })

    const result = migrateProject(legacy)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.frames).toEqual([])
    expect(result.legacyEditCount).toBe(1)
    // Nothing edit-derived leaks into the output project.
    expect(JSON.stringify(result.project)).not.toContain("Draft")
    expect("edits" in result.project).toBe(false)
  })

  it("migrates an empty legacy project (no pages, no edits, no assets) without error", () => {
    const result = migrateProject(baseLegacy())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.frames).toEqual([])
  })
})

describe("migrateProject — error paths", () => {
  it("fails when a page element references a missing assetId", () => {
    const legacy = baseLegacy({
      assets: [asset("a1")],
      pages: [page("p0", [imageElement("el0", "does-not-exist")])],
    })

    const result = migrateProject(legacy)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason.kind).toBe("missing-asset")
  })

  it("fails when a migrated frame has a NaN Box coordinate", () => {
    const legacy = baseLegacy({
      assets: [asset("a1")],
      pages: [page("p0", [imageElement("el0", "a1", { x: NaN, y: 0.1, width: 0.5, height: 0.5 })])],
    })

    const result = migrateProject(legacy)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason.kind).toBe("invalid-box")
  })

  it("fails when a migrated frame has a negative Box coordinate", () => {
    const legacy = baseLegacy({
      assets: [asset("a1")],
      pages: [page("p0", [imageElement("el0", "a1", { x: -5, y: 0.1, width: 0.5, height: 0.5 })])],
    })

    const result = migrateProject(legacy)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason.kind).toBe("invalid-box")
  })

  it("fails when a migrated frame has an out-of-range Box coordinate (beyond the [-1, 2] bound)", () => {
    const legacy = baseLegacy({
      assets: [asset("a1")],
      pages: [page("p0", [imageElement("el0", "a1", { x: 0.1, y: 0.1, width: 100, height: 0.5 })])],
    })

    const result = migrateProject(legacy)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason.kind).toBe("invalid-box")
  })

  it("validator rejects duplicate or non-contiguous frame positions on a hand-built frame list", () => {
    const frames: Frame[] = [
      { id: "f0", pageSize: A5, position: 0, elements: [] },
      { id: "f1", pageSize: A5, position: 0, elements: [] }, // duplicate position
    ]

    const dup = validateMigratedFrames(frames, 2, [])
    expect(dup?.kind).toBe("invalid-positions")

    const gapFrames: Frame[] = [
      { id: "f0", pageSize: A5, position: 0, elements: [] },
      { id: "f1", pageSize: A5, position: 2, elements: [] }, // gap, missing 1
    ]
    const gap = validateMigratedFrames(gapFrames, 2, [])
    expect(gap?.kind).toBe("invalid-positions")
  })

  it("returns a typed failure, never throws, for malformed input missing required fields", () => {
    const malformed = { name: "Broken" } as unknown as LegacyProject

    expect(() => migrateProject(malformed)).not.toThrow()
    const result = migrateProject(malformed)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason.kind).toBe("invalid-input")
  })
})
