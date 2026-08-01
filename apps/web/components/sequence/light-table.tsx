"use client"

import { useRef, useState } from "react"
import { ImagesIcon, PlusIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CanvasControls } from "@/components/sequence/canvas-controls"
import { useFabricCanvas } from "@/components/sequence/use-fabric-canvas"
import { useEditorStore } from "@/state/editor-store"

interface MenuTarget {
  placementId: string
  x: number
  y: number
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
  const movePlacement = useEditorStore((state) => state.movePlacement)
  const scalePlacement = useEditorStore((state) => state.scalePlacement)

  const [menu, setMenu] = useState<MenuTarget | null>(null)

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

      {menu && <PromotionMenu target={menu} onClose={() => setMenu(null)} />}

      <CanvasControls controls={controls} />
    </div>
  )
}

/**
 * Right-click promotion.
 *
 * Scoped to promotion actions only — the build brief deferred canvas context
 * menus, and this reverses that narrowly rather than opening the door to a
 * general duplicate/delete/z-order menu.
 */
function PromotionMenu({
  target,
  onClose,
}: {
  target: MenuTarget
  onClose: () => void
}) {
  const edits = useEditorStore((state) => state.project.edits)
  const placements = useEditorStore((state) => state.project.canvas.placements)
  const addAssetToEdit = useEditorStore((state) => state.addAssetToEdit)
  const newEditFromAsset = useEditorStore((state) => state.newEditFromAsset)

  const assetId = placements.find((p) => p.id === target.placementId)?.assetId
  if (!assetId) return null

  return (
    <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
      {/* A zero-size anchor at the cursor, so the menu opens where the user
          right-clicked rather than against some fixed element. Base UI expects
          a real button here — a span loses native button semantics. */}
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none absolute"
            style={{ left: target.x, top: target.y, width: 0, height: 0 }}
          />
        }
      />
      <DropdownMenuContent align="start" side="bottom" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Add to edit</DropdownMenuLabel>

          {edits.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No edits yet.
            </p>
          )}

          {edits.map((edit) => (
            <DropdownMenuItem
              key={edit.id}
              onClick={() => {
                addAssetToEdit(edit.id, assetId)
                onClose()
              }}
            >
              {edit.name}
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {edit.memberIds.length}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            newEditFromAsset(assetId)
            onClose()
          }}
        >
          <PlusIcon data-icon="inline-start" />
          New edit from this photo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
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
