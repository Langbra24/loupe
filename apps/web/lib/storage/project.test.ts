import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Asset, Page, PageSize, Project } from "@loupe/core"

/**
 * `db.ts` is mocked at the module boundary rather than pulling in a real
 * IndexedDB (this codebase has no `fake-indexeddb` dependency yet, and
 * `project.ts` already treats its `db.ts` dependency as a plain
 * get/put/transaction surface — mocking that surface is the smallest
 * faithful test double). `records` stands in for the one `project` object
 * store row this module ever touches.
 */
const records = new Map<string, unknown>()

const dbStub = {
  get: vi.fn(async (_store: string, key: string) => records.get(key)),
  put: vi.fn(async (_store: string, value: unknown, key: string) => {
    records.set(key, value)
  }),
  transaction: vi.fn(() => ({
    objectStore: () => ({
      getAllKeys: vi.fn(async () => []),
      delete: vi.fn(),
    }),
    done: Promise.resolve(),
  })),
}

vi.mock("@/lib/storage/db", () => ({
  getDb: vi.fn(async () => dbStub),
  isQuotaError: () => false,
  PROJECT_KEY: "current",
}))

const A5: PageSize = { name: "A5 portrait", width: 148, height: 210 }

function legacyPage(id: string): Page {
  return { id, elements: [] }
}

function legacyRecord(pages: Page[], assets: Asset[] = []) {
  return {
    name: "Legacy book",
    pageSize: A5,
    assets,
    canvas: { placements: [] },
    edits: [],
    pages,
    typeBaseSize: 10,
    typeRatio: 1.5,
  }
}

function currentRecord(): Project {
  return {
    name: "Current book",
    pageSize: A5,
    assets: [],
    canvas: { placements: [] },
    frames: [],
    pages: [],
    typeBaseSize: 10,
    typeRatio: 1.5,
  }
}

describe("loadProject", () => {
  beforeEach(() => {
    records.clear()
    dbStub.get.mockClear()
    dbStub.put.mockClear()
  })

  it("migrates a pre-frame stored record and reflects the migrated shape", async () => {
    const { loadProject } = await import("./project")
    records.set("current", legacyRecord([legacyPage("p1"), legacyPage("p2")]))

    const { project, migrationError } = await loadProject()

    expect(migrationError).toBeNull()
    expect(project.frames).toHaveLength(2)
    expect(project.frames.map((f) => f.position)).toEqual([0, 1])
  })

  it("persists a successful migration via saveProject's immediate-write path", async () => {
    const { loadProject } = await import("./project")
    records.set("current", legacyRecord([legacyPage("p1")]))

    await loadProject()

    // saveProject calls db.put("project", value, PROJECT_KEY) — this is the
    // same immediate-write mechanism importPhotos uses for "blobs already on
    // disk, must persist now".
    expect(dbStub.put).toHaveBeenCalledTimes(1)
    expect(dbStub.put).toHaveBeenCalledWith("project", expect.objectContaining({ frames: expect.any(Array) }), "current")

    const stored = records.get("current") as Project
    expect(stored.frames).toHaveLength(1)
  })

  it("does NOT call saveProject when migration fails, leaving the stored record untouched", async () => {
    const { loadProject } = await import("./project")
    // A page element referencing an asset that does not exist in `assets`
    // trips validateMigratedFrames' missing-asset check and fails migration.
    const badPage: Page = {
      id: "p1",
      elements: [
        {
          id: "el1",
          name: "photo",
          frame: { x: 0, y: 0, width: 1, height: 1 },
          locked: false,
          hidden: false,
          kind: "image",
          assetId: "missing-asset",
          fit: "cover",
        },
      ],
    }
    const original = legacyRecord([badPage], [])
    records.set("current", original)

    const { migrationError } = await loadProject()

    expect(migrationError).not.toBeNull()
    expect(dbStub.put).not.toHaveBeenCalled()
    // The stored record is provably unchanged — same reference, not just
    // deep-equal, since nothing should have touched it at all.
    expect(records.get("current")).toBe(original)
  })

  it("surfaces a migration failure message distinct from the storage-unavailable message", async () => {
    const { loadProject } = await import("./project")
    const badPage: Page = {
      id: "p1",
      elements: [
        {
          id: "el1",
          name: "photo",
          frame: { x: 0, y: 0, width: 1, height: 1 },
          locked: false,
          hidden: false,
          kind: "image",
          assetId: "missing-asset",
          fit: "cover",
        },
      ],
    }
    records.set("current", legacyRecord([badPage], []))

    const { migrationError } = await loadProject()

    expect(migrationError).not.toBeNull()
    expect(migrationError).not.toContain("Local storage is unavailable")
  })

  it("loads a current-shape project with no migration attempted", async () => {
    const { loadProject } = await import("./project")
    records.set("current", currentRecord())

    const { project, migrationError } = await loadProject()

    expect(migrationError).toBeNull()
    expect(project.name).toBe("Current book")
    // No migration means no extra write beyond the read.
    expect(dbStub.put).not.toHaveBeenCalled()
  })
})
