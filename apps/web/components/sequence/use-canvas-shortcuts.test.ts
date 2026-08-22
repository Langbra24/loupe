import { describe, expect, it, vi } from "vitest"

import { handleFrameKeyDown, shouldCreateTextbox } from "@/components/sequence/use-canvas-shortcuts"

/**
 * Exercises the pure decision logic directly, bypassing a real DOM keydown —
 * there is no browser test runner in this repo (see CLAUDE.md / vitest.config.ts),
 * so this is the honest substitute for wiring-level coverage.
 */
function fakeEvent(overrides: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) {
  return {
    key: overrides.key ?? "",
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    preventDefault: vi.fn(),
  }
}

describe("handleFrameKeyDown", () => {
  it("does nothing when there are no frames", () => {
    const setFocusedFrameIndex = vi.fn()
    const reorderFrameById = vi.fn()
    handleFrameKeyDown(fakeEvent({ key: "Tab" }), {
      frameCount: 0,
      focusedFrameIndex: null,
      setFocusedFrameIndex,
      reorderFrameById,
    })
    expect(setFocusedFrameIndex).not.toHaveBeenCalled()
    expect(reorderFrameById).not.toHaveBeenCalled()
  })

  it("Tab focuses the first frame when nothing is focused yet", () => {
    const setFocusedFrameIndex = vi.fn()
    const event = fakeEvent({ key: "Tab" })
    handleFrameKeyDown(event, {
      frameCount: 3,
      focusedFrameIndex: null,
      setFocusedFrameIndex,
      reorderFrameById: vi.fn(),
    })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(setFocusedFrameIndex).toHaveBeenCalledWith(0)
  })

  it("Tab cycles forward and wraps at the end", () => {
    const setFocusedFrameIndex = vi.fn()
    handleFrameKeyDown(fakeEvent({ key: "Tab" }), {
      frameCount: 3,
      focusedFrameIndex: 2,
      setFocusedFrameIndex,
      reorderFrameById: vi.fn(),
    })
    expect(setFocusedFrameIndex).toHaveBeenCalledWith(0)
  })

  it("Shift+Tab cycles backward and wraps at the start", () => {
    const setFocusedFrameIndex = vi.fn()
    handleFrameKeyDown(fakeEvent({ key: "Tab", shiftKey: true }), {
      frameCount: 3,
      focusedFrameIndex: 0,
      setFocusedFrameIndex,
      reorderFrameById: vi.fn(),
    })
    expect(setFocusedFrameIndex).toHaveBeenCalledWith(2)
  })

  it("a bare ArrowLeft/ArrowRight (no modifier) does nothing", () => {
    const reorderFrameById = vi.fn()
    handleFrameKeyDown(fakeEvent({ key: "ArrowRight" }), {
      frameCount: 3,
      focusedFrameIndex: 1,
      setFocusedFrameIndex: vi.fn(),
      reorderFrameById,
    })
    expect(reorderFrameById).not.toHaveBeenCalled()
  })

  it("Ctrl+ArrowRight reorders the focused frame one position later", () => {
    const reorderFrameById = vi.fn()
    const setFocusedFrameIndex = vi.fn()
    handleFrameKeyDown(fakeEvent({ key: "ArrowRight", ctrlKey: true }), {
      frameCount: 3,
      focusedFrameIndex: 1,
      setFocusedFrameIndex,
      reorderFrameById,
    })
    expect(reorderFrameById).toHaveBeenCalledWith(1, 2)
    expect(setFocusedFrameIndex).toHaveBeenCalledWith(2)
  })

  it("Cmd+ArrowLeft reorders the focused frame one position earlier", () => {
    const reorderFrameById = vi.fn()
    handleFrameKeyDown(fakeEvent({ key: "ArrowLeft", metaKey: true }), {
      frameCount: 3,
      focusedFrameIndex: 1,
      setFocusedFrameIndex: vi.fn(),
      reorderFrameById,
    })
    expect(reorderFrameById).toHaveBeenCalledWith(1, 0)
  })

  it("does not reorder past the first or last position", () => {
    const reorderFrameById = vi.fn()
    handleFrameKeyDown(fakeEvent({ key: "ArrowLeft", ctrlKey: true }), {
      frameCount: 3,
      focusedFrameIndex: 0,
      setFocusedFrameIndex: vi.fn(),
      reorderFrameById,
    })
    handleFrameKeyDown(fakeEvent({ key: "ArrowRight", ctrlKey: true }), {
      frameCount: 3,
      focusedFrameIndex: 2,
      setFocusedFrameIndex: vi.fn(),
      reorderFrameById,
    })
    expect(reorderFrameById).not.toHaveBeenCalled()
  })

  it("does nothing on a reorder key when no frame is focused", () => {
    const reorderFrameById = vi.fn()
    handleFrameKeyDown(fakeEvent({ key: "ArrowRight", ctrlKey: true }), {
      frameCount: 3,
      focusedFrameIndex: null,
      setFocusedFrameIndex: vi.fn(),
      reorderFrameById,
    })
    expect(reorderFrameById).not.toHaveBeenCalled()
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
