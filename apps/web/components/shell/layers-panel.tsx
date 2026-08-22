"use client"

import { useState } from "react"
import {
  CaretLeftIcon,
  ImageSquareIcon,
  TextAaIcon,
  BookOpenIcon,
} from "@phosphor-icons/react"
import { toSpreads, type Page, type PageElement } from "@loupe/core"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useEditorStore } from "@/state/editor-store"

/** The left panel's only two views (R20) — not a "mode" in the removed
 *  Sequence/Design/Print sense: this is content the panel shows, chosen
 *  locally, with no effect on what the canvas itself renders. */
type PanelView = "canvas" | "book"

/**
 * Simplified layers panel.
 *
 * "Canvas" is where the pasteboard's imported photographs live before they
 * become book content; "Book" is the committed page order. Both are
 * placeholder-ish for now — the canvas has nothing to enumerate yet (that
 * lands with the frame grid), and the book list here is the same drill-down
 * this panel already had before the switcher existed. U12 builds the real
 * book-overview rows with print properties.
 */
export function LayersPanel() {
  const project = useEditorStore((state) => state.project)
  const selection = useEditorStore((state) => state.selection)
  const [view, setView] = useState<PanelView>("canvas")

  const selectedPageId = selection?.kind ? selection.pageId : null
  const selectedPage = selectedPageId
    ? (project.pages.find((page) => page.id === selectedPageId) ?? null)
    : null

  return (
    <aside className="flex h-full w-60 flex-col border-r bg-background">
      <div className="flex h-10 shrink-0 items-center px-3">
        <span className="truncate text-sm font-medium">{project.name}</span>
      </div>

      <PanelViewSwitcher view={view} onChange={setView} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-3">
          {view === "canvas" ? (
            <CanvasOverview />
          ) : selectedPage ? (
            <ElementList page={selectedPage} />
          ) : (
            <SpreadList />
          )}
        </div>
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

/** Placeholder — the pasteboard has nothing structural to enumerate until the
 *  frame grid lands; this just orients the user to what "Canvas" means here. */
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

function SpreadList() {
  const project = useEditorStore((state) => state.project)
  const selectPage = useEditorStore((state) => state.selectPage)
  const spreads = toSpreads(project.pages)

  return (
    <div className="flex flex-col gap-1">
      <PanelLabel>Pages</PanelLabel>
      {spreads.map((spread) => (
        <div key={spread.index} className="flex flex-col">
          <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
            <BookOpenIcon className="size-3.5" />
            Spread {spread.index + 1}
          </div>
          {[spread.left, spread.right]
            .filter((page): page is Page => page !== null)
            .map((page) => (
              <button
                key={page.id}
                onClick={() => selectPage(page.id)}
                className="flex items-center gap-2 rounded-md py-1 pr-2 pl-6 text-left text-sm text-foreground/90 hover:bg-muted"
              >
                <span className="truncate">{pageLabel(page)}</span>
              </button>
            ))}
        </div>
      ))}
    </div>
  )
}

function ElementList({ page }: { page: Page }) {
  const selection = useEditorStore((state) => state.selection)
  const selectElement = useEditorStore((state) => state.selectElement)
  const clearSelection = useEditorStore((state) => state.clearSelection)

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={clearSelection}
        className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <CaretLeftIcon className="size-3" />
        All pages
      </button>
      <PanelLabel>{pageLabel(page)}</PanelLabel>

      {page.elements.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">Empty page.</p>
      ) : (
        page.elements.map((element) => {
          const isSelected =
            selection?.kind === "element" && selection.elementId === element.id
          return (
            <button
              key={element.id}
              onClick={() => selectElement(page.id, element.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted",
                isSelected && "bg-muted font-medium",
              )}
            >
              <ElementIcon element={element} />
              <span className="truncate">{element.name}</span>
            </button>
          )
        })
      )}
    </div>
  )
}

function ElementIcon({ element }: { element: PageElement }) {
  const Icon = element.kind === "image" ? ImageSquareIcon : TextAaIcon
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" />
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-1 pb-0.5 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  )
}

/** Prefer the page's own first element name — "Breakwater, low tide" is a more
 *  useful label in a photobook than "Page 4". */
function pageLabel(page: Page): string {
  return page.elements[0]?.name ?? page.id
}
