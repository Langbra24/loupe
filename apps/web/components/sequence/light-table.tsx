"use client"

import { ImagesIcon } from "@phosphor-icons/react"

import { BookSetupDialog } from "@/components/sequence/book-setup-dialog"
import { ImportPhotosButton } from "@/components/sequence/import-photos"
import { CanvasControls } from "@/components/sequence/canvas-controls"
import { useFabricCanvas } from "@/components/sequence/use-fabric-canvas"
import { useTextToolShortcut, useUndoShortcut } from "@/components/sequence/use-canvas-shortcuts"
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
  const moveToFrame = useEditorStore((state) => state.moveToFrame)
  const createTextElement = useEditorStore((state) => state.createTextElement)
  const selectFrame = useEditorStore((state) => state.selectFrame)
  const selectElement = useEditorStore((state) => state.selectElement)
  const clearSelection = useEditorStore((state) => state.clearSelection)
  const updateElementBox = useEditorStore((state) => state.updateElementBox)
  const updateTextElement = useEditorStore((state) => state.updateTextElement)
  const undo = useEditorStore((state) => state.undo)

  // Right-click promotion into an Edit lived here; Edit is gone from the data
  // model (see core/src/frames.ts), and its replacement — dropping a photo
  // onto a frame — is a later unit's concern. Context-menu interactions on the
  // canvas stay deferred per CLAUDE.md until then, so this is a no-op for now.
  const { containerRef, canvasElementRef, controls, createTextbox, isTextEditing } = useFabricCanvas({
    placements,
    assets,
    frames,
    onMove: movePlacement,
    onScale: scalePlacement,
    onContextMenu: () => {},
    onReorderFrame: reorderFrameById,
    onDropOnFrame: moveToFrame,
    onCreateText: createTextElement,
    onSelectFrame: (frameId) => (frameId ? selectFrame(frameId) : clearSelection()),
    onSelectElement: selectElement,
    onUpdateElementBox: updateElementBox,
    onUpdateTextContent: (frameId, elementId, content) =>
      updateTextElement(frameId, elementId, { content }),
  })

  // `T` creates and inline-edits a pasteboard text box (U6).
  useTextToolShortcut({ enabled: true, isTextboxEditing: isTextEditing, createTextbox })
  // Cmd/Ctrl+Z undoes the last reorder/move/create/delete/text-edit (U8).
  useUndoShortcut({ enabled: true, undo })

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* The observed element. Deliberately overflow-hidden: observing a
          scrollable ancestor would let the canvas and its scrollbar feed each
          other in a resize loop. */}
      <div ref={containerRef} className="absolute inset-0">
        <canvas ref={canvasElementRef} className="absolute inset-0" />
      </div>

      {assets.length === 0 ? <EmptyTable /> : <ImportAffordance />}

      {assets.length > 0 && frames.length === 0 && <BookSetupDialog />}

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
