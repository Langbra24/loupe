"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Canvas, FabricImage, FabricObject, TPointerEventInfo } from "fabric"
import { boundingBoxOf, frameAt, type Asset, type CanvasPlacement, type Frame } from "@loupe/core"

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
  const { placements, assets, frames, onMove, onScale, onContextMenu, onReorderFrame, onDropOnFrame, onCreateText } =
    options

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const objectsRef = useRef(new Map<string, PlacedObject>())
  const framesRef = useRef(new Map<string, PlacedFrame>())
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
  const handlers = useRef({ onMove, onScale, onContextMenu, onReorderFrame, onDropOnFrame, onCreateText })
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
    handlers.current = { onMove, onScale, onContextMenu, onReorderFrame, onDropOnFrame, onCreateText }
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
        const placed = opt.target as (PlacedObject & Partial<PlacedFrame>) | undefined
        if (!placed) return

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

        const textbox = opt.target as PlacedTextbox
        const content = (textbox.text ?? "").trim()

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

    return () => {
      disposed = true
      setReady(false)
      objects.clear()
      inFlight.clear()
      drawnFrames.clear()
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

  /**
   * Frame the arrangement the first time photographs appear.
   *
   * Scene units are original image pixels, so a 4000px photograph at 100% zoom
   * fills the viewport several times over. Without this, the first thing a user
   * sees after importing is the inside of one photo.
   */
  const framed = useRef(false)
  useEffect(() => {
    if (!ready || framed.current || placements.length === 0) return
    framed.current = true
    // After the sync effect has had a turn to add the objects.
    const id = setTimeout(() => fitToViewRef.current(), 60)
    return () => clearTimeout(id)
  }, [ready, placements.length])

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

    const { placements: current, assets: pool } = latest.current
    const box = boundingBoxOf(current, pool)

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
