"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Canvas, FabricImage, FabricObject, Textbox, TPointerEventInfo } from "fabric"
import {
  boundingBoxOf,
  frameAt,
  defaultFrameMargins,
  resolveTextSize,
  type Asset,
  type Box,
  type CanvasPlacement,
  type Frame,
} from "@loupe/core"

import {
  FRAME_DISPLAY_WIDTH,
  addPageAnchors,
  frameGridOriginY,
  layoutFrames,
  layoutSpreadBoxes,
  nearestFrameIndex,
  type AddPageAnchor,
  type FrameLayout,
  type SpreadBoxLayout,
} from "@/components/sequence/frame-grid"
import { BLEED_MM, DEFAULT_TEXT_COLOR } from "@/components/shell/inspector-panel"
import { editAtEnd, selectableTextboxClass } from "@/components/sequence/selectable-textbox"
import { isTypingTarget } from "@/components/sequence/use-canvas-shortcuts"
import { DEFAULT_TEXT_FONT, resolveTextFontFamily } from "@/lib/fonts"
import { thumbnailUrl } from "@/lib/storage/assets"

/** The transient pasteboard textbox's fill while it's sitting on the dark
 *  canvas, not yet committed to any frame. */
const PASTEBOARD_TEXT_FILL = "#f4f4f5"

/** The "add page before/after" buttons flanking a selected frame (direct
 *  follow-up: "primary button" treatment) — Tailwind's zinc-950, the same
 *  near-black the canvas surface itself briefly used before settling on
 *  zinc-900 (see globals.css's `--canvas`), reused here since a solid black
 *  is exactly the point for this one. `ADD_PAGE_BUTTON_HOVER_FILL` is one
 *  step up the same scale (zinc-900) rather than an opacity fade, the usual
 *  hover treatment for a solid-fill primary button. */
const ADD_PAGE_BUTTON_FILL = "#09090b"
const ADD_PAGE_BUTTON_HOVER_FILL = "#18181b"

/**
 * Canvas chrome sized in *screen* pixels, not scene units (issue #55). One
 * scene unit is one source-image pixel, so anything sized in scene units
 * shrinks with zoom — at the 6–10% people actually work at, a 48-unit
 * add-page button was a ~4px dot. `fitChromeToZoom` divides these back out
 * by the zoom on every render, the same decoupling `syncDotGrid` does for the
 * dot grid. The button stays at least 24px, a usable hit area.
 */
const ADD_PAGE_BUTTON_SIZE_PX = 28
const ADD_PAGE_BUTTON_GAP_PX = 12
/** The cover badge's glyph height on screen. Lucide's bookmark spans 18 of
 *  its 24-unit grid vertically, hence the `/ 18` where it's scaled; its
 *  notched bottom tapers to points, so it reads a few pixels shorter. */
const COVER_BADGE_HEIGHT_PX = 22
const COVER_BADGE_GAP_PX = 6

/**
 * The one selection color for everything selectable on the canvas — frames,
 * images, text (including while editing), the multi-select marquee — and the
 * frame-drag insertion indicator (issue #55; it used to be four unrelated
 * blues, and frames got Fabric's default near-white that vanished on a white
 * page). It's `--sidebar-primary`'s hue (globals.css, oklch(0.488 0.243
 * 264.376)) raised to lightness 0.6: oklch(0.6 0.2 264.376). That token
 * itself is too dark to read on the `--canvas` pasteboard (2.6:1), and one
 * color has to clear 3:1 against both the pasteboard (#18181b) and a white
 * page, which only a mid-luminance color can — this one is 4.3:1 and 4.1:1.
 * Fabric draws to a 2D context and can't read CSS custom properties, so it's
 * spelled out here.
 *
 * Kept clear of the print guides: the bleed is red, the margin guide is a
 * lighter, dashed sky blue (`syncPrintOverlay`).
 */
const SELECTION_COLOR = "#4176f6"
/** Fabric draws selection borders in screen space, so `borderScaleFactor` is
 *  the border's width in screen pixels at any zoom. */
const SELECTION_STYLE = {
  borderColor: SELECTION_COLOR,
  cornerColor: SELECTION_COLOR,
  borderScaleFactor: 2,
}
/**
 * Text adds `editingBorderColor`: `IText`'s editing machinery swaps
 * `borderColor` to `editingBorderColor` the moment editing starts and
 * restores it from a snapshot on exit (see Fabric's `ITextBehavior`), so a
 * freshly placed box — which enters editing immediately, per `armTextTool` —
 * would otherwise show Fabric's own near-invisible default the whole time
 * it's actually being typed into, the exact moment this needs to be visible
 * most.
 */
const TEXT_SELECTION_STYLE = { ...SELECTION_STYLE, editingBorderColor: SELECTION_COLOR }

/** Width a plain click (not a click-and-drag) gives a new text box —
 *  dragging instead sizes it explicitly, see `armTextTool`. */
const DEFAULT_TEXTBOX_WIDTH = 320

/** Screen pixels of pointer movement, converted to the canvas's own scene
 *  units by the current zoom, below which a text-placement gesture counts as
 *  a click rather than a drag. Fixed in screen space rather than scene space
 *  so the same gesture (a few pixels of unintentional hand tremor) reads the
 *  same at any zoom level, instead of a deep zoom-out turning ordinary clicks
 *  into accidental drags. */
const TEXT_PLACEMENT_CLICK_THRESHOLD_PX = 6

/** Real-world millimetres per point (1pt = 1/72in, 1in = 25.4mm). */
const MM_PER_PT = 25.4 / 72

/**
 * Scene units per point of type, for one frame. A frame always renders at
 * `FRAME_DISPLAY_WIDTH` scene units wide regardless of its real millimetre
 * page size (`frameRectAt` in frame-grid.ts) — an A4 frame and an A5 frame
 * both draw 1200 units wide, just at different real-world scales — so
 * converting a role's point size (`sizeForRole`, itself derived from the
 * project's `typeBaseSize`/`typeRatio`) into scene units has to go through
 * *this* frame's own mm-to-unit ratio, not a fixed constant.
 */
function sceneUnitsPerPt(pageWidthMm: number): number {
  return (FRAME_DISPLAY_WIDTH / pageWidthMm) * MM_PER_PT
}

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 8

/** Padding around the arrangement when fitting it to the viewport. */
const FIT_PADDING = 80

/**
 * The dot grid's tile size in `.canvas-dot-grid` (globals.css) — fixed in
 * screen pixels, deliberately not scaled by zoom (direct follow-up,
 * user-directed: "I don't want the density to necessarily change"). It
 * used to be — see `syncDotGrid` below — which meant the tile shrank to a
 * sub-pixel size at the low end of the zoom range (`MIN_ZOOM` is 0.05, so
 * 24px became ~1px), and a 1px radial-gradient dot rendered at a ~1px tile
 * just antialiases into a flat tint instead of visible dots — the reported
 * "canvas turns charcoal blue-gray when zoomed way out" bug. 32 (up from
 * 24) reads as the "fair amount of space between dots" asked for.
 */
const DOT_GRID_SIZE = 32

/**
 * A Fabric object carrying the placement it represents.
 *
 * `naturalScale` is the thumbnail-to-original ratio baked into the object's
 * `scaleX`/`scaleY` so the photograph draws at its natural size. It has to be
 * divided back out when reading a placement's scale, or every drag would
 * persist the rendering factor as user intent and compound it.
 */
type PlacedObject = FabricObject & { placementId?: string; naturalScale?: number }

/**
 * A Fabric object standing in for a Frame (a page-in-progress) on the
 * pasteboard. Distinct from `PlacedObject` — a frame has no asset behind it
 * and no natural-scale correction — but drawn on the same canvas, so drag
 * handling has to tell the two apart at the event-handler level.
 */
type PlacedFrame = FabricObject & { frameId: string }

/**
 * A Fabric object standing in for one of a frame's own elements (an image or
 * text already inside a frame — distinct from a pasteboard photograph or a
 * fresh `T`-created textbox, which have no `frameId`/`elementId` at all).
 * Both `frameId` and `elementId` are needed: the element alone can't say
 * which frame's normalized `Box` it's positioned against.
 */
type PlacedElement = FabricObject & { frameId: string; elementId: string; elementKind: "image" | "text" }

/**
 * Chrome drawn at a fixed screen size (the add-page buttons, the cover
 * badge). `x`/`y` is the scene point it hangs off — a frame edge — and
 * `offsetX`/`offsetY` its distance from there in screen pixels; `scale` is
 * the object's own scale at 100% zoom.
 */
type ScreenChrome = FabricObject & {
  screenAnchor: { x: number; y: number; offsetX: number; offsetY: number; scale: number }
}

/** Re-sizes and re-positions one piece of `ScreenChrome` for `zoom`.
 *  `setCoords` keeps hover/click hit-testing on what's drawn. */
function fitChromeToZoom(object: ScreenChrome, zoom: number) {
  const { x, y, offsetX, offsetY, scale } = object.screenAnchor
  object.set({
    left: x + offsetX / zoom,
    top: y + offsetY / zoom,
    scaleX: scale / zoom,
    scaleY: scale / zoom,
  })
  object.setCoords()
}

/** Snaps a frame onto its grid slot. Tweens with ease-in-out (it is already
 *  on screen, moving), unless the user asked for reduced motion: then it
 *  lands there in one render. Read at tween time, not once on mount, so
 *  changing the OS setting takes effect without a reload. */
function snapFrameTo(
  fabric: typeof import("fabric"),
  object: FabricObject,
  to: { left: number; top: number },
  duration: number,
  render: () => void,
) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    object.set(to)
    object.setCoords()
    render()
    return
  }
  object.animate(to, { duration, easing: fabric.util.ease.easeInOutQuad, onChange: render })
}

export interface CanvasControls {
  zoom: number
  ready: boolean
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  fitToView: () => void
}

