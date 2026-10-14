"use client"

import { useEffect, useId, useRef, useState } from "react"
import { BookOpenIcon } from "@phosphor-icons/react"
import { defaultFrameMargins, type Frame, type Margins } from "@loupe/core"

import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsIndicator, TabsList, TabsTab } from "@/components/ui/tabs"
import { useThumbnail } from "@/components/sequence/use-thumbnail"
import { cn } from "@/lib/utils"
import { useEditorStore, type PanelView } from "@/state/editor-store"

/**
 * Simplified layers panel.
 *
 * "Canvas" orients the user to the pasteboard's staged photographs; "Book"
 * lists every frame in reading order with a thumbnail and its margins (R20,
 * R13). `panelView` lives in the store, not local state — switching to
 * "Book" also switches the main canvas region to the full-book review grid
 * (`canvas-region.tsx`'s `BookOverview`), the same way it did before this
 * plan's restructure. A row's own click selects that frame *and* jumps back
 * to "Canvas" (`reviewFrame` in the store) so clicking a page to review it
 * lands you on the canvas ready to edit it, matching the pre-restructure
 * click-a-page-to-review flow this panel used to have against `Page`
 * instead of `Frame`.
 */
export function LayersPanel() {
  const project = useEditorStore((state) => state.project)
  const hydrated = useEditorStore((state) => state.hydrated)
  const view = useEditorStore((state) => state.panelView)
  const setView = useEditorStore((state) => state.setPanelView)

  return (
    <aside className="flex h-full w-60 flex-col border-r bg-background">
      <div className="flex h-10 shrink-0 items-center px-3">
        {/* Blank until IndexedDB answers, rather than the placeholder
            project's name and empty-state copy (#59). */}
        {hydrated && <ProjectNameField name={project.name} />}
      </div>

      <PanelViewSwitcher view={view} onChange={setView} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-3">
          {!hydrated ? null : view === "canvas" ? <CanvasOverview /> : <FrameOverviewList />}
        </div>
      </ScrollArea>
    </aside>
  )
}

/**
 * The book's name (user-directed: "wrap it in an input when clicked on").
 * Plain text at rest, swapping to a real `<input>` — focused and selected —
 * the instant it's clicked, so the pointer position doubles as a text
 * cursor rather than requiring a second click to place one.
 *
 * `draft` is local, uncommitted state — `renameProject` (and the debounced
 * IndexedDB write behind it) only fires on blur/Enter, not per keystroke,
 * the same "don't round-trip through the store on every character" reason
 * `ColorField`'s hex draft works this way. Escape reverts to `project.name`
 * without committing, standard cancel-an-edit behavior.
 *
 * Falls back to the prior name if committed empty/whitespace-only — an
 * invisible, blank sidebar header is worse than just refusing the edit, and
 * there's no separate "untitled" placeholder state for a book that already
 * has a name to fall back to.
 */
function ProjectNameField({ name }: { name: string }) {
  const renameProject = useEditorStore((state) => state.renameProject)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // Enter and Escape hand focus back to the name, since the input unmounts
  // under the keyboard user. A blur means focus already went somewhere on
  // purpose, so it is left there.
  const refocusRef = useRef(false)

  useEffect(() => {
    if (editing || !refocusRef.current) return
    refocusRef.current = false
    buttonRef.current?.focus()
  }, [editing])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== name) renameProject(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        aria-label="Book name"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            refocusRef.current = true
            commit()
          } else if (event.key === "Escape") {
            event.preventDefault()
            refocusRef.current = true
            setDraft(name)
            setEditing(false)
          }
        }}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        className="w-full truncate rounded-sm bg-transparent text-sm font-medium text-foreground outline-none focus-ring"
      />
    )
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      title="Rename book"
      onClick={() => {
        setDraft(name)
        setEditing(true)
      }}
      // 20px of text in a 40px header row: the pseudo-element takes the
      // target to 36px tall. The truncation sits on the inner span, since
      // `overflow: hidden` on the button would clip its own hit area.
      className="relative block w-full rounded-sm text-left text-sm font-medium outline-none before:absolute before:inset-x-0 before:-inset-y-2 hover:bg-muted focus-ring"
    >
      <span className="block truncate">{name}</span>
    </button>
  )
}

/**
 * Canvas/Book switcher, on `@base-ui/react/tabs` (ui/tabs.tsx) rather than a
 * plain button pair — the active tab now gets a rail that slides between
 * positions (`TabsIndicator`, styled by `.tabs-indicator-rail` in
 * globals.css) instead of snapping its background color instantly.
 */
function PanelViewSwitcher({
  view,
  onChange,
}: {
  view: PanelView
  onChange: (view: PanelView) => void
}) {
  return (
    <Tabs
      value={view}
      onValueChange={(value) => onChange(value as PanelView)}
      className="shrink-0 border-b px-2 py-1.5"
    >
      <TabsList aria-label="Left panel view" className="gap-1">
        <TabsIndicator />
        <TabsTab value="canvas">Canvas</TabsTab>
        <TabsTab value="book">Book</TabsTab>
      </TabsList>
    </Tabs>
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
 * Every frame in reading order, each row carrying a thumbnail and a compact
 * margin summary. Sits above the same book review grid the main canvas
 * region shows while the "Book" view is active (`BookOverview` in
 * `canvas-region.tsx`) — this list is a compact index into that grid, not a
 * separate destination, so a row click only selects the frame (sidebar shows
 * its properties) without leaving the book review. Jumping to editing a page
 * is the grid's job (its own click calls `reviewFrame`), the same split
 * InDesign's Pages panel makes between selecting a page thumbnail and
 * actually navigating to it. Reads `project.frames`, not the old
 * `project.pages` — under the frame model `pages` is never populated, since
 * nothing commits a frame into one anymore.
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
  const margins = frame.margins ?? defaultFrameMargins(frame.pageSize)
  // Named "Page 2" and described by its margins, rather than both run
  // together as one name ("Page 235/25/25/35mm margins", #50).
  const titleId = useId()
  const marginsId = useId()

  return (
    <button
      onClick={onSelect}
      aria-current={isSelected || undefined}
      aria-labelledby={titleId}
      aria-describedby={marginsId}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-ring",
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
        <div id={titleId} className="truncate text-sm text-foreground">
          Page {frame.position + 1}
        </div>
        <div id={marginsId} className="truncate text-[0.7rem] text-muted-foreground">
          {formatMargins(margins)}
        </div>
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
    <div className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
      {children}
    </div>
  )
}
