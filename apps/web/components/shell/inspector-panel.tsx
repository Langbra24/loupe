"use client"

import { useEffect, useState } from "react"
import {
  checkPageCount,
  sizeForRole,
  vandeGraafMargins,
  type ImageElement,
  type Margins,
  type Selection,
  type TextElement,
  type TypeRole,
} from "@loupe/core"

import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useEditorStore } from "@/state/editor-store"

/** Which of the sidebar's four variants a `Selection` maps to. Extracted as
 *  a pure function so the mapping is testable without rendering anything —
 *  same reasoning as `handleFrameKeyDown`/`shouldCreateTextbox` in
 *  use-canvas-shortcuts.ts. */
export type SidebarVariant = "frame" | "text-element" | "image-element" | "book"

export function sidebarVariantFor(selection: Selection): SidebarVariant {
  if (selection === null) return "book"
  return selection.kind
}

const TYPE_ROLES: TypeRole[] = ["title", "subtitle", "body", "caption", "credit", "folio"]
const ALIGNMENTS: TextElement["align"][] = ["left", "center", "right"]

/**
 * The right panel: one sidebar that reflects whatever is currently selected
 * (U7), replacing the old per-mode Design/Print property panels — there is
 * only one canvas now (the light table), not three mode-scoped surfaces.
 *
 * Cross-fades between variants: `phase` drives an opacity transition on the
 * content wrapper (200ms ease-out entering, 150ms ease-in leaving), gated
 * behind `motion-reduce:` so a user who has asked for reduced motion gets an
 * instant swap instead. No animation library is installed in this project —
 * see CLAUDE.md/the plan — so this is deliberately plain CSS, not a mount/
 * unmount crossfade with true overlap (that would need something like
 * Framer Motion's `AnimatePresence` to keep the outgoing content painted
 * while the incoming content fades in); the exit phase here just fades the
 * *old* variant's content out in place before swapping to the new one.
 */
export function InspectorPanel() {
  const selection = useEditorStore((state) => state.selection)
  const variant = sidebarVariantFor(selection)

  const [displayed, setDisplayed] = useState(selection)
  const [phase, setPhase] = useState<"idle" | "leaving">("idle")
  const displayedVariant = sidebarVariantFor(displayed)

  // Adjusting state during render (not in an effect) for the two synchronous
  // cases, per https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes —
  // this is a pure response to the store's `selection` changing, not a side
  // effect on an external system, so it belongs in the render body.
  if (variant === displayedVariant && displayed !== selection) {
    // Same variant (e.g. one text element's fields changing, or the same
    // frame's margins) — update in place without animating; only a variant
    // *change* is worth a transition.
    setDisplayed(selection)
  } else if (variant !== displayedVariant && phase === "idle") {
    setPhase("leaving")
  }

  // The actual timer is a real effect: it schedules a callback against the
  // clock (an external system), which is what effects are for.
  useEffect(() => {
    if (phase !== "leaving") return
    const timer = setTimeout(() => {
      setDisplayed(selection)
      setPhase("idle")
    }, 150)
    return () => clearTimeout(timer)
  }, [phase, selection])

  return (
    <aside className="flex h-full w-72 flex-col border-l bg-background">
      <ScrollArea className="min-h-0 flex-1">
        <div
          className={cn(
            "flex flex-col gap-4 px-3 pt-14 pb-4 transition-opacity motion-reduce:transition-none",
            phase === "leaving" ? "opacity-0 duration-150 ease-in" : "opacity-100 duration-200 ease-out",
          )}
        >
          <SidebarContent selection={displayed} />
        </div>
      </ScrollArea>
    </aside>
  )
}

function SidebarContent({ selection }: { selection: Selection }) {
  if (selection === null) return <BookSettings />
  if (selection.kind === "frame") return <FrameSettings frameId={selection.frameId} />
  if (selection.kind === "text-element") {
    return <TextElementSettings frameId={selection.frameId} elementId={selection.elementId} />
  }
  return <ImageElementSettings frameId={selection.frameId} elementId={selection.elementId} />
}

/* ------------------------------------------------------------------ */
/* Nothing selected — book-level settings                               */
/* ------------------------------------------------------------------ */