interface Options {
  placements: readonly CanvasPlacement[]
  assets: readonly Asset[]
  frames: readonly Frame[]
  /** The project's type scale (R13's Book-level settings) — threaded through
   *  so a frame text element's rendered `fontSize` can be derived from its
   *  `role` via `sizeForRole`, the same computation the sidebar's read-only
   *  "Size" row already shows. Without these, the canvas has no way to know
   *  what "10pt" means in scene units. */
  typeBaseSize: number
  typeRatio: number
  onMove: (placementId: string, x: number, y: number) => void
  onScale: (placementId: string, scale: number) => void
  onContextMenu: (placementId: string, viewportX: number, viewportY: number) => void
  /** Right-click on an image already inside a frame — opens the fixed
   *  layout-preset menu (full-bleed / centered / left-half). */
  onImageContextMenu: (frameId: string, elementId: string, viewportX: number, viewportY: number) => void
  /** Right-click on a frame's own background (the white page, nothing inside
   *  it hit) — opens the frame-level menu ("set as cover"). */
  onFrameContextMenu: (frameId: string, viewportX: number, viewportY: number) => void
  /** One of the low-opacity "add a paired page" buttons beside the selected
   *  frame was clicked — a new blank page goes directly before/after it. */
  onAddPage: (frameId: string, side: "before" | "after") => void
  /** Right-click on genuinely empty pasteboard — nothing under the pointer
   *  at all, not a photograph, frame, or element. Opens a menu with "Add new
   *  page". */
  onEmptyCanvasContextMenu: (viewportX: number, viewportY: number) => void
  /** A frame was dragged and dropped near a different slot in the grid.
   *  `from`/`to` are array indices, matching `reorderFrame`'s signature. */
  onReorderFrame: (from: number, to: number) => void
  /** A pasteboard photograph was dragged and dropped onto a frame's bounds —
   *  it joins that frame's elements and leaves the pasteboard. */
  onDropOnFrame: (placementId: string, frameId: string) => void
  /**
   * Creates a text element on a frame — called either immediately by
   * `placeTextbox` when the text tool's click/drag lands on a frame (the
   * common case), or by `text:editing:exited` when a pasteboard textbox that
   * started on empty canvas finishes editing while its center sat over a
   * frame's bounds. See that handler for what happens when it doesn't.
   * `box` is the element's normalized position/size within the frame,
   * derived from wherever the user actually clicked/dragged — omitted falls
   * back to the full-bleed default. Returns the new element's id.
   */
  onCreateText: (frameId: string, content: string, box?: Box) => string
  /**
   * The active Fabric object changed to (or away from) a frame — drives the
   * contextual sidebar (U7). `null` when nothing selected is a frame: a
   * pasteboard photograph, or nothing at all, both clear the frame selection
   * the same way, since neither has a sidebar variant of its own yet.
   */
  onSelectFrame: (frameId: string | null) => void
  /** An image or text element already inside a frame was selected on canvas —
   *  the frame-content counterpart to `onSelectFrame`. */
  onSelectElement: (frameId: string, elementId: string) => void
  /**
   * The active Fabric object(s) changed to (or away from) pasteboard
   * photographs — `PlacedObject`s with no `frameId`. Distinct from
   * `onSelectFrame`/`onSelectElement`: a pasteboard placement has no
   * sidebar variant of its own (selecting one still clears the frame
   * selection via `onSelectFrame(null)`, same as before), but the caller
   * still needs to know *which* placement(s) are active so Backspace/Delete
   * can remove them (`useDeleteSelectionShortcut`'s `"placement"` case).
   *
   * An array, not a single id — shift-clicking several pasteboard
   * photographs makes Fabric's own multi-select create an `ActiveSelection`
   * wrapping all of them, which has no `placementId` of its own (only each
   * individual object inside it does). Reporting every id in that
   * selection, not just a single one, is what makes "shift-select several
   * photographs, then Backspace" delete all of them at once instead of
   * only ever the most recently clicked one.
   */
  onSelectPlacement: (placementIds: string[]) => void
  /** A frame element was dragged and/or resized; `patch` is its new
   *  normalized `Box`, computed from the object's on-canvas position/size
   *  against the frame's current bounds. */
  onUpdateElementBox: (frameId: string, elementId: string, patch: Partial<Box>) => void
  /** An element already inside a frame was dragged across onto a
   *  *different* frame's bounds — reassigns it there. `box` is the new
   *  normalized Box, computed against the destination frame's bounds (see
   *  `onUpdateElementBox`'s doc comment for why that distinction matters:
   *  without this, the element visually moved but stayed structurally on
   *  its original page). */
  onMoveElementToFrame: (fromFrameId: string, toFrameId: string, elementId: string, box: Box) => void
  /** An already-placed text element finished an in-place edit (double-click
   *  to re-enter, then blur/Escape/click-away to exit — Fabric's own
   *  triggers). Distinct from `onCreateText`, which is for a brand-new
   *  pasteboard textbox landing on a frame for the first time. */
  onUpdateTextContent: (frameId: string, elementId: string, content: string) => void
  /** Removes an element outright — used when a text element (freshly placed
   *  directly on a frame, or an existing one cleared out during a re-edit)
   *  finishes editing with empty content, so it doesn't linger as an
   *  invisible full-bleed element nobody can see to delete. */
  onRemoveElement: (frameId: string, elementId: string) => void
}

/** A Fabric `Textbox` created via the `T` shortcut, mid- or post-edit. There
 *  is no store-backed pasteboard-text state to diff against — unlike
 *  `PlacedObject`/`PlacedFrame` — so this is a structural marker only, not a
 *  map key. */
type PlacedTextbox = FabricObject & { isEditing?: boolean; text?: string }

/**
 * Owns the Fabric.js lifecycle for the light table.
 *
 * Fabric touches `document` at module scope, so it is imported dynamically
 * inside an effect — a static import breaks Next's server render.
 *
 * Position flows one way while mounted: canvas events write to the store, and
 * the store does not push positions back. Two-way binding here would fight the
 * user mid-drag, since every pointer move would round-trip through React.
 */
