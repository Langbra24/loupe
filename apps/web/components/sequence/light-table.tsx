"use client"

import { useEffect, useState } from "react"
import { ImagesIcon } from "@phosphor-icons/react"
import { Redo2Icon, Trash2Icon, TypeIcon, Undo2Icon } from "lucide-react"
import type { ImagePreset } from "@loupe/core"

import { BookSetupDialog } from "@/components/sequence/book-setup-dialog"
import { ImportPhotosButton } from "@/components/sequence/import-photos"
import { CanvasControls } from "@/components/sequence/canvas-controls"
import { useFabricCanvas } from "@/components/sequence/use-fabric-canvas"
import {
  useCopyPasteShortcut,
  useDeleteSelectionShortcut,
  useTextToolShortcut,
  useUndoShortcut,
  type DeletableSelection,
} from "@/components/sequence/use-canvas-shortcuts"
import { modifierLabel, usePlatform } from "@/components/sequence/use-platform"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useEditorStore } from "@/state/editor-store"

/** Matches `CanvasControls`' tooltip delay (same feel across the canvas's
 *  floating chrome). */
const TOOLTIP_DELAY_MS = 600

interface ImageMenuTarget {
  frameId: string
  elementId: string
  x: number
  y: number
}

interface FrameMenuTarget {
  frameId: string
  x: number
  y: number
}