function BookSettings() {
  const project = useEditorStore((state) => state.project)
  // Frames are the book-in-progress under this data model (there is no
  // separate commit step populating `project.pages` yet — see CLAUDE.md's
  // Sequence-funnel notes), so `frames.length` is the real page count to
  // validate, not the still-always-empty `pages.length` the pre-frame
  // Print-mode panel checked.
  const check = checkPageCount(project.frames.length)

  return (
    <>
      <Section title="Book">
        <Row label="Page size" value={project.pageSize.name} />
        <Row label="Trim" value={`${project.pageSize.width} × ${project.pageSize.height} mm`} />
        <Row label="Pages" value={String(project.frames.length)} />
      </Section>
      <Separator />
      <Section title="Saddle stitch">
        <p
          className={cn(
            "px-0 text-xs leading-relaxed",
            check.isValidForSaddleStitch ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {check.message}
        </p>
      </Section>
      <Separator />
      <Section title="Type scale">
        <Row label="Base" value={`${project.typeBaseSize} pt`} />
        <Row label="Ratio" value={String(project.typeRatio)} />
      </Section>
      <Hint>Select a frame or an element on the canvas to edit it.</Hint>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* A frame — margins (R13)                                              */
/* ------------------------------------------------------------------ */

function FrameSettings({ frameId }: { frameId: string }) {
  const frame = useEditorStore((state) => state.project.frames.find((f) => f.id === frameId))
  const updateFrameMargins = useEditorStore((state) => state.updateFrameMargins)

  if (!frame) return <Hint>This frame no longer exists.</Hint>

  // `margins` is optional on `Frame` (U7) so old fixtures don't all need
  // updating for a field with one obvious default — every frame the app
  // actually creates gets one via `createFrame`, but fall back to the same
  // canon here in case this is ever undefined in practice.
  const margins: Margins = frame.margins ?? vandeGraafMargins(frame.pageSize)

  const setMargin = (key: keyof Margins, value: number) => {
    if (Number.isNaN(value)) return
    updateFrameMargins(frameId, { ...margins, [key]: value })
  }

  return (
    <>
      <Section title="Frame">
        <Row label="Page size" value={frame.pageSize.name} />
        <Row label="Position" value={`Page ${frame.position + 1}`} />
      </Section>
      <Separator />
      <Section title="Margins">
        <MarginField label="Top" value={margins.top} onChange={(v) => setMargin("top", v)} />
        <MarginField label="Inner" value={margins.inner} onChange={(v) => setMargin("inner", v)} />
        <MarginField label="Outer" value={margins.outer} onChange={(v) => setMargin("outer", v)} />
        <MarginField label="Bottom" value={margins.bottom} onChange={(v) => setMargin("bottom", v)} />
        <Hint>Millimetres. Defaults to the Van de Graaf canon.</Hint>
      </Section>
    </>
  )
}

function MarginField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        className="w-20 rounded-md border bg-transparent px-2 py-0.5 text-right font-mono text-xs focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
    </label>
  )
}

/* ------------------------------------------------------------------ */
/* A text element — role, alignment, width                              */
/* ------------------------------------------------------------------ */

function TextElementSettings({ frameId, elementId }: { frameId: string; elementId: string }) {
  const element = useEditorStore((state) =>
    state.project.frames.find((f) => f.id === frameId)?.elements.find((e): e is TextElement => e.id === elementId),
  )
  const project = useEditorStore((state) => state.project)
  const updateTextElement = useEditorStore((state) => state.updateTextElement)
  const updateElementBox = useEditorStore((state) => state.updateElementBox)

  if (!element || element.kind !== "text") return <Hint>This element no longer exists.</Hint>

  return (
    <>
      <Section title="Text">
        <Row label="Name" value={element.name} />
        <Row
          label="Size"
          value={`${sizeForRole(element.role, project.typeBaseSize, project.typeRatio)} pt`}
        />
      </Section>
      <Separator />
      <Section title="Role">
        <SelectField
          value={element.role}
          options={TYPE_ROLES}
          onChange={(role) => updateTextElement(frameId, elementId, { role })}
        />
      </Section>
      <Separator />
      <Section title="Alignment">
        <SelectField
          value={element.align}
          options={ALIGNMENTS}
          onChange={(align) => updateTextElement(frameId, elementId, { align })}
        />
      </Section>
      <Separator />
      <Section title="Width">
        <PercentField
          value={element.frame.width}
          onChange={(width) => updateElementBox(frameId, elementId, { width })}
        />
      </Section>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* An image element — fit and position                                  */
/* ------------------------------------------------------------------ */

function ImageElementSettings({ frameId, elementId }: { frameId: string; elementId: string }) {
  const element = useEditorStore((state) =>
    state.project.frames.find((f) => f.id === frameId)?.elements.find((e): e is ImageElement => e.id === elementId),
  )
  const updateImageFit = useEditorStore((state) => state.updateImageFit)
  const updateElementBox = useEditorStore((state) => state.updateElementBox)

  if (!element || element.kind !== "image") return <Hint>This element no longer exists.</Hint>

  return (
    <>
      <Section title="Image">
        <Row label="Name" value={element.name} />
      </Section>
      <Separator />
      <Section title="Fit">
        <SelectField
          value={element.fit}
          options={["cover", "contain"] as const}
          onChange={(fit) => updateImageFit(frameId, elementId, fit)}
        />
      </Section>
      <Separator />
      <Section title="Position">
        <PercentField label="X" value={element.frame.x} onChange={(x) => updateElementBox(frameId, elementId, { x })} />
        <PercentField label="Y" value={element.frame.y} onChange={(y) => updateElementBox(frameId, elementId, { y })} />
        <PercentField
          label="W"
          value={element.frame.width}
          onChange={(width) => updateElementBox(frameId, elementId, { width })}
        />
        <PercentField
          label="H"
          value={element.frame.height}
          onChange={(height) => updateElementBox(frameId, elementId, { height })}
        />
      </Section>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Shared field/layout primitives                                       */
/* ------------------------------------------------------------------ */

function SelectField<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: readonly T[]
  onChange: (value: T) => void
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="w-full rounded-md border bg-transparent px-2 py-1 text-sm capitalize focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {options.map((option) => (
        <option key={option} value={option} className="bg-background capitalize">
          {option}
        </option>
      ))}
    </select>
  )
}

function PercentField({
  label,
  value,
  onChange,
}: {
  label?: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-0.5 text-sm">
      {label ? <span className="text-muted-foreground">{label}</span> : null}
      <input
        type="number"
        step="1"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(event) => {
          const percent = event.target.valueAsNumber
          if (Number.isNaN(percent)) return
          onChange(percent / 100)
        }}
        className="w-20 rounded-md border bg-transparent px-2 py-0.5 text-right font-mono text-xs focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
      <span className="text-xs text-muted-foreground">%</span>
    </label>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="pb-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-xs">{value}</span>
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="pt-1 text-xs leading-relaxed text-muted-foreground">{children}</p>
}
