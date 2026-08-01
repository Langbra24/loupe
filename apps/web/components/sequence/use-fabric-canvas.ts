"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Canvas, FabricImage, FabricObject, TPointerEventInfo } from "fabric"
import { boundingBoxOf, type Asset, type CanvasPlacement } from "@loupe/core"

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
  onMove: (placementId: string, x: number, y: number) => void
  onScale: (placementId: string, scale: number) => void
  onContextMenu: (placementId: string, viewportX: number, viewportY: number) => void
}

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
  const { placements, assets, onMove, onScale, onContextMenu } = options

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const objectsRef = useRef(new Map<string, PlacedObject>())

  const [zoom, setZoom] = useState(1)
  const [ready, setReady] = useState(false)

  // Handlers are read through a ref so the Fabric listeners can be bound once.
  // Rebinding them on every render would tear down the canvas mid-gesture.
  const handlers = useRef({ onMove, onScale, onContextMenu })
  handlers.current = { onMove, onScale, onContextMenu }

  const latest = useRef({ placements, assets })
  latest.current = { placements, assets }

  /** Set once `fitToView` is defined below; read by the first-frame effect so
   *  that effect does not depend on the callback's identity. */
  const fitToViewRef = useRef<() => void>(() => undefined)

  /* ---------------------------------------------------------------- */
  /* Create and dispose                                                */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let disposed = false
    let canvas: Canvas | null = null

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
      })

      canvasRef.current = canvas

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
      })

      /* Write position and scale back to the store when a gesture ends —
         not per frame, which would commit a store write per pointer move. */
      canvas.on("object:modified", (opt) => {
        const placed = opt.target as PlacedObject | undefined
        if (!placed?.placementId) return

        handlers.current.onMove(placed.placementId, placed.left ?? 0, placed.top ?? 0)
        handlers.current.onScale(
          placed.placementId,
          (placed.scaleX ?? 1) / (placed.naturalScale || 1),
        )
      })

      setReady(true)
      void syncObjects()
    })()

    return () => {
      disposed = true
      setReady(false)
      objectsRef.current.clear()
      const target = canvasRef.current
      canvasRef.current = null
      void target?.dispose()
    }
    // Created once for the lifetime of the mounted stage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    for (const placement of current) {
      if (live.has(placement.id)) continue

      const asset = assetById.get(placement.assetId)
      if (!asset) continue

      const url = await thumbnailUrl(placement.assetId)
      if (!url || !canvasRef.current) continue

      const fabric = await import("fabric")
      const image: FabricImage = await fabric.FabricImage.fromURL(url)

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
      })
      const placed = image as PlacedObject
      placed.placementId = placement.id
      placed.naturalScale = naturalScale

      canvasRef.current.add(image)
      live.set(placement.id, placed)
    }

    canvasRef.current?.requestRenderAll()
  }, [])

  useEffect(() => {
    if (!ready) return
    void syncObjects()
  }, [ready, placements, assets, syncObjects])

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

  fitToViewRef.current = fitToView

  const controls: CanvasControls = { zoom, ready, zoomIn, zoomOut, resetZoom, fitToView }

  return { containerRef, canvasElementRef, controls }
}

function clampZoom(value: number): number {
  return Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM)
}
