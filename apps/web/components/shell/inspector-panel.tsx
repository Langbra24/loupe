"use client"

import { useEffect, useState } from "react"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import {
  checkPageCount,
  presetImageBox,
  sizeForRole,
  defaultFrameMargins,
  type ImageElement,
  type ImagePreset,
  type Margins,
  type Selection,
  type TextElement,
  type TypeRole,
} from "@loupe/core"

import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DEFAULT_TEXT_FONT, TEXT_FONTS } from "@/lib/fonts"
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

// "credit" and "folio" exist in `TypeRole` (core keeps them for the type
// scale's own sake) but aren't offered as picker options here — the sidebar
// only needs the four roles a photobook's captions/titles actually use.
const TYPE_ROLES: TypeRole[] = ["title", "subtitle", "body", "caption"]
const ALIGNMENTS: TextElement["align"][] = ["left", "center", "right"]

/**
 * Same three fixed layout presets the canvas's right-click menu offers on a
 * frame's image element (`ImagePresetMenu` in light-table.tsx), duplicated
 * here rather than imported — that file is being touched by parallel work
 * and isn't set up to export this map, and it's small enough that
 * duplicating it is cheaper than risking a merge conflict over an export.
 * Both call sites end up at the same store action, `applyImagePreset`, so
 * the sidebar buttons below and the canvas menu always agree on what each
 * preset does.
 */
const IMAGE_PRESET_LABELS: Record<ImagePreset, string> = {
  "full-bleed": "Full bleed",
  centered: "Centered",
  "left-half": "Left half",
}

/**
 * Standard trim bleed, in millimetres — the same fixed value the pre-frame
 * `PrintControls`/`PrintView` showed before U12 deleted them along with the
 * rest of the dead mode-scoped views. Not stored on `Project`: like the
 * original, this is a display constant rather than a per-project setting,
 * since nothing in the app varies it yet. Restored because the visual bleed
 * indicator on a printed page (`BookOverview`'s `FramePreview` in
 * canvas-region.tsx) is exactly the kind of "technical detail that matters
 * for printing" a book-review surface should carry, and dropping it when the
 * old Print mode was removed was a real loss, not an intentional cut.
 */
