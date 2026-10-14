"use client"

import { useEffect, useState } from "react"
import type { Frame, Selection } from "@loupe/core"

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

/** Exported for use-fabric-canvas.ts's own window-level key listeners
 *  (e.g. Space for the pan/hand cursor) — same guard, one definition. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

/** An image element placed in a page, addressed the way `selectElement` takes it. */
export interface PageImage {
  frameId: string
  elementId: string
}

/** Every image placed in a page, in reading order: by page `position`, then
 *  by each page's element order. Text and pasteboard photos aren't in pages'
 *  image lists, so they never appear. */
export function pageImagesInReadingOrder(frames: readonly Frame[]): PageImage[] {
  return [...frames]
    .sort((a, b) => a.position - b.position)
    .flatMap((frame) =>
      frame.elements
        .filter((element) => element.kind === "image")
        .map((element) => ({ frameId: frame.id, elementId: element.id })),
    )
}

/** The image `step` places from `currentElementId`, wrapping at both ends.
 *  From nothing (or from something that isn't a page image), forward starts
 *  at the first image and backward at the last. `null` when there are none. */
export function nextPageImage(
  images: readonly PageImage[],
  currentElementId: string | null,
  step: 1 | -1,
): PageImage | null {
  if (images.length === 0) return null
  const index = currentElementId ? images.findIndex((image) => image.elementId === currentElementId) : -1
  if (index === -1) return step > 0 ? images[0] : images[images.length - 1]
  return images[(index + step + images.length) % images.length]
}

export interface FrameKeyboardOptions {
  enabled: boolean
  frames: readonly Frame[]
  /** The page holding the current selection (a selected page, or the page a
   *  selected element sits in), and the selected element if there is one. */
  selectedFrameId: string | null
  selectedElementId: string | null
  /** Selects an image the way a click on it would. */
  selectImage: (image: PageImage) => void
  reorderFrameById: (from: number, to: number) => void
}

/** The DOM-facing half of {@link handleFrameKeyDown} — everything below the
 *  event-listener wiring is deliberately separated out so it can be called
 *  directly in a test without simulating a real keydown. */
type FrameKeyEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & {
  preventDefault: () => void
  /** `isTypingTarget(event.target)`, resolved by the caller so this stays
   *  testable without a DOM. Fabric's text editing counts: it types into a
   *  hidden textarea. */
  isTypingTarget: boolean
  /** AltGr is held. Windows reports it as Ctrl+Alt, and layouts such as
   *  German type `[`/`]` with it, so it doesn't count as a modifier. */
  altGraph: boolean
}

/**
 * Keyboard reach for the canvas's drag-only actions (R30): selecting what's
 * in the pages, and reordering a page.
 *
 * - `]` / `[` selects the next / previous image placed in a page, in reading
 *   order, wrapping at both ends (issue #19: "it's the images that matter").
 *   The selection itself is the visible focus; there is no separate page
 *   focus. This was page cycling on Tab before #19: claiming Tab meant
 *   keyboard users could never Tab into the toolbar, panels, or dialogs, so
 *   Tab is never handled here. With Ctrl/Cmd/Alt held, the brackets are left
 *   to the browser (AltGr aside, see `FrameKeyEvent.altGraph`).
 * - `Cmd/Ctrl+ArrowLeft` / `Cmd/Ctrl+ArrowRight` moves the page holding the
 *   selection one position earlier/later — the modifier is required so a
 *   bare arrow key stays free for normal focus movement. With nothing
 *   selected it does nothing.
 *
 * Exported as a pure function (`handleFrameKeyDown`) plus a thin hook
 * (`useFrameKeyboardShortcuts`) that wires it to `window`'s keydown stream —
 * the split exists so the actual decision logic is testable without
 * dispatching a real DOM event.
 */
export function handleFrameKeyDown(event: FrameKeyEvent, options: Omit<FrameKeyboardOptions, "enabled">): void {
  const { frames, selectedFrameId, selectedElementId, selectImage, reorderFrameById } = options
  if (event.isTypingTarget) return

  if (event.key === "]" || event.key === "[") {
    if (!event.altGraph && (event.ctrlKey || event.metaKey || event.altKey)) return
    const next = nextPageImage(pageImagesInReadingOrder(frames), selectedElementId, event.key === "]" ? 1 : -1)
    if (!next) return
    event.preventDefault()
    selectImage(next)
    return
  }

  const hasReorderModifier = event.ctrlKey || event.metaKey
  // `reorderFrameById` moves by array index (positions are re-derived from it).
  const from = frames.findIndex((frame) => frame.id === selectedFrameId)
  if (!hasReorderModifier || from === -1) return

  if (event.key === "ArrowLeft") {
    event.preventDefault()
    if (from > 0) reorderFrameById(from, from - 1)
  } else if (event.key === "ArrowRight") {
    event.preventDefault()
    if (from < frames.length - 1) reorderFrameById(from, from + 1)
  }
}

