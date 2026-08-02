"use client"

import { useEffect } from "react"

import { CanvasRegion } from "@/components/shell/canvas-region"
import { ErrorBanner } from "@/components/shell/error-banner"
import { InspectorPanel } from "@/components/shell/inspector-panel"
import { LayersPanel } from "@/components/shell/layers-panel"
import { ModeSwitcher } from "@/components/shell/mode-switcher"
import { TopNav } from "@/components/shell/top-nav"
import { registerSaveFlush } from "@/lib/storage/project"
import { useEditorStore } from "@/state/editor-store"

const LEFT_PANEL_WIDTH = "15rem" // 240px — matches LayersPanel's w-60
const RIGHT_PANEL_WIDTH = "18rem" // 288px — matches InspectorPanel's w-72

/**
 * The fixed frame.
 *
 * Panels are grid columns that collapse to zero width, so the canvas column
 * genuinely resizes rather than being covered by a floating overlay. That was
 * a deliberate call — see docs/plans/00-initial-build-brief.md. Panels keep
 * their intrinsic width and are clipped by the column during the transition,
 * which is what stops their contents reflowing as they open and close.
 */
export function AppShell() {
  const leftPanelOpen = useEditorStore((state) => state.leftPanelOpen)
  const rightPanelOpen = useEditorStore((state) => state.rightPanelOpen)
  const hydrate = useEditorStore((state) => state.hydrate)

  // IndexedDB is client-only, so the store starts as a valid empty project and
  // real state arrives after mount. Doing this any earlier is a hydration
  // mismatch rather than a visible error.
  useEffect(() => {
    void hydrate()
    return registerSaveFlush()
  }, [hydrate])

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <TopNav />

      <div
        className="relative grid min-h-0 flex-1 transition-[grid-template-columns] duration-200 ease-out"
        style={{
          gridTemplateColumns: [
            leftPanelOpen ? LEFT_PANEL_WIDTH : "0rem",
            "minmax(0, 1fr)",
            rightPanelOpen ? RIGHT_PANEL_WIDTH : "0rem",
          ].join(" "),
        }}
      >
        <div className="min-w-0 overflow-hidden">
          <LayersPanel />
        </div>

        <CanvasRegion />

        <div className="min-w-0 overflow-hidden">
          <InspectorPanel />
        </div>

        {/* Floats above the canvas, anchored to the top-right of the whole
            region so the right panel reads as growing out of it. */}
        <ModeSwitcher />

        <ErrorBanner />
      </div>
    </div>
  )
}
