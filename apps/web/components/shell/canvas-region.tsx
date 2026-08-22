"use client"

import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react"
import {
  checkPageCount,
  sizeForRole,
  toSpreads,
  vandeGraafMargins,
  type ImageElement,
  type Page,
  type PageElement,
  type Project,
} from "@loupe/core"

import { Button } from "@/components/ui/button"
import { LightTable } from "@/components/sequence/light-table"
import { useThumbnail } from "@/components/sequence/use-thumbnail"
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

  // The light table manages its own overflow and must not sit inside a
  // scrollable ancestor — a growing canvas would summon a scrollbar and feed
  // its own ResizeObserver. Every other mode scrolls normally.
  const isLightTable = mode === "sequence"

  return (
    <div
      className={cn(
        // The canvas surface is black with a dot grid (R22) — see
        // `.canvas-dot-grid` in globals.css and the `--canvas`/`--canvas-dot`
        // tokens it reads from.
        "relative min-w-0 canvas-dot-grid",
        isLightTable ? "overflow-hidden" : "overflow-auto",
      )}
      onClick={isLightTable ? undefined : clearSelection}
    >
      {mode === "sequence" && <LightTable />}
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

  if (spreads.length === 0) {
    return (
      <Empty>
        The book is empty. Build an edit, then commit it to see the spreads here.
      </Empty>
    )
  }

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
    return (
      <Empty>
        No book yet. Commit an edit in Sequence and its spreads will appear here.
      </Empty>
    )
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
  const aspect = project.pageSize.width / project.pageSize.height

  if (!page) {
    return (
      <div className="flex-1 bg-muted/60" style={{ aspectRatio: aspect }} aria-hidden />
    )
  }

  // This whole view is unreachable dead code (see the comment on
  // `openPageInDesign` in editor-store.ts) — the old `page` `Selection` kind
  // it used for a click-to-select outline is gone under the frame model
  // (U7), and there is no page-level replacement to select here, since a
  // committed `Page` isn't a `Frame`. Left inert rather than removed; U12
  // deletes this view wholesale.
  return (
    <div className="relative flex-1 bg-card outline-offset-2" style={{ aspectRatio: aspect }}>
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

  if (project.pages.length === 0) {
    return (
      <Empty>
        Nothing to impose yet. Commit an edit in Sequence to make a book first.
      </Empty>
    )
  }

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
          <ElementBox key={element.id} element={element} project={project} scale={scale} />
        ))}
    </div>
  )
}

// `page` used to be a prop here too (for the `selectElement(page.id, ...)`
// calls this dead code path — see the comment above — used to make). Dropped
// along with those calls rather than kept unused: a `Page` isn't the frame
// model's identifier for anything anymore, so there was no honest value to
// still pass through.
function ElementBox({
  element,
  project,
  scale,
}: {
  element: PageElement
  project: Project
  scale: "thumb" | "full"
}) {
  // Dead code (see the comment on `DesignPage` above): the old `element`
  // `Selection` kind this used is gone under the frame model (U7), and this
  // element lives on a committed `Page`, not a `Frame`, so there is no
  // current `Selection` value that could ever describe it. Hardcoded false
  // rather than removed; U12 deletes this view wholesale.
  const isSelected = false
  const isInteractive = scale === "full"

  const style: React.CSSProperties = {
    left: `${element.frame.x * 100}%`,
    top: `${element.frame.y * 100}%`,
    width: `${element.frame.width * 100}%`,
    height: `${element.frame.height * 100}%`,
  }

  if (element.kind === "image") {
    return (
      <ImageElementBox
        element={element}
        style={style}
        isSelected={isSelected}
        onSelect={undefined}
      />
    )
  }

  const pointSize = sizeForRole(element.role, project.typeBaseSize, project.typeRatio)
  // Points → a readable on-screen size. Thumbnails would be illegible at true
  // relative scale, so they get a floor.
  const fontSize = scale === "full" ? `${pointSize * 1.15}px` : `${Math.max(pointSize * 0.4, 5)}px`

  return (
    <div
      style={{ ...style, fontSize, textAlign: element.align }}
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

/**
 * Renders a committed photograph.
 *
 * Until this existed nothing in the app drew image pixels — an image element
 * was a grey box that never read its `assetId` — so the whole funnel ended in
 * placeholders no matter how many photographs were imported.
 */
function ImageElementBox({
  element,
  style,
  isSelected,
  onSelect,
}: {
  element: ImageElement
  style: React.CSSProperties
  isSelected: boolean
  onSelect?: (event: React.MouseEvent) => void
}) {
  const url = useThumbnail(element.assetId)

  return (
    <div
      style={style}
      onClick={onSelect}
      className={cn(
        "absolute overflow-hidden bg-muted",
        onSelect && "cursor-pointer",
        isSelected && "outline-2 outline-ring",
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={element.name}
          className={cn(
            "h-full w-full",
            element.fit === "cover" ? "object-cover" : "object-contain",
          )}
        />
      ) : null}
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
