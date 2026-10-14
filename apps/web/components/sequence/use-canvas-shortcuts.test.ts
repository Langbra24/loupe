import { describe, expect, it, vi } from "vitest"

import type { Frame } from "@loupe/core"

import {
  escapeStep,
  handleFrameKeyDown,
  nextPageImage,
  pageImagesInReadingOrder,
  shouldCreateTextbox,
} from "@/components/sequence/use-canvas-shortcuts"

/**
 * Exercises the pure decision logic directly, bypassing a real DOM keydown —
 * there is no browser test runner in this repo (see CLAUDE.md / vitest.config.ts),
 * so this is the honest substitute for wiring-level coverage.
 */
function fakeEvent(
  overrides: Partial<{
    key: string
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    shiftKey: boolean
    isTypingTarget: boolean
    altGraph: boolean
  }>,
) {
  return {
    key: overrides.key ?? "",
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    altKey: overrides.altKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    isTypingTarget: overrides.isTypingTarget ?? false,
    altGraph: overrides.altGraph ?? false,
    preventDefault: vi.fn(),
  }
}

/** A page with just what the stepping logic reads: id, position, and the
 *  kind/id of each element in order. */
function page(id: string, position: number, elements: [string, "image" | "text"][]): Frame {
  return { id, position, elements: elements.map(([elementId, kind]) => ({ id: elementId, kind })) } as unknown as Frame
}

// Array order deliberately differs from reading order: p2 is first in the
// array but second by position.
const PAGES = [
  page("p2", 1, [["b1", "image"], ["t2", "text"], ["b2", "image"]]),
  page("p1", 0, [["t1", "text"], ["a1", "image"]]),
  page("p3", 2, []),
  page("p4", 3, [["d1", "image"]]),
]

function options(overrides: Partial<Parameters<typeof handleFrameKeyDown>[1]> = {}) {
  return {
    frames: PAGES,
    selectedFrameId: null,
    selectedElementId: null,
    selectImage: vi.fn(),
    reorderFrameById: vi.fn(),
    ...overrides,
  }
}

describe("pageImagesInReadingOrder", () => {
  it("orders images by page position, then element order, skipping text and empty pages", () => {
    expect(pageImagesInReadingOrder(PAGES).map((image) => image.elementId)).toEqual(["a1", "b1", "b2", "d1"])
  })

  it("never includes pasteboard photos, which aren't page elements", () => {
    expect(pageImagesInReadingOrder([page("p1", 0, [["t1", "text"]])])).toEqual([])
  })
})

describe("nextPageImage", () => {
  const images = pageImagesInReadingOrder(PAGES)

  it("steps forward and backward", () => {
    expect(nextPageImage(images, "b1", 1)?.elementId).toBe("b2")
    expect(nextPageImage(images, "b1", -1)?.elementId).toBe("a1")
  })

  it("wraps at both ends", () => {
    expect(nextPageImage(images, "d1", 1)?.elementId).toBe("a1")
    expect(nextPageImage(images, "a1", -1)?.elementId).toBe("d1")
  })

  it("from nothing selected, ] goes to the first image and [ to the last", () => {
    expect(nextPageImage(images, null, 1)?.elementId).toBe("a1")
    expect(nextPageImage(images, null, -1)?.elementId).toBe("d1")
  })

  it("from a selected text element, starts over as if nothing were selected", () => {
    expect(nextPageImage(images, "t2", 1)?.elementId).toBe("a1")
  })

  it("returns null when no page holds an image", () => {
    expect(nextPageImage([], null, 1)).toBeNull()
  })
})