export function useFrameKeyboardShortcuts({
  enabled,
  frames,
  selectedFrameId,
  selectedElementId,
  selectImage,
  reorderFrameById,
}: FrameKeyboardOptions): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      // The brackets and Ctrl/Cmd+Arrow are both keys text editing relies on,
      // so none of this applies while focus is in an input, textarea, select,
      // or editable region (`handleFrameKeyDown` checks the flag).
      handleFrameKeyDown(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          preventDefault: () => event.preventDefault(),
          isTypingTarget: isTypingTarget(event.target),
          altGraph: event.getModifierState("AltGraph"),
        },
        { frames, selectedFrameId, selectedElementId, selectImage, reorderFrameById },
      )
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, frames, selectedFrameId, selectedElementId, selectImage, reorderFrameById])
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
  /** Arms the text tool — the *next click* on the canvas is what actually
   *  places the box (see `armTextTool` in use-fabric-canvas.ts). `T` no
   *  longer creates a box outright, per direct user feedback that a box
   *  materializing at the viewport center made a same-gesture "click to
   *  place it" read as clicking away and abandoning it. */
  armTextTool: () => void
}

/** Wires the `T` shortcut (arm the text tool, U6) to `window`'s keydown
 *  stream. Split from `shouldCreateTextbox` for the same reason
 *  `useFrameKeyboardShortcuts` is split from `handleFrameKeyDown`. */
export function useTextToolShortcut({ enabled, isTextboxEditing, armTextTool }: TextToolOptions): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      const shouldArm = shouldCreateTextbox({
        key: event.key,
        hasModifier: event.ctrlKey || event.metaKey || event.altKey,
        isDomTypingTarget: isTypingTarget(event.target),
        isTextboxEditing: isTextboxEditing(),
      })
      if (!shouldArm) return

      event.preventDefault()
      armTextTool()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, isTextboxEditing, armTextTool])
}

/** Where one Escape takes the selection (issue #76): an element in a page
 *  steps out to that page, a page (or anything else the canvas has selected,
 *  such as pasteboard photographs) steps out to nothing, which is Book
 *  settings. `null` when there is nothing to step out of. */
export type EscapeStep = { kind: "select-frame"; frameId: string } | { kind: "clear" } | null

export function escapeStep(selection: Selection, hasCanvasSelection: boolean): EscapeStep {
  if (selection?.kind === "text-element" || selection?.kind === "image-element") {
    return { kind: "select-frame", frameId: selection.frameId }
  }
  if (selection || hasCanvasSelection) return { kind: "clear" }
  return null
}

/** Whether an open dialog, popover, listbox or menu is on screen. Base UI's
 *  popups already stop the Escape that closes them before it reaches
 *  `window`; this is the backstop for anything open that didn't. Base UI
 *  keeps a closed Select's listbox mounted, marked `data-closed`. */
const OPEN_POPUP = ["dialog", "alertdialog", "listbox", "menu"]
  .map((role) => `[role="${role}"]:not([data-closed])`)
  .join(", ")

export function hasOpenPopup(): boolean {
  return document.querySelector(OPEN_POPUP) !== null
}

export interface EscapeSelectionOptions {
  enabled: boolean
  selection: Selection
  isTextEditing: () => boolean
  isTextToolArmed: () => boolean
  hasCanvasSelection: () => boolean
  selectFrameOnCanvas: (frameId: string) => void
  clearCanvasSelection: () => void
}

/**
 * Escape steps the selection out one level, the keyboard route back to Book
 * settings (issue #76): element, then its page, then nothing. Each step goes
 * through the canvas the way the matching click does (on the page's
 * background, then on empty canvas).
 *
 * Escape belongs to whatever has it first, so this only acts on one nothing
 * else claimed: not `defaultPrevented` (a closing popup, the canvas context
 * menus, an armed `T` placement cancelling), not from a typing target, not
 * while a text box is being edited (Fabric's own Escape leaves editing and
 * keeps the box selected), and not while any popup is open.
 */
export function useEscapeSelection({
  enabled,
  selection,
  isTextEditing,
  isTextToolArmed,
  hasCanvasSelection,
  selectFrameOnCanvas,
  clearCanvasSelection,
}: EscapeSelectionOptions): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (isTypingTarget(event.target) || isTextEditing() || isTextToolArmed() || hasOpenPopup()) return

      const step = escapeStep(selection, hasCanvasSelection())
      if (!step) return
      event.preventDefault()
      if (step.kind === "select-frame") selectFrameOnCanvas(step.frameId)
      else clearCanvasSelection()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, selection, isTextEditing, isTextToolArmed, hasCanvasSelection, selectFrameOnCanvas, clearCanvasSelection])
}

export interface CopyPasteShortcutOptions {
  enabled: boolean
  copySelectedFrame: () => void
  pasteFrame: () => void
}

/**
 * Binds Cmd/Ctrl+C / Cmd/Ctrl+V on a selected frame to a page copy/paste —
 * "select the page, hit Cmd/Ctrl+C, then paste with V" (user-directed).
 * Guarded by `isTypingTarget` the same way undo is: inside a text field,
 * copy/paste should fall through to the browser's own clipboard, not this
 * frame-level command.
 */