export const BLEED_MM = 3

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
            "flex flex-col gap-6 px-3 pt-14 pb-4 transition-opacity motion-reduce:transition-none",
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
      <Section title="Imposition">
        <Row label="Binding" value="Saddle stitch" />
        <Row label="Bleed" value={`${BLEED_MM} mm`} />
        <Row label="Fold preview" value="—" />
        <Hint>Imposition, fold preview and soft-proof are placeholders.</Hint>
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
  // default here in case this is ever undefined in practice.
  const margins: Margins = frame.margins ?? defaultFrameMargins(frame.pageSize)

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
        <Hint>Millimetres. Defaults to equal margins on every side.</Hint>
      </Section>
      <Separator />
      <Section title="Print">
        <Row label="Bleed" value={`${BLEED_MM} mm`} />
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
      <span className="text-foreground">{label}</span>
      <NumberField value={value} step={0.1} onChange={onChange} />
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
        <textarea
          value={element.content}
          onChange={(event) => updateTextElement(frameId, elementId, { content: event.target.value })}
          rows={3}
          className="w-full resize-none rounded-md border bg-input/30 px-2 py-1 text-sm leading-snug text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        />
      </Section>
      <Separator />
      {/* Type/Size/Font/Alignment read as one cluster of type controls in
          the reference (Paper node 7H-0) — grouped by the same gap-6 every
          section already gets, but without a divider line between each of
          these four specifically, unlike the harder break before/after the
          cluster. */}
      <Section title="Type">
        <SelectField
          value={element.role}
          options={TYPE_ROLES}
          onChange={(role) => updateTextElement(frameId, elementId, { role })}
        />
      </Section>
      <Section title="Size">
        {/* Derived from Type × the book's type scale, not its own field on
            `TextElement` — styled to match the pickers around it (the
            reference gives it the same bordered-row-plus-chevron treatment)
            but inert, since there's no override value here to pick from
            yet. Changing Type is what actually changes this. */}
        <StaticSelectStyledValue value={`${sizeForRole(element.role, project.typeBaseSize, project.typeRatio)}pt`} />
      </Section>
      <Section title="Font">
        <FontFamilySelect
          value={element.fontFamily}
          onChange={(fontFamily) => updateTextElement(frameId, elementId, { fontFamily })}
        />
      </Section>
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
  const frame = useEditorStore((state) => state.project.frames.find((f) => f.id === frameId))
  const element = frame?.elements.find((e): e is ImageElement => e.id === elementId && e.kind === "image")
  const updateImageFit = useEditorStore((state) => state.updateImageFit)
  const updateElementBox = useEditorStore((state) => state.updateElementBox)
  const applyImagePreset = useEditorStore((state) => state.applyImagePreset)

  if (!frame || !element) return <Hint>This element no longer exists.</Hint>

  // Which preset (if any) the element's current Box/fit already matches —
  // drives the "active" state on the preset buttons below. Recomputed from
  // the element's actual geometry rather than remembered as its own field,
  // so it naturally goes inactive again the moment the image is dragged or
  // resized by hand, which is the correct behavior: this button reflects
  // "does the image currently look like this preset," not "which one was
  // clicked last."
  const margins = frame.margins ?? defaultFrameMargins(frame.pageSize)
  const activePreset = (Object.keys(IMAGE_PRESET_LABELS) as ImagePreset[]).find((preset) => {
    const box = presetImageBox(preset, frame.pageSize, margins, BLEED_MM)
    const expectedFit = preset === "full-bleed" ? "cover" : "contain"
    const EPSILON = 0.001
    return (
      element.fit === expectedFit &&
      Math.abs(element.frame.x - box.x) < EPSILON &&
      Math.abs(element.frame.y - box.y) < EPSILON &&
      Math.abs(element.frame.width - box.width) < EPSILON &&
      Math.abs(element.frame.height - box.height) < EPSILON
    )
  })

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
      <Section title="Layout preset">
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(IMAGE_PRESET_LABELS) as ImagePreset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyImagePreset(frameId, elementId, preset)}
              className={cn(
                "rounded-md border px-1.5 py-1.5 text-center text-[0.7rem] leading-tight font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                preset === activePreset
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-input/30 text-foreground hover:bg-input/60 focus-visible:border-ring",
              )}
            >
              {IMAGE_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
        <Hint>Same presets as the canvas&apos;s right-click menu on this image.</Hint>
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

/**
 * Same visual shell as `SelectTrigger` (border, tinted background, chevron)
 * for a value that isn't actually pickable here — the "Size" row, which is
 * computed from Type × the book's type scale rather than its own field.
 * Matches the reference's styling rather than falling back to a plain
 * `Row` for it, but stays a `<div>`, not a `Select`: rendering a real Select
 * with a single option (or none) would open onto an empty popup, which
 * reads as broken rather than as "this isn't editable here."
 */
function StaticSelectStyledValue({ value }: { value: string }) {
  return (
    <div className="flex w-full items-center justify-between gap-2 rounded-md border bg-input/30 py-1 pr-2 pl-2 text-sm text-foreground capitalize">
      {value}
      <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
    </div>
  )
}

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
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * A dedicated Select rather than routing through `SelectField` — that one
 * assumes its options double as their own display labels (title-cased via
 * CSS), which doesn't fit real font names (`"work-sans"` vs. `"Work Sans"`).
 * Each option previews in its own actual font, not just names it.
 */
const TEXT_FONT_LABELS = new Map(TEXT_FONTS.map((font) => [font.value, font.label]))

function FontFamilySelect({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (value: string) => void
}) {
  return (
    <Select value={value ?? DEFAULT_TEXT_FONT} onValueChange={(next) => onChange(next as string)}>
      <SelectTrigger>
        {/* `Select.Value` displays the raw value ("playfair-display") by
            default — it only shows a real label when given this mapping
            function, per base-ui's own API for exactly this case. */}
        <SelectValue>{(current: string) => TEXT_FONT_LABELS.get(current) ?? current}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {TEXT_FONTS.map((font) => (
          <SelectItem key={font.value} value={font.value} style={{ fontFamily: font.cssFontFamily }}>
            {font.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
      {label ? <span className="text-foreground">{label}</span> : null}
      <NumberField
        value={Math.round(value * 100)}
        step={1}
        min={0}
        max={100}
        onChange={(percent) => onChange(percent / 100)}
      />
      <span className="text-xs text-muted-foreground">%</span>
    </label>
  )
}

/**
 * A number input with its own custom up/down chevron steppers, replacing
 * the browser's native spinner (removed app-wide in globals.css) — the
 * point of that removal was never "no way to step at all," just "not the
 * browser's own unstyled one." Each chevron has a real hover state (the
 * shared `--accent` token, now distinct from `--background` — see the fix
 * note in globals.css) and is `tabIndex={-1}` so Tab still moves between
 * fields, not through the steppers.
 *
 * The chevrons themselves only show up on hover (or while the field has
 * focus) — `group-hover`/`group-focus-within` on the wrapper, rather than
 * sitting there permanently — so a column of these fields reads as plain
 * number inputs at rest, matching the design.
 */
function NumberField({
  value,
  onChange,
  step,
  min,
  max,
}: {
  value: number
  onChange: (value: number) => void
  step: number
  min?: number
  max?: number
}) {
  const clamp = (next: number) => {
    let clamped = next
    if (min !== undefined) clamped = Math.max(min, clamped)
    if (max !== undefined) clamped = Math.min(max, clamped)
    // Floating point: 24.6 + 0.1 shouldn't drift to 24.700000000000003.
    return Math.round(clamped * 100) / 100
  }

  return (
    <div className="group relative">
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const next = event.target.valueAsNumber
          if (Number.isNaN(next)) return
          onChange(clamp(next))
        }}
        className="w-20 rounded-md border bg-input/30 py-1 pr-5 pl-2 text-right text-xs text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
      <div className="absolute inset-y-0 right-0.5 flex flex-col justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Increase"
          onClick={() => onChange(clamp(value + step))}
          className="flex items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronUpIcon className="size-2.5" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Decrease"
          onClick={() => onChange(clamp(value - step))}
          className="flex items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronDownIcon className="size-2.5" />
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="pb-1 text-xs font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-xs text-foreground">{value}</span>
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="pt-1 text-xs leading-relaxed text-muted-foreground">{children}</p>
}