describe("handleFrameKeyDown", () => {
  it("] selects the next image, with its page", () => {
    const opts = options({ selectedFrameId: "p1", selectedElementId: "a1" })
    const event = fakeEvent({ key: "]" })
    handleFrameKeyDown(event, opts)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(opts.selectImage).toHaveBeenCalledWith({ frameId: "p2", elementId: "b1" })
  })

  it("[ from nothing selected selects the last image", () => {
    const opts = options()
    handleFrameKeyDown(fakeEvent({ key: "[" }), opts)
    expect(opts.selectImage).toHaveBeenCalledWith({ frameId: "p4", elementId: "d1" })
  })

  it("does nothing, and leaves the key alone, when no page holds an image", () => {
    const opts = options({ frames: [page("p1", 0, [["t1", "text"]])] })
    const event = fakeEvent({ key: "]" })
    handleFrameKeyDown(event, opts)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(opts.selectImage).not.toHaveBeenCalled()
  })

  it.each([{}, { shiftKey: true }])("never claims Tab (%o), so it stays browser focus movement", (modifiers) => {
    const opts = options({ selectedFrameId: "p1", selectedElementId: "a1" })
    const event = fakeEvent({ key: "Tab", ...modifiers })
    handleFrameKeyDown(event, opts)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(opts.selectImage).not.toHaveBeenCalled()
  })

  it.each(["[", "]"])("%s is inert while typing in a field or text box", (key) => {
    const opts = options()
    const event = fakeEvent({ key, isTypingTarget: true })
    handleFrameKeyDown(event, opts)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(opts.selectImage).not.toHaveBeenCalled()
  })

  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }])("leaves a bracket with %o to the browser", (modifiers) => {
    const opts = options()
    const event = fakeEvent({ key: "]", ...modifiers })
    handleFrameKeyDown(event, opts)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(opts.selectImage).not.toHaveBeenCalled()
  })

  it("claims a bracket typed with AltGr (reported as Ctrl+Alt), as on a German layout", () => {
    const opts = options()
    handleFrameKeyDown(fakeEvent({ key: "]", ctrlKey: true, altKey: true, altGraph: true }), opts)
    expect(opts.selectImage).toHaveBeenCalledWith({ frameId: "p1", elementId: "a1" })
  })

  it("a bare ArrowLeft/ArrowRight (no modifier) does nothing", () => {
    const opts = options({ selectedFrameId: "p1" })
    handleFrameKeyDown(fakeEvent({ key: "ArrowRight" }), opts)
    expect(opts.reorderFrameById).not.toHaveBeenCalled()
  })

  it("Ctrl+ArrowRight moves the page holding the selection one position later", () => {
    // p1 is index 1 in the array the store reorders by.
    const opts = options({ selectedFrameId: "p1", selectedElementId: "a1" })
    handleFrameKeyDown(fakeEvent({ key: "ArrowRight", ctrlKey: true }), opts)
    expect(opts.reorderFrameById).toHaveBeenCalledWith(1, 2)
  })

  it("Cmd+ArrowLeft moves a selected page one position earlier", () => {
    const opts = options({ selectedFrameId: "p1" })
    handleFrameKeyDown(fakeEvent({ key: "ArrowLeft", metaKey: true }), opts)
    expect(opts.reorderFrameById).toHaveBeenCalledWith(1, 0)
  })

  it("does not reorder past the first or last position", () => {
    const first = options({ selectedFrameId: "p2" })
    handleFrameKeyDown(fakeEvent({ key: "ArrowLeft", ctrlKey: true }), first)
    const last = options({ selectedFrameId: "p4" })
    handleFrameKeyDown(fakeEvent({ key: "ArrowRight", ctrlKey: true }), last)
    expect(first.reorderFrameById).not.toHaveBeenCalled()
    expect(last.reorderFrameById).not.toHaveBeenCalled()
  })

  it("Ctrl+Arrow does nothing with nothing selected", () => {
    const opts = options()
    const event = fakeEvent({ key: "ArrowRight", ctrlKey: true })
    handleFrameKeyDown(event, opts)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(opts.reorderFrameById).not.toHaveBeenCalled()
  })

  it("Ctrl+ArrowRight is inert while typing", () => {
    const opts = options({ selectedFrameId: "p1" })
    handleFrameKeyDown(fakeEvent({ key: "ArrowRight", ctrlKey: true, isTypingTarget: true }), opts)
    expect(opts.reorderFrameById).not.toHaveBeenCalled()
  })
})

describe("shouldCreateTextbox", () => {
  const base = { key: "t", hasModifier: false, isDomTypingTarget: false, isTextboxEditing: false }

  it("creates on a bare 't'", () => {
    expect(shouldCreateTextbox(base)).toBe(true)
  })

  it("creates on a bare 'T' (shift+t reports as uppercase, not a modifier)", () => {
    expect(shouldCreateTextbox({ ...base, key: "T" })).toBe(true)
  })

  it("is inert for any other key", () => {
    expect(shouldCreateTextbox({ ...base, key: "a" })).toBe(false)
  })

  it("is inert when a modifier key is held", () => {
    expect(shouldCreateTextbox({ ...base, hasModifier: true })).toBe(false)
  })

  it("is inert when a DOM input/textarea/etc has focus", () => {
    expect(shouldCreateTextbox({ ...base, isDomTypingTarget: true })).toBe(false)
  })

  it("is inert when a Fabric textbox already has editing focus — typing 'The' must not spawn a second box", () => {
    expect(shouldCreateTextbox({ ...base, isTextboxEditing: true })).toBe(false)
  })
})

describe("escapeStep", () => {
  it("steps a text or image element out to its page", () => {
    expect(escapeStep({ kind: "text-element", frameId: "f1", elementId: "e1" }, true)).toEqual({
      kind: "select-frame",
      frameId: "f1",
    })
    expect(escapeStep({ kind: "image-element", frameId: "f2", elementId: "e2" }, false)).toEqual({
      kind: "select-frame",
      frameId: "f2",
    })
  })

  it("steps a page out to nothing, whether or not the canvas holds it", () => {
    expect(escapeStep({ kind: "frame", frameId: "f1" }, true)).toEqual({ kind: "clear" })
    expect(escapeStep({ kind: "frame", frameId: "f1" }, false)).toEqual({ kind: "clear" })
  })

  it("clears a canvas-only selection, such as pasteboard photographs", () => {
    expect(escapeStep(null, true)).toEqual({ kind: "clear" })
  })

  it("does nothing with nothing selected", () => {
    expect(escapeStep(null, false)).toBeNull()
  })
})
