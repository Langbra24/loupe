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

  it("records no undo step when a text edit leaves the content unchanged", () => {
    const store = useEditorStore.getState()
    const frameId = store.addFrame(A5_PORTRAIT)
    store.createTextElement(frameId, "hello")
    const created = useEditorStore.getState().project.frames.find((f) => f.id === frameId)?.elements[0]
    if (!created) throw new Error("expected the created text element to exist")
    const depth = useEditorStore.getState().undoStack.length

    // What leaving editing without typing does: commit the same content.
    useEditorStore.getState().updateTextElement(frameId, created.id, { content: "hello" })

    expect(useEditorStore.getState().undoStack).toHaveLength(depth)
  })

  it("undoes a text element's creation, removing it from the frame", () => {
    const store = useEditorStore.getState()
    const frameId = store.addFrame(A5_PORTRAIT)
    store.createTextElement(frameId, "hello")
    expect(useEditorStore.getState().project.frames.find((f) => f.id === frameId)?.elements).toHaveLength(1)

    useEditorStore.getState().undo()

    expect(useEditorStore.getState().project.frames.find((f) => f.id === frameId)?.elements).toEqual([])
  })

  it("undoes moveElementToFrame, restoring the element to its original page and Box", () => {
    const store = useEditorStore.getState()
    const frameA = store.addFrame(A5_PORTRAIT)
    const frameB = store.addFrame(A5_PORTRAIT)
    const elementId = useEditorStore.getState().createTextElement(frameA, "hello")

    const originalBox = useEditorStore
      .getState()
      .project.frames.find((f) => f.id === frameA)
      ?.elements.find((e) => e.id === elementId)?.frame
    if (!originalBox) throw new Error("expected the created element to have a Box")

    useEditorStore.getState().moveElementToFrame(frameA, frameB, elementId, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 })

    const midway = useEditorStore.getState().project
    expect(midway.frames.find((f) => f.id === frameA)?.elements).toEqual([])
    expect(midway.frames.find((f) => f.id === frameB)?.elements).toHaveLength(1)
    expect(useEditorStore.getState().selection).toEqual({ kind: "text-element", frameId: frameB, elementId })

    useEditorStore.getState().undo()

    const restored = useEditorStore.getState().project
    expect(restored.frames.find((f) => f.id === frameB)?.elements).toEqual([])
    const restoredElement = restored.frames.find((f) => f.id === frameA)?.elements.find((e) => e.id === elementId)
    expect(restoredElement?.frame).toEqual(originalBox)
    expect(useEditorStore.getState().selection).toEqual({ kind: "text-element", frameId: frameA, elementId })
  })

  it("clears the stack on project load — a fresh load never reaches into the previous project's history", async () => {
    useEditorStore.getState().addFrame(A5_PORTRAIT)
    expect(useEditorStore.getState().undoStack.length).toBeGreaterThan(0)

    await useEditorStore.getState().hydrate()

    expect(useEditorStore.getState().undoStack).toHaveLength(0)
    expect(() => useEditorStore.getState().undo()).not.toThrow()
  })

  it("pushes the undone command onto redoStack", () => {
    useEditorStore.getState().addFrame(A5_PORTRAIT)
    expect(useEditorStore.getState().redoStack).toHaveLength(0)

    useEditorStore.getState().undo()

    expect(useEditorStore.getState().undoStack).toHaveLength(0)
    expect(useEditorStore.getState().redoStack).toHaveLength(1)
  })
})

