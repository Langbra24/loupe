"use client"

import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react"
import {
  checkPageCount,
  sizeForRole,
  toSpreads,
  vandeGraafMargins,
  type Page,
  type PageElement,
  type Project,
} from "@loupe/core"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useEditorStore } from "@/state/editor-store"

/**
 * The only region that changes shape between modes. Everything around it —
 * nav, panel columns — is a stable frame.
 *
 * Design view's page surface is where Fabric.js eventually mounts; it is
 * isolated here so that swap doesn't disturb the rest of the shell.
 */
export function CanvasRegion() {
  const mode = useEditorStore((state) => state.mode)
  const clearSelection = useEditorStore((state) => state.clearSelection)

  return (
    <div
      className="relative min-w-0 overflow-auto bg-muted/40"
      onClick={clearSelection}
    >
      {mode === "sequence" && <SequenceView />}
      {mode === "design" && <DesignView />}
      {mode === "print" && <PrintView />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sequence — whole-book ordering, no editing chrome                    */
/* ------------------------------------------------------------------ */

function SequenceView() {
  const project = useEditorStore((state) => state.project)
  const spreads = toSpreads(project.pages)

  return (
    <div className="p-8 pt-16">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6">
        {spreads.map((spread) => (
          <div key={spread.index} className="flex flex-col gap-2">
            <div className="flex items-stretch gap-px rounded-lg bg-border p-px shadow-sm">
              <SequencePage page={spread.left} project={project} side="left" />
              <SequencePage page={spread.right} project={project} side="right" />
            </div>
            <span className="text-center text-[0.7rem] text-muted-foreground">
              Spread {spread.index + 1}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SequencePage({
  page,
  project,
  side,
}: {
  page: Page | null
  project: Project
  side: "left" | "right"
}) {
  const pages = useEditorStore((state) => state.project.pages)
  const reorderPage = useEditorStore((state) => state.reorderPage)
  const openPageInDesign = useEditorStore((state) => state.openPageInDesign)

  const aspect = project.pageSize.width / project.pageSize.height

  if (!page) {
    // Outside cover — nothing faces it when the book is open.
    return (
      <div
        className="flex-1 bg-muted/60"
        style={{ aspectRatio: aspect }}
        aria-hidden
      />
    )
  }

  const index = pages.findIndex((p) => p.id === page.id)

  return (
    <div
      className="group relative flex-1 cursor-pointer bg-card"
      style={{ aspectRatio: aspect }}
      onClick={(event) => {
        event.stopPropagation()
        openPageInDesign(page.id)
      }}
    >
      <PageContents page={page} project={project} scale="thumb" />

      {/* Reordering is the job of this mode, so the controls earn their place
          here even though every other kind of editing chrome is hidden. */}
      <div className="absolute inset-x-0 bottom-0 flex justify-between p-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="secondary"
          size="icon-xs"
          aria-label="Move page earlier"
          disabled={index <= 0}
          onClick={(event) => {
            event.stopPropagation()
            reorderPage(index, index - 1)
          }}
        >
          <CaretLeftIcon />
        </Button>
        <Button
          variant="secondary"
          size="icon-xs"
          aria-label="Move page later"
          disabled={index >= pages.length - 1}
          onClick={(event) => {
            event.stopPropagation()
            reorderPage(index, index + 1)
          }}
        >
          <CaretRightIcon />
        </Button>
      </div>

      <span className="absolute top-1 right-1 rounded bg-background/70 px-1 text-[0.6rem] text-muted-foreground opacity-0 group-hover:opacity-100">
        {side === "left" ? "verso" : "recto"} · {index + 1}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Design — one spread at a time                                        */
/* ------------------------------------------------------------------ */

function DesignView() {
  const project = useEditorStore((state) => state.project)
  const activeSpreadIndex = useEditorStore((state) => state.activeSpreadIndex)
  const setActiveSpread = useEditorStore((state) => state.setActiveSpread)

  const spreads = toSpreads(project.pages)
  const index = Math.min(activeSpreadIndex, Math.max(spreads.length - 1, 0))
  const spread = spreads[index]

  if (!spread) {
    return <Empty>No pages yet.</Empty>
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-10 pt-16">
      <div
        className="flex w-full max-w-3xl items-stretch shadow-lg ring-1 ring-border"
        onClick={(event) => event.stopPropagation()}
      >
        <DesignPage page={spread.left} project={project} />
        {/* The gutter: where the spread physically folds. */}
        <div className="w-px shrink-0 bg-border" />
        <DesignPage page={spread.right} project={project} />
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous spread"
          disabled={index <= 0}
          onClick={(event) => {
            event.stopPropagation()
            setActiveSpread(index - 1)
          }}
        >
          <CaretLeftIcon />
        </Button>
        <span className="text-xs text-muted-foreground">
          Spread {index + 1} of {spreads.length}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next spread"
          disabled={index >= spreads.length - 1}
          onClick={(event) => {
            event.stopPropagation()
            setActiveSpread(index + 1)
          }}
        >
          <CaretRightIcon />
        </Button>
      </div>
    </div>
  )
}

function DesignPage({ page, project }: { page: Page | null; project: Project }) {
  const selection = useEditorStore((state) => state.selection)
  const selectPage = useEditorStore((state) => state.selectPage)

  const aspect = project.pageSize.width / project.pageSize.height

  if (!page) {
    return (
      <div className="flex-1 bg-muted/60" style={{ aspectRatio: aspect }} aria-hidden />
    )
  }

  const isSelected = selection?.kind === "page" && selection.pageId === page.id

  return (
    <div
      className={cn("relative flex-1 bg-card outline-offset-2", isSelected && "outline-2 outline-ring")}
      style={{ aspectRatio: aspect }}
      onClick={(event) => {
        event.stopPropagation()
        selectPage(page.id)
      }}
    >
      <PageContents page={page} project={project} scale="full" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Print — imposition placeholder                                       */
/* ------------------------------------------------------------------ */

function PrintView() {
  const project = useEditorStore((state) => state.project)
  const check = checkPageCount(project.pages.length)
  const margins = vandeGraafMargins(project.pageSize)

  // Two pages side by side on one press sheet, folded down the middle.
  const sheetAspect = (project.pageSize.width * 2) / project.pageSize.height

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-10 pt-16">
      <div
        className="relative w-full max-w-3xl bg-card shadow-lg"
        style={{ aspectRatio: sheetAspect }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Bleed edge */}
        <div className="absolute inset-2 border border-dashed border-destructive/40" />
        {/* Canon margins, expressed as a share of the sheet */}
        <div
          className="absolute border border-dashed border-ring/40"
          style={{
            top: `${(margins.top / project.pageSize.height) * 100}%`,
            bottom: `${(margins.bottom / project.pageSize.height) * 100}%`,
            left: `${(margins.outer / (project.pageSize.width * 2)) * 100}%`,
            right: `${(margins.outer / (project.pageSize.width * 2)) * 100}%`,
          }}
        />
        {/* Fold */}
        <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/20" />
        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[0.65rem] text-muted-foreground">
          fold
        </span>
      </div>

      <p
        className={cn(
          "text-xs",
          check.isValidForSaddleStitch ? "text-muted-foreground" : "text-destructive",
        )}
      >
        {check.message}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Shared page rendering                                                */
/* ------------------------------------------------------------------ */

/**
 * Renders a page's elements from their normalized 0..1 frames. This is a plain
 * DOM stand-in so the shell shows real structure; Design view's version is
 * what Fabric.js replaces.
 */
function PageContents({
  page,
  project,
  scale,
}: {
  page: Page
  project: Project
  scale: "thumb" | "full"
}) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {page.elements
        .filter((element) => !element.hidden)
        .map((element) => (
          <ElementBox key={element.id} element={element} page={page} project={project} scale={scale} />
        ))}
    </div>
  )
}

function ElementBox({
  element,
  page,
  project,
  scale,
}: {
  element: PageElement
  page: Page
  project: Project
  scale: "thumb" | "full"
}) {
  const selection = useEditorStore((state) => state.selection)
  const selectElement = useEditorStore((state) => state.selectElement)

  const isSelected =
    selection?.kind === "element" && selection.elementId === element.id
  const isInteractive = scale === "full"

  const style: React.CSSProperties = {
    left: `${element.frame.x * 100}%`,
    top: `${element.frame.y * 100}%`,
    width: `${element.frame.width * 100}%`,
    height: `${element.frame.height * 100}%`,
  }

  if (element.kind === "image") {
    return (
      <div
        style={style}
        onClick={
          isInteractive
            ? (event) => {
                event.stopPropagation()
                selectElement(page.id, element.id)
              }
            : undefined
        }
        className={cn(
          "absolute bg-muted",
          isInteractive && "cursor-pointer",
          isSelected && "outline-2 outline-ring",
        )}
      >
        {scale === "full" && (
          <span className="absolute inset-x-0 bottom-1 truncate px-2 text-center text-[0.65rem] text-muted-foreground">
            {element.name}
          </span>
        )}
      </div>
    )
  }

  const pointSize = sizeForRole(element.role, project.typeBaseSize, project.typeRatio)
  // Points → a readable on-screen size. Thumbnails would be illegible at true
  // relative scale, so they get a floor.
  const fontSize = scale === "full" ? `${pointSize * 1.15}px` : `${Math.max(pointSize * 0.4, 5)}px`

  return (
    <div
      style={{ ...style, fontSize, textAlign: element.align }}
      onClick={
        isInteractive
          ? (event) => {
              event.stopPropagation()
              selectElement(page.id, element.id)
            }
          : undefined
      }
      className={cn(
        "absolute overflow-hidden leading-snug",
        element.role === "title" || element.role === "subtitle"
          ? "font-heading"
          : "font-sans",
        isInteractive && "cursor-pointer",
        isSelected && "outline-2 outline-ring",
      )}
    >
      {element.content}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
