"use client"

import { ImagesIcon } from "@phosphor-icons/react"

import { ImportPhotosButton } from "@/components/sequence/import-photos"
import { CanvasControls } from "@/components/sequence/canvas-controls"
import { useFabricCanvas } from "@/components/sequence/use-fabric-canvas"
import { useEditorStore } from "@/state/editor-store"

/**
 * Stage one: the light table.
 *
 * The point is the absence of structure — photographs sit wherever they are
 * put, at whatever size, and the only question the surface answers is how they
 * look next to each other.
 */
export function LightTable() {
  const placements = useEditorStore((state) => state.project.canvas.placements)
  const assets = useEditorStore((state) => state.project.assets)
  const frames = useEditorStore((state) => state.project.frames)
  const movePlacement = useEditorStore((state) => state.movePlacement)
  const scalePlacement = useEditorStore((state) => state.scalePlacement)
  const reorderFrameById = useEditorStore((state) => state.reorderFrameById)

  // Right-click promotion into an Edit lived here; Edit is gone from the data
  // model (see core/src/frames.ts), and its replacement — dropping a photo
  // onto a frame — is a later unit's concern. Context-menu interactions on the
  // canvas stay deferred per CLAUDE.md until then, so this is a no-op for now.
  const { containerRef, canvasElementRef, controls } = useFabricCanvas({
    placements,
    assets,
    frames,
    onMove: movePlacement,
    onScale: scalePlacement,
    onContextMenu: () => {},
    onReorderFrame: reorderFrameById,
  })

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* The observed element. Deliberately overflow-hidden: observing a
          scrollable ancestor would let the canvas and its scrollbar feed each
          other in a resize loop. */}
      <div ref={containerRef} className="absolute inset-0">
        <canvas ref={canvasElementRef} className="absolute inset-0" />
      </div>

      {assets.length === 0 ? <EmptyTable /> : <ImportAffordance />}

      <CanvasControls controls={controls} />
    </div>
  )
}

function EmptyTable() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 text-center">
        <ImagesIcon className="size-8 text-muted-foreground" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Bring in your photographs and spread them out. Move them around, put
          pairs side by side, and see what the sequence wants to be.
        </p>
        <ImportPhotosButton />
      </div>
    </div>
  )
}

/** Import stays reachable once the table has photographs on it — the empty
 *  state is copy, not the only door in. */
function ImportAffordance() {
  const progress = useEditorStore((state) => state.importProgress)

  return (
    <div className="absolute top-3 left-3 z-20 flex items-center gap-2 rounded-xl border bg-background/90 p-1 shadow-sm backdrop-blur">
      <ImportPhotosButton variant="icon" />
      {progress && (
        <span className="pr-2 text-xs text-muted-foreground">
          Importing {progress.done} of {progress.total}…
        </span>
      )}
    </div>
  )
}
