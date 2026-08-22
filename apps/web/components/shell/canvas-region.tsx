"use client"

import { LightTable } from "@/components/sequence/light-table"

/**
 * The canvas. Used to be "the only region that changes shape between modes"
 * back when Sequence/Design/Print were places you navigated to — U12 removes
 * that framing along with the dead SequenceView/DesignView/PrintView render
 * paths those modes used (all three had already stopped being reachable by
 * the time U7's Selection redesign landed; this unit is the actual deletion
 * the comments on that dead code kept pointing to). There is one canvas now,
 * always `LightTable`, and one place besides it — the Book overview in
 * `layers-panel.tsx` — per R19/R20.
 */
export function CanvasRegion() {
  return (
    <div className="relative min-w-0 overflow-hidden canvas-dot-grid">
      <LightTable />
    </div>
  )
}
