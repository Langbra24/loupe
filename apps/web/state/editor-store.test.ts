import { beforeEach, describe, expect, it } from "vitest"
import { A5_PORTRAIT, type CanvasPlacement } from "@loupe/core"

import { useEditorStore } from "@/state/editor-store"

/**
 * Exercises the U8 undo command stack directly against the live Zustand
 * store — there is no dedicated "extract the command-construction logic as
 * a pure function" seam here (each command closes over `updateProject`/
 * `get`/`set`, which only exist inside the store's creator), so per the
 * plan this lives in apps/web rather than core/src.
 *
 * `hydrate()`'s IndexedDB call always rejects under Vitest's `node`
 * environment (no `indexedDB` global) and is caught internally by the
 * store, so calling it here exercises the "stack clears on load" path
 * without needing to mock `lib/storage/db`.
 */
const initialState = useEditorStore.getState()

beforeEach(() => {
  useEditorStore.setState(initialState, true)
})

describe("undo", () => {
  it("is a no-op, not an error, when the stack is empty", () => {
    expect(() => useEditorStore.getState().undo()).not.toThrow()
    expect(useEditorStore.getState().undoStack).toHaveLength(0)
  })

  it("undoes a frame reorder, restoring the prior order exactly", () => {
    const store = useEditorStore.getState()
    const a = store.addFrame(A5_PORTRAIT)
    const b = store.addFrame(A5_PORTRAIT)
    const c = store.addFrame(A5_PORTRAIT)
    const before = useEditorStore.getState().project.frames.map((f) => f.id)
    expect(before).toEqual([a, b, c])

    useEditorStore.getState().reorderFrameById(0, 2)
    expect(useEditorStore.getState().project.frames.map((f) => f.id)).toEqual([b, c, a])

    useEditorStore.getState().undo()

    const after = useEditorStore.getState().project.frames
    expect(after.map((f) => f.id)).toEqual(before)
    // Positions were re-derived by the reorder; undo must restore them too.
    expect(after.map((f) => f.position)).toEqual([0, 1, 2])
  })

  it("undoes a move-between-frames, restoring the photograph to its prior placement on the pasteboard", () => {
    const placement: CanvasPlacement = { id: "p1", assetId: "a1", x: 10, y: 20, scale: 1.5, rotation: 0 }
    useEditorStore.setState((state) => ({
      project: {
        ...state.project,
        assets: [{ id: "a1", name: "photo.jpg", width: 100, height: 100, importedAt: 0 }],
        canvas: { placements: [placement] },
      },
    }))

    const frameId = useEditorStore.getState().addFrame(A5_PORTRAIT)
    useEditorStore.getState().moveToFrame("p1", frameId)

    const midway = useEditorStore.getState().project
    expect(midway.canvas.placements).toHaveLength(0)
    expect(midway.frames.find((f) => f.id === frameId)?.elements).toHaveLength(1)

    useEditorStore.getState().undo()

    const restored = useEditorStore.getState().project
    expect(restored.canvas.placements).toEqual([placement])
    expect(restored.frames.find((f) => f.id === frameId)?.elements).toEqual([])
  })

  it("undoes a text edit, restoring the prior content", () => {
    const store = useEditorStore.getState()
    const frameId = store.addFrame(A5_PORTRAIT)
    store.createTextElement(frameId, "hello")

    const created = useEditorStore
      .getState()
      .project.frames.find((f) => f.id === frameId)?.elements[0]
    if (!created) throw new Error("expected the created text element to exist")

    useEditorStore.getState().updateTextElement(frameId, created.id, { content: "world" })
    const midwayElement = useEditorStore
      .getState()
      .project.frames.find((f) => f.id === frameId)
      ?.elements.find((e) => e.id === created.id)
    expect(midwayElement?.kind === "text" ? midwayElement.content : undefined).toBe("world")

    // One undo reverts only the content edit, not the element's creation.
    useEditorStore.getState().undo()

    const afterUndo = useEditorStore
      .getState()
      .project.frames.find((f) => f.id === frameId)
      ?.elements.find((e) => e.id === created.id)
    expect(afterUndo?.kind === "text" ? afterUndo.content : undefined).toBe("hello")
  })

  it("undoes a text element's creation, removing it from the frame", () => {
    const store = useEditorStore.getState()
    const frameId = store.addFrame(A5_PORTRAIT)
    store.createTextElement(frameId, "hello")
    expect(useEditorStore.getState().project.frames.find((f) => f.id === frameId)?.elements).toHaveLength(1)

    useEditorStore.getState().undo()

    expect(useEditorStore.getState().project.frames.find((f) => f.id === frameId)?.elements).toEqual([])
  })

  it("clears the stack on project load — a fresh load never reaches into the previous project's history", async () => {
    useEditorStore.getState().addFrame(A5_PORTRAIT)
    expect(useEditorStore.getState().undoStack.length).toBeGreaterThan(0)

    await useEditorStore.getState().hydrate()

    expect(useEditorStore.getState().undoStack).toHaveLength(0)
    expect(() => useEditorStore.getState().undo()).not.toThrow()
  })
})
