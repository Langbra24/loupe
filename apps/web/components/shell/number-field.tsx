"use client"

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"

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
 *
 * `unit` (per the Paper reference, BS-0) renders a fixed suffix — `%` for
 * `PercentField`'s X/Y/W/H fields — inside the same bordered box as the
 * number, immediately after it, rather than as a separate `<span>` sitting
 * outside the field. The border/background live on this wrapper now (not
 * the `<input>` itself) so the number and its unit read as one value inside
 * one box, matching "17%" in the reference instead of a box followed by a
 * loose "%" off to its right.
 *
 * Extracted out of inspector-panel.tsx, still its only user (the X/Y/W/H
 * and margin fields) — `color-picker.tsx`'s RGB/CMYK channel fields don't
 * reuse it, despite living in a sibling file for the same reason this one
 * was extracted (avoiding an inspector-panel.tsx/color-picker.tsx import
 * cycle): those fields share one row in a much narrower popup, where this
 * component's own border/padding chrome would double up against a
 * wrapping box of their own.
 *
 * `bg-muted` (direct follow-up, Paper node 1G2-0 — was `bg-input/30`): a
 * solid, opaque fill reads as a real input field; the previous translucent
 * overlay tint was too close to invisible against the sidebar's own
 * background to look like a field at rest.
 */
export function NumberField({
  value,
  onChange,
  step,
  min,
  max,
  unit,
  align = "right",
  labelledBy,
}: {
  value: number
  onChange: (value: number) => void
  step: number
  min?: number
  max?: number
  unit?: string
  /** Where the number sits in the box. Right by default; the page sidebar's
   *  margin fields left-align (issue #40). */
  align?: "left" | "right"
  /** Id of a visible label elsewhere, for a field with no wrapping
   *  `<label>` (the text sidebar's Width, #50). */
  labelledBy?: string
}) {
  const clamp = (next: number) => {
    let clamped = next
    if (min !== undefined) clamped = Math.max(min, clamped)
    if (max !== undefined) clamped = Math.min(max, clamped)
    // Floating point: 24.6 + 0.1 shouldn't drift to 24.700000000000003.
    return Math.round(clamped * 100) / 100
  }

  return (
    <div className="group relative flex w-20 items-center rounded-md border bg-muted py-1 pr-5 pl-2 transition-colors focus-ring-within">
      <input
        type="number"
        aria-labelledby={labelledBy}
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const next = event.target.valueAsNumber
          if (Number.isNaN(next)) return
          onChange(clamp(next))
        }}
        className={cn(
          "min-w-0 flex-1 bg-transparent text-xs tabular-nums text-foreground outline-none",
          align === "left" ? "text-left" : "text-right",
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        )}
      />
      {unit ? (
        <span aria-hidden className="pl-0.5 text-xs text-muted-foreground select-none">
          {unit}
        </span>
      ) : null}
      {/* Hidden from assistive tech: the input's own arrow keys step it, and
          inside a wrapping <label> these buttons' names would otherwise be
          read as part of the field's ("Top Increase Decrease", #50). */}
      {/* Each chevron is drawn at 10px but its pseudo-element target is
          24×24: the upper one reaches 11px above the field, the lower one
          11px below, and they meet at the field's midline. Live only while
          the pointer is over this field, so a neighbouring field's targets
          are never live at the same time and two never overlap. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0.5 flex flex-col justify-center opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <button
          type="button"
          tabIndex={-1}
          // Keep focus in the input: these are hidden from assistive tech.
          onMouseDown={(event) => event.preventDefault()}
          aria-label="Increase"
          onClick={() => onChange(clamp(value + step))}
          className="relative flex items-center justify-center rounded-sm text-muted-foreground transition-colors before:absolute before:-inset-x-[7px] before:-top-3.5 before:bottom-0 hover:bg-accent hover:text-foreground"
        >
          <ChevronUpIcon className="size-2.5" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          aria-label="Decrease"
          onClick={() => onChange(clamp(value - step))}
          className="relative flex items-center justify-center rounded-sm text-muted-foreground transition-colors before:absolute before:-inset-x-[7px] before:top-0 before:-bottom-3.5 hover:bg-accent hover:text-foreground"
        >
          <ChevronDownIcon className="size-2.5" />
        </button>
      </div>
    </div>
  )
}