export function useCopyPasteShortcut({ enabled, copySelectedFrame, pasteFrame }: CopyPasteShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      if (isTypingTarget(event.target)) return

      const key = event.key.toLowerCase()
      if (key === "c") {
        event.preventDefault()
        copySelectedFrame()
      } else if (key === "v") {
        event.preventDefault()
        pasteFrame()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, copySelectedFrame, pasteFrame])
}

export interface UndoShortcutOptions {
  enabled: boolean
  undo: () => void
  redo: () => void
}

/**
 * Binds the platform undo/redo shortcuts to the store's `undo()`/`redo()`:
 * `Cmd/Ctrl+Z` for undo (U8), `Cmd/Ctrl+Shift+Z` for redo, plus `Cmd/Ctrl+Y`
 * as the secondary redo shortcut Windows users expect. Guarded by
 * `isTypingTarget` the same way the frame/text shortcuts are — but for
 * undo/redo specifically, that guard matters more than usual: inside a text
 * field (the sidebar's content textarea, the project name field, anywhere),
 * these should fall through to the browser's own native text-undo/redo, not
 * this app-level command stack. Returning early here (rather than calling
 * `preventDefault`) is what lets that fall-through happen.
 */
export function useUndoShortcut({ enabled, undo, redo }: UndoShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      if (isTypingTarget(event.target)) return

      const key = event.key.toLowerCase()
      if (key === "z") {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (key === "y") {
        event.preventDefault()
        redo()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, undo, redo])
}

/** What's currently selected, reduced to exactly what this hook needs to
 *  decide what Backspace/Delete should remove — the caller passes this
 *  derived shape rather than the raw `Selection` union from `@loupe/core`,
 *  the same pattern `isFrameSelected`/`selectedFrameId` used before this
 *  hook covered elements too. `"placement"` is one or more pasteboard
 *  photographs that haven't been dropped onto a frame yet — an array, not a
 *  single id, since shift-clicking several is a normal gesture (Fabric's
 *  own multi-select) and should delete all of them in one step, not just
 *  whichever was clicked last. Pasteboard placements have no `Selection`
 *  variant of their own (see `onSelectPlacement` in use-fabric-canvas.ts),
 *  so the caller tracks them separately from the store's `selection` and
 *  folds them in here. */
export type DeletableSelection =
  | { kind: "frame"; frameId: string }
  | { kind: "element"; frameId: string; elementId: string }
  | { kind: "placement"; placementIds: readonly string[] }
  | null

export interface DeleteSelectionShortcutOptions {
  enabled: boolean
  selection: DeletableSelection
  /** Fabric-level fact, not React state — see `shouldCreateTextbox`'s doc
   *  comment on why this can't be folded into a DOM-focus check. Checked
   *  first, before even reading `selection`: `selection.kind` stays
   *  `"element"` continuously for the whole time a text element is being
   *  typed into, so without this guard every backspace keystroke fixing a
   *  typo would delete the element instead of one character. */
  isTextEditing: () => boolean
  removeFrame: (frameId: string) => void
  removeElement: (frameId: string, elementId: string) => void
  /** Deletes one or more pasteboard photographs outright, as a single
   *  undoable step (user-directed: "delete photos that are not on a page",
   *  then "I can't multi-select and delete" once shift-click multi-select
   *  turned out to only ever remove the last-clicked one) — see
   *  `removePlacements` in editor-store.ts for why this also drops the
   *  underlying `Asset`s. */
  removePlacements: (placementIds: readonly string[]) => void
}

/**
 * Backspace/Delete removes whatever is currently selected (user-directed):
 * the page itself when a frame is selected — same `removeFrame` action the
 * right-click menu's "Delete page" item calls — the element when an image or
 * text element is selected, via `removeElement` — or the photograph(s)
 * outright when one or more pasteboard placements are selected, via
 * `removePlacements`. Every path lands one undoable step, restorable via the
 * existing undo stack.
 *
 * Guarded by `isTypingTarget` for the obvious reason: Backspace is the most
 * common key there is in a text field, and must never delete anything just
 * because the sidebar's content textarea happens to have focus. Guarded by
 * `isTextEditing` for the same reason but at the canvas level — see that
 * option's doc comment.
 */
export function useDeleteSelectionShortcut({
  enabled,
  selection,
  isTextEditing,
  removeFrame,
  removeElement,
  removePlacements,
}: DeleteSelectionShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return
      if (isTypingTarget(event.target)) return
      if (isTextEditing()) return
      if (!selection) return

      event.preventDefault()
      if (selection.kind === "frame") {
        removeFrame(selection.frameId)
      } else if (selection.kind === "element") {
        removeElement(selection.frameId, selection.elementId)
      } else {
        removePlacements(selection.placementIds)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled, selection, isTextEditing, removeFrame, removeElement, removePlacements])
}
