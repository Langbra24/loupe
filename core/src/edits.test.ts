import { describe, it, expect } from "vitest"

import {
  addToEdit,
  createEdit,
  duplicateEdit,
  removeFromEdit,
  renameEdit,
  reorderEditMember,
} from "./edits"

describe("createEdit", () => {
  it("starts empty unless seeded", () => {
    const edit = createEdit("e1", "Edit 1", 0)

    expect(edit).toEqual({ id: "e1", name: "Edit 1", memberIds: [], createdAt: 0 })
  })

  it("accepts seed members in order", () => {
    expect(createEdit("e1", "Edit 1", 0, ["a2", "a1"]).memberIds).toEqual(["a2", "a1"])
  })
})

describe("addToEdit", () => {
  it("appends an asset and preserves existing order", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1", "a2"])

    expect(addToEdit(edit, "a3").memberIds).toEqual(["a1", "a2", "a3"])
  })

  it("does not duplicate a member already present", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1", "a2"])

    expect(addToEdit(edit, "a1").memberIds).toEqual(["a1", "a2"])
  })

  it("lets the same asset belong to two different edits", () => {
    const first = addToEdit(createEdit("e1", "First", 0), "shared")
    const second = addToEdit(createEdit("e2", "Second", 0), "shared")

    expect(first.memberIds).toEqual(["shared"])
    expect(second.memberIds).toEqual(["shared"])
  })

  it("does not mutate the source edit", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1"])
    addToEdit(edit, "a2")

    expect(edit.memberIds).toEqual(["a1"])
  })
})

describe("removeFromEdit", () => {
  it("drops only the named member and preserves the rest", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1", "a2", "a3"])

    expect(removeFromEdit(edit, "a2").memberIds).toEqual(["a1", "a3"])
  })

  it("is a no-op for an absent member", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1"])

    expect(removeFromEdit(edit, "ghost").memberIds).toEqual(["a1"])
  })
})

describe("reorderEditMember", () => {
  it("moves a member to a new index", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1", "a2", "a3"])

    expect(reorderEditMember(edit, 2, 0).memberIds).toEqual(["a3", "a1", "a2"])
  })

  it("leaves membership unchanged", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1", "a2", "a3"])
    const moved = reorderEditMember(edit, 0, 2)

    expect([...moved.memberIds].sort()).toEqual(["a1", "a2", "a3"])
  })
})

describe("renameEdit", () => {
  it("changes the name and nothing else", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1"])
    const renamed = renameEdit(edit, "Harbour edit")

    expect(renamed.name).toBe("Harbour edit")
    expect(renamed.id).toBe("e1")
    expect(renamed.memberIds).toEqual(["a1"])
  })
})

describe("duplicateEdit", () => {
  it("produces a new id and copies members in order", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1", "a2"])
    const copy = duplicateEdit(edit, "e2", 5)

    expect(copy.id).toBe("e2")
    expect(copy.memberIds).toEqual(["a1", "a2"])
    expect(copy.createdAt).toBe(5)
  })

  it("distinguishes the copy by name", () => {
    const copy = duplicateEdit(createEdit("e1", "Edit 1", 0), "e2", 0)

    expect(copy.name).not.toBe("Edit 1")
  })

  it("does not alias the original's members", () => {
    const edit = createEdit("e1", "Edit 1", 0, ["a1"])
    const copy = addToEdit(duplicateEdit(edit, "e2", 0), "a2")

    expect(edit.memberIds).toEqual(["a1"])
    expect(copy.memberIds).toEqual(["a1", "a2"])
  })
})
