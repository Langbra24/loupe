"use client"

import {
  sizeForRole,
  vandeGraafMargins,
  type Frame,
  type ImageElement,
  type Margins,
  type PageElement,
  type Project,
} from "@loupe/core"

import { BLEED_MM } from "@/components/shell/inspector-panel"
import { LightTable } from "@/components/sequence/light-table"
import { useThumbnail } from "@/components/sequence/use-thumbnail"
import { cn } from "@/lib/utils"
import { useEditorStore } from "@/state/editor-store"

/**
 * The canvas region shows one of two things, driven by the same `panelView`
 * the left panel's Canvas/Book switcher sets: the live editable pasteboard
 * (`LightTable`), or a full review grid of every page's real composed
 * content (`BookOverview`). This split — and `BookOverview` itself — existed
 * before this plan's restructure as `SequenceView`, rendering `Page[]`; it
 * was deleted in U12 as dead code once nothing populated `pages` anymore,
 * on the assumption that a metadata-only list (page size, margins) was an
 * adequate replacement. It wasn't — seeing the whole book's actual content,
 * front to back, is the point of a book overview, not a thing this plan
 * should have taken away. Rebuilt here against `Frame` instead of `Page`.
 */
export function CanvasRegion() {
  const view = useEditorStore((state) => state.panelView)

  if (view === "book") {
    return (
      <div className="relative min-w-0 overflow-auto bg-background">
        <BookOverview />
      </div>
    )
  }

  return (
    <div className="relative min-w-0 overflow-hidden">
      <LightTable />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Book overview — every page, front to back, real content              */
/* ------------------------------------------------------------------ */

function BookOverview() {
  const project = useEditorStore((state) => state.project)
  const frames = [...project.frames].sort((a, b) => a.position - b.position)

  if (frames.length === 0) {
    return (
      <Empty>Set up the book on the canvas to see its pages here.</Empty>
    )
  }

  return (
    <div className="p-8 pt-16">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
        {frames.map((frame) => (
          <FramePreview key={frame.id} frame={frame} project={project} />
        ))}
      </div>
    </div>
  )
}

function FramePreview({ frame, project }: { frame: Frame; project: Project }) {
  const reviewFrame = useEditorStore((state) => state.reviewFrame)
  const selection = useEditorStore((state) => state.selection)
  const isSelected = selection?.kind === "frame" && selection.frameId === frame.id

  const aspect = frame.pageSize.width / frame.pageSize.height
  const margins = frame.margins ?? vandeGraafMargins(frame.pageSize)

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => reviewFrame(frame.id)}
        className={cn(
          "relative block w-full cursor-pointer bg-card shadow-sm ring-1 ring-border transition-shadow hover:shadow-md",
          isSelected && "outline-2 outline-ring",
        )}
        style={{ aspectRatio: aspect }}
      >
        <FrameContents frame={frame} project={project} />
        <PrintOverlay frame={frame} margins={margins} />
      </button>
      <div className="flex items-center justify-between text-[0.7rem] text-muted-foreground">
        <span>Page {frame.position + 1}</span>
        <span>
          {Math.round(margins.top)}/{Math.round(margins.inner)}/{Math.round(margins.outer)}/
          {Math.round(margins.bottom)}mm
        </span>
      </div>
    </div>
  )
}

/**
 * Renders a frame's elements from their normalized 0..1 boxes — the same
 * rendering approach the deleted `PageContents`/`ElementBox` used against
 * `Page`, moved onto `Frame`. Still a plain DOM stand-in, not Fabric: this is
 * a read-only review surface, not an editing one, so there is no reason to
 * pay for a second canvas engine here.
 */
function FrameContents({ frame, project }: { frame: Frame; project: Project }) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {frame.elements
        .filter((element) => !element.hidden)
        .map((element) => (
          <FrameElementBox key={element.id} element={element} project={project} />
        ))}
    </div>
  )
}

function FrameElementBox({ element, project }: { element: PageElement; project: Project }) {
  const style: React.CSSProperties = {
    left: `${element.frame.x * 100}%`,
    top: `${element.frame.y * 100}%`,
    width: `${element.frame.width * 100}%`,
    height: `${element.frame.height * 100}%`,
  }

  if (element.kind === "image") {
    return <FrameImage element={element} style={style} />
  }

  // Thumbnail scale: readable at review size without pretending to be a
  // print-accurate proof, which is Print's job once it exists.
  const pointSize = sizeForRole(element.role, project.typeBaseSize, project.typeRatio)
  const fontSize = `${Math.max(pointSize * 0.4, 5)}px`

  return (
    <div
      style={{ ...style, fontSize, textAlign: element.align }}
      className={cn(
        "absolute overflow-hidden leading-snug",
        element.role === "title" || element.role === "subtitle" ? "font-heading" : "font-sans",
      )}
    >
      {element.content}
    </div>
  )
}

/**
 * The two print-technical overlays the pre-frame `PrintView` drew on its
 * press-sheet preview before U12 deleted it: a bleed edge and the content
 * margins, both restored here on each page preview instead of a single
 * folded-sheet mockup, since there is no imposition/fold view to draw them on
 * yet. Colors and 2px width match the canvas's own Fabric-drawn version of
 * these guides (`use-fabric-canvas.ts`'s `syncPrintOverlay`) — a vivid red
 * for the bleed/trim line (the print-template convention) and a bright
 * Figma-blue for the content-margin guide, kept far enough apart on the
 * color wheel that the two never get confused on a real page. Plain hex
 * rather than the `destructive`/`ring` theme tokens on purpose: these lines
 * are a fixed print reference, not part of the UI's own light/dark palette.
 */
function PrintOverlay({ frame, margins }: { frame: Frame; margins: Margins }) {
  const bleedXPercent = (BLEED_MM / frame.pageSize.width) * 100
  const bleedYPercent = (BLEED_MM / frame.pageSize.height) * 100

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Bleed edge. */}
      <div
        className="absolute border-2 border-dashed"
        style={{
          borderColor: "#ff3b30",
          top: `${bleedYPercent}%`,
          bottom: `${bleedYPercent}%`,
          left: `${bleedXPercent}%`,
          right: `${bleedXPercent}%`,
        }}
      />
      {/* Van de Graaf content margins. */}
      <div
        className="absolute border-2 border-dashed"
        style={{
          borderColor: "#18a0fb",
          top: `${(margins.top / frame.pageSize.height) * 100}%`,
          bottom: `${(margins.bottom / frame.pageSize.height) * 100}%`,
          left: `${(margins.inner / frame.pageSize.width) * 100}%`,
          right: `${(margins.outer / frame.pageSize.width) * 100}%`,
        }}
      />
    </div>
  )
}

function FrameImage({ element, style }: { element: ImageElement; style: React.CSSProperties }) {
  const url = useThumbnail(element.assetId)

  return (
    <div style={style} className="absolute overflow-hidden bg-muted">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={element.name}
          className={cn("h-full w-full", element.fit === "cover" ? "object-cover" : "object-contain")}
        />
      ) : null}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{children}</div>
  )
}
