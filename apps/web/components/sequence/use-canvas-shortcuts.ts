"use client"

import { useEffect, useState } from "react"

interface Options {
  enabled: boolean
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
}

/**
 * Route the browser's zoom shortcuts to the canvas.
 *
 * A canvas tool has to do this: without it, the shortcut scales the entire
 * interface rather than the photographs, which is the opposite of what a user
 * pressing it on a light table wants.
 *
 * Returns whether interception actually works here. Safari handles these at
 * browser-chrome level and delivers a non-cancelable keydown, so `preventDefault`
 * cannot stop native page zoom — the controls use this to avoid advertising a
 * shortcut that would scale the interface.
 */
export function useCanvasShortcuts({ enabled, zoomIn, zoomOut, resetZoom }: Options): boolean {
  const [canIntercept, setCanIntercept] = useState(true)

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return

      // `=` matters as much as `+`: on most layouts the unshifted key reports
      // as `=`, and that is what users actually press.
      const isZoomIn = event.key === "+" || event.key === "="
      const isZoomOut = event.key === "-" || event.key === "_"
      const isReset = event.key === "0"
      if (!isZoomIn && !isZoomOut && !isReset) return

      if (!event.cancelable) {
        // The browser owns this shortcut and will zoom the page regardless.
        setCanIntercept(false)
        return
      }

      event.preventDefault()
      if (isZoomIn) zoomIn()
      else if (isZoomOut) zoomOut()
      else resetZoom()
    }

    window.addEventListener("keydown", onKeyDown, { passive: false })
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, zoomIn, zoomOut, resetZoom])

  return canIntercept
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

export interface FrameKeyboardOptions {
  enabled: boolean
  /** Total number of frames — reorder and Tab-cycling both need the bound. */
  frameCount: number
  /** Which frame Tab-cycling currently has landed on. `null` means none. */
  focusedFrameIndex: number | null
  setFocusedFrameIndex: (index: number | null) => void
  reorderFrameById: (from: number, to: number) => void
}

/** The DOM-facing half of {@link handleFrameKeyDown} — everything below the
 *  event-listener wiring is deliberately separated out so it can be called
 *  directly in a test without simulating a real keydown. */
type FrameKeyEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey"> & {
  preventDefault: () => void
}

/**
 * Keyboard reach for the two drag-only frame actions (R30): reordering a
 * frame, and selecting/cycling which frame is focused.
 *
 * - `Tab` / `Shift+Tab` cycles the focused frame, wrapping at both ends —
 *   this is the keyboard equivalent of clicking a frame to select it.
 * - `Cmd/Ctrl+ArrowLeft` / `Cmd/Ctrl+ArrowRight` moves the focused frame one
 *   position earlier/later — the modifier is required so a bare arrow key
 *   stays free for whatever normal focus movement ends up wanting it, and so
 *   this never fires while someone is just navigating with the arrow keys.
 *
 * Exported as a pure function (`handleFrameKeyDown`) plus a thin hook
 * (`useFrameKeyboardShortcuts`) that wires it to `window`'s keydown stream —
 * the split exists so the actual decision logic is testable without
 * dispatching a real DOM event.
 */
export function handleFrameKeyDown(event: FrameKeyEvent, options: Omit<FrameKeyboardOptions, "enabled">): void {
  const { frameCount, focusedFrameIndex, setFocusedFrameIndex, reorderFrameById } = options
  if (frameCount === 0) return

  if (event.key === "Tab") {
    event.preventDefault()
    const step = event.shiftKey ? -1 : 1
    const base = focusedFrameIndex ?? (event.shiftKey ? 0 : -1)
    const next = ((base + step) % frameCount + frameCount) % frameCount
    setFocusedFrameIndex(next)
    return
  }

  const hasReorderModifier = event.ctrlKey || event.metaKey
  if (!hasReorderModifier || focusedFrameIndex === null) return

  if (event.key === "ArrowLeft") {
    event.preventDefault()
    const to = Math.max(0, focusedFrameIndex - 1)
    if (to === focusedFrameIndex) return
    reorderFrameById(focusedFrameIndex, to)
    setFocusedFrameIndex(to)
  } else if (event.key === "ArrowRight") {
    event.preventDefault()
    const to = Math.min(frameCount - 1, focusedFrameIndex + 1)
    if (to === focusedFrameIndex) return
    reorderFrameById(focusedFrameIndex, to)
    setFocusedFrameIndex(to)
  }
}

