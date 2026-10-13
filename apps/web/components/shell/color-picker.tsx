"use client"

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { Popover } from "@base-ui/react/popover"
import {
  cmykToHex,
  hexToCmyk,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  isValidHex,
  rgbToHex,
  type CmykColor,
  type HsvColor,
  type RgbColor,
} from "@loupe/core"

import { Tabs, TabsIndicator, TabsList, TabsTab } from "@/components/ui/tabs"

/** Which color space the popover's numeric channel fields are currently
 *  expressed in. Doesn't change what's stored — `TextElement.color` is
 *  always a hex string; this only picks which fields the user edits it
 *  through (R: photographers and print professionals think in RGB or CMYK,
 *  not hex). Switched via the segmented control at the top of the popover. */
type ColorInputMode = "rgb" | "cmyk"

/**
 * The text sidebar's Color field. A swatch + hex trigger, matching the
 * reference (Paper node 1Y-0)'s row styling but built from this project's
 * own input tokens (`bg-input/30`, `border`) rather than the reference's
 * literal oklch/hex values, same as every other field in this file. Opens a
 * popover with a draggable saturation/value square + hue slider (see
 * `SaturationValuePicker` below for the reference this was built against),
 * a raw hex field for a quick paste, and an RGB/CMYK toggle over the same
 * value — CMYK exists because this is a print layout tool, and CMYK is how
 * a print professional actually thinks about ink, not a screen's RGB.
 */