describe("redo", () => {
  it("is a no-op, not an error, when the stack is empty", () => {
    expect(() => useEditorStore.getState().redo()).not.toThrow()
    expect(useEditorStore.getState().redoStack).toHaveLength(0)
  })

  it("replays an undone frame reorder exactly, and moves the command back onto undoStack", () => {
    const store = useEditorStore.getState()
    const a = store.addFrame(A5_PORTRAIT)
    const b = store.addFrame(A5_PORTRAIT)
    const c = store.addFrame(A5_PORTRAIT)

    useEditorStore.getState().reorderFrameById(0, 2)
    const reordered = useEditorStore.getState().project.frames.map((f) => f.id)
    expect(reordered).toEqual([b, c, a])

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().project.frames.map((f) => f.id)).toEqual([a, b, c])

    useEditorStore.getState().redo()

    expect(useEditorStore.getState().project.frames.map((f) => f.id)).toEqual(reordered)
    expect(useEditorStore.getState().redoStack).toHaveLength(0)
    // 3 `addFrame`s plus the reorder itself — all four are back on undoStack.
    expect(useEditorStore.getState().undoStack).toHaveLength(4)
  })

  it("restores a moved-to-frame photograph on redo, removing it from the pasteboard again", () => {
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
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().project.canvas.placements).toEqual([placement])

    useEditorStore.getState().redo()

    const restored = useEditorStore.getState().project
    expect(restored.canvas.placements).toHaveLength(0)
    expect(restored.frames.find((f) => f.id === frameId)?.elements).toHaveLength(1)
  })

  it("is cleared by a new action — you cannot redo into a timeline a fresh command branched away from", () => {
    const store = useEditorStore.getState()
    store.addFrame(A5_PORTRAIT)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().redoStack).toHaveLength(1)

    useEditorStore.getState().addFrame(A5_PORTRAIT)

    expect(useEditorStore.getState().redoStack).toHaveLength(0)
    expect(() => useEditorStore.getState().redo()).not.toThrow()
  })

  it("clears the stack on project load, the same as undoStack", async () => {
    useEditorStore.getState().addFrame(A5_PORTRAIT)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().redoStack.length).toBeGreaterThan(0)

    await useEditorStore.getState().hydrate()

    expect(useEditorStore.getState().redoStack).toHaveLength(0)
    expect(() => useEditorStore.getState().redo()).not.toThrow()
  })
})

describe("text color undo (#27)", () => {
  /** A frame with one text element, returning the ids and a color reader. */
  function textBox() {
    const frameId = useEditorStore.getState().addFrame(A5_PORTRAIT)
    useEditorStore.getState().createTextElement(frameId, "hello")
    const element = useEditorStore.getState().project.frames.find((f) => f.id === frameId)?.elements[0]
    if (!element) throw new Error("expected the created text element to exist")
    const color = () => {
      const current = useEditorStore
        .getState()
        .project.frames.find((f) => f.id === frameId)
        ?.elements.find((e) => e.id === element.id)
      return current?.kind === "text" ? current.color : "not text"
    }
    return { frameId, elementId: element.id, color, depth: () => useEditorStore.getState().undoStack.length }
  }

  it("makes a single color change one undo step, undone and redone", () => {
    const { frameId, elementId, color, depth } = textBox()
    const before = depth()

    useEditorStore.getState().updateTextElement(frameId, elementId, { color: "#37bf7b" })
    expect(depth()).toBe(before + 1)

    useEditorStore.getState().undo()
    expect(color()).toBeUndefined()
    useEditorStore.getState().redo()
    expect(color()).toBe("#37bf7b")
  })

  it("coalesces a drag's many changes into one step back to the color before it", () => {
    const { frameId, elementId, color, depth } = textBox()
    useEditorStore.getState().updateTextElement(frameId, elementId, { color: "#111111" })
    const before = depth()

    useEditorStore.getState().beginTextColorGesture(frameId, elementId)
    for (const step of ["#222222", "#333333", "#444444", "#555555"]) {
      useEditorStore.getState().updateTextElement(frameId, elementId, { color: step })
    }
    useEditorStore.getState().endTextColorGesture()
    expect(depth()).toBe(before + 1)

    useEditorStore.getState().undo()
    expect(color()).toBe("#111111")
    useEditorStore.getState().redo()
    expect(color()).toBe("#555555")
  })

  it("adds no step for a gesture that changed nothing, or for re-setting the same color", () => {
    const { frameId, elementId, depth } = textBox()
    useEditorStore.getState().updateTextElement(frameId, elementId, { color: "#111111" })
    const before = depth()

    useEditorStore.getState().beginTextColorGesture(frameId, elementId)
    useEditorStore.getState().endTextColorGesture()
    useEditorStore.getState().updateTextElement(frameId, elementId, { color: "#111111" })

    expect(depth()).toBe(before)
  })
})