export function useFrameKeyboardShortcuts({
  enabled,
  frameCount,
  focusedFrameIndex,
  setFocusedFrameIndex,
  reorderFrameById,
}: FrameKeyboardOptions): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      // Tab and Ctrl/Cmd+Arrow are both keys the rest of the app relies on for
      // normal focus movement and text editing, so this only claims them when
      // focus isn't already inside an input, textarea, select, or editable
      // region — mirroring the guard the (now-removed) theme hotkey used.
      if (isTypingTarget(event.target)) return

      handleFrameKeyDown(event, { frameCount, focusedFrameIndex, setFocusedFrameIndex, reorderFrameById })
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, frameCount, focusedFrameIndex, setFocusedFrameIndex, reorderFrameById])
}

/**
 * Decides whether a bare `T` keypress should create a new pasteboard text
 * box (U6). Extracted as a pure function — mirroring `handleFrameKeyDown`
 * above — so the decision is testable without a real DOM keydown or a Fabric
 * canvas.
 *
 * Two independent things can make `T` inert:
 * - focus is already inside a DOM input/textarea/etc (`isTypingTarget`,
 *   checked by the caller and passed in as `isDomTypingTarget`) — typing
 *   into, say, the project name field should never spawn a text box.
 * - a Fabric `Textbox` already has editing focus (`isTextboxEditing`) —
 *   typing "The" into an existing box must never create a second one. This
 *   is a Fabric-level fact (`canvas.getActiveObject()?.isEditing`), not a
 *   DOM one, which is why it can't be folded into `isTypingTarget` itself.
 *
 * Any modifier key (Ctrl/Cmd/Alt) also makes it inert — `T` alone is the
 * shortcut, so `Ctrl+T` and friends stay free for the browser/OS.
 */
export function shouldCreateTextbox(input: {
  key: string
  hasModifier: boolean
  isDomTypingTarget: boolean
  isTextboxEditing: boolean
}): boolean {
  if (input.hasModifier) return false
  if (input.isDomTypingTarget) return false
  if (input.isTextboxEditing) return false
  return input.key.toLowerCase() === "t"
}

export interface TextToolOptions {
  enabled: boolean
  /** Fabric-level fact, not React state — see `shouldCreateTextbox`. */
  isTextboxEditing: () => boolean
  createTextbox: () => void
}

/** Wires the `T` shortcut (create-and-edit a pasteboard text box, U6) to
 *  `window`'s keydown stream. Split from `shouldCreateTextbox` for the same
 *  reason `useFrameKeyboardShortcuts` is split from `handleFrameKeyDown`. */
export function useTextToolShortcut({ enabled, isTextboxEditing, createTextbox }: TextToolOptions): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      const shouldCreate = shouldCreateTextbox({
        key: event.key,
        hasModifier: event.ctrlKey || event.metaKey || event.altKey,
        isDomTypingTarget: isTypingTarget(event.target),
        isTextboxEditing: isTextboxEditing(),
      })
      if (!shouldCreate) return

      event.preventDefault()
      createTextbox()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, isTextboxEditing, createTextbox])
}

export interface UndoShortcutOptions {
  enabled: boolean
  undo: () => void
}

/**
 * Binds the platform undo shortcut (`Cmd/Ctrl+Z`, U8) to the store's
 * `undo()`. Guarded by `isTypingTarget` the same way the frame/text
 * shortcuts are — but for undo specifically, that guard matters more than
 * usual: inside a text field (the sidebar's content textarea, the project
 * name field, anywhere), `Ctrl+Z` should fall through to the browser's own
 * native text-undo, not this app-level command stack. Returning early here
 * (rather than calling `preventDefault`) is what lets that fall-through
 * happen.
 */
export function useUndoShortcut({ enabled, undo }: UndoShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z") return
      if (!event.ctrlKey && !event.metaKey) return
      if (event.shiftKey) return // Redo (Cmd/Ctrl+Shift+Z) isn't implemented — leave it alone.
      if (isTypingTarget(event.target)) return

      event.preventDefault()
      undo()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, undo])
}