export function ColorField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [mode, setMode] = useState<ColorInputMode>("rgb")
  const [hexDraft, setHexDraft] = useState(value)
  const [lastCommittedValue, setLastCommittedValue] = useState(value)
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(value))

  // The hex field is free text while it's being typed (an in-progress "#18"
  // shouldn't be rejected or reformatted mid-keystroke) — only commit
  // upstream once it's a genuinely valid hex. When `value` changes from
  // elsewhere (RGB/CMYK fields, the square/slider, or a different element
  // being selected), the draft and the derived HSV both need to follow it —
  // same "adjust state during render" pattern `InspectorPanel` uses for
  // `displayed`/`selection`, not an effect, since this is a pure response
  // to a prop change rather than a side effect on an external system.
  //
  // Deriving `hsv` from `value` on *every* render (rather than only when it
  // actually changed) would round-trip hex->hsv->hex on each keystroke and
  // drag frame — `HsvColor`'s `s`/`v` are rounded to whole percentages, so
  // that round trip is lossy and would make the hue slider visibly jitter
  // mid-drag. Keeping `hsv` as its own state, updated directly by the
  // square/slider handlers below and only re-derived here when `value`
  // changed for some *other* reason, avoids that.
  if (value !== lastCommittedValue) {
    setLastCommittedValue(value)
    setHexDraft(value)
    setHsv(hexToHsv(value))
  }

  const rgb = hexToRgb(value)
  const cmyk = hexToCmyk(value)

  const commitHsv = (next: HsvColor) => {
    setHsv(next)
    const hex = hsvToHex(next)
    setLastCommittedValue(hex)
    setHexDraft(hex)
    onChange(hex)
  }
  const commitHex = (next: string) => {
    setHexDraft(next)
    if (isValidHex(next)) onChange(next.startsWith("#") ? next : `#${next}`)
  }
  const setRgbChannel = (patch: Partial<RgbColor>) => onChange(rgbToHex({ ...rgb, ...patch }))
  const setCmykChannel = (patch: Partial<CmykColor>) => onChange(cmykToHex({ ...cmyk, ...patch }))

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md border bg-input/30 py-1 pr-2 pl-1 text-sm text-foreground transition-colors outline-none data-popup-open:border-ring focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span
              className="size-4 shrink-0 rounded-xs border border-white/10"
              style={{ backgroundColor: value }}
            />
            <span className="flex-1 truncate text-right font-mono text-xs tracking-wider text-foreground">
              {value}
            </span>
          </button>
        }
      />
      <Popover.Portal>
        {/* `side="left"`/`align="end"` (direct follow-up — was `bottom`/
            `start`): the sidebar this field lives in is pinned to the
            right edge of the viewport, so opening downward risked the
            popup running off the bottom of the screen — which flips it
            to the opposite side and reads as the whole thing jumping.
            Opening into the canvas to the left, bottom-aligned to the
            trigger, has room to grow without ever needing to flip. See
            the reference this was built against:
            https://app.paper.design/file/01K98TQ792YZPT540WYSV69H6K/01K98TQ792S0C6FZ5FV97B0HHP/TF-0 */}
        <Popover.Positioner side="left" align="end" sideOffset={8}>
          <Popover.Popup className="z-50 flex w-[290px] origin-(--transform-origin) flex-col gap-2 rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <Tabs value={mode} onValueChange={(next) => setMode(next as ColorInputMode)}>
              <TabsList aria-label="Color input mode" className="gap-1">
                <TabsIndicator />
                <TabsTab value="rgb">RGB</TabsTab>
                <TabsTab value="cmyk">CMYK</TabsTab>
              </TabsList>
            </Tabs>

            <SaturationValuePicker hsv={hsv} onChange={commitHsv} />

            <div className="flex items-center gap-2">
              <span
                className="size-[30px] shrink-0 rounded-md border border-white/10"
                style={{ backgroundColor: value }}
              />
              <input
                type="text"
                aria-label="Hex color"
                value={hexDraft}
                onChange={(event) => commitHex(event.target.value)}
                spellCheck={false}
                className="w-full rounded-md border bg-input/30 px-2 py-1 font-mono text-xs text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>

            {/* One row, every channel side by side — not stacked — so RGB's
                three fields and CMYK's four take the same total height.
                Stacking one row per channel (the previous layout) made the
                CMYK panel visibly taller than the RGB one, which is what
                actually caused the "moved up on toggle" bug above: a taller
                popup no longer fit below the trigger and got flipped. */}
            <div className="flex items-stretch justify-between gap-2">
              {mode === "rgb" ? (
                <>
                  <ColorChannelField label="R" value={rgb.r} max={255} onChange={(r) => setRgbChannel({ r })} />
                  <ColorChannelField label="G" value={rgb.g} max={255} onChange={(g) => setRgbChannel({ g })} />
                  <ColorChannelField label="B" value={rgb.b} max={255} onChange={(b) => setRgbChannel({ b })} />
                </>
              ) : (
                <>
                  <ColorChannelField label="C" value={cmyk.c} max={100} onChange={(c) => setCmykChannel({ c })} />
                  <ColorChannelField label="M" value={cmyk.m} max={100} onChange={(m) => setCmykChannel({ m })} />
                  <ColorChannelField label="Y" value={cmyk.y} max={100} onChange={(y) => setCmykChannel({ y })} />
                  <ColorChannelField label="K" value={cmyk.k} max={100} onChange={(k) => setCmykChannel({ k })} />
                </>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * One RGB (0-255) or CMYK (0-100%) channel in the Color field's popover —
 * its own compact bordered box (label left, value right, both in one row),
 * not `NumberField` (which owns its own border/padding and would double up
 * with a wrapping box here). Deliberately no hover steppers, unlike
 * `NumberField` elsewhere in the sidebar: at 3-4 fields sharing one row in a
 * 290px popup there isn't width to spare for them without cramping the
 * number itself, and the reference this was built against
 * (https://app.paper.design/…/TF-0) doesn't show any either.
 */
function ColorChannelField({
  label,
  value,
  max,
  onChange,
}: {
  label: string
  value: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex flex-1 items-center justify-between gap-1 rounded-md border bg-input/30 px-2 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        step={1}
        min={0}
        max={max}
        value={value}
        onChange={(event) => {
          const next = event.target.valueAsNumber
          if (Number.isNaN(next)) return
          onChange(Math.min(max, Math.max(0, Math.round(next))))
        }}
        className="min-w-0 flex-1 bg-transparent text-right text-xs text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  )
}

const SQUARE_HEIGHT_PX = 160
const HUE_TRACK_WIDTH_PX = 14

/**
 * The draggable saturation/value square + hue slider — the part that
 * replaces the old RGB/CMYK-number-fields-only picker. Built directly
 * against the Paper reference's own "color picker RGB"/"color picker CMYK"
 * frames (https://app.paper.design/file/01K98TQ792YZPT540WYSV69H6K/01K98TQ792S0C6FZ5FV97B0HHP,
 * nodes N8-0/O7-0 — pulled via `get_jsx` for exact spacing/radii/gradients,
 * not read off a screenshot), swapping its LCH/LAB channel rows for this
 * project's RGB/CMYK ones (this is a print layout tool — see the module doc
 * comment on `ColorField`). Both the RGB and CMYK channel rows below render
 * at the same height (`ColorChannelField`'s one-row layout) specifically so
 * toggling between them never changes the popup's total height — see the
 * `side="left"` doc comment on `ColorField`'s `Popover.Positioner` for why
 * that mattered.
 *
 * The square's `s`/`v` axes and the hue bar are both driven by pointer
 * capture (`setPointerCapture` on `pointerdown`) rather than a `window`
 * listener pair — capturing on the element itself keeps receiving
 * `pointermove`/`pointerup` even once the pointer leaves the square's
 * bounds mid-drag (dragging the handle to the edge and past it, a normal
 * gesture), without needing to attach/detach global listeners by hand.
 */
function SaturationValuePicker({ hsv, onChange }: { hsv: HsvColor; onChange: (next: HsvColor) => void }) {
  const squareRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)

  const pureHueHex = hsvToHex({ h: hsv.h, s: 100, v: 100 })

  const handleSquarePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const square = squareRef.current
    if (!square) return
    square.setPointerCapture(event.pointerId)

    const update = (clientX: number, clientY: number) => {
      const rect = square.getBoundingClientRect()
      const s = clamp01((clientX - rect.left) / rect.width) * 100
      // Top of the square is full value (bright), bottom is zero (black).
      const v = 100 - clamp01((clientY - rect.top) / rect.height) * 100
      onChange({ h: hsv.h, s, v })
    }

    update(event.clientX, event.clientY)

    const onMove = (moveEvent: PointerEvent) => update(moveEvent.clientX, moveEvent.clientY)
    const onUp = () => {
      square.removeEventListener("pointermove", onMove)
      square.removeEventListener("pointerup", onUp)
    }
    square.addEventListener("pointermove", onMove)
    square.addEventListener("pointerup", onUp)
  }

  const handleHuePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = hueRef.current
    if (!track) return
    track.setPointerCapture(event.pointerId)

    const update = (clientY: number) => {
      const rect = track.getBoundingClientRect()
      const h = clamp01((clientY - rect.top) / rect.height) * 360
      onChange({ h, s: hsv.s, v: hsv.v })
    }

    update(event.clientY)

    const onMove = (moveEvent: PointerEvent) => update(moveEvent.clientY)
    const onUp = () => {
      track.removeEventListener("pointermove", onMove)
      track.removeEventListener("pointerup", onUp)
    }
    track.addEventListener("pointermove", onMove)
    track.addEventListener("pointerup", onUp)
  }

  return (
    <div className="flex gap-2" style={{ height: SQUARE_HEIGHT_PX }}>
      <div
        ref={squareRef}
        onPointerDown={handleSquarePointer}
        role="slider"
        aria-label="Saturation and value"
        aria-valuenow={Math.round(hsv.s)}
        tabIndex={0}
        className="relative flex-1 cursor-crosshair touch-none rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        style={{
          backgroundColor: pureHueHex,
          backgroundImage:
            "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
        }}
      >
        <div
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
          style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, backgroundColor: hsvToHex(hsv) }}
        />
      </div>

      <div
        ref={hueRef}
        onPointerDown={handleHuePointer}
        role="slider"
        aria-label="Hue"
        aria-valuenow={Math.round(hsv.h)}
        aria-valuemin={0}
        aria-valuemax={360}
        tabIndex={0}
        className="relative shrink-0 cursor-pointer touch-none rounded-sm border outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        style={{
          width: HUE_TRACK_WIDTH_PX,
          background:
            "linear-gradient(in oklab 180deg, oklab(62.8% 0.225 0.126) 0%, oklab(96.8% -0.071 0.199) 16.67%, oklab(86.6% -0.234 0.180) 33.33%, oklab(90.5% -0.149 -0.039) 50%, oklab(45.2% -0.032 -0.312) 66.67%, oklab(70.2% 0.275 -0.169) 83.33%, oklab(62.8% 0.225 0.126) 100%)",
        }}
      >
        <div
          className="pointer-events-none absolute -inset-x-px h-2 -translate-y-1/2 rounded-full border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{ top: `${(hsv.h / 360) * 100}%` }}
        />
      </div>
    </div>
  )
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
