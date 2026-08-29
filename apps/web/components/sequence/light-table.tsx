"use client"

import { useEffect, useState } from "react"
import { ImagesIcon } from "@phosphor-icons/react"
import type { ImagePreset } from "@loupe/core"

import { BookSetupDialog } from "@/components/sequence/book-setup-dialog"
import { ImportPhotosButton } from "@/components/sequence/import-photos"
import { CanvasControls } from "@/components/sequence/canvas-controls"
import { useFabricCanvas } from "@/components/sequence/use-fabric-canvas"
import { useTextToolShortcut, useUndoShortcut } from "@/components/sequence/use-canvas-shortcuts"
import { useEditorStore } from "@/state/editor-store"

interface ImageMenuTarget {
  frameId: string
  elementId: string
  x: number
  y: number
}

const IMAGE_PRESET_LABELS: Record<ImagePreset, string> = {
  "full-bleed": "Full bleed",
  centered: "Centered",
  "left-half": "Left half",
}

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
  const applyImagePreset = useEditorStore((state) => state.applyImagePreset)
  const undo = useEditorStore((state) => state.undo)

  // Right-click promotion into an Edit lived here; Edit is gone from the data
  // model (see core/src/frames.ts) and its replacement — dropping a photo
  // onto a frame — landed as an ordinary drag. Right-click on a pasteboard
  // photograph itself stays deferred per CLAUDE.md; right-click on an image
  // already *inside* a frame does not — that opens the layout-preset menu
  // below, at the user's explicit direction overriding that deferral.
  const [imageMenu, setImageMenu] = useState<ImageMenuTarget | null>(null)

  const { containerRef, canvasElementRef, controls, createTextbox, isTextEditing } = useFabricCanvas({
    placements,
    assets,
    frames,
    onMove: movePlacement,
    onScale: scalePlacement,
    onContextMenu: () => {},
    onImageContextMenu: (frameId, elementId, x, y) => setImageMenu({ frameId, elementId, x, y }),
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
      <div ref={containerRef} className="absolute inset-0 canvas-dot-grid">
        <canvas ref={canvasElementRef} className="absolute inset-0" />
      </div>

      {assets.length === 0 ? <EmptyTable /> : <ImportAffordance />}

      {assets.length > 0 && frames.length === 0 && <BookSetupDialog />}

      <CanvasControls controls={controls} />

      {imageMenu && (
        <ImagePresetMenu
          target={imageMenu}
          onDismiss={() => setImageMenu(null)}
          onSelect={(preset) => {
            applyImagePreset(imageMenu.frameId, imageMenu.elementId, preset)
            setImageMenu(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Fixed layout presets for an image already inside a frame — right-click
 * access, same convention a desktop layout tool would use for "arrange"
 * commands. Positioned at the click point in viewport coordinates, which is
 * the same coordinate space `containerRef` occupies, so no conversion is
 * needed between the Fabric event and this DOM overlay.
 */
function ImagePresetMenu({
  target,
  onSelect,
  onDismiss,
}: {
  target: ImageMenuTarget
  onSelect: (preset: ImagePreset) => void
  onDismiss: () => void
}) {
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss()
    }
    window.addEventListener("keydown", dismiss)
    return () => window.removeEventListener("keydown", dismiss)
  }, [onDismiss])

  return (
    <>
      {/* Click-away target, behind the menu itself. */}
      <div className="fixed inset-0 z-30" onClick={onDismiss} onContextMenu={(e) => e.preventDefault()} />
      <div
        className="absolute z-40 min-w-40 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        style={{ left: target.x, top: target.y }}
      >
        {(Object.keys(IMAGE_PRESET_LABELS) as ImagePreset[]).map((preset) => (
          <button
            key={preset}
            onClick={() => onSelect(preset)}
            className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
          >
            {IMAGE_PRESET_LABELS[preset]}
          </button>
        ))}
      </div>
    </>
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
