"use client"

import { useEffect, useState } from "react"

import { CanvasRegion } from "@/components/shell/canvas-region"
import { ErrorBanner } from "@/components/shell/error-banner"
import { FeedbackControl } from "@/components/shell/feedback-control"
import { InspectorPanel } from "@/components/shell/inspector-panel"
import { Introduction, IntroductionReopenButton } from "@/components/shell/introduction"
import { LayersPanel } from "@/components/shell/layers-panel"
import { TopNav } from "@/components/shell/top-nav"
import { useFrameKeyboardShortcuts } from "@/components/sequence/use-canvas-shortcuts"
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
  const frameCount = useEditorStore((state) => state.project.frames.length)
  const reorderFrameById = useEditorStore((state) => state.reorderFrameById)

  // IndexedDB is client-only, so the store starts as a valid empty project and
  // real state arrives after mount. Doing this any earlier is a hydration
  // mismatch rather than a visible error.
  useEffect(() => {
    void hydrate()
    return registerSaveFlush()
  }, [hydrate])

  // Keyboard parity for frame reorder (R30) — see use-canvas-shortcuts.ts.
  // There is no visible frame grid to focus yet (that lands with the canvas
  // worktree's frame rendering), so this tracks a bare focused-index and wires
  // it straight to the store; it composes once the grid exists to draw the
  // focus ring against.
  const [focusedFrameIndex, setFocusedFrameIndex] = useState<number | null>(null)
  useFrameKeyboardShortcuts({
    enabled: true,
    frameCount,
    focusedFrameIndex,
    setFocusedFrameIndex,
    reorderFrameById,
  })

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

        <Introduction />
        <ErrorBanner />

        {/* Bottom-left: feedback and the introduction's reopen control sit
            together (R23, R32) — see error-banner.tsx for why it moved up
            to bottom-16 rather than sharing this exact spot. */}
        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2">
          <IntroductionReopenButton />
          <FeedbackControl />
        </div>
      </div>
    </div>
  )
}