export function useFabricCanvas(options: Options) {
  const {
    placements,
    assets,
    frames,
    typeBaseSize,
    typeRatio,
    onMove,
    onScale,
    onContextMenu,
    onImageContextMenu,
    onFrameContextMenu,
    onAddPage,
    onEmptyCanvasContextMenu,
    onReorderFrame,
    onDropOnFrame,
    onCreateText,
    onSelectFrame,
    onSelectElement,
    onSelectPlacement,
    onUpdateElementBox,
    onMoveElementToFrame,
    onUpdateTextContent,
    onRemoveElement,
  } = options

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const objectsRef = useRef(new Map<string, PlacedObject>())
  const framesRef = useRef(new Map<string, PlacedFrame>())
  const elementsRef = useRef(new Map<string, PlacedElement>())
  /** Per-frame bleed/margin print guides — the same reference the Book
   *  overview draws (`PrintOverlay` in canvas-region.tsx), kept as Fabric
   *  objects here so they pan/zoom/reflow with the frame instead of a DOM
   *  overlay that would have to be repositioned by hand. */
  const overlaysRef = useRef(new Map<string, { bleed: FabricObject; margin: FabricObject }>())
  /** The persistent "cover" badge shown pinned above a frame's top-left
   *  corner while `Frame.isCover` is set — one per cover frame, a Figma
   *  dev-mode-style tag that just sits there rather than needing a click to
   *  reveal. */
  const coverBadgesRef = useRef(new Map<string, ScreenChrome>())
  /** One solid rect behind each spread's two frames — visually separates a
   *  pair of facing pages from the rest of the canvas (user-directed), same
   *  gray/border tokens as the rest of the app's surfaces, no shadow. Keyed
   *  by the spread's left frame id (`layoutSpreadBoxes`), which is what
   *  makes it stable across reorders — a spread is always identified by
   *  whichever frame currently occupies its left half. */
  const spreadBoxesRef = useRef(new Map<string, FabricObject>())
  /** The "add a paired page" buttons beside the *selected* frame only —
   *  there is never more than one pair on screen at a time. */
  const pageButtonsRef = useRef<{ left: ScreenChrome; right: ScreenChrome; frameId: string } | null>(null)
  /** Set by the create-canvas effect to the real `syncAddPageButtons`, so
   *  `syncFrames` (a separate `useCallback`, run on every frame-list change)
   *  can reposition an already-open button pair when the selected frame's
   *  layout shifts — e.g. right after one of the buttons themselves inserts
   *  a page — without both being defined in the same closure. */
  const syncAddPageButtonsRef = useRef<(frameId: string | null) => void>(() => undefined)
  /** Whether the text tool is armed (`T` pressed, or the Add text button
   *  clicked) and waiting for the click/drag that decides where the new text
   *  box lands — see `armTextTool`'s doc comment. Read from the `mouse:down`/
   *  `mouse:up` handlers below, which is why this is a ref rather than React
   *  state: those fire well outside React's render cycle. */
  const placingTextRef = useRef(false)
  /** Scene point captured on `mouse:down` while `placingTextRef` is armed —
   *  `null` whenever a placement gesture isn't currently in progress. Compared
   *  against the `mouse:up` point to tell a plain click (place a
   *  default-width box there) from a click-and-drag (size the box to the
   *  drag). */
  const textPlacementStartRef = useRef<{ x: number; y: number } | null>(null)

  /** Keep a frame's print guides drawn above its own contents — called after
   *  `syncFrameElements` adds a new image/text object, since those are added
   *  after the guides exist and Fabric draws in add order. */
  const bringOverlayToFront = useCallback((canvas: Canvas, frameId: string) => {
    const overlay = overlaysRef.current.get(frameId)
    if (!overlay) return
    canvas.bringObjectToFront(overlay.bleed)
    canvas.bringObjectToFront(overlay.margin)
  }, [])
  /** Element ids currently loading (image elements await a thumbnail URL) —
   *  same overlapping-sync guard `pendingRef` gives placements. */
  const elementsPendingRef = useRef(new Set<string>())
  /** The dashed highlight shown over the slot a dragged frame would land in.
   *  At most one exists at a time; `null` when no frame drag is in progress. */
  const indicatorRef = useRef<FabricObject | null>(null)
  /** Placements whose image is loading. Reserved synchronously so a second
   *  overlapping sync pass cannot start drawing the same one. */
  const pendingRef = useRef(new Set<string>())
  /**
   * The object genuinely mid-gesture right now, if any — set on
   * `object:moving`, cleared on `mouse:up`. `syncFrames`/`syncFrameElements`
   * use this (not `canvas.getActiveObject()`) to decide whether to skip
   * repositioning an object: a selected-but-idle frame or element must still
   * pick up a programmatic move (a completed reorder snapping into its grid
   * slot, an image preset repositioning it) the instant the store updates —
   * only an object the pointer is *currently* dragging should be left alone,
   * or a frame drop and a preset-menu click would both silently no-op
   * whenever their target happened to still be selected.
   */
  const draggingRef = useRef<FabricObject | null>(null)

  /**
   * Suppresses the `selection:cleared` handler below while a photo or text
   * box is mid-commit into a frame (dropped, or finished editing over one).
   * Both paths swap out the pasteboard Fabric object for a new frame-owned
   * one, and `canvas.remove()` on an object still wired into the active
   * selection fires its own `selection:cleared` — without this, that
   * teardown-of-the-old-object noise reads as a genuine user deselection and
   * clobbers the very "this is now selected" store write the commit is
   * trying to make (`onCreateText`, `onDropOnFrame` -> `moveToFrame`), right
   * back to book-level settings, undoing the whole point of the commit.
   * Set true right before the object that's about to be swapped away is
   * removed, and cleared once the swap is fully resolved — synchronously for
   * a text box (`text:editing:exited` removes it immediately), across a
   * render cycle for a photo (`syncObjects` removes the old placement object
   * later, once the store reflects it joined a frame).
   */
  const suppressSelectionClearRef = useRef(false)

  /** The id of a `TextElement` `placeTextbox` just created directly on a
   *  frame (empty content, not yet rendered) — checked by `syncFrameElements`
   *  when it creates that element's Fabric object for the first time, so it
   *  can call `.enterEditing()` on it immediately. `placeTextbox` has no
   *  Fabric object to call that on itself: the element only exists in the
   *  store at that point, one render behind. Cleared the moment it's
   *  consumed, so a later, unrelated element landing with this same id
   *  never re-triggers editing. */
  const pendingAutoEditElementIdRef = useRef<string | null>(null)

  const [zoom, setZoom] = useState(1)
  const [ready, setReady] = useState(false)

  // Handlers and current data are read through refs so the Fabric listeners can
  // be bound once — rebinding them on every render would tear down the canvas
  // mid-gesture. Written in an effect rather than during render, which React
  // Compiler correctly rejects.
  const handlers = useRef({
    onMove,
    onScale,
    onContextMenu,
    onImageContextMenu,
    onFrameContextMenu,
    onAddPage,
    onEmptyCanvasContextMenu,
    onReorderFrame,
    onDropOnFrame,
    onCreateText,
    onSelectFrame,
    onSelectElement,
    onSelectPlacement,
    onUpdateElementBox,
    onMoveElementToFrame,
    onUpdateTextContent,
    onRemoveElement,
  })
  const latest = useRef({ placements, assets, frames, typeBaseSize, typeRatio })

  /** Set once `fitToView` is defined below; read by the first-frame effect so
   *  that effect does not depend on the callback's identity. */
  const fitToViewRef = useRef<() => void>(() => undefined)

  /* ---------------------------------------------------------------- */
  /* Create and dispose                                                */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    handlers.current = {
      onMove,
      onScale,
      onContextMenu,
      onImageContextMenu,
      onFrameContextMenu,
      onAddPage,
      onEmptyCanvasContextMenu,
      onReorderFrame,
      onDropOnFrame,
      onCreateText,
      onSelectFrame,
      onSelectElement,
      onSelectPlacement,
      onUpdateElementBox,
      onMoveElementToFrame,
      onUpdateTextContent,
      onRemoveElement,
    }
    latest.current = { placements, assets, frames, typeBaseSize, typeRatio }
  })

  useEffect(() => {
    let disposed = false
    let canvas: Canvas | null = null

    /** Cancels an in-progress text placement (Escape, right-click, or the
     *  gesture completing) without creating anything, and restores normal
     *  canvas interaction. Declared here (outside the async IIFE below) so
     *  both the mouse handlers inside it and the Escape listener below —
     *  which needs to exist, and get cleaned up, independent of whether the
     *  Fabric module has finished loading — can reach it. */
    function disarmTextPlacement() {
      placingTextRef.current = false
      textPlacementStartRef.current = null
      const target_canvas = canvasRef.current
      if (!target_canvas) return
      target_canvas.selection = true
      target_canvas.skipTargetFind = false
      target_canvas.defaultCursor = "default"
      target_canvas.hoverCursor = "move"
      target_canvas.requestRenderAll()
    }

    /* Escape cancels an armed text placement without creating anything — the
       same "changed my mind" escape hatch a right-click gives it in the
       mouse:down handler below. Window-level (not a Fabric canvas event)
       since the tool can be armed with focus anywhere.

       Otherwise Escape deselects whatever the canvas has selected, but only
       when focus is on the canvas or nowhere in particular, so closing a
       dialog or popover with Escape leaves the selection alone. Leaving a
       text box's editing is Fabric's own Escape on its hidden textarea, a
       typing target here, so the box stays selected; only a second Escape
       deselects.

       Enter on a selected text box starts editing with the caret at the end
       (issue #20), under the same focus rule, so Enter in a field, dialog or
       popover keeps its own meaning. While editing, Enter belongs to Fabric's
       textarea and stays a newline. */
    const onCanvasKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Enter") return
      if (event.key === "Escape" && placingTextRef.current) {
        disarmTextPlacement()
        return
      }
      const target_canvas = canvasRef.current
      const focus = event.target
      const onCanvas = focus instanceof Node && Boolean(target_canvas?.wrapperEl.contains(focus))
      if (isTypingTarget(focus) || (focus !== document.body && !onCanvas)) return
      const active = target_canvas?.getActiveObject() as PlacedTextbox | undefined
      if (!target_canvas || !active || active.isEditing) return
      if (event.key === "Enter") {
        if (!("enterEditing" in active)) return
        // Cancelled, or Chrome delivers the Enter itself to the textarea
        // that just took focus and the text gains a newline.
        event.preventDefault()
        editAtEnd(active as unknown as Textbox)
      } else {
        target_canvas.discardActiveObject()
      }
      target_canvas.requestRenderAll()
    }
    window.addEventListener("keydown", onCanvasKey)

    /**
     * Holding Space shows the familiar "hand tool" grab cursor and lets a
     * plain left-drag pan the canvas — not just the existing empty-canvas/
     * middle-drag pan below. `skipTargetFind` (the same flag armed text
     * placement above uses to make clicks pass straight through to empty
     * canvas) is what actually makes this work: with it on, every object
     * stops being hit-testable, so the `mouse:down` pan trigger's existing
     * `!opt.target` check fires for a click anywhere, and Fabric's own
     * object-selection/drag never engages to fight over the same drag.
     * `spacePressed` (declared here, read by `mouse:down`/`mouse:up` inside
     * the async IIFE below via closure) is only what decides whether the
     * *drag* cursor reads "grabbing" instead of "grab" — the pan itself
     * doesn't need it once `skipTargetFind` is on.
     *
     * Guarded against typing targets and an actively-edited text box (Space
     * has to type a literal space there, not arm panning) and against an
     * armed text placement (which already owns `skipTargetFind` for its own
     * reason — space released mid-placement must not clear it out from
     * under that gesture).
     */
    let spacePressed = false

    /**
     * Fabric only re-applies `defaultCursor`/`hoverCursor` to the DOM
     * lazily, the next time it processes a `mouse:move` — a plain click
     * with no drag movement in between never fires one, so setting just
     * the properties left the cursor visibly stuck on whatever it showed
     * before (reported directly: "hand is appearing but not changing state
     * when clicking"). Setting `upperCanvasEl.style.cursor` directly makes
     * every change here take effect immediately regardless of whether the
     * pointer moves; the properties are still set too; so Fabric's own
     * future cursor recalculations (its next real `mouse:move`) don't
     * revert this to a stale value.
     */
    function setPanCursor(canvas: Canvas, cursor: string) {
      canvas.defaultCursor = cursor
      canvas.hoverCursor = cursor
      canvas.upperCanvasEl.style.cursor = cursor
    }

    const onSpaceKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || spacePressed) return
      if (isTypingTarget(event.target)) return
      if (placingTextRef.current) return
      const target_canvas = canvasRef.current
      if (!target_canvas) return
      const active = target_canvas.getActiveObject() as PlacedTextbox | undefined
      if (active?.isEditing) return

      event.preventDefault() // Space's browser default is to scroll the page.
      spacePressed = true
      target_canvas.skipTargetFind = true
      setPanCursor(target_canvas, "grab")
      target_canvas.requestRenderAll()
    }

    const onSpaceKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !spacePressed) return
      spacePressed = false
      const target_canvas = canvasRef.current
      if (!target_canvas) return
      target_canvas.skipTargetFind = false
      target_canvas.defaultCursor = "default"
      target_canvas.hoverCursor = "move"
      target_canvas.upperCanvasEl.style.cursor = "default"
      target_canvas.requestRenderAll()
    }

    window.addEventListener("keydown", onSpaceKeyDown)
    window.addEventListener("keyup", onSpaceKeyUp)

    void (async () => {
      const fabric = await import("fabric")
      if (disposed || !canvasElementRef.current) return

      canvas = new fabric.Canvas(canvasElementRef.current, {
        backgroundColor: "transparent",
        selection: true,
        preserveObjectStacking: true,
        // v7 defaults these to true, but U7's context menu depends on them
        // entirely — set explicitly rather than relying on a default.
        fireRightClick: true,
        stopContextMenu: true,
        fireMiddleClick: true,
        // A placement stores a single `scale`, so corner drags must stay
        // proportional. `uniScaleKey` is the modifier that inverts this;
        // clearing it removes the escape hatch into non-uniform scaling.
        uniformScaling: true,
        uniScaleKey: null,
        // The drag-to-select marquee, in the same selection color — the
        // fill is `SELECTION_COLOR` at 12%.
        selectionBorderColor: SELECTION_COLOR,
        selectionColor: "rgba(65, 118, 246, 0.12)",
      })

      canvasRef.current = canvas

      // Verifiers read selection and editing state off the live canvas
      // (scripts/verify/text-selection.mjs); handles and the caret are only
      // pixels otherwise. `LOUPE_TEST_HOOKS` is inlined at build time
      // (next.config.ts), so an ordinary build compiles this out.
      if (process.env.LOUPE_TEST_HOOKS === "1") {
        ;(window as unknown as { __loupeCanvas?: Canvas }).__loupeCanvas = canvas
      }

      /**
       * Keeps the dot-grid background (`.canvas-dot-grid` on `containerRef`)
       * panning with the canvas's content — `background-position` takes
       * `panX`/`panY` straight from Fabric's `viewportTransform` (`[zoomX,
       * 0, 0, zoomY, panX, panY]` for the pan/zoom this canvas actually
       * does; those two entries are already a screen-pixel translation, not
       * a world-unit one, so no further conversion is needed), so the dots
       * stay visually anchored to the canvas as it's dragged.
       *
       * `background-size` deliberately does *not* read `zoomX`/`zoomY`
       * (direct follow-up, user-directed — was `DOT_GRID_SIZE * zoomX`):
       * scaling the tile with zoom meant it shrank to a sub-pixel size at
       * the low end of `MIN_ZOOM` (24 * 0.05 ≈ 1px), and a 1px
       * radial-gradient dot rendered at a ~1px tile just antialiases into a
       * flat tint — the reported "canvas turns charcoal blue-gray when
       * zoomed way out" bug — and ballooned to a sparse ~190px tile at
       * `MAX_ZOOM`, reading as the spacing "changing" while zooming.
       * `DOT_GRID_SIZE` alone, fixed, keeps the dot density constant on
       * screen at every zoom level.
       */
      function syncDotGrid() {
        const container = containerRef.current
        const target = canvasRef.current
        if (!container || !target) return

        const [, , , , panX, panY] = target.viewportTransform
        container.style.backgroundSize = `${DOT_GRID_SIZE}px ${DOT_GRID_SIZE}px`
        container.style.backgroundPosition = `${panX}px ${panY}px`
      }
      canvas.on("after:render", syncDotGrid)
      syncDotGrid()

      // Every pan/zoom path (wheel, the zoom buttons, fit, image cycling)
      // ends in a render, so fitting the screen-sized chrome here covers
      // them all without each one having to remember to. A handful of
      // objects, so doing it every render costs nothing worth guarding.
      canvas.on("before:render", () => {
        const target = canvasRef.current
        if (!target) return
        const zoom = target.getZoom()
        const buttons = pageButtonsRef.current
        if (buttons) {
          fitChromeToZoom(buttons.left, zoom)
          fitChromeToZoom(buttons.right, zoom)
        }
        for (const badge of coverBadgesRef.current.values()) fitChromeToZoom(badge, zoom)
      })

      /**
       * The insertion-point indicator shown while a frame is being dragged:
       * a dashed highlight over the slot the frame would land in if dropped
       * now. Chosen over a thin line between slots because a highlighted
       * rect reads unambiguously as "this slot" at a glance, whereas a line
       * at a boundary is easy to misread as belonging to either neighbor.
       * `SELECTION_COLOR`, at a stroke width fixed in screen pixels
       * (`strokeUniform`) so it doesn't thin to nothing when zoomed out.
       */
      function showInsertionIndicator(target: FrameLayout) {
        const target_canvas = canvasRef.current
        if (!target_canvas) return

        const centerX = target.bounds.x + target.bounds.width / 2
        const centerY = target.bounds.y + target.bounds.height / 2

        if (!indicatorRef.current) {
          const indicator = new fabric.Rect({
            left: centerX,
            top: centerY,
            width: target.bounds.width,
            height: target.bounds.height,
            originX: "center",
            originY: "center",
            fill: "transparent",
            stroke: SELECTION_COLOR,
            strokeWidth: 3,
            strokeUniform: true,
            strokeDashArray: [10, 6],
            selectable: false,
            evented: false,
            excludeFromExport: true,
          })
          indicatorRef.current = indicator
          target_canvas.add(indicator)
        } else {
          indicatorRef.current.set({
            left: centerX,
            top: centerY,
            width: target.bounds.width,
            height: target.bounds.height,
          })
        }

        target_canvas.bringObjectToFront(indicatorRef.current)
        target_canvas.requestRenderAll()
      }

      function clearInsertionIndicator() {
        const target_canvas = canvasRef.current
        if (indicatorRef.current && target_canvas) {
          target_canvas.remove(indicatorRef.current)
        }
        indicatorRef.current = null
        target_canvas?.requestRenderAll()
      }

      /**
       * Places a new text box (user-directed, see `armTextTool`'s doc
       * comment for why this is a separate step from arming the tool).
       *
       * Landing on a frame commits it as a real `TextElement` immediately,
       * with empty content — not deferred until editing ends. Per direct
       * user feedback: the sidebar showing nothing for a text box that's
       * plainly sitting there, selected, being typed into, read as the same
       * "did this even work?" confusion the click-to-place rework was
       * supposed to fix, just moved one step later. `syncFrameElements`
       * renders the committed element on its next pass; `pendingAutoEditElementIdRef`
       * (checked there) is how this function reaches into that later,
       * separate render to enter editing on *that* object once it exists —
       * there's nothing to call `.enterEditing()` on yet at this point, only
       * a store write.
       *
       * A click that misses every frame keeps the old deferred-commit
       * behavior (U6's documented judgment call for "text created off any
       * frame"): a loose, unsaved Fabric object, hit-tested again in
       * `text:editing:exited` once editing ends, since there's no frame to
       * commit into yet and the sidebar has nothing coherent to show for a
       * pasteboard doodle outside the book model.
       */
      function placeTextbox(center: { x: number; y: number }, width: number) {
        const target_canvas = canvasRef.current
        if (!target_canvas) return

        const { frames: currentFrames, placements, assets: pool } = latest.current
        const originY = frameGridOriginY(placements, pool)
        const layouts = layoutFrames(currentFrames, originY)
        const hitFrameId = frameAt(layouts, center)

        if (hitFrameId) {
          const layout = layouts.find((l) => l.frameId === hitFrameId)
          // Wherever the user actually clicked/dragged, converted to the
          // frame's normalized coordinates — not the full-bleed default
          // `createTextElement` falls back to when this is omitted. Per
          // direct user feedback: a box that always snapped to the top-left
          // of the page regardless of where you clicked read as broken,
          // once committing-on-click (rather than on edit-exit) made that
          // snap instant instead of a barely-noticed jump after the fact.
          // Height is nominal — Fabric grows a Textbox's rendered height
          // from its content regardless of the stored Box, so there's
          // nothing for this value to visibly get right or wrong.
          const box = layout
            ? {
                x: clamp01((center.x - width / 2 - layout.bounds.x) / layout.bounds.width),
                y: clamp01((center.y - layout.bounds.y) / layout.bounds.height),
                width: clamp01(width / layout.bounds.width),
                height: 0.08,
              }
            : undefined
          pendingAutoEditElementIdRef.current = handlers.current.onCreateText(hitFrameId, "", box)
          return
        }

        const Textbox = selectableTextboxClass(fabric)
        const textbox = new Textbox("", {
          left: center.x,
          top: center.y,
          originX: "center",
          originY: "center",
          width,
          fontSize: 32,
          fontFamily: resolveTextFontFamily(DEFAULT_TEXT_FONT),
          fill: PASTEBOARD_TEXT_FILL,
          textAlign: "left",
          ...TEXT_SELECTION_STYLE,
        })

        target_canvas.add(textbox)
        target_canvas.setActiveObject(textbox)
        textbox.enterEditing()
        target_canvas.requestRenderAll()
      }

      /* Zoom: keep the point under the cursor fixed. */
      canvas.on("mouse:wheel", (opt: TPointerEventInfo<WheelEvent>) => {
        const target = canvasRef.current
        if (!target) return

        const next = clampZoom(target.getZoom() * 0.999 ** opt.e.deltaY)
        target.zoomToPoint(opt.viewportPoint, next)
        target.requestRenderAll()
        setZoom(next)

        opt.e.preventDefault()
        opt.e.stopPropagation()
      })

      /* Pan: drag empty canvas, or middle-drag anywhere. */
      let panning = false
      let panFrom = { x: 0, y: 0 }

      canvas.on("mouse:down", (opt) => {
        const target = canvasRef.current
        if (!target) return

        const event = opt.e as MouseEvent
        const isMiddle = event.button === 1
        const isRight = event.button === 2

        // The text tool is armed (`T`, or the Add text button) and waiting
        // for the click/drag that places it — this click is that gesture,
        // not a normal selection/pan/context-menu click, so it's handled
        // entirely here and never falls through to the logic below.
        // Right-click cancels instead of placing, the same "changed my mind"
        // escape hatch Escape gives it elsewhere.
        if (placingTextRef.current) {
          if (isRight) {
            disarmTextPlacement()
          } else {
            textPlacementStartRef.current = { x: opt.scenePoint.x, y: opt.scenePoint.y }
          }
          return
        }

        if (isRight) {
          const placed = opt.target as (PlacedObject & Partial<PlacedElement>) | undefined

          if (placed?.elementId && placed.frameId && placed.elementKind === "image") {
            handlers.current.onImageContextMenu(
              placed.frameId,
              placed.elementId,
              opt.viewportPoint.x,
              opt.viewportPoint.y,
            )
            return
          }

          if (placed?.placementId) {
            handlers.current.onContextMenu(
              placed.placementId,
              opt.viewportPoint.x,
              opt.viewportPoint.y,
            )
            return
          }

          // The frame's own background rect — no elementId, no placementId,
          // just a frameId. Right-click here opens the frame-level menu
          // (currently just "set as cover").
          if (placed?.frameId) {
            handlers.current.onFrameContextMenu(placed.frameId, opt.viewportPoint.x, opt.viewportPoint.y)
            return
          }

          // Genuinely empty pasteboard — nothing under the pointer at all.
          if (!placed) {
            handlers.current.onEmptyCanvasContextMenu(opt.viewportPoint.x, opt.viewportPoint.y)
          }
          return
        }

        const addPageButton = opt.target as (FabricObject & { isAddPageButton?: boolean; frameId?: string; side?: "before" | "after" }) | undefined
        if (addPageButton?.isAddPageButton && addPageButton.frameId && addPageButton.side) {
          handlers.current.onAddPage(addPageButton.frameId, addPageButton.side)
          return
        }

        if (isMiddle || !opt.target) {
          panning = true
          target.selection = false
          panFrom = { x: event.clientX, y: event.clientY }
          // Space-held pan gets the "actively grabbing" cursor for the
          // duration of the drag — `spacePressed` is `true` here exactly
          // when this pan trigger fired because `skipTargetFind` made
          // `opt.target` empty, not because the canvas was genuinely empty.
          if (spacePressed) setPanCursor(target, "grabbing")
        }
      })

      /**
       * Drive the contextual sidebar (U7) off Fabric's own selection state
       * rather than tracking it separately — `getActiveObject` after any
       * selection change is the single source of truth for "what's active
       * right now", the same way `isTextEditing` reads `isEditing` directly
       * instead of mirroring it into React state.
       *
       * Only frames carry a sidebar variant today: pasteboard photographs
       * (`PlacedObject`) and pasteboard-only text boxes (`PlacedTextbox`,
       * U6) have no `frameId`, so selecting one clears the frame selection
       * the same way clicking empty canvas does.
       */
      /**
       * The two "add a paired page" buttons beside a selected frame —
       * user-directed, shown only while that frame (not one of its elements)
       * is the active object. Positioned at the row's vertical midpoint —
       * "center the buttons horizontally at half of the A5 [page] size" — on
       * the outside of its left/right edges: a solo frame's own, or the
       * whole spread's for either half of one (#72, see `addPageAnchors`),
       * so no button sits in the gutter. Rebuilt from scratch on every
       * call rather than diffed in place: the pair only exists for whichever
       * frame is currently selected, so there's no ongoing per-frame state
       * worth preserving across a resync the way `syncFrames`/`syncPrintOverlay`
       * diff-and-update for every frame, every render.
       */
      function clearAddPageButtons() {
        const target_canvas = canvasRef.current
        const existing = pageButtonsRef.current
        if (existing && target_canvas) target_canvas.remove(existing.left, existing.right)
        pageButtonsRef.current = null
      }

      function syncAddPageButtons(frameId: string | null) {
        clearAddPageButtons()
        const target_canvas = canvasRef.current
        if (!frameId || !target_canvas) return

        const { frames: currentFrames, placements: currentPlacements, assets: pool } = latest.current
        const originY = frameGridOriginY(currentPlacements, pool)
        const anchors = addPageAnchors(currentFrames, frameId, originY)
        if (!anchors) return

        // Drawn at 100%-zoom screen size; `fitChromeToZoom` scales the group
        // by 1/zoom so it stays this size on screen.
        const size = ADD_PAGE_BUTTON_SIZE_PX

        // Solid black background with a white plus sign — a primary-button
        // treatment (direct follow-up) rather than the previous white-at-50%-
        // opacity/black-icon look, which read as a secondary, easy-to-miss
        // affordance. Full opacity so it reads as a confident, deliberate
        // action against either the white page or the dark canvas behind it;
        // hover lightens the fill by one step (`ADD_PAGE_BUTTON_HOVER_FILL`,
        // matching this app's zinc scale) instead of fading translucency, the
        // usual primary-button hover treatment. Grouped into one object so
        // the tag/hover/click handling below only has to deal with a single
        // target.
        const makeButton = ({ frameId: targetId, side, edgeX }: AddPageAnchor, offsetX: number) => {
          const bg = new fabric.Rect({
            width: size,
            height: size,
            originX: "center",
            originY: "center",
            rx: 6,
            ry: 6,
            fill: ADD_PAGE_BUTTON_FILL,
          })
          const barLength = size * 0.45
          const barThickness = 2
          const hBar = new fabric.Rect({
            width: barLength,
            height: barThickness,
            originX: "center",
            originY: "center",
            fill: "#ffffff",
          })
          const vBar = new fabric.Rect({
            width: barThickness,
            height: barLength,
            originX: "center",
            originY: "center",
            fill: "#ffffff",
          })
          const group = new fabric.Group([bg, hBar, vBar], {
            originX: "center",
            originY: "center",
            selectable: false,
            lockMovementX: true,
            lockMovementY: true,
            hoverCursor: "pointer",
            excludeFromExport: true,
          }) as unknown as ScreenChrome & { isAddPageButton?: boolean; frameId?: string; side?: "before" | "after" }
          group.isAddPageButton = true
          group.frameId = targetId
          group.side = side
          group.screenAnchor = { x: edgeX, y: anchors.centerY, offsetX, offsetY: 0, scale: 1 }
          fitChromeToZoom(group, target_canvas.getZoom())
          group.on("mouseover", () => {
            bg.set({ fill: ADD_PAGE_BUTTON_HOVER_FILL })
            canvasRef.current?.requestRenderAll()
          })
          group.on("mouseout", () => {
            bg.set({ fill: ADD_PAGE_BUTTON_FILL })
            canvasRef.current?.requestRenderAll()
          })
          return group
        }

        const offset = ADD_PAGE_BUTTON_GAP_PX + size / 2
        const left = makeButton(anchors.before, -offset)
        const right = makeButton(anchors.after, offset)
        target_canvas.add(left, right)
        pageButtonsRef.current = { left, right, frameId }
        target_canvas.requestRenderAll()
      }
      syncAddPageButtonsRef.current = syncAddPageButtons

      /**
       * Every pasteboard placement id in the current selection. A single
       * clicked photograph is a `PlacedObject` with its own `placementId`;
       * shift-clicking several wraps them in an `ActiveSelection`, which
       * has no `placementId` of its own — its members do, reachable via
       * `getObjects()` — so that case is read out separately.
       */
      const collectPlacementIds = (active: FabricObject | undefined): string[] => {
        if (active instanceof fabric.ActiveSelection) {
          return active
            .getObjects()
            .map((object) => (object as PlacedObject).placementId)
            .filter((id): id is string => Boolean(id))
        }
        const placementId = (active as PlacedObject | undefined)?.placementId
        return placementId ? [placementId] : []
      }

      const notifyFrameSelection = () => {
        const active = canvasRef.current?.getActiveObject() as
          | (PlacedFrame & Partial<PlacedElement> & Partial<PlacedObject>)
          | undefined

        // A shift-click group is created by Fabric itself, with Fabric's
        // default border, so it's recolored here.
        if (active instanceof fabric.ActiveSelection) active.set(SELECTION_STYLE)

        if (active?.elementId && active.frameId) {
          handlers.current.onSelectElement(active.frameId, active.elementId)
          handlers.current.onSelectPlacement([])
          syncAddPageButtons(null)
          return
        }

        handlers.current.onSelectFrame(active?.frameId ?? null)
        handlers.current.onSelectPlacement(collectPlacementIds(active))
        syncAddPageButtons(active?.frameId ?? null)
      }
      canvas.on("selection:created", notifyFrameSelection)
      canvas.on("selection:updated", notifyFrameSelection)
      canvas.on("selection:cleared", () => {
        if (suppressSelectionClearRef.current) return
        handlers.current.onSelectFrame(null)
        handlers.current.onSelectPlacement([])
        syncAddPageButtons(null)
      })

      canvas.on("mouse:move", (opt) => {
        if (!panning) return
        const target = canvasRef.current
        if (!target) return

        const event = opt.e as MouseEvent
        const vpt = target.viewportTransform
        vpt[4] += event.clientX - panFrom.x
        vpt[5] += event.clientY - panFrom.y
        target.setViewportTransform(vpt)
        target.requestRenderAll()
        panFrom = { x: event.clientX, y: event.clientY }
      })

      canvas.on("mouse:up", (opt) => {
        const target = canvasRef.current
        if (!target) return

        // Completes a text-placement gesture armed by `armTextTool` — a
        // plain click places a default-width box centered there; a
        // click-and-drag sizes it to the drag instead. `textPlacementStartRef`
        // being null (armed, but no mousedown landed on the canvas — e.g. the
        // button was clicked again, or focus was elsewhere) means there is
        // nothing to place; this mouseup is unrelated to the gesture.
        if (placingTextRef.current) {
          const start = textPlacementStartRef.current
          if (start) {
            const end = { x: opt.scenePoint.x, y: opt.scenePoint.y }
            const dragWidth = Math.abs(end.x - start.x)
            const clickThreshold = TEXT_PLACEMENT_CLICK_THRESHOLD_PX / target.getZoom()
            const dragged = dragWidth > clickThreshold
            const center = dragged ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } : start
            const width = dragged ? Math.max(60, dragWidth) : DEFAULT_TEXTBOX_WIDTH
            placeTextbox(center, width)
          }
          disarmTextPlacement()
          return
        }

        panning = false
        target.selection = true
        clearInsertionIndicator()
        draggingRef.current = null
        // Back to "ready to grab" rather than "grabbing" if Space is still
        // held — only relevant when the drag that just ended was the
        // space-triggered pan above, but harmless to set unconditionally.
        if (spacePressed) setPanCursor(target, "grab")

        // A click on a placed text box only selects it; a double click edits
        // it (`selectableTextboxClass`, issue #14). This used to enter
        // editing on a single click, which the maintainer reversed to match
        // Figma: a single click has to stay free for moving and resizing.
      })

      /* While a frame is mid-drag, show which grid slot it would land in.
         `object:moving` fires continuously for the object under the pointer,
         so this doesn't need its own mouse:move listener. */
      canvas.on("object:moving", (opt) => {
        draggingRef.current = opt.target ?? null

        const placed = opt.target as PlacedFrame | undefined
        if (!placed?.frameId) return

        const { frames: currentFrames, placements, assets } = latest.current
        const originY = frameGridOriginY(placements, assets)
        const layouts = layoutFrames(currentFrames, originY)
        const targetIndex = nearestFrameIndex(layouts, { x: placed.left ?? 0, y: placed.top ?? 0 })
        const target = layouts[targetIndex]
        if (target) showInsertionIndicator(target)
      })

      /* Write position and scale back to the store when a gesture ends —
         not per frame, which would commit a store write per pointer move. */
      canvas.on("object:modified", (opt) => {
        // The gesture that produced this event is over — from this point on,
        // a resync must be free to reposition the object even though it's
        // still selected (see `draggingRef`'s doc comment).
        draggingRef.current = null

        const placed = opt.target as (PlacedObject & Partial<PlacedFrame> & Partial<PlacedElement>) | undefined
        if (!placed) return

        // Checked first: an element also has no `placementId`, but unlike a
        // frame's own background Rect it carries both `frameId` and
        // `elementId` together, which is what actually disambiguates it from
        // the other two branches below.
        if (placed.elementId && placed.frameId) {
          const { frames: currentFrames, placements, assets } = latest.current
          const originY = frameGridOriginY(placements, assets)
          const layouts = layoutFrames(currentFrames, originY)

          // Dragged onto a *different* frame's bounds? Reassign it there —
          // computing the new Box against whichever frame it already
          // belonged to (as this used to do unconditionally) left a
          // cross-page drag looking like it worked while the element
          // stayed structurally on its original page. That's what made the
          // sidebar's "Centered"/"Full bleed" presets re-center the image
          // on the page it used to live on rather than the one it now
          // visually sits on (direct bug report) — those presets read
          // `frameId` from `selection`, which `onMoveElementToFrame` below
          // updates to the destination frame; `onUpdateElementBox` never
          // touches selection at all. Falls back to the element's own
          // frame when the drop lands outside every frame's bounds — there
          // is no "eject back to the pasteboard" gesture for an element
          // already inside a frame, so it simply stays on the page it was
          // already on, same as before this fix.
          const dropX = placed.left ?? 0
          const dropY = placed.top ?? 0
          const hitFrameId = frameAt(layouts, { x: dropX, y: dropY }) ?? placed.frameId
          const layout = layouts.find((l) => l.frameId === hitFrameId)
          if (!layout || layout.bounds.width === 0 || layout.bounds.height === 0) return

          // Fabric reports position/size pre-scale; the object's actual
          // on-canvas footprint is width/height times scaleX/scaleY. Reading
          // through scale here is what makes a corner-drag resize (not just
          // a move) persist correctly as a new normalized Box.
          const absWidth = (placed.width ?? 0) * (placed.scaleX ?? 1)
          const absHeight = (placed.height ?? 0) * (placed.scaleY ?? 1)
          const box: Box = {
            x: (dropX - layout.bounds.x) / layout.bounds.width,
            y: (dropY - layout.bounds.y) / layout.bounds.height,
            width: absWidth / layout.bounds.width,
            height: absHeight / layout.bounds.height,
          }

          if (hitFrameId === placed.frameId) {
            handlers.current.onUpdateElementBox(placed.frameId, placed.elementId, box)
          } else {
            handlers.current.onMoveElementToFrame(placed.frameId, hitFrameId, placed.elementId, box)
          }
          return
        }

        if (placed.placementId) {
          const dropX = placed.left ?? 0
          const dropY = placed.top ?? 0

          // Did the photo land on a frame? If so it joins that frame's
          // elements and leaves the pasteboard — the position/scale writes
          // below are skipped because the placement is about to be deleted
          // (syncObjects removes this object once the store reflects that).
          const { frames: currentFrames, placements: currentPlacements, assets: pool } = latest.current
          const originY = frameGridOriginY(currentPlacements, pool)
          const layouts = layoutFrames(currentFrames, originY)
          const hitFrameId = frameAt(layouts, { x: dropX, y: dropY })

          if (hitFrameId) {
            // See `suppressSelectionClearRef`'s doc comment: the old
            // placement object doesn't disappear until `syncObjects` next
            // runs (a later render, once `placements` reflects the move),
            // so the suppression window has to span that gap too — cleared
            // there, not here, once that removal actually happens.
            suppressSelectionClearRef.current = true
            handlers.current.onDropOnFrame(placed.placementId, hitFrameId)
            return
          }

          handlers.current.onMove(placed.placementId, dropX, dropY)
          handlers.current.onScale(
            placed.placementId,
            (placed.scaleX ?? 1) / (placed.naturalScale || 1),
          )
          return
        }

        if (placed.frameId) {
          clearInsertionIndicator()

          const { frames: currentFrames, placements, assets } = latest.current
          const from = currentFrames.findIndex((frame) => frame.id === placed.frameId)
          if (from < 0) return

          const originY = frameGridOriginY(placements, assets)
          const layouts = layoutFrames(currentFrames, originY)
          const to = nearestFrameIndex(layouts, { x: placed.left ?? 0, y: placed.top ?? 0 })

          if (to !== from) {
            // The frame snaps onto its new slot via the reflow effect
            // (syncFrames), driven by the store update this triggers — not
            // here, so there is exactly one place that computes frame
            // positions.
            handlers.current.onReorderFrame(from, to)
          } else {
            // Dropped back in the same slot: the store doesn't change, so
            // syncFrames' reflow won't run for this frame. Snap it onto the
            // grid directly so it doesn't rest wherever the pointer let go.
            const own = layouts[from]
            if (own) {
              snapFrameTo(
                fabric,
                placed,
                { left: own.bounds.x + own.bounds.width / 2, top: own.bounds.y + own.bounds.height / 2 },
                200,
                () => canvasRef.current?.requestRenderAll(),
              )
            }
          }
        }
      })

      /**
       * A pasteboard `Textbox` finished editing (blurred, or Escape/click
       * elsewhere — Fabric's own exit triggers, not this hook's). This is
       * where typed text actually becomes data.
       *
       * Empty text is discarded outright — nobody wants an empty caption box
       * left behind after clicking away.
       *
       * Non-empty text is hit-tested the same way a dropped photograph is
       * (`frameAt` over `layoutFrames`, against the box's center — `left`/
       * `top`, since `originX`/`originY` are `'center'`). A hit commits it as
       * that frame's `TextElement` via `onCreateText`, and the Fabric object
       * is removed — same "leaves the pasteboard" rule `onDropOnFrame`
       * follows for photographs, since a frame's contents render in Design
       * mode, not as a live object on this canvas.
       *
       * A miss is the documented judgment call for "text created off any
       * frame" (U6): `CanvasState` only models photograph placements, so
       * there is no pasteboard-text slot to persist this into without a
       * data-model addition out of scope for this unit. The simpler option —
       * taken here — is to leave the Fabric object sitting on the canvas,
       * live but unsaved: it survives further edits and drags within the
       * session (nothing in `syncObjects`/`syncFrames` touches it, since it's
       * in neither tracked map), but is lost on reload, and dragging it near
       * a frame alone does not commit it — only exiting edit mode re-runs
       * this hit test. Re-entering editing (a double click, see
       * `selectableTextboxClass`) and exiting again re-evaluates the hit
       * test at the box's current position, so moving it onto a frame and
       * re-editing is how a miss gets a second chance.
       */
      canvas.on("text:editing:exited", (opt) => {
        const target_canvas = canvasRef.current
        if (!target_canvas) return

        const textbox = opt.target as unknown as PlacedTextbox & Partial<PlacedElement>
        const content = (textbox.text ?? "").trim()

        // Re-editing an already-placed frame text element (double-click,
        // see `selectableTextboxClass`) commits its content in place —
        // distinct from a fresh pasteboard textbox landing on a frame for
        // the first time, which is everything below this branch. Since
        // `placeTextbox` now commits directly onto a frame immediately, with
        // empty content, this branch is also what a *brand-new* box hits if
        // the user clicks away without ever typing — empty content is
        // discarded there rather than saved, the same "nobody wants an empty
        // caption box left behind" rule the miss-a-frame branch below
        // already applies, so this doesn't leave an invisible full-bleed
        // element sitting in the frame.
        if (textbox.elementId && textbox.frameId) {
          if (content.length === 0) {
            handlers.current.onRemoveElement(textbox.frameId, textbox.elementId)
          } else {
            handlers.current.onUpdateTextContent(textbox.frameId, textbox.elementId, content)
          }
          return
        }

        if (content.length === 0) {
          target_canvas.remove(textbox)
          target_canvas.requestRenderAll()
          return
        }

        const { frames: currentFrames, placements, assets } = latest.current
        const originY = frameGridOriginY(placements, assets)
        const layouts = layoutFrames(currentFrames, originY)
        const hitFrameId = frameAt(layouts, { x: textbox.left ?? 0, y: textbox.top ?? 0 })

        if (!hitFrameId) return

        const layout = layouts.find((l) => l.frameId === hitFrameId)
        const center = { x: textbox.left ?? 0, y: textbox.top ?? 0 }
        const width = (textbox.width ?? 0) * (textbox.scaleX ?? 1)
        const box = layout
          ? {
              x: clamp01((center.x - width / 2 - layout.bounds.x) / layout.bounds.width),
              y: clamp01((center.y - layout.bounds.y) / layout.bounds.height),
              width: clamp01(width / layout.bounds.width),
              height: 0.08,
            }
          : undefined

        // See `suppressSelectionClearRef`'s doc comment: removing this
        // textbox fires `selection:cleared`, which would otherwise clobber
        // `onCreateText`'s selection write back to book-level settings.
        suppressSelectionClearRef.current = true
        target_canvas.remove(textbox)
        handlers.current.onCreateText(hitFrameId, content, box)
        suppressSelectionClearRef.current = false
        target_canvas.requestRenderAll()
      })

      // The sync effect below runs off `ready`, so it performs the first draw.
      setReady(true)
    })()

    const objects = objectsRef.current
    const inFlight = pendingRef.current

    const drawnFrames = framesRef.current
    const drawnElements = elementsRef.current
    const elementsInFlight = elementsPendingRef.current
    const drawnOverlays = overlaysRef.current
    const drawnCoverBadges = coverBadgesRef.current
    const drawnSpreadBoxes = spreadBoxesRef.current

    return () => {
      disposed = true
      setReady(false)
      window.removeEventListener("keydown", onCanvasKey)
      window.removeEventListener("keydown", onSpaceKeyDown)
      window.removeEventListener("keyup", onSpaceKeyUp)
      objects.clear()
      inFlight.clear()
      drawnFrames.clear()
      drawnElements.clear()
      elementsInFlight.clear()
      drawnOverlays.clear()
      drawnCoverBadges.clear()
      drawnSpreadBoxes.clear()
      pageButtonsRef.current = null
      draggingRef.current = null
      indicatorRef.current = null
      placingTextRef.current = false
      textPlacementStartRef.current = null
      const target = canvasRef.current
      canvasRef.current = null
      void target?.dispose()
    }
    // Created once for the lifetime of the mounted stage.
     
  }, [])

  /* ---------------------------------------------------------------- */
  /* Resize                                                            */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const applySize = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const { width, height } = container.getBoundingClientRect()
      if (width === 0 || height === 0) return
      // v7 removed setWidth/setHeight.
      canvas.setDimensions({ width: Math.round(width), height: Math.round(height) })
      canvas.requestRenderAll()
    }

    applySize()

    // The container is overflow-hidden on purpose: observing a scrollable
    // ancestor would let a growing canvas summon a scrollbar, shrink the
    // content box, and re-fire this observer forever.
    const observer = new ResizeObserver(applySize)
    observer.observe(container)

    return () => observer.disconnect()
  }, [ready])

  /* ---------------------------------------------------------------- */
  /* Sync placements onto the canvas                                   */
  /* ---------------------------------------------------------------- */

  const syncObjects = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const { placements: current, assets: pool } = latest.current
    const assetById = new Map(pool.map((asset) => [asset.id, asset]))
    const live = objectsRef.current

    // Remove objects whose placement is gone.
    for (const [placementId, object] of live) {
      if (!current.some((placement) => placement.id === placementId)) {
        canvas.remove(object)
        live.delete(placementId)
      }
    }
    // See `suppressSelectionClearRef`'s doc comment: this is the other end
    // of the window `object:modified`'s frame-drop branch opens — the old
    // placement object it dropped is exactly one of the ones just removed
    // above, so the suppression can safely lift now that the removal (and
    // whatever `selection:cleared` noise it made) has actually happened.
    suppressSelectionClearRef.current = false

    // Add objects for placements not yet drawn. Existing objects are left
    // alone — the canvas owns their position while mounted.
    //
    // Drawing awaits a blob URL and a dynamic import, so two overlapping sync
    // passes (import a batch, then another before the first finishes) would
    // both pass a plain `live.has` check and both add an object. The second
    // would win the map and the first would become an untracked ghost the
    // cleanup loop can never remove. The pending set closes that window by
    // reserving the id synchronously.
    const pending = pendingRef.current

    for (const placement of current) {
      if (live.has(placement.id) || pending.has(placement.id)) continue

      const asset = assetById.get(placement.assetId)
      if (!asset) continue

      pending.add(placement.id)
      try {
        await drawPlacement(placement, asset)
      } finally {
        pending.delete(placement.id)
      }
    }

    canvasRef.current?.requestRenderAll()

    async function drawPlacement(placement: CanvasPlacement, asset: Asset) {
      const url = await thumbnailUrl(placement.assetId)
      if (!url || !canvasRef.current) return

      // The placement can be deleted while its image loads.
      if (!latest.current.placements.some((p) => p.id === placement.id)) return

      const fabric = await import("fabric")
      const image: FabricImage = await fabric.FabricImage.fromURL(url)
      if (!canvasRef.current) return

      // The thumbnail is smaller than the original, so scale it back up to the
      // asset's natural size — placement scale is defined against that.
      const naturalScale = asset.width / (image.width || asset.width)

      image.set({
        left: placement.x,
        top: placement.y,
        originX: "center",
        originY: "center",
        angle: placement.rotation,
        scaleX: naturalScale * placement.scale,
        scaleY: naturalScale * placement.scale,
        ...SELECTION_STYLE,
        cornerSize: 8,
        transparentCorners: false,
        // The model stores position and one uniform scale. Fabric's default
        // controls offer more than that — a rotation handle and per-axis side
        // handles — and `object:modified` has nowhere to put either, so a
        // rotated or stretched photograph would silently snap back on reload.
        // Restrict the controls to what a placement can actually remember.
        lockRotation: true,
        lockSkewingX: true,
        lockSkewingY: true,
      })

      image.setControlsVisibility({
        mtr: false, // rotation handle
        ml: false,
        mr: false,
        mt: false,
        mb: false, // per-axis side handles
      })
      const placed = image as PlacedObject
      placed.placementId = placement.id
      placed.naturalScale = naturalScale

      canvasRef.current.add(image)
      live.set(placement.id, placed)
      canvasRef.current.requestRenderAll()
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    void syncObjects()
  }, [ready, placements, assets, syncObjects])

  /* ---------------------------------------------------------------- */
  /* Sync frames onto the canvas                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Draw every frame at its grid position, and reflow (animate) any frame
   * whose position moved — which happens after a reorder, since the grid
   * position of every frame past the drop point shifts by one slot.
   *
   * Mirrors `syncObjects`'s add/remove-by-diff shape, but frames need no
   * pending-load bookkeeping — a frame's `Rect` has nothing to await, unlike
   * a placement's thumbnail image.
   */
  const syncFrames = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const fabric = await import("fabric")
    const { frames: currentFrames, placements: currentPlacements, assets: pool } = latest.current
    const originY = frameGridOriginY(currentPlacements, pool)
    const layouts = layoutFrames(currentFrames, originY)
    const layoutById = new Map(layouts.map((layout) => [layout.frameId, layout]))
    const spreadBoxes = layoutSpreadBoxes(currentFrames, originY)
    const spreadBoxById = new Map(spreadBoxes.map((box) => [box.frameId, box]))
    const live = framesRef.current
    const liveOverlays = overlaysRef.current
    const coverBadges = coverBadgesRef.current
    const liveSpreadBoxes = spreadBoxesRef.current
    const frameById = new Map(currentFrames.map((frame) => [frame.id, frame]))

    // Remove frame objects whose frame no longer exists.
    for (const [frameId, object] of live) {
      if (!layoutById.has(frameId)) {
        canvas.remove(object)
        live.delete(frameId)
      }
    }
    for (const [frameId, overlay] of liveOverlays) {
      if (!layoutById.has(frameId)) {
        canvas.remove(overlay.bleed, overlay.margin)
        liveOverlays.delete(frameId)
      }
    }
    for (const [frameId, badge] of coverBadges) {
      if (!layoutById.has(frameId)) {
        canvas.remove(badge)
        coverBadges.delete(frameId)
      }
    }
    // Keyed by spread, not by frame: a frame id can still exist in
    // `layoutById` (it didn't disappear) while no longer anchoring a
    // spread's left half — reordered into a solo row, say, or its former
    // partner left the book. Either way the box it used to own is stale.
    for (const [frameId, box] of liveSpreadBoxes) {
      if (!spreadBoxById.has(frameId)) {
        canvas.remove(box)
        liveSpreadBoxes.delete(frameId)
      }
    }

    /**
     * Draw or reposition a frame's bleed edge and content-margin guides —
     * the same two print-technical overlays the Book overview draws
     * (`PrintOverlay` in canvas-region.tsx), as real Fabric objects here so
     * they inherit the canvas's own pan/zoom instead of needing a synced DOM
     * layer. Colors are the `oklch` values behind Tailwind's
     * `destructive`/`ring` tokens (globals.css) — Fabric draws to a 2D canvas
     * context and can't read CSS custom properties, so they're spelled out
     * here and have to be kept in sync by hand if the tokens change.
     */
    function syncPrintOverlay(fabric: typeof import("fabric"), layout: FrameLayout, frame: Frame | undefined) {
      if (!frame || !canvas) return

      const margins = frame.margins ?? defaultFrameMargins(frame.pageSize)
      const bounds = layout.bounds
      const bleedX = (BLEED_MM / frame.pageSize.width) * bounds.width
      const bleedY = (BLEED_MM / frame.pageSize.height) * bounds.height
      const marginLeft = (margins.inner / frame.pageSize.width) * bounds.width
      const marginRight = (margins.outer / frame.pageSize.width) * bounds.width
      const marginTop = (margins.top / frame.pageSize.height) * bounds.height
      const marginBottom = (margins.bottom / frame.pageSize.height) * bounds.height

      const bleedRectProps = {
        left: bounds.x + bounds.width / 2,
        top: bounds.y + bounds.height / 2,
        width: bounds.width + bleedX * 2,
        height: bounds.height + bleedY * 2,
      }
      const marginWidth = Math.max(bounds.width - marginLeft - marginRight, 0)
      const marginHeight = Math.max(bounds.height - marginTop - marginBottom, 0)
      const marginRectProps = {
        left: bounds.x + marginLeft + marginWidth / 2,
        top: bounds.y + marginTop + marginHeight / 2,
        width: marginWidth,
        height: marginHeight,
      }

      const existing = liveOverlays.get(frame.id)
      if (existing) {
        existing.bleed.set(bleedRectProps)
        existing.margin.set(marginRectProps)
        canvas.bringObjectToFront(existing.bleed)
        canvas.bringObjectToFront(existing.margin)
        return
      }

      const shared = {
        originX: "center" as const,
        originY: "center" as const,
        fill: "transparent",
        strokeDashArray: [6, 5],
        strokeWidth: 2,
        // Keep the stroke a constant 2 *screen* pixels regardless of zoom —
        // without this, `strokeWidth` scales with the canvas's own zoom like
        // any other geometry, so zooming out shrinks it to sub-pixel and it
        // effectively disappears (the reported "dotted lines disappear when
        // I zoom" bug).
        strokeUniform: true,
        selectable: false,
        evented: false,
        excludeFromExport: true,
      }
      const bleed = new fabric.Rect({
        ...shared,
        ...bleedRectProps,
        // Trim/bleed line — the conventional red seen on print templates.
        stroke: "#ff3b30",
      })
      const margin = new fabric.Rect({
        ...shared,
        ...marginRectProps,
        // Content-margin guide — a bright blue/violet, à la Figma's own
        // layout-grid guides, to read as clearly distinct from the bleed.
        stroke: "#18a0fb",
      })
      canvas.add(bleed, margin)
      liveOverlays.set(frame.id, { bleed, margin })
    }

    /**
     * The "this is the cover" badge — a small filled bookmark glyph (Lucide's
     * `bookmark` icon path, drawn directly as a `fabric.Path` since this is
     * the canvas, not DOM — Phosphor/React icons don't apply here) pinned
     * just above a cover frame's top-left corner, clear of its bleed line.
     * Persistent, not a hover reveal, matching the "sits there like Figma
     * dev-mode" request. Sized in screen pixels (`COVER_BADGE_HEIGHT_PX`,
     * via `fitChromeToZoom`) so it stays legible at working zoom, and filled
     * with `--primary`'s light zinc (oklch(0.92 0.004 286.32)) rather than
     * the margin guide's blue, which it used to share.
     */
    function syncCoverBadge(fabric: typeof import("fabric"), layout: FrameLayout, frame: Frame | undefined) {
      if (!frame || !canvas) return

      const existing = coverBadges.get(frame.id)
      if (!frame.isCover) {
        if (existing) {
          canvas.remove(existing)
          coverBadges.delete(frame.id)
        }
        return
      }

      const bleedY = (BLEED_MM / frame.pageSize.height) * layout.bounds.height
      const screenAnchor = {
        x: layout.bounds.x,
        y: layout.bounds.y - bleedY,
        offsetX: 0,
        offsetY: -COVER_BADGE_GAP_PX,
        scale: COVER_BADGE_HEIGHT_PX / 18,
      }

      if (existing) {
        existing.screenAnchor = screenAnchor
        fitChromeToZoom(existing, canvas.getZoom())
        canvas.bringObjectToFront(existing)
        return
      }

      const badge = new fabric.Path("m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z", {
        originX: "left",
        originY: "bottom",
        fill: "#e4e4e7",
        selectable: false,
        evented: false,
        excludeFromExport: true,
      }) as unknown as ScreenChrome
      badge.screenAnchor = screenAnchor
      fitChromeToZoom(badge, canvas.getZoom())
      canvas.add(badge)
      coverBadges.set(frame.id, badge)
    }

    /**
     * The solid rect behind a spread's two frames (user-directed: "each of
     * these paired pages in a nice section... box to visually separate
     * from the canvas. Same styling using our grays and border colors. No
     * shadows."). `fill`/`stroke` are the same `oklch` values behind this
     * app's `--muted`/`--border` tokens (globals.css) — Fabric can't read
     * CSS custom properties, so they're spelled out here, same reasoning
     * as `syncPrintOverlay`'s colors above. `--muted` specifically: "one
     * step lighter than `--canvas`" per that token's own doc comment,
     * which is exactly what reads as a shelf the pages sit on rather than
     * a second, competing background.
     *
     * Explicitly `sendObjectToBack` every sync, new box or repositioned
     * existing one alike — add-order alone isn't enough. A frame whose
     * `Rect` already existed from a prior sync (repositioned via `.set`,
     * never re-added) keeps whatever stacking position it was originally
     * added at, which can predate this box entirely — e.g. the very first
     * page in a book, drawn long before it ever paired into a spread. Left
     * to add-order, that frame would stay stuck behind a box added after it
     * instead of on top of one added before it.
     */
    function syncSpreadBox(fabric: typeof import("fabric"), box: SpreadBoxLayout) {
      if (!canvas) return

      const existing = liveSpreadBoxes.get(box.frameId)
      const rectProps = {
        left: box.bounds.x + box.bounds.width / 2,
        top: box.bounds.y + box.bounds.height / 2,
        width: box.bounds.width,
        height: box.bounds.height,
      }

      if (existing) {
        existing.set(rectProps)
        canvas.sendObjectToBack(existing)
        return
      }

      const rect = new fabric.Rect({
        ...rectProps,
        originX: "center",
        originY: "center",
        fill: "#27272a",
        stroke: "rgba(255, 255, 255, 0.1)",
        strokeWidth: 1,
        selectable: false,
        evented: false,
        excludeFromExport: true,
      })
      canvas.add(rect)
      canvas.sendObjectToBack(rect)
      liveSpreadBoxes.set(box.frameId, rect)
    }

    for (const box of spreadBoxes) {
      syncSpreadBox(fabric, box)
    }

    for (const layout of layouts) {
      const centerX = layout.bounds.x + layout.bounds.width / 2
      const centerY = layout.bounds.y + layout.bounds.height / 2
      const existing = live.get(layout.frameId)

      if (!existing) {
        const rect = new fabric.Rect({
          left: centerX,
          top: centerY,
          width: layout.bounds.width,
          height: layout.bounds.height,
          originX: "center",
          originY: "center",
          fill: "#ffffff",
          // Tailwind's zinc-400, from the zinc scale the rest of the app's
          // neutrals are drawn from.
          stroke: "#a1a1aa",
          strokeWidth: 2,
          ...SELECTION_STYLE,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
        }) as unknown as PlacedFrame
        rect.frameId = layout.frameId
        rect.setControlsVisibility({
          mtr: false,
          ml: false,
          mr: false,
          mt: false,
          mb: false,
          tl: false,
          tr: false,
          bl: false,
          br: false,
        })

        canvas.add(rect)
        live.set(layout.frameId, rect)
        continue
      }

      // Don't fight the object currently under the user's pointer.
      if (existing === draggingRef.current) continue

      const dx = Math.abs((existing.left ?? 0) - centerX)
      const dy = Math.abs((existing.top ?? 0) - centerY)
      if (dx < 0.5 && dy < 0.5) continue

      // Motion convention (see the `animations` skill): under 300ms,
      // ease-in-out, using Fabric's own tween rather than a hand-rolled RAF
      // loop; none under reduced motion.
      snapFrameTo(fabric, existing, { left: centerX, top: centerY }, 250, () =>
        canvasRef.current?.requestRenderAll(),
      )
    }

    // Run after every frame rect above has been added/updated, so a newly
    // created overlay's z-order (append = drawn on top) lands above the
    // frame's own white background instead of racing it.
    for (const layout of layouts) {
      syncPrintOverlay(fabric, layout, frameById.get(layout.frameId))
      syncCoverBadge(fabric, layout, frameById.get(layout.frameId))
    }

    // Reposition an already-open add-page button pair if the frame list
    // changed under it (most notably: one of the buttons was just clicked).
    if (pageButtonsRef.current) {
      syncAddPageButtonsRef.current(pageButtonsRef.current.frameId)
    }

    canvas.requestRenderAll()
  }, [])

  useEffect(() => {
    if (!ready) return
    void syncFrames()
  }, [ready, frames, placements, assets, syncFrames])

  /* ---------------------------------------------------------------- */
  /* Sync frame contents onto the canvas                                */
  /* ---------------------------------------------------------------- */

  /**
   * How an image element's Fabric object should be positioned/scaled to
   * honor `ImageElement.fit` inside its absolute on-canvas Box. See the
   * doc comment on `syncFrameElements` below for why `'cover'` stretches
   * rather than crops.
   */
  function imageFitTransform(
    fit: "cover" | "contain" | undefined,
    naturalWidth: number,
    naturalHeight: number,
    absLeft: number,
    absTop: number,
    absWidth: number,
    absHeight: number,
  ): { left: number; top: number; scaleX: number; scaleY: number } {
    if (fit === "contain" && naturalWidth > 0 && naturalHeight > 0) {
      const scale = Math.min(absWidth / naturalWidth, absHeight / naturalHeight)
      const renderedWidth = naturalWidth * scale
      const renderedHeight = naturalHeight * scale
      return {
        left: absLeft + (absWidth - renderedWidth) / 2,
        top: absTop + (absHeight - renderedHeight) / 2,
        scaleX: scale,
        scaleY: scale,
      }
    }

    return {
      left: absLeft,
      top: absTop,
      scaleX: naturalWidth ? absWidth / naturalWidth : 1,
      scaleY: naturalHeight ? absHeight / naturalHeight : 1,
    }
  }

  /**
   * Draw every frame's own elements (images and text already inside a
   * frame — not pasteboard photographs or a fresh `T` textbox) at their
   * absolute on-canvas position, derived from the frame's current laid-out
   * bounds plus the element's normalized `Box`. This is the piece that was
   * missing entirely before: a photograph or text dropped onto a frame
   * updated the store correctly, but nothing ever drew it back onto the
   * canvas — the frame stayed a blank rectangle until you switched to the
   * Book overview to see it had actually landed.
   *
   * Known limitation, left for a follow-up rather than solved here: while a
   * frame is mid-drag (reorder), its elements do not visually follow in
   * real time — only the frame's own background Rect moves under the
   * pointer. They snap to the correct position once the drag ends and the
   * store update this effect depends on re-runs. Grouping each frame with
   * its elements as one Fabric `Group` would fix this properly, but changes
   * how frame-drag/reorder hit-testing works throughout this file — a
   * larger change than tonight's scope.
   *
   * `fit: 'contain'` is honored below via `imageFitTransform` — a single
   * uniform scale, centered within the Box on whichever axis has slack, so
   * the whole image stays visible without distortion (the "hold Shift while
   * scaling" behavior "Centered"/"Left half" presets need).
   *
   * `fit: 'cover'` (and the legacy-undefined default) still stretches
   * independently to exactly fill the Box, rather than true crop-to-fill.
   * True cover would need a `clipPath` sized to the Box while the image
   * itself scales uniformly past it — but the object's own selection handles
   * bound its *own* width/height, not the clip region, so a cover-fitted
   * image's handles would no longer match what's visible, and
   * `object:modified` (which reads `width * scaleX` back into a new Box)
   * would compute the wrong size the moment someone resizes it. That's a
   * bigger change to drag/resize semantics than this fix's scope. The
   * stretch fallback is safe specifically for `'cover'` because a full-bleed
   * Box's aspect ratio is usually close to the frame's own, so crop and
   * stretch look nearly identical there.
   */
  const syncFrameElements = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const fabric = await import("fabric")
    const {
      frames: currentFrames,
      placements: currentPlacements,
      assets: pool,
      typeBaseSize,
      typeRatio,
    } = latest.current
    const originY = frameGridOriginY(currentPlacements, pool)
    const layoutByFrameId = new Map(layoutFrames(currentFrames, originY).map((l) => [l.frameId, l]))
    const live = elementsRef.current
    const pending = elementsPendingRef.current

    const validIds = new Set<string>()
    for (const frame of currentFrames) {
      for (const element of frame.elements) validIds.add(element.id)
    }

    // Remove objects for elements that no longer exist (deleted, or moved
    // back out to the pasteboard).
    for (const [elementId, object] of live) {
      if (!validIds.has(elementId)) {
        canvas.remove(object)
        live.delete(elementId)
      }
    }

    for (const frame of currentFrames) {
      const layout = layoutByFrameId.get(frame.id)
      if (!layout) continue

      for (const element of frame.elements) {
        const absLeft = layout.bounds.x + element.frame.x * layout.bounds.width
        const absTop = layout.bounds.y + element.frame.y * layout.bounds.height
        const absWidth = element.frame.width * layout.bounds.width
        const absHeight = element.frame.height * layout.bounds.height

        const existing = live.get(element.id)

        if (existing) {
          // This loop is keyed by element id alone, reused verbatim across a
          // frame reassignment (`moveElementToFrame`) — without this, the
          // cached object's `frameId` tag stays pointed at whichever frame
          // it was first created under, forever. That went unnoticed before
          // an element could ever change frames at all; now it can (a photo
          // dragged from one page onto another), and a *second* interaction
          // with the same object — say, repositioning it again within its
          // new page — would read this stale tag as its "current" frame in
          // `object:modified` below, sending that update to the wrong frame
          // (a silent no-op, since the element no longer lives there).
          existing.frameId = frame.id

          // Don't fight the object currently under the user's pointer.
          if (existing === draggingRef.current) continue

          const target =
            element.kind === "image"
              ? imageFitTransform(
                  element.fit,
                  existing.width ?? 0,
                  existing.height ?? 0,
                  absLeft,
                  absTop,
                  absWidth,
                  absHeight,
                )
              : {
                  left: absLeft,
                  top: absTop,
                  scaleX: existing.width ? absWidth / existing.width : 1,
                  scaleY: existing.height ? absHeight / existing.height : 1,
                }

          const dx = Math.abs((existing.left ?? 0) - target.left)
          const dy = Math.abs((existing.top ?? 0) - target.top)
          const dw = Math.abs((existing.width ?? 0) * ((existing.scaleX ?? 1) - target.scaleX))
          const dh = Math.abs((existing.height ?? 0) * ((existing.scaleY ?? 1) - target.scaleY))
          const geometryChanged = dx >= 0.5 || dy >= 0.5 || dw >= 0.5 || dh >= 0.5

          // Text content/font/alignment edited via the *sidebar* (its own
          // textarea, Role/Alignment selects, the new font-family picker)
          // never touch this object directly — only Fabric's own in-canvas
          // double-click-to-edit does, through its own text-editing events.
          // Without this check, a sidebar edit updates the store but the
          // canvas keeps showing the old text/font/alignment until something
          // else happens to touch this object.
          let textChanged = false
          if (element.kind === "text") {
            const textObject = existing as unknown as {
              text?: string
              fontFamily?: string
              textAlign?: string
              fontSize?: number
              fill?: string
            }
            const nextFontFamily = resolveTextFontFamily(element.fontFamily)
            const nextFontSize =
              resolveTextSize(element.role, element.fontSize, typeBaseSize, typeRatio) *
              sceneUnitsPerPt(frame.pageSize.width)
            const nextFill = element.color ?? DEFAULT_TEXT_COLOR
            textChanged =
              textObject.text !== element.content ||
              textObject.fontFamily !== nextFontFamily ||
              textObject.textAlign !== element.align ||
              Math.abs((textObject.fontSize ?? 0) - nextFontSize) >= 0.5 ||
              textObject.fill !== nextFill
            if (textChanged) {
              existing.set({
                text: element.content,
                fontFamily: nextFontFamily,
                textAlign: element.align,
                fontSize: nextFontSize,
                fill: nextFill,
              })
            }
          }

          if (!geometryChanged && !textChanged) continue

          existing.set(target)
          existing.setCoords()
          continue
        }

        if (pending.has(element.id)) continue

        if (element.kind === "text") {
          const Textbox = selectableTextboxClass(fabric)
          const textbox = new Textbox(element.content, {
            left: absLeft,
            top: absTop,
            originX: "left",
            originY: "top",
            width: Math.max(absWidth, 20),
            // The element's own `fontSize` override when it has one,
            // role-aware scale size otherwise — converted from points into
            // this frame's own scene units; see `sceneUnitsPerPt`'s doc
            // comment on why that conversion has to be per-frame rather than
            // a fixed constant. Matches the sidebar's Size field, which
            // shows the same `resolveTextSize` value in points.
            fontSize:
              resolveTextSize(element.role, element.fontSize, typeBaseSize, typeRatio) *
              sceneUnitsPerPt(frame.pageSize.width),
            fontFamily: resolveTextFontFamily(element.fontFamily),
            // The element's own color override when it has one (set via the
            // sidebar's Color field), the frame's default ink black
            // otherwise. Every frame is a white page, so that default always
            // needs to be dark, unconditionally — it was hardcoded to this
            // exact fill for every text element before `TextElement.color`
            // existed. (Was `#f4f4f5` before that, the *pasteboard's*
            // white-on-dark color, copy-pasted from the pre-commit textbox
            // below — invisible against a white page.)
            fill: element.color ?? DEFAULT_TEXT_COLOR,
            textAlign: element.align,
            lockRotation: true,
            lockSkewingX: true,
            lockSkewingY: true,
            ...TEXT_SELECTION_STYLE,
          }) as unknown as PlacedElement
          textbox.frameId = frame.id
          textbox.elementId = element.id
          textbox.elementKind = "text"
          textbox.setControlsVisibility({ mtr: false })

          canvas.add(textbox)
          live.set(element.id, textbox)
          bringOverlayToFront(canvas, frame.id)

          // This is the element `placeTextbox` just created directly on
          // this frame, rendered here for the first time — enter editing on
          // it now, the same immediate cursor-ready state a click used to
          // get before that element existed anywhere but the store.
          if (pendingAutoEditElementIdRef.current === element.id) {
            pendingAutoEditElementIdRef.current = null
            canvas.setActiveObject(textbox)
            ;(textbox as unknown as { enterEditing: () => void }).enterEditing()
          }
          continue
        }

        // Image element: same async thumbnail-load shape as a pasteboard
        // photograph (`syncObjects`), reserved in `pending` for the same
        // overlapping-sync reason.
        pending.add(element.id)
        void (async () => {
          try {
            const url = await thumbnailUrl(element.assetId)
            if (!url || !canvasRef.current) return
            // The element can be removed (deleted, dragged back to the
            // pasteboard) while its thumbnail loads.
            const stillExists = latest.current.frames.some((f) =>
              f.elements.some((e) => e.id === element.id),
            )
            if (!stillExists) return

            const fabricModule = await import("fabric")
            const image: FabricImage = await fabricModule.FabricImage.fromURL(url)
            if (!canvasRef.current) return

            const transform = imageFitTransform(
              element.fit,
              image.width ?? 0,
              image.height ?? 0,
              absLeft,
              absTop,
              absWidth,
              absHeight,
            )

            image.set({
              left: transform.left,
              top: transform.top,
              originX: "left",
              originY: "top",
              scaleX: transform.scaleX,
              scaleY: transform.scaleY,
              ...SELECTION_STYLE,
              cornerSize: 8,
              transparentCorners: false,
              lockRotation: true,
              lockSkewingX: true,
              lockSkewingY: true,
            })
            image.setControlsVisibility({ mtr: false })

            const placed = image as unknown as PlacedElement
            placed.frameId = frame.id
            placed.elementId = element.id
            placed.elementKind = "image"

            canvasRef.current.add(image)
            live.set(element.id, placed)
            bringOverlayToFront(canvasRef.current, frame.id)
            canvasRef.current.requestRenderAll()
          } finally {
            pending.delete(element.id)
          }
        })()
      }
    }

    canvas.requestRenderAll()
  }, [bringOverlayToFront])

  useEffect(() => {
    if (!ready) return
    void syncFrameElements()
  }, [ready, frames, placements, assets, syncFrameElements])

  /**
   * Frame the arrangement the first time photographs appear, and again the
   * first time a frame appears.
   *
   * Scene units are original image pixels, so a 4000px photograph at 100% zoom
   * fills the viewport several times over. Without this, the first thing a user
   * sees after importing is the inside of one photo.
   *
   * These are two separate one-shots, not one: import happens before the
   * book-setup dialog runs, so placements go from 0 to positive well before
   * frames do. Gating on a single `framed` flag meant the fit that ran for
   * the imported photos never re-ran once `setupBook` created the first
   * frame — the frame (laid out below the photos, per `frameGridOriginY`)
   * was then simply outside whatever viewport the photo-only fit had already
   * settled on, with nothing to bring it into view. A book's first frame
   * showing up off-screen by default was reported directly against this
   * build.
   */
  const framedPlacements = useRef(false)
  useEffect(() => {
    if (!ready || framedPlacements.current || placements.length === 0) return
    framedPlacements.current = true
    // After the sync effect has had a turn to add the objects.
    const id = setTimeout(() => fitToViewRef.current(), 60)
    return () => clearTimeout(id)
  }, [ready, placements.length])

  const framedFrames = useRef(false)
  useEffect(() => {
    if (!ready || framedFrames.current || frames.length === 0) return
    framedFrames.current = true
    const id = setTimeout(() => fitToViewRef.current(), 60)
    return () => clearTimeout(id)
  }, [ready, frames.length])

  /* ---------------------------------------------------------------- */
  /* Controls                                                          */
  /* ---------------------------------------------------------------- */

  const zoomToCentre = useCallback(async (next: number) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const fabric = await import("fabric")
    const centre = new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2)
    const clamped = clampZoom(next)
    canvas.zoomToPoint(centre, clamped)
    canvas.requestRenderAll()
    setZoom(clamped)
  }, [])

  const zoomIn = useCallback(() => {
    void zoomToCentre((canvasRef.current?.getZoom() ?? 1) * 1.25)
  }, [zoomToCentre])

  const zoomOut = useCallback(() => {
    void zoomToCentre((canvasRef.current?.getZoom() ?? 1) / 1.25)
  }, [zoomToCentre])

  const resetZoom = useCallback(() => {
    void zoomToCentre(1)
  }, [zoomToCentre])

  const fitToView = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const { placements: current, assets: pool, frames: currentFrames } = latest.current
    const placementBox = boundingBoxOf(current, pool)

    // Frames sit below the loose photos (frameGridOriginY), so fitting to
    // placements alone leaves them out of view entirely the moment a book
    // has been set up — exactly the "where did my page go" bug this closes.
    // Union the two boxes rather than picking one: a book with both loose
    // photos and frames should show both without the user having to pan.
    const layouts = layoutFrames(currentFrames, frameGridOriginY(current, pool))
    const box = layouts.reduce((acc, layout) => {
      const { bounds } = layout
      if (acc.width === 0 && acc.height === 0) return bounds
      const minX = Math.min(acc.x, bounds.x)
      const minY = Math.min(acc.y, bounds.y)
      const maxX = Math.max(acc.x + acc.width, bounds.x + bounds.width)
      const maxY = Math.max(acc.y + acc.height, bounds.y + bounds.height)
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }, placementBox)

    if (box.width === 0 || box.height === 0) {
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
      setZoom(1)
      canvas.requestRenderAll()
      return
    }

    const width = canvas.getWidth()
    const height = canvas.getHeight()
    const next = clampZoom(
      Math.min(
        (width - FIT_PADDING * 2) / box.width,
        (height - FIT_PADDING * 2) / box.height,
      ),
    )

    const centreX = box.x + box.width / 2
    const centreY = box.y + box.height / 2

    canvas.setViewportTransform([
      next,
      0,
      0,
      next,
      width / 2 - centreX * next,
      height / 2 - centreY * next,
    ])
    setZoom(next)
    canvas.requestRenderAll()
  }, [])

  useEffect(() => {
    fitToViewRef.current = fitToView
  }, [fitToView])

  /* ---------------------------------------------------------------- */
  /* Text                                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Whether a `Textbox` currently has editing focus. Read by the `T`
   * shortcut (see `use-canvas-shortcuts.ts`) so typing "The" into an
   * existing text box never creates a second one — Fabric's own `isEditing`
   * flag on the active object is the source of truth, not any state this
   * hook keeps separately.
   */
  const isTextEditing = useCallback((): boolean => {
    const active = canvasRef.current?.getActiveObject() as PlacedTextbox | undefined
    return Boolean(active?.isEditing)
  }, [])

  /**
   * `T` (no modifier), or the toolbar's Add text button: arms the text tool
   * rather than creating a text box outright — the next click (or
   * click-and-drag) on the canvas is what decides where it lands and how
   * wide it starts, handled by the `mouse:down`/`mouse:up` pair set up in
   * the create-canvas effect above (see `placeTextbox`/`disarmTextPlacement`
   * there). `canvas.skipTargetFind` is set so that click hits the bare
   * canvas regardless of what's underneath — a photograph, a frame, an
   * existing text element — none of which should get selected or dragged by
   * a click that's actually about placing new text.
   *
   * This replaces the previous behavior (create-and-edit a box centered in
   * the viewport, immediately) per direct user feedback: reported twice,
   * for both the button and the `T` key, as text landing somewhere
   * unexpected and effectively vanishing — clicking to "place" the
   * already-created, still-empty box instead read as clicking away from it,
   * which exits editing and discards it as empty content. Superseds this
   * hook's earlier documented decision to never place at the pointer.
   */
  const armTextTool = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (isTextEditing()) return
    if (placingTextRef.current) return

    placingTextRef.current = true
    canvas.discardActiveObject()
    canvas.selection = false
    canvas.skipTargetFind = true
    canvas.defaultCursor = "text"
    canvas.hoverCursor = "text"
    canvas.requestRenderAll()
  }, [isTextEditing])

  /**
   * Selects a page element the way a click on it would: `setActiveObject`
   * fires the same selection events, so the store and the sidebar follow
   * through `notifyFrameSelection`. If the element isn't wholly in view the
   * viewport pans to center it, keeping the zoom (`]`/`[`, issue #19).
   */
  const selectElementOnCanvas = useCallback((elementId: string) => {
    const canvas = canvasRef.current
    const object = elementsRef.current.get(elementId)
    if (!canvas || !object) return
    canvas.setActiveObject(object)

    const vpt = canvas.viewportTransform
    const box = object.getBoundingRect()
    const left = vpt[0] * box.left + vpt[4]
    const top = vpt[3] * box.top + vpt[5]
    const inView =
      left >= 0 &&
      top >= 0 &&
      left + box.width * vpt[0] <= canvas.width &&
      top + box.height * vpt[3] <= canvas.height
    if (!inView) {
      const center = object.getCenterPoint()
      vpt[4] = canvas.width / 2 - vpt[0] * center.x
      vpt[5] = canvas.height / 2 - vpt[3] * center.y
      canvas.setViewportTransform(vpt)
    }
    canvas.requestRenderAll()
  }, [])

  const controls: CanvasControls = { zoom, ready, zoomIn, zoomOut, resetZoom, fitToView }

  return { containerRef, canvasElementRef, controls, armTextTool, isTextEditing, selectElementOnCanvas }
}

function clampZoom(value: number): number {
  return Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM)
}

/** Clamps a normalized `Box` coordinate/dimension to `[0, 1]` — used when
 *  converting a click/drag's scene position into a frame's normalized
 *  coordinates, so a gesture that starts or ends outside the frame's own
 *  bounds (dragging past its edge) doesn't produce a Box that hangs off the
 *  page. */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
