"use client"

import { useState } from "react"
import { BookOpenIcon } from "@phosphor-icons/react"
import { vandeGraafMargins, type Frame, type Margins } from "@loupe/core"

import { ScrollArea } from "@/components/ui/scroll-area"
import { useThumbnail } from "@/components/sequence/use-thumbnail"
import { cn } from "@/lib/utils"
import { useEditorStore } from "@/state/editor-store"

/** The left panel's only two views (R20) — not a "mode" in the removed
 *  Sequence/Design/Print sense: this is content the panel shows, chosen
 *  locally, with no effect on what the canvas itself renders. */
type PanelView = "canvas" | "book"

/**
 * Simplified layers panel.
 *
 * "Canvas" orients the user to the pasteboard's staged photographs; "Book"
 * lists every frame in reading order with a thumbnail and its margins (R20,
 * R13) — clicking a row selects that frame, which is what makes the
 * contextual sidebar (U7) show its print properties without going back to
 * the canvas to click it there.
 */
export function LayersPanel() {
  const project = useEditorStore((state) => state.project)
  const [view, setView] = useState<PanelView>("canvas")

  return (
    <aside className="flex h-full w-60 flex-col border-r bg-background">
      <div className="flex h-10 shrink-0 items-center px-3">
        <span className="truncate text-sm font-medium">{project.name}</span>
      </div>

      <PanelViewSwitcher view={view} onChange={setView} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-3">{view === "canvas" ? <CanvasOverview /> : <FrameOverviewList />}</div>
      </ScrollArea>
    </aside>
  )
}

function PanelViewSwitcher({
  view,
  onChange,
}: {
  view: PanelView
  onChange: (view: PanelView) => void
}) {
  const views: { id: PanelView; label: string }[] = [
    { id: "canvas", label: "Canvas" },
    { id: "book", label: "Book" },
  ]

  return (
    <div
      role="tablist"
      aria-label="Left panel view"
      className="flex shrink-0 gap-1 border-b px-2 py-1.5"
    >
      {views.map((item) => {
        const isActive = view === item.id
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.id)}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

/** Orients the user to what "Canvas" means here — the pasteboard has no
 *  further structure to enumerate; the frame grid is what the "Book" view
 *  below actually lists. */
function CanvasOverview() {
  const assetCount = useEditorStore((state) => state.project.assets.length)

  return (
    <div className="flex flex-col gap-1">
      <PanelLabel>Canvas</PanelLabel>
      <p className="px-2 py-1 text-xs leading-relaxed text-muted-foreground">
        {assetCount === 0
          ? "Import photographs to see them staged here."
          : `${assetCount} photograph${assetCount === 1 ? "" : "s"} on the canvas.`}
      </p>
    </div>
  )
}

/**
 * The real book overview (U12): every frame in reading order, each row
 * carrying a thumbnail and a compact margin summary. Reads `project.frames`,
 * not the old `project.pages` — under the frame model `pages` is never
 * populated, since nothing commits a frame into one anymore.
 */
function FrameOverviewList() {
  const frames = useEditorStore((state) => state.project.frames)
  const selection = useEditorStore((state) => state.selection)
  const selectFrame = useEditorStore((state) => state.selectFrame)

  const ordered = [...frames].sort((a, b) => a.position - b.position)

  return (
    <div className="flex flex-col gap-1">
      <PanelLabel>Pages</PanelLabel>
      {ordered.length === 0 ? (
        <p className="px-2 py-1 text-xs leading-relaxed text-muted-foreground">
          Set up the book to see its pages here.
        </p>
      ) : (
        ordered.map((frame) => (
          <FrameRow
            key={frame.id}
            frame={frame}
            isSelected={selection?.kind === "frame" && selection.frameId === frame.id}
            onSelect={() => selectFrame(frame.id)}
          />
        ))
      )}
    </div>
  )
}

function FrameRow({
  frame,
  isSelected,
  onSelect,
}: {
  frame: Frame
  isSelected: boolean
  onSelect: () => void
}) {
  const firstImage = frame.elements.find((element) => element.kind === "image")
  const thumbnailUrl = useThumbnail(firstImage?.assetId)
  const margins = frame.margins ?? vandeGraafMargins(frame.pageSize)

  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted",
        isSelected && "bg-muted",
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <BookOpenIcon className="size-3.5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground/90">Page {frame.position + 1}</div>
        <div className="truncate text-[0.7rem] text-muted-foreground">{formatMargins(margins)}</div>
      </div>
    </button>
  )
}

/** Compact margin summary for a row — full labeled fields belong in the
 *  sidebar (U7); this is a glance-length hint of what's set. */
function formatMargins(margins: Margins): string {
  return `${Math.round(margins.top)}/${Math.round(margins.inner)}/${Math.round(margins.outer)}/${Math.round(margins.bottom)}mm margins`
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-1 pb-0.5 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  )
}