interface EmptyCanvasMenuTarget {
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
  const pageSize = useEditorStore((state) => state.project.pageSize)
  const typeBaseSize = useEditorStore((state) => state.project.typeBaseSize)
  const typeRatio = useEditorStore((state) => state.project.typeRatio)
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
  const copySelectedFrame = useEditorStore((state) => state.copySelectedFrame)
  const pasteFrame = useEditorStore((state) => state.pasteFrame)
  const addPairedPage = useEditorStore((state) => state.addPairedPage)
  const addFrame = useEditorStore((state) => state.addFrame)
  const setFrameCover = useEditorStore((state) => state.setFrameCover)
  const removeFrame = useEditorStore((state) => state.removeFrame)
  const removeElement = useEditorStore((state) => state.removeElement)
  const selection = useEditorStore((state) => state.selection)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)

  // Right-click promotion into an Edit lived here; Edit is gone from the data
  // model (see core/src/frames.ts) and its replacement — dropping a photo
  // onto a frame — landed as an ordinary drag. Right-click on a pasteboard
  // photograph itself stays deferred per CLAUDE.md; right-click on an image
  // already *inside* a frame, on a frame's own background, or on empty
  // pasteboard does not — those open the menus below, at the user's explicit
  // direction overriding that deferral.
  const [imageMenu, setImageMenu] = useState<ImageMenuTarget | null>(null)
  const [frameMenu, setFrameMenu] = useState<FrameMenuTarget | null>(null)
  const [emptyCanvasMenu, setEmptyCanvasMenu] = useState<EmptyCanvasMenuTarget | null>(null)

  const { containerRef, canvasElementRef, controls, armTextTool, isTextEditing } = useFabricCanvas({
    placements,
    assets,
    frames,
    typeBaseSize,
    typeRatio,
    onMove: movePlacement,
    onScale: scalePlacement,
    onContextMenu: () => {},
    onImageContextMenu: (frameId, elementId, x, y) => setImageMenu({ frameId, elementId, x, y }),
    onFrameContextMenu: (frameId, x, y) => setFrameMenu({ frameId, x, y }),
    onAddPage: addPairedPage,
    onEmptyCanvasContextMenu: (x, y) => setEmptyCanvasMenu({ x, y }),
    onReorderFrame: reorderFrameById,
    onDropOnFrame: moveToFrame,
    onCreateText: createTextElement,
    onSelectFrame: (frameId) => (frameId ? selectFrame(frameId) : clearSelection()),
    onSelectElement: selectElement,
    onUpdateElementBox: updateElementBox,
    onUpdateTextContent: (frameId, elementId, content) =>
      updateTextElement(frameId, elementId, { content }),
  })

  // `T` arms the text tool; the next click/drag on the canvas places it (U6).
  useTextToolShortcut({ enabled: true, isTextboxEditing: isTextEditing, armTextTool })
  // Cmd/Ctrl+Z undoes the last reorder/move/create/delete/text-edit (U8);
  // Cmd/Ctrl+Shift+Z / Cmd/Ctrl+Y redoes it.
  useUndoShortcut({ enabled: true, undo, redo })
  // Cmd/Ctrl+C copies the selected page, Cmd/Ctrl+V pastes it as a new one
  // right after it (user-directed).
  useCopyPasteShortcut({ enabled: true, copySelectedFrame, pasteFrame })
  // Backspace/Delete removes whatever is currently selected — a page (same
  // action as the right-click menu's "Delete page") or an image/text element
  // — but never while `isTextEditing` says a text element is actively being
  // typed into (see that hook's doc comment).
  const deletableSelection: DeletableSelection =
    selection?.kind === "frame"
      ? { kind: "frame", frameId: selection.frameId }
      : selection?.kind === "text-element" || selection?.kind === "image-element"
        ? { kind: "element", frameId: selection.frameId, elementId: selection.elementId }
        : null
  useDeleteSelectionShortcut({
    enabled: true,
    selection: deletableSelection,
    isTextEditing,
    removeFrame,
    removeElement,
  })

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* The observed element. Deliberately overflow-hidden: observing a
          scrollable ancestor would let the canvas and its scrollbar feed each
          other in a resize loop. */}
      <div ref={containerRef} className="absolute inset-0 canvas-dot-grid">
        <canvas ref={canvasElementRef} className="absolute inset-0" />
      </div>

      {assets.length === 0 ? <EmptyTable /> : <ImportAffordance armTextTool={armTextTool} />}

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

      {frameMenu && (
        <FrameContextMenu
          target={frameMenu}
          isCover={frames.find((f) => f.id === frameMenu.frameId)?.isCover ?? false}
          onDismiss={() => setFrameMenu(null)}
          onToggleCover={(isCover) => {
            setFrameCover(frameMenu.frameId, isCover)
            setFrameMenu(null)
          }}
          onDelete={() => {
            removeFrame(frameMenu.frameId)
            setFrameMenu(null)
          }}
        />
      )}

      {emptyCanvasMenu && (
        <EmptyCanvasContextMenu
          target={emptyCanvasMenu}
          onDismiss={() => setEmptyCanvasMenu(null)}
          onAddPage={() => {
            addFrame(pageSize)
            setEmptyCanvasMenu(null)
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
        <div className="px-2 pt-1 pb-0.5 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
          Positioning
        </div>
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

/** Right-click on genuinely empty pasteboard — currently just "Add new
 *  page", appended to the end of the book at the project's page size. */
function EmptyCanvasContextMenu({
  target,
  onAddPage,
  onDismiss,
}: {
  target: EmptyCanvasMenuTarget
  onAddPage: () => void
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
      <div className="fixed inset-0 z-30" onClick={onDismiss} onContextMenu={(e) => e.preventDefault()} />
      <div
        className="absolute z-40 min-w-40 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        style={{ left: target.x, top: target.y }}
      >
        <button
          onClick={onAddPage}
          className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
        >
          Add new page
        </button>
      </div>
    </>
  )
}

/**
 * Right-click menu on a frame's own background (not on one of its elements)
 * — currently just the "set as cover" toggle. What being a cover actually
 * unlocks in the sidebar (extra text/design options) is still undefined;
 * this is the entry point for that, not the feature itself yet.
 */
function FrameContextMenu({
  target,
  isCover,
  onToggleCover,
  onDelete,
  onDismiss,
}: {
  target: FrameMenuTarget
  isCover: boolean
  onToggleCover: (isCover: boolean) => void
  onDelete: () => void
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
      <div className="fixed inset-0 z-30" onClick={onDismiss} onContextMenu={(e) => e.preventDefault()} />
      <div
        className="absolute z-40 min-w-44 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        style={{ left: target.x, top: target.y }}
      >
        <button
          onClick={() => onToggleCover(!isCover)}
          className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
        >
          {isCover ? "Remove cover" : "Set as cover"}
        </button>
        <div className="my-1 h-px bg-border" />
        <button
          onClick={onDelete}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
        >
          <Trash2Icon className="size-3.5" />
          Delete page
        </button>
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

/**
 * Import stays reachable once the table has photographs on it — the empty
 * state is copy, not the only door in. Grouped with the text tool in its own
 * pill (both are "add something to the canvas" actions); Undo/Redo get a
 * separate pill (both are history actions on whatever's already there) — an
 * 8px gap (`gap-2`) between the two groups makes that distinction visible
 * rather than reading as one long row of five buttons.
 */
function ImportAffordance({ armTextTool }: { armTextTool: () => void }) {
  const progress = useEditorStore((state) => state.importProgress)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const canUndo = useEditorStore((state) => state.undoStack.length > 0)
  const canRedo = useEditorStore((state) => state.redoStack.length > 0)

  const platform = usePlatform()
  const modifier = modifierLabel(platform)
  const shortcut = (key: string) => (modifier ? `${modifier} ${key}` : null)

  return (
    <TooltipProvider delay={TOOLTIP_DELAY_MS}>
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl border bg-background/90 p-1 shadow-sm backdrop-blur">
          <ImportPhotosButton variant="icon" />

          <div className="h-4 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Add text"
                  onClick={armTextTool}
                >
                  <TypeIcon />
                </Button>
              }
            />
            <TooltipContent>
              <span className="flex items-center gap-2">
                Add text
                <kbd data-slot="kbd" className="rounded bg-background/20 px-1">
                  T
                </kbd>
              </span>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2 rounded-xl border bg-background/90 p-1 shadow-sm backdrop-blur">
          <HistoryButton
            label="Undo"
            shortcut={shortcut("Z")}
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2Icon />
          </HistoryButton>
          <HistoryButton
            label="Redo"
            shortcut={shortcut("⇧Z")}
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2Icon />
          </HistoryButton>
        </div>

        {progress && (
          <span className="text-xs text-muted-foreground">
            Importing {progress.done} of {progress.total}…
          </span>
        )}
      </div>
    </TooltipProvider>
  )
}

function HistoryButton({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  label: string
  shortcut: string | null
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>
        <span className="flex items-center gap-2">
          {label}
          {shortcut && (
            <kbd data-slot="kbd" className="rounded bg-background/20 px-1">
              {shortcut}
            </kbd>
          )}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
