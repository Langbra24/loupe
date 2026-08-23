"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Canvas, FabricImage, FabricObject, TPointerEventInfo } from "fabric"
import { boundingBoxOf, frameAt, type Asset, type Box, type CanvasPlacement, type Frame } from "@loupe/core"

import { frameGridOriginY, layoutFrames, nearestFrameIndex, type FrameLayout } from "@/components/sequence/frame-grid"
import { thumbnailUrl } from "@/lib/storage/assets"

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 8

/** Padding around the arrangement when fitting it to the viewport. */
const FIT_PADDING = 80

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
  onMove: (placementId: string, x: number, y: number) => void
  onScale: (placementId: string, scale: number) => void
  onContextMenu: (placementId: string, viewportX: number, viewportY: number) => void
  /** A frame was dragged and dropped near a different slot in the grid.
   *  `from`/`to` are array indices, matching `reorderFrame`'s signature. */
  onReorderFrame: (from: number, to: number) => void
  /** A pasteboard photograph was dragged and dropped onto a frame's bounds —
   *  it joins that frame's elements and leaves the pasteboard. */
  onDropOnFrame: (placementId: string, frameId: string) => void
  /**
   * A text box created via `T` finished editing while its center sat over a
   * frame's bounds — it becomes that frame's text element. See the
   * `text:editing:exited` handler below for what happens when it doesn't.
   */
  onCreateText: (frameId: string, content: string) => void
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
  /** A frame element was dragged and/or resized; `patch` is its new
   *  normalized `Box`, computed from the object's on-canvas position/size
   *  against the frame's current bounds. */
  onUpdateElementBox: (frameId: string, elementId: string, patch: Partial<Box>) => void
  /** An already-placed text element finished an in-place edit (double-click
   *  to re-enter, then blur/Escape/click-away to exit — Fabric's own
   *  triggers). Distinct from `onCreateText`, which is for a brand-new
   *  pasteboard textbox landing on a frame for the first time. */
  onUpdateTextContent: (frameId: string, elementId: string, content: string) => void
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
    onMove,
    onScale,
    onContextMenu,
    onReorderFrame,
    onDropOnFrame,
    onCreateText,
    onSelectFrame,
    onSelectElement,
    onUpdateElementBox,
    onUpdateTextContent,
  } = options

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const objectsRef = useRef(new Map<string, PlacedObject>())
  const framesRef = useRef(new Map<string, PlacedFrame>())
  const elementsRef = useRef(new Map<string, PlacedElement>())
  /** Element ids currently loading (image elements await a thumbnail URL) —
   *  same overlapping-sync guard `pendingRef` gives placements. */
  const elementsPendingRef = useRef(new Set<string>())
  /** The dashed highlight shown over the slot a dragged frame would land in.
   *  At most one exists at a time; `null` when no frame drag is in progress. */
  const indicatorRef = useRef<FabricObject | null>(null)
  /** Placements whose image is loading. Reserved synchronously so a second
   *  overlapping sync pass cannot start drawing the same one. */
  const pendingRef = useRef(new Set<string>())

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
    onReorderFrame,
    onDropOnFrame,
    onCreateText,
    onSelectFrame,
    onSelectElement,
    onUpdateElementBox,
    onUpdateTextContent,
  })
  const latest = useRef({ placements, assets, frames })

  /** Set by the create-canvas effect once the Fabric module has loaded, so
   *  `createTextbox` (called from outside that effect, by the keyboard
   *  shortcut) can construct a `fabric.Textbox` without importing it again. */
  const fabricRef = useRef<typeof import("fabric") | null>(null)

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
      onReorderFrame,
      onDropOnFrame,
      onCreateText,
      onSelectFrame,
      onSelectElement,
      onUpdateElementBox,
      onUpdateTextContent,
    }
    latest.current = { placements, assets, frames }
  })

  useEffect(() => {
    let disposed = false
    let canvas: Canvas | null = null

    void (async () => {
      const fabric = await import("fabric")
      if (disposed || !canvasElementRef.current) return
      fabricRef.current = fabric

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
      })

      canvasRef.current = canvas

      /**
       * The insertion-point indicator shown while a frame is being dragged:
       * a dashed highlight over the slot the frame would land in if dropped
       * now. Chosen over a thin line between slots because a highlighted
       * rect reads unambiguously as "this slot" at a glance, whereas a line
       * at a boundary is easy to misread as belonging to either neighbor.
       * Cyan with a visible stroke width — deliberately not the muted tones
       * already in use elsewhere on the canvas, so it stays legible once the
       * canvas background goes black in a later unit (U10).
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
            stroke: "#22d3ee",
            strokeWidth: 4,
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

      /* Zoom: keep the point under the cursor fixed. */
      canvas.on("mouse:wheel", (opt: TPointerEventInfo<WheelEvent>) => {
        const target = canvasRef.current
        if (!target) return

        const next = clampZoom(target.getZoom() * 0.999 ** opt.e.deltaY)
        target.zoomToPoint(opt.viewportPoint, next)
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

        if (isRight) {
          const placed = opt.target as PlacedObject | undefined
          if (placed?.placementId) {
            handlers.current.onContextMenu(
              placed.placementId,
              opt.viewportPoint.x,
              opt.viewportPoint.y,
            )
          }
          return
        }

        if (isMiddle || !opt.target) {
          panning = true
          target.selection = false
          panFrom = { x: event.clientX, y: event.clientY }
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
      const notifyFrameSelection = () => {
        const active = canvasRef.current?.getActiveObject() as
          | (PlacedFrame & Partial<PlacedElement>)
          | undefined

        if (active?.elementId && active.frameId) {
          handlers.current.onSelectElement(active.frameId, active.elementId)
          return
        }

        handlers.current.onSelectFrame(active?.frameId ?? null)
      }
      canvas.on("selection:created", notifyFrameSelection)
      canvas.on("selection:updated", notifyFrameSelection)
      canvas.on("selection:cleared", () => handlers.current.onSelectFrame(null))

      canvas.on("mouse:move", (opt) => {
        if (!panning) return
        const target = canvasRef.current
        if (!target) return

        const event = opt.e as MouseEvent
        const vpt = target.viewportTransform
        vpt[4] += event.clientX - panFrom.x
        vpt[5] += event.clientY - panFrom.y
        target.setViewportTransform(vpt)
        panFrom = { x: event.clientX, y: event.clientY }
      })

      canvas.on("mouse:up", () => {
        const target = canvasRef.current
        if (!target) return
        panning = false
        target.selection = true
        clearInsertionIndicator()
      })

      /* While a frame is mid-drag, show which grid slot it would land in.
         `object:moving` fires continuously for the object under the pointer,
         so this doesn't need its own mouse:move listener. */
      canvas.on("object:moving", (opt) => {
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
        const placed = opt.target as (PlacedObject & Partial<PlacedFrame> & Partial<PlacedElement>) | undefined
        if (!placed) return

        // Checked first: an element also has no `placementId`, but unlike a
        // frame's own background Rect it carries both `frameId` and
        // `elementId` together, which is what actually disambiguates it from
        // the other two branches below.
        if (placed.elementId && placed.frameId) {
          const { frames: currentFrames, placements, assets } = latest.current
          const originY = frameGridOriginY(placements, assets)
          const layout = layoutFrames(currentFrames, originY).find((l) => l.frameId === placed.frameId)
          if (!layout || layout.bounds.width === 0 || layout.bounds.height === 0) return

          // Fabric reports position/size pre-scale; the object's actual
          // on-canvas footprint is width/height times scaleX/scaleY. Reading
          // through scale here is what makes a corner-drag resize (not just
          // a move) persist correctly as a new normalized Box.
          const absWidth = (placed.width ?? 0) * (placed.scaleX ?? 1)
          const absHeight = (placed.height ?? 0) * (placed.scaleY ?? 1)

          handlers.current.onUpdateElementBox(placed.frameId, placed.elementId, {
            x: ((placed.left ?? 0) - layout.bounds.x) / layout.bounds.width,
            y: ((placed.top ?? 0) - layout.bounds.y) / layout.bounds.height,
            width: absWidth / layout.bounds.width,
            height: absHeight / layout.bounds.height,
          })
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
              placed.animate(
                { left: own.bounds.x + own.bounds.width / 2, top: own.bounds.y + own.bounds.height / 2 },
                { duration: 200, easing: fabric.util.ease.easeInOutQuad, onChange: () => canvasRef.current?.requestRenderAll() },
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
       * this hit test. Re-entering editing (Fabric's built-in double-click
       * behavior) and exiting again re-evaluates the hit test at the box's
       * current position, so moving it onto a frame and re-editing is how a
       * miss gets a second chance.
       */
      canvas.on("text:editing:exited", (opt) => {
        const target_canvas = canvasRef.current
        if (!target_canvas) return

        const textbox = opt.target as unknown as PlacedTextbox & Partial<PlacedElement>
        const content = (textbox.text ?? "").trim()

        // Re-editing an already-placed frame text element (double-click,
        // Fabric's own built-in trigger) commits its content in place —
        // distinct from a fresh pasteboard textbox landing on a frame for
        // the first time, which is everything below this branch.
        if (textbox.elementId && textbox.frameId) {
          handlers.current.onUpdateTextContent(textbox.frameId, textbox.elementId, content)
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

        handlers.current.onCreateText(hitFrameId, content)
        target_canvas.remove(textbox)
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

    return () => {
      disposed = true
      setReady(false)
      objects.clear()
      inFlight.clear()
      drawnFrames.clear()
      drawnElements.clear()
      elementsInFlight.clear()
      indicatorRef.current = null
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
        borderColor: "#6366f1",
        cornerColor: "#6366f1",
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
    const live = framesRef.current

    // Remove frame objects whose frame no longer exists.
    for (const [frameId, object] of live) {
      if (!layoutById.has(frameId)) {
        canvas.remove(object)
        live.delete(frameId)
      }
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
          stroke: "#94a3b8",
          strokeWidth: 2,
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
      if (existing === canvas.getActiveObject()) continue

      const dx = Math.abs((existing.left ?? 0) - centerX)
      const dy = Math.abs((existing.top ?? 0) - centerY)
      if (dx < 0.5 && dy < 0.5) continue

      // Motion convention (see the `animations` skill): under 300ms,
      // ease-in-out, using Fabric's own tween rather than a hand-rolled RAF
      // loop.
      existing.animate(
        { left: centerX, top: centerY },
        {
          duration: 250,
          easing: fabric.util.ease.easeInOutQuad,
          onChange: () => canvasRef.current?.requestRenderAll(),
        },
      )
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
   * Second known limitation: an image element's `fit` (`'cover'`/`'contain'`)
   * is not honored here — every image stretches to exactly fill its `Box`,
   * the same way scaleX/scaleY are computed for any other resize. True
   * cover/contain needs a clip region independent of the object's own scale
   * (Fabric's `clipPath`, or separate `cropX`/`cropY` bookkeeping), which is
   * real scope, not a one-line fix. Full-bleed elements (the only shape
   * `moveToFrame`/`createTextElement` produce today) look correct regardless,
   * since a box that exactly matches the image's own aspect ratio stretches
   * and crops identically.
   */
  const syncFrameElements = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const fabric = await import("fabric")
    const { frames: currentFrames, placements: currentPlacements, assets: pool } = latest.current
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
          // Don't fight the object currently under the user's pointer.
          if (existing === canvas.getActiveObject()) continue

          const dx = Math.abs((existing.left ?? 0) - absLeft)
          const dy = Math.abs((existing.top ?? 0) - absTop)
          const dw = Math.abs((existing.width ?? 0) * (existing.scaleX ?? 1) - absWidth)
          const dh = Math.abs((existing.height ?? 0) * (existing.scaleY ?? 1) - absHeight)
          if (dx < 0.5 && dy < 0.5 && dw < 0.5 && dh < 0.5) continue

          existing.set({
            left: absLeft,
            top: absTop,
            scaleX: existing.width ? absWidth / existing.width : 1,
            scaleY: existing.height ? absHeight / existing.height : 1,
          })
          existing.setCoords()
          continue
        }

        if (pending.has(element.id)) continue

        if (element.kind === "text") {
          const textbox = new fabric.Textbox(element.content, {
            left: absLeft,
            top: absTop,
            originX: "left",
            originY: "top",
            width: Math.max(absWidth, 20),
            // No typographic scale is threaded into this hook — a role-aware
            // size (title/subtitle/body/caption) is a follow-up; this reads
            // as a sensible default sized off the box itself, not a promise
            // that it matches the sidebar's type scale yet.
            fontSize: Math.max(absHeight * 0.5, 14),
            fill: "#f4f4f5",
            textAlign: element.align,
            lockRotation: true,
            lockSkewingX: true,
            lockSkewingY: true,
          }) as unknown as PlacedElement
          textbox.frameId = frame.id
          textbox.elementId = element.id
          textbox.elementKind = "text"
          textbox.setControlsVisibility({ mtr: false })

          canvas.add(textbox)
          live.set(element.id, textbox)
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

            image.set({
              left: absLeft,
              top: absTop,
              originX: "left",
              originY: "top",
              scaleX: image.width ? absWidth / image.width : 1,
              scaleY: image.height ? absHeight / image.height : 1,
              borderColor: "#6366f1",
              cornerColor: "#6366f1",
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
            canvasRef.current.requestRenderAll()
          } finally {
            pending.delete(element.id)
          }
        })()
      }
    }

    canvas.requestRenderAll()
  }, [])

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
   * `T` (no modifier): create a `Textbox` centered in the current viewport
   * and immediately enter editing (KTD5) — never at the pointer position,
   * per the plan's committed decision.
   */
  const createTextbox = useCallback(() => {
    const canvas = canvasRef.current
    const fabric = fabricRef.current
    if (!canvas || !fabric) return
    if (isTextEditing()) return

    const centre = canvas.getVpCenter()
    const textbox = new fabric.Textbox("", {
      left: centre.x,
      top: centre.y,
      originX: "center",
      originY: "center",
      width: 320,
      fontSize: 32,
      fill: "#f4f4f5",
      textAlign: "left",
    })

    canvas.add(textbox)
    canvas.setActiveObject(textbox)
    textbox.enterEditing()
    canvas.requestRenderAll()
  }, [isTextEditing])

  const controls: CanvasControls = { zoom, ready, zoomIn, zoomOut, resetZoom, fitToView }

  return { containerRef, canvasElementRef, controls, createTextbox, isTextEditing }
}

function clampZoom(value: number): number {
  return Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM)
}
