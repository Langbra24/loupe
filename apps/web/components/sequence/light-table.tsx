"use client"

import { useRef, useState } from "react"
import { ImagesIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { useFabricCanvas } from "@/components/sequence/use-fabric-canvas"
import { useEditorStore } from "@/state/editor-store"

export interface ContextMenuTarget {
  placementId: string
  x: number
  y: number
}

/**
 * Stage one: the light table.
 *
 * The whole point is absence of structure — photographs sit wherever they are
 * put, at whatever size, and the only question the surface answers is how they
 * look next to each other.
 */
export function LightTable() {
  const placements = useEditorStore((state) => state.project.canvas.placements)
  const assets = useEditorStore((state) => state.project.assets)
  const movePlacement = useEditorStore((state) => state.movePlacement)
  const scalePlacement = useEditorStore((state) => state.scalePlacement)

  const [menu, setMenu] = useState<ContextMenuTarget | null>(null)

  const { containerRef, canvasElementRef, controls } = useFabricCanvas({
    placements,
    assets,
    onMove: movePlacement,
    onScale: scalePlacement,
    onContextMenu: (placementId, x, y) => setMenu({ placementId, x, y }),
  })

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* The observed element. Deliberately overflow-hidden: observing a
          scrollable ancestor would let the canvas and its scrollbar feed each
          other in a resize loop. */}
      <div ref={containerRef} className="absolute inset-0">
        <canvas ref={canvasElementRef} className="absolute inset-0" />
      </div>

      {assets.length === 0 && <EmptyTable />}

      {menu && (
        <PromotionMenu target={menu} onClose={() => setMenu(null)} />
      )}

      <CanvasControlsSlot controls={controls} />
    </div>
  )
}

/** Filled in by U6; kept as a named seam so the canvas doesn't need editing. */
function CanvasControlsSlot({ controls }: { controls: ReturnType<typeof useFabricCanvas>["controls"] }) {
  void controls
  return null
}

/** Filled in by U7. */
function PromotionMenu({
  target,
  onClose,
}: {
  target: ContextMenuTarget
  onClose: () => void
}) {
  void target
  void onClose
  return null
}

function EmptyTable() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const importPhotos = useEditorStore((state) => state.importPhotos)
  const progress = useEditorStore((state) => state.importProgress)

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 text-center">
        <ImagesIcon className="size-8 text-muted-foreground" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Bring in your photographs and spread them out. Move them around, put
          pairs side by side, and see what the sequence wants to be.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ""
            void importPhotos(files)
          }}
        />
        <Button size="sm" onClick={() => inputRef.current?.click()} disabled={!!progress}>
          {progress ? `Importing ${progress.done} of ${progress.total}…` : "Import photos"}
        </Button>
      </div>
    </div>
  )
}
