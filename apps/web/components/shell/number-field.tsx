"use client"

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"

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
}: {
  value: number
  onChange: (value: number) => void
  step: number
  min?: number
  max?: number
  unit?: string
}) {
  const clamp = (next: number) => {
    let clamped = next
    if (min !== undefined) clamped = Math.max(min, clamped)
    if (max !== undefined) clamped = Math.min(max, clamped)
    // Floating point: 24.6 + 0.1 shouldn't drift to 24.700000000000003.
    return Math.round(clamped * 100) / 100
  }

  return (
    <div className="group relative flex w-20 items-center rounded-md border bg-muted py-1 pr-5 pl-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
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
        className="min-w-0 flex-1 bg-transparent text-right text-xs text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {unit ? <span className="pl-0.5 text-xs text-muted-foreground select-none">{unit}</span> : null}
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
