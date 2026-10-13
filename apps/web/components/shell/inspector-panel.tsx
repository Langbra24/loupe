"use client"

import { useEffect, useState } from "react"
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon } from "lucide-react"
import {
  checkPageCount,
  presetImageBox,
  resolveTextSize,
  defaultFrameMargins,
  spreadSideOf,
  type ImageElement,
  type ImagePreset,
  type Margins,
  type Selection,
  type TextElement,
  type TypeRole,
} from "@loupe/core"

import { ColorField } from "@/components/shell/color-picker"
import { NumberField } from "@/components/shell/number-field"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsIndicator, TabsList, TabsTab } from "@/components/ui/tabs"
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
// Order matters here (not in light-table.tsx's copy, a plain vertical menu
// list) — `Object.keys()` insertion order drives the 2x2 button grid below,
// and this one is row-major: Full bleed/Centered on top, Two-page spread/
// Left half underneath (direct follow-up, Paper node 1G2-0).
const IMAGE_PRESET_LABELS: Record<ImagePreset, string> = {
  "full-bleed": "Full bleed",
  centered: "Centered",
  "two-page-spread": "Two-page spread",
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
 * A text element's default fill when `TextElement.color` is unset — every
 * frame is a white printed page, so this has to be dark, unconditionally.
 * Centralized here (rather than duplicated as a literal) for the same
 * reason `BLEED_MM` is: `use-fabric-canvas.ts` imports this exact value for
 * the actual canvas rendering, and the Color field below needs the same
 * value to show as its placeholder swatch for an element that has no
 * override yet — the two must never drift apart from each other.
 */
export const DEFAULT_TEXT_COLOR = "#18181b"

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
        {/* Section dividers bleed through the column's `px-3` to run edge to
            edge (issue #25). Set here once for every inspector state, not on
            the shared `Separator`, whose inset default other panels keep;
            `w-auto` lets the negative margins widen it, where `w-full` would
            only shift it. */}
        <div
          className={cn(
            "flex flex-col gap-6 px-3 pt-14 pb-4 transition-opacity motion-reduce:transition-none",
            "[&_[data-slot=separator][data-orientation=horizontal]]:-mx-3 [&_[data-slot=separator][data-orientation=horizontal]]:w-auto",
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
  const frameCount = useEditorStore((state) => state.project.frames.length)
  const updateFrameMargins = useEditorStore((state) => state.updateFrameMargins)
  const reorderFrameById = useEditorStore((state) => state.reorderFrameById)

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
      <Section title="Layout">
        {/* Paper (HQ-0) puts 16px between these two boxed fields, not
            `Section`'s own 4px title-gap — that spacing is fine for the
            plain inline `Row`s every other section uses, but too tight
            once a field grows a label-above-box shape like these. */}
        <div className="flex flex-col gap-4 pt-3">
          <StaticFieldBox label="Page size" value={frame.pageSize.name} />
          <PositionSelect
            position={frame.position}
            frameCount={frameCount}
            onChange={(next) => reorderFrameById(frame.position, next)}
          />
        </div>
      </Section>
      <Separator />
      <Section title="Margins">
        <Hint>Millimetres as defaults</Hint>
        <div className="flex flex-col gap-4 pt-3">
          <MarginField label="Top" value={margins.top} onChange={(v) => setMargin("top", v)} />
          <MarginField label="Inner" value={margins.inner} onChange={(v) => setMargin("inner", v)} />
          <MarginField label="Outer" value={margins.outer} onChange={(v) => setMargin("outer", v)} />
          <MarginField label="Bottom" value={margins.bottom} onChange={(v) => setMargin("bottom", v)} />
        </div>
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
      <NumberField value={value} step={0.1} onChange={onChange} align="left" />
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
      {/* Alignment/Type/Size/Font read as one cluster of type controls in
          the reference (Paper node 7H-0) — grouped by the same gap-6 every
          section already gets, but without a divider line between each of
          these four specifically, unlike the harder break before/after the
          cluster. Alignment leads the cluster (moved above Type, per direct
          user feedback) since left/center/right icons are the more
          universally recognized formatting control — most text tools put
          it first, ahead of anything role- or scale-related. */}
      <Section title="Alignment">
        <AlignmentTabs
          value={element.align}
          onChange={(align) => updateTextElement(frameId, elementId, { align })}
        />
      </Section>
      <Section title="Type">
        <SelectField
          value={element.role}
          options={TYPE_ROLES}
          onChange={(role) => updateTextElement(frameId, elementId, { role })}
        />
      </Section>
      <Section title="Size">
        <SizeSelect
          value={resolveTextSize(element.role, element.fontSize, project.typeBaseSize, project.typeRatio)}
          onChange={(fontSize) => updateTextElement(frameId, elementId, { fontSize })}
        />
      </Section>
      <Section title="Font">
        <FontFamilySelect
          value={element.fontFamily}
          onChange={(fontFamily) => updateTextElement(frameId, elementId, { fontFamily })}
        />
      </Section>
      <Section title="Color">
        <ColorField
          value={element.color ?? DEFAULT_TEXT_COLOR}
          onChange={(color) => updateTextElement(frameId, elementId, { color })}
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
  const frames = useEditorStore((state) => state.project.frames)
  const frame = frames.find((f) => f.id === frameId)
  const element = frame?.elements.find((e): e is ImageElement => e.id === elementId && e.kind === "image")
  const updateImageFit = useEditorStore((state) => state.updateImageFit)
  const updateElementBox = useEditorStore((state) => state.updateElementBox)
  const applyImagePreset = useEditorStore((state) => state.applyImagePreset)

  if (!frame || !element) return <Hint>This element no longer exists.</Hint>

  // Which side of a spread this frame is (or `null` for a cover/unpaired
  // frame) — only `two-page-spread` cares (see `presetImageBox` in core),
  // but computing it once here keeps both the active-preset check and the
  // click handler agreeing on the same answer.
  const spreadSide = spreadSideOf(frames, frameId)

  // Which preset (if any) the element's current Box/fit already matches —
  // drives the "active" state on the preset buttons below. Recomputed from
  // the element's actual geometry rather than remembered as its own field,
  // so it naturally goes inactive again the moment the image is dragged or
  // resized by hand, which is the correct behavior: this button reflects
  // "does the image currently look like this preset," not "which one was
  // clicked last."
  const margins = frame.margins ?? defaultFrameMargins(frame.pageSize)
  const activePreset = (Object.keys(IMAGE_PRESET_LABELS) as ImagePreset[]).find((preset) => {
    const box = presetImageBox(preset, frame.pageSize, margins, BLEED_MM, spreadSide)
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
        {/* Not `Row` (direct follow-up, Paper node 1G2-0): this field's
            label reads full-brightness, not the muted tone every other
            `Row` label in this sidebar uses — a one-off for this field
            specifically, so `Row`'s other nine call sites stay untouched. */}
        <div className="flex items-center justify-between gap-3 py-0.5 text-sm">
          <span className="text-foreground">Name</span>
          <span className="truncate text-xs text-foreground">{element.name}</span>
        </div>
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
        {/* 2x2, not 3+1 (direct follow-up, Paper node 1G2-0) — four presets
            read as one balanced block this way instead of a lopsided row
            of three with the fourth stranded alone underneath. Explicit
            `h-7` (28px) keeps every button the same height regardless of
            whether its label wraps. */}
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(IMAGE_PRESET_LABELS) as ImagePreset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyImagePreset(frameId, elementId, preset)}
              className={cn(
                "flex h-7 items-center justify-center rounded-md border px-1.5 text-center text-[0.7rem] leading-tight font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
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

/** Common point sizes for the text sidebar's Size picker — a reasonable
 *  fixed set covering caption through display sizes, not the full type
 *  scale (that's `Type`'s job) or arbitrary free entry (a picker matches the
 *  reference's chevron-select styling; a stepper input doesn't). */
const TEXT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 60, 72] as const

/**
 * The "Size" field: overrides `TextElement.fontSize` directly, independent
 * of `Type` (role) — the two used to be the same control (size was purely
 * `sizeForRole(role, ...)`, with nothing for this field to write to), which
 * is why it rendered but did nothing. `value` is always shown even when it
 * isn't one of the presets (an existing element's role-derived size before
 * ever getting an explicit override) — never hide a real, valid value just
 * because it doesn't match a preset.
 */
function SizeSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const options = TEXT_SIZE_OPTIONS.includes(value as (typeof TEXT_SIZE_OPTIONS)[number])
    ? TEXT_SIZE_OPTIONS
    : [...TEXT_SIZE_OPTIONS, value].sort((a, b) => a - b)

  return (
    <Select value={value} onValueChange={(next) => onChange(next as number)}>
      <SelectTrigger>
        <SelectValue>{(current: number) => `${current}pt`}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((size) => (
          <SelectItem key={size} value={size}>
            {size}pt
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const ALIGNMENT_ICONS: Record<TextElement["align"], typeof AlignLeftIcon> = {
  left: AlignLeftIcon,
  center: AlignCenterIcon,
  right: AlignRightIcon,
}

/**
 * Left/center/right alignment as an icon tab rail — replacing a `Select`
 * dropdown that spelled the options out as text ("left", "center", "right").
 * Per direct user feedback: this is the one field in the panel where a
 * near-universal iconographic convention already exists (every text tool
 * puts these three glyphs in a row), so a dropdown was working against
 * familiarity rather than for it. Built on the same `Tabs` component
 * (ui/tabs.tsx) the left panel's Canvas/Book switcher uses, for the same
 * sliding-rail feel — `TabsTab`'s default text styling is irrelevant here
 * since each tab holds only an icon, centered via the added flex classes.
 */
function AlignmentTabs({
  value,
  onChange,
}: {
  value: TextElement["align"]
  onChange: (value: TextElement["align"]) => void
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as TextElement["align"])}>
      {/* Per Paper (F0-0): the rail sits inside its own bordered track,
          not floating directly on the sidebar background — the same
          bg-input/30 + border treatment every other field box in this
          file already uses, so this reads as one more field rather than
          a one-off control. */}
      <TabsList aria-label="Text alignment" className="gap-1 rounded-md border bg-input/30 p-0.5">
        <TabsIndicator />
        {ALIGNMENTS.map((align) => {
          const Icon = ALIGNMENT_ICONS[align]
          return (
            <TabsTab
              key={align}
              value={align}
              aria-label={`Align ${align}`}
              className="flex items-center justify-center"
            >
              <Icon className="size-4" />
            </TabsTab>
          )
        })}
      </TabsList>
    </Tabs>
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
        unit="%"
        onChange={(percent) => onChange(percent / 100)}
      />
    </label>
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

/**
 * A read-only value shown inside a field-styled box (Paper reference HQ-0's
 * "Page size"/"Position" rows in the frame sidebar) — label above, value
 * below in the same `bg-input/30`/`border`/`rounded-md` box every editable
 * field in this file uses, rather than `Row`'s plain inline text. Neither
 * value is actually editable here (a frame's page size is fixed once the
 * book is set up; its position comes from dragging it in the canvas grid,
 * not from typing a page number), but the reference wants both to read as
 * fields, not labels, for visual consistency with the boxed fields around
 * them. `mono` matches this file's existing convention of a monospace
 * face for numeric/code-like values (the hex color field, the page-count
 * field) — used here for "Position" (a page number) but not "Page size"
 * (a name).
 */
function StaticFieldBox({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col items-start gap-1.5 py-0.5 text-sm">
      <span className="text-foreground">{label}</span>
      <div className="flex h-7.5 w-full items-center rounded-md border bg-input/30 px-2">
        <span className={cn("w-full truncate text-left text-xs text-foreground", mono && "font-mono")}>
          {value}
        </span>
      </div>
    </div>
  )
}

/**
 * "Position" made functional (direct follow-up) — reorders the frame in the
 * book's reading order via `reorderFrameById`, rather than the
 * `StaticFieldBox` this used to be, which only displayed the current page
 * number. This doesn't add a new mutation path: a frame's position in the
 * canvas grid already *is* its position in the book's reading order (see
 * CLAUDE.md), and dragging it there was the only way to change that. This
 * select just exposes that same reorder as a sidebar control, for anyone
 * who'd rather type/pick a destination page than drag one on the canvas.
 * Options are every page 1..frameCount, so this is only ever a real move —
 * never a to-a-nonexistent-page no-op.
 */
function PositionSelect({
  position,
  frameCount,
  onChange,
}: {
  position: number
  frameCount: number
  onChange: (position: number) => void
}) {
  const pages = Array.from({ length: frameCount }, (_, index) => index)

  return (
    <div className="flex flex-col items-start gap-1.5 py-0.5 text-sm">
      <span className="text-foreground">Position</span>
      <Select value={position} onValueChange={(next) => onChange(next as number)}>
        <SelectTrigger className="h-7.5 font-mono">
          <SelectValue>{(current: number) => `Page ${current + 1}`}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {pages.map((page) => (
            <SelectItem key={page} value={page} className="font-mono">
              {`Page ${page + 1}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="pt-1 text-xs leading-relaxed text-muted-foreground">{children}</p>
}
