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
